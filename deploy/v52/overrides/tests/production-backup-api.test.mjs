import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("../app/api/settings/backups/route.ts", import.meta.url);
const source = await readFile(routeUrl, "utf8");

test("backup settings API is restricted to the canonical owner with a permanent password", () => {
  assert.match(source, /getAuthenticatedRequestContext\(request\)/);
  assert.match(source, /isCanonicalOwnerContext\(context\)/);
  assert.match(source, /context\.auth\.user\.mustChangePassword/);
  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /export async function POST\(request: Request\)/);
});

test("backup mutations enforce CSRF and current-password verification for restore", () => {
  assert.match(source, /verifyAuthenticatedRequestCsrf\(request, context\)/);
  assert.match(source, /body\.confirmation !== RESTORE_CONFIRMATION/);
  assert.match(source, /const RESTORE_CONFIRMATION = "ВОССТАНОВИТЬ"/);
  assert.match(source, /safeId\(body\.backupId\)/);
  assert.match(source, /verifyCurrentPassword\(context, body\.currentPassword\)/);
  assert.match(source, /error\.status === 429/);
});

test("backup control is fail-closed on an authenticated IPv4 loopback origin", () => {
  assert.match(source, /ARTHELLO_BACKUP_CONTROL_URL/);
  assert.match(source, /ARTHELLO_BACKUP_CONTROL_TOKEN/);
  assert.match(source, /token\.length < 32/);
  assert.match(source, /\^http:\\\/\\\/127\\\.0\\\.0\\\.1:/);
  assert.match(source, /authorization: `Bearer \$\{token\}`/);
  assert.match(source, /redirect: "error"/);
  assert.match(source, /CONTROL_TIMEOUT_MS/);
  assert.doesNotMatch(source, /process\.env/);
});

test("API uses only the documented internal directions and an idempotency key", () => {
  assert.match(source, /callBackupControl\("\/v1\/backups", \{ method: "GET" \}\)/);
  assert.match(source, /endpoint = "\/v1\/backups"/);
  assert.match(source, /endpoint = "\/v1\/restores"/);
  assert.match(source, /headers\.set\("idempotency-key", init\.idempotencyKey\)/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /status === 409/);
  assert.match(source, /actor: context\.appUserId/g);
  assert.doesNotMatch(source, /context\.(?:actor|appUserName)/);
});

test("responses and control requests cannot be cached", () => {
  assert.match(source, /private, no-store, max-age=0/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /"cache-control": "no-store"/);
});

test("internal response bodies and filesystem locations are never proxied", () => {
  assert.match(source, /sanitizeCatalog\(control\.payload\)/);
  assert.match(source, /sanitizeOperationEnvelope\(control\.payload\)/);
  assert.match(source, /safeScope/);
  assert.doesNotMatch(source, /jsonResponse\(control\.payload/);
  assert.doesNotMatch(source, /(?:filePath|storagePath|absolutePath)\s*:/);
  assert.doesNotMatch(source, /(?:error|message):\s*(?:control|raw|payload)\./);
});
