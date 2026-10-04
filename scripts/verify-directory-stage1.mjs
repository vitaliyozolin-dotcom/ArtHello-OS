// Isolated acceptance: starts the built application with a new temporary SQLite DB.
// No production URL, database, credentials or external integrations are accepted.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dir=mkdtempSync(join(tmpdir(),'school-stage1-'));
const databasePath=join(dir,'test.sqlite');
const port=3182,origin=`http://127.0.0.1:${port}`;
let server,db,logs='',browser;
const checks=[];
const sessions=new Map();
const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);console.log('PASS '+name);};
async function start(){
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env:{PATH:process.env.PATH,NODE_ENV:'production',DATABASE_PATH:databasePath,PUBLIC_APP_ORIGIN:origin,ARTHELLO_PUBLIC_ORIGIN:'https://central.example.invalid',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
  for(let attempt=0;attempt<80;attempt++){
    try{const r=await fetch(origin+'/api/school');if(r.status===401)return;}catch{}
    if(server.exitCode!==null)throw Error('server stopped: '+logs.slice(-2000));
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('Server did not start: '+logs.slice(-2000));
}
async function stop(){if(!server||server.exitCode!==null)return;const process=server;await new Promise(resolve=>{process.once('exit',resolve);process.kill('SIGTERM');});}
function seedUser(role){
  const id='qa-'+role,token=randomBytes(32).toString('hex');
  db.prepare("INSERT INTO users(id,email,display_name,role,status,profile_status) VALUES(?,?,?,?,'active','confirmed')").run(id,id+'@example.invalid','Тестовый '+role,role);
  db.prepare("INSERT INTO auth_sessions(id,user_id,token_hash,auth_version,expires_at) VALUES(?,?,?,1,datetime('now','+1 hour'))").run('session-'+role,id,createHash('sha256').update(token).digest('hex'));
  sessions.set(role,token);return id;
}
async function request(path,role,body,requestOrigin=origin){
  const headers={};if(role)headers.cookie='school_session='+sessions.get(role);
  if(body){headers['content-type']='application/json';if(requestOrigin)headers.origin=requestOrigin;}
  const response=await fetch(origin+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,redirect:'manual'});
  const payload=await response.json().catch(()=>({}));return {status:response.status,payload,headers:response.headers};
}
try{
  await start();db=new DatabaseSync(databasePath);db.exec('PRAGMA foreign_keys=ON');
  for(const role of ['director','deputy','admin','teacher','parent','student','methodist','tech_admin'])seedUser(role);
  db.exec("INSERT INTO students(id,first_name,last_name,class_name) VALUES('qa-child-1','Первый','Ученик','1'),('qa-child-2','Второй','Ученик','2'); INSERT INTO user_student_links(id,user_id,student_id) VALUES('qa-link','qa-parent','qa-child-2'),('qa-student-link','qa-student','qa-child-2')");
  check('anonymous directory request denied',(await request('/api/directory')).status===403);
  for(const role of ['teacher','parent','student','methodist','tech_admin']){
    check(role+' directory read denied',(await request('/api/directory',role)).status===403);
    check(role+' directory mutation denied',(await request('/api/directory',role,{action:'subject.save'})).status===403);
  }
  for(const role of ['director','deputy','admin'])check(role+' directory available',(await request('/api/directory',role)).status===200);
  let state=(await request('/api/directory','director')).payload;
  const subject={action:'subject.save',id:'math',name:'Математика · проверка сохранения',shortName:'Мат.',stage:'1–6',weeklyHours:4,revision:state.revision};
  check('cross-origin mutation denied',(await request('/api/directory','director',subject,'https://other.invalid')).status===403);
  check('missing-origin mutation denied',(await request('/api/directory','director',subject,null)).status===403);
  const concurrent=await Promise.all([request('/api/directory','director',subject),request('/api/directory','director',{...subject,name:'Конкурирующая правка'})]);
  check('concurrent stale writer rejected',concurrent.map(r=>r.status).sort().join(',')==='200,409');
  const savedName=db.prepare("SELECT name FROM subjects WHERE id='math'").get().name;
  state=(await request('/api/directory','director')).payload;
  check('teacher assignment created',(await request('/api/directory','director',{action:'assignment.save',teacherId:'qa-teacher',className:'1',subjectId:'math',revision:state.revision})).status===200);
  const teacher=(await request('/api/school','teacher')).payload;
  check('teacher only sees assigned class',teacher.classes.length===1 && teacher.classes[0].name==='1');
  check('teacher only sees assigned pupils',teacher.students.length===1 && teacher.students[0].id==='qa-child-1');
  for(const role of ['parent','student']){
    const snapshot=(await request('/api/school',role)).payload;
    check(role+' sees own child only',snapshot.students.length===1&&snapshot.students[0].id==='qa-child-2');
    check(role+' sees own class only',snapshot.classes.length===1&&snapshot.classes[0].name==='2');
  }
  const classId=db.prepare("SELECT id FROM school_classes WHERE name='1'").get().id;
  state=(await request('/api/directory','director')).payload;
  check('homeroom teacher saved',(await request('/api/directory','director',{action:'class.homeroom',id:classId,teacherId:'qa-teacher',revision:state.revision})).status===200);
  const redirect=await request('/api/auth/return-to-arthello?section=access','director');
  check('access action targets central access module',redirect.headers.get('location')?.endsWith('/#access'));
  await stop();await start();
  check('subject edit survives restart',db.prepare("SELECT name FROM subjects WHERE id='math'").get().name===savedName);
  check('homeroom edit survives restart',db.prepare('SELECT homeroom_teacher_user_id FROM school_classes WHERE id=?').get(classId).homeroom_teacher_user_id==='qa-teacher');
  check('assignment survives restart',db.prepare("SELECT count(*) n FROM teacher_assignments WHERE teacher_user_id='qa-teacher' AND status='confirmed'").get().n===1);
  check('database integrity',db.prepare('PRAGMA integrity_check').get().integrity_check==='ok');

  if(process.env.STAGE1_BROWSER_MODULE){
    const {chromium}=await import(process.env.STAGE1_BROWSER_MODULE);
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addCookies([{name:'school_session',value:sessions.get('director'),url:origin}]);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/management?tab=subjects');await page.getByRole('button',{name:'Добавить предмет',exact:true}).waitFor();
    await page.getByRole('button',{name:'Добавить предмет',exact:true}).click();
    await page.getByLabel('Название',{exact:true}).fill('Тестовый предмет');await page.getByLabel('Краткое название').fill('Тест');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Изменения сохранены',{exact:true}).waitFor();
    check('browser creates subject',Boolean(db.prepare("SELECT id FROM subjects WHERE name='Тестовый предмет'").get()));
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:1000});
      check('management fits '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      if(process.env.STAGE1_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.STAGE1_SCREENSHOT_DIR,`stage1-management-${width}.png`),fullPage:true});
    }
    await page.goto(origin+'/');await page.getByRole('link',{name:'Предметы Добавить, изменить, архивировать'}).waitFor();
    await page.getByRole('link',{name:'Предметы Добавить, изменить, архивировать'}).click();await page.getByRole('button',{name:'Добавить предмет',exact:true}).waitFor();
    check('director home opens subject editor',page.url().includes('/management?tab=subjects'));
    check('browser has no runtime errors',errors.length===0);
    await browser.close();browser=null;
  }
  console.log(JSON.stringify({passed:checks.length,browser:!!process.env.STAGE1_BROWSER_MODULE,productionChanged:false}));
}finally{if(browser)await browser.close();await stop();db?.close();rmSync(dir,{recursive:true,force:true});}
