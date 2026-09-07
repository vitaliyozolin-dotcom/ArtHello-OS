import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { acquireTochkaStatementState, TochkaStatementStateChanged, tochkaStatementLeaseGuardSql } from '../lib/tochka-statement-state.ts';
import { syncTochkaReadOnly, toTochkaFinancialOperation } from '../lib/integrations.ts';
import { patchTochkaPendingIntegrations, patchTochkaPendingDb, patchTochkaPendingRoute } from '../scripts/patch-tochka-pending-lifecycle.mjs';

const generation = '11111111-1111-4111-8111-111111111111';
const customerCode = '300000092';
const accountIds = ['01','02','03','04'].map(suffix => '40817810802000000008'.slice(0,18)+suffix+'/044525104');
const job = { accountId: accountIds[0], startDate: '2026-09-01', endDate: '2026-09-07' };
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const scope = { connectionId:'INT-T-TOCHKA', legalEntityId:'ORG-1', customerCode, credentialGeneration:generation,
    credentialStateKey:'synthetic-credential-key', setupStateKey:'integration_setup:INT-T-TOCHKA' };
  sqlite.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)').run(scope.setupStateKey,JSON.stringify(scope));
  sqlite.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)').run(scope.credentialStateKey,'synthetic-envelope');
  const db = { prepare(sql) {
    let bindings=[];
    return {
      bind(...values) {bindings=values;return this;},
      async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
      async run() { const result=sqlite.prepare(sql).run(...bindings);return {meta:{changes:Number(result.changes)}};},
    };
  }};
  const setScope = next => sqlite.prepare('UPDATE system_runtime_state SET state_value=? WHERE state_key=?').run(JSON.stringify(next),scope.setupStateKey);
  return {sqlite,db,scope,setScope};
}

test('pending jobs survive a released worker; completed jobs are acknowledged only explicitly', async () => {
  const f=fixture();
  const first=await acquireTochkaStatementState(f.db,f.scope);
  await first.store.put(job,'statement-1');
  assert.equal(await first.store.get(job),'statement-1');
  await first.release();
  const restarted=await acquireTochkaStatementState(f.db,f.scope);
  assert.equal(await restarted.store.get(job),'statement-1');
  await restarted.store.put(job,'statement-1');
  await assert.rejects(restarted.store.put(job,'statement-other'),TochkaStatementStateChanged);
  await restarted.complete([{...job,statementId:'statement-other'}]);
  assert.equal(await restarted.store.get(job),'statement-1');
  await restarted.complete([{...job,statementId:'statement-1'}]);
  assert.equal(await restarted.store.get(job),null);
  await restarted.release();f.sqlite.close();
});

test('an atomic lease admits one concurrent worker, expires safely, and fences the previous owner', async () => {
  const f=fixture();
  const candidates=await Promise.all([acquireTochkaStatementState(f.db,f.scope),acquireTochkaStatementState(f.db,f.scope)]);
  assert.equal(candidates.filter(Boolean).length,1);
  const first=candidates.find(Boolean);
  await first.store.put(job,'statement-1');
  f.sqlite.prepare("UPDATE system_runtime_state SET state_value=json_set(state_value,'$.expiresAtMs',0) WHERE state_key=?").run(first.fence.key);
  const replacement=await acquireTochkaStatementState(f.db,f.scope);
  assert.ok(replacement);
  await assert.rejects(first.assertCurrent(),TochkaStatementStateChanged);
  await assert.rejects(first.store.put(job,'stale-job'),TochkaStatementStateChanged);
  await first.release();
  assert.equal(await replacement.store.get(job),'statement-1');
  // This exact predicate is also appended to every SQL write in the integration commit.
  const probe=f.sqlite.prepare(`SELECT 1 AS allowed WHERE ${tochkaStatementLeaseGuardSql}`);
  assert.equal(probe.get(first.fence.key,first.fence.owner),undefined);
  assert.equal(probe.get(replacement.fence.key,replacement.fence.owner).allowed,1);
  await replacement.release();f.sqlite.close();
});

test('account, period, company and credential generation cannot reuse another pending statement', async () => {
  const f=fixture();let current=await acquireTochkaStatementState(f.db,f.scope);
  await current.store.put(job,'statement-scoped');
  assert.equal(await current.store.get({...job,accountId:accountIds[1]}),null);
  assert.equal(await current.store.get({...job,startDate:'2026-09-02'}),null);
  assert.equal(await current.store.get({...job,endDate:'2026-09-08'}),null);
  for(const change of [{credentialGeneration:'22222222-2222-4222-8222-222222222222'}, {customerCode:'300000093'}, {legalEntityId:'ORG-2'}]) {
    const next={...f.scope,...change};f.setScope(next);
    await assert.rejects(current.store.get(job),TochkaStatementStateChanged);
    await current.release();current=await acquireTochkaStatementState(f.db,next);
    assert.equal(await current.store.get(job),null);
    await current.release();f.setScope(f.scope);current=await acquireTochkaStatementState(f.db,f.scope);
    assert.equal(await current.store.get(job),'statement-scoped');
  }
  f.sqlite.prepare('DELETE FROM system_runtime_state WHERE state_key=?').run(f.scope.credentialStateKey);
  await assert.rejects(current.store.get(job),TochkaStatementStateChanged);
  await current.release();assert.equal(await acquireTochkaStatementState(f.db,f.scope),null);f.sqlite.close();
});

test('malformed stored jobs fail closed without replacing their statement identity', async () => {
  const f=fixture();const state=await acquireTochkaStatementState(f.db,f.scope);
  await state.store.put(job,'statement-1');
  f.sqlite.exec("UPDATE system_runtime_state SET state_value=json_set(state_value,'$.accountId','wrong-account') WHERE state_key LIKE 'tochka-statement-pending:%'");
  await assert.rejects(state.store.get(job),TochkaStatementStateChanged);
  await assert.rejects(state.store.put(job,'../../invalid'),TochkaStatementStateChanged);
  await state.release();f.sqlite.close();
});

function provider({readyDelay=3000, failRead=false, wrongScope=false, terminalStatus='', missingStatus=0, rejectedRows=false}={}) {
  const fixedNow=Date.parse('2026-09-07T10:00:00Z');
  const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=`${enc({alg:'RS256'})}.${enc({exp:Math.floor(fixedNow/1000)+7*86400})}.synthetic-signature`;
  let clock=0,created=0;let accessibleAccounts=accountIds;const jobs=new Map();
  const request=async (input,init={})=>{
    const url=String(input);
    if(url.endsWith('/customers'))return Response.json({Data:{Customer:[{customerCode}]}});
    if(url.endsWith('/accounts'))return Response.json({Data:{Account:accessibleAccounts.map(accountId=>({accountId,customerCode,currency:'RUB',status:'Enabled'}))}});
    if(url.endsWith('/statements')&&init.method==='POST') {
      const statement={...JSON.parse(init.body).Data.Statement,statementId:'statement-'+ ++created,createdAt:clock};jobs.set(statement.statementId,statement);
      return Response.json({Data:{Statement:{...statement,status:'Created'}}});
    }
    if(url.includes('/statements/statement-')) {
      if(missingStatus)return Response.json({error:'synthetic missing statement'},{status:missingStatus});
      if(failRead)return Response.json({error:'synthetic rate limit'}, {status:429});
      const statement=jobs.get(url.split('/').at(-1));const ready=clock-statement.createdAt>=readyDelay;
      return Response.json({Data:{Statement:[{...statement,...(wrongScope?{accountId:accountIds[3]}:{}),status:terminalStatus||(ready?'Ready':'Processing'),
        ...(ready?{startDateBalance:'0',endDateBalance:'1',Transaction:[{transactionId:'tx-'+statement.accountId.slice(0,20),creditDebitIndicator:'Credit',status:'Booked',documentProcessDate:'2026-09-07',Amount:{amount:rejectedRows?'invalid':'1',currency:'RUB'}}]}:{})}]}});
    }
    throw new Error('Unexpected synthetic provider path');
  };
  return {input:{token,customerCode,startDate:'2026-09-01',nowMs:fixedNow,request,wait:async ms=>{clock+=ms;}},
    advance:ms=>{clock+=ms;},created:()=>created,setFailure:value=>{failRead=value;},setAccounts:value=>{accessibleAccounts=value;}};
}

test('four slow statements resume after restart instead of recreating jobs; financial replay stays idempotent', async () => {
  const f=fixture(),bank=provider();let state=await acquireTochkaStatementState(f.db,f.scope);
  const first=await syncTochkaReadOnly({...bank.input,statementState:state.store});
  assert.equal(first.valid,true);assert.equal(first.complete,false);assert.equal(first.statements.length,0);assert.equal(bank.created(),4);
  await state.release();bank.advance(15000);state=await acquireTochkaStatementState(f.db,f.scope);
  const second=await syncTochkaReadOnly({...bank.input,statementState:state.store});
  assert.equal(second.complete,true);assert.equal(second.statements.length,4);assert.equal(second.transactions.length,4);assert.equal(bank.created(),4);
  // Simulate a restart after finance writes but before pending-job acknowledgement.
  const finance=new DatabaseSync(':memory:');finance.exec('CREATE TABLE financial_operations(id TEXT PRIMARY KEY,amount_minor INTEGER)');
  const importFinance=async sync=>{for(const tx of sync.transactions){const op=await toTochkaFinancialOperation(tx,f.scope.legalEntityId);finance.prepare('INSERT INTO financial_operations VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(op.id,op.amountMinor);}};
  await importFinance(second);await state.release();state=await acquireTochkaStatementState(f.db,f.scope);
  const replay=await syncTochkaReadOnly({...bank.input,statementState:state.store});await importFinance(replay);
  assert.equal(bank.created(),4);assert.deepEqual({...finance.prepare('SELECT COUNT(*) AS count,SUM(amount_minor) AS total FROM financial_operations').get()},{count:4,total:400});
  await state.complete(replay.statements);assert.equal(await state.store.get(job),null);
  await state.release();finance.close();f.sqlite.close();
});

test('a transient bank read failure retains the created statement for the next attempt', async () => {
  const f=fixture(),bank=provider({readyDelay:0,failRead:true});let state=await acquireTochkaStatementState(f.db,f.scope);
  const failed=await syncTochkaReadOnly({...bank.input,statementState:state.store});assert.equal(failed.valid,false);assert.equal(bank.created(),1);
  await state.release();bank.setFailure(false);state=await acquireTochkaStatementState(f.db,f.scope);
  const retried=await syncTochkaReadOnly({...bank.input,statementState:state.store});assert.equal(retried.complete,true);assert.equal(bank.created(),4);
  await state.release();f.sqlite.close();
});

test('a mismatched provider account is rejected while its pending request remains available', async () => {
  const f=fixture(),bank=provider({readyDelay:0,wrongScope:true});const state=await acquireTochkaStatementState(f.db,f.scope);
  const sync=await syncTochkaReadOnly({...bank.input,statementState:state.store});assert.equal(sync.valid,false);assert.match(sync.reason,/не соответствует/);
  assert.equal(await state.store.get(job),'statement-1');await state.release();f.sqlite.close();
});

test('terminal failures and disappeared provider jobs are cleared for an explicit retry', async () => {
  for(const failure of [{terminalStatus:'Failed'},{terminalStatus:'Error'},{terminalStatus:'Rejected'},{missingStatus:404},{missingStatus:410}]) {
    const f=fixture(),bank=provider({readyDelay:0,...failure});const state=await acquireTochkaStatementState(f.db,f.scope);
    for(let attempt=1;attempt<=2;attempt++) {
      const sync=await syncTochkaReadOnly({...bank.input,statementState:state.store});assert.equal(sync.valid,false);
      assert.equal(await state.store.get(job),null);assert.equal(bank.created(),attempt);
    }
    await state.release();f.sqlite.close();
  }
});

test('restart after UTC midnight resumes the stored date window before moving to the new day', async () => {
  const f=fixture(),bank=provider();let state=await acquireTochkaStatementState(f.db,f.scope);
  await syncTochkaReadOnly({...bank.input,statementState:state.store});await state.release();bank.advance(15000);
  state=await acquireTochkaStatementState(f.db,f.scope);
  const nextDay='2026-09-08';const endDate=await state.store.resolveEndDate(job.startDate,nextDay,accountIds);assert.equal(endDate,job.endDate);
  const sync=await syncTochkaReadOnly({...bank.input,nowMs:Date.parse(nextDay+'T10:00:00Z'),statementState:state.store});assert.equal(sync.valid,true);assert.equal(sync.complete,false);assert.equal(bank.created(),4);assert.match(sync.reason,/нового дня/);
  assert.equal(sync.statements.length,4);assert.ok(sync.statements.every(statement=>statement.endDate===job.endDate));
  await state.complete(sync.statements);assert.equal(await state.store.resolveEndDate(job.startDate,nextDay,accountIds),nextDay);
  await state.release();f.sqlite.close();
});

test('a pending statement for a disappeared account cannot freeze current accounts on an older day', async () => {
  const f=fixture(),bank=provider({readyDelay:0});const state=await acquireTochkaStatementState(f.db,f.scope);
  await state.store.put(job,'orphaned-statement');
  bank.setAccounts([accountIds[1]]);const nextDay='2026-09-08';
  const sync=await syncTochkaReadOnly({...bank.input,nowMs:Date.parse(nextDay+'T10:00:00Z'),statementState:state.store});
  assert.equal(sync.complete,true);assert.equal(sync.accounts.length,1);assert.equal(sync.statements[0].endDate,nextDay);assert.equal(bank.created(),1);
  // Preserve unprocessed metadata without pretending that the closed account was imported.
  assert.equal(await state.store.get(job),'orphaned-statement');await state.release();f.sqlite.close();
});

test('rejected rows cannot report a complete import or acknowledge a pending statement', async () => {
  const f=fixture(),bank=provider({readyDelay:0,rejectedRows:true});const state=await acquireTochkaStatementState(f.db,f.scope);
  const sync=await syncTochkaReadOnly({...bank.input,statementState:state.store});assert.equal(sync.valid,true);assert.equal(sync.complete,false);
  assert.equal(sync.rejectedCount,4);assert.equal(sync.transactions.length,0);assert.match(sync.reason,/не обработана/);
  assert.equal(await state.store.get(job),'statement-1');
  const route=readFileSync(new URL('../app/api/integration-actions/route.ts',import.meta.url),'utf8');
  assert.match(route,/if \(sync\.rejectedCount === 0\) await statementState\.complete\(sync\.statements\)/);
  await state.release();f.sqlite.close();
});

test('build patch is idempotent and keeps committed writes fenced and pending acknowledgements after commit', () => {
  for (const [path,patch] of [['lib/integrations.ts',patchTochkaPendingIntegrations],['db/index.ts',patchTochkaPendingDb],['app/api/integration-actions/route.ts',patchTochkaPendingRoute]]) {
    const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');assert.equal(patch(source),source);
  }
  const route=readFileSync(new URL('../app/api/integration-actions/route.ts',import.meta.url),'utf8');
  assert.ok(route.indexOf('await statementState.complete(sync.statements)')>route.indexOf('await commitTochkaReadOnlySync(actor, setup, sync, trigger, statementState.fence)'));
  const db=readFileSync(new URL('../db/index.ts',import.meta.url),'utf8');
  assert.match(db,/statementLease \? ` AND \$\{tochkaStatementLeaseGuardSql\}`/);
});
