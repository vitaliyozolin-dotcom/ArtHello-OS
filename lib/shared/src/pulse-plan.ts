export const PLAN_METRICS = [
  "leads",
  "students",
  "payments",
  "receiptsMinor",
] as const;
export type PlanMetric = (typeof PLAN_METRICS)[number];
export type PlanTargets = Record<PlanMetric, number | null>;
export interface PlanInput {
  month: string;
  revision: number;
  targets: PlanTargets;
}
export interface MonthlyPlan extends PlanInput {
  updatedAt: string;
  updatedBy: string;
}
export interface PulsePlanResponse {
  month: string;
  plan: MonthlyPlan | null;
  facts: PlanTargets;
}

export function assertPlanMonth(month: unknown): asserts month is string {
  if (typeof month !== "string" || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Выберите месяц в формате YYYY-MM (2000–2099)");
  }
}

export function parsePlanInput(input: unknown): PlanInput {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Некорректный план");
  const body = input as Record<string, unknown>;
  assertPlanMonth(body.month);
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 0)
    throw new Error("Некорректная версия плана");
  if (
    !body.targets ||
    typeof body.targets !== "object" ||
    Array.isArray(body.targets)
  )
    throw new Error("Укажите показатели плана");
  const supplied = body.targets as Record<string, unknown>;
  if (
    Object.keys(supplied).some(
      (key) => !PLAN_METRICS.includes(key as PlanMetric),
    )
  )
    throw new Error("Неизвестный показатель плана");
  const targets = {} as PlanTargets;
  for (const metric of PLAN_METRICS) {
    const value = supplied[metric];
    if (
      value !== null &&
      (!Number.isSafeInteger(value) || (value as number) < 0)
    ) {
      throw new Error(
        "План должен содержать целые неотрицательные значения; деньги — в копейках",
      );
    }
    targets[metric] = value as number | null;
  }
  if (Object.values(targets).every((value) => value === null))
    throw new Error("Задайте хотя бы один показатель");
  return { month: body.month, revision: body.revision as number, targets };
}

export function planCompletion(
  fact: number | null,
  plan: number | null,
): number | null {
  return fact !== null && plan !== null && plan > 0
    ? Math.round((fact / plan) * 100)
    : null;
}

export function currentPlanMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}

export function parsePlanTarget(
  metric: PlanMetric,
  text: string,
): number | null {
  const value = text.trim();
  if (!value) return null;
  if (metric === "receiptsMinor") {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(value))
      throw new Error(
        "Сумма: неотрицательное число, не более двух знаков после запятой",
      );
    const [rubles, kopecks = ""] = value.replace(",", ".").split(".");
    const amount = BigInt(rubles!) * 100n + BigInt(kopecks.padEnd(2, "0"));
    if (amount > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Сумма слишком велика");
    return Number(amount);
  }
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("Количество должно быть целым неотрицательным числом");
  return Number(value);
}
