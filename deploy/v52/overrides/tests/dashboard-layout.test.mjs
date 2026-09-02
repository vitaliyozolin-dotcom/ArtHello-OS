import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DASHBOARD_LAYOUT_VERSION,
  allowedDashboardWidgetIds,
  clearDashboardBrowserLayouts,
  dashboardBrowserStorageKey,
  dashboardLayoutStateKey,
  reorderDashboardWidgets,
  validateDashboardLayout,
} from "../lib/dashboard-layout.ts";

const sizes = ["compact", "wide", "full"];

function layoutFor(role) {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: [...allowedDashboardWidgetIds(role)].map((id, index) => ({
      id,
      visible: index % 2 === 0,
      size: sizes[index % sizes.length],
    })),
  };
}

test("dashboard layouts accept a complete reordered role allowlist", () => {
  for (const role of ["Собственник", "Директор", "Финансы", "Педагог"]) {
    const candidate = layoutFor(role);
    candidate.widgets.reverse();
    assert.deepEqual(validateDashboardLayout(candidate, role), { ok: true, layout: candidate });
  }
});

test("drag-and-drop reorders a widget once without losing layout data", () => {
  const original = layoutFor("Собственник").widgets;

  const before = reorderDashboardWidgets(original, "operations", "roleFocus", "before");
  assert.deepEqual(before.map((item) => item.id), [
    "kpis", "cashflow", "decisions", "signals", "milestones", "operations", "roleFocus",
  ]);
  assert.deepEqual(before.find((item) => item.id === "operations"), original.find((item) => item.id === "operations"));

  const after = reorderDashboardWidgets(before, "kpis", "cashflow", "after");
  assert.deepEqual(after.map((item) => item.id), [
    "cashflow", "kpis", "decisions", "signals", "milestones", "operations", "roleFocus",
  ]);

  assert.equal(reorderDashboardWidgets(after, "kpis", "kpis", "before"), after);
  assert.equal(reorderDashboardWidgets(after, "operations", "missing", "after"), after);
  assert.deepEqual(original.map((item) => item.id), [
    "kpis", "cashflow", "decisions", "signals", "milestones", "roleFocus", "operations",
  ]);
});

test("dashboard widget allowlists keep finance data away from work roles", () => {
  assert.deepEqual([...allowedDashboardWidgetIds("Собственник")], ["kpis", "cashflow", "decisions", "signals", "milestones", "roleFocus", "operations"]);
  assert.deepEqual([...allowedDashboardWidgetIds("Директор")], ["kpis", "cashflow", "decisions", "signals", "milestones", "roleFocus"]);
  assert.deepEqual([...allowedDashboardWidgetIds("Финансы")], ["kpis", "cashflow", "decisions", "milestones", "roleFocus", "operations"]);
  assert.deepEqual([...allowedDashboardWidgetIds("Педагог")], ["kpis", "roleFocus", "decisions", "milestones"]);
});

test("dashboard layout validation rejects partial, duplicate, cross-role and loose payloads", () => {
  const valid = layoutFor("Педагог");
  assert.equal(validateDashboardLayout({ ...valid, version: 2 }, "Педагог").ok, false);
  assert.equal(validateDashboardLayout({ ...valid, extra: true }, "Педагог").ok, false);
  assert.equal(validateDashboardLayout({ ...valid, widgets: valid.widgets.slice(1) }, "Педагог").ok, false);
  assert.equal(validateDashboardLayout({ ...valid, widgets: valid.widgets.map((item, index) => index ? item : { ...item, id: valid.widgets[1].id }) }, "Педагог").ok, false);
  assert.equal(validateDashboardLayout({ ...valid, widgets: valid.widgets.map((item, index) => index ? item : { ...item, id: "cashflow" }) }, "Педагог").ok, false);
  assert.equal(validateDashboardLayout({ ...valid, widgets: valid.widgets.map((item, index) => index ? item : { ...item, visible: "yes" }) }, "Педагог").ok, false);
  assert.equal(validateDashboardLayout({ ...valid, widgets: valid.widgets.map((item, index) => index ? item : { ...item, size: "giant" }) }, "Педагог").ok, false);
  assert.equal(validateDashboardLayout({ ...valid, widgets: valid.widgets.map((item, index) => index ? item : { ...item, note: "not allowed" }) }, "Педагог").ok, false);
});

test("server state keys are versioned and isolated by canonical user and exact role", () => {
  const owner = dashboardLayoutStateKey("USR-001", "Собственник");
  assert.match(owner, /^dashboard-layout:v1:/);
  assert.notEqual(owner, dashboardLayoutStateKey("USR-002", "Собственник"));
  assert.notEqual(owner, dashboardLayoutStateKey("USR-001", "Директор"));
  assert.equal(dashboardLayoutStateKey("USR/001", "Контроль качества").includes("USR%2F001"), true);
});

test("browser fallback keys preserve the complete user identity and logout clears only that user", () => {
  const slashUser = dashboardBrowserStorageKey("USR/A", "Контроль качества");
  const dashUser = dashboardBrowserStorageKey("USR-A", "Контроль качества");
  assert.notEqual(slashUser, dashUser);
  assert.match(slashUser, /id=USR%2FA/);
  assert.match(slashUser, /role=%D0%9A/);

  const values = new Map([
    [dashboardBrowserStorageKey("USR/A", "Контроль качества"), "quality"],
    [dashboardBrowserStorageKey("USR/A", "Сотрудник"), "work"],
    [dashboardBrowserStorageKey("USR-A", "Контроль качества"), "other"],
    ["arthello:unrelated", "keep"],
  ]);
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
  };
  clearDashboardBrowserLayouts(storage, "USR/A");
  assert.deepEqual([...values.values()].sort(), ["keep", "other"]);
});

test("dashboard layout API derives identity from auth, protects writes and minimizes audit payload", async () => {
  const route = await readFile(new URL("../app/api/dashboard-layout/route.ts", import.meta.url), "utf8");
  assert.match(route, /getAuthenticatedRequestContext\(request\)/);
  assert.doesNotMatch(route, /getRequestUser|x-arthello-role/);
  assert.equal((route.match(/verifyAuthenticatedRequestCsrf\(request, authenticated\)/g) ?? []).length, 2);
  assert.equal((route.match(/dashboardLayoutStateKey\(authenticated\.appUserId, authenticated\.auth\.user\.appRole\)/g) ?? []).length, 3);
  assert.match(route, /getDb\(\)\.select\(\)\.from\(systemRuntimeState\)/);
  assert.match(route, /db\.insert\(systemRuntimeState\)/);
  assert.match(route, /db\.delete\(systemRuntimeState\)/);
  assert.match(route, /validateDashboardLayout\(value, authenticated\.auth\.user\.appRole\)/);
  assert.match(route, /MAX_LAYOUT_BYTES = 4_096/);
  assert.match(route, /payload: JSON\.stringify\(\{ widgetIds: validated\.layout\.widgets\.map\(\(widget\) => widget\.id\) \}\)/);
  assert.equal((route.match(/action: "dashboard\.layout_/g) ?? []).length, 2);
  assert.match(route, /"cache-control": "private, no-store, max-age=0"/);
});
