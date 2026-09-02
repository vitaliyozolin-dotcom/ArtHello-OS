import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isTaskManager,
  redactHiddenTaskReferences,
  resolveTaskAssignment,
  resolveTaskProvenance,
  scopedAutomationTaskResponse,
  taskAccessDecision,
  taskRecipientPrincipals,
} from "../lib/task-access.ts";

const owner = context({ apiRole: "OWNER", appUserId: "USR-OWNER", actor: "owner@example.test" });
const director = context({ apiRole: "DIRECTOR", appUserId: "USR-DIRECTOR", actor: "director@example.test" });
const teacher = context({ apiRole: "TEACHER", appUserId: "USR-TEACHER", actor: "teacher@example.test" });

test("owner and director are the only global task managers", () => {
  assert.equal(isTaskManager(owner), true);
  assert.equal(isTaskManager(director), true);
  assert.equal(isTaskManager(teacher), false);
  assert.equal(isTaskManager(context({ apiRole: "ADMIN" })), false);
});

test("non-managers see and manage only tasks they created or are assigned", () => {
  const created = task({ createdByUserId: teacher.appUserId, createdBy: teacher.actor });
  const assigned = task({ assigneeEntityId: teacher.appUserId });
  const unrelated = task({ createdByUserId: "USR-OTHER", createdBy: "other@example.test", assigneeEntityId: "USR-OTHER" });

  assert.deepEqual(taskAccessDecision(teacher, created), {
    canView: true, canManage: true, canComment: true, canApprove: false,
  });
  assert.deepEqual(taskAccessDecision(teacher, assigned), {
    canView: true, canManage: true, canComment: true, canApprove: false,
  });
  assert.deepEqual(taskAccessDecision(teacher, unrelated), {
    canView: false, canManage: false, canComment: false, canApprove: false,
  });
});

test("a reused display contact never grants ownership without the immutable user id", () => {
  const reusedContact = task({
    createdByUserId: "USR-FORMER",
    createdBy: teacher.actor,
    assigneeEntityId: "USR-OTHER",
  });
  const ambiguousLegacy = task({
    createdByUserId: "",
    createdBy: teacher.actor,
    assigneeEntityId: "USR-OTHER",
  });
  assert.equal(taskAccessDecision(teacher, reusedContact).canView, false);
  assert.equal(taskAccessDecision(teacher, ambiguousLegacy).canView, false);
});

test("an explicit user or role watcher gets read/comment access, not mutation access", () => {
  const unrelated = task({ createdBy: "other@example.test", assigneeEntityId: "USR-OTHER" });

  for (const entityId of [teacher.appUserId, "ROLE:TEACHER"]) {
    assert.deepEqual(taskAccessDecision(teacher, unrelated, [{ entityId }]), {
      canView: true, canManage: false, canComment: true, canApprove: false,
    });
  }
  assert.equal(taskAccessDecision(teacher, unrelated, [{ entityId: "ROLE:FINANCE" }]).canView, false);
});

test("approval is based on the authenticated API role only", () => {
  const unrelated = task({ createdBy: "other@example.test", assigneeEntityId: "USR-OTHER" });
  assert.equal(taskAccessDecision(owner, unrelated).canApprove, true);
  assert.equal(taskAccessDecision(director, unrelated).canApprove, true);
  assert.equal(taskAccessDecision(teacher, task({ createdByUserId: teacher.appUserId, createdBy: teacher.actor })).canApprove, false);
});

test("non-managers cannot forge system task provenance", () => {
  assert.deepEqual(resolveTaskProvenance(teacher, "Конфликт интеграции", "INT-SECRET", "Автозадача"), {
    sourceType: "Ручная задача",
    sourceId: "MANUAL",
    kind: "Задача",
  });
  assert.deepEqual(resolveTaskProvenance(teacher, "Проект", "PRJ-1", "Поручение"), {
    sourceType: "Ручная задача",
    sourceId: "MANUAL",
    kind: "Поручение",
  });
  assert.deepEqual(resolveTaskProvenance(owner, "Проект", "PRJ-1", "Автозадача"), {
    sourceType: "Проект",
    sourceId: "PRJ-1",
    kind: "Автозадача",
  });
});

test("non-manager task creation is normalized to self and cannot assign another user", () => {
  assert.deepEqual(resolveTaskAssignment(teacher, ""), {
    ok: true,
    assigneeEntityId: teacher.appUserId,
    owner: teacher.appUserName,
  });
  assert.deepEqual(resolveTaskAssignment(teacher, teacher.appUserId.toLowerCase()), {
    ok: true,
    assigneeEntityId: teacher.appUserId,
    owner: teacher.appUserName,
  });
  assert.deepEqual(resolveTaskAssignment(teacher, "USR-OTHER"), {
    ok: false,
    status: 403,
    error: "Можно создавать задачи только для себя",
  });
  assert.deepEqual(resolveTaskAssignment(owner, "EMP-001", "Иван Петров"), {
    ok: true,
    assigneeEntityId: "EMP-001",
    owner: "Иван Петров",
  });
});

test("notifications are scoped to explicit authenticated principals", () => {
  assert.deepEqual(taskRecipientPrincipals(teacher), ["USR-TEACHER", "ROLE:TEACHER"]);
});

test("hidden automation dedupe never returns the foreign task", async () => {
  const hidden = scopedAutomationTaskResponse({ state: "hidden" });
  assert.equal(hidden.status, 409);
  assert.deepEqual(await hidden.json(), { error: "Связанная задача уже существует" });
  assert.equal(scopedAutomationTaskResponse({ state: "missing" }), null);
  const visibleTask = task({ createdByUserId: teacher.appUserId });
  const visible = scopedAutomationTaskResponse({ state: "visible", task: visibleTask });
  assert.equal(visible.status, 200);
  assert.deepEqual(await visible.json(), { task: visibleTask, reused: true });
});

test("domain payloads redact a task reference outside the caller's visible set", () => {
  const rows = [
    { id: "visible", relatedTaskId: 12 },
    { id: "hidden", relatedTaskId: 13 },
    { id: "none", relatedTaskId: null },
  ];
  assert.deepEqual(redactHiddenTaskReferences(rows, [{ id: 12 }]), [
    { id: "visible", relatedTaskId: 12 },
    { id: "hidden", relatedTaskId: null },
    { id: "none", relatedTaskId: null },
  ]);
});

test("task APIs use the authenticated context and the shared scope on list, detail and mutations", async () => {
  const [tasksRoute, workItemsRoute, actionsRoute, notificationsRoute, workflowUi, taskQuery, database, schema] = await Promise.all([
    source("../app/api/tasks/route.ts"),
    source("../app/api/work-items/route.ts"),
    source("../app/api/task-actions/route.ts"),
    source("../app/api/notifications/route.ts"),
    source("../app/components/WorkflowWorkspace.tsx"),
    source("../lib/task-access-query.ts"),
    source("../db/index.ts"),
    source("../db/schema.ts"),
  ]);

  for (const route of [tasksRoute, workItemsRoute, actionsRoute, notificationsRoute]) {
    assert.match(route, /getAuthenticatedRequestContext\(request\)/);
    assert.doesNotMatch(route, /getRequestUser/);
  }
  assert.match(tasksRoute, /taskVisibilityCondition\(context\)/);
  assert.match(tasksRoute, /resolveTaskProvenance\(/);
  assert.match(tasksRoute, /createdByUserId: context\.appUserId/);
  assert.match(tasksRoute, /taskAccessDecision\(context, current, watcherRows\)/);
  assert.match(workItemsRoute, /taskVisibilityCondition\(context\)/);
  assert.match(workItemsRoute, /taskAccessDecision\(context, task, watcherRows\)/);
  assert.match(actionsRoute, /taskAccessDecision\(context, task, watcherRows\)/);
  assert.doesNotMatch(actionsRoute, /x-arthello-test-role/);
  assert.match(actionsRoute, /context\.apiRole/);
  assert.match(notificationsRoute, /taskRecipientPrincipals\(context\)/);
  assert.match(notificationsRoute, /candidate\.sourceType === "task"/);
  assert.match(notificationsRoute, /selectVisibleTasks\(db, context\)/);
  assert.match(workItemsRoute, /ne\(notifications\.sourceType, "task"\)/);
  assert.match(workItemsRoute, /inArray\(notifications\.sourceId, visibleTaskSources\)/);
  assert.doesNotMatch(workItemsRoute, /createdBy, context\.actor|createdBy\), context\.actor/);
  assert.doesNotMatch(actionsRoute, /document\.createdBy, context\.actor/);
  assert.match(taskQuery, /tasks\.createdByUserId/);
  assert.doesNotMatch(taskQuery, /tasks\.createdBy\)/);
  assert.match(schema, /createdByUserId: text\("created_by_user_id"\)/);
  assert.match(database, /task_owner_backfill/);
  assert.match(database, /SELECT COUNT\(\*\)[\s\S]*?lower\(trim\(tasks\.created_by\)\)[\s\S]*?\) = 1/);
  assert.match(database, /app_users\.status = 'Активен'/);
  assert.match(database, /datetime\(app_users\.invited_at\) <= datetime\(tasks\.created_at\)/);
  assert.match(taskQuery, /if \(!userPrincipal\) return sql<boolean>`0 = 1`/);
  assert.match(tasksRoute, /isTaskManager\(context\) \? "Сначала завершите подзадачи" : "Задачу пока нельзя завершить"/);
  assert.doesNotMatch(workflowUi, /x-arthello-test-role/);
  assert.match(workflowUi, /detail\.permissions\.canApprove/);
  assert.match(workflowUi, /detail\.permissions\.canManage/);
});

test("every domain task list and automation action is wired to the shared scope", async () => {
  const listRoutes = [
    "accounting", "analytics", "content", "education", "finance", "food", "hr",
    "integrations", "legal", "procurement", "safety", "strategy",
  ];
  const actionRoutes = [
    "accounting-actions", "analytics-actions", "content-actions", "education-actions", "finance-actions",
    "food-actions", "hr-actions", "integration-actions", "legal-actions", "procurement-actions",
    "safety-actions", "sales-actions", "strategy-actions",
  ];
  for (const name of listRoutes) {
    const route = await source(`../app/api/${name}/route.ts`);
    assert.match(route, /getAuthenticatedRequestContext\(request\)/, `${name} authenticates the caller`);
    assert.match(route, /selectVisibleTasks\(db,\s*(?:context|requester)\)/, `${name} scopes embedded tasks`);
    assert.match(route, /redactHiddenTaskReferences\(/, `${name} hides foreign task references`);
    assert.doesNotMatch(route, /db\.select\(\)\.from\(tasks\)/, `${name} has no unscoped task list`);
  }
  for (const name of actionRoutes) {
    const route = await source(`../app/api/${name}/route.ts`);
    assert.match(route, /findScopedAutomationTask\(db,\s*context,/, `${name} scopes automation dedupe`);
    assert.match(route, /scopedAutomationTaskResponse\(/, `${name} hides a foreign existing task`);
    assert.match(route, /resolveTaskAssignment\(context,/, `${name} enforces self-assignment`);
    assert.match(route, /createdByUserId:\s*context\.appUserId/, `${name} persists immutable ownership`);
    assert.doesNotMatch(route, /from\(tasks\)\.where\(eq\(tasks\.automationKey/, `${name} has no raw dedupe read`);
  }
});

function context(overrides = {}) {
  return {
    actor: "employee@example.test",
    apiRole: "EMPLOYEE",
    appUserId: "USR-EMPLOYEE",
    appUserName: "Сотрудник",
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 1,
    createdByUserId: "USR-CREATOR",
    createdBy: "creator@example.test",
    assigneeEntityId: "USR-ASSIGNEE",
    ...overrides,
  };
}

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}
