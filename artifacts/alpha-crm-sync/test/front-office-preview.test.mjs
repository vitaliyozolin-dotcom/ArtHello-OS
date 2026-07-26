import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const artifactRoot = fileURLToPath(new URL("../", import.meta.url));
const page = readFileSync(`${artifactRoot}src/pages/front-office.tsx`, "utf8");
const drawer = readFileSync(
  `${artifactRoot}src/features/front-office/lead-preview-drawer.tsx`,
  "utf8",
);
const data = readFileSync(
  `${artifactRoot}src/features/front-office/preview-data.ts`,
  "utf8",
);
const knowledge = readFileSync(
  `${artifactRoot}src/features/front-office/knowledge-preview-workspace.tsx`,
  "utf8",
);
const knowledgeData = readFileSync(
  `${artifactRoot}src/features/front-office/knowledge-preview-data.ts`,
  "utf8",
);
const contract = readFileSync(
  `${artifactRoot}src/features/front-office/preview-contract.ts`,
  "utf8",
);
const shell = readFileSync(`${artifactRoot}src/AppShell.tsx`, "utf8");

test("front-office preview contains no external data access", () => {
  const previewSources = `${page}\n${drawer}\n${data}\n${knowledge}\n${knowledgeData}`;
  assert.doesNotMatch(previewSources, /\bfetch\s*\(/);
  assert.doesNotMatch(previewSources, /\buseQuery\s*\(/);
  assert.doesNotMatch(previewSources, /@workspace\/api-client-react/);
  assert.doesNotMatch(previewSources, /\blocalStorage\b/);
  assert.doesNotMatch(previewSources, /\bWebSocket\b/);
});

test("front-office preview contract fails closed", () => {
  assert.match(contract, /autonomyMode:\s*["']DRAFT_ONLY["']/);
  assert.match(contract, /dataMode:\s*["']SYNTHETIC["']/);
  assert.match(contract, /externalReads:\s*false/);
  assert.match(contract, /externalWrites:\s*false/);
  assert.match(contract, /outboundMessages:\s*false/);
  assert.match(contract, /sharedSchemaChanges:\s*false/);
  assert.match(contract, /dataPersistence:\s*false/);
  assert.match(contract, /ephemeralUiStateOnly:\s*true/);
  assert.match(contract, /knowledgeWrites:\s*false/);
  assert.match(contract, /aiCanPublishKnowledge:\s*false/);
  assert.match(contract, /aiUseOptional:\s*true/);
  assert.match(contract, /manualWorkflowAvailable:\s*true/);
  assert.match(contract, /aiOptOutMode:\s*["']MANUAL_WORKFLOW_REMAINS["']/);
  assert.match(contract, /alfaCrmAccess:\s*false/);
  assert.match(contract, /bankAccess:\s*false/);
});

test("front-office preview is gated by env flag and owner role", () => {
  assert.match(contract, /VITE_FRONT_OFFICE_PREVIEW\s*===\s*["']true["']/);
  assert.match(contract, /role\s*===\s*["']owner["']/);
  assert.match(shell, /canViewFrontOfficePreview\(user\?\.role\)/);
});

test("interactive preview keeps send and persistence controls disabled", () => {
  assert.match(drawer, /Отправка отключена/);
  assert.match(drawer, /Сохранение отключено/);
  assert.match(drawer, /disabled/);
  assert.match(page, /PREVIEW_SERVICE_TICKETS/);
  assert.match(page, /selectedLeadId/);
});

test("knowledge preview fails closed when evidence or approval is missing", () => {
  assert.match(page, /KnowledgePreviewWorkspace/);
  assert.match(knowledge, /Публикация отключена/);
  assert.match(knowledge, /Редактирование отключено/);
  assert.match(knowledge, /Создание статьи отключено/);
  assert.match(knowledge, /PREVIEW_KNOWLEDGE_GAPS/);
  assert.match(knowledgeData, /status:\s*["']APPROVED["']/);
  assert.match(knowledgeData, /status:\s*["']STALE["']/);
  assert.match(knowledgeData, /aiEligible:\s*true/);
  assert.match(knowledgeData, /aiEligible:\s*false/);
  assert.match(knowledgeData, /SOURCE-MISSING/);
});
