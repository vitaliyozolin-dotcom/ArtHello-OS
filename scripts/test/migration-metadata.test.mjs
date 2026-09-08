import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const meta = new URL("lib/db/drizzle/meta/", root);
const journal = JSON.parse(
  readFileSync(new URL("_journal.json", meta), "utf8"),
);

test("every journal entry has a chained Drizzle snapshot", () => {
  let previousId = "00000000-0000-0000-0000-000000000000";
  for (const entry of journal.entries) {
    const filename = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    const path = new URL(filename, meta);
    assert.equal(existsSync(path), true, `${filename} is missing`);
    const snapshot = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(
      snapshot.prevId,
      previousId,
      `${filename} has the wrong prevId`,
    );
    previousId = snapshot.id;
  }
});

test("every migration from 0009 has a rollback companion", () => {
  const rollbackNames = {
    "0009": "0009_auth_security.down.sql",
    "0010": "0010_auth_scope_audit.down.sql",
    "0011": "0011_data_import_core.down.sql",
    "0012": "0012_data_import_indexes.down.sql",
    "0013": "0013_alfa_coverage.down.sql",
    "0014": "0014_alfa_lineage_snapshot.down.sql",
    "0015": "0015_front_office_internal_alpha.down.sql",
    "0016": "0016_personal_auth.down.sql",
    "0017": "0017_people_access_operator.down.sql",
  };
  for (const entry of journal.entries.filter(({ idx }) => idx >= 9)) {
    const prefix = String(entry.idx).padStart(4, "0");
    assert.equal(
      existsSync(new URL(`lib/db/rollbacks/${rollbackNames[prefix]}`, root)),
      true,
      `rollback for ${entry.tag} is missing`,
    );
  }
});
