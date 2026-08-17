import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const routeSource = readFileSync(
  new URL("../src/routes/front-office.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../../../lib/db/src/schema/front-office.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../../lib/db/drizzle/0016_uneven_the_santerians.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrationsDirectory = new URL(
  "../../../lib/db/drizzle/",
  import.meta.url,
);
const migrationJournal = JSON.parse(
  readFileSync(new URL("meta/_journal.json", migrationsDirectory), "utf8"),
);

test("every migration journal entry has a SQL file", () => {
  for (const entry of migrationJournal.entries) {
    assert.equal(
      existsSync(new URL(`${entry.tag}.sql`, migrationsDirectory)),
      true,
      `Missing migration file for ${entry.tag}`,
    );
  }
});

test("Front Office API exposes no outbound message endpoint", () => {
  assert.doesNotMatch(routeSource, /front-office\/.*\/send/);
  assert.doesNotMatch(
    routeSource,
    /deliveryProvider|sendMessage|outboundQueue/,
  );
  assert.match(routeSource, /internal_note/);
  assert.match(routeSource, /ai_draft/);
});

test("all mutable alpha endpoints fail closed to synthetic records", () => {
  const guardCalls = routeSource.match(/assertSyntheticWriteAllowed/g) ?? [];
  assert.ok(guardCalls.length >= 3);
  assert.match(routeSource, /FRONT_OFFICE_INTERNAL_ALPHA_ENABLED/);
});

test("database schema is pinned to ARTHELLO", () => {
  assert.match(schemaSource, /front_office_conversations_arthello_only/);
  assert.match(schemaSource, /projectId} = 'ARTHELLO'/);
  assert.match(migrationSource, /project_id" = 'ARTHELLO'/);
});

test("audit history is append-only at database level", () => {
  assert.match(migrationSource, /front_office_audit_append_only/);
  assert.match(migrationSource, /BEFORE UPDATE OR DELETE/);
  assert.match(migrationSource, /front_office_audit_no_truncate/);
});
