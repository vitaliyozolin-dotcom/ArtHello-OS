import { and, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, financeCorrections, financeReconciliationIssues, financialOperations, tasks } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

const financeRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "FINANCE"]);
const approverRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE"]);

export async function POST(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!financeRoles.has(role)) return Response.json({ error: "Недостаточно прав для финансового действия" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 60);
    if (action === "addCorrection") return addCorrection(actor, body);
    if (action === "createIssueTask") return createIssueTask(actor, body);
    if (action === "resolveIssue") {
      if (!approverRoles.has(role)) return Response.json({ error: "Закрыть расхождение может руководитель или представитель" }, { status: 403 });
      return resolveIssue(actor, body);
    }
    return Response.json({ error: "Неизвестное финансовое действие" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка финансового действия";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function addCorrection(actor: string, body: Record<string, unknown>) {
  const operationId = clean(body.operationId, 80);
  const fieldName = clean(body.fieldName, 40);
  const afterValue = clean(body.afterValue, 160);
  const reason = clean(body.reason, 500);
  if (!operationId || !["amountMinor", "category"].includes(fieldName) || !afterValue || reason.length < 8) {
    return Response.json({ error: "Укажите поле, новое значение и содержательную причину" }, { status: 400 });
  }
  const db = getDb();
  const [operation] = await db.select().from(financialOperations).where(eq(financialOperations.id, operationId)).limit(1);
  if (!operation) return Response.json({ error: "Операция не найдена" }, { status: 404 });
  const beforeValue = fieldName === "amountMinor" ? String(operation.amountMinor) : operation.category;
  let normalizedAfterValue = afterValue;
  if (fieldName === "amountMinor") {
    const parsed = Number(afterValue.replaceAll(" ", "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return Response.json({ error: "Сумма должна быть неотрицательным числом" }, { status: 400 });
    normalizedAfterValue = String(Math.round(parsed * 100));
  }
  const [correction] = await db.insert(financeCorrections).values({ operationId, fieldName, beforeValue, afterValue: normalizedAfterValue, reason, createdBy: actor }).returning();
  await db.insert(auditEvents).values({ actor, action: "finance.correction_proposed", entityType: "financial_operation", entityId: operationId, payload: JSON.stringify({ correctionId: correction.id, fieldName, beforeValue, afterValue: normalizedAfterValue }) });
  return Response.json({ correction }, { status: 201 });
}

async function createIssueTask(actor: string, body: Record<string, unknown>) {
  const issueId = clean(body.issueId, 80);
  const db = getDb();
  const [issue] = await db.select().from(financeReconciliationIssues).where(eq(financeReconciliationIssues.id, issueId)).limit(1);
  if (!issue) return Response.json({ error: "Расхождение не найдено" }, { status: 404 });
  const automationKey = `FIN_RECON:${issue.id}`;
  const [existing] = await db.select().from(tasks).where(eq(tasks.automationKey, automationKey)).limit(1);
  if (existing) return Response.json({ task: existing, reused: true });
  const [task] = await db.insert(tasks).values({
    title: `Разобрать ${issue.id}: ${issue.title}`,
    owner: "Финансовый контролёр",
    dueDate: "2026-08-25",
    priority: issue.severity,
    status: "Входящие",
    sourceType: "Финансовое расхождение",
    sourceId: issue.id,
    description: `Сверить ${issue.sourceA} и ${issue.sourceB}. Исходные файлы не изменять; результат оформить отдельной корректировкой или решением.`,
    assigneeEntityId: "ROLE:FINANCE",
    kind: "Автозадача",
    automationKey,
    requiresApproval: true,
    createdBy: actor,
  }).returning();
  await db.update(financeReconciliationIssues).set({ relatedTaskId: task.id, status: "В работе", updatedAt: new Date().toISOString() }).where(eq(financeReconciliationIssues.id, issue.id));
  await db.insert(auditEvents).values({ actor, action: "finance.issue_task_created", entityType: "finance_issue", entityId: issue.id, payload: JSON.stringify({ taskId: task.id }) });
  return Response.json({ task }, { status: 201 });
}

async function resolveIssue(actor: string, body: Record<string, unknown>) {
  const issueId = clean(body.issueId, 80);
  const resolution = clean(body.resolution, 700);
  if (resolution.length < 12) return Response.json({ error: "Опишите доказательство устранения расхождения" }, { status: 400 });
  const db = getDb();
  const [issue] = await db.select().from(financeReconciliationIssues).where(and(eq(financeReconciliationIssues.id, issueId), eq(financeReconciliationIssues.status, "В работе"))).limit(1);
  if (!issue) return Response.json({ error: "Закрывать можно только расхождение в работе" }, { status: 409 });
  const [updated] = await db.update(financeReconciliationIssues).set({ status: "Закрыто", resolution, updatedAt: new Date().toISOString() }).where(eq(financeReconciliationIssues.id, issueId)).returning();
  await db.insert(auditEvents).values({ actor, action: "finance.issue_resolved", entityType: "finance_issue", entityId: issueId, payload: JSON.stringify({ resolution }) });
  return Response.json({ issue: updated });
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
