import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEPLOY_GATE_RECONCILE_AFTER_MS } from "../production/backup-control.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const workflow = await readFile(resolve(repositoryRoot, ".github/workflows/deploy-arthello-direct-38-55.yml"), "utf8");
const dockerfile = await readFile(resolve(repositoryRoot, "deploy/v52/Dockerfile"), "utf8");

function ordered(...needles) {
  let cursor = -1;
  for (const needle of needles) {
    const next = workflow.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `missing workflow invariant: ${needle}`);
    assert.ok(next > cursor, `workflow invariant is out of order: ${needle}`);
    cursor = next;
  }
}

test("runtime uses a separate persistent backup volume and a non-root account", () => {
  assert.match(workflow, /DATA_VOLUME: arthello-direct-v44-data/);
  assert.match(workflow, /BACKUP_VOLUME: arthello-direct-v52-backups/);
  assert.match(workflow, /-v "\$DATA_VOLUME:\/data"/);
  assert.match(workflow, /-v "\$BACKUP_VOLUME:\/backups"/);
  assert.match(dockerfile, /COPY --from=application \/app\/production \/app\/production/);
  assert.match(dockerfile, /chown -R node:node \/data \/backups/);
  assert.match(dockerfile, /USER node/);
});

test("stable secrets stay outside data and backup volumes and key identity is derived", () => {
  assert.match(workflow, /secret_dir="\$HOME\/\.config\/arthello"/);
  assert.match(workflow, /backup-encryption-key/);
  assert.match(workflow, /backup-control-token/);
  assert.match(workflow, /chmod 700 "\$secret_dir"/);
  assert.match(workflow, /chmod 600 "\$bootstrap_file" "\$encryption_file" "\$control_file"/);
  assert.doesNotMatch(workflow, /ARTHELLO_BACKUP_KEY_ID/);
});

test("candidate validation never mounts the live data volume for writing", () => {
  const validation = workflow.slice(
    workflow.indexOf("- name: Start and verify candidate on isolated data"),
    workflow.indexOf("- name: Single-writer cutover with final backup rollback"),
  );
  assert.match(validation, /test "\$CLONE_VOLUME" != "\$DATA_VOLUME"/);
  assert.match(validation, /-v "\$CLONE_VOLUME:\/data"/);
  assert.doesNotMatch(validation, /-v "\$DATA_VOLUME:\/data"/);
});

test("cutover gates mutations, drains, stops the old writer, then creates the final point", () => {
  ordered(
    'const finalPath = "/backups/.deploy-gate"',
    "ARTHELLO_DEPLOY_DRAIN=IDLE",
    "old_stop_started=1",
    'docker stop --time 300 "$LIVE"',
    "create-no-retention pre_deploy",
    "raw_snapshot_ready=1",
    "live_data_exposed=1",
    'docker run -d \\\n            --name "$candidate"',
  );
  assert.match(workflow, /test -z "\$data_volume_users"/);
  assert.match(workflow, /test -z "\$backup_volume_users"/);
});

test("gate creation fails closed without replacing a previous run gate", async (context) => {
  const creation = workflow.slice(
    workflow.indexOf('const finalPath = "/backups/.deploy-gate"', workflow.indexOf("docker stop --time 60 \"$VALIDATION\"")),
    workflow.indexOf("gate_active=1"),
  );
  assert.match(creation, /open\(finalPath, "wx", 0o600\)/);
  assert.match(creation, /ARTHELLO_DEPLOY_GATE=EXISTS_OPERATOR_ACTION_REQUIRED/);
  assert.doesNotMatch(creation, /rename\([^\n]*finalPath/);

  const directory = await mkdtemp(join(tmpdir(), "arthello-existing-gate-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const gatePath = join(directory, ".deploy-gate");
  const previous = '{"format":"arthello-deploy-gate-v1","runId":"previous-run"}\n';
  await writeFile(gatePath, previous, { mode: 0o600 });
  await assert.rejects(
    async () => {
      const handle = await open(gatePath, "wx", 0o600);
      await handle.close();
    },
    (error) => error?.code === "EEXIST",
  );
  assert.equal(await readFile(gatePath, "utf8"), previous);
});

test("durable mutation reconciliation blocks cutover and validation backup is additive", () => {
  const validationBackup = workflow.slice(
    workflow.indexOf("- name: Create and test encrypted validation backup"),
    workflow.indexOf("- name: Start and verify candidate on isolated data"),
  );
  assert.match(validationBackup, /backup-manager\.mjs create-no-retention pre_deploy/);
  assert.doesNotMatch(validationBackup, /backup-manager\.mjs create pre_deploy/);

  const cutover = workflow.slice(
    workflow.indexOf("- name: Single-writer cutover with final backup rollback"),
    workflow.indexOf("- name: Always remove isolated validation artifacts and deploy gate"),
  );
  const readiness = cutover.indexOf('state?.mutationState !== "ready"');
  const operatorAction = cutover.indexOf("MUTATION_STATE_BLOCKED_OPERATOR_ACTION_REQUIRED");
  const stop = cutover.indexOf('docker stop --time 300 "$LIVE"');
  const directMutation = cutover.indexOf("create-no-retention pre_deploy");
  assert.ok(readiness >= 0 && readiness < operatorAction && operatorAction < stop && stop < directMutation);
});

test("deploy gate cannot age out during the bounded deployment job", () => {
  const timeout = workflow.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(timeout, "deployment job must declare a timeout");
  const timeoutMs = Number(timeout[1]) * 60 * 1000;
  assert.ok(
    DEPLOY_GATE_RECONCILE_AFTER_MS > timeoutMs,
    "deploy gate reconciliation threshold must exceed the complete deployment timeout",
  );
  assert.match(workflow, /ARTHELLO_CUTOVER_TIMEOUT_RESERVE=AT_LEAST_5_HOURS/);
});

test("encrypted restore drill cannot mutate the immutable raw rollback volume", () => {
  assert.match(workflow, /rollback_volume="arthello-rollback-/);
  assert.match(workflow, /final_restore_volume="arthello-final-restore-/);
  assert.match(workflow, /-v "\$rollback_volume:\/source:ro"/);
  assert.match(workflow, /-v "\$final_restore_volume:\/data"/);
  assert.doesNotMatch(workflow, /-v "\$rollback_volume:\/data"[\s\S]{0,300}backup-manager\.mjs restore "\$final_backup_id"/);
});

test("rollback verifies the restored service and the preserved School route", () => {
  assert.match(workflow, /ARTHELLO_ROLLBACK_DATA=ENCRYPTED_BACKUP_RESTORED/);
  assert.match(workflow, /ARTHELLO_ROLLBACK_DATA=RAW_SNAPSHOT_RESTORED/);
  assert.match(workflow, /ARTHELLO_ROLLBACK_OLD_HEALTH=FAILED/);
  assert.match(workflow, /curl -fsS --max-time 20 "\$PUBLIC_URL\/api\/health"/);
  assert.match(workflow, /curl -fsS --max-time 20 "\$SCHOOL_URL\/api\/health"/);
});

test("incomplete cutover preserves the original route as an operator recovery artifact", () => {
  const cutover = workflow.slice(
    workflow.indexOf("rollback() {"),
    workflow.indexOf("trap rollback EXIT"),
  );
  const completion = cutover.slice(cutover.lastIndexOf('if [ "$rollback_ok" -eq 1 ]; then'));
  const complete = completion.indexOf("ARTHELLO_ROLLBACK=COMPLETE");
  const remove = completion.indexOf('rm -rf "$work"');
  const incomplete = completion.indexOf("ARTHELLO_ROLLBACK=INCOMPLETE");
  const preserve = completion.indexOf("preserve_cutover_recovery");
  assert.ok(complete >= 0 && complete < remove && remove < incomplete && incomplete < preserve);
  const preservation = workflow.slice(
    workflow.indexOf("preserve_cutover_recovery()"),
    workflow.indexOf("rollback() {"),
  );
  assert.match(preservation, /chmod 700 "\$work"/);
  assert.match(preservation, /ARTHELLO_CUTOVER_RECOVERY=PRESERVED path=%s/);

  const cleanup = workflow.slice(workflow.indexOf("- name: Always remove isolated validation artifacts and deploy gate"));
  assert.doesNotMatch(cleanup, /rm -rf "\$inventory_work" "\$cutover_work"/);
  assert.match(cleanup, /if \[ "\$CUTOVER_OUTCOME" = success \]; then\s+rm -rf "\$cutover_work"/);
  assert.match(cleanup, /elif \[ -d "\$cutover_work" \] && \[ ! -L "\$cutover_work" \]; then/);
  assert.match(cleanup, /ARTHELLO_CUTOVER_RECOVERY=PRESERVED path=%s/);
});
