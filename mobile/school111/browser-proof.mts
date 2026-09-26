import {chromium,expect} from '@playwright/test';
import {fixture} from './tests/fixture.ts';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const results:any[]=[];const errors:string[]=[];let expired=false,empty=false,failSend=false;let additions:any[]=[];let calls=0,writes=0;
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://school-188-225-38-55.sslip.io/**',async route=>{
 const req=route.request(),url=new URL(req.url());calls++;
 const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:8787','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type,Cache-Control','Content-Type':'application/json'};
 const send=(status:number,data:unknown)=>route.fulfill({status,headers,body:JSON.stringify(data)});
 if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
 if(url.pathname==='/api/auth/login'){expired=false;return req.postDataJSON().password==='bad'?send(401,{error:'Неверный логин или пароль'}):send(200,{ok:true});}
 if(url.pathname==='/api/auth/logout')return send(200,{ok:true});
 if(url.pathname==='/api/school'&&req.method()==='GET'){if(expired)return send(401,{error:'Войдите, чтобы открыть дневник'});const s=fixture(url.searchParams.get('student')||'demo-1');s.messages.push(...additions);if(empty){s.students=[];s.selectedStudent=null;s.lessons=[];s.grades=[];s.homework=[];}return send(200,s);}
 if(url.pathname==='/api/school'&&req.method()==='POST'){writes++;const b=req.postDataJSON();if(b.action==='message.send'){if(failSend)return route.abort('failed');additions.push({id:'sent-'+writes,threadId:b.threadId,authorUserId:'demo-parent',authorName:'Родитель · пример',authorRole:'parent',body:b.body,readAt:null,createdAt:new Date().toISOString()});}return send(200,{ok:true,id:'write-'+writes});}
 return send(404,{error:'MOCK_ROUTE_NOT_DEFINED'});
});
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();results.push({name,status:'PASS'});console.log('PASS',name);};
const shot=(name:string)=>page.screenshot({path:`preview/${name}.png`,fullPage:false});
try{
 await page.goto('http://127.0.0.1:8787');await expect(page.getByTestId('login-submit')).toBeVisible();await shot('01-login-390');
 await check('rejected-login',async()=>{await page.getByTestId('login-identifier').fill('parent@example.invalid');await page.getByTestId('login-password').fill('bad');await page.getByTestId('login-submit').click();await expect(page.getByText('Неверный логин или пароль',{exact:true})).toBeVisible();});
 await check('parent-login',async()=>{await page.getByTestId('login-password').fill('ExamplePassword123');await page.getByTestId('login-submit').click();await expect(page.getByRole('button',{name:'Выбрать ребёнка'})).toContainText('Артём Примеров');});await shot('02-home-390');
 await check('schedule',async()=>{await page.getByTestId('tab-schedule').click();await expect(page.getByText(/Недельное расписание школы/)).toBeVisible();});await shot('03-schedule-390');
 await check('homework-detail',async()=>{await page.getByTestId('tab-homework').click();await page.getByRole('button',{name:'Математика. Закрепляем умножение'}).click();await expect(page.getByRole('button',{name:'Поделиться заданием'})).toBeVisible();await page.getByRole('button',{name:'Закрыть',exact:true}).click();});await shot('04-homework-390');
 await check('grades',async()=>{await page.getByTestId('tab-grades').click();await expect(page.getByText('4,8',{exact:true})).toBeVisible();});await shot('05-grades-390');
 await check('parent-permissions',async()=>{await page.getByTestId('tab-more').click();await expect(page.getByRole('button',{name:'Ученики и классы',exact:true})).toHaveCount(0);});await shot('06-more-390');
 await check('message-failure-preserves-draft',async()=>{await page.getByRole('button',{name:'Сообщения',exact:true}).click();await page.getByRole('button',{name:'Классный руководитель',exact:true}).click();await page.getByLabel('Сообщение учителю или семье').fill('Тестовое сообщение');failSend=true;await page.getByRole('button',{name:'Отправить',exact:true}).click();await expect(page.getByText(/Не получено подтверждение/)).toBeVisible();await expect(page.getByLabel('Сообщение учителю или семье')).toHaveValue('Тестовое сообщение');});
 await check('message-confirmed',async()=>{failSend=false;await page.getByRole('button',{name:'Отправить',exact:true}).click();await expect(page.getByText('Тестовое сообщение',{exact:true})).toBeVisible();await expect(page.getByLabel('Сообщение учителю или семье')).toHaveValue('');});await shot('07-messages-390');await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await check('child-switch',async()=>{await page.getByRole('button',{name:'Выбрать ребёнка'}).click();await page.getByRole('button',{name:'Мария Примерова · 5',exact:true}).click();await expect(page.getByRole('button',{name:'Выбрать ребёнка'})).toContainText('Мария Примерова');});
 await page.getByTestId('tab-more').click();await page.getByRole('button',{name:'Питание',exact:true}).click();await expect(page.getByText('Овсяная каша, фрукт и чай',{exact:true})).toBeVisible();await shot('08-meals-390');
 await page.getByTestId('tab-more').click();await page.getByRole('button',{name:'Профиль',exact:true}).click();await expect(page.getByText('Демонстрационный родитель',{exact:true})).toBeVisible();await shot('09-profile-390');
 await check('no-horizontal-page-overflow',async()=>{for(const width of [320,390,430,768]){await page.setViewportSize({width,height:width===768?1024:844});await page.getByTestId('tab-home').click();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();await shot(`10-home-${width}`);}});
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await shot('11-home-dark-390');await page.emulateMedia({colorScheme:'light'});
 await check('expired-session-clears-diary',async()=>{expired=true;await page.getByRole('button',{name:'Выбрать ребёнка'}).click();await page.getByRole('button',{name:'Артём Примеров · 3',exact:true}).click();await expect(page.getByTestId('login-submit')).toBeVisible();await expect(page.getByTestId('tab-home')).toHaveCount(0);});
 await check('empty-family-state',async()=>{empty=true;await page.getByTestId('login-identifier').fill('parent@example.invalid');await page.getByTestId('login-password').fill('ExamplePassword123');await page.getByTestId('login-submit').click();await expect(page.getByText('Ученик пока не привязан',{exact:true})).toBeVisible();});await shot('12-empty-family-390');
 await check('no-runtime-errors',async()=>expect(errors).toEqual([]));
}catch(e){results.push({name:'unfinished-browser-check',status:'FAIL',error:String(e)});await shot('failure');throw e;}finally{
 fs.writeFileSync('proof/browser-tests.json',JSON.stringify({kind:'React Native Web UI, not iOS device tests',fictionalDataOnly:true,realApiRequests:0,calls,writes,results,errors},null,2));await browser.close();
}
