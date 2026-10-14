import { and, eq, sql } from "drizzle-orm";
import { db, leadEventsTable, settingsTable } from "@workspace/db";
import {
  assertPlanMonth,
  parsePlanInput,
  type MonthlyPlan,
  type PlanInput,
  type PlanTargets,
} from "@workspace/shared/pulse-plan";

type PlanDatabase = Pick<typeof db, "select" | "transaction">;
const keyFor = (month: string) => `pulse-plan:v1:${month}`;

export class PlanConflictError extends Error {}

function storedPlan(value: string | null | undefined): MonthlyPlan | null {
  if (value == null) return null;
  const parsed = JSON.parse(value) as MonthlyPlan;
  const validated = parsePlanInput(parsed);
  if (
    validated.revision < 1 ||
    typeof parsed.updatedBy !== "string" ||
    typeof parsed.updatedAt !== "string"
  )
    throw new Error("Некорректный сохранённый план");
  return {
    ...validated,
    updatedBy: parsed.updatedBy,
    updatedAt: parsed.updatedAt,
  };
}

export async function readPulsePlan(
  database: PlanDatabase,
  month: string,
): Promise<MonthlyPlan | null> {
  assertPlanMonth(month);
  const [row] = await database
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, keyFor(month)));
  const plan = storedPlan(row?.value);
  if (plan && plan.month !== month)
    throw new Error("Месяц сохранённого плана не совпадает");
  return plan;
}

export async function savePulsePlan(
  database: PlanDatabase,
  input: PlanInput,
  userId: string,
): Promise<MonthlyPlan> {
  const body = parsePlanInput(input);
  if (!userId) throw new Error("Владелец плана не подтверждён");
  return database.transaction(async (tx) => {
    const key = keyFor(body.month);
    await tx
      .insert(settingsTable)
      .values({ key, value: null })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, key))
      .for("update");
    const previous = storedPlan(row?.value);
    if ((previous?.revision ?? 0) !== body.revision)
      throw new PlanConflictError(
        "План изменён в другой вкладке. Обновите данные и повторите редактирование.",
      );
    const plan: MonthlyPlan = {
      ...body,
      revision: body.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    await tx
      .insert(settingsTable)
      .values({
        key: `pulse-plan-history:v1:${body.month}:${String(plan.revision).padStart(10, "0")}`,
        value: JSON.stringify(plan),
      });
    await tx
      .update(settingsTable)
      .set({ value: JSON.stringify(plan), updatedAt: new Date(plan.updatedAt) })
      .where(eq(settingsTable.key, key));
    return plan;
  });
}

export async function readPulseFacts(
  database: PlanDatabase,
  month: string,
): Promise<PlanTargets> {
  assertPlanMonth(month);
  // Count observed lead events by their source timestamp, not the import date.
  // This is a recorded subset, not a claim of complete upstream coverage.
  const [row] = await database
    .select({ count: sql<number>`count(*)::integer` })
    .from(leadEventsTable)
    .where(
      and(
        sql`${leadEventsTable.eventTime} >= (${month + "-01"}::date::timestamp AT TIME ZONE 'Europe/Moscow')`,
        sql`${leadEventsTable.eventTime} < ((${month + "-01"}::date + interval '1 month')::timestamp AT TIME ZONE 'Europe/Moscow')`,
        sql`${leadEventsTable.duplicateCandidate} IS NOT TRUE`,
      ),
    );
  return {
    leads: row && row.count > 0 ? row.count : null,
    students: null,
    payments: null,
    receiptsMinor: null,
  };
}
