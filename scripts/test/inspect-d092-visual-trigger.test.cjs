"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const workflow = fs.readFileSync(path.resolve(__dirname,
  "../..", ".github/workflows/inspect-d092-visual-evidence.yml"), "utf8");
const block = workflow.match(/^  inspect:\n    needs: source\n    if: >-\n((?:      [^\n]+\n)+)    runs-on: ubuntu-latest$/m);
assert.ok(block, "inspection requires passing source checks and the reviewed hosted condition");
const expression = block[1].trim().replace(/(github\.[a-z_]+) == ('[^']*'|[0-9]+)/g, "equal($1, $2)");
assert.ok(!expression.includes("=="), "changed equality syntax requires evaluator review");
const script = new vm.Script("(" + expression + ")");
const prefix = "D092: inspect existing visual evidence";
const base = () => ({event_name: "push", repository: "vitaliyozolin-dotcom/ArtHello-OS",
  actor: "vitaliyozolin-dotcom", triggering_actor: "vitaliyozolin-dotcom", ref: "refs/heads/main",
  run_attempt: "1", event: {head_commit: {message: prefix + " — receipt recovery"}}});
function allowed(patch = {}) {
  return script.runInNewContext({github: {...base(), ...patch},
    equal(a, b) { return typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a == b; },
    startsWith(value, search) { return String(value ?? "").toLowerCase().startsWith(String(search).toLowerCase()); },
  }, {timeout: 100});
}
const message = (value) => ({event: {head_commit: {message: value}}});

test("actual workflow admits only owner main first-attempt prefixed pushes", () => {
  for (const patch of [{}, {run_attempt: 1}, message(prefix)]) assert.equal(allowed(patch), true);
  // GitHub expressions ignore case; the Python runtime guard requires exact case.
  assert.equal(allowed(message(prefix.toLowerCase())), true);
});

test("PRs, dispatch, unrelated pushes and retries cannot read the artifact", () => {
  for (const patch of [
    {event_name: "pull_request"}, {event_name: "pull_request_target"}, {event_name: "workflow_dispatch"},
    {event_name: "workflow_run"}, {event_name: "schedule"}, {run_attempt: "2"}, {run_attempt: 0},
    message("D089: hosted Content Tasks visual"), message("D092: unrelated"), message("Merge: " + prefix),
    message(" " + prefix), message(""), message(null),
  ]) assert.equal(allowed(patch), false, JSON.stringify(patch));
});

test("repository, owner, triggering owner and main guards cannot be omitted", () => {
  for (const patch of [
    {repository: "fork-owner/ArtHello-OS"}, {actor: "other"}, {triggering_actor: "other"},
    {actor: "github-actions[bot]"}, {triggering_actor: "github-actions[bot]"},
    {ref: "refs/heads/topic"}, {ref: "refs/pull/1/merge"}, {ref: "refs/tags/main"},
  ]) assert.equal(allowed(patch), false, JSON.stringify(patch));
});

test("PR source checks and hosted read-only inspection retain separate boundaries", () => {
  assert.match(workflow, /^permissions:\n  contents: read\n  actions: read\n\n/m);
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + 7);
  assert.deepEqual([...jobs.matchAll(/^  ([a-z][a-z0-9_-]*):$/gm)].map(m => m[1]), ["source", "inspect"]);
  assert.deepEqual([...jobs.matchAll(/^    runs-on: (.+)$/gm)].map(m => m[1]), ["ubuntu-latest", "ubuntu-latest"]);
  assert.doesNotMatch(jobs, /^    (environment|permissions|continue-on-error):/m);
  assert.doesNotMatch(workflow, /secrets\.|self-hosted|workflow_dispatch:|workflow_run:|pull_request_target:|docker|ssh |run-content-tasks-hosted/);
  const source = jobs.split("\n  inspect:\n")[0];
  assert.doesNotMatch(source, /GH_TOKEN|gh api|python3 scripts\/inspect-d092-visual-evidence\.py/);
  for (const file of ["read-content-tasks-evidence.test.py", "inspect-d092-visual-evidence.test.py", "inspect-d092-visual-trigger.test.cjs"])
    assert.ok(source.includes("scripts/test/" + file));
  assert.match(workflow, /^  push:\n    branches: \[main\]\n    paths:/m);
  assert.match(workflow, /^  pull_request:\n    paths:/m);
});
