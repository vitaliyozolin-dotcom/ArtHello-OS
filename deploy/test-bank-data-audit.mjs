import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { auditBank } from './bank-data-audit.mjs';

test('bank audit reconciles stored facts, identities and source links without changing rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE bank_accounts(id TEXT,balance_minor INTEGER,balance_as_of TEXT,synced_at TEXT);
  CREATE TABLE bank_transactions(id TEXT,provider_account_id TEXT,provider_transaction_id TEXT,payment_id TEXT,operation_date TEXT,direction TEXT,amount_minor INTEGER,currency TEXT,status TEXT,financial_operation_id TEXT);
  CREATE TABLE financial_operations(id TEXT,amount_minor INTEGER,direction TEXT,operation_date TEXT,bank_operation_ref TEXT,source_system TEXT,cashflow_article TEXT,report_class TEXT,status TEXT);
  CREATE TABLE integration_connections(id TEXT,last_success_at TEXT,next_sync_at TEXT,is_enabled INTEGER,status TEXT);
  CREATE TABLE system_runtime_state(state_key TEXT,state_value TEXT);
  INSERT INTO bank_accounts VALUES ('private-account',NULL,'','2026-09-26T00:00:00Z');
  INSERT INTO bank_transactions VALUES ('a','private-account','DERIVED-a','same-payment','2026-09-01','Поступление',101,'RUB','Booked','f');
  INSERT INTO bank_transactions VALUES ('b','private-account','DERIVED-b','same-payment','2026-09-01','Поступление',102,'RUB','Booked','missing');
  INSERT INTO bank_transactions VALUES ('c','private-account','real-id','','2026-09-01','Поступление',999,'RUB','Pending','');
  INSERT INTO financial_operations VALUES ('f',100,'Поступление','2026-09-01','a','BANK_TOCHKA_API','','Доходы ОПиУ','Разнесено автоматически');
  INSERT INTO integration_connections VALUES ('INT-T-TOCHKA','2026-09-26T00:00:00Z','2026-09-26T01:00:00Z',1,'Работает');
  INSERT INTO system_runtime_state VALUES ('integration_setup:INT-T-TOCHKA','{"syncIntervalMinutes":60,"startDate":"2026-09-01","secret":"NEVER_EMIT"}');`);
  const before = db.prepare('SELECT total_changes() n').get().n;
  const result = auditBank(db);
  assert.equal(result.accounts.unknownBalances,1);
  assert.equal(result.transactions.derivedIds,2);
  assert.equal(result.transactions.repeatedPaymentKeys,1);
  assert.equal(result.links.missingFinancialRows,1);
  assert.equal(result.links.amountMismatchRows,1);
  assert.equal(result.links.absoluteDifferenceMinor,1);
  assert.equal(result.months[0].bookedIncomingMinor,203);
  assert.equal(result.scheduler.intervalMinutes,60);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
  for(const privateText of ['private-account','same-payment','NEVER_EMIT']) assert.ok(!JSON.stringify(result).includes(privateText));
  db.close();
});

test('an absent bank schema is unconfirmed, never an empty successful audit', () => {
  const db = new DatabaseSync(':memory:');
  assert.throws(() => auditBank(db));
  db.close();
});
