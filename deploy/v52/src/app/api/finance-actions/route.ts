import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, financeCorrections, financeReconciliationIssues, financialOperations, organizationBranches, tasks, userBranchAccess } from "../../../db/schema";
import { getAuthenticatedRequestContext, verifyAuthenticatedRequestCsrf, type AuthenticatedRequestContext } from "../../../lib/production-auth";
import { resolveTaskAssignment, type TaskAccessContext } from "../../../lib/task-access";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";

import { changeCatalog, FinanceArticleError, validateClassification } from "../../../lib/finance-articles";
import { loadArticleCatalog, saveArticleCatalog, saveClassification } from "../../../lib/finance-article-store";
import { FINANCE_ACCOUNTING_START_DATE } from "../../../lib/finance-branch-scope";

const financeRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "FINANCE"]);
const approverRoles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE"]);
const isDisposableFinanceFixture = () => (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN === "https://finance.ci.invalid";

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try { verifyAuthenticatedRequestCsrf(request, context); }
  catch { return Response.json({ error: "Защитная сессия устарела. Обновите страницу." }, { status: 403 }); }
  const actor = context.actor;
  const role = context.apiRole;
  if (!financeRoles.has(role)) return Response.json({ error: "Недостаточно прав для финансового действия" }, { status: 403 });
  try {
    await ensureCoreTables();
    const body = (await request.json()) as Record<string, unknown>;
    const action = clean(body.action, 60);
    if (["createArticle", "approveArticle", "archiveArticle"].includes(action)) {
      // The legacy browser acceptance creates disposable articles against an
      // isolated database. No production origin can enable this branch.
      if (!isDisposableFinanceFixture()) {
        return Response.json({ error: "Справочник зафиксирован. Изменение требует отдельного решения владельца." }, { status: 409 });
      }
      const snapshot = await loadArticleCatalog(env.DB);
      if (body.catalogRevision !== snapshot.catalog.revision) throw new FinanceArticleError("Справочник уже изменён. Обновите страницу.", 409);
      const catalog = changeCatalog(snapshot.catalog, body, role, crypto.randomUUID());
      await saveArticleCatalog(env.DB, snapshot, catalog, actor, action);
      return Response.json({ catalog, message: action === "createArticle" ? "Черновик статьи создан" : action === "approveArticle" ? "Статья утверждена" : "Статья перенесена в архив" });
    }
    if (action === "classifyOperation") return await classifyOperation(context, body);
    if (action === "addCorrection") return addCorrection(context, body);
    if (action === "createIssueTask") return createIssueTask(context, body);
    if (action === "resolveIssue") {
      if (!approverRoles.has(role)) return Response.json({ error: "Закрыть расхождение может руководитель или представитель" }, { status: 403 });
      return resolveIssue(actor, body);
    }
    return Response.json({ error: "Неизвестное финансовое действие" }, { status: 400 });
  } catch (error) {
    if (error instanceof FinanceArticleError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Не удалось сохранить финансовое действие. Обновите страницу перед повтором." }, { status: 500 });
  }
}

// D069_FINANCE_OPERATION_ALLOCATION: financial_operations is the management projection; bank_transactions remains immutable.
async function classifyOperation(context: AuthenticatedRequestContext, body: Record<string, unknown>) {
  const actor = context.actor;
  const operationId = clean(body.operationId, 80);
  const targetBranchId = clean(body.objectEntityId, 120);
  const db = getDb();
  const [operation] = await db.select().from(financialOperations).where(eq(financialOperations.id, operationId)).limit(1);
  if (!operation) return Response.json({ error: "Операция не найдена" }, { status: 404 });
  if (operation.operationDate < FINANCE_ACCOUNTING_START_DATE) return Response.json({ error: "Учёт ведётся только с 1 сентября 2026 года" }, { status: 409 });
  if (!await canManageBranch(context, targetBranchId)) return Response.json({ error: "Выберите доступный активный филиал" }, { status: 403 });
  if (operation.objectEntityId && operation.objectEntityId !== targetBranchId && !await canManageBranch(context, operation.objectEntityId)) {
    return Response.json({ error: "Исходный филиал операции недоступен" }, { status: 403 });
  }
  const snapshot = await loadArticleCatalog(env.DB);
  if (body.catalogRevision !== snapshot.catalog.revision) throw new FinanceArticleError("Справочник уже изменён. Обновите страницу.", 409);
  const patch = validateClassification(snapshot.catalog, operation, body);
  const updated = await saveClassification(env.DB, snapshot, operation, patch, actor);
  return Response.json({ operation: updated, message: "Разнесение сохранено" });
}

async function addCorrection(context: AuthenticatedRequestContext, body: Record<string, unknown>) {
  const actor = context.actor;
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
  if (!await canManageBranch(context, operation.objectEntityId)) return Response.json({ error: "Филиал операции недоступен" }, { status: 403 });
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

async function canManageBranch(context: AuthenticatedRequestContext, branchId: string) {
  if (!branchId) return false;
  const db = getDb();
  const [branch] = await db.select({ id: organizationBranches.id }).from(organizationBranches)
    .where(and(eq(organizationBranches.id, branchId), eq(organizationBranches.status, "Активен"))).limit(1);
  if (!branch) return false;
  if ((context.apiRole === "OWNER" && context.auth.user.isSystemOwner) || context.auth.user.isAdministrative) return true;
  const [grant] = await db.select({ branchId: userBranchAccess.branchId }).from(userBranchAccess)
    .where(and(eq(userBranchAccess.userId, context.appUserId), eq(userBranchAccess.branchId, branchId))).limit(1);
  return Boolean(grant);
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
