import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("D133 pins the accepted Atlas and School UI sources", () => {
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  assert.match(workflow, /ATLAS_SOURCE_SHA: f856fb3bd098152bb6b02c4d0273c4c9170b130c/);
  assert.match(workflow, /ATLAS_SOURCE_TREE: e63e28520670527bc12d84abcd45cd8fffe2b876/);
  assert.match(workflow, /SCHOOL_SOURCE_SHA: 1a501aa11c55a7a743fc05888d5a57190f2a5c80/);
  assert.match(workflow, /SCHOOL_SOURCE_TREE: ff140e1c5cee91dfe685962c1c5a9e1b6d7d14f1/);
});

test("production runs only after exact successful main Quality and inside the protected environment", () => {
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /startsWith\(github\.event\.workflow_run\.head_commit\.message, 'D136: resolve School network alias'\)/);
  assert.match(workflow, /environment: production-ru/);
  assert.match(workflow, /runs-on: \[self-hosted, linux, x64, arthello-gateway\]/);
});

test("Atlas upgrade is backup-first, preserves the data volume and has rollback", () => {
  const script = read("deploy/upgrade-atlas-d133.sh");
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  for (const marker of [
    "ATLAS_BACKUP=VERIFIED",
    "ATLAS_DATA_VOLUME=PRESERVED",
    "ATLAS_ROLLBACK=STARTED",
    "ATLAS_UPGRADE=SUCCESS",
    "ATLAS_ROLLBACK=RETAINED_UNTIL_SSO",
    "org.opencontainers.image.revision",
  ]) assert.match(script, new RegExp(marker));
  assert.doesNotMatch(script, /docker volume rm/);
  assert.doesNotMatch(script, /docker rm \"\$rollback_name\"/);
  assert.match(workflow, /ATLAS_SSO_ROLLBACK=STARTED/);
  assert.match(workflow, /docker rm \"\$rollback_name\"/);
  assert.match(workflow, /atlasOwnerSso:\$result/);
  const syntax = spawnSync("bash", ["-n", fileURLToPath(new URL("../../deploy/upgrade-atlas-d133.sh", import.meta.url))], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("School uses its current-topology standalone backup and rollback cutover without package installation on production", () => {
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  const productionJob = workflow.split("\n  deploy:")[1] ?? "";
  assert.match(workflow, /school-curriculum-standalone-cutover\.sh/);
  assert.match(workflow, /SCHOOL_STANDALONE_CUTOVER=PASS/);
  assert.match(workflow, /SCHOOL_STANDALONE_BACKUP=VERIFIED/);
  assert.match(workflow, /docker network inspect arthello-os_backend/);
  assert.match(workflow, /Aliases\[\]\?; \. == "school-1-11"/);
  assert.match(workflow, /docker image inspect "\$school_image"/);
  assert.match(workflow, /org\.opencontainers\.image\.revision/);
  assert.match(workflow, /SCHOOL_CONTAINER="\$school_container"/);
  const syntax = spawnSync("bash", ["-n", fileURLToPath(new URL("../../deploy/school-curriculum-standalone-cutover.sh", import.meta.url))], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.doesNotMatch(productionJob, /repair-deploy\.sh/);
  assert.doesNotMatch(productionJob, /npm (ci|install)/);
});
