import { createHash } from "node:crypto";

export type SnapshotJsonRow = Record<string, string | number | null>;

export const readModelDatasetOrder = [
  "employees",
  "employee_payroll_monthly",
  "employee_payroll_components",
  "employee_payroll_payments",
  "payroll_unresolved",
  "alpha_branches",
  "alpha_students",
  "family_candidates",
  "alpha_groups",
  "alpha_teachers",
  "alpha_teacher_rates",
  "alpha_lessons",
  "alpha_payments",
  "sync_status",
] as const;

export type ReadModelDatasetName = (typeof readModelDatasetOrder)[number];

const rowKeyByDataset: Record<ReadModelDatasetName, "id" | "source"> = {
  employees: "id",
  employee_payroll_monthly: "id",
  employee_payroll_components: "id",
  employee_payroll_payments: "id",
  payroll_unresolved: "id",
  alpha_branches: "id",
  alpha_students: "id",
  family_candidates: "id",
  alpha_groups: "id",
  alpha_teachers: "id",
  alpha_teacher_rates: "id",
  alpha_lessons: "id",
  alpha_payments: "id",
  sync_status: "source",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalRow(row: SnapshotJsonRow): SnapshotJsonRow {
  return Object.fromEntries(
    Object.keys(row)
      .sort(compareText)
      .map((key) => [key, row[key] ?? null]),
  );
}

export function readModelDatasetDigest(
  dataset: ReadModelDatasetName,
  rows: SnapshotJsonRow[],
): string {
  const key = rowKeyByDataset[dataset];
  const pairs = rows
    .map((row): [string, string] => {
      const rowKey = row[key];
      if (
        (typeof rowKey !== "string" && typeof rowKey !== "number") ||
        String(rowKey).length < 1
      ) {
        throw new Error(`SNAPSHOT_ROW_KEY_REQUIRED_${dataset}`);
      }
      return [String(rowKey), sha256(JSON.stringify(canonicalRow(row)))];
    })
    .sort((left, right) => compareText(left[0], right[0]));
  return sha256(JSON.stringify(pairs));
}

export function readModelSnapshotManifest(
  datasets: Record<string, SnapshotJsonRow[]>,
): {
  expectedCounts: Record<ReadModelDatasetName, number>;
  expectedDigests: Record<ReadModelDatasetName, string>;
  payloadDigest: string;
} {
  const expectedCounts = {} as Record<ReadModelDatasetName, number>;
  const expectedDigests = {} as Record<ReadModelDatasetName, string>;
  for (const dataset of readModelDatasetOrder) {
    const rows = datasets[dataset];
    if (!Array.isArray(rows)) {
      throw new Error(`DATASET_MISSING_${dataset}`);
    }
    expectedCounts[dataset] = rows.length;
    expectedDigests[dataset] = readModelDatasetDigest(dataset, rows);
  }
  const payloadDigest = sha256(
    JSON.stringify(
      readModelDatasetOrder.map((dataset) => [
        dataset,
        expectedDigests[dataset],
      ]),
    ),
  );
  return { expectedCounts, expectedDigests, payloadDigest };
}
