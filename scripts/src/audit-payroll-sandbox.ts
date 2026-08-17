import type { PGlite } from "@electric-sql/pglite";
import { openSandboxDatabase } from "./sandbox-db.js";

type CellValue = string | number | boolean | null;

interface RawPayrollPayload {
  sheetName: string;
  rowNumber: number;
  values: CellValue[];
  formulaValues: CellValue[];
  valueMode: string;
}

interface AccrualLayout {
  normalizedSheetName: string;
  accruedStartColumn: number;
  monthCount: number;
}

function textValue(value: CellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeText(value: CellValue | undefined): string {
  return textValue(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyToCents(value: CellValue | undefined): bigint | null {
  const normalized = textValue(value)
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.+-]/g, "");
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric)
    ? BigInt(Math.round(numeric * 100))
    : null;
}

const accrualLayouts: AccrualLayout[] = [
  "ОБСЛУЖИВАНИЕ САДА",
  "САД: занятия и медицина",
  "ОБЩИЕ",
  "САД+KPI",
  "АДМИНИСТРАЦИЯ",
  "ШКОЛА",
  "КУХНЯ",
].map((name) => ({
  normalizedSheetName: normalizeText(name),
  accruedStartColumn: 5,
  monthCount: 12,
}));

accrualLayouts.push(
  {
    normalizedSheetName: normalizeText("КЛУБНЫЕ"),
    accruedStartColumn: 8,
    monthCount: 12,
  },
  {
    normalizedSheetName: normalizeText("ДОП. УСЛУГИ"),
    accruedStartColumn: 6,
    monthCount: 12,
  },
  {
    normalizedSheetName: normalizeText("ОНЛАЙН-ШКОЛА"),
    accruedStartColumn: 6,
    monthCount: 12,
  },
);

async function count(
  database: PGlite,
  sql: string,
  parameters: unknown[] = [],
): Promise<number> {
  const result = await database.query<{ count: string }>(sql, parameters);
  return Number(result.rows[0]?.count ?? "0");
}

async function auditedAggregate(
  database: PGlite,
  table: "payroll_payments" | "salary_accruals",
): Promise<{ count: number; cents: bigint }> {
  const result = await database.query<{ count: string; total: string }>(
    `SELECT
       count(*)::text AS count,
       COALESCE(sum(amount), 0)::text AS total
     FROM ${table}`,
  );
  return {
    count: Number(result.rows[0]?.count ?? "0"),
    cents: moneyToCents(result.rows[0]?.total ?? "0") ?? 0n,
  };
}

const { database, migrationsApplied } = await openSandboxDatabase();
try {
  const batch = await database.query<{ id: string }>(
    `SELECT id
     FROM source_import_batches
     WHERE source_system = 'google_sheets'
       AND source_title = '25-26 Атлас // Зарплатная ведомость'
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  const batchId = batch.rows[0]?.id;
  if (!batchId) throw new Error("Payroll import batch is missing");

  const raw = await database.query<{ payload: RawPayrollPayload }>(
    `SELECT payload
     FROM source_raw_records
     WHERE import_batch_id = $1
       AND source_system = 'google_sheets'`,
    [batchId],
  );
  const bySheet = new Map<string, RawPayrollPayload[]>();
  for (const record of raw.rows) {
    const payload = record.payload;
    const rows = bySheet.get(payload.sheetName) ?? [];
    rows.push(payload);
    bySheet.set(payload.sheetName, rows);
  }
  for (const rows of bySheet.values()) {
    rows.sort((left, right) => left.rowNumber - right.rowNumber);
  }

  const paymentsRows = [...bySheet.entries()].find(
    ([name]) => normalizeText(name) === "выплаты",
  )?.[1];
  if (!paymentsRows?.length) {
    throw new Error("Payroll raw layer is missing the ВЫПЛАТЫ tab");
  }
  const paymentHeaders = paymentsRows[0]!.values.map(normalizeText);
  const paymentNameColumn = paymentHeaders.indexOf("фио");
  const paymentAmountColumn = paymentHeaders.indexOf("сумма");
  if (paymentNameColumn < 0 || paymentAmountColumn < 0) {
    throw new Error("Payroll raw payment headers are invalid");
  }

  let expectedPaymentCount = 0;
  let expectedPaymentCents = 0n;
  let rejectedMissingName = 0;
  let rejectedMissingAmount = 0;
  for (const row of paymentsRows.slice(1)) {
    const fullName = textValue(row.values[paymentNameColumn]);
    const cents = moneyToCents(row.values[paymentAmountColumn]);
    if (!fullName && cents === null) continue;
    if (!fullName) {
      rejectedMissingName += 1;
      continue;
    }
    if (cents === null) {
      rejectedMissingAmount += 1;
      continue;
    }
    expectedPaymentCount += 1;
    expectedPaymentCents += cents;
  }

  let expectedAccrualCount = 0;
  let expectedAccrualCents = 0n;
  let zeroAccrualsSkipped = 0;
  let accrualSheetsFound = 0;
  for (const layout of accrualLayouts) {
    const sheet = [...bySheet.entries()].find(
      ([name]) => normalizeText(name) === layout.normalizedSheetName,
    )?.[1];
    if (!sheet?.length) continue;
    accrualSheetsFound += 1;
    for (const row of sheet.filter((record) => record.rowNumber >= 4)) {
      const fullName = normalizeText(row.values[0]);
      if (
        !fullName ||
        fullName === "сотрудник" ||
        fullName === "фио" ||
        fullName.startsWith("итого")
      ) {
        continue;
      }
      for (
        let monthOffset = 0;
        monthOffset < layout.monthCount;
        monthOffset += 1
      ) {
        const column = layout.accruedStartColumn + monthOffset * 2;
        const cents = moneyToCents(row.values[column]);
        if (cents === null) continue;
        if (cents === 0n) {
          zeroAccrualsSkipped += 1;
          continue;
        }
        expectedAccrualCount += 1;
        expectedAccrualCents += cents;
      }
    }
  }

  const payments = await auditedAggregate(database, "payroll_payments");
  const accruals = await auditedAggregate(database, "salary_accruals");
  const rawRowsWithFormulaSnapshot = raw.rows.filter(
    (record) => Array.isArray(record.payload.formulaValues),
  ).length;

  process.stdout.write(
    `${JSON.stringify({
      mode: "isolated_payroll_audit",
      migrationsApplied,
      rawRows: raw.rows.length,
      rawRowsWithFormulaSnapshot,
      formulasComplete:
        rawRowsWithFormulaSnapshot === raw.rows.length,
      accrualSheetsFound,
      paymentSourceRowsAccepted: expectedPaymentCount,
      paymentDatabaseRows: payments.count,
      paymentCountMatches:
        payments.count === expectedPaymentCount,
      paymentAmountMatchesSource:
        payments.cents === expectedPaymentCents,
      paymentRejectedReasons: {
        missingName: rejectedMissingName,
        missingAmount: rejectedMissingAmount,
      },
      accrualSourceRowsAccepted: expectedAccrualCount,
      accrualDatabaseRows: accruals.count,
      accrualCountMatches:
        accruals.count === expectedAccrualCount,
      accrualAmountMatchesSource:
        accruals.cents === expectedAccrualCents,
      zeroAccrualsSkipped,
      duplicatePaymentSources: await count(
        database,
        `SELECT count(*)::text AS count
         FROM (
           SELECT source_raw_record_id
           FROM payroll_payments
           GROUP BY source_raw_record_id
           HAVING count(*) > 1
         ) duplicates`,
      ),
      duplicateAccrualComponents: await count(
        database,
        `SELECT count(*)::text AS count
         FROM (
           SELECT source_raw_record_id, component_key
           FROM salary_accruals
           GROUP BY source_raw_record_id, component_key
           HAVING count(*) > 1
         ) duplicates`,
      ),
      periodsWithoutLegalEntity: await count(
        database,
        `SELECT count(*)::text AS count
         FROM payroll_periods
         WHERE legal_entity_id IS NULL`,
      ),
      unresolvedPaymentLinks: await count(
        database,
        `SELECT count(*)::text AS count
         FROM payroll_payments
         WHERE evidence->>'identityMatch' <> 'exact_unique'`,
      ),
      unresolvedAccrualIdentities: await count(
        database,
        `SELECT count(*)::text AS count
         FROM employee_external_identities
         WHERE source_system = 'google_payroll_accrual_sheet'
           AND employee_id IS NULL`,
      ),
      evaluatedResultsOnly: true,
      formulaRulesActivated: false,
      realDataPublishedToSites: false,
      personalDataPrinted: false,
    }, null, 2)}\n`,
  );
} finally {
  await database.close();
}
