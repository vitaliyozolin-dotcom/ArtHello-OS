import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(), path=join(mkdtempSync(join(tmpdir(),'atlas-http-')),'atlas.sqlite');
const origin='http://127.0.0.1:3117';
const testKey='atlas-test-only-key-not-a-production-secret';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3117'],{cwd:root,env:{...process.env,DATABASE_PATH:path,PUBLIC_APP_ORIGIN:origin,ARTHELLO_PUBLIC_ORIGIN:'https://arthello.example.test',CENTRAL_ACCESS_SECRET:testKey,PASSWORDLESS_PEPPER:testKey},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const read=async (role,q='')=>{const r=await fetch(origin+'/api/school'+q,{headers:{cookie:`atlas_school_session=fixture-${role}`}});return{status:r.status,data:await r.json()};};
const post=async(role,body)=>{const r=await fetch(origin+'/api/school',{method:'POST',headers:{cookie:`atlas_school_session=fixture-${role}`,origin,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
try{
 let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,logs);
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON;');
 for(const t of ['users','students','lessons','school_classes','programs'])assert.equal(db.prepare(`SELECT count(*) n FROM ${t}`).get().n,0,`Atlas starts empty: ${t}`);
 assert.equal(db.prepare("SELECT institution_id FROM diary_identity WHERE id='primary'").get().institution_id,'atlas-school');
 for(const role of ['deputy','teacher','parent','student','admin','methodist']){
  db.prepare('INSERT INTO users(id,email,display_name,role,status,profile_status,auth_version)VALUES(?,?,?,?,?,?,1)').run(role,role+'@example.test',role,role,'active','confirmed');
  db.prepare('INSERT INTO auth_sessions(id,user_id,token_hash,auth_version,expires_at)VALUES(?,?,?,1,?)').run('s-'+role,role,createHash('sha256').update('fixture-'+role).digest('hex'),'2099-01-01T00:00:00Z');
 }
 let r=await read('deputy');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.school.name,'Школа Атлас');assert.equal(r.data.school.academicYear,'');console.log('PASS empty Atlas DB and deputy snapshot');

 const returned=await fetch(origin+'/auth/central/return?next=https://foreign.example.test',{redirect:'manual',headers:{cookie:'atlas_school_session=fixture-deputy'}});
 assert.equal(returned.status,303);assert.equal(returned.headers.get('location'),'https://arthello.example.test/');assert.equal(returned.headers.get('set-cookie'),null);
 const started=await fetch(origin+'/auth/central/start',{redirect:'manual'});assert.equal(started.status,303);const target=new URL(started.headers.get('location'));assert.equal(target.pathname,'/api/atlas-sso/authorize');assert.equal(target.searchParams.get('system_id'),'SYS-SCHOOL-ATLAS');
 const syncBody={systemId:'SYS-SCHOOL-ATLAS',branchId:'BR-ATLAS-SCHOOL',eventId:'atlas-fixture-staff-event',action:'upsert',issuedAt:new Date().toISOString(),actor:'test-owner',user:{centralUserId:'test-atlas-staff',displayName:'Сотрудник проверки',phone:'',email:'atlas-sync@example.test',role:'deputy',status:'active',accessVersion:1,branches:[{id:'BR-ATLAS-SCHOOL',name:'Атлас — школа'}]}};
 async function sync(payload){const body=JSON.stringify(payload), timestamp=String(Math.floor(Date.now()/1000));const response=await fetch(origin+'/api/internal/staff-sync',{method:'POST',headers:{'content-type':'application/json','x-arthello-timestamp':timestamp,'x-arthello-signature':createHmac('sha256',testKey).update(timestamp+'.'+body).digest('hex')},body});return {status:response.status,data:await response.json()};}
 for(const wrong of [{...syncBody,systemId:'SYS-SCHOOL-1-11'},{...syncBody,branchId:'BR-KINDERGARTEN'}])assert.notEqual((await sync(wrong)).status,200);
 r=await sync(syncBody);assert.equal(r.status,200,JSON.stringify(r));assert.equal((await sync(syncBody)).status,200);
 r=await sync({...syncBody,eventId:'atlas-fixture-staff-block',action:'block',user:{...syncBody.user,accessVersion:2}});assert.equal(r.status,200,JSON.stringify(r));assert.equal(db.prepare("SELECT status FROM users WHERE central_user_id='test-atlas-staff'").get().status,'blocked');
 console.log('PASS Atlas return and SSO start, signed staff scope isolation, idempotence and blocking');
 const config={action:'calendar.configure',id:'2026/27',startsOn:'2026-09-01',endsOn:'2027-05-31',periods:[{title:'Каникулы',startsOn:'2026-10-26',endsOn:'2026-11-01'}]};
 for(const role of ['parent','teacher','admin','methodist'])assert.equal((await post(role,config)).status,403,role+' calendar forbidden');
 r=await post('deputy',config);assert.equal(r.status,200,JSON.stringify(r));console.log('PASS calendar: deputy edits; parent, teacher, admin, methodist denied');
 r=await post('deputy',{action:'subject.upsert',name:'Математика'});assert.equal(r.status,200,JSON.stringify(r));
 const sub=db.prepare('SELECT id FROM subjects').get().id;
 db.exec("INSERT INTO school_classes(id,name,grade)VALUES('c3','3А',3),('c4','4А',4);INSERT INTO students(id,first_name,last_name,class_name)VALUES('child','Тест','Первый','3А'),('other-child','Тест','Другой','4А');");
 db.prepare("INSERT INTO teacher_assignments(id,teacher_user_id,class_name,subject_id,status)VALUES('ta','teacher','3А',?,'confirmed')").run(sub);
 db.exec("UPDATE users SET linked_student_id='child' WHERE id IN ('parent','student')");
 const lesson={action:'lesson.upsert',className:'3А',weekday:1,startsAt:'09:00',endsAt:'09:40',subjectId:sub,teacherId:'teacher',room:'1',status:'scheduled',note:''};
 r=await post('deputy',lesson);assert.equal(r.status,200,JSON.stringify(r));const lid=db.prepare('SELECT id FROM lessons').get().id;
 assert.notEqual((await post('parent',lesson)).status,200);assert.notEqual((await post('teacher',lesson)).status,200);
 r=await post('deputy',{...lesson,startsAt:'09:20',endsAt:'10:00'});assert.notEqual(r.status,200,'schedule conflict rejected');console.log('PASS schedule editing and conflict guard');
 const mark={action:'attendance.mark',lessonId:lid,studentId:'child',lessonDate:'2026-09-07',status:'present',note:'',version:0};
 r=await post('teacher',mark);assert.equal(r.status,200,JSON.stringify(r));
 assert.equal((await post('teacher',mark)).status,409,'stale version');
 assert.notEqual((await post('teacher',{...mark,studentId:'other-child'})).status,200,'other class');
 assert.notEqual((await post('parent',{...mark,version:1})).status,200,'parent writes');
 assert.notEqual((await post('teacher',{...mark,lessonDate:'2026-09-08'})).status,200,'wrong weekday');
 r=await post('teacher',{...mark,status:'absent',version:1});assert.equal(r.status,200,JSON.stringify(r));
 r=await read('teacher');assert.equal(r.data.attendance[0].version,2);assert.equal(r.data.attendance[0].lessonDate,'2026-09-07');console.log('PASS attendance: teacher scope, date, conflict revision');
 r=await read('deputy','?preview=parent&student=child');assert.equal(r.status,200);assert.equal(r.data.attendance[0].lessonDate,'2026-09-07');assert.ok(!('users'in r.data));assert.ok(!('messages'in r.data));assert.equal((await read('teacher','?preview=parent&student=child')).status,403);console.log('PASS parent academic preview');
 const ExcelJS=(await import('exceljs')).default;
 const wb=new ExcelJS.Workbook();wb.addWorksheet('КТП').addRows([['№','Тема урока','Кол-во часов','Домашнее задание'],[1,'Тема первая',1,'Задание 1'],[2,'Тема вторая',1,'Задание 2']]);
 const form=new FormData();form.set('action','program.import');form.set('className','3А');form.set('subjectId',sub);form.set('teacherUserId','teacher');form.set('title','Учебная программа Атласа');form.set('file',new Blob([await wb.xlsx.writeBuffer()]),'atlas-ktp.xlsx');
 const imported=await fetch(origin+'/api/school',{method:'POST',headers:{cookie:'atlas_school_session=fixture-deputy',origin},body:form});r={status:imported.status,data:await imported.json()};assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.importSummary.scheduledHours,2);assert.equal(db.prepare('SELECT count(*) n FROM homework').get().n,0);assert.notEqual((await post('deputy',config)).status,200,'calendar locked after KTP');console.log('PASS XLSX KTP distributed; homework not auto-published; calendar locked');

 const program=db.prepare('SELECT id FROM programs').get();
 for(const status of ['review','approved','active']){
   r=await post('deputy',{action:'program.upsert',programId:program.id,className:'3А',subjectId:sub,teacherUserId:'teacher',title:'Учебная программа Атласа',plannedLessons:2,status});
   assert.equal(r.status,200,JSON.stringify(r));
 }
 const session=db.prepare('SELECT id FROM program_topic_sessions ORDER BY scheduled_date LIMIT 1').get();
 r=await post('teacher',{action:'program.topic.update',sessionId:session.id,topic:'Тема первая',homework:'Задание для семьи',homeworkDueAt:'2026-09-08T18:00'});assert.equal(r.status,200,JSON.stringify(r));
 for(const [id,visibility,body]of [['public','parent','Для семьи'],['private','staff','ВНУТРЕННЯЯ ЗАМЕТКА']])db.prepare("INSERT INTO teacher_comments(id,student_id,teacher_user_id,subject_id,body,visibility,comment_date)VALUES(?,'child','teacher',?,?,?,'2026-09-07')").run(id,sub,body,visibility);
 for(const [id,audience]of [['all','all'],['staff','teacher'],['ownclass','class:3А'],['otherclass','class:4А']])db.prepare("INSERT INTO events(id,title,description,starts_at,location,audience)VALUES(?,?,'test','2026-09-10T12:00','test',?)").run(id,id,audience);
 r=await read('parent','?class=4А');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.homework.length,1);assert.equal(r.data.homework[0].description,'Задание для семьи');assert.deepEqual(r.data.comments.map(x=>x.id),['public']);assert.deepEqual(r.data.events.map(x=>x.id).sort(),['all','ownclass']);
 console.log('PASS teacher publishes approved KTP homework; parent sees own class, published feedback, intended events');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();console.log('ALL ATLAS HTTP SCENARIOS PASSED');
}catch(e){console.error(e);console.error(logs.slice(-3000));process.exitCode=1;}finally{child.kill('SIGTERM');}
