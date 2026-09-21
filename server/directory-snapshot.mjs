import { createHash } from 'node:crypto';

const id = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(value);
const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
export async function directoryStudentIsManaged(db, studentId, familyId) {
  const link=await db.prepare("SELECT local_id,payload,active FROM central_directory_links WHERE kind='student' AND central_id=?").bind(studentId).first();
  if(!link) return false;
  requireValue(link.active === 1 && link.local_id === studentId && JSON.parse(link.payload).familyId === familyId);
  return true;
}
function requireValue(condition) { if (!condition) throw new Error('Неполный или противоречивый справочник ОС'); }
function index(rows) {
  requireValue(Array.isArray(rows) && rows.length <= 10000);
  const map = new Map();
  for (const row of rows) { requireValue(row && id(row.id) && !map.has(row.id)); map.set(row.id,row); }
  return map;
}

// The caller serializes requests. No users, credentials, invitations or lesson
// history are created, removed or changed by this directory projection.
export async function applyDirectorySnapshot(db, input, apply) {
  requireValue(input?.version === 1 && input.complete === true && Number.isSafeInteger(input.sequence) && input.sequence > 0);
  const classes=index(input.classes), families=index(input.families), students=index(input.students), teachers=index(input.teachers);
  const names=new Set();
  for(const row of classes.values()) { requireValue(name(row.name) && Number.isInteger(row.grade) && row.grade>=0 && row.grade<=11 && !names.has(row.name) && (row.localId === undefined || id(row.localId))); names.add(row.name); }
  for(const row of students.values()) requireValue(name(row.firstName) && typeof row.lastName==='string' && row.lastName.length<=200 && classes.has(row.classId) && families.has(row.familyId));
  for(const row of teachers.values()) requireValue(name(row.displayName));
  const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const previous=await db.prepare("SELECT sequence,digest FROM central_directory_state WHERE id='primary'").first();
  requireValue(!previous || input.sequence > previous.sequence || (input.sequence === previous.sequence && previous.digest === digest));
  const links=(await db.prepare('SELECT * FROM central_directory_links').all()).results;
  const byKey=new Map(links.map(row=>[`${row.kind}:${row.central_id}`,row]));
  const statements=[];
  const linked=(kind,row,localId)=>statements.push(db.prepare(`INSERT INTO central_directory_links(kind,central_id,local_id,payload,active) VALUES(?,?,?,?,1)
    ON CONFLICT(kind,central_id) DO UPDATE SET payload=excluded.payload,active=1`).bind(kind,row.id,localId,JSON.stringify(row)));
  const localClasses=new Map();
  const localClassIds=new Set();
  for(const row of classes.values()) {
    const binding=byKey.get(`class:${row.id}`);
    const localId=binding?.local_id ?? row.localId ?? `os-${row.id}`;
    requireValue(!localClassIds.has(localId)); localClassIds.add(localId);
    requireValue(row.localId === undefined || row.localId === localId);
    const existing=await db.prepare('SELECT id,name,grade FROM school_classes WHERE id=? OR name=?').bind(localId,row.name).all();
    requireValue(existing.results.length <= 1);
    if(existing.results.length) {
      const target=existing.results[0];
      // Explicit localId is required to adopt an existing classroom. Renaming
      // would orphan lessons keyed by class_name, so require a separate move.
      requireValue(target.id === localId && target.name === row.name && target.grade === row.grade && (binding || row.localId === target.id));
    } else {
      requireValue(!row.localId && !binding);
      statements.push(db.prepare("INSERT INTO school_classes(id,name,grade,status) VALUES(?,?,?,'active')").bind(localId,row.name,row.grade));
    }
    requireValue(!links.some(link=>link.kind==='class' && link.local_id===localId && link.central_id!==row.id));
    localClasses.set(row.id,row.name); linked('class',row,localId);
  }
  let archived=0;
  for(const row of students.values()) {
    const binding=byKey.get(`student:${row.id}`);
    const existing=await db.prepare('SELECT id FROM students WHERE id=?').bind(row.id).first();
    requireValue(!existing || binding?.local_id === row.id);
    requireValue(!binding || binding.local_id === row.id);
    statements.push(db.prepare(`INSERT INTO students(id,first_name,last_name,class_name,status) VALUES(?,?,?,?,'active')
      ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,class_name=excluded.class_name,status='active',updated_at=CURRENT_TIMESTAMP`)
      .bind(row.id,row.firstName,row.lastName,localClasses.get(row.classId)));
    linked('student',row,row.id);
  }
  for(const [kind,rows] of [['family',families],['teacher',teachers]]) for(const row of rows.values()) linked(kind,row,row.id);
  for(const link of links) {
    const current={class:classes,student:students,family:families,teacher:teachers}[link.kind];
    requireValue(current);
    if(!current.has(link.central_id)) {
      statements.push(db.prepare('UPDATE central_directory_links SET active=0 WHERE kind=? AND central_id=?').bind(link.kind,link.central_id));
      if(link.kind==='student' && link.active) { archived++; statements.push(db.prepare("UPDATE students SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(link.local_id)); }
    }
  }
  const result={classes:classes.size,students:students.size,families:families.size,teachers:teachers.size,archived,sequence:input.sequence,digest,applied:apply};
  if(apply && !(previous?.sequence===input.sequence && previous.digest===digest)) {
    // Check the observed version inside the same write transaction. A second
    // process cannot apply a stale plan after another snapshot has committed.
    statements.unshift(db.prepare(`INSERT INTO central_directory_state(id,sequence,digest)
      VALUES('primary',CASE WHEN COALESCE((SELECT sequence FROM central_directory_state WHERE id='primary'),0)=? THEN ? ELSE NULL END,?)
      ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,digest=excluded.digest`).bind(previous?.sequence??0,input.sequence,digest));
    await db.batch(statements);
  }
  return result;
}
