import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decimalToMinorUnits } from "./money-minor.js";
import { validatePublicationSafety } from "./read-model-publication-safety.js";
import {
  readModelDatasetOrder,
  readModelSnapshotManifest,
} from "./read-model-snapshot-digest.js";

type JsonRow = Record<string, string | number | null>;

type ReadModelPayload = {
  dataMode?: string;
  datasets?: Record<string, JsonRow[]>;
  safety?: {
    containsPersonalData?: boolean;
    containsBankSecrets?: boolean;
    sourceSecretsIncluded?: boolean;
    ownerOnlyDestinationRequired?: boolean;
    moneyStorageMode?: string;
    moneyScale?: number;
    sourceToMinorReconciliation?: {
      mismatches?: number;
    };
    legacyRealColumnsAuthoritative?: boolean;
    financialCalculationsEnabled?: boolean;
    payrollRulesActivated?: boolean;
    taxRulesActivated?: boolean;
    teacherPayrollLinksActivated?: boolean;
    lessonCategoryAuthoritative?: boolean;
    automaticFamilyMerge?: boolean;
    partialAlfaRowsPublished?: boolean;
    alfaTerminalGatePassed?: boolean;
  };
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function safeAbsolutePath(value: string): string {
  const absolute = resolve(value);
  if (absolute !== value || absolute === "/" || absolute.includes("/../")) {
    throw new Error("READ_MODEL_PATH_MUST_BE_ABSOLUTE");
  }
  return absolute;
}

function chunks(rows: JsonRow[], maximumRows = 50): JsonRow[][] {
  if (!rows.length) return [[]];
  const result: JsonRow[][] = [];
  for (let index = 0; index < rows.length; index += maximumRows) {
    result.push(rows.slice(index, index + maximumRows));
  }
  return result;
}

function requireMinorMatch(
  row: JsonRow,
  decimalField: string,
  minorField: string,
  nullable = false,
): void {
  const decimalValue = row[decimalField];
  const minorValue = row[minorField];
  if (
    nullable &&
    (decimalValue === null || decimalValue === undefined) &&
    (minorValue === null || minorValue === undefined)
  ) {
    return;
  }
  if (typeof minorValue !== "number" || !Number.isSafeInteger(minorValue)) {
    throw new Error(`MONEY_MINOR_INVALID_${minorField}`);
  }
  if (decimalToMinorUnits(decimalValue) !== minorValue) {
    throw new Error(`MONEY_MINOR_MISMATCH_${minorField}`);
  }
}

function validateMoneyEvidence(datasets: Record<string, JsonRow[]>): void {
  for (const row of datasets.employee_payroll_monthly ?? []) {
    requireMinorMatch(row, "accrued_amount", "accrued_amount_minor");
    requireMinorMatch(row, "paid_amount", "paid_amount_minor");
  }
  for (const dataset of [
    "employee_payroll_components",
    "employee_payroll_payments",
    "payroll_unresolved",
  ]) {
    for (const row of datasets[dataset] ?? []) {
      requireMinorMatch(row, "amount", "amount_minor");
    }
  }
  for (const row of datasets.alpha_teacher_rates ?? []) {
    requireMinorMatch(row, "rate_amount", "rate_amount_minor", true);
  }
  for (const row of datasets.alpha_payments ?? []) {
    requireMinorMatch(row, "amount", "amount_minor", true);
  }
}

if (process.env.ARTHELLO_ALLOW_PII_EXPORT !== "owner_authorized") {
  throw new Error("OWNER_AUTHORIZED_PII_PUBLISH_FLAG_REQUIRED");
}

const inputPath = safeAbsolutePath(required("ARTHELLO_SITES_READ_MODEL_PATH"));
const siteUrl = new URL(required("ARTHELLO_SITES_URL"));
if (siteUrl.protocol !== "https:" || siteUrl.pathname !== "/") {
  throw new Error("SITES_URL_MUST_BE_HTTPS_ORIGIN");
}
const importToken = required("ARTHELLO_SITES_IMPORT_TOKEN");
const bypassToken = required("OAI_SITES_BYPASS_TOKEN");
if (importToken.length < 32 || bypassToken.length < 32) {
  throw new Error("SITES_PROTECTED_TOKEN_INVALID");
}

const payloadSource = await readFile(inputPath, "utf8");
const sourceFileDigest = createHash("sha256")
  .update(payloadSource)
  .digest("hex");
const payload = JSON.parse(payloadSource) as ReadModelPayload;
validatePublicationSafety(payload);
if (!payload.datasets) throw new Error("READ_MODEL_DATASETS_REQUIRED");
validateMoneyEvidence(payload.datasets);
const { expectedCounts, expectedDigests, payloadDigest } =
  readModelSnapshotManifest(payload.datasets);

const commonHeaders = {
  "OAI-Sites-Authorization": `Bearer ${bypassToken}`,
};
const importHeaders = {
  ...commonHeaders,
  "content-type": "application/json",
  "x-arthello-import-token": importToken,
};
const batchId = randomUUID();
const beginResponse = await fetch(
  new URL("/api/admin/read-model/snapshot/begin", siteUrl),
  {
    method: "POST",
    headers: importHeaders,
    body: JSON.stringify({
      batchId,
      payloadDigest,
      expectedCounts,
      expectedDigests,
    }),
  },
);
if (!beginResponse.ok) {
  throw new Error(`SNAPSHOT_BEGIN_HTTP_${beginResponse.status}`);
}
const begin = (await beginResponse.json()) as {
  ok?: boolean;
  batchId?: string;
  status?: string;
};
if (
  begin.ok !== true ||
  begin.batchId !== batchId ||
  begin.status !== "staging"
) {
  throw new Error("SNAPSHOT_BEGIN_RESPONSE_INVALID");
}

for (const dataset of readModelDatasetOrder) {
  const rows = payload.datasets[dataset];
  if (!Array.isArray(rows)) throw new Error(`DATASET_MISSING_${dataset}`);
  const batches = chunks(rows);
  for (let index = 0; index < batches.length; index += 1) {
    const response = await fetch(
      new URL(`/api/admin/read-model/snapshot/${batchId}/${dataset}`, siteUrl),
      {
        method: "POST",
        headers: importHeaders,
        body: JSON.stringify({
          replace: index === 0,
          rows: batches[index],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`PUBLISH_${dataset}_HTTP_${response.status}`);
    }
    const body = (await response.json()) as {
      ok?: boolean;
      batchId?: string;
      staged?: number;
    };
    if (
      body.ok !== true ||
      body.batchId !== batchId ||
      body.staged !== batches[index].length
    ) {
      throw new Error(`STAGE_${dataset}_RESPONSE_INVALID`);
    }
  }
}

const commitResponse = await fetch(
  new URL(`/api/admin/read-model/snapshot/${batchId}/commit`, siteUrl),
  {
    method: "POST",
    headers: importHeaders,
    body: "{}",
  },
);
if (!commitResponse.ok) {
  throw new Error(`SNAPSHOT_COMMIT_HTTP_${commitResponse.status}`);
}
const commit = (await commitResponse.json()) as {
  ok?: boolean;
  batchId?: string;
  status?: string;
  payloadDigest?: string;
  counts?: Record<string, number>;
};
if (
  commit.ok !== true ||
  commit.batchId !== batchId ||
  commit.status !== "active" ||
  commit.payloadDigest !== payloadDigest
) {
  throw new Error("SNAPSHOT_COMMIT_RESPONSE_INVALID");
}
for (const [dataset, count] of Object.entries(expectedCounts)) {
  if (commit.counts?.[dataset] !== count) {
    throw new Error(`SNAPSHOT_COMMIT_${dataset}_COUNT_MISMATCH`);
  }
}

const summaryResponse = await fetch(
  new URL("/api/admin/read-model/status", siteUrl),
  {
    headers: commonHeaders,
  },
);
if (!summaryResponse.ok) {
  throw new Error(`OWNER_SUMMARY_HTTP_${summaryResponse.status}`);
}
const summary = (await summaryResponse.json()) as {
  dataMode?: string;
  datasets?: Record<string, number>;
  money?: {
    storageMode?: string;
    scale?: number;
    financialCalculationsEnabled?: boolean;
    missingMinorRows?: number;
    legacyReconciliationMismatches?: number;
  };
  publication?: {
    activeBatchId?: string;
    status?: string;
    payloadDigest?: string;
    atomicSnapshot?: boolean;
  };
};
if (
  summary.dataMode !== "aggregate_owner_control_status" ||
  !summary.datasets ||
  summary.money?.storageMode !== "integer_minor_units" ||
  summary.money?.scale !== 2 ||
  summary.money?.financialCalculationsEnabled !== false ||
  summary.money?.missingMinorRows !== 0 ||
  summary.money?.legacyReconciliationMismatches !== 0 ||
  summary.publication?.activeBatchId !== batchId ||
  summary.publication.status !== "active" ||
  summary.publication.payloadDigest !== payloadDigest ||
  summary.publication.atomicSnapshot !== true
) {
  throw new Error("OWNER_SUMMARY_INVALID");
}
for (const [dataset, count] of Object.entries(expectedCounts)) {
  if (summary.datasets[dataset] !== count) {
    throw new Error(`PUBLISH_${dataset}_COUNT_MISMATCH`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    batchId,
    payloadDigest,
    sourceFileDigest,
    published: expectedCounts,
    verifiedCounts: summary.datasets,
  })}\n`,
);
