import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyD067 } from "../scripts/patch-safe-json-responses.mjs";

test("D-067 replaces unsafe response.json calls in finance and integrations", async () => {
  const root = await mkdtemp(join(tmpdir(), "arthello-d067-"));
  await mkdir(join(root, "app/components"), { recursive: true });

  await writeFile(join(root, "app/components/FinanceWorkspace.tsx"), [
    'import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";',
    '      const payload = await response.json() as FinanceData & { error?: string };',
    '      const payload = await response.json() as { error?: string; reused?: boolean };',
  ].join("\n"), "utf8");

  await writeFile(join(root, "app/components/IntegrationWorkspace.tsx"), [
    'import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";',
    '      const payload = await response.json() as Data & { error?: string };',
    '      const payload = await response.json() as ActionPayload;',
  ].join("\n"), "utf8");

  assert.equal(await applyD067(root), true);
  assert.equal(await applyD067(root), false, "patch must be idempotent");

  const finance = await readFile(join(root, "app/components/FinanceWorkspace.tsx"), "utf8");
  const integration = await readFile(join(root, "app/components/IntegrationWorkspace.tsx"), "utf8");
  assert.match(finance, /readJsonResponse<FinanceData/);
  assert.match(finance, /readJsonResponse<\{ error\?: string; reused\?: boolean \}>/);
  assert.match(integration, /readJsonResponse<Data/);
  assert.match(integration, /readJsonResponse<ActionPayload>/);
  assert.doesNotMatch(finance, /response\.json\(\)/);
  assert.doesNotMatch(integration, /response\.json\(\)/);
});

test("D-067 helper converts empty or invalid bodies into user-facing errors", async () => {
  const source = await readFile(new URL("../lib/response-json.ts", import.meta.url), "utf8");
  assert.match(source, /await response\.text\(\)/);
  assert.match(source, /Сервис временно не ответил/);
  assert.match(source, /Сервис вернул некорректный ответ/);
  assert.doesNotMatch(source, /response\.json\(\)/);
});
