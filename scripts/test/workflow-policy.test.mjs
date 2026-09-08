import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeWorkflowDirectory, analyzeWorkflowSource } from "../workflow-policy.mjs";

test("build-only label still rejects automatic PR execution without default self-hosted label", () => {
  const result = analyzeWorkflowSource("build-pr.yml", `
on: pull_request
jobs:
  build:
    runs-on: [arthello-build-only-linux-x64]
    steps:
      - run: ./candidate.sh
`);
  assert.deepEqual(result.violations.map(({ rule }) => rule), ["untrusted-pr-on-production-capability"]);
});

test("build-only label rejects PR-target head checkout", () => {
  const result = analyzeWorkflowSource("build-pr-target.yml", `
on: pull_request_target
jobs:
  build:
    runs-on: [arthello-build-only-linux-x64]
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`);
  assert.deepEqual(result.violations.map(({ rule }) => rule), ["pr-target-head-on-production-capability"]);
});

test("manual build-only remains conservatively capability-bearing in policy output", () => {
  const result = analyzeWorkflowSource("build-dispatch.yml", `
on: workflow_dispatch
jobs:
  build:
    runs-on: [arthello-build-only-linux-x64]
    steps:
      - run: docker build .
`);
  assert.deepEqual(result.violations, []);
  assert.equal(result.jobs[0].productionCapability, true);
  assert.deepEqual(result.jobs[0].capabilities, ["self-hosted", "docker"]);
});

test("rejects pull_request code on a self-hosted runner", () => {
  const result = analyzeWorkflowSource(
    "unsafe-pr.yml",
    `
name: Unsafe PR
on:
  pull_request:
jobs:
  build:
    runs-on: [self-hosted, linux]
    steps:
      - uses: actions/checkout@v4
      - run: ./candidate-script.sh
`,
  );

  assert.deepEqual(
    result.violations.map(({ rule }) => rule),
    ["untrusted-pr-on-production-capability"],
  );
});

test("rejects pull_request_target head checkout on a production job", () => {
  const result = analyzeWorkflowSource(
    "unsafe-pr-target.yml",
    `
name: Unsafe PR target
on:
  pull_request_target:
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production-ru
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: ssh deploy@example.invalid ./deploy.sh
`,
  );

  assert.deepEqual(
    result.violations.map(({ rule }) => rule),
    ["pr-target-head-on-production-capability"],
  );
});

test("allows pull_request validation on a GitHub-hosted runner", () => {
  const result = analyzeWorkflowSource(
    "safe-pr.yml",
    `
name: Safe PR
on:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`,
  );

  assert.deepEqual(result.violations, []);
  assert.equal(result.jobs[0].productionCapability, false);
});

test("allows a production job that explicitly excludes pull_request", () => {
  const result = analyzeWorkflowSource(
    "event-exclusion.yml",
    `
name: Split validation and deploy
on:
  pull_request:
  push:
jobs:
  deploy:
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    environment: production-ru
    steps:
      - run: ssh deploy@example.invalid ./deploy.sh
`,
  );

  assert.deepEqual(result.violations, []);
});

test("does not confuse a protected branch condition with PR head checkout", () => {
  const result = analyzeWorkflowSource(
    "protected-pr-target.yml",
    `
name: Protected PR target
on:
  pull_request_target:
jobs:
  deploy:
    if: github.event.pull_request.head.ref == 'ops/approved-trigger'
    runs-on: ubuntu-latest
    environment: production-ru
    steps:
      - uses: actions/checkout@v4
        with:
          ref: refs/heads/main
      - run: ssh deploy@example.invalid ./deploy.sh
`,
  );

  assert.deepEqual(result.violations, []);
});

test("does not treat an OR exception as a pull_request exclusion", () => {
  const result = analyzeWorkflowSource(
    "unsafe-or.yml",
    `
name: Unsafe OR
on:
  pull_request:
jobs:
  deploy:
    if: >-
      github.event_name != 'pull_request' ||
      github.event.pull_request.head.ref == 'ops/approved-trigger'
    runs-on: [self-hosted, linux]
    steps:
      - uses: actions/checkout@v4
`,
  );

  assert.deepEqual(
    result.violations.map(({ rule }) => rule),
    ["untrusted-pr-on-production-capability"],
  );
});

test("classifies SSH, production environment and Docker socket jobs", () => {
  const result = analyzeWorkflowSource(
    "capabilities.yml",
    `
name: Capabilities
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production-ru
    env:
      DEPLOY_HOST: \${{ secrets.DEPLOY_HOST }}
    steps:
      - run: ssh "$DEPLOY_HOST" true
  docker:
    runs-on: [self-hosted, linux]
    steps:
      - run: docker ps
`,
  );

  assert.equal(result.jobs[0].productionCapability, true);
  assert.deepEqual(result.jobs[0].capabilities, ["production-environment", "ssh"]);
  assert.equal(result.jobs[1].productionCapability, true);
  assert.deepEqual(result.jobs[1].capabilities, ["self-hosted", "docker"]);
});

test("propagates production capability through a local reusable workflow", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "arthello-workflow-policy-"));
  try {
    await writeFile(
      path.join(directory, "caller.yml"),
      `
name: Caller
on:
  pull_request:
jobs:
  candidate:
    uses: ./.github/workflows/reusable-production.yml
`,
    );
    await writeFile(
      path.join(directory, "reusable-production.yml"),
      `
name: Reusable production
on:
  workflow_call:
jobs:
  execute:
    runs-on: [self-hosted, linux]
    steps:
      - run: docker ps
`,
    );

    const result = await analyzeWorkflowDirectory(directory);
    assert.deepEqual(
      result.violations.map(({ file, rule }) => ({ file, rule })),
      [{ file: "caller.yml", rule: "untrusted-pr-on-production-capability" }],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
