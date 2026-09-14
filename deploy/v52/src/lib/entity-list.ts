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
  q: string;
  quality: string;
  review: string;
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
  sourceRows.filter((row) => row.status !== "Объединена").forEach((row) => {
    const key = entityDuplicateKey(row);
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  });
  const displayRows = sourceRows.map((row) => ({
    ...row,
    dataQuality: entityDataState(row, (duplicateKeys.get(entityDuplicateKey(row)) ?? 0) > 1),
  }));
  const query = options.q.trim().toLocaleLowerCase("ru-RU");
  const matchingRows = displayRows.filter((row) => {
    if (row.status === "Объединена" && !query) return false;
    if (options.type && row.entityType !== options.type) return false;
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
