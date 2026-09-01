import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { generateSchoolCandidateSecrets } from "../school-candidate-secrets.mjs";

test("generates distinct masked School candidate secrets without fixed fixtures", () => {
  const envLines = [];
  const commandLines = [];

  const generated = generateSchoolCandidateSecrets({
    appendEnvironment: (line) => envLines.push(line),
    emitWorkflowCommand: (line) => commandLines.push(line),
  });

  assert.deepEqual(Object.keys(generated), [
    "CENTRAL_SECRET",
    "PASSWORDLESS_PEPPER",
    "DELIVERY_TOKEN",
  ]);

  const values = Object.values(generated);
  assert.equal(new Set(values).size, 3);
  for (const value of values) assert.match(value, /^[a-f0-9]{64}$/);

  assert.deepEqual(
    envLines,
    Object.entries(generated).map(([name, value]) => `${name}=${value}`),
  );
  assert.deepEqual(
    commandLines,
    values.map((value) => `::add-mask::${value}`),
  );
});

test("candidate workflows generate secrets at runtime and historical ignores stay exact", () => {
  const workflowPaths = [
    ".github/workflows/school-identity-broker-candidate.yml",
    ".github/workflows/school-identity-broker-candidate-v2.yml",
  ];
  for (const workflowPath of workflowPaths) {
    const workflow = readFileSync(new URL(`../../${workflowPath}`, import.meta.url), "utf8");
    assert.match(workflow, /node scripts\/school-candidate-secrets\.mjs/);
    assert.doesNotMatch(workflow, /^\s+(?:CENTRAL_SECRET|PASSWORDLESS_PEPPER|DELIVERY_TOKEN):\s+\S+/m);
  }

  const ignores = readFileSync(new URL("../../.gitleaksignore", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(ignores, [
    "345b04df1b66693117c1ffe4cfb1944afee0b0b0:.github/workflows/school-identity-broker-candidate-v2.yml:generic-api-key:25",
    "345b04df1b66693117c1ffe4cfb1944afee0b0b0:.github/workflows/school-identity-broker-candidate-v2.yml:generic-api-key:26",
    "345b04df1b66693117c1ffe4cfb1944afee0b0b0:.github/workflows/school-identity-broker-candidate-v2.yml:generic-api-key:27",
    "485689cf021366c973e957b1eefce42e24393a45:.github/workflows/school-identity-broker-candidate.yml:generic-api-key:26",
    "485689cf021366c973e957b1eefce42e24393a45:.github/workflows/school-identity-broker-candidate.yml:generic-api-key:27",
    "485689cf021366c973e957b1eefce42e24393a45:.github/workflows/school-identity-broker-candidate.yml:generic-api-key:28",
  ]);
});
