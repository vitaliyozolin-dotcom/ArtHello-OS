// Synthetic data for the disposable hosted finance browser fixture only.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

try {
  assert.equal(process.env.ARTHELLO_FINANCE_CI, 'disposable-hosted-fixture');
  assert.equal(process.env.ARTHELLO_D1_PATH, '/data/d1');
  assert.match(process.env.RELEASE_SHA || '', /^[a-f0-9]{40}$/);
  assert(['seed', 'verify'].includes(process.argv[2]));
  function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(path, e.name)) : e.isFile() && e.name.endsWith('.sqlite') ? [join(path, e.name)] : []); }
  const candidates = files('/data/d1').filter(path => {
    const db = new DatabaseSync(path, { readOnly: true });
    try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='financial_operations'").get()); } finally { db.close(); }
  });
  assert.equal(candidates.length, 1);
  const db = new DatabaseSync(candidates[0]); db.exec('PRAGMA busy_timeout=5000');
  const bankHash = () => createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM bank_transactions ORDER BY id').all())).digest('hex');
  if (process.argv[2] === 'seed') {
    for (const table of ['financial_operations', 'bank_transactions', 'production_auth_credentials', 'production_auth_sessions']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM system_runtime_state WHERE state_key='finance_article_catalog_v1'").get().n, 0);
    const password = readFileSync('/run/secrets/fixture-password', 'utf8').trim();
    const salt = randomBytes(16).toString('base64url');
    const hash = pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('base64url');
    db.prepare(`INSERT INTO production_auth_credentials(user_id,login,display_name,role,password_salt,password_hash,must_change_password,temporary_password_expires_at,failed_attempts,locked_until,updated_at)
      VALUES('AUTH-OWNER','owner','CI fixture','owner',?,?,0,0,0,0,?)`).run(salt, hash, Math.floor(Date.now()/1000));
    db.exec('BEGIN IMMEDIATE');
    const rows = [['1','Поступление',123456,'9999999999','CI обучение'],['2','Списание',78901,'8888888888','CI аренда'],['3','Поступление',20000,'7777777777','CI прочее']];
    for (const [id, direction, amount, inn, purpose] of rows) {
      db.prepare(`INSERT INTO financial_operations(id,operation_date,period,direction,amount_minor,category,report_class,source_system,source_file,source_sheet,source_ref,data_quality,created_by,bank_operation_ref,operation_kind,status)
        VALUES(?,'2026-09-10','2026-09',?,?,'Не классифицировано','Не включено в ОПиУ','BANK_TOCHKA_API','CI fixture','CI fixture',?,'CI fixture','CI fixture',?,'BANK_STATEMENT','Не разнесено')`).run('CI-FIN-'+id,direction,amount,'CI-'+id,'CI-BANK-'+id);
      db.prepare(`INSERT INTO bank_transactions(id,connection_id,legal_entity_id,provider_account_id,provider_statement_id,provider_transaction_id,operation_date,direction,amount_minor,currency,status,description,counterparty_name,counterparty_inn,source_payload_hash,financial_operation_id,imported_at)
        VALUES(?,'CI-CONNECTION','CI-ENTITY','CI-ACCOUNT','CI-STATEMENT',?,'2026-09-10',?,?,'RUB','booked',?,'CI контрагент',?,'CI-SYNTHETIC',?,'2026-09-10T00:00:00Z')`).run('CI-BANK-'+id,'CI-TX-'+id,direction,amount,purpose,inn,'CI-FIN-'+id);
    }
    db.exec('COMMIT');
    writeFileSync('/tmp/finance-ci-bank.sha256', bankHash());
  } else {
    assert.equal(bankHash(), readFileSync('/tmp/finance-ci-bank.sha256','utf8'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n,3);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM bank_transactions b LEFT JOIN financial_operations f ON f.id=b.financial_operation_id WHERE f.id IS NULL OR f.amount_minor<>b.amount_minor OR f.direction<>b.direction`).get().n,0);
    const rows=db.prepare('SELECT id,cashflow_article,pnl_article,accrual_period,report_class,amount_minor FROM financial_operations ORDER BY id').all();
    assert.equal(rows.length,3);
    assert.deepEqual(rows.map(r=>[r.id,r.cashflow_article,r.amount_minor]),[['CI-FIN-1','CI Обучение',123456],['CI-FIN-2','CI Аренда',78901],['CI-FIN-3','',20000]]);
    assert.equal(rows[0].pnl_article,'CI Услуги');assert.equal(rows[0].accrual_period,'2026-09');assert.equal(rows[0].report_class,'Доходы ОПиУ');
    assert.equal(rows[1].report_class,'Не включено в ОПиУ');
    const catalog=JSON.parse(db.prepare("SELECT state_value FROM system_runtime_state WHERE state_key='finance_article_catalog_v1'").get().state_value);
    assert.equal(catalog.articles.length,3);assert.equal(catalog.articles.find(a=>a.name==='CI Обучение').status,'archived');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='finance.operation_classified'").get().n,2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='finance_article_catalog'").get().n,7);
  }
  db.close();console.log('FINANCE_CI_'+process.argv[2].toUpperCase()+'=PASS');
} catch { console.error('FINANCE_CI_FIXTURE=REFUSED');process.exitCode=2; }
