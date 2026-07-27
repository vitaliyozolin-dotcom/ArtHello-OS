import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const testDir = dirname(fileURLToPath(import.meta.url));
const artifactDir = resolve(testDir, "..");
const workspaceDir = resolve(artifactDir, "../..");
const migrationsFolder = resolve(workspaceDir, "lib/db/drizzle");

function requiredDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests",
    );
  }
  return value;
}

function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function cookieValue(cookieHeader, name) {
  const pair = cookieHeader
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}

async function executeSqlFile(queryable, file) {
  const source = await readFile(file, "utf8");
  for (const statement of source
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    await queryable.query(statement);
  }
}

function waitForExit(child, timeoutMs = 30_000) {
  return new Promise((resolveExit, rejectExit) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectExit(
        new Error(`startup failure process timed out\n${output}`),
      );
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal, output });
    });
  });
}

test("PostgreSQL 16 migration, auth, audit, webhook transaction, and rollback gate", async () => {
  const databaseUrl = requiredDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = "test";
  process.env.DASHBOARD_PASSWORD =
    "sandbox-owner-password-that-is-never-used-in-production";
  process.env.ALFACRM_DOMAIN = "sandbox.invalid";
  process.env.PORT = "41991";

  const databaseModule = await import("@workspace/db");
  const { db, pool } = databaseModule;
  let server;

  try {
    const version = await pool.query(
      "SELECT current_setting('server_version_num')::int AS version_num",
    );
    assert.ok(
      Number(version.rows[0]?.version_num) >= 160000,
      "integration database must be PostgreSQL 16 or newer",
    );

    const migrationNames = (await readdir(migrationsFolder))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    const migration14 = migrationNames.find((name) => name.startsWith("0014_"));
    const migration15 = migrationNames.find((name) => name.startsWith("0015_"));
    assert.ok(migration14, "migration 0014 is required");
    assert.ok(migration15, "migration 0015 is required");

    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN");
      for (const name of migrationNames.filter(
        (candidate) => Number(candidate.slice(0, 4)) <= 13,
      )) {
        await executeSqlFile(
          rollbackClient,
          resolve(migrationsFolder, name),
        );
      }
      await executeSqlFile(
        rollbackClient,
        resolve(migrationsFolder, migration14),
      );
      await executeSqlFile(
        rollbackClient,
        resolve(
          workspaceDir,
          "lib/db/rollbacks/0014_alfa_lineage_snapshot.down.sql",
        ),
      );
      await executeSqlFile(
        rollbackClient,
        resolve(migrationsFolder, migration14),
      );
      await executeSqlFile(
        rollbackClient,
        resolve(migrationsFolder, migration15),
      );
      const exactLineage = await rollbackClient.query(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'crm_students'
             AND column_name = 'raw_observation_id'
         ) AS ready`,
      );
      assert.equal(exactLineage.rows[0]?.ready, true);
      await rollbackClient.query("ROLLBACK");
    } catch (error) {
      await rollbackClient.query("ROLLBACK");
      throw error;
    } finally {
      rollbackClient.release();
    }

    await migrate(db, { migrationsFolder });

    const { assertSecuritySchemaReady } = await import(
      pathToFileURL(
        resolve(
          artifactDir,
          "src/lib/security/security-schema-gate.ts",
        ),
      ).href
    );
    await assertSecuritySchemaReady(pool);

    const app = (
      await import(
        pathToFileURL(resolve(artifactDir, "src/app.ts")).href
      )
    ).default;
    server = await new Promise((resolveServer, rejectServer) => {
      const candidate = app.listen(0, "127.0.0.1", () =>
        resolveServer(candidate),
      );
      candidate.once("error", rejectServer);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        login: "owner",
        password: process.env.DASHBOARD_PASSWORD,
      }),
    });
    assert.equal(login.status, 200);
    const cookieHeader = cookiesFrom(login);
    const csrfToken = cookieValue(
      cookieHeader,
      "arthello_csrf",
    );
    assert.ok(csrfToken);

    const session = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), {
      role: "owner",
      name: "Владелец",
      scope: {
        unrestricted: true,
        branchIds: [],
        legalEntityIds: [],
      },
    });

    const banking = await fetch(
      `${baseUrl}/api/banking/connectors`,
      { headers: { cookie: cookieHeader } },
    );
    assert.equal(banking.status, 200);
    const audits = await pool.query(
      `SELECT decision, policy, path
       FROM security_access_audit
       WHERE method = 'GET' AND path = '/banking/connectors'`,
    );
    assert.equal(audits.rowCount, 1);
    assert.equal(audits.rows[0]?.decision, "allowed");

    const noCsrf = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    });
    assert.equal(noCsrf.status, 403);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "x-csrf-token": csrfToken,
      },
    });
    assert.equal(logout.status, 200);

    await pool.query(
      `INSERT INTO source_connectors (
         source_name, source_type, status
       ) VALUES ('Sandbox website', 'website', 'inactive')`,
    );
    const {
      canonicalWebsiteLeadPayload,
      IdempotencyPayloadConflict,
      processWebsiteLead,
      websiteLeadEventHash,
    } = await import(
      pathToFileURL(
        resolve(
          artifactDir,
          "src/lib/webhooks/website-lead-service.ts",
        ),
      ).href
    );
    const { websiteLeadStore } = await import(
      pathToFileURL(
        resolve(artifactDir, "src/routes/webhooks.ts"),
      ).href
    );

    let injectFailure = true;
    const failingStore = {
      transaction(callback) {
        return websiteLeadStore.transaction((tx) =>
          callback({
            ...tx,
            async insertLead(input) {
              if (injectFailure) {
                injectFailure = false;
                throw new Error("injected mid-write failure");
              }
              return tx.insertLead(input);
            },
          }),
        );
      },
    };
    const idempotencyKey = "postgres-integration-lead-0001";
    const payload = canonicalWebsiteLeadPayload({
      name: "Обезличенный тест",
      phone: "",
      email: "",
      source: "sandbox",
    });

    await assert.rejects(
      processWebsiteLead(failingStore, {
        idempotencyKey,
        payload,
        receivedAt: new Date(),
        ip: null,
      }),
      /injected mid-write failure/,
    );
    const afterFailure = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM raw_events
       WHERE hash = $1`,
      [websiteLeadEventHash(idempotencyKey)],
    );
    assert.equal(afterFailure.rows[0]?.count, 0);

    const retry = await processWebsiteLead(websiteLeadStore, {
      idempotencyKey,
      payload,
      receivedAt: new Date(),
      ip: null,
    });
    assert.equal(retry.duplicate, false);
    const pair = await pool.query(
      `SELECT
         COUNT(DISTINCT raw_events.id)::int AS raw_count,
         COUNT(lead_events.id)::int AS lead_count
       FROM raw_events
       LEFT JOIN lead_events
         ON lead_events.raw_event_id = raw_events.id
       WHERE raw_events.hash = $1`,
      [websiteLeadEventHash(idempotencyKey)],
    );
    assert.deepEqual(pair.rows[0], {
      raw_count: 1,
      lead_count: 1,
    });

    const duplicate = await processWebsiteLead(websiteLeadStore, {
      idempotencyKey,
      payload,
      receivedAt: new Date(),
      ip: null,
    });
    assert.equal(duplicate.duplicate, true);
    await assert.rejects(
      processWebsiteLead(websiteLeadStore, {
        idempotencyKey,
        payload: canonicalWebsiteLeadPayload({
          ...payload,
          name: "Другой обезличенный тест",
        }),
        receivedAt: new Date(),
        ip: null,
      }),
      IdempotencyPayloadConflict,
    );

    const catalogClient = await pool.connect();
    try {
      await catalogClient.query("BEGIN");
      await catalogClient.query(
        'DROP INDEX "security_access_audit_session_idx"',
      );
      await assert.rejects(
        assertSecuritySchemaReady(catalogClient),
        /security_access_audit_session_idx/,
      );
      await catalogClient.query("ROLLBACK");

      await catalogClient.query("BEGIN");
      await catalogClient.query(
        `DELETE FROM drizzle.__drizzle_migrations
         WHERE created_at = $1`,
        ["1784858251868"],
      );
      await assert.rejects(
        assertSecuritySchemaReady(catalogClient),
        /1784858251868/,
      );
      await catalogClient.query("ROLLBACK");
    } finally {
      catalogClient.release();
    }
    await assertSecuritySchemaReady(pool);

    await new Promise((resolveClose, rejectClose) => {
      server.close((error) =>
        error ? rejectClose(error) : resolveClose(),
      );
    });
    server = undefined;

    await executeSqlFile(
      pool,
      resolve(
        workspaceDir,
        "lib/db/rollbacks/0010_auth_scope_audit.down.sql",
      ),
    );
    await executeSqlFile(
      pool,
      resolve(
        workspaceDir,
        "lib/db/rollbacks/0009_auth_security.down.sql",
      ),
    );
    await assert.rejects(
      assertSecuritySchemaReady(pool),
      /Required security schema/,
    );

    const child = spawn(
      resolve(artifactDir, "node_modules/.bin/tsx"),
      ["src/index.ts"],
      {
        cwd: artifactDir,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PORT: "41992",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const startup = await waitForExit(child);
    assert.equal(startup.code, 1);
    assert.match(
      startup.output,
      /startup aborted|required security schema|Required security schema/i,
    );
  } finally {
    if (server) {
      await new Promise((resolveClose) =>
        server.close(() => resolveClose()),
      );
    }
    await pool.end();
  }
});
