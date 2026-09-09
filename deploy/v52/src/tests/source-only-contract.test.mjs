import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dbSource = readFileSync(resolve(import.meta.dirname, "../db/index.ts"), "utf8");
const shellSource = readFileSync(resolve(import.meta.dirname, "../app/components/ArtHelloShell.tsx"), "utf8");
const contractorsSource = readFileSync(resolve(import.meta.dirname, "../app/api/contractors/route.ts"), "utf8");

test("source-only cleanup removes synthetic records and preserves integration setup state", () => {
  assert.match(dbSource, /DELETE FROM entities WHERE source_system LIKE 'SYNTHETIC%'/);
  assert.match(dbSource, /DELETE FROM financial_operations WHERE source_system LIKE 'SYNTHETIC%'/);
  assert.doesNotMatch(dbSource, /DELETE FROM system_runtime_state WHERE state_key LIKE 'integration_setup:/);
  assert.match(dbSource, /XLSX-факты/);
});

test("source-backed families, content studio and payment contractors stay accessible without demos", () => {
  const blockedSet = shellSource.match(/const syntheticOnlyModules[\s\S]*?\]\);/)?.[0] ?? "";
  assert.doesNotMatch(blockedSet, /"clients"/);
  assert.doesNotMatch(blockedSet, /"content"/);
  assert.doesNotMatch(blockedSet, /"contractors"/);
  assert.match(contractorsSource, /financialOperations\.direction/);
  assert.match(contractorsSource, /startsWith\("SYNTHETIC"\)/);
});
