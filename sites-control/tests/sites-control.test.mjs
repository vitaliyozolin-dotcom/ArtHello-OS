import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workerSource = await readFile(resolve(import.meta.dirname, "../../dist/server/index.js"), "utf8");
const workerUrl = `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`;
const { default: worker } = await import(workerUrl);

test("serves the sanitized owner control surface with noindex headers", async () => {
  const response = await worker.fetch(new Request("https://control.example/"));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.match(html, /Только обезличенные данные/);
  assert.match(html, /Финансовая правда/);
  assert.match(html, /Auth подтверждена/);
  assert.match(html, /8 подтверждено live/);
  assert.match(html, /Production \/ detailed live data: BLOCKED/);
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
    "SEC-08",
    "SEC-09",
    "OPS-02",
    "INT-01",
    "INT-02",
    "QA-01",
    "CFG-01",
    "REV-A1-201",
    "REV-A1-202",
    "CI evidence ещё отсутствует",
    "Закрыть оставшиеся HIGH",
    "PostgreSQL 16 suite",
    "Технический probe разрешён",
    "Расширить read-only инвентаризацию",
  ];

  for (const risk of requiredRisks) assert.match(html, new RegExp(risk));
  assert.doesNotMatch(html, /Исправления подготовлены/);
  assert.match(html, /Encrypted bank config, AlfaCRM queue, sessions, atomic webhook и schema preflight/);
  assert.match(html, /A\.3 · source v5/);
  assert.match(html, /strict allowlist/);
  assert.match(html, /timestamp\+hash/);
  assert.match(html, /production[\s\S]*BLOCKED/i);
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

test("exposes a non-sensitive health endpoint and rejects unknown paths", async () => {
  const health = await worker.fetch(new Request("https://control.example/healthz"));
  assert.deepEqual(await health.json(), {
    status: "ok",
    surface: "arthello-os-control",
    dataMode: "sanitized-audit",
  });

  const missing = await worker.fetch(new Request("https://control.example/private-data"));
  assert.equal(missing.status, 404);
});
