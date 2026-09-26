// Read-only stored bank evidence. Never emit identities, purposes or credentials.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[0-9:.]+Z)?$/.test(value) ? value : null;
export function auditBank(db) {
  const one = sql => ({ ...db.prepare(sql).get() });
  const setup = db.prepare("SELECT json_extract(state_value,'$.syncIntervalMinutes') intervalMinutes,json_extract(state_value,'$.startDate') startDate FROM system_runtime_state WHERE state_key='integration_setup:INT-T-TOCHKA'").get();
  const timer = db.prepare("SELECT json_extract(state_value,'$.nextAt') nextAt,json_extract(state_value,'$.failures') failures,json_extract(state_value,'$.outcome') outcome FROM system_runtime_state WHERE state_key='tochka-autosync:v1:INT-T-TOCHKA'").get();
  const connection = db.prepare("SELECT last_success_at,next_sync_at,is_enabled FROM integration_connections WHERE id='INT-T-TOCHKA'").get();
  return {
    observedAt: new Date().toISOString(), source: 'stored-bank-observations', businessDataChanged: false,
    accounts: one(`SELECT count(*) count, count(*)-count(balance_minor) unknownBalances,
      min(NULLIF(balance_as_of,'')) oldestBalanceDate,max(NULLIF(balance_as_of,'')) newestBalanceDate FROM bank_accounts`),
    transactions: {
      ...one(`SELECT count(*) count,COALESCE(sum(provider_transaction_id LIKE 'DERIVED-%'),0) derivedIds,
        COALESCE(sum(payment_id=''),0) missingPaymentIds,COALESCE(sum(lower(status)!='booked'),0) nonBooked FROM bank_transactions`),
      ...one(`SELECT count(*) repeatedPaymentKeys FROM (SELECT provider_account_id,payment_id,direction FROM bank_transactions
        WHERE payment_id!='' GROUP BY provider_account_id,payment_id,direction HAVING count(*)>1)`),
    },
    links: one(`SELECT count(*) eligibleBankRows,
      COALESCE(sum(f.id IS NULL),0) missingFinancialRows,
      COALESCE(sum(f.id IS NOT NULL AND b.amount_minor!=f.amount_minor),0) amountMismatchRows,
      COALESCE(sum(CASE WHEN f.id IS NOT NULL THEN abs(b.amount_minor-f.amount_minor) ELSE 0 END),0) absoluteDifferenceMinor,
      COALESCE(sum(f.id IS NOT NULL AND (b.direction!=f.direction OR b.operation_date!=f.operation_date)),0) fieldMismatchRows
      FROM bank_transactions b LEFT JOIN financial_operations f ON f.id=b.financial_operation_id
      WHERE b.currency='RUB' AND lower(b.status)='booked' AND b.operation_date>='2026-09-01'`),
    relationships: {
      ...one(`SELECT count(*) sharedFinancialLinks FROM (SELECT financial_operation_id FROM bank_transactions WHERE financial_operation_id!='' GROUP BY financial_operation_id HAVING count(*)>1)`),
      ...one(`SELECT count(*) orphanedFinancialRows FROM financial_operations f WHERE f.source_system='BANK_TOCHKA_API' AND NOT EXISTS(SELECT 1 FROM bank_transactions b WHERE b.financial_operation_id=f.id)`),
    },
    months: db.prepare(`SELECT substr(operation_date,1,7) month,count(*) rows,
      COALESCE(sum(CASE WHEN lower(status)='booked' AND direction='Поступление' THEN amount_minor ELSE 0 END),0) bookedIncomingMinor,
      COALESCE(sum(CASE WHEN lower(status)='booked' AND direction='Списание' THEN amount_minor ELSE 0 END),0) bookedOutgoingMinor
      FROM bank_transactions WHERE currency='RUB' GROUP BY substr(operation_date,1,7) ORDER BY month`).all(),
    classification: one(`SELECT count(*) bankProjectedRows,
      COALESCE(sum(cashflow_article=''),0) noCashflowArticle,
      COALESCE(sum(status='Разнесено автоматически' AND report_class IN ('Доходы ОПиУ','Расходы ОПиУ')),0) historicalAutomaticPnl
      FROM financial_operations WHERE source_system='BANK_TOCHKA_API'`),
    scheduler: { configured: Boolean(setup), intervalMinutes: [60,180,360,1440].includes(setup?.intervalMinutes) ? setup.intervalMinutes : null,
      startDate: iso(setup?.startDate), enabled: connection ? connection.is_enabled === 1 : null,
      lastSuccessfulAt: iso(connection?.last_success_at), nextScheduledAt: iso(connection?.next_sync_at),
      timerNextAt: Number.isSafeInteger(timer?.nextAt) && timer.nextAt>0 && timer.nextAt<8640000000000000 ? new Date(timer.nextAt).toISOString() : null,
      consecutiveFailures: Number.isSafeInteger(timer?.failures) && timer.failures>=0 ? timer.failures : null,
      outcome: ['complete','pending','busy','error'].includes(timer?.outcome) ? timer.outcome : null },
  };
}
if(process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  let db;
  try {
    db = new DatabaseSync('/data/d1/miniflare-D1DatabaseObject/5a499c55f63d6b9f725547d510cf454e288954b6f3c2d5024eb1443f29c97730.sqlite',{readOnly:true});
    db.exec('PRAGMA query_only=ON; BEGIN');
    console.log('BANK_DATA_AUDIT='+JSON.stringify(auditBank(db)));
  } catch { console.error('BANK_DATA_AUDIT_BLOCKED=SCHEMA_OR_DATABASE_UNCONFIRMED'); process.exitCode=1; }
  finally { db?.close(); }
}
