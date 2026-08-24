import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app/school-app.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("student receives a role-scoped bold dashboard without changing other roles", () => {
  assert.match(app, /`role-\$\{snapshot\.viewer\.role\}`/);
  assert.match(css, /\.role-student \.l0-workspace/);
  assert.match(css, /student-dashboard-hero-v1\.webp/);
  assert.match(app, /Твоя учебная вселенная/);
  assert.match(app, /student-launch-grid/);
  assert.equal(existsSync(new URL("../public/student-dashboard-hero-v1.webp", import.meta.url)), true);
});

test("student typography and bright cards keep the approved compact geometry", () => {
  assert.match(css, /font-family:\s*"Rubik"/);
  assert.match(css, /\.role-student\s*\{[^}]*font-family:\s*"Rubik"/s);
  assert.match(css, /\.student-launch-grid button\s*\{[^}]*border-radius:\s*14px[^}]*grid-template-rows:/s);
  assert.match(css, /\.student-launch-grid button\s*\{[^}]*border-radius:\s*12px/s);
  assert.equal(existsSync(new URL("../public/fonts/rubik-cyrillic-variable.woff2", import.meta.url)), true);
  assert.equal(existsSync(new URL("../public/fonts/rubik-latin-variable.woff2", import.meta.url)), true);
  assert.equal(existsSync(new URL("../public/fonts/RUBIK-OFL.txt", import.meta.url)), true);
});

test("student average uses a compact score card instead of a circular bubble", () => {
  assert.match(css, /\.student-dashboard \.student-hero > \.student-score-orbit\s*\{[^}]*border-radius:\s*14px[^}]*grid-template-areas:/s);
  assert.match(css, /\.student-score-orbit small\s*\{[^}]*background:\s*rgba\(184,255,72,\.13\)/s);
  assert.match(css, /\.student-dashboard \.student-hero > \.student-score-orbit\s*\{[^}]*width:\s*126px[^}]*border-radius:\s*11px/s);
});

test("student and teacher have separate verified quote experiences", () => {
  assert.match(app, /const studentQuotes/);
  assert.match(app, /Александр Пушкин/);
  assert.match(app, /Михаил Ломоносов/);
  assert.match(app, /const teacherQuotes/);
  assert.match(app, /Василий Ключевский/);
  assert.match(app, /Лев Толстой/);
  assert.match(app, /teacher-quote/);
  assert.match(app, /student-quote/);
});
