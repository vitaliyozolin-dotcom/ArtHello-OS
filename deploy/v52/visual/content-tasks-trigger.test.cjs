"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const workflow = fs.readFileSync(path.resolve(__dirname,
  "../../..", ".github/workflows/verify-content-tasks-visual.yml"), "utf8");
const block = workflow.match(/^  visual:\n    needs: source\n    if: >-\n((?:      [^\n]+\n)+)    runs-on: ubuntu-latest$/m);
assert.ok(block, "visual must depend on source and use the reviewed hosted condition block");
const condition = block[1].trim();
// Evaluate the actual YAML condition, preserving GitHub's case-insensitive
// string equality/prefix function and numeric coercion for run_attempt.
// https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
const expression = condition.replace(/(github\.[a-z_]+) == ('[^']*'|[0-9]+)/g,
  "equal($1, $2)");
assert.ok(!expression.includes("=="), "new equality syntax requires explicit evaluator review");
const script = new vm.Script("(" + expression + ")");
const prefix = "D089: hosted Content Tasks visual";
const base = () => ({
  event_name: "push", repository: "vitaliyozolin-dotcom/ArtHello-OS",
  actor: "vitaliyozolin-dotcom", triggering_actor: "vitaliyozolin-dotcom",
  ref: "refs/heads/main", run_attempt: "1",
  event: { head_commit: { message: prefix + " (#382)" } },
});
function allowed(patch = {}) {
  return script.runInNewContext({
    github: { ...base(), ...patch },
    equal(a, b) {
      if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
      return a == b;
    },
    startsWith(value, search) {
      return String(value ?? "").toLowerCase().startsWith(String(search).toLowerCase());
    },
  }, { timeout: 100 });
}
const message = (value) => ({ event: { head_commit: { message: value } } });

test("actual workflow permits owner main dispatch and first-attempt D089 push", () => {
  for (const patch of [
    {}, { run_attempt: 1 },
    message(prefix), message(prefix.toLowerCase() + " follow-up"),
    { event_name: "workflow_dispatch", event: {} },
    { event_name: "workflow_dispatch", event: {}, run_attempt: "2" },
  ]) assert.equal(allowed(patch), true, JSON.stringify(patch));
});

test("actual workflow blocks other events, push retries and unrelated commit prefixes", () => {
  for (const patch of [
    { event_name: "pull_request" }, { event_name: "pull_request_target" },
    { event_name: "workflow_run" }, { event_name: "schedule" },
    { run_attempt: "2" }, { run_attempt: 2 }, { run_attempt: "0" },
    message("D087: bank diagnostic"), message("D089: unrelated visual"),
    message("Merge: " + prefix), message(" " + prefix), message(""), message(null),
  ]) assert.equal(allowed(patch), false, JSON.stringify(patch));
});

test("repository, actor, triggering actor and main guards apply to both event branches", () => {
  for (const event_name of ["push", "workflow_dispatch"]) {
    for (const patch of [
      { repository: "another-owner/ArtHello-OS" },
      { actor: "another-owner" }, { triggering_actor: "another-owner" },
      { actor: "github-actions[bot]" }, { triggering_actor: "github-actions[bot]" },
      { ref: "refs/heads/feature" }, { ref: "refs/pull/382/merge" },
      { ref: "refs/tags/main" },
    ]) assert.equal(allowed({ event_name, ...patch }), false, JSON.stringify({ event_name, ...patch }));
  }
});

test("source prerequisite and both jobs retain read-only hosted execution boundaries", () => {
  assert.match(workflow, /^permissions:\n  contents: read\n  actions: read\n\n/m);
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n") + 7);
  assert.deepEqual([...jobs.matchAll(/^  ([a-z][a-z0-9_-]*):$/gm)].map((m) => m[1]), ["source", "visual"]);
  assert.deepEqual([...jobs.matchAll(/^    runs-on: (.+)$/gm)].map((m) => m[1]), ["ubuntu-latest", "ubuntu-latest"]);
  assert.doesNotMatch(jobs, /^    (environment|permissions|continue-on-error):/m);
  assert.doesNotMatch(workflow, /secrets\.|self-hosted|workflow_run:|pull_request_target:/);
  const source = jobs.split("\n  visual:\n")[0];
  assert.match(source, /node --test deploy\/v52\/visual\/content-tasks-trigger\.test\.cjs/);
  assert.match(source, /node --test deploy\/v52\/visual\/content-tasks-scoped\.test\.cjs/);
  assert.doesNotMatch(source, /continue-on-error:|docker |bash (?!-n )[^\n]*run-content-tasks-hosted\.sh/);
  assert.match(workflow, /^  push:\n    branches: \[main\]\n    paths:/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
});
