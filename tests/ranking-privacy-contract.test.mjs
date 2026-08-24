import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/school/route.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../app/school-app.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../app/level-zero-types.ts", import.meta.url), "utf8");

test("parent ranking hides identities but exposes exact anonymized scores", () => {
  assert.match(route, /displayName:\s*namedMode\s*\?\s*entry\.fullName\s*:\s*isOwn\s*\?\s*"Ваш ребёнок"\s*:\s*null/s);
  assert.match(route, /studentId: namedMode \? entry\.studentId : null/);
  assert.match(route, /score: Number\(entry\.score\.toFixed\(2\)\)/);
  assert.match(route, /gradeCount: namedMode \|\| isOwn \? entry\.gradeCount : null/);
  assert.match(route, /Точные средние баллы открыты обезличенно/);
  assert.match(app, /до следующего места/);
});

test("animal aliases are stable per family but differ between viewers", () => {
  assert.match(route, /sha256\(`\$\{viewer\.id\}\|\$\{className\}\|\$\{student\.id\}\|2026\/27`\)/);
  assert.match(route, /RANKING_ANIMALS/);
});

test("rankings expose overall and subject views with evidence thresholds", () => {
  assert.match(route, /grades\.length < 2/);
  assert.match(route, /subjectScores\.length < 2 \|\| gradeCount < 5/);
  assert.match(types, /mode: "named" \| "anonymous" \| "none"/);
  assert.match(app, /Общий рейтинг/);
  assert.match(app, /Другие дети показаны только образами животных/);
  assert.match(app, /Поимённо, отдельно по каждому классу и предмету/);
});
