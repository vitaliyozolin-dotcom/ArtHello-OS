import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workerSource = await readFile(
  resolve(import.meta.dirname, "../../dist/server/index.js"),
  "utf8",
);
const workerUrl = `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`;
const { default: worker } = await import(workerUrl);

test("serves the sanitized owner control surface with noindex headers", async () => {
  const response = await worker.fetch(new Request("https://control.example/"));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(html, /Только обезличенные данные/);
  assert.match(html, /Финансовая правда/);
  assert.match(html, /Payroll sandbox: PASS/);
  assert.match(html, /OAuth и protected backend ещё не готовы/);
  assert.match(html, /Свежая полная выгрузка не состоялась/);
  assert.match(html, /Production \/ detailed live data: BLOCKED/);
  assert.doesNotMatch(html, /8 подтверждено live/);
  assert.doesNotMatch(html, /owner123|accountant123|viewer123/i);
  assert.doesNotMatch(html, /arthellonew\.s20\.online/i);
  assert.equal(response.headers.get("x-frame-options"), null);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'self' https:\/\/chatgpt\.com https:\/\/\*\.chatgpt\.com/,
  );
});

test("owner risk register exposes every Phase A blocker before detailed live access", async () => {
  const response = await worker.fetch(new Request("https://control.example/"));
  const html = await response.text();
  const requiredRisks = [
    "SEC-05",
    "SEC-06",
    "SEC-03",
    "SEC-08",
    "SEC-09",
    "OPS-02",
    "INT-01",
    "INT-02",
    "QA-01",
    "QA-A4-02",
    "REV-A4-01",
    "A4-13-01",
    "A4-13-02",
    "A4-13-03",
    "CFG-01",
    "PAY-01",
    "BANK-01",
    "DATA-01",
    "REV-A1-201",
    "REV-A1-202",
    "Payroll sandbox: PASS",
    "Draft PR #1",
    "Выполнить AlfaCRM import",
    "Исправить Redirect URI",
    "Выпустить защищённую сборку Replit",
  ];

  for (const risk of requiredRisks) assert.match(html, new RegExp(risk));
  assert.doesNotMatch(html, /Исправления подготовлены/);
  assert.match(html, /3 689 raw-строк/);
  assert.match(html, /A\.4 · sandbox control/);
  assert.match(html, /29 data-import tests/);
  assert.match(html, /REVIEW PENDING/);
  assert.doesNotMatch(html, /Закрыто обязательное покрытие AlfaCRM/);
  assert.match(html, /Change discovery only/);
  assert.match(html, /strict allowlist/);
  assert.match(html, /timestamp\+hash/);
  assert.match(html, /production[\s\S]*BLOCKED/i);
  assert.doesNotMatch(html, /GitHub Actions run #\d+/);
});

test("includes every required first-checkpoint section", async () => {
  const response = await worker.fetch(new Request("https://control.example/"));
  const html = await response.text();
  const requiredLabels = [
    "Семьи",
    "Ученики",
    "Группы и классы",
    "Сотрудники",
    "Зарплата",
    "Деньги",
    "ДДС",
    "ОПиУ",
    "Финансовая модель",
    "Система",
  ];

  for (const label of requiredLabels) assert.match(html, new RegExp(label));
});

test("navigation targets and mobile drawer have complete static contracts", async () => {
  const [htmlSource, scriptSource, styleSource] = await Promise.all([
    readFile(resolve(import.meta.dirname, "../index.html"), "utf8"),
    readFile(resolve(import.meta.dirname, "../main.js"), "utf8"),
    readFile(resolve(import.meta.dirname, "../styles.css"), "utf8"),
  ]);

  const sections = new Set(
    [...htmlSource.matchAll(/data-section="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );
  const directViews = new Set(
    [...htmlSource.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]),
  );
  const moduleKeys = new Set(
    [...scriptSource.matchAll(/^  ([a-z]+): \{$/gm)].map((match) => match[1]),
  );

  for (const target of [...htmlSource.matchAll(/data-go="([^"]+)"/g)].map(
    (match) => match[1],
  )) {
    assert.ok(
      sections.has(target) || directViews.has(target) || moduleKeys.has(target),
      `CTA target ${target} must resolve to a known view`,
    );
  }

  for (const required of [
    "pulse",
    "quality",
    "sources",
    "families",
    "students",
    "groups",
    "employees",
    "payroll",
    "money",
    "cashflow",
    "pnl",
    "model",
    "system",
  ]) {
    assert.ok(sections.has(required), `missing navigation section ${required}`);
  }

  assert.match(htmlSource, /data-drawer-open/);
  assert.match(htmlSource, /data-drawer-close/);
  assert.match(scriptSource, /matchMedia\("\(max-width: 820px\)"\)/);
  assert.match(scriptSource, /aria-expanded/);
  assert.match(scriptSource, /event\.key === "Escape"/);
  assert.match(styleSource, /@media \(max-width: 820px\)/);
  assert.match(styleSource, /\.drawer-open \.sidebar/);
});

test("exposes a non-sensitive health endpoint and rejects unknown paths", async () => {
  const health = await worker.fetch(
    new Request("https://control.example/healthz"),
  );
  assert.deepEqual(await health.json(), {
    status: "ok",
    surface: "arthello-os-control",
    dataMode: "sanitized-audit",
  });

  const missing = await worker.fetch(
    new Request("https://control.example/private-data"),
  );
  assert.equal(missing.status, 404);
});
