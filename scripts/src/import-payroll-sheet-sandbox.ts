import { sha256Hex } from "@workspace/shared/sha256";
import type { PGlite } from "@electric-sql/pglite";
import { seedOwnerConfirmedMasterData } from "./arthello-master-data.js";
import { openSandboxDatabase } from "./sandbox-db.js";

type CellValue = string | number | boolean | null;

interface SheetSnapshot {
  name: string;
  range: string;
  values: CellValue[][];
  formulaValues: CellValue[][];
}

interface WorkbookSnapshot {
  spreadsheetId: string;
  title: string;
  valueMode: "formatted_values";
  tabs: SheetSnapshot[];
}

interface AccrualSheetLayout {
  normalizedSheetName: string;
  conditionColumn: number;
  roleColumn: number;
  accruedStartColumn: number;
  monthCount: number;
}

const accrualSheetLayouts: AccrualSheetLayout[] = [
  "ОБСЛУЖИВАНИЕ САДА",
  "САД: занятия и медицина",
  "ОБЩИЕ",
  "САД+KPI",
  "АДМИНИСТРАЦИЯ",
  "ШКОЛА",
  "КУХНЯ",
].map((name) => ({
  normalizedSheetName: normalizeText(name),
  conditionColumn: 4,
  roleColumn: 1,
  accruedStartColumn: 5,
  monthCount: 12,
}));

accrualSheetLayouts.push(
  {
    normalizedSheetName: normalizeText("КЛУБНЫЕ"),
    conditionColumn: 7,
    roleColumn: 1,
    accruedStartColumn: 8,
    monthCount: 12,
  },
  {
    normalizedSheetName: normalizeText("ДОП. УСЛУГИ"),
    conditionColumn: 5,
    roleColumn: 1,
    accruedStartColumn: 6,
    monthCount: 12,
  },
  {
    normalizedSheetName: normalizeText("ОНЛАЙН-ШКОЛА"),
    conditionColumn: 5,
    roleColumn: 1,
    accruedStartColumn: 6,
    monthCount: 12,
  },
);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableValue(record[key])]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

const sha256 = sha256Hex;

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

function hasValues(row: CellValue[]): boolean {
  return row.some((value) => textValue(value) !== "");
}

function parseMoney(value: CellValue | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  const normalized = textValue(value)
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.+-]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number.toFixed(2) : null;
}

const monthNames: Record<string, string> = {
  январь: "01",
  февраль: "02",
  март: "03",
  апрель: "04",
  май: "05",
  июнь: "06",
  июль: "07",
  август: "08",
  сентябрь: "09",
  октябрь: "10",
  ноябрь: "11",
  декабрь: "12",
};

function parseDate(value: CellValue | undefined): string | null {
  const text = textValue(value);
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
}

function parsePeriodMonth(
  value: CellValue | undefined,
): string | null {
  const normalized = normalizeText(value);
  const ymd = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(normalized);
  if (ymd) return `${ymd[1]}-${ymd[2]!.padStart(2, "0")}-01`;
  const my = /^(\d{1,2})[./](\d{4})$/.exec(normalized);
  if (my) return `${my[2]}-${my[1]!.padStart(2, "0")}-01`;
  for (const [name, month] of Object.entries(monthNames)) {
    if (!normalized.includes(name)) continue;
    const year = /20\d{2}/.exec(normalized)?.[0];
    if (year) return `${year}-${month}-01`;
  }
  return null;
}

function fiscalYearsFromTitle(
  workbookTitle: string,
): { first: number; second: number } {
  const match = /(?:^|\D)(\d{2})\s*-\s*(\d{2})(?:\D|$)/.exec(
    workbookTitle,
  );
  if (!match) {
    throw new Error(
      "Payroll workbook title does not contain a two-year fiscal cycle",
    );
  }
  const first = 2000 + Number(match[1]);
  const second = 2000 + Number(match[2]);
  if (second !== first + 1) {
    throw new Error("Payroll workbook fiscal cycle is not consecutive");
  }
  return { first, second };
}

function periodMonthFromHeader(
  value: CellValue | undefined,
  fiscalYears: { first: number; second: number },
): string | null {
  const month = Number(textValue(value).replace(",", "."));
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const year = month >= 9 ? fiscalYears.first : fiscalYears.second;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function spreadsheetColumnName(zeroBasedIndex: number): string {
  let value = zeroBasedIndex + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result =
      String.fromCharCode(65 + (value % 26)) +
      result;
    value = Math.floor(value / 26);
  }
  return result;
}

function assertSnapshot(value: unknown): WorkbookSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Payroll snapshot must be an object");
  }
  const candidate = value as Partial<WorkbookSnapshot>;
  if (
    !candidate.spreadsheetId ||
    !candidate.title ||
    candidate.valueMode !== "formatted_values" ||
    !Array.isArray(candidate.tabs)
  ) {
    throw new Error("Payroll snapshot metadata is incomplete");
  }
  for (const tab of candidate.tabs) {
    if (
      !tab ||
      typeof tab.name !== "string" ||
      typeof tab.range !== "string" ||
      !Array.isArray(tab.values) ||
      !Array.isArray(tab.formulaValues)
    ) {
      throw new Error("Payroll snapshot contains an invalid tab");
    }
  }
  return candidate as WorkbookSnapshot;
}

async function readStandardInput(): Promise<string> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function upsertEmployeeIdentity(
  database: PGlite,
  fullName: string,
  role: string | null,
): Promise<{ identityId: string; employeeId: string }> {
  const externalId = `roster:${sha256(
    `${normalizeText(fullName)}|${normalizeText(role ?? "")}`,
  )}`;
  const existing = await database.query<{
    id: string;
    employee_id: string | null;
  }>(
    `SELECT id, employee_id
     FROM employee_external_identities
     WHERE source_system = 'google_payroll_sheet'
       AND external_id = $1`,
    [externalId],
  );
  let employeeId = existing.rows[0]?.employee_id ?? null;
  if (!employeeId) {
    const employee = await database.query<{ id: string }>(
      `INSERT INTO employees (
         full_name,
         primary_role,
         employee_kind,
         classification_status,
         classification_reason,
         is_test_data
       ) VALUES (
         $1,
         $2,
         'unknown',
         'needs_review',
         'Imported from owner-provided payroll roster; employment status and CRM link require review',
         false
       )
       RETURNING id`,
      [fullName, role],
    );
    employeeId = employee.rows[0]?.id ?? null;
  } else {
    await database.query(
      `UPDATE employees
       SET
         full_name = $2,
         primary_role = $3,
         updated_at = now()
       WHERE id = $1`,
      [employeeId, fullName, role],
    );
  }
  if (!employeeId) throw new Error("Employee record was not created");

  const identity = await database.query<{ id: string }>(
    `INSERT INTO employee_external_identities (
       employee_id,
       source_system,
       external_id,
       source_name,
       source_role,
       match_status,
       evidence,
       updated_at
     ) VALUES (
       $1,
       'google_payroll_sheet',
       $2,
       $3,
       $4,
       'source_record_created',
       $5::jsonb,
       now()
     )
     ON CONFLICT (source_system, external_id) DO UPDATE SET
       employee_id = EXCLUDED.employee_id,
       source_name = EXCLUDED.source_name,
       source_role = EXCLUDED.source_role,
       match_status = EXCLUDED.match_status,
       evidence = EXCLUDED.evidence,
       updated_at = now()
     RETURNING id`,
    [
      employeeId,
      externalId,
      fullName,
      role,
      JSON.stringify({
        source: "СОТРУДНИКИ ВСЕ",
        requiresEmploymentReview: true,
        requiresAlfaCrmTeacherReview: true,
      }),
    ],
  );
  const identityId = identity.rows[0]?.id;
  if (!identityId) throw new Error("Employee source identity was not created");
  return { identityId, employeeId };
}

async function findIdentityByName(
  database: PGlite,
  fullName: string,
): Promise<{
  identityId: string | null;
  employeeId: string | null;
  matchStatus: "exact_unique" | "ambiguous" | "not_found";
}> {
  const identities = await database.query<{
    id: string;
    employee_id: string | null;
    source_name: string | null;
  }>(
    `SELECT id, employee_id, source_name
     FROM employee_external_identities
     WHERE source_system = 'google_payroll_sheet'`,
  );
  const normalized = normalizeText(fullName);
  const matches = identities.rows.filter(
    (identity) => normalizeText(identity.source_name ?? "") === normalized,
  );
  if (matches.length !== 1) {
    return {
      identityId: null,
      employeeId: null,
      matchStatus: matches.length > 1 ? "ambiguous" : "not_found",
    };
  }
  return {
    identityId: matches[0]!.id,
    employeeId: matches[0]!.employee_id,
    matchStatus: "exact_unique",
  };
}

async function findOrCreateAccrualIdentity(
  database: PGlite,
  sheetName: string,
  fullName: string,
  role: string | null,
): Promise<{
  identityId: string | null;
  employeeId: string | null;
  matchStatus: "exact_unique" | "ambiguous" | "not_found";
}> {
  const rosterIdentity = await findIdentityByName(database, fullName);
  if (rosterIdentity.matchStatus === "exact_unique") {
    return rosterIdentity;
  }

  const externalId = `accrual:${sha256(
    `${normalizeText(sheetName)}|${normalizeText(fullName)}|${
      normalizeText(role ?? "")
    }`,
  )}`;
  const existing = await database.query<{
    id: string;
    employee_id: string | null;
  }>(
    `SELECT id, employee_id
     FROM employee_external_identities
     WHERE source_system = 'google_payroll_accrual_sheet'
       AND external_id = $1`,
    [externalId],
  );
  if (existing.rows[0]?.employee_id) {
    return {
      identityId: existing.rows[0].id,
      employeeId: existing.rows[0].employee_id,
      matchStatus: "exact_unique",
    };
  }

  const identity = await database.query<{ id: string }>(
    `INSERT INTO employee_external_identities (
       source_system,
       external_id,
       source_name,
       source_role,
       match_status,
       evidence,
       updated_at
     ) VALUES (
       'google_payroll_accrual_sheet',
       $1,
       $2,
       $3,
       $4,
       $5::jsonb,
       now()
     )
     ON CONFLICT (source_system, external_id) DO UPDATE SET
       source_name = EXCLUDED.source_name,
       source_role = EXCLUDED.source_role,
       match_status = CASE
         WHEN employee_external_identities.employee_id IS NULL
           THEN EXCLUDED.match_status
         ELSE employee_external_identities.match_status
       END,
       evidence = EXCLUDED.evidence,
       updated_at = now()
     RETURNING id`,
    [
      externalId,
      fullName,
      role,
      rosterIdentity.matchStatus,
      JSON.stringify({
        sourceSheet: sheetName,
        rosterMatch: rosterIdentity.matchStatus,
        requiresManualReview: true,
      }),
    ],
  );
  return {
    identityId: identity.rows[0]?.id ?? null,
    employeeId: null,
    matchStatus: rosterIdentity.matchStatus,
  };
}

async function payrollPeriodId(
  database: PGlite,
  periodMonth: string | null,
  importBatchId: string,
  legalEntityId: string | null,
): Promise<string | null> {
  if (!periodMonth) return null;
  const result = await database.query<{ id: string }>(
    `INSERT INTO payroll_periods (
       period_month,
       legal_entity_id,
       source_import_batch_id,
       status
     ) VALUES ($1, $2, $3, 'imported_unverified')
     ON CONFLICT (
       period_month,
       legal_entity_id,
       source_import_batch_id
     ) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [periodMonth, legalEntityId, importBatchId],
  );
  return result.rows[0]?.id ?? null;
}

async function resolveWorkbookLegalEntity(
  database: PGlite,
  workbookTitle: string,
): Promise<{
  legalEntityId: string | null;
  legalEntityCode: string | null;
  mappingStatus: "owner_confirmed" | "unresolved";
}> {
  // The owner explicitly mapped the Atlas kindergarten/school operation to
  // ООО АртХелло. No fallback is used for differently named workbooks.
  if (!normalizeText(workbookTitle).includes("атлас")) {
    return {
      legalEntityId: null,
      legalEntityCode: null,
      mappingStatus: "unresolved",
    };
  }
  const result = await database.query<{ id: string; code: string }>(
    `SELECT id, code
     FROM legal_entities
     WHERE code = 'ooo-arthello'
       AND confirmation_source = 'owner_message_2026-07-25'`,
  );
  const row = result.rows[0];
  return row
    ? {
      legalEntityId: row.id,
      legalEntityCode: row.code,
      mappingStatus: "owner_confirmed",
    }
    : {
      legalEntityId: null,
      legalEntityCode: null,
      mappingStatus: "unresolved",
    };
}

async function importWorkbook(
  database: PGlite,
  workbook: WorkbookSnapshot,
): Promise<{
  reusedBatch: boolean;
  tabs: number;
  rawRows: number;
  rosterRows: number;
  employeesCreatedOrUpdated: number;
  employeeSourceIdentities: number;
  paymentsImported: number;
  paymentRowsRejected: number;
  paymentIdentityUnresolved: number;
  accrualSheetsProcessed: number;
  accrualsImported: number;
  accrualRowsRejected: number;
  accrualIdentityUnresolved: number;
  zeroAccrualsSkipped: number;
  formulasPreserved: boolean;
  legalEntityCode: string | null;
  legalEntityMappingStatus: "owner_confirmed" | "unresolved";
}> {
  const contentHash = sha256(stableJson(workbook));
  const existing = await database.query<{ id: string; status: string }>(
    `SELECT id, status
     FROM source_import_batches
     WHERE source_system = 'google_sheets'
       AND source_external_id = $1
       AND content_hash = $2`,
    [workbook.spreadsheetId, contentHash],
  );
  const reusedBatch = existing.rows.length > 0;
  const batch = existing.rows[0]
    ? { id: existing.rows[0].id }
    : (
      await database.query<{ id: string }>(
        `INSERT INTO source_import_batches (
           source_system,
           source_external_id,
           source_title,
           content_hash,
           status
         ) VALUES (
           'google_sheets',
           $1,
           $2,
           $3,
           'running'
         )
         RETURNING id`,
        [workbook.spreadsheetId, workbook.title, contentHash],
      )
    ).rows[0];
  const batchId = batch?.id;
  if (!batchId) throw new Error("Payroll source import batch was not created");
  const workbookLegalEntity = await resolveWorkbookLegalEntity(
    database,
    workbook.title,
  );
  if (!workbookLegalEntity.legalEntityId) {
    throw new Error(
      "Payroll workbook legal entity is unresolved; normalized payments are blocked",
    );
  }

  let rawRows = 0;
  const rawRecordIds = new Map<string, string>();
  await database.exec("BEGIN");
  try {
    for (const tab of workbook.tabs) {
      for (const [index, row] of tab.values.entries()) {
        if (!hasValues(row)) continue;
        const rowNumber = index + 1;
        const locator = `${tab.name}!${rowNumber}`;
        const payload = {
          sheetName: tab.name,
          rowNumber,
          values: row,
          formulaValues: tab.formulaValues[index] ?? [],
          valueMode: workbook.valueMode,
        };
        const payloadJson = stableJson(payload);
        const raw = await database.query<{ id: string }>(
          `INSERT INTO source_raw_records (
             import_batch_id,
             source_system,
             source_external_id,
             record_type,
             record_locator,
             external_record_id,
             payload,
             payload_hash
           ) VALUES (
             $1,
             'google_sheets',
             $2,
             'spreadsheet_row',
             $3,
             $3,
             $4::jsonb,
             $5
           )
           ON CONFLICT (
             import_batch_id,
             record_locator,
             payload_hash
           ) DO UPDATE SET imported_at = now()
           RETURNING id`,
          [
            batchId,
            workbook.spreadsheetId,
            locator,
            payloadJson,
            sha256(payloadJson),
          ],
        );
        const rawId = raw.rows[0]?.id;
        if (!rawId) throw new Error("Payroll raw row was not stored");
        rawRecordIds.set(locator, rawId);
        rawRows += 1;
      }
    }
    await database.exec("COMMIT");
  } catch (error) {
    await database.exec("ROLLBACK");
    throw error;
  }

  const roster = workbook.tabs.find(
    (tab) => normalizeText(tab.name) === "сотрудники все",
  );
  if (!roster?.values.length) {
    throw new Error("Payroll snapshot is missing the СОТРУДНИКИ ВСЕ roster");
  }
  const rosterHeaders = roster.values[0]!.map(normalizeText);
  if (rosterHeaders[0] !== "фио" || rosterHeaders[1] !== "должность") {
    throw new Error(
      "Payroll roster headers do not match the expected ФИО/Должность layout",
    );
  }
  let rosterRows = 0;
  const rosterIdentityIds = new Set<string>();
  const rosterEmployeeIds = new Set<string>();
  for (const row of roster?.values.slice(1) ?? []) {
    const fullName = textValue(row[0]);
    const role = textValue(row[1]) || null;
    if (!fullName) continue;
    rosterRows += 1;
    const identity = await upsertEmployeeIdentity(database, fullName, role);
    rosterIdentityIds.add(identity.identityId);
    rosterEmployeeIds.add(identity.employeeId);
  }

  const paymentsTab = workbook.tabs.find(
    (tab) => normalizeText(tab.name) === "выплаты",
  );
  let paymentsImported = 0;
  let paymentRowsRejected = 0;
  let paymentIdentityUnresolved = 0;
  if (!paymentsTab?.values.length) {
    throw new Error("Payroll snapshot is missing the ВЫПЛАТЫ tab");
  }
  if (paymentsTab.values.length > 0) {
    const headers = paymentsTab.values[0]!.map(normalizeText);
    const column = (name: string) => headers.indexOf(normalizeText(name));
    const monthColumn = column("Месяц");
    const dateColumn = column("Дата");
    const nameColumn = column("ФИО");
    const amountColumn = column("Сумма");
    const paymentKindColumn = column("Выплата");
    const periodColumn = column("Период");
    const commentColumn = column("Комментарий");
    const missingRequiredHeaders = [
      ["ФИО", nameColumn],
      ["Сумма", amountColumn],
    ].filter(([, index]) => index === -1);
    if (missingRequiredHeaders.length > 0) {
      throw new Error(
        `Payroll payments headers are missing: ${
          missingRequiredHeaders.map(([name]) => name).join(", ")
        }`,
      );
    }

    for (const [zeroBasedIndex, row] of paymentsTab.values.slice(1).entries()) {
      const rowNumber = zeroBasedIndex + 2;
      const fullName = textValue(row[nameColumn]);
      const amount = parseMoney(row[amountColumn]);
      if (!fullName && !amount) continue;
      if (!fullName || !amount) {
        paymentRowsRejected += 1;
        continue;
      }
      const rawId = rawRecordIds.get(`${paymentsTab.name}!${rowNumber}`);
      if (!rawId) {
        paymentRowsRejected += 1;
        continue;
      }
      const identity = await findIdentityByName(database, fullName);
      if (identity.matchStatus !== "exact_unique") {
        paymentIdentityUnresolved += 1;
      }
      const paymentDate = parseDate(row[dateColumn]);
      const periodMonth =
        parsePeriodMonth(row[periodColumn]) ??
        parsePeriodMonth(row[monthColumn]) ??
        (paymentDate ? `${paymentDate.slice(0, 7)}-01` : null);
      const periodId = await payrollPeriodId(
        database,
        periodMonth,
        batchId,
        workbookLegalEntity.legalEntityId,
      );
      await database.query(
        `INSERT INTO payroll_payments (
           payroll_period_id,
           employee_external_identity_id,
           employee_id,
           source_raw_record_id,
           payment_date,
           amount,
           payment_kind,
           status,
           evidence,
           updated_at
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           'imported_unverified',
           $8::jsonb,
           now()
         )
         ON CONFLICT (source_raw_record_id) DO UPDATE SET
           payroll_period_id = EXCLUDED.payroll_period_id,
           employee_external_identity_id =
             EXCLUDED.employee_external_identity_id,
           employee_id = EXCLUDED.employee_id,
           payment_date = EXCLUDED.payment_date,
           amount = EXCLUDED.amount,
           payment_kind = EXCLUDED.payment_kind,
           status = EXCLUDED.status,
           evidence = EXCLUDED.evidence,
           updated_at = now()`,
        [
          periodId,
          identity.identityId,
          identity.employeeId,
          rawId,
          paymentDate,
          amount,
          paymentKindColumn >= 0
            ? textValue(row[paymentKindColumn]) || "sheet_payment_row"
            : "sheet_payment_row",
          JSON.stringify({
            identityMatch: identity.matchStatus,
            periodParsed: periodMonth !== null,
            paymentKindPresent:
              paymentKindColumn >= 0 &&
              textValue(row[paymentKindColumn]) !== "",
            commentPresent:
              commentColumn >= 0 &&
              textValue(row[commentColumn]) !== "",
            formulaPreserved: true,
            requiresApproval: true,
          }),
        ],
      );
      paymentsImported += 1;
    }
  }

  const fiscalYears = fiscalYearsFromTitle(workbook.title);
  let accrualSheetsProcessed = 0;
  let accrualsImported = 0;
  let accrualRowsRejected = 0;
  let accrualIdentityUnresolved = 0;
  let zeroAccrualsSkipped = 0;
  const periodCache = new Map<string, string>();

  for (const layout of accrualSheetLayouts) {
    const tab = workbook.tabs.find(
      (candidate) =>
        normalizeText(candidate.name) === layout.normalizedSheetName,
    );
    if (!tab || tab.values.length < 4) {
      accrualRowsRejected += 1;
      continue;
    }
    accrualSheetsProcessed += 1;

    const periods: Array<{
      periodMonth: string;
      accruedColumn: number;
      quantityColumn: number;
    }> = [];
    for (
      let monthOffset = 0;
      monthOffset < layout.monthCount;
      monthOffset += 1
    ) {
      const accruedColumn =
        layout.accruedStartColumn + monthOffset * 2;
      const periodMonth = periodMonthFromHeader(
        tab.values[1]?.[accruedColumn],
        fiscalYears,
      );
      if (!periodMonth) {
        throw new Error(
          `Payroll accrual month header is invalid in ${
            tab.name
          } column ${spreadsheetColumnName(accruedColumn)}`,
        );
      }
      periods.push({
        periodMonth,
        accruedColumn,
        quantityColumn: accruedColumn + 1,
      });
    }

    for (
      let rowIndex = 3;
      rowIndex < tab.values.length;
      rowIndex += 1
    ) {
      const row = tab.values[rowIndex] ?? [];
      const fullName = textValue(row[0]);
      if (!fullName) continue;
      const normalizedName = normalizeText(fullName);
      if (
        normalizedName === "сотрудник" ||
        normalizedName === "фио" ||
        normalizedName.startsWith("итого")
      ) {
        continue;
      }

      const rawId = rawRecordIds.get(`${tab.name}!${rowIndex + 1}`);
      if (!rawId) {
        accrualRowsRejected += 1;
        continue;
      }
      const role = textValue(row[layout.roleColumn]) || null;
      const condition =
        textValue(row[layout.conditionColumn]) ||
        "unspecified_source_component";
      const identity = await findOrCreateAccrualIdentity(
        database,
        tab.name,
        fullName,
        role,
      );
      if (identity.matchStatus !== "exact_unique") {
        accrualIdentityUnresolved += 1;
      }

      for (const period of periods) {
        const amount = parseMoney(row[period.accruedColumn]);
        if (amount === null) continue;
        if (Number(amount) === 0) {
          zeroAccrualsSkipped += 1;
          continue;
        }

        let periodId = periodCache.get(period.periodMonth);
        if (!periodId) {
          const resolvedPeriodId = await payrollPeriodId(
            database,
            period.periodMonth,
            batchId,
            workbookLegalEntity.legalEntityId,
          );
          if (!resolvedPeriodId) {
            accrualRowsRejected += 1;
            continue;
          }
          periodId = resolvedPeriodId;
          periodCache.set(period.periodMonth, periodId);
        }

        const formulaCell =
          tab.formulaValues[rowIndex]?.[period.accruedColumn];
        const quantity = parseMoney(row[period.quantityColumn]);
        await database.query(
          `INSERT INTO salary_accruals (
             payroll_period_id,
             employee_external_identity_id,
             employee_id,
             source_raw_record_id,
             component_key,
             accrual_type,
             amount,
             status,
             calculation_evidence,
             updated_at
           ) VALUES (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             'imported_unverified',
             $8::jsonb,
             now()
           )
           ON CONFLICT (
             source_raw_record_id,
             component_key
           ) DO UPDATE SET
             payroll_period_id = EXCLUDED.payroll_period_id,
             employee_external_identity_id =
               EXCLUDED.employee_external_identity_id,
             employee_id = EXCLUDED.employee_id,
             accrual_type = EXCLUDED.accrual_type,
             amount = EXCLUDED.amount,
             status = EXCLUDED.status,
             calculation_evidence = EXCLUDED.calculation_evidence,
             updated_at = now()`,
          [
            periodId,
            identity.identityId,
            identity.employeeId,
            rawId,
            period.periodMonth,
            condition,
            amount,
            JSON.stringify({
              identityMatch: identity.matchStatus,
              sourceSheet: tab.name,
              sourceRow: rowIndex + 1,
              accruedColumn:
                spreadsheetColumnName(period.accruedColumn),
              quantityColumn:
                spreadsheetColumnName(period.quantityColumn),
              quantity,
              formulaPresent:
                typeof formulaCell === "string" &&
                formulaCell.startsWith("="),
              evaluatedResultOnly: true,
              formulaRuleActivated: false,
              requiresApproval: true,
            }),
          ],
        );
        accrualsImported += 1;
      }
    }
  }

  await database.query(
    `UPDATE source_import_batches
     SET
       status = 'completed_raw_formatted',
       records_read = $2,
       records_saved = $2,
       records_rejected = $3,
       errors = $4::jsonb,
       finished_at = now()
     WHERE id = $1`,
    [
      batchId,
      rawRows,
      paymentRowsRejected + accrualRowsRejected,
      JSON.stringify({
        formulaPreserved: true,
        normalizedScopes: [
          "employee_roster",
          "salary_accrual_results",
          "payroll_payments",
        ],
        pendingScopes: ["salary_formula_rules", "kpi_rule_activation"],
        legalEntityMappingStatus: workbookLegalEntity.mappingStatus,
        legalEntityCode: workbookLegalEntity.legalEntityCode,
      }),
    ],
  );

  return {
    reusedBatch,
    tabs: workbook.tabs.length,
    rawRows,
    rosterRows,
    employeesCreatedOrUpdated: rosterEmployeeIds.size,
    employeeSourceIdentities: rosterIdentityIds.size,
    paymentsImported,
    paymentRowsRejected,
    paymentIdentityUnresolved,
    accrualSheetsProcessed,
    accrualsImported,
    accrualRowsRejected,
    accrualIdentityUnresolved,
    zeroAccrualsSkipped,
    formulasPreserved: true,
    legalEntityCode: workbookLegalEntity.legalEntityCode,
    legalEntityMappingStatus: workbookLegalEntity.mappingStatus,
  };
}

const input = await readStandardInput();
const workbook = assertSnapshot(JSON.parse(input) as unknown);
const { database, migrationsApplied } = await openSandboxDatabase();
try {
  await seedOwnerConfirmedMasterData(database);
  const result = await importWorkbook(database, workbook);
  process.stdout.write(
    `${JSON.stringify({
      mode: "isolated_payroll_import",
      sourceType: "owner_provided_google_sheet",
      sourceTitle: workbook.title,
      migrationsApplied,
      ...result,
      accrualRulesActivated: false,
      realDataPublishedToSites: false,
      personalDataPrinted: false,
    }, null, 2)}\n`,
  );
} finally {
  await database.close();
}
