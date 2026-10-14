import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  parsePlanInput,
  parsePlanTarget,
  planCompletion,
} from "../../lib/shared/src/pulse-plan.ts";
import {
  readPulseFacts,
  readPulsePlan,
  savePulsePlan,
} from "../../artifacts/api-server/src/lib/pulse-plan.ts";

const requireDb = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const { drizzle } = requireDb("drizzle-orm/pglite");
const targets = {
  leads: 20,
  students: null,
  payments: 0,
  receiptsMinor: 123456,
};

test("plan validation preserves omitted targets and rejects unsafe or fractional values", () => {
  assert.deepEqual(
    parsePlanInput({ month: "2026-10", revision: 0, targets }).targets,
    targets,
  );
  for (const body of [
    { month: "2026-13", revision: 0, targets },
    { month: "2026-10", revision: 0, targets: { ...targets, leads: -1 } },
    { month: "2026-10", revision: 0, targets: { ...targets, leads: 1.5 } },
    {
      month: "2026-10",
      revision: 0,
      targets: { ...targets, receiptsMinor: Number.MAX_SAFE_INTEGER + 1 },
    },
    { month: "2026-10", revision: 0, targets: { ...targets, invented: 1 } },
    {
      month: "2026-10",
      revision: 0,
      targets: {
        leads: null,
        students: null,
        payments: null,
        receiptsMinor: null,
      },
    },
  ])
    assert.throws(() => parsePlanInput(body));
  assert.equal(planCompletion(25, 20), 125);
  assert.equal(planCompletion(null, 20), null);
  assert.equal(planCompletion(0, 0), null);
  assert.equal(parsePlanTarget("receiptsMinor", "1234,56"), 123456);
  assert.equal(parsePlanTarget("receiptsMinor", "0.01"), 1);
  assert.equal(parsePlanTarget("leads", ""), null);
  assert.throws(() => parsePlanTarget("receiptsMinor", "1.001"));
  assert.throws(() => parsePlanTarget("leads", "1.5"));
});

test("facts use source month in Moscow, exclude duplicate candidates, and preserve unknowns", async () => {
  const database = new PGlite();
  try {
    await database.exec(
      "CREATE TABLE lead_events (event_time timestamptz, duplicate_candidate boolean);",
    );
    const db = drizzle(database);
    assert.deepEqual(await readPulseFacts(db, "2026-10"), {
      leads: null,
      students: null,
      payments: null,
      receiptsMinor: null,
    });
    await database.exec(
      "INSERT INTO lead_events VALUES ('2026-09-30T21:00:00Z', false), ('2026-10-31T20:59:59Z', null), ('2026-10-31T21:00:00Z', false), ('2026-10-10T00:00:00Z', true), (null, false);",
    );
    assert.deepEqual(await readPulseFacts(db, "2026-10"), {
      leads: 2,
      students: null,
      payments: null,
      receiptsMinor: null,
    });
    assert.equal((await readPulseFacts(db, "2026-11")).leads, 1);
  } finally {
    await database.close();
  }
});

test("monthly plans persist with atomic history and reject stale edits", async () => {
  const database = new PGlite();
  try {
    await database.exec(
      "CREATE TABLE settings (key text PRIMARY KEY, value text, updated_at timestamp DEFAULT now());",
    );
    const db = drizzle(database);
    assert.equal(await readPulsePlan(db, "2026-10"), null);
    const first = await savePulsePlan(
      db,
      { month: "2026-10", revision: 0, targets },
      "owner-synthetic",
    );
    assert.equal(first.revision, 1);
    assert.equal(first.updatedBy, "owner-synthetic");
    assert.deepEqual((await readPulsePlan(db, "2026-10")).targets, targets);
    assert.equal(await readPulsePlan(db, "2026-11"), null);
    await assert.rejects(
      savePulsePlan(
        db,
        { month: "2026-10", revision: 0, targets },
        "owner-synthetic",
      ),
      /изменён/,
    );
    const second = await savePulsePlan(
      db,
      { month: "2026-10", revision: 1, targets: { ...targets, leads: 30 } },
      "owner-second",
    );
    assert.equal(second.revision, 2);
    const history = await database.query(
      "SELECT value FROM settings WHERE key LIKE 'pulse-plan-history:v1:%' ORDER BY key",
    );
    assert.equal(history.rows.length, 2);
    assert.equal(JSON.parse(history.rows[0].value).targets.leads, 20);
    assert.equal(JSON.parse(history.rows[1].value).targets.leads, 30);
    await database.exec(
      "CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key LIKE 'pulse-plan-history:%' THEN RAISE EXCEPTION 'synthetic history failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER history_failure BEFORE INSERT ON settings FOR EACH ROW EXECUTE FUNCTION reject_history();",
    );
    await assert.rejects(
      savePulsePlan(
        db,
        { month: "2026-10", revision: 2, targets },
        "owner-synthetic",
      ),
    );
    assert.equal((await readPulsePlan(db, "2026-10")).revision, 2);
  } finally {
    await database.close();
  }
});
