import https from 'node:https';
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fixture} from './tests/fixture.ts';
// CI-only HTTPS server. No production credentials, data or external traffic.
const sessions = new Set<string>();
let empty = false;
const stats = {loginRejected:0, loginAccepted:0, authenticatedReads:0, unauthenticatedDenied:0, forbiddenChildDenied:0, logout:0, cookiesObserved:false};
const server = https.createServer({key:fs.readFileSync('ci/tls/key.pem'),cert:fs.readFileSync('ci/tls/cert.pem')}, async (req,res)=>{
 const url = new URL(req.url || '/', 'https://localhost:8843');
 const send=(code:number,data:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(url.pathname.startsWith('/test/')) {
   const action=url.pathname.slice(6);
   if(action==='reset'){sessions.clear();empty=false;for(const key of Object.keys(stats)) (stats as any)[key]=key==='cookiesObserved'?false:0;}
   if(action==='expire')sessions.clear();
   if(action==='empty'){sessions.clear();empty=true;}
   fs.writeFileSync('proof/native-fixture-stats.json',JSON.stringify({...stats,fictionalDataOnly:true,productionWrites:0},null,2));
   return send(200,{...stats,fictionalDataOnly:true});
 }
 const chunks:Buffer[]=[];let bytes=0;
 for await(const part of req){bytes+=part.length;if(bytes>16384)return send(413,{error:'Too large'});chunks.push(part);}
 let body:any={};try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{return send(400,{error:'Invalid JSON'});}
 if(url.pathname==='/api/auth/login'){
   if(body.login!=='parent@example.invalid'||body.password!=='ExamplePassword123'){stats.loginRejected++;return send(401,{error:'Неверный логин или пароль'});}
   const token=randomBytes(32).toString('base64url');sessions.add(token);stats.loginAccepted++;
   res.setHeader('Set-Cookie',`school_session=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`);
   return send(200,{ok:true});
 }
 const token=/(?:^|;\s*)school_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie||'')?.[1]||'';
 if(token)stats.cookiesObserved=true;
 if(url.pathname==='/api/auth/logout'){sessions.delete(token);stats.logout++;res.setHeader('Set-Cookie','school_session=; Path=/; Secure; HttpOnly; Max-Age=0');return send(200,{ok:true});}
 if(!sessions.has(token)){stats.unauthenticatedDenied++;return send(401,{error:'Войдите в дневник заново'});}
 if(url.pathname==='/api/school'&&req.method==='GET'){
   const student=url.searchParams.get('student')||'demo-1';
   if(!['demo-1','demo-2'].includes(student)){stats.forbiddenChildDenied++;return send(403,{error:'Нет доступа к ученику'});}
   stats.authenticatedReads++;const s=fixture(student);
   if(empty){s.students=[];s.selectedStudent=null;s.lessons=[];s.grades=[];s.homework=[];s.comments=[];s.messages=[];s.threads=[];}
   return send(200,s);
 }
 if(url.pathname==='/api/school'&&req.method==='POST'&&body.action==='thread.view')return send(200,{ok:true});
 return send(404,{error:'Маршрут тестового сервера не определён'});
});
server.listen(8843,'::',()=>console.log('CI-only fixture HTTPS server listening, secrets omitted'));
