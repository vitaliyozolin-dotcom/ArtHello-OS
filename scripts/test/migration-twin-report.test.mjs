import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reportPath = process.env.MIGRATION_TWIN_REPORT;

test("migration twin proves representative 0009/0010 behavior", () => {
  assert.ok(reportPath, "MIGRATION_TWIN_REPORT is required");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const stages = new Map(report.stages.map((stage) => [stage.stage, stage]));

  assert.equal(report.summary.status, "PROVED");
  assert.deepEqual(
    stages.get("SECURITY_0009_0010_APPLY_WITH_REPRESENTATIVE_DATA"),
    {
      stage: "SECURITY_0009_0010_APPLY_WITH_REPRESENTATIVE_DATA",
      status: "OK",
      sessions: 3,
      owner_unrestricted: true,
      non_owner_revoked: 2,
      audit_rows: 1,
    },
  );
  assert.deepEqual(stages.get("SECURITY_0010_ROLLBACK_REAPPLY"), {
    stage: "SECURITY_0010_ROLLBACK_REAPPLY",
    status: "OK",
    sessions_preserved: 3,
    revoked_sessions_not_restored: 2,
    schema_roundtrip_equal: true,
  });
  assert.deepEqual(
    stages.get("SECURITY_0009_0010_DESTRUCTIVE_ROLLBACK_REAPPLY"),
    {
      stage: "SECURITY_0009_0010_DESTRUCTIVE_ROLLBACK_REAPPLY",
      status: "OK",
      auth_data_loss_acknowledged: true,
      schema_roundtrip_equal: true,
    },
  );
});
