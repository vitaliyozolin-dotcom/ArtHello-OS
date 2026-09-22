// Aggregate read-only audit; never emit pupil, teacher, credential or lesson text.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export function auditDiary(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const count = query => db.prepare(query).get().n;
  if (!['school_classes','students','users','lessons','teacher_assignments'].every(t=>tables.has(t))) throw Error('DIARY_SCHEMA_UNCONFIRMED');
  const result = {
    classes: count("SELECT count(*) n FROM school_classes WHERE status='active'"),
    students: count("SELECT count(*) n FROM students WHERE status='active'"),
    teachers: count("SELECT count(*) n FROM users WHERE role='teacher' AND status='active' AND profile_status NOT IN ('demo','vacant')"),
    teacherProfiles: count("SELECT count(*) n FROM users WHERE role='teacher' AND status IN ('active','setup') AND profile_status NOT IN ('demo','vacant')"),
    teacherProfilesPending: count("SELECT count(*) n FROM users WHERE role='teacher' AND status IN ('active','setup') AND profile_status NOT IN ('confirmed','demo','vacant')"),
    teacherAssignments: count('SELECT count(*) n FROM teacher_assignments'),
    confirmedAssignments: count("SELECT count(*) n FROM teacher_assignments WHERE status='confirmed'"),
    lessons: count("SELECT count(*) n FROM lessons WHERE status NOT IN ('archived','cancelled')"),
    lessonsWithoutTeacher: count("SELECT count(*) n FROM lessons WHERE status NOT IN ('archived','cancelled') AND (teacher_user_id IS NULL OR teacher_user_id='')"),
    lessonsWithInactiveTeacher: count("SELECT count(*) n FROM lessons l LEFT JOIN users u ON u.id=l.teacher_user_id WHERE l.status NOT IN ('archived','cancelled') AND l.teacher_user_id IS NOT NULL AND l.teacher_user_id!='' AND (u.id IS NULL OR u.status NOT IN ('active','setup') OR u.role!='teacher' OR u.profile_status IN ('demo','vacant'))"),
    lessonsWithoutClass: count("SELECT count(*) n FROM lessons l WHERE l.status NOT IN ('archived','cancelled') AND NOT EXISTS(SELECT 1 FROM school_classes c WHERE c.name=l.class_name AND c.status='active')"),
  };
  if(tables.has('central_directory_links')) result.directory=Object.fromEntries(['class','student','teacher','family'].map(kind=>[kind,db.prepare('SELECT count(*) n FROM central_directory_links WHERE kind=? AND active=1').get(kind).n]));
  if(tables.has('schedule_imports')) result.scheduleImports=db.prepare('SELECT source_sha256 AS sha256,lesson_count AS lessons FROM schedule_imports ORDER BY imported_at').all().map(r=>({sha256:/^[a-f0-9]{64}$/.test(r.sha256)?r.sha256:null,lessons:r.lessons}));
  result.history=Object.fromEntries(['grades','homework','attendance','teacher_comments'].filter(t=>tables.has(t)).map(t=>[t,count('SELECT count(*) n FROM '+t)]));
  if(tables.has('program_topic_sessions')) result.sessions=count('SELECT count(*) n FROM program_topic_sessions');
  return result;
}
if(process.argv[1] === '-' || (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)) {
  const path=process.env.DATABASE_PATH;
  if(!['/data/school-1-11.sqlite','/data/atlas-school.sqlite'].includes(path)) throw Error('DIARY_DATABASE_UNCONFIRMED');
  const db=new DatabaseSync(path,{readOnly:true});
  try { console.log('DIARY_DATA_AUDIT='+JSON.stringify(auditDiary(db))); } finally { db.close(); }
}
