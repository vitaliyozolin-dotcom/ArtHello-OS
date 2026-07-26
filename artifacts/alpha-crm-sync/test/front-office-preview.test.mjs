import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const artifactRoot = fileURLToPath(new URL("../", import.meta.url));
const page = readFileSync(`${artifactRoot}src/pages/front-office.tsx`, "utf8");
const contract = readFileSync(
  `${artifactRoot}src/features/front-office/preview-contract.ts`,
  "utf8",
);
const shell = readFileSync(`${artifactRoot}src/AppShell.tsx`, "utf8");

test("front-office preview contains no external data access", () => {
  assert.doesNotMatch(page, /\bfetch\s*\(/);
  assert.doesNotMatch(page, /\buseQuery\s*\(/);
  assert.doesNotMatch(page, /@workspace\/api-client-react/);
  assert.doesNotMatch(page, /\blocalStorage\b/);
  assert.doesNotMatch(page, /\bWebSocket\b/);
});

test("front-office preview contract fails closed", () => {
  assert.match(contract, /autonomyMode:\s*'DRAFT_ONLY'/);
  assert.match(contract, /dataMode:\s*'SYNTHETIC'/);
  assert.match(contract, /externalReads:\s*false/);
  assert.match(contract, /externalWrites:\s*false/);
  assert.match(contract, /outboundMessages:\s*false/);
  assert.match(contract, /sharedSchemaChanges:\s*false/);
  assert.match(contract, /alfaCrmAccess:\s*false/);
  assert.match(contract, /bankAccess:\s*false/);
});

test("front-office preview is gated by env flag and owner role", () => {
  assert.match(contract, /VITE_FRONT_OFFICE_PREVIEW\s*===\s*'true'/);
  assert.match(contract, /role\s*===\s*'owner'/);
  assert.match(shell, /canViewFrontOfficePreview\(user\?\.role\)/);
});
