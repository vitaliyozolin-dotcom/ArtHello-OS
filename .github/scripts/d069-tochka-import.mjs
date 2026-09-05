import { readFileSync } from "node:fs";

const CONNECTION_ID = "INT-T-TOCHKA";
const START_DATE = "2026-09-01";
const EXPECTED_ACCOUNT_COUNT = 4;
const DEFAULT_INTERNAL_ORIGIN = "http://127.0.0.1:8081";
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_RETRY_DELAY_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;

class ClientFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "ClientFailure";
    this.code = code;
  }
}

const interruption = new AbortController();
let interruptedBy = "";

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    interruptedBy = signal;
    interruption.abort();
  });
}

function fail(code) {
  throw new ClientFailure(code);
}

function requireString(value, code, maximum = 10_000) {
  if (typeof value !== "string" || !value || value.length > maximum) fail(code);
  return value;
}

function requireInteger(value, code, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

function readIntegerEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) fail(`invalid_${name.toLowerCase()}`);
  return requireInteger(Number(raw), `invalid_${name.toLowerCase()}`, minimum, maximum);
}

function bootstrapPassword() {
  const direct = process.env.ARTHELLO_BOOTSTRAP_PASSWORD || "";
  const filePath = process.env.ARTHELLO_BOOTSTRAP_PASSWORD_FILE || "";
  let value = direct;
  if (filePath) {
    if (filePath.length > 1_024 || !filePath.startsWith("/") || /[\r\n\0]/.test(filePath)) {
      fail("invalid_bootstrap_password_file");
    }
    let fromFile;
    try {
      fromFile = readFileSync(filePath, "utf8").trim();
    } catch {
      fail("bootstrap_password_file_unreadable");
    }
    if (direct && direct !== fromFile) fail("bootstrap_password_sources_conflict");
    value = fromFile;
  }
  return requireString(value, "missing_bootstrap_password", 512);
}

function internalOrigin() {
  const raw = process.env.TOCHKA_IMPORT_INTERNAL_ORIGIN || DEFAULT_INTERNAL_ORIGIN;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("invalid_internal_origin");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || !["127.0.0.1", "[::1]"].includes(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) fail("invalid_internal_origin");
  return parsed.origin;
}

function publicOrigin() {
  const raw = requireString(process.env.ARTHELLO_PUBLIC_ORIGIN, "missing_public_origin", 2_048).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("invalid_public_origin");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) fail("invalid_public_origin");
  return parsed.origin;
}

function combinedSignal(timeoutMs, ignoreInterruption = false) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return ignoreInterruption
    ? timeout
    : AbortSignal.any([timeout, interruption.signal]);
}

async function readJsonResponse(response, phase) {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    fail(`${phase}_response_too_large`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) fail(`${phase}_response_too_large`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail(`${phase}_invalid_json`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail(`${phase}_invalid_payload`);
  return payload;
}

async function requestJson(baseOrigin, path, options, phase, timeoutMs, ignoreInterruption = false) {
  let response;
  try {
    response = await fetch(`${baseOrigin}${path}`, {
      ...options,
      redirect: "error",
      signal: combinedSignal(timeoutMs, ignoreInterruption),
    });
  } catch {
    if (interruptedBy && !ignoreInterruption) fail(`interrupted_${interruptedBy.toLowerCase()}`);
    fail(`${phase}_request_failed`);
  }
  if (!response.ok) fail(`${phase}_http_${response.status}`);
  return {
    payload: await readJsonResponse(response, phase),
    headers: response.headers,
  };
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie") || "";
  return combined ? combined.split(/,(?=\s*__Host-arthello_)/) : [];
}

function cookieFromHeaders(headers, name) {
  const prefix = `${name}=`;
  const line = getSetCookieValues(headers)
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  if (!line) fail("login_missing_cookies");
  const raw = line.slice(prefix.length).split(";", 1)[0];
  if (!raw || raw.length > 1_024 || !/^[A-Za-z0-9._~%+-]+$/.test(raw)) fail("login_invalid_cookies");
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    fail("login_invalid_cookies");
  }
  if (!decoded || decoded.length > 512) fail("login_invalid_cookies");
  return { raw, decoded };
}

function authenticatedHeaders(session, origin, json = false) {
  return {
    accept: "application/json",
    cookie: session.cookieHeader,
    origin,
    "x-csrf-token": session.csrf,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

function assertCanonicalOwner(user) {
  if (
    user.userId !== "USR-OWNER"
    || user.apiRole !== "OWNER"
    || user.isSystemOwner !== true
    || user.isAdministrative !== true
  ) fail("login_not_canonical_owner");
}

function assertSetupShape(setup, codePrefix) {
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) fail(`${codePrefix}_missing_setup`);
  if (setup.connectionId !== CONNECTION_ID) fail(`${codePrefix}_wrong_connection`);
  if (setup.authMethod !== "JWT") fail(`${codePrefix}_wrong_auth_method`);
  requireString(setup.legalEntityId, `${codePrefix}_missing_legal_entity`, 80);
  if (!["single_branch", "classify_transactions"].includes(setup.allocationMode)) {
    fail(`${codePrefix}_invalid_allocation_mode`);
  }
  if (setup.allocationMode === "single_branch") {
    requireString(setup.branchId, `${codePrefix}_missing_branch`, 80);
  } else if (setup.branchId !== "") {
    fail(`${codePrefix}_unexpected_branch`);
  }
  if (setup.accountScope !== "all_permitted") fail(`${codePrefix}_wrong_account_scope`);
  if (![60, 180, 360, 1440].includes(setup.syncIntervalMinutes)) fail(`${codePrefix}_invalid_interval`);
  requireInteger(setup.syncMinute, `${codePrefix}_invalid_minute`, 0, 59);
  if (!Array.isArray(setup.dataScopes) || setup.dataScopes.some((value) => typeof value !== "string")) {
    fail(`${codePrefix}_invalid_data_scopes`);
  }
  if (setup.dataScopes.length === 0) fail(`${codePrefix}_missing_data_scopes`);
  for (const field of ["endpoint", "branchId", "channelType", "sourceMapping"]) {
    if (typeof setup[field] !== "string") fail(`${codePrefix}_invalid_${field.toLowerCase()}`);
  }
  if (typeof setup.readOnlyScopeConfirmed !== "boolean") fail(`${codePrefix}_invalid_read_only_flag`);
  if (setup.secretStatus !== "stored") fail(`${codePrefix}_credential_not_stored`);
  if (setup.companySelectionConfirmed !== true) fail(`${codePrefix}_company_not_confirmed`);
  return setup;
}

function stableSetup(setup) {
  return {
    connectionId: setup.connectionId,
    authMethod: setup.authMethod,
    syncIntervalMinutes: setup.syncIntervalMinutes,
    syncMinute: setup.syncMinute,
    endpoint: setup.endpoint,
    legalEntityId: setup.legalEntityId,
    branchId: setup.branchId,
    allocationMode: setup.allocationMode,
    accountScope: setup.accountScope,
    channelType: setup.channelType,
    sourceMapping: setup.sourceMapping,
    dataScopes: [...setup.dataScopes],
    readOnlyScopeConfirmed: setup.readOnlyScopeConfirmed,
  };
}

function assertStableSetup(expected, actual, codePrefix) {
  if (JSON.stringify(stableSetup(actual)) !== JSON.stringify(stableSetup(expected))) {
    fail(`${codePrefix}_setup_changed`);
  }
}

function assertFourAccounts(payload, setup, codePrefix) {
  const accounts = payload?.bankSnapshot?.accounts;
  if (!Array.isArray(accounts)) fail(`${codePrefix}_missing_bank_snapshot`);
  const tochkaAccounts = accounts.filter((account) => account?.connectionId === CONNECTION_ID);
  if (tochkaAccounts.length !== EXPECTED_ACCOUNT_COUNT) fail(`${codePrefix}_wrong_account_count`);
  const ids = tochkaAccounts.map((account) => requireString(account?.id, `${codePrefix}_invalid_account`, 160));
  if (new Set(ids).size !== EXPECTED_ACCOUNT_COUNT) fail(`${codePrefix}_duplicate_accounts`);
  if (tochkaAccounts.some((account) => account?.legalEntityId !== setup.legalEntityId)) {
    fail(`${codePrefix}_account_legal_entity_mismatch`);
  }
}

function setupForSave(existing) {
  return {
    ...stableSetup(existing),
    startDate: START_DATE,
  };
}

function assertSavedSetup(existing, saved, codePrefix) {
  assertSetupShape(saved, codePrefix);
  if (saved.startDate !== START_DATE) fail(`${codePrefix}_wrong_start_date`);
  assertStableSetup(existing, saved, codePrefix);
}

function assertRetryTest(payload, existing, attempt) {
  assertSavedSetup(existing, payload?.setup, `retry_${attempt}`);
  const test = payload?.test;
  if (!test || typeof test !== "object" || Array.isArray(test) || test.ok !== true) {
    fail(`retry_${attempt}_invalid_test`);
  }
  const accountCount = requireInteger(test.accountCount, `retry_${attempt}_invalid_account_count`, 0, 200);
  const statementCount = requireInteger(test.statementCount, `retry_${attempt}_invalid_statement_count`, 0, 200);
  const transactionCount = requireInteger(test.transactionCount, `retry_${attempt}_invalid_transaction_count`, 0, 100_000);
  const financialOperationCount = requireInteger(test.financialOperationCount, `retry_${attempt}_invalid_financial_count`, 0, 100_000);
  if (typeof test.complete !== "boolean") fail(`retry_${attempt}_invalid_complete`);
  if (accountCount !== EXPECTED_ACCOUNT_COUNT) fail(`retry_${attempt}_wrong_account_count`);
  if (statementCount > EXPECTED_ACCOUNT_COUNT) fail(`retry_${attempt}_wrong_statement_count`);
  if (test.complete && statementCount !== EXPECTED_ACCOUNT_COUNT) fail(`retry_${attempt}_incomplete_statement_set`);
  if (test.complete && transactionCount === 0) fail(`retry_${attempt}_empty_transaction_set`);
  return {
    accountCount,
    statementCount,
    transactionCount,
    financialOperationCount,
    complete: test.complete,
  };
}

async function abortableDelay(milliseconds) {
  if (interruptedBy) fail(`interrupted_${interruptedBy.toLowerCase()}`);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      interruption.signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new ClientFailure(`interrupted_${interruptedBy.toLowerCase()}`));
    };
    interruption.signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function login(baseOrigin, origin) {
  if (process.env.TOCHKA_IMPORT_AUTH_PREFLIGHT !== "VERIFIED") fail("auth_preflight_not_verified");
  let loginValue = requireString(process.env.ARTHELLO_BOOTSTRAP_LOGIN, "missing_bootstrap_login", 160);
  let passwordValue = bootstrapPassword();
  const { payload: user, headers } = await requestJson(baseOrigin, "/api/auth/login", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ login: loginValue, password: passwordValue }),
  }, "login", 30_000);
  loginValue = "";
  passwordValue = "";
  assertCanonicalOwner(user);
  const sessionCookie = cookieFromHeaders(headers, "__Host-arthello_session");
  const csrfCookie = cookieFromHeaders(headers, "__Host-arthello_csrf");
  return {
    cookieHeader: `__Host-arthello_session=${sessionCookie.raw}; __Host-arthello_csrf=${csrfCookie.raw}`,
    csrf: csrfCookie.decoded,
  };
}

async function getIntegrations(baseOrigin, origin, session, phase) {
  const { payload } = await requestJson(baseOrigin, "/api/integrations", {
    method: "GET",
    headers: authenticatedHeaders(session, origin),
  }, phase, 30_000);
  if (payload?.capabilities?.canManageTochka !== true) fail(`${phase}_owner_capability_missing`);
  const setup = assertSetupShape(payload?.setups?.[CONNECTION_ID], phase);
  assertFourAccounts(payload, setup, phase);
  return { payload, setup };
}

async function saveStartDate(baseOrigin, origin, session, existing) {
  const { payload } = await requestJson(baseOrigin, "/api/integration-actions", {
    method: "POST",
    headers: authenticatedHeaders(session, origin, true),
    body: JSON.stringify({
      action: "saveSetup",
      setup: setupForSave(existing),
      credential: "",
    }),
  }, "save_setup", 30_000);
  assertSavedSetup(existing, payload?.setup, "save_setup");
  return payload.setup;
}

async function retryUntilComplete(baseOrigin, origin, session, setup, maxAttempts, retryDelayMs) {
  let financialOperationCountAdded = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let payload;
    try {
      ({ payload } = await requestJson(baseOrigin, "/api/integration-actions", {
        method: "POST",
        headers: authenticatedHeaders(session, origin, true),
        body: JSON.stringify({ action: "retrySync", connectionId: CONNECTION_ID }),
      }, `retry_${attempt}`, 60_000));
    } catch (error) {
      const code = error instanceof ClientFailure ? error.code : "";
      // The application intentionally normalizes provider-side read failures
      // (including temporary Tochka outages and rate limits) to HTTP 422.
      // This client is read-only and bounded, so retry that status as well as
      // transport/429/5xx failures; reconciliation still fails closed.
      const transient = code === `retry_${attempt}_request_failed`
        || new RegExp(`^retry_${attempt}_http_(?:422|429|5\\d\\d)$`).test(code);
      if (!transient || attempt === maxAttempts) throw error;
      process.stdout.write(`${JSON.stringify({
        marker: "TOCHKA_IMPORT_ATTEMPT",
        attempt,
        transientFailure: true,
      })}\n`);
      await abortableDelay(retryDelayMs);
      continue;
    }
    const result = assertRetryTest(payload, setup, attempt);
    financialOperationCountAdded += result.financialOperationCount;
    process.stdout.write(`${JSON.stringify({
      marker: "TOCHKA_IMPORT_ATTEMPT",
      attempt,
      complete: result.complete,
      accountCount: result.accountCount,
      statementCount: result.statementCount,
      transactionCount: result.transactionCount,
      financialOperationCount: result.financialOperationCount,
    })}\n`);
    if (result.complete) return { ...result, attempt, financialOperationCountAdded };
    if (attempt < maxAttempts) await abortableDelay(retryDelayMs);
  }
  fail("statement_generation_not_complete");
}

async function logout(baseOrigin, origin, session) {
  await requestJson(baseOrigin, "/api/auth/logout", {
    method: "POST",
    headers: authenticatedHeaders(session, origin, true),
    body: "{}",
  }, "logout", 15_000, true);
  session.cookieHeader = "";
  session.csrf = "";
}

async function run() {
  const baseOrigin = internalOrigin();
  const origin = publicOrigin();
  const maxAttempts = readIntegerEnvironment("TOCHKA_IMPORT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, 1, 30);
  const retryDelayMs = readIntegerEnvironment("TOCHKA_IMPORT_RETRY_DELAY_MS", DEFAULT_RETRY_DELAY_MS, 1, 60_000);
  const endDate = new Date().toISOString().slice(0, 10);
  if (endDate < START_DATE) fail("current_date_precedes_start_date");

  let session = null;
  let result = null;
  let primaryFailure = null;
  try {
    session = await login(baseOrigin, origin);
    const { setup: existing } = await getIntegrations(baseOrigin, origin, session, "preflight");
    const saved = await saveStartDate(baseOrigin, origin, session, existing);
    result = await retryUntilComplete(baseOrigin, origin, session, saved, maxAttempts, retryDelayMs);
    const { setup: finalSetup } = await getIntegrations(baseOrigin, origin, session, "postflight");
    assertSavedSetup(saved, finalSetup, "postflight");
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (session) {
      try {
        await logout(baseOrigin, origin, session);
      } catch {
        if (primaryFailure) fail("import_and_logout_failed");
        fail("logout_failed");
      }
    }
  }

  if (primaryFailure) throw primaryFailure;
  process.stdout.write(`${JSON.stringify({
    marker: "TOCHKA_IMPORT_API=COMPLETE",
    connectionId: CONNECTION_ID,
    startDate: START_DATE,
    endDate,
    accountCount: result.accountCount,
    statementCount: result.statementCount,
    transactionCount: result.transactionCount,
    financialOperationCount: result.financialOperationCount,
    financialOperationCountAdded: result.financialOperationCountAdded,
    attempts: result.attempt,
    requiresDatabaseReconciliation: true,
  })}\n`);
}

try {
  await run();
} catch (error) {
  const code = error instanceof ClientFailure ? error.code : "unexpected_failure";
  process.stderr.write(`${JSON.stringify({ marker: "TOCHKA_IMPORT_CLIENT=FAILED", code })}\n`);
  process.exitCode = interruptedBy === "SIGINT" ? 130
    : interruptedBy === "SIGTERM" ? 143
      : interruptedBy === "SIGHUP" ? 129
        : 1;
}
