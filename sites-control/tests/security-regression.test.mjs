import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");

test("public credential and indexing regressions stay removed", async () => {
  const [login, auth, html, robots] = await Promise.all([
    readFile(resolve(projectRoot, "artifacts/alpha-crm-sync/src/pages/login.tsx"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/routes/auth.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/alpha-crm-sync/index.html"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/alpha-crm-sync/public/robots.txt"), "utf8"),
  ]);

  const combined = `${login}\n${auth}`;
  assert.doesNotMatch(combined, /owner123|accountant123|viewer123/i);
  assert.doesNotMatch(login, /<option value="(?:owner|accountant|viewer)"/i);
  assert.match(login, /autoComplete="username"/);
  assert.match(auth, /process\.env\.VIEWER_PASSWORD/);
  assert.match(html, /noindex, nofollow, noarchive, nosnippet/);
  assert.match(robots, /Disallow: \//);
});

test("API defaults to an authenticated, origin-restricted surface", async () => {
  const [app, client, alfa, coverage, integrations] = await Promise.all([
    readFile(resolve(projectRoot, "artifacts/api-server/src/app.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/alpha-crm-sync/src/context/AuthContext.tsx"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/alphaCrmClient.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/routes/coverage.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/alpha-crm-sync/src/pages/integrations.tsx"), "utf8"),
  ]);

  assert.match(app, /requireAuth\(req, res, next\)/);
  assert.match(app, /requireCsrf\(req, res, next\)/);
  assert.match(app, /requireRouteAccess\(req, res, next\)/);
  assert.match(app, /process\.env\.APP_ORIGINS/);
  assert.doesNotMatch(app, /app\.use\(cors\(\)\)/);
  assert.doesNotMatch(app, /publicRoute[\s\S]*website-lead/);
  assert.doesNotMatch(client, /localStorage|auth_token|Authorization:\s*`Bearer/);
  assert.match(client, /credentials:\s*'same-origin'/);
  assert.doesNotMatch(`${alfa}\n${coverage}\n${integrations}`, /arthellonew\.s20\.online/i);
  assert.match(alfa, /if \(!DOMAIN\)[\s\S]*throw new Error\("ALFACRM_DOMAIN is required/);
  assert.match(alfa, /SerializedRequestQueue/);
  assert.match(alfa, /minIntervalMs:\s*260/);
  assert.match(alfa, /authInFlight/);
  assert.doesNotMatch(alfa, /not concurrency-safe yet/);
});

test("A.1 security controls are explicit without claiming production readiness", async () => {
  const [
    auth,
    policy,
    sessionMigration,
    scopeMigration,
    sessionRollback,
    scopeRollback,
    accessAudit,
    startupMigration,
    serverEntry,
    logger,
    evotor,
    websiteWebhook,
    websiteLeadService,
    banking,
    healthSanitizer,
    schemaGate,
    schemaInventory,
    auditPolicy,
  ] = await Promise.all([
    readFile(resolve(projectRoot, "artifacts/api-server/src/routes/auth.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/security/access-policy.ts"), "utf8"),
    readFile(resolve(projectRoot, "lib/db/drizzle/0009_famous_ma_gnuci.sql"), "utf8"),
    readFile(resolve(projectRoot, "lib/db/drizzle/0010_outstanding_cargill.sql"), "utf8"),
    readFile(resolve(projectRoot, "lib/db/rollbacks/0009_auth_security.down.sql"), "utf8"),
    readFile(resolve(projectRoot, "lib/db/rollbacks/0010_auth_scope_audit.down.sql"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/security/access-audit.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/migrate.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/index.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/logger.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/routes/evotor.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/routes/webhooks.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/webhooks/website-lead-service.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/routes/banking.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/banking/sanitize-health.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/security/security-schema-gate.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/security/security-schema-inventory.ts"), "utf8"),
    readFile(resolve(projectRoot, "artifacts/api-server/src/lib/security/access-audit-policy.ts"), "utf8"),
  ]);

  assert.match(auth, /httpOnly:\s*true/);
  assert.match(auth, /sameSite:\s*"strict"/);
  assert.match(auth, /AUTH_LOGIN_MAX_ATTEMPTS/);
  assert.match(policy, /write-denied/);
  assert.match(policy, /scope-route-not-enforced/);
  assert.match(sessionMigration, /CREATE TABLE "auth_sessions"/);
  assert.match(scopeMigration, /CREATE TABLE "security_access_audit"/);
  assert.match(sessionRollback, /DROP TABLE IF EXISTS "auth_sessions"/);
  assert.match(scopeRollback, /DROP TABLE IF EXISTS "security_access_audit"/);
  assert.match(accessAudit, /INSERT INTO security_access_audit/);
  assert.match(startupMigration, /startup is blocked/);
  assert.match(serverEntry, /process\.exit\(1\)/);
  assert.match(serverEntry, /await assertSecuritySchemaReady\(\)/);
  assert.match(logger, /sanitizeLogRecord/);
  assert.doesNotMatch(evotor, /fallback-key/);
  assert.match(websiteWebhook, /Idempotency-Key header is required/);
  assert.match(websiteWebhook, /db\.transaction/);
  assert.match(websiteWebhook, /pg_advisory_xact_lock/);
  assert.match(websiteLeadService, /IdempotencyPayloadConflict/);
  assert.match(websiteLeadService, /storedPayloadHash !== payloadHash/);
  assert.doesNotMatch(banking, /json\(\{ error: String\(err\) \}\)/);
  assert.match(banking, /sanitizeConnectorHealthResponse/);
  assert.doesNotMatch(healthSanitizer, /\.\.\.value|\.\.\.health/);
  assert.match(schemaGate, /information_schema\.columns/);
  assert.match(schemaGate, /drizzle\.__drizzle_migrations/);
  assert.match(schemaInventory, /REQUIRED_SECURITY_MIGRATIONS/);
  assert.match(schemaInventory, /expected hash/);
  assert.match(auditPolicy, /\/unregistered\/:path/);
});

test("Sites build contract stays package-manager-neutral", async () => {
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));

  assert.doesNotMatch(packageJson.scripts.build, /\bpnpm\b/);
  assert.match(packageJson.scripts.build, /sites-control\/scripts\/build\.mjs/);
  assert.match(packageJson.scripts["build:full"], /\bpnpm\b/);
});

test("GitHub quality evidence is pinned to the PR head and exported immutably", async () => {
  const workflow = await readFile(
    resolve(projectRoot, ".github/workflows/quality.yml"),
    "utf8",
  );

  assert.match(
    workflow,
    /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/,
  );
  assert.match(workflow, /test "\$actual_head" = "\$EXPECTED_HEAD_SHA"/);
  assert.match(workflow, /git rev-parse HEAD\^\{tree\}/);
  assert.match(workflow, /source_archive_sha256/);
  assert.match(workflow, /sites_artifact_sha256/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /arthello-provenance-\$\{\{\s*github\.run_id\s*\}\}/);
});
