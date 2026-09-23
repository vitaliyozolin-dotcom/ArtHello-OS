import { entityDataState, entityDuplicateKey } from "./entity-provenance.ts";

export type EntityListRow = {
  id: string;
  entityType: string;
  displayName: string;
  status: string;
  sourceSystem: string;
  sourceRecordId: string;
  dataQuality: string;
  scope: string;
  metadata: string;
  [key: string]: unknown;
};

export type EntityListOptions = {
  type: string;
  status?: "current" | "archive" | "all";
  q: string;
  quality: string;
  review: string;
  branch?: string;
  mode: string;
  offset: number;
  limit: number;
};

const reviewStates = new Set(["Требует сверки", "На проверке"]);

export function listEntities(rows: EntityListRow[], options: EntityListOptions) {
  const sourceRows = options.mode === "source_only"
    ? rows.filter((row) => !row.sourceSystem.startsWith("SYNTHETIC"))
    : rows;
  const duplicateKeys = new Map<string, number>();
  sourceRows.filter((row) => row.status !== "Объединена" && row.status !== "Архив").forEach((row) => {
    const key = entityDuplicateKey(row);
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  });
  const displayRows = sourceRows.map((row) => ({
    ...row,
    hasNameCollision: row.status !== "Архив" && row.status !== "Объединена" && (duplicateKeys.get(entityDuplicateKey(row)) ?? 0) > 1,
    dataQuality: entityDataState(row, (duplicateKeys.get(entityDuplicateKey(row)) ?? 0) > 1),
  }));
  const query = options.q.trim().toLocaleLowerCase("ru-RU");
  const matchingRows = displayRows.filter((row) => {
    if (row.status === "Объединена" && !query) return false;
    if (options.type && row.entityType !== options.type) return false;
    if (options.type === "Семья") {
      const status = options.status ?? "current";
      if (status === "current" && row.status === "Архив") return false;
      if (status === "archive" && row.status !== "Архив") return false;
      if (options.branch && !familyScopes(row).includes(options.branch)) return false;
    }
    if (!query) return true;
    return [row.id, row.displayName, row.sourceRecordId, row.scope, row.sourceSystem]
      .some((value) => value.toLocaleLowerCase("ru-RU").includes(query));
  });
  const resultCounts = {
    total: matchingRows.length,
    needsReview: matchingRows.filter((row) => reviewStates.has(row.dataQuality)).length,
    ready: matchingRows.filter((row) => !reviewStates.has(row.dataQuality)).length,
  };
  const filteredRows = matchingRows.filter((row) => {
    if (options.quality && row.dataQuality !== options.quality) return false;
    if (options.review === "needs_review" && !reviewStates.has(row.dataQuality)) return false;
    if (options.review === "ready" && reviewStates.has(row.dataQuality)) return false;
    return true;
  });
  const offset = Math.max(0, Math.trunc(options.offset));
  const limit = Math.max(1, Math.trunc(options.limit));
  return {
    entities: filteredRows.slice(offset, offset + limit),
    total: filteredRows.length,
    resultCounts,
    displayRows,
    duplicateKeys,
  };
}

function familyScopes(row: EntityListRow): string[] {
  try {
    const metadata = JSON.parse(row.metadata) as { branchAssignments?: Array<{ scope?: unknown; active?: unknown }> };
    const active = metadata.branchAssignments?.filter((item) => item.active === true && typeof item.scope === "string").map((item) => item.scope as string) ?? [];
    if (active.length) return active;
  } catch { /* Older cards have only their primary scope. */ }
  return [row.scope];
}
