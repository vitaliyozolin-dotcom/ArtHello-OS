export const FRONT_OFFICE_PROJECT_ID = "ARTHELLO" as const;
export const FRONT_OFFICE_MODE = "DRAFT_ONLY" as const;

export const LEAD_STAGES = [
  "NEW",
  "QUALIFIED",
  "PROGRAM_MATCHED",
  "TRIAL_REQUESTED",
  "TRIAL_CONFIRMED",
  "WON",
  "LOST",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

const ALLOWED_STAGE_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  NEW: ["QUALIFIED", "LOST"],
  QUALIFIED: ["PROGRAM_MATCHED", "LOST"],
  PROGRAM_MATCHED: ["TRIAL_REQUESTED", "LOST"],
  TRIAL_REQUESTED: ["TRIAL_CONFIRMED", "LOST"],
  TRIAL_CONFIRMED: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

export function canTransitionLeadStage(
  current: LeadStage,
  next: LeadStage,
): boolean {
  return current === next || ALLOWED_STAGE_TRANSITIONS[current].includes(next);
}

export function assertLeadStageTransition(
  current: LeadStage,
  next: LeadStage,
): void {
  if (!canTransitionLeadStage(current, next)) {
    throw new Error(`Недопустимый переход воронки: ${current} → ${next}`);
  }
}

export function assertSyntheticWriteAllowed(record: {
  isSynthetic: boolean;
}): void {
  if (!record.isSynthetic) {
    throw new Error(
      "Внутренняя альфа разрешает изменения только синтетических записей",
    );
  }
}

export function assertInternalMessageType(
  messageType: "internal_note" | "ai_draft",
): void {
  if (messageType !== "internal_note" && messageType !== "ai_draft") {
    throw new Error("Исходящие сообщения отключены в режиме DRAFT_ONLY");
  }
}

export function parseLeadStage(value: unknown): LeadStage {
  if (typeof value === "string" && LEAD_STAGES.includes(value as LeadStage)) {
    return value as LeadStage;
  }
  throw new Error("Неизвестный этап воронки");
}

export function safeLimit(
  value: unknown,
  fallback = 100,
  maximum = 200,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function stageRequiresNextAction(stage: LeadStage): boolean {
  return stage !== "WON" && stage !== "LOST";
}
