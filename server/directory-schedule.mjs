import { schoolSchedule } from './school-schedule-data.mjs';
import { createHash } from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requireValue=condition=>{if(!condition)throw Error('Расписание не подтверждено: проверьте источник, классы, предметы и существующий журнал');};
const historyTables=['lessons','grades','homework','attendance','teacher_comments','program_topic_sessions'];
export async function planDirectorySchedule(db,input,classes,context) {
  if(input===undefined) return {statements:[],receipt:{}};
  requireValue(context?.systemId==='SYS-SCHOOL-1-11' && context?.branchId==='BR-SCHOOL');
  requireValue(digest(input)===digest(schoolSchedule));
  const byGrade=new Map();
  for(const row of classes.values()) {requireValue(!byGrade.has(row.grade));byGrade.set(row.grade,row.name);}
  requireValue(byGrade.size===6 && input.lessons.every(row=>byGrade.has(row.grade)));
  const imported=await db.prepare('SELECT lesson_count FROM schedule_imports WHERE source_sha256=?').bind(input.source.sha256).first();
  if(imported) {
    requireValue(imported.lesson_count===input.lessons.length);
    const ids=new Set(input.lessons.map(row=>row.id));
    const existing=(await db.prepare('SELECT id,teacher_user_id FROM lessons').all()).results.filter(row=>ids.has(row.id));
    requireValue(existing.length===input.lessons.length);
    return {statements:[],receipt:{scheduleLessons:existing.length,unassignedLessons:existing.filter(row=>!row.teacher_user_id).length}};
  }
  for(const table of historyTables) requireValue((await db.prepare('SELECT count(*) n FROM '+table).first()).n===0);
  requireValue((await db.prepare('SELECT count(*) n FROM schedule_imports').first()).n===0);
  const subjects=new Set((await db.prepare("SELECT id FROM subjects WHERE status='active'").all()).results.map(row=>row.id));
  requireValue(input.lessons.every(row=>row.subjectId==='biology' || subjects.has(row.subjectId)));
  const assignments=(await db.prepare(`SELECT a.teacher_user_id,a.class_name,a.subject_id FROM teacher_assignments a JOIN users u ON u.id=a.teacher_user_id
    WHERE a.status='confirmed' AND u.role='teacher' AND u.profile_status='confirmed' AND u.status IN ('active','setup')`).all()).results;
  const planned=input.lessons.map(row=>{
    const className=byGrade.get(row.grade);
    const ids=[...new Set(assignments.filter(a=>a.class_name===className && a.subject_id===row.subjectId).map(a=>a.teacher_user_id))];
    return {...row,className,teacherId:ids.length===1?ids[0]:null,reason:ids.length>1?'Несколько подтверждённых назначений: выберите учителя.':'Подтвердите учителя для этого класса и предмета.'};
  });
  const conflicts=new Set();
  for(let i=0;i<planned.length;i++) for(let j=i+1;j<planned.length;j++) {
    const a=planned[i],b=planned[j];
    if(a.teacherId && a.teacherId===b.teacherId && a.weekday===b.weekday && a.startsAt<b.endsAt && b.startsAt<a.endsAt) {conflicts.add(a.id);conflicts.add(b.id);}
  }
  for(const row of planned) if(conflicts.has(row.id)) {row.teacherId=null;row.reason='Пересечение уроков у назначенного учителя: уточните расписание или назначение.';}
  // Repeat the empty-journal guard inside the caller's atomic transaction.
  const empty=historyTables.concat('schedule_imports').map(table=>'NOT EXISTS(SELECT 1 FROM '+table+')').join(' AND ');
  const statements=[db.prepare(`INSERT INTO schedule_imports(id,academic_year,source_file_name,source_sha256,lesson_count)
    VALUES(?,?,?,?,CASE WHEN ${empty} THEN ? ELSE NULL END)`).bind('sheet2-'+input.source.sha256.slice(0,12),input.academicYear,'Лист2 · с '+input.source.effectiveFrom,input.source.sha256,planned.length)];
  if(!subjects.has('biology')) statements.push(db.prepare(`INSERT INTO subjects(id,name,short_name,color,icon,stage,weekly_hours,status)
    VALUES('biology','Биология','Биология','#5a9b4c','Б','6',0,'active') ON CONFLICT(id) DO UPDATE SET status='active'`));
  for(const row of planned) statements.push(db.prepare(`INSERT INTO lessons(id,class_name,weekday,starts_at,ends_at,subject_id,teacher_user_id,display_label,group_name,room,status,note)
    VALUES(?,?,?,?,?,?,?,?,?,?,'scheduled',?)`).bind(row.id,row.className,row.weekday,row.startsAt,row.endsAt,row.subjectId,row.teacherId,row.displayLabel,row.groupName,'Кабинет не указан',
      `Лист2, ${row.sourceCell}; с ${input.source.effectiveFrom}.`+(row.teacherId?'':' '+row.reason)));
  return {statements,receipt:{scheduleLessons:planned.length,unassignedLessons:planned.filter(row=>!row.teacherId).length}};
}
