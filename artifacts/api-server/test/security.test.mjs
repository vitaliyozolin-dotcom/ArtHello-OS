import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(testDir, "..");
const workspaceDir = path.resolve(artifactDir, "../..");

const accessPolicy = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/security/access-policy.ts",
    ),
  ).href
);
const logSanitizer = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/security/log-sanitizer.ts",
    ),
  ).href
);
const accessAudit = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/security/access-audit-policy.ts",
    ),
  ).href
);
const websiteLeadService = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/webhooks/website-lead-service.ts",
    ),
  ).href
);
const connectorHealthSanitizer = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/banking/sanitize-health.ts",
    ),
  ).href
);
const bankConfigVault = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/banking/config-vault.ts",
    ),
  ).href
);
const bankingOAuthRedirect = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/banking/oauth-redirect.ts",
    ),
  ).href
);
const requestQueueModule = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/serialized-request-queue.ts",
    ),
  ).href
);
const securitySchemaInventory = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/security/security-schema-inventory.ts",
    ),
  ).href
);
const publicErrorBoundaryModule = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/security/public-error-boundary.ts",
    ),
  ).href
);
const legacySyncGateModule = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/security/legacy-sync-gate.ts",
    ),
  ).href
);
const financialInvariants = await import(
  pathToFileURL(
    path.join(
      artifactDir,
      "src/lib/finance/financial-invariants.ts",
    ),
  ).href
);

const restrictedScope = {
  unrestricted: false,
  branchIds: ["branch-6"],
  legalEntityIds: ["entity-1"],
};

test("owner keeps full authenticated access", () => {
  assert.equal(
    accessPolicy.decideRouteAccess("owner", "POST", "/sync/students")
      .allowed,
    true,
  );
});

test("non-owner business access fails closed until handlers enforce both scopes", () => {
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "GET",
      "/finance",
      restrictedScope,
    ).allowed,
    false,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "GET",
      "/employees",
      restrictedScope,
    ).policy,
    "scope-route-not-enforced",
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "GET",
      "/finance",
      {
        unrestricted: false,
        branchIds: ["branch-6"],
        legalEntityIds: [],
      },
    ).policy,
    "scope-required",
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "GET",
      "/auth/me",
      restrictedScope,
    ).allowed,
    true,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "POST",
      "/auth/logout",
      restrictedScope,
    ).allowed,
    true,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "POST",
      "/finance/import",
      restrictedScope,
    ).allowed,
    false,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "GET",
      "/auth/users",
      restrictedScope,
    ).allowed,
    false,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "GET",
      "/banking/connectors/42/customers",
      restrictedScope,
    ).allowed,
    false,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "viewer",
      "GET",
      "/banking/connectors/42/health",
      restrictedScope,
    ).allowed,
    false,
  );
});

test("accountant mutations stay disabled until route-level scope predicates exist", () => {
  assert.equal(
    accessPolicy.decideRouteAccess(
      "accountant",
      "PATCH",
      "/contracts/42",
      restrictedScope,
    ).allowed,
    false,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "accountant",
      "PATCH",
      "/banking/connectors/42",
      restrictedScope,
    ).allowed,
    false,
  );
  assert.equal(
    accessPolicy.decideRouteAccess(
      "accountant",
      "PATCH",
      "/banking/transactions/42/match",
      restrictedScope,
    ).allowed,
    false,
  );
});

test("cross-scope business routes remain fail closed for every non-owner role", () => {
  const crossScopeCases = [
    ["viewer", "GET", "/employees/employee-from-another-branch"],
    ["viewer", "GET", "/finance?legalEntityId=entity-elsewhere"],
    ["accountant", "GET", "/banking/transactions?branchId=branch-elsewhere"],
    ["accountant", "PATCH", "/employees/employee-from-another-entity"],
  ];

  for (const [role, method, route] of crossScopeCases) {
    const decision = accessPolicy.decideRouteAccess(
      role,
      method,
      route,
      restrictedScope,
    );
    assert.equal(decision.allowed, false, `${role} ${method} ${route}`);
  }
});

test("legacy sync and provider callbacks stay fail closed", async () => {
  const appSource = await readFile(
    path.join(artifactDir, "src/app.ts"),
    "utf8",
  );

  let nextCalled = false;
  let responseStatus = 200;
  let responseBody;
  const response = {
    statusCode: 200,
    status(code) {
      responseStatus = code;
      this.statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  publicErrorBoundaryModule.publicErrorBoundary(
    {},
    response,
    () => {},
  );
  legacySyncGateModule.blockLegacySyncSurface(
    { path: "/sync/discover" },
    response,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(responseStatus, 503);
  assert.deepEqual(responseBody, {
    success: false,
    error: "LEGACY_SYNC_DISABLED",
  });
  assert.match(appSource, /blockLegacySyncSurface/);
  assert.doesNotMatch(
    appSource,
    /req\.method === "POST"[\s\S]{0,120}req\.path === "\/(?:webhooks(?:\/website-lead)?|evotor|banking\/webhook)"/,
  );
});

test("sensitive access audit canonicalizes identifiers and skips only account lifecycle", () => {
  const identifierCases = [
    "/employees/customer-abc",
    "/employees/alice@example.com",
    "/employees/+79991234567",
    "/employees/8b7e37ad-d47f-4a59-8d03-fdb11784cc6f",
    "/employees/123456",
    "/employees/alice%40example.com",
    "/employees/%2B79991234567",
  ];
  for (const requestPath of identifierCases) {
    assert.equal(
      accessAudit.canonicalAuditPath(requestPath),
      "/employees/:path",
    );
  }
  assert.equal(
    accessAudit.canonicalAuditPath(
      "/banking/connectors/8b7e37ad-d47f-4a59-8d03-fdb11784cc6f/health?verbose=true",
    ),
    "/banking/connectors/:id/health",
  );
  assert.equal(
    accessAudit.canonicalAuditPath("/banking/connectors"),
    "/banking/connectors",
  );
  assert.equal(
    accessAudit.canonicalAuditPath(
      "/not-registered/alice@example.com",
    ),
    "/unregistered/:path",
  );
  assert.equal(accessAudit.shouldAuditAccess("GET", "/auth/me"), false);
  assert.equal(
    accessAudit.shouldAuditAccess("GET", "/employees/123"),
    true,
  );
});

test("connector health response uses a strict allowlist", () => {
  const sanitized =
    connectorHealthSanitizer.sanitizeConnectorHealthResponse({
      status: "active",
      checkedAt: "2026-07-24T00:00:00.000Z",
      authOk: true,
      scopesGranted: ["accounts", "transactions"],
      hasAccountsScope: true,
      hasTransactionsScope: true,
      accountsAccessOk: true,
      transactionsAccessOk: true,
      diagnosticCode: "ok",
      environment: "sandbox",
      accountCount: 2,
      accessToken: "must-never-leak",
      futureSecret: "unknown-fields-must-be-dropped",
      message: "upstream response may contain a secret",
      debug: {
        customerCode: "private-customer",
      },
    });

  assert.equal(sanitized.status, "active");
  assert.equal(sanitized.authOk, true);
  assert.equal(sanitized.accountCount, 2);
  assert.equal(sanitized.message, "Connector check completed");
  assert.equal(sanitized.diagnosticMessage, "ok");
  assert.equal(Object.hasOwn(sanitized, "accessToken"), false);
  assert.equal(Object.hasOwn(sanitized, "futureSecret"), false);
  assert.equal(Object.hasOwn(sanitized, "debug"), false);
  assert.doesNotMatch(JSON.stringify(sanitized), /must-never-leak|private-customer|upstream response/);
});

function createTransactionalWebsiteLeadStore(failOnceAt) {
  const state = {
    rawEvents: [],
    leadEvents: [],
    websiteSourceTouches: 0,
  };
  let nextRawId = 1;
  let remainingFailure = failOnceAt;

  const maybeFail = (operation) => {
    if (remainingFailure === operation) {
      remainingFailure = undefined;
      throw new Error(`injected failure at ${operation}`);
    }
  };

  return {
    state,
    async transaction(callback) {
      const snapshot = structuredClone(state);
      const nextRawIdSnapshot = nextRawId;
      try {
        return await callback({
          async lock() {},
          async findRawByHash(hash) {
            return state.rawEvents.find((row) => row.hash === hash);
          },
          async insertRaw(input) {
            maybeFail("insertRaw");
            const row = {
              ...structuredClone(input),
              id: `raw-${nextRawId++}`,
            };
            state.rawEvents.push(row);
            return row;
          },
          async findLeadByRawEventId(rawEventId) {
            return state.leadEvents.find(
              (row) => row.rawEventId === rawEventId,
            );
          },
          async insertLead(input) {
            maybeFail("insertLead");
            state.leadEvents.push(structuredClone(input));
          },
          async markRawProcessed(rawEventId) {
            maybeFail("markRawProcessed");
            const row = state.rawEvents.find(
              (candidate) => candidate.id === rawEventId,
            );
            if (!row) throw new Error("raw event not found");
            row.processed = true;
          },
          async touchWebsiteSource() {
            maybeFail("touchWebsiteSource");
            state.websiteSourceTouches += 1;
          },
        });
      } catch (error) {
        state.rawEvents = snapshot.rawEvents;
        state.leadEvents = snapshot.leadEvents;
        state.websiteSourceTouches =
          snapshot.websiteSourceTouches;
        nextRawId = nextRawIdSnapshot;
        throw error;
      }
    },
  };
}

const websiteLeadPayload = {
  name: "Test Owner",
  phone: "",
  email: "test@example.invalid",
  message: "",
  source: "website",
  campaign: "",
  branch: "",
  form_url: "https://example.invalid/form",
  utm_source: "",
  utm_medium: "",
  utm_campaign: "",
  utm_content: "",
  utm_term: "",
};

test("website lead canonical hash is stable and binds key to payload", () => {
  const reorderedPayload = Object.fromEntries(
    Object.entries(websiteLeadPayload).reverse(),
  );
  assert.equal(
    websiteLeadService.websiteLeadPayloadHash(
      websiteLeadPayload,
    ),
    websiteLeadService.websiteLeadPayloadHash(
      reorderedPayload,
    ),
  );
  assert.notEqual(
    websiteLeadService.websiteLeadPayloadHash(
      websiteLeadPayload,
    ),
    websiteLeadService.websiteLeadPayloadHash({
      ...websiteLeadPayload,
      email: "changed@example.invalid",
    }),
  );
});

test("website lead transaction rolls back a mid-write failure and retry creates exactly one pair", async () => {
  const store = createTransactionalWebsiteLeadStore(
    "insertLead",
  );
  const input = {
    idempotencyKey: "website-test-key-0001",
    payload: websiteLeadPayload,
    receivedAt: new Date("2026-07-24T12:00:00.000Z"),
    ip: null,
  };

  await assert.rejects(
    websiteLeadService.processWebsiteLead(store, input),
    /injected failure at insertLead/,
  );
  assert.equal(store.state.rawEvents.length, 0);
  assert.equal(store.state.leadEvents.length, 0);

  const created =
    await websiteLeadService.processWebsiteLead(store, input);
  assert.equal(created.duplicate, false);
  assert.equal(created.recovered, false);
  assert.equal(store.state.rawEvents.length, 1);
  assert.equal(store.state.leadEvents.length, 1);
  assert.equal(store.state.rawEvents[0].processed, true);

  const duplicate =
    await websiteLeadService.processWebsiteLead(store, input);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.state.rawEvents.length, 1);
  assert.equal(store.state.leadEvents.length, 1);
});

test("website lead rejects reuse of a key for a different canonical payload", async () => {
  const store = createTransactionalWebsiteLeadStore();
  const baseInput = {
    idempotencyKey: "website-test-key-0002",
    payload: websiteLeadPayload,
    receivedAt: new Date("2026-07-24T12:00:00.000Z"),
    ip: null,
  };
  await websiteLeadService.processWebsiteLead(store, baseInput);

  await assert.rejects(
    websiteLeadService.processWebsiteLead(store, {
      ...baseInput,
      payload: {
        ...websiteLeadPayload,
        email: "changed@example.invalid",
      },
    }),
    websiteLeadService.IdempotencyPayloadConflict,
  );
  assert.equal(store.state.rawEvents.length, 1);
  assert.equal(store.state.leadEvents.length, 1);
});

test("website lead retry repairs a legacy raw-only partial write without creating another raw event", async () => {
  const store = createTransactionalWebsiteLeadStore();
  const idempotencyKey = "website-test-key-legacy-0003";
  const payloadHash =
    websiteLeadService.websiteLeadPayloadHash(
      websiteLeadPayload,
    );
  store.state.rawEvents.push({
    id: "legacy-raw-1",
    hash: websiteLeadService.websiteLeadEventHash(
      idempotencyKey,
    ),
    raw: {
      ...websiteLeadPayload,
      idempotency_payload_hash: payloadHash,
    },
    processed: false,
  });

  const repaired =
    await websiteLeadService.processWebsiteLead(store, {
      idempotencyKey,
      payload: websiteLeadPayload,
      receivedAt: new Date("2026-07-24T12:00:00.000Z"),
      ip: null,
    });

  assert.equal(repaired.duplicate, false);
  assert.equal(repaired.recovered, true);
  assert.equal(store.state.rawEvents.length, 1);
  assert.equal(store.state.rawEvents[0].processed, true);
  assert.equal(store.state.leadEvents.length, 1);
  assert.equal(
    store.state.leadEvents[0].rawEventId,
    "legacy-raw-1",
  );
});

test("website lead route binds the tested service to one Postgres transaction and advisory lock", async () => {
  const webhookRoute = await readFile(
    path.join(artifactDir, "src/routes/webhooks.ts"),
    "utf8",
  );

  assert.match(webhookRoute, /db\.transaction/);
  assert.match(webhookRoute, /pg_advisory_xact_lock/);
  assert.match(webhookRoute, /processWebsiteLead/);
  assert.match(webhookRoute, /res\.status\(409\)/);
  assert.doesNotMatch(webhookRoute, /onConflictDoNothing/);
});

function completeSecuritySchemaInventory() {
  return {
    columns: Object.entries(
      securitySchemaInventory.REQUIRED_SECURITY_TABLE_COLUMNS,
    ).flatMap(([tableName, columnNames]) =>
      columnNames.map((columnName) => ({
        tableName,
        columnName,
      })),
    ),
    indexes: [
      ...securitySchemaInventory.REQUIRED_SECURITY_INDEXES,
    ],
    migrations:
      securitySchemaInventory.REQUIRED_SECURITY_MIGRATIONS.map(
        (entry) => ({ ...entry }),
      ),
  };
}

test("security schema inventory gate requires every column, index, migration timestamp and hash", () => {
  const complete = completeSecuritySchemaInventory();
  assert.doesNotThrow(() =>
    securitySchemaInventory.validateSecuritySchemaInventory(
      complete,
    ),
  );

  assert.throws(
    () =>
      securitySchemaInventory.validateSecuritySchemaInventory({
        ...complete,
        columns: complete.columns.filter(
          ({ tableName, columnName }) =>
            !(
              tableName === "auth_sessions" &&
              columnName === "scope_mode"
            ),
        ),
      }),
    /column is missing: auth_sessions\.scope_mode/,
  );
  assert.throws(
    () =>
      securitySchemaInventory.validateSecuritySchemaInventory({
        ...complete,
        indexes: complete.indexes.filter(
          (name) =>
            name !== "security_access_audit_session_idx",
        ),
      }),
    /index is missing: security_access_audit_session_idx/,
  );
  assert.throws(
    () =>
      securitySchemaInventory.validateSecuritySchemaInventory({
        ...complete,
        migrations: complete.migrations.map((entry, index) =>
          index === 1
            ? { ...entry, hash: "wrong-hash" }
            : entry,
        ),
      }),
    /expected hash: 1784858251868/,
  );
});

test("structured log sanitizer removes secrets, banking identities, and raw payloads", () => {
  const sanitized = logSanitizer.sanitizeLogRecord({
    connectorId: "safe-id",
    accessToken: "secret-token",
    customerCode: "customer-123",
    response: {
      rawBody: '{"phone":"+79991234567"}',
    },
    accountId: "private-account-id",
    statementId: "private-statement-id",
    parsedBalanceValue: 100,
    amount: 50,
    contact: "owner@example.com",
  });

  assert.equal(sanitized.connectorId, "safe-id");
  assert.equal(sanitized.accessToken, "[REDACTED]");
  assert.equal(sanitized.customerCode, "[REDACTED]");
  assert.equal(sanitized.response, "[REDACTED]");
  assert.equal(sanitized.accountId, "[REDACTED]");
  assert.equal(sanitized.statementId, "[REDACTED]");
  assert.equal(sanitized.parsedBalanceValue, "[REDACTED]");
  assert.equal(sanitized.amount, "[REDACTED]");
  assert.equal(sanitized.contact, "[REDACTED_EMAIL]");
});

test("Tochka OAuth redirect is exact, backend-only, and required in production", () => {
  assert.equal(
    bankingOAuthRedirect.resolveTochkaOAuthRedirectUri({
      NODE_ENV: "production",
      TOCHKA_OAUTH_REDIRECT_URI:
        "https://api.example.invalid/api/banking/oauth/callback",
    }),
    "https://api.example.invalid/api/banking/oauth/callback",
  );
  assert.throws(
    () =>
      bankingOAuthRedirect.resolveTochkaOAuthRedirectUri({
        NODE_ENV: "production",
      }),
    /required in production/,
  );
  assert.throws(
    () =>
      bankingOAuthRedirect.resolveTochkaOAuthRedirectUri({
        NODE_ENV: "production",
        TOCHKA_OAUTH_REDIRECT_URI:
          "https://api.example.invalid/",
      }),
    /exact path/,
  );
  assert.throws(
    () =>
      bankingOAuthRedirect.resolveTochkaOAuthRedirectUri({
        NODE_ENV: "production",
        TOCHKA_OAUTH_REDIRECT_URI:
          "https://arthello-os-control.example.chatgpt.site/api/banking/oauth/callback",
      }),
    /Sites cannot receive/,
  );
});

test("Tochka OAuth source is read-only, scope-consistent, and state-strict", async () => {
  const connectorSource = await readFile(
    path.join(
      artifactDir,
      "src/lib/banking/connectors/tochka.ts",
    ),
    "utf8",
  );
  const bankingRoute = await readFile(
    path.join(artifactDir, "src/routes/banking.ts"),
    "utf8",
  );

  assert.match(
    connectorSource,
    /OAUTH_SCOPE_READ_ONLY\s*=\s*\n?\s*"accounts balances customers statements"/,
  );
  assert.doesNotMatch(
    connectorSource,
    /OAUTH_SCOPE_READ_ONLY[\s\S]{0,120}\b(?:payments|sbp|acquiring)\b/,
  );
  assert.doesNotMatch(
    connectorSource,
    /"(?:CreatePaymentForSign|CreatePaymentOrder|MakeAcquiringOperation|EditSBPData)"/,
  );
  assert.doesNotMatch(
    connectorSource,
    /logger\.info\(\{[^}]*\b(?:authorizeUrl|consentId|tokenLength)\b/,
  );
  assert.match(
    connectorSource,
    /encrypted config persistence failed[\s\S]{0,220}throw new Error/,
  );
  assert.match(
    connectorSource,
    /\.returning\(\{ id: bankConnectorsTable\.id \}\)[\s\S]{0,180}Object\.assign\(this\.config, merged\)/,
  );
  assert.doesNotMatch(
    connectorSource,
    /failed to persist config \(non-fatal\)/,
  );
  assert.match(
    bankingRoute,
    /OAuthStateSchema[\s\S]{0,160}safeParse\(req\.body\)/,
  );
  assert.match(
    bankingRoute,
    /typeof config\["oauthState"\] !== "string"/,
  );
  assert.doesNotMatch(
    bankingRoute,
    /req\.log\.info\(\{\s*bank,\s*body\s*\}/,
  );
});

test("logged Error objects never expose their message or stack", () => {
  const error = Object.assign(
    new Error("token=secret and customer payload"),
    { code: "UPSTREAM_FAILURE", status: 502 },
  );
  const sanitized = logSanitizer.sanitizeLogRecord({ err: error });

  assert.deepEqual(sanitized, {
    err: {
      type: "Error",
      code: "UPSTREAM_FAILURE",
      status: 502,
    },
  });
});

test("5xx response boundary removes exception, upstream, and PII details", () => {
  let sentBody;
  const response = {
    statusCode: 502,
    json(body) {
      sentBody = body;
      return this;
    },
  };

  publicErrorBoundaryModule.publicErrorBoundary(
    {},
    response,
    () => {},
  );
  response.json({
    error: "token=secret",
    message: "owner@example.com",
    detail: { rawBody: '{"phone":"+79991234567"}' },
  });

  assert.deepEqual(sentBody, {
    success: false,
    error: "INTERNAL_ERROR",
  });
  assert.doesNotMatch(
    JSON.stringify(sentBody),
    /secret|example\.com|phone|rawBody/,
  );
});

test("banking match handlers expose fixed error codes, never String(err)", async () => {
  const source = await readFile(
    path.join(
      artifactDir,
      "src/routes/banking-match.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /res\.status\((?:400|500)\)\.json\(\{\s*error:\s*(?:String\(err\)|`[^`]*\$\{)/,
  );
  assert.match(source, /BANK_MATCHING_FAILED/);
  assert.match(source, /BANK_MATCH_REPAIR_FAILED/);
  assert.match(source, /INVALID_MATCH_ACTION/);
});

test("Tochka connector never logs or throws raw upstream bodies", async () => {
  const source = await readFile(
    path.join(
      artifactDir,
      "src/lib/banking/connectors/tochka.ts",
    ),
    "utf8",
  );

  assert.match(source, /function upstreamError/);
  assert.match(source, /function responseShape/);
  assert.doesNotMatch(source, /fullBody\.slice\(/);
  assert.doesNotMatch(source, /\brawBody:\s*body\b/);
  assert.doesNotMatch(source, /\bresponseBody:\s*apiBodyDebug\b/);
  assert.doesNotMatch(source, /\bfirstCustomerRaw\b|\bcustomerRaw\b/);
  assert.doesNotMatch(source, /\bdata_block_sample\b/);
  assert.doesNotMatch(
    source,
    /throw new Error\([^)]*\$\{(?:fullBody|body|text)\}/,
  );
  assert.doesNotMatch(source, /\berror:\s*String\(err\)/);
  assert.doesNotMatch(
    source,
    /customersCount:\s*customers\.length,\s*\n\s*customers,/,
  );
  assert.doesNotMatch(
    source,
    /diagnosticMessage:[\s\S]{0,400}\n\s*resolvedCustomerCode,/,
  );
});

test("live integration probe emits only sanitized aggregate evidence", async () => {
  const source = await readFile(
    path.join(
      artifactDir,
      "src/scripts/probe-live-integrations.ts",
    ),
    "utf8",
  );

  assert.match(source, /secretsPersisted:\s*false/);
  assert.match(source, /personalDataReturned:\s*false/);
  assert.match(source, /consentCreated:\s*false/);
  assert.match(source, /paymentActionAttempted:\s*false/);
  assert.match(source, /SerializedRequestQueue/);
  assert.match(source, /consecutiveNetworkFailures\s*>=\s*2/);
  assert.doesNotMatch(source, /coverage\[String\(branchId\)\]/);
  const outputBlock = source.slice(source.indexOf("const result = {"));
  assert.doesNotMatch(
    outputBlock,
    /\b(?:apiKey|clientSecret|serviceToken|token|process\.env|text)\b/,
  );
});

test("web authentication no longer persists bearer tokens in browser storage", async () => {
  const authContext = await readFile(
    path.join(
      workspaceDir,
      "artifacts/alpha-crm-sync/src/context/AuthContext.tsx",
    ),
    "utf8",
  );
  const authRoute = await readFile(
    path.join(
      artifactDir,
      "src/routes/auth.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(authContext, /localStorage|auth_token/);
  assert.doesNotMatch(authContext, /Authorization:\s*`Bearer/);
  assert.doesNotMatch(authRoute, /res\.json\(\{\s*token\b/);
  assert.match(authRoute, /httpOnly:\s*true/);
  assert.match(authRoute, /sameSite:\s*"strict"/);
  assert.match(authRoute, /req\.is\("application\/json"\)/);
});

test("security migration is explicit and is not embedded in startup migration code", async () => {
  const sessionMigration = await readFile(
    path.join(
      workspaceDir,
      "lib/db/drizzle/0009_famous_ma_gnuci.sql",
    ),
    "utf8",
  );
  const startupMigration = await readFile(
    path.join(
      artifactDir,
      "src/lib/migrate.ts",
    ),
    "utf8",
  );
  const scopeMigration = await readFile(
    path.join(
      workspaceDir,
      "lib/db/drizzle/0010_outstanding_cargill.sql",
    ),
    "utf8",
  );

  assert.match(sessionMigration, /CREATE TABLE "auth_sessions"/);
  assert.match(sessionMigration, /CREATE TABLE "auth_login_attempts"/);
  assert.match(scopeMigration, /CREATE TABLE "security_access_audit"/);
  assert.match(scopeMigration, /ADD COLUMN "scope_mode"/);
  assert.doesNotMatch(startupMigration, /CREATE TABLE IF NOT EXISTS auth_sessions/);
});

test("migration failure aborts startup before listener and polling", async () => {
  const startupMigration = await readFile(
    path.join(artifactDir, "src/lib/migrate.ts"),
    "utf8",
  );
  const serverEntry = await readFile(
    path.join(artifactDir, "src/index.ts"),
    "utf8",
  );

  assert.match(startupMigration, /startup is blocked/);
  assert.match(startupMigration, /throw err/);
  assert.match(serverEntry, /await runMigrations\(\)/);
  assert.match(serverEntry, /await assertSecuritySchemaReady\(\)/);
  assert.match(serverEntry, /process\.exit\(1\)/);
  assert.ok(
    serverEntry.indexOf("await runMigrations()") <
      serverEntry.indexOf("await assertSecuritySchemaReady()"),
  );
  assert.ok(
    serverEntry.indexOf("await assertSecuritySchemaReady()") <
      serverEntry.indexOf("app.listen"),
  );
});

test("security schema gate checks catalog columns, indexes, and Drizzle migration records before listen", async () => {
  const schemaGate = await readFile(
    path.join(
      artifactDir,
      "src/lib/security/security-schema-gate.ts",
    ),
    "utf8",
  );

  assert.match(schemaGate, /information_schema\.columns/);
  assert.match(schemaGate, /pg_indexes/);
  assert.match(schemaGate, /drizzle\.__drizzle_migrations/);
  assert.match(schemaGate, /SELECT hash, created_at::text/);
  assert.match(schemaGate, /validateSecuritySchemaInventory/);
});

test("bank connector config is authenticated encryption bound to one connector", () => {
  const environment = {
    BANK_CONFIG_ACTIVE_KEY_ID: "test-v1",
    BANK_CONFIG_ENCRYPTION_KEYS: JSON.stringify({
      "test-v1": Buffer.alloc(32, 17).toString("base64"),
    }),
  };
  const config = {
    clientId: "client-visible-only-to-server",
    clientSecret: "secret-must-never-appear-in-jsonb",
    accessToken: "access-token-must-never-appear-in-jsonb",
    nested: { refreshToken: "refresh-token-must-never-appear" },
  };

  const envelope = bankConfigVault.encryptBankConnectorConfig(
    "connector-a",
    config,
    environment,
  );
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized, /secret-must-never|access-token|refresh-token/);
  assert.deepEqual(
    bankConfigVault.decryptBankConnectorConfig(
      "connector-a",
      envelope,
      environment,
    ),
    config,
  );
  assert.throws(
    () =>
      bankConfigVault.decryptBankConnectorConfig(
        "connector-b",
        envelope,
        environment,
      ),
    /could not be authenticated and decrypted/,
  );
});

test("bank config vault fails closed for plaintext secrets, tampering, and unavailable keys", () => {
  const environment = {
    BANK_CONFIG_ACTIVE_KEY_ID: "test-v1",
    BANK_CONFIG_ENCRYPTION_KEYS: JSON.stringify({
      "test-v1": Buffer.alloc(32, 23).toString("base64"),
    }),
  };
  assert.throws(
    () =>
      bankConfigVault.decryptBankConnectorConfig(
        "connector-a",
        { clientSecret: "legacy-plaintext" },
        environment,
      ),
    /Plaintext bank connector credentials are blocked/,
  );

  const envelope = bankConfigVault.encryptBankConnectorConfig(
    "connector-a",
    { clientSecret: "encrypted" },
    environment,
  );
  const tampered = {
    ...envelope,
    ciphertext: `${envelope.ciphertext.slice(0, -2)}AA`,
  };
  assert.throws(
    () =>
      bankConfigVault.decryptBankConnectorConfig(
        "connector-a",
        tampered,
        environment,
      ),
    /could not be authenticated and decrypted/,
  );
  assert.throws(
    () =>
      bankConfigVault.decryptBankConnectorConfig(
        "connector-a",
        envelope,
        {},
      ),
    /BANK_CONFIG_ENCRYPTION_KEYS is required/,
  );
});

test("serialized request queue preserves spacing and recovers after a failed task", async () => {
  let now = 0;
  const starts = [];
  let active = 0;
  let maxActive = 0;
  const queue = new requestQueueModule.SerializedRequestQueue({
    minIntervalMs: 260,
    now: () => now,
    sleep: async (delayMs) => {
      now += delayMs;
    },
  });

  const jobs = Array.from({ length: 8 }, (_, index) =>
    queue.run(async () => {
      starts.push(now);
      active += 1;
      maxActive = Math.max(maxActive, active);
      active -= 1;
      if (index === 3) throw new Error("expected task failure");
      return index;
    }),
  );
  const settled = await Promise.allSettled(jobs);

  assert.equal(maxActive, 1);
  assert.equal(
    settled.filter((result) => result.status === "fulfilled").length,
    7,
  );
  assert.equal(
    settled.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.deepEqual(
    starts,
    [0, 260, 520, 780, 1040, 1300, 1560, 1820],
  );
});

test("financial bank invariant and consolidated internal transfers use integer minor units", () => {
  const accountMovements = [
    { id: "income", amountMinor: 25_000n, direction: "in" },
    { id: "expense", amountMinor: 10_000n, direction: "out" },
  ];
  assert.deepEqual(
    financialInvariants.checkBankBalanceInvariant(
      100_000n,
      115_000n,
      accountMovements,
    ),
    {
      expectedClosingMinor: 115_000n,
      actualClosingMinor: 115_000n,
      differenceMinor: 0n,
      balanced: true,
    },
  );

  const consolidatedMovements = [
    ...accountMovements,
    {
      id: "transfer-out",
      amountMinor: 30_000n,
      direction: "out",
      isInternalTransfer: true,
    },
    {
      id: "transfer-in",
      amountMinor: 30_000n,
      direction: "in",
      isInternalTransfer: true,
    },
  ];
  assert.equal(
    financialInvariants.consolidatedCashflowMinor(
      consolidatedMovements,
    ),
    15_000n,
  );
});

test("financial periods, payroll rule versions, reversals, and rounding are deterministic", () => {
  assert.deepEqual(
    financialInvariants.reportingPeriods({
      cashflowDate: "2026-02-01T10:00:00Z",
      accrualDate: "2026-01-31T23:00:00Z",
    }),
    {
      cashflowMonth: "2026-02",
      pnlMonth: "2026-01",
    },
  );

  const rules = [
    {
      id: "rule-a",
      version: "v1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-03-31",
    },
    {
      id: "rule-b",
      version: "v2",
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
    },
  ];
  assert.equal(
    financialInvariants.selectPayrollRuleVersion(
      rules,
      "2026-05-10T16:30:00Z",
    ).version,
    "v2",
  );
  assert.throws(
    () =>
      financialInvariants.selectPayrollRuleVersion(
        [
          ...rules,
          {
            id: "overlap",
            version: "v3",
            effectiveFrom: "2026-05-01",
            effectiveTo: null,
          },
        ],
        "2026-05-10",
      ),
    /overlap/,
  );

  const movements = [
    { id: "original", amountMinor: 1_001n, direction: "in" },
    {
      id: "reversal",
      reversalOf: "original",
      amountMinor: 1_001n,
      direction: "out",
    },
  ];
  assert.doesNotThrow(() =>
    financialInvariants.validateReversalPairs(movements),
  );
  assert.equal(
    financialInvariants.consolidatedCashflowMinor(movements),
    0n,
  );
  assert.throws(
    () =>
      financialInvariants.reportingPeriods({
        cashflowDate: "2026-02-29",
      }),
    /calendar bounds/,
  );
  assert.deepEqual(
    financialInvariants.reportingPeriods({
      cashflowDate: "2028-02-29",
    }),
    {
      cashflowMonth: "2028-02",
      pnlMonth: "2028-02",
    },
  );
  assert.throws(
    () =>
      financialInvariants.validateReversalPairs([
        ...movements,
        {
          id: "second-reversal",
          reversalOf: "original",
          amountMinor: 1_001n,
          direction: "out",
        },
      ]),
    /multiple full reversals/,
  );
  assert.equal(financialInvariants.decimalToMinorUnits("10.005"), 1_001n);
  assert.equal(financialInvariants.decimalToMinorUnits("-10.005"), -1_001n);
});

test("Evotor encryption has no tracked fallback key", async () => {
  const evotorRoute = await readFile(
    path.join(artifactDir, "src/routes/evotor.ts"),
    "utf8",
  );

  assert.doesNotMatch(evotorRoute, /fallback-key|RAW_KEY\s*=.*\?\?/);
  assert.match(evotorRoute, /SESSION_SECRET must be configured/);
});


test("personal password hashes are salted, verifiable, and reject malformed input", async () => {
  const passwordModule = await import(
    pathToFileURL(path.join(artifactDir, "src/lib/security/password.ts")).href
  );
  const password = "Correct-Horse-2026";
  const first = await passwordModule.hashPassword(password);
  const second = await passwordModule.hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await passwordModule.verifyPassword(password, first), true);
  assert.equal(await passwordModule.verifyPassword("wrong-password-2026", first), false);
  assert.equal(await passwordModule.verifyPassword(password, "not-a-valid-hash"), false);
  assert.match(first, /^scrypt\$N=32768,r=8,p=1\$/);
});
