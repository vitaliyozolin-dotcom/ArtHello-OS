import { and, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, financeCorrections, financeReconciliationIssues, financialOperations, tasks } from "../../../db/schema";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { resolveTaskAssignment, type TaskAccessContext } from "../../../lib/task-access";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";

const financeRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "FINANCE"]);
const approverRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE"]);

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const actor = context.actor;
  const role = context.apiRole;
  if (!financeRoles.has(role)) return Response.json({ error: "Недостаточно прав для финансового действия" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 60);
    if (action === "classifyOperation") return classifyOperation(actor, body);
    if (action === "addCorrection") return addCorrection(actor, body);
    if (action === "createIssueTask") return createIssueTask(context, body);
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

// D069_FINANCE_OPERATION_ALLOCATION: financial_operations is the management projection; bank_transactions remains immutable.
async function classifyOperation(actor: string, body: Record<string, unknown>) {
  const operationId = clean(body.operationId, 80);
  const cashflowArticle = clean(body.cashflowArticle, 160);
  const pnlArticle = clean(body.pnlArticle, 160);
  const reportClass = clean(body.reportClass, 80) || "Не включено в ОПиУ";
  const accrualPeriod = clean(body.accrualPeriod, 7);
  const counterpartyLabel = clean(body.counterpartyLabel, 240);
  const managementPurpose = clean(body.managementPurpose, 500);
  const contractId = clean(body.contractId, 120);
  const documentId = clean(body.documentId, 120);
  const projectEntityId = clean(body.projectEntityId, 120);
  const objectEntityId = clean(body.objectEntityId, 120);
  const cfrEntityId = clean(body.cfrEntityId, 120);
  const allowedReportClasses = new Set(["Доходы ОПиУ", "Расходы ОПиУ", "Финансирование", "Не включено в ОПиУ"]);
  if (!operationId || !cashflowArticle) {
    return Response.json({ error: "Укажите статью ДДС" }, { status: 400 });
  }
  if (!allowedReportClasses.has(reportClass)) {
    return Response.json({ error: "Выберите корректный класс ОПиУ" }, { status: 400 });
  }
  const affectsPnl = reportClass === "Доходы ОПиУ" || reportClass === "Расходы ОПиУ";
  if (affectsPnl && (!pnlArticle || !/^\d{4}-\d{2}$/.test(accrualPeriod))) {
    return Response.json({ error: "Для ОПиУ укажите статью и период начисления" }, { status: 400 });
  }
  if (accrualPeriod && !/^\d{4}-\d{2}$/.test(accrualPeriod)) {
    return Response.json({ error: "Период ОПиУ должен быть в формате ГГГГ-ММ" }, { status: 400 });
  }

  const db = getDb();
  const [operation] = await db.select().from(financialOperations).where(eq(financialOperations.id, operationId)).limit(1);
  if (!operation) return Response.json({ error: "Операция не найдена" }, { status: 404 });

  const normalizedPnlArticle = pnlArticle;
  const normalizedAccrualPeriod = accrualPeriod;
  const [updated] = await db.update(financialOperations).set({
    cashflowArticle,
    pnlArticle: normalizedPnlArticle,
    accrualPeriod: normalizedAccrualPeriod,
    counterpartyLabel,
    managementPurpose,
    category: cashflowArticle,
    reportClass,
    contractId,
    documentId,
    projectEntityId,
    objectEntityId,
    cfrEntityId,
    status: "Разнесено",
  }).where(eq(financialOperations.id, operationId)).returning();

  const changed = {
    cashflowArticle: [operation.cashflowArticle, cashflowArticle],
    pnlArticle: [operation.pnlArticle, normalizedPnlArticle],
    accrualPeriod: [operation.accrualPeriod, normalizedAccrualPeriod],
    counterpartyLabel: [operation.counterpartyLabel, counterpartyLabel],
    managementPurpose: [operation.managementPurpose, managementPurpose],
    reportClass: [operation.reportClass, reportClass],
    contractId: [operation.contractId, contractId],
    documentId: [operation.documentId, documentId],
    projectEntityId: [operation.projectEntityId, projectEntityId],
    objectEntityId: [operation.objectEntityId, objectEntityId],
    cfrEntityId: [operation.cfrEntityId, cfrEntityId],
  };
  await db.insert(auditEvents).values({
    actor,
    action: "finance.operation_classified",
    entityType: "financial_operation",
    entityId: operationId,
    payload: JSON.stringify({
      immutableBankFact: true,
      changes: Object.fromEntries(Object.entries(changed).filter(([, pair]) => pair[0] !== pair[1])),
    }),
  });
  return Response.json({ operation: updated, message: "Операция разнесена; ДДС и ОПиУ пересчитаны" });
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

async function createIssueTask(context: TaskAccessContext, body: Record<string, unknown>) {
  const actor = context.actor;
  const issueId = clean(body.issueId, 80);
  const db = getDb();
  const [issue] = await db.select().from(financeReconciliationIssues).where(eq(financeReconciliationIssues.id, issueId)).limit(1);
  if (!issue) return Response.json({ error: "Расхождение не найдено" }, { status: 404 });
  const automationKey = `FIN_RECON:${issue.id}`;
  const existing = await findScopedAutomationTask(db, context, automationKey);
  const existingResponse = scopedAutomationTaskResponse(existing);
  if (existingResponse) return existingResponse;
  const assignment = resolveTaskAssignment(context, "", actor);
  if (!assignment.ok) return Response.json({ error: assignment.error }, { status: assignment.status });
  const [task] = await db.insert(tasks).values({
    title: `Разобрать ${issue.id}: ${issue.title}`,
    owner: assignment.owner,
    dueDate: relativeDate(3),
    priority: issue.severity,
    status: "Входящие",
    sourceType: "Финансовое расхождение",
    sourceId: issue.id,
    description: `Сверить ${issue.sourceA} и ${issue.sourceB}. Исходные файлы не изменять; результат оформить отдельной корректировкой или решением.`,
    assigneeEntityId: assignment.assigneeEntityId,
    kind: "Автозадача",
    automationKey,
    requiresApproval: true,
    createdByUserId: context.appUserId,
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

function relativeDate(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
