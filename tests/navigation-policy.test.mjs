import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shouldShowLeadershipParentPreview } from "../lib/navigation-policy.mjs";

test("director lands on the school dashboard, not an empty parent preview", () => {
  assert.equal(shouldShowLeadershipParentPreview({ role: "director", view: "home", studentCount: 0 }), false);
  assert.equal(shouldShowLeadershipParentPreview({ role: "director", view: "home", studentCount: 12 }), false);
});

test("parent preview is an explicit people tool and is hidden without students", () => {
  assert.equal(shouldShowLeadershipParentPreview({ role: "director", view: "people", studentCount: 12 }), true);
  assert.equal(shouldShowLeadershipParentPreview({ role: "deputy", view: "people", studentCount: 1 }), true);
  assert.equal(shouldShowLeadershipParentPreview({ role: "director", view: "people", studentCount: 0 }), false);
  assert.equal(shouldShowLeadershipParentPreview({ role: "teacher", view: "people", studentCount: 12 }), false);
  assert.equal(shouldShowLeadershipParentPreview({ role: "parent", view: "people", studentCount: 1 }), false);
});

test("the school shell uses the policy and no longer renders the empty parent card", () => {
  const source = readFileSync(new URL("../app/school-app.tsx", import.meta.url), "utf8");
  assert.match(source, /showLeadershipParentPreview = shouldShowLeadershipParentPreview/);
  assert.match(source, /<h2>Предпросмотр для родителя<\/h2>/);
  assert.doesNotMatch(source, /<h2>Кабинет родителя<\/h2>/);
  assert.doesNotMatch(source, /Нет доступных детей для предпросмотра/);
});
