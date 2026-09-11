import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source=readFileSync(new URL('../../deploy/v52/src/db/index.ts',import.meta.url),'utf8');
function adapter(db, failCreate=false) {
  return {
    prepare(sql) {
      let args=[];
      return {bind(...values){args=values;return this;},
        async all(){return {results:db.prepare(sql).all(...args)};},
        async run(){if(failCreate && sql.startsWith('CREATE UNIQUE INDEX'))throw new Error('synthetic create failure');return {meta:db.prepare(sql).run(...args)};},
      };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results;}
      catch(error){db.exec('ROLLBACK');throw error;}
    },
  };
}
function migrate(db, failCreate=false) {
  const first=source.indexOf('async function ensureTochkaTransactionIdentityIndex(');
  const last=source.indexOf('\nasync function ensureTaskColumns(',first);
  assert.ok(first>=0 && last>first,'real migration must exist in runtime source');
  const code=stripTypeScriptTypes(source.slice(first,last));
  return new Function('env',code+';return ensureTochkaTransactionIdentityIndex;')({DB:adapter(db,failCreate)})();
}
function fixture(index='connection_id,provider_transaction_id') {
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE bank_transactions(id TEXT PRIMARY KEY,connection_id TEXT NOT NULL,provider_account_id TEXT NOT NULL,provider_transaction_id TEXT NOT NULL,amount_minor INTEGER NOT NULL,source_payload_hash TEXT NOT NULL)");
  if(index)db.exec('CREATE UNIQUE INDEX bank_transactions_provider_unique ON bank_transactions('+index+')');
  db.exec("INSERT INTO bank_transactions VALUES('existing','tochka','account-a','tx-1',100,'unchanged-hash')");
  return db;
}
const keys=db=>db.prepare("PRAGMA index_info('bank_transactions_provider_unique')").all().map(row=>row.name);

test('commit failure classification: persists only a fixed reason and clears it after success', async()=>{
  const {runScheduledTochkaSync,runTochkaSyncStage}=await import(new URL('../../deploy/v52/src/lib/tochka-autosync.ts',import.meta.url));
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE system_runtime_state(state_key TEXT PRIMARY KEY,state_value TEXT,updated_at TEXT); CREATE TABLE integration_connections(id TEXT PRIMARY KEY,status TEXT,is_enabled INTEGER,next_sync_at TEXT,updated_at TEXT); INSERT INTO integration_connections VALUES('INT-T-TOCHKA','Работает',1,'','');");
  const setup={connectionId:'INT-T-TOCHKA',authMethod:'JWT',secretStatus:'stored',legalEntityId:'SYNTHETIC',customerCode:'SYNTHETIC',
    credentialGeneration:'11111111-1111-4111-8111-111111111111',startDate:'2026-09-01',syncIntervalMinutes:60,syncMinute:5};
  sqlite.prepare('INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)').run('integration_setup:INT-T-TOCHKA',JSON.stringify(setup));
  const db={prepare(sql){let values=[];return{bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)??null;},async run(){return {meta:sqlite.prepare(sql).run(...values)};}};}};
  const state=()=>JSON.parse(sqlite.prepare("SELECT state_value FROM system_runtime_state WHERE state_key='tochka-autosync:v1:INT-T-TOCHKA'").get().state_value);
  let clock=Date.parse('2026-09-09T12:00:00Z');
  const input={db,setup,connection:{status:'Работает',isEnabled:true,nextSyncAt:''},now:()=>clock};
  const original=new Error('D1_ERROR: UNIQUE constraint failed: bank_transactions.connection_id, bank_transactions.provider_transaction_id: SQLITE_CONSTRAINT');
  original.privatePayload='PRIVATE-BANK-DATA';
  try{
    await runScheduledTochkaSync({...input,run:async observe=>runTochkaSyncStage('sync_commit',async()=>{throw original;},observe)});
    assert.equal(state().failureStage,'sync_commit');assert.equal(state().commitFailureKind,'provider_identity');
    assert.equal(state().nextAt,clock+15*60_000);
    assert.equal(JSON.stringify(state()).includes('PRIVATE'),false);assert.equal(JSON.stringify(state()).includes('D1_ERROR'),false);
    clock=state().nextAt;
    await runScheduledTochkaSync({...input,run:async()=>Response.json({test:{ok:true,complete:true}})});
    assert.equal(state().commitFailureKind,null);assert.equal(state().failureStage,null);assert.equal(state().failures,0);
  }finally{sqlite.close();}
});
test('commit failure classification: bounded local exception causes never emit raw text', async()=>{
  const {classifyTochkaCommitError}=await import(new URL('../../deploy/v52/src/lib/tochka-autosync.ts',import.meta.url));
  for(const [message,kind] of [
    ['D1_TYPE_ERROR: PRIVATE_VALUE','binding_type'],['NOT NULL constraint failed: PRIVATE_COLUMN','required_value'],
    ['no such column: PRIVATE_COLUMN','schema'],['database is locked','database_busy'],['database or disk is full','storage_full'],
    ['too many SQL variables','query_limit'],['PRIVATE_UNKNOWN_ERROR','other'],
  ])assert.equal(classifyTochkaCommitError(new Error('wrapper',{cause:new Error(message)})),kind);
  const cycle=new Error('PRIVATE');cycle.cause=cycle;
  assert.equal(classifyTochkaCommitError(cycle),'other');
  assert.equal(classifyTochkaCommitError(new Error('x'.repeat(5000)+'D1_TYPE_ERROR')),'other');
  assert.equal(classifyTochkaCommitError('D1_TYPE_ERROR: PRIVATE'),'other');
});


test('real bank commit: same provider ID across four accounts imports eight movements and replays without new rows', async()=>{
  const core = await import(new URL('../../deploy/v52/src/lib/integrations.ts',import.meta.url));
  const db=new DatabaseSync(':memory:');
  const tables=['system_runtime_state','integration_connections','integration_sync_runs','integration_log_entries','audit_events','bank_accounts','bank_statement_imports','bank_transactions','financial_operations','entities'];
  for(const table of tables){
    const match=source.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\)\\x60'));
    assert.ok(match,'runtime schema for '+table);db.exec(match[0].slice(0,-1));
  }
  for(const column of [
    "cashflow_article TEXT NOT NULL DEFAULT ''",
    "pnl_article TEXT NOT NULL DEFAULT ''",
    "accrual_period TEXT NOT NULL DEFAULT ''",
  ]) db.exec(`ALTER TABLE financial_operations ADD COLUMN ${column}`);
  db.exec('CREATE UNIQUE INDEX bank_transactions_provider_unique ON bank_transactions(connection_id,provider_transaction_id)');
  const setup={connectionId:'INT-T-TOCHKA',secretStatus:'stored',credentialGeneration:'11111111-1111-4111-8111-111111111111',
    legalEntityId:'SYNTHETIC-ORG',customerCode:'300000092',allocationMode:'classify_transactions',syncIntervalMinutes:60};
  db.prepare("INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)").run('integration_setup:INT-T-TOCHKA',JSON.stringify(setup));
  db.prepare("INSERT INTO system_runtime_state(state_key,state_value) VALUES(?,?)").run('synthetic-credential','{}');
  const required=db.prepare('PRAGMA table_info(integration_connections)').all().filter(column=>!column.dflt_value && column.notnull && column.name!=='id');
  db.prepare('INSERT INTO integration_connections(id,'+required.map(column=>column.name).join(',')+') VALUES(?,'+required.map(()=>'?').join(',')+')')
    .run(setup.connectionId,...required.map(column=>/INTEGER/.test(column.type)?0:'synthetic'));
  const now=Date.parse('2026-09-09T12:00:00Z'),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=encode({alg:'RS256'})+'.'+encode({exp:Math.floor(now/1000)+3600})+'.synthetic';
  const accounts=Array.from({length:4},(_,i)=>'4081781080200000000'+(i+1)+'/044525104');
  const sync=await core.syncTochkaReadOnly({token,customerCode:setup.customerCode,startDate:'2026-09-01',nowMs:now,wait:async()=>{},
    request:async(input,init={})=>{
      const url=String(input);
      if(url.endsWith('/customers'))return Response.json({Data:{Customer:[{customerCode:setup.customerCode}]}});
      if(url.endsWith('/accounts'))return Response.json({Data:{Account:accounts.map(accountId=>({customerCode:setup.customerCode,accountId,currency:'RUB',status:'Enabled'}))}});
      if(init.method==='POST'){const {accountId}=JSON.parse(init.body).Data.Statement;return Response.json({Data:{Statement:{accountId,statementId:'s'+accounts.indexOf(accountId),status:'Created'}}});}
      const i=accounts.findIndex(account=>url.includes(account));
      return Response.json({Data:{Statement:{accountId:accounts[i],statementId:'s'+i,status:'Ready',startDateTime:'2026-09-01',endDateTime:'2026-09-09',
        startDateBalance:'0.00',endDateBalance:'7.00',Transaction:['Credit','Debit'].map((direction,j)=>({
          transactionId:'shared-tx-'+j,creditDebitIndicator:direction,status:'Booked',documentProcessDate:'2026-09-09',
          Amount:{amount:j?'3.00':'10.00',currency:'RUB'},
        }))}}});
    }});
  assert.equal(sync.complete,true);assert.equal(sync.transactions.length,8);
  const first=source.indexOf('export async function commitTochkaReadOnlySync('),last=source.indexOf('\nexport async function hasIntegrationCredential(',first);
  const body=stripTypeScriptTypes(source.slice(first,last)).replace('export async function','async function');
  const driver=adapter(db);
  const prepare=driver.prepare;
  driver.prepare=sql=>{
    const query=prepare(sql);let values=[];
    const bind=query.bind;
    query.bind=(...args)=>{values=args;return bind.apply(query,args);};
    query.first=async()=>db.prepare(sql).get(...values)??null;
    return query;
  };
  const commit=new Function('env','normalizeCredentialGeneration','integrationCredentialStateKey','integrationSetupPrefix','tochkaConnectionId','toTochkaFinancialOperation','loadArticleCatalog','isAutoAllocationCatalogReady','classifyFinanceOperation','FINANCE_ACCOUNTING_START_DATE',
    body+';return commitTochkaReadOnlySync;')({DB:driver},value=>value,()=> 'synthetic-credential','integration_setup:',setup.connectionId,core.toTochkaFinancialOperation,
      async()=>({catalog:{schema:1,revision:1,articles:[]}}),()=>false,()=>null,'2026-09-01');
  try{
    // Reproduce the defect with the formerly deployed index before migration.
    await assert.rejects(commit('SYNTHETIC',setup,sync,'before migration'),/UNIQUE constraint failed/);
    assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,0);
    await migrate(db);
    const imported=await commit('SYNTHETIC',setup,sync,'after migration');
    const replay=await commit('SYNTHETIC',setup,sync,'replay');
    assert.equal(imported.committed,true);assert.equal(imported.financialOperationCount,8);assert.equal(replay.financialOperationCount,0);
    assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,8);
    assert.equal(db.prepare('SELECT count(*) n FROM financial_operations').get().n,8);
    assert.equal(db.prepare("SELECT count(*) n FROM bank_transactions b LEFT JOIN financial_operations f ON f.id=b.financial_operation_id WHERE f.id IS NULL").get().n,0);
    assert.equal(db.prepare("SELECT sum(amount_minor) n FROM financial_operations WHERE direction='Поступление'").get().n,4000);
    assert.equal(db.prepare("SELECT sum(amount_minor) n FROM financial_operations WHERE direction='Списание'").get().n,1200);
  }finally{db.close();}
});

test('identity migration: legacy index keeps every row and permits distinct account movements', async()=>{
  const db=fixture(),before=db.prepare('SELECT * FROM bank_transactions').all();
  try {
    await migrate(db);assert.deepEqual(keys(db),['connection_id','provider_account_id','provider_transaction_id']);
    assert.deepEqual(db.prepare('SELECT * FROM bank_transactions').all(),before);
    db.exec("INSERT INTO bank_transactions VALUES('other-account','tochka','account-b','tx-1',100,'other-hash')");
    assert.throws(()=>db.exec("INSERT INTO bank_transactions VALUES('same-account-duplicate','tochka','account-a','tx-1',100,'other-hash')"),/UNIQUE constraint/);
    await migrate(db);assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,2);
    // R13's older IF NOT EXISTS bootstrap preserves the upgraded definition.
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_provider_unique ON bank_transactions(connection_id,provider_transaction_id)');
    assert.deepEqual(keys(db),['connection_id','provider_account_id','provider_transaction_id']);
  } finally {db.close();}
});
test('identity migration: fresh and already upgraded schemas are idempotent', async()=>{
  for(const index of ['', 'connection_id,provider_account_id,provider_transaction_id']){
    const db=fixture(index);
    try{await migrate(db);await migrate(db);assert.deepEqual(keys(db),['connection_id','provider_account_id','provider_transaction_id']);assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);}
    finally{db.close();}
  }
});
test('identity migration: unknown index definitions refuse without data or schema changes', async()=>{
  for(const index of ['provider_transaction_id,connection_id','connection_id COLLATE NOCASE,provider_transaction_id','connection_id']){
    const db=fixture(index),before=db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    try{
      await assert.rejects(migrate(db),/TOCHKA_IDENTITY_INDEX_UNEXPECTED/);
      assert.deepEqual(db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(),before);
      assert.equal(db.prepare('SELECT count(*) n FROM bank_transactions').get().n,1);
    }finally{db.close();}
  }
});
test('identity migration: failed rebuild rolls back the original uniqueness constraint', async()=>{
  const db=fixture(),before=db.prepare('SELECT * FROM bank_transactions').all();
  try{
    await assert.rejects(migrate(db,true),/synthetic create failure/);
    assert.deepEqual(keys(db),['connection_id','provider_transaction_id']);
    assert.deepEqual(db.prepare('SELECT * FROM bank_transactions').all(),before);
  }finally{db.close();}
});
