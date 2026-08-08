import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(
  new URL(
    "../src/features/front-office/internal-alpha-workspace.tsx",
    import.meta.url,
  ),
  "utf8",
);
const clientSource = readFileSync(
  new URL(
    "../src/features/front-office/internal-alpha-client.ts",
    import.meta.url,
  ),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/pages/front-office.tsx", import.meta.url),
  "utf8",
);

test("working desktop is mounted inside the ArtHello Front Office page", () => {
  assert.match(pageSource, /InternalAlphaWorkspace/);
  assert.match(pageSource, /Internal Alpha/);
  assert.match(workspaceSource, /Рабочая внутренняя альфа/);
  assert.match(workspaceSource, /PostgreSQL/);
});

test("durable product state never falls back to browser storage", () => {
  assert.doesNotMatch(clientSource, /localStorage|sessionStorage|indexedDB/);
  assert.match(clientSource, /\/api\/front-office\/workspace/);
});

test("UI has internal notes and AI drafts but no outbound send action", () => {
  assert.match(clientSource, /internal_note/);
  assert.match(clientSource, /ai_draft/);
  assert.doesNotMatch(clientSource, /\/send|outboundMessages|deliverMessage/);
  assert.match(workspaceSource, /Исходящей кнопки нет/);
});

test("lead edits use optimistic concurrency and explicit next action", () => {
  assert.match(clientSource, /version: number/);
  assert.match(workspaceSource, /защита от параллельной перезаписи/i);
  assert.match(workspaceSource, /Следующий шаг/);
});
