import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const clientPath = fileURLToPath(new URL("../d069-tochka-import.mjs", import.meta.url));
const publicOrigin = "https://arthello.test";
const bootstrapLogin = "owner-test@example.invalid";
const bootstrapPassword = "TEST-BOOTSTRAP-PASSWORD-DO-NOT-LOG";
const sessionValue = "TEST_SESSION_VALUE_DO_NOT_LOG";
const csrfValue = "TEST_CSRF_VALUE_DO_NOT_LOG";
const customerCode = "TEST_CUSTOMER_CODE_DO_NOT_LOG";
const secretDirectory = await mkdtemp(join(tmpdir(), "arthello-tochka-client-"));
const bootstrapPasswordFile = join(secretDirectory, "bootstrap-password");
await writeFile(bootstrapPasswordFile, `${bootstrapPassword}\n`, { mode: 0o600 });
after(async () => {
  await rm(secretDirectory, { recursive: true, force: true });
});

const setup = {
  connectionId: "INT-T-TOCHKA",
  authMethod: "JWT",
  startDate: "2026-01-01",
  syncIntervalMinutes: 180,
  syncMinute: 7,
  endpoint: "",
  legalEntityId: "ORG-TEST",
  branchId: "",
  allocationMode: "classify_transactions",
  accountScope: "all_permitted",
  channelType: "",
  sourceMapping: "",
  dataScopes: ["Счета", "Выписки", "Операции и платежи", "Реестр операций", "Остатки"],
  readOnlyScopeConfirmed: false,
  secretStatus: "stored",
  companySelectionConfirmed: true,
  updatedAt: "2026-09-04T00:00:00.000Z",
};

function json(response, status, body, headers = {}) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    ...headers,
  });
  response.end(text);
}

async function requestBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}");
}

function assertAuthenticatedRequest(request) {
  assert.equal(request.headers.origin, publicOrigin);
  assert.equal(request.headers["x-csrf-token"], csrfValue);
  assert.equal(
    request.headers.cookie,
    `__Host-arthello_session=${sessionValue}; __Host-arthello_csrf=${csrfValue}`,
  );
}

async function runClient(port, environment = {}) {
  const child = spawn(process.execPath, [clientPath], {
    env: {
      ARTHELLO_BOOTSTRAP_LOGIN: bootstrapLogin,
      ARTHELLO_BOOTSTRAP_PASSWORD: "",
      ARTHELLO_BOOTSTRAP_PASSWORD_FILE: bootstrapPasswordFile,
      ARTHELLO_PUBLIC_ORIGIN: publicOrigin,
      TOCHKA_IMPORT_AUTH_PREFLIGHT: "VERIFIED",
      TOCHKA_IMPORT_INTERNAL_ORIGIN: `http://127.0.0.1:${port}`,
      TOCHKA_IMPORT_MAX_ATTEMPTS: "4",
      TOCHKA_IMPORT_RETRY_DELAY_MS: "10",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "exit");
  return { code, signal, stdout, stderr };
}

async function withServer(handler, operation) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.destroy(error);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await operation(server.address().port);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function assertSecretsAbsent(output) {
  for (const secret of [bootstrapLogin, bootstrapPassword, sessionValue, csrfValue, customerCode]) {
    assert.equal(output.includes(secret), false, `output must not contain ${secret}`);
  }
}

test("preserves hidden Tochka credential scope, retries to completeness, and logs out", async () => {
  let retries = 0;
  let logouts = 0;
  let savedSetup = { ...setup };
  const result = await withServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/auth/login") {
      assert.equal(request.headers.origin, publicOrigin);
      assert.deepEqual(await requestBody(request), { login: bootstrapLogin, password: bootstrapPassword });
      json(response, 200, {
        userId: "USR-OWNER",
        apiRole: "OWNER",
        isSystemOwner: true,
        isAdministrative: true,
      }, {
        "set-cookie": [
          `__Host-arthello_session=${sessionValue}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          `__Host-arthello_csrf=${csrfValue}; Path=/; Secure; SameSite=Strict`,
        ],
      });
      return;
    }
    if (request.method === "GET" && request.url === "/api/integrations") {
      assertAuthenticatedRequest(request);
      json(response, 200, {
        capabilities: { canManageTochka: true },
        setups: { "INT-T-TOCHKA": savedSetup },
        bankSnapshot: {
          accounts: Array.from({ length: 4 }, (_, index) => ({
            id: `BANK-ACCOUNT-${index + 1}`,
            connectionId: "INT-T-TOCHKA",
            legalEntityId: setup.legalEntityId,
          })),
        },
      });
      return;
    }
    if (request.method === "POST" && request.url === "/api/integration-actions") {
      assertAuthenticatedRequest(request);
      const body = await requestBody(request);
      if (body.action === "saveSetup") {
        assert.equal(body.credential, "");
        assert.equal(Object.hasOwn(body.setup, "customerCode"), false);
        assert.equal(body.setup.startDate, "2026-09-01");
        assert.equal(body.setup.legalEntityId, setup.legalEntityId);
        savedSetup = { ...setup, ...body.setup, startDate: "2026-09-01" };
        json(response, 200, { setup: savedSetup });
        return;
      }
      assert.deepEqual(body, { action: "retrySync", connectionId: "INT-T-TOCHKA" });
      retries += 1;
      if (retries === 1) {
        json(response, 422, { error: "temporary provider failure" });
        return;
      }
      if (retries === 2) {
        json(response, 503, { error: "temporary" });
        return;
      }
      json(response, 200, {
        setup: savedSetup,
        test: retries === 3
          ? { ok: true, complete: false, accountCount: 4, statementCount: 3, transactionCount: 5, financialOperationCount: 2 }
          : { ok: true, complete: true, accountCount: 4, statementCount: 4, transactionCount: 9, financialOperationCount: 3 },
      });
      return;
    }
    if (request.method === "POST" && request.url === "/api/auth/logout") {
      assertAuthenticatedRequest(request);
      await requestBody(request);
      logouts += 1;
      json(response, 200, { message: "ok" });
      return;
    }
    json(response, 404, { error: "not found" });
  }, (port) => runClient(port));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(retries, 4);
  assert.equal(logouts, 1);
  const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.at(-1).marker, "TOCHKA_IMPORT_API=COMPLETE");
  assert.equal(lines.at(-1).requiresDatabaseReconciliation, true);
  assert.equal(lines.at(-1).accountCount, 4);
  assert.equal(lines.at(-1).statementCount, 4);
  assert.equal(lines.at(-1).transactionCount, 9);
  assert.equal(lines.at(-1).financialOperationCountAdded, 5);
  assertSecretsAbsent(`${result.stdout}\n${result.stderr}`);
});

test("refuses authentication unless the workflow verified bootstrap credentials", async () => {
  let requests = 0;
  const result = await withServer((request, response) => {
    requests += 1;
    json(response, 500, {});
  }, (port) => runClient(port, { TOCHKA_IMPORT_AUTH_PREFLIGHT: "" }));
  assert.equal(result.code, 1);
  assert.equal(requests, 0);
  assert.match(result.stderr, /"code":"auth_preflight_not_verified"/);
  assertSecretsAbsent(`${result.stdout}\n${result.stderr}`);
});

test("logs out and fails closed when a complete statement set has no transactions", async () => {
  let logouts = 0;
  const result = await withServer(async (request, response) => {
    if (request.url === "/api/auth/login") {
      await requestBody(request);
      json(response, 200, {
        userId: "USR-OWNER",
        apiRole: "OWNER",
        isSystemOwner: true,
        isAdministrative: true,
      }, {
        "set-cookie": [
          `__Host-arthello_session=${sessionValue}; Path=/; Secure`,
          `__Host-arthello_csrf=${csrfValue}; Path=/; Secure`,
        ],
      });
      return;
    }
    if (request.method === "GET" && request.url === "/api/integrations") {
      assertAuthenticatedRequest(request);
      json(response, 200, {
        capabilities: { canManageTochka: true },
        setups: { "INT-T-TOCHKA": setup },
        bankSnapshot: { accounts: Array.from({ length: 4 }, (_, index) => ({ id: `A-${index}`, connectionId: "INT-T-TOCHKA", legalEntityId: setup.legalEntityId })) },
      });
      return;
    }
    if (request.url === "/api/integration-actions") {
      assertAuthenticatedRequest(request);
      const body = await requestBody(request);
      const current = { ...setup, startDate: "2026-09-01" };
      json(response, 200, body.action === "saveSetup"
        ? { setup: current }
        : { setup: current, test: { ok: true, complete: true, accountCount: 4, statementCount: 4, transactionCount: 0, financialOperationCount: 0 } });
      return;
    }
    if (request.url === "/api/auth/logout") {
      assertAuthenticatedRequest(request);
      await requestBody(request);
      logouts += 1;
      json(response, 200, { message: "ok" });
      return;
    }
    json(response, 404, {});
  }, (port) => runClient(port));

  assert.equal(result.code, 1);
  assert.equal(logouts, 1);
  assert.match(result.stderr, /"code":"retry_1_empty_transaction_set"/);
  assertSecretsAbsent(`${result.stdout}\n${result.stderr}`);
});

test("never relays a server error body that could contain secret material", async () => {
  let logouts = 0;
  const leakedServerValue = "SERVER-SHOULD-NOT-REACH-LOGS";
  const result = await withServer(async (request, response) => {
    if (request.url === "/api/auth/login") {
      await requestBody(request);
      json(response, 200, {
        userId: "USR-OWNER",
        apiRole: "OWNER",
        isSystemOwner: true,
        isAdministrative: true,
      }, {
        "set-cookie": [
          `__Host-arthello_session=${sessionValue}; Path=/; Secure`,
          `__Host-arthello_csrf=${csrfValue}; Path=/; Secure`,
        ],
      });
      return;
    }
    if (request.method === "GET" && request.url === "/api/integrations") {
      assertAuthenticatedRequest(request);
      json(response, 200, {
        capabilities: { canManageTochka: true },
        setups: { "INT-T-TOCHKA": setup },
        bankSnapshot: { accounts: Array.from({ length: 4 }, (_, index) => ({ id: `A-${index}`, connectionId: "INT-T-TOCHKA", legalEntityId: setup.legalEntityId })) },
      });
      return;
    }
    if (request.url === "/api/integration-actions") {
      assertAuthenticatedRequest(request);
      const body = await requestBody(request);
      if (body.action === "saveSetup") {
        json(response, 200, { setup: { ...setup, startDate: "2026-09-01" } });
      } else {
        json(response, 422, { error: leakedServerValue, credential: bootstrapPassword });
      }
      return;
    }
    if (request.url === "/api/auth/logout") {
      assertAuthenticatedRequest(request);
      await requestBody(request);
      logouts += 1;
      json(response, 200, { message: "ok" });
      return;
    }
    json(response, 404, {});
  }, (port) => runClient(port));

  assert.equal(result.code, 1);
  assert.equal(logouts, 1);
  assert.match(result.stderr, /"code":"retry_4_http_422"/);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(leakedServerValue), false);
  assertSecretsAbsent(`${result.stdout}\n${result.stderr}`);
});
