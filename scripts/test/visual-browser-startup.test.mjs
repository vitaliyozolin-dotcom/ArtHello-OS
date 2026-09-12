import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { startVisualChrome } from '../lib/visual-browser-startup.mjs';

// Real child processes and loopback sockets; no Chrome installation needed here.
// The unchanged browser/visual gate is also executed with real Chrome in hosted CI.
const worker = `import fs from 'node:fs'; import http from 'node:http'; import {spawn} from 'node:child_process';
const [scenario, root] = process.argv.slice(2);
const flag = name => process.argv.find(x => x.startsWith(name+'=')).slice(name.length+1);
const profile=flag('--user-data-dir'), requested=Number(flag('--remote-debugging-port'));
const log=root+'/children.jsonl'; const attempt=fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\\n').length+1:1;
fs.appendFileSync(log,JSON.stringify({pid:process.pid,profile,attempt})+'\\n');
process.stderr.write('synthetic-private-startup-sentinel\\n');
if(scenario==='writer') {
 const program="const fs=require('node:fs');const p=process.argv[1];process.on('SIGTERM',()=>{});setInterval(()=>{fs.mkdirSync(p+'/Default',{recursive:true});fs.writeFileSync(p+'/Default/active','fixture')},5);";
 spawn(process.execPath,['-e',program,profile],{stdio:'ignore'});
}
if(scenario==='exit'||(scenario==='recover'&&attempt===1)) process.exit(3);
if(scenario==='silent') setInterval(()=>{},1000);
else setTimeout(()=>{
 const id='/devtools/browser/00000000-0000-0000-0000-000000000001';
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://127.0.0.1:'+server.address().port+id+(scenario==='wrong-identity'?'x':'')}));});
 server.listen(requested,'127.0.0.1',()=>{const port=server.address().port;
  if(requested===0)fs.writeFileSync(profile+'/DevToolsActivePort',port+'\\n'+id+'\\n');
  process.stderr.write('DevTools listening on ws://127.0.0.1:'+port+id+'\\n');
 });
},scenario==='delayed'?150:0);
`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-startup-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'child.mjs'); await fs.writeFile(script, worker);
  const start = (scenario, options={}) => startVisualChrome(process.execPath,
    { out: root, prefix: [script, scenario, root], timeoutMs: 1000, ...options });
  const receipt = async () => JSON.parse(await fs.readFile(path.join(root, 'browser-startup.json'), 'utf8'));
  const cleaned = async (count) => {
    const rows = (await fs.readFile(path.join(root, 'children.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, count);
    for (const row of rows) {
      assert.throws(() => process.kill(row.pid, 0), { code: 'ESRCH' });
      await assert.rejects(fs.stat(row.profile), { code: 'ENOENT' });
    }
    assert.doesNotMatch(JSON.stringify(await receipt()), /synthetic-private-startup-sentinel/);
  };
  return { start, receipt, cleaned, root };
}

test('delayed owned endpoint becomes ready and its process/profile are cleaned', async t => {
  const f=await fixture(t), browser=await f.start('delayed');
  assert.ok(browser.port>0); assert.equal((await f.receipt()).result,'ready');
  assert.equal((await f.receipt()).attempts.length,1);
  await browser.close(); await browser.close(); await f.cleaned(1);
});
test('one failed process startup can recover before any navigation', async t => {
  const f=await fixture(t), browser=await f.start('recover');
  const r=await f.receipt();assert.deepEqual(r.attempts.map(x=>x.reason),['CHROME_EXIT','OWNED_CDP_READY']);
  await browser.close();await f.cleaned(2);
});
test('two failed starts refuse with fixed reason and clean both owned profiles', async t => {
  const f=await fixture(t);await assert.rejects(f.start('exit'),{message:'CHROME_EXIT'});
  assert.equal((await f.receipt()).result,'blocked');await f.cleaned(2);
});
test('missing readiness is bounded and does not fabricate visual acceptance', async t => {
  // Coverage instrumentation on Node 24 can spend more than 250 ms starting a
  // fresh child. Keep the refusal bounded while allowing both attempts to
  // actually reach the synthetic worker before cleanup is asserted.
  const f=await fixture(t);await assert.rejects(f.start('silent',{timeoutMs:750}),{message:'CDP_NOT_READY'});
  const r=await f.receipt();assert.equal(r.result,'blocked');assert.equal(r.attempts.length,2);
  await f.cleaned(2);
});
test('another debugger identity is refused immediately without retry', async t => {
  const f=await fixture(t);await assert.rejects(f.start('wrong-identity'),{message:'CDP_IDENTITY'});
  assert.equal((await f.receipt()).attempts.length,1);await f.cleaned(1);
});
test('an explicit port still requires the endpoint reported by this child', async t => {
  const f=await fixture(t), server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port;await new Promise(r=>server.close(r));
  const browser=await f.start('ready',{port});assert.equal(browser.port,port);
  await browser.close();await f.cleaned(1);
});
test('invalid bounds fail before process creation', async t => {
  const f=await fixture(t);
  for(const options of [{port:-1},{port:65536},{timeoutMs:0},{timeoutMs:30001}])
    await assert.rejects(f.start('ready',options),{message:'BROWSER_STARTUP_BOUNDS'});
  await assert.rejects(fs.stat(path.join(f.root,'children.jsonl')),{code:'ENOENT'});
});
test('a renderer that ignores TERM cannot race profile cleanup or keep writing afterwards', async t => {
  const f=await fixture(t), browser=await f.start('writer');
  await browser.close();await f.cleaned(1);
  await new Promise(r=>setTimeout(r,150));await f.cleaned(1);
  assert.equal((await f.receipt()).attempts[0].cleanup,'removed');
});
