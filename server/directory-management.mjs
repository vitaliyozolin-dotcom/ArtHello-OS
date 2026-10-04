import { createHash, randomUUID } from 'node:crypto';

export class DirectoryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const requireValue = (condition, message, status=400) => { if (!condition) throw new DirectoryError(message,status); };
const text = (value, max, required=true) => {
  requireValue(typeof value === 'string', 'Проверьте заполнение полей');
  const result=value.trim();
  requireValue((!required || result.length>0) && result.length<=max,'Проверьте длину и заполнение полей');
  return result;
};
const editableRoles=new Set(['director','deputy','admin']);

export function directoryRevision(db) {
  const data=['school_classes','subjects','teacher_assignments'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  data.push(db.prepare('SELECT id,role,status,profile_status,display_name FROM users ORDER BY id').all());
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function directoryState(db) {
  return {
    revision:directoryRevision(db),
    subjects:db.prepare('SELECT id,name,short_name AS shortName,stage,weekly_hours AS weeklyHours,status FROM subjects ORDER BY name').all(),
  };
}

function confirmedTeacher(db, id) {
  const teacher=db.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND status IN ('active','setup') AND profile_status='confirmed'").get(id);
  requireValue(teacher,'Выберите подтверждённого действующего педагога');
}

// All validation, mutation and audit run synchronously in one SQLite transaction.
// No await/network call can interleave an edit with its version check.
export function manageDirectory(db, actor, body) {
  requireValue(body && typeof body==='object' && !Array.isArray(body),'Некорректный запрос');
  db.exec('BEGIN IMMEDIATE');
  try {
    const actual=db.prepare("SELECT id,role FROM users WHERE id=? AND status='active'").get(actor?.id??'');
    requireValue(actual && actual.role===actor?.role && editableRoles.has(actual.role),'Нет прав на управление справочниками',403);
    requireValue(typeof body.revision==='string' && body.revision===directoryRevision(db),'Данные изменились. Обновите список и повторите изменение.',409);
    let id=typeof body.id==='string'?text(body.id,100,false):'';
    let entity='';
    let before=null;
    if(body.action==='subject.save') {
      entity='subject';
      before=id?db.prepare('SELECT * FROM subjects WHERE id=?').get(id):null;
      requireValue(!id || before,'Предмет не найден',404);
      const name=text(body.name,120),shortName=text(body.shortName,30),stage=text(body.stage,40);
      const weeklyHours=Number(body.weeklyHours);
      requireValue(Number.isInteger(weeklyHours)&&weeklyHours>=0&&weeklyHours<=40,'Число часов должно быть от 0 до 40');
      const duplicate=db.prepare('SELECT id,name FROM subjects WHERE id<>?').all(id).some(s=>s.name.trim().toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru'));
      requireValue(!duplicate,'Предмет с таким названием уже существует',409);
      if(before) db.prepare('UPDATE subjects SET name=?,short_name=?,stage=?,weekly_hours=?,updated_at=? WHERE id=?').run(name,shortName,stage,weeklyHours,new Date().toISOString(),id);
      else { id='subject-'+randomUUID();db.prepare("INSERT INTO subjects(id,name,short_name,color,icon,stage,weekly_hours,status) VALUES(?,?,?,'#6D5BD0','book',?,?,'active')").run(id,name,shortName,stage,weeklyHours); }
    } else if(body.action==='subject.archive' || body.action==='subject.restore') {
      entity='subject';before=db.prepare('SELECT * FROM subjects WHERE id=?').get(id);
      requireValue(before,'Предмет не найден',404);
      if(body.action==='subject.archive') {
        const inUse=db.prepare("SELECT 1 FROM teacher_assignments WHERE subject_id=? AND status='confirmed' UNION ALL SELECT 1 FROM lessons WHERE subject_id=? AND status NOT IN ('archived','cancelled') UNION ALL SELECT 1 FROM programs WHERE subject_id=? AND status<>'archived' LIMIT 1").get(id,id,id);
        requireValue(!inUse,'Сначала измените действующие назначения, расписание и программы по этому предмету',409);
      }
      db.prepare('UPDATE subjects SET status=?,updated_at=? WHERE id=?').run(body.action==='subject.archive'?'archived':'active',new Date().toISOString(),id);
    } else if(body.action==='class.homeroom') {
      entity='class';before=db.prepare("SELECT * FROM school_classes WHERE id=? AND status='active'").get(id);
      requireValue(before,'Класс не найден',404);
      const teacherId=text(body.teacherId,100,false);
      if(teacherId) confirmedTeacher(db,teacherId);
      db.prepare('UPDATE school_classes SET homeroom_teacher_user_id=?,updated_at=? WHERE id=?').run(teacherId||null,new Date().toISOString(),id);
    } else if(body.action==='assignment.save') {
      entity='teacher_assignment';
      const teacherId=text(body.teacherId,100),className=text(body.className,30),subjectId=text(body.subjectId,100);
      confirmedTeacher(db,teacherId);
      requireValue(db.prepare("SELECT id FROM school_classes WHERE name=? AND status='active'").get(className),'Класс не найден',404);
      requireValue(db.prepare("SELECT id FROM subjects WHERE id=? AND status='active'").get(subjectId),'Действующий предмет не найден',404);
      const existing=db.prepare('SELECT * FROM teacher_assignments WHERE teacher_user_id=? AND class_name=? AND subject_id=? ORDER BY id').all(teacherId,className,subjectId);
      requireValue(existing.length<=1,'Найдено несколько одинаковых назначений. Требуется сверка.',409);
      before=existing[0]??null;id=before?.id??'assignment-'+randomUUID();
      if(before) db.prepare("UPDATE teacher_assignments SET status='confirmed',updated_at=? WHERE id=?").run(new Date().toISOString(),id);
      else db.prepare("INSERT INTO teacher_assignments(id,teacher_user_id,class_name,subject_id,status,notes) VALUES(?,?,?,?,'confirmed','')").run(id,teacherId,className,subjectId);
    } else if(body.action==='assignment.archive') {
      entity='teacher_assignment';before=db.prepare('SELECT * FROM teacher_assignments WHERE id=?').get(id);
      requireValue(before,'Назначение не найдено',404);
      const inUse=db.prepare("SELECT 1 FROM lessons WHERE teacher_user_id=? AND class_name=? AND subject_id=? AND status NOT IN ('archived','cancelled') UNION ALL SELECT 1 FROM programs WHERE teacher_user_id=? AND class_name=? AND subject_id=? AND status<>'archived' LIMIT 1").get(before.teacher_user_id,before.class_name,before.subject_id,before.teacher_user_id,before.class_name,before.subject_id);
      requireValue(!inUse,'Сначала замените педагога в действующем расписании и программах',409);
      db.prepare("UPDATE teacher_assignments SET status='archived',updated_at=? WHERE id=?").run(new Date().toISOString(),id);
    } else throw new DirectoryError('Неизвестное действие');
    const table={subject:'subjects',class:'school_classes',teacher_assignment:'teacher_assignments'}[entity];
    const after=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    db.prepare('INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?,?)').run('audit-'+randomUUID(),actual.id,'directory.'+body.action,entity,id,JSON.stringify({before,after}));
    const result={id,...directoryState(db)};
    db.exec('COMMIT');return result;
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
