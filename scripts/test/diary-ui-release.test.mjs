import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("D186 pins the accepted Atlas source and current central predecessor", () => {
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  const release = read("deploy/release-atlas-d186.sh");
  assert.match(
    workflow,
    /ATLAS_SOURCE_SHA: f856fb3bd098152bb6b02c4d0273c4c9170b130c/,
  );
  assert.match(
    workflow,
    /ATLAS_SOURCE_TREE: e63e28520670527bc12d84abcd45cd8fffe2b876/,
  );
  assert.match(
    release,
    /central_release=95873e519113e93d9d52ac08166eb46b317e5c6e/,
  );
  assert.match(release, /expected_receipt=.*production-d182-/);
});

test("production runs only after exact successful main gates and manual owner confirmation", () => {
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /inputs\.confirmation == 'DEPLOY D186 TO PRODUCTION'/);
  assert.match(workflow, /verify_run "\$QUALITY_RUN_ID" "Quality gates"/);
  assert.match(workflow, /verify_run "\$PROOF_RUN_ID" "ArtHello Proof Gates"/);
  assert.match(workflow, /environment: production-ru/);
  assert.match(
    workflow,
    /runs-on: \[self-hosted, linux, x64, arthello-gateway\]/,
  );
});

test("Atlas upgrade is backup-first, preserves the data volume and has rollback", () => {
  const script = read("deploy/upgrade-atlas-d186.sh");
  const release = read("deploy/release-atlas-d186.sh");
  for (const marker of [
    "ATLAS_BACKUP=VERIFIED",
    "ATLAS_DATA_VOLUME=PRESERVED",
    "ATLAS_ROLLBACK=STARTED",
    "ATLAS_UPGRADE=SUCCESS",
    "ATLAS_ROLLBACK=RETAINED_UNTIL_SSO",
    "org.opencontainers.image.revision",
  ])
    assert.match(script, new RegExp(marker));
  assert.doesNotMatch(script, /docker volume rm/);
  assert.match(release, /ATLAS_D186_ROLLBACK=STARTED/);
  assert.match(release, /docker rename "\$atlas_rollback" "\$atlas_service"/);
  assert.match(release, /owner_result=.*activate-atlas-owner-access\.mjs/);
  assert.doesNotMatch(release, /docker volume rm/);
  for (const path of [
    "deploy/upgrade-atlas-d186.sh",
    "deploy/release-atlas-d186.sh",
  ]) {
    const syntax = spawnSync(
      "bash",
      ["-n", fileURLToPath(new URL(`../../${path}`, import.meta.url))],
      { encoding: "utf8" },
    );
    assert.equal(syntax.status, 0, syntax.stderr);
  }
});

test("Atlas production release is decoupled from School mutation", () => {
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  assert.doesNotMatch(workflow, /ARTHELLO_RU_SSH_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /school-curriculum-standalone-cutover\.sh/);
  assert.doesNotMatch(workflow, /run-school-ssh-d138\.sh/);
  assert.match(workflow, /"\$SCHOOL_URL\/api\/health"/);
});
