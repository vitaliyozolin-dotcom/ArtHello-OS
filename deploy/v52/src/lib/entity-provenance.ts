export const ENTITY_DATA_STATES = ["Создано вручную", "Проверено", "Требует сверки", "На проверке"] as const;

export type EntityDataState = (typeof ENTITY_DATA_STATES)[number];

type EntityIdentity = {
  entityType: string;
  displayName: string;
};

type EntityProvenance = {
  sourceSystem: string;
  dataQuality: string;
};

export function isManualEntitySource(sourceSystem: string) {
  const normalized = sourceSystem.trim().toUpperCase();
  return normalized === "MANUAL" || normalized.startsWith("MANUAL_");
}

export function normalizeEntityIdentityName(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/gi, "");
}

export function entityDuplicateKey(entity: EntityIdentity) {
  return `${entity.entityType}:${normalizeEntityIdentityName(entity.displayName)}`;
}

export function entityDataState(entity: EntityProvenance, hasDuplicate = false): EntityDataState {
  if (hasDuplicate || entity.dataQuality === "Требует сверки") return "Требует сверки";
  if (isManualEntitySource(entity.sourceSystem)) return "Создано вручную";
  return entity.dataQuality === "Проверено" ? "Проверено" : "На проверке";
}

export function entityNeedsReview(entity: EntityProvenance, hasDuplicate = false) {
  const state = entityDataState(entity, hasDuplicate);
  return state === "Требует сверки" || state === "На проверке";
}

export function initialEntityDataQuality(sourceSystem: string) {
  return isManualEntitySource(sourceSystem) ? "Проверено" : "На проверке";
}

export function editedEntityDataQuality(
  entity: EntityProvenance,
  requestedState: string,
  hasDuplicate: boolean,
) {
  if (hasDuplicate) return "Требует сверки";
  if (isManualEntitySource(entity.sourceSystem)) {
    return entity.dataQuality === "Требует сверки" ? "Требует сверки" : "Проверено";
  }
  if (requestedState === "Проверено") return "Проверено";
  if (requestedState === "Требует сверки") return "Требует сверки";
  return "На проверке";
}

export function needsExternalReviewEvidence(
  entity: EntityProvenance,
  requestedState: string,
  hasDuplicate: boolean,
) {
  return !hasDuplicate
    && !isManualEntitySource(entity.sourceSystem)
    && entityDataState(entity) !== "Проверено"
    && requestedState === "Проверено";
}

export function manualEntityNormalization(
  entity: EntityProvenance & { status: string },
  hasDuplicate: boolean,
  operationalStatus: string | null = null,
) {
  if (!isManualEntitySource(entity.sourceSystem) || hasDuplicate || entity.dataQuality === "Требует сверки") return null;
  let status = entity.status;
  if (status === "На проверке") {
    status = !operationalStatus || operationalStatus === "Работает" ? "Активна" : operationalStatus;
  }
  if (entity.dataQuality === "Проверено" && status === entity.status) return null;
  return { dataQuality: "Проверено", status } as const;
}
