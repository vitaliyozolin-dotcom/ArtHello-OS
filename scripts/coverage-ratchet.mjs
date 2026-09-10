import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiRoot = fileURLToPath(
  new URL("../artifacts/api-server/", import.meta.url),
);
const ratchetPath = new URL(
  "../quality-gates/coverage-ratchet.json",
  import.meta.url,
);
const ratchet = JSON.parse(await readFile(ratchetPath, "utf8"));

if (ratchet.schemaVersion !== 1 || ratchet.scope !== "api-policy-core") {
  throw new Error("Unsupported coverage ratchet schema or scope");
}

const minimum = ratchet.minimum;
for (const key of ["lines", "branches", "functions"]) {
  if (
    typeof minimum?.[key] !== "number" ||
    minimum[key] < 0 ||
    minimum[key] > 100
  ) {
    throw new Error(`Invalid coverage minimum: ${key}`);
  }
}

if (!Array.isArray(ratchet.tests) || ratchet.tests.length === 0) {
  throw new Error("Coverage ratchet must name at least one test file");
}

const args = [
  "--import",
  "tsx",
  "--test",
  "--experimental-test-coverage",
  `--test-coverage-include=${ratchet.include}`,
  `--test-coverage-lines=${minimum.lines}`,
  `--test-coverage-branches=${minimum.branches}`,
  `--test-coverage-functions=${minimum.functions}`,
  ...ratchet.tests,
];

console.log(
  `coverage-ratchet scope=${ratchet.scope} lines=${minimum.lines} branches=${minimum.branches} functions=${minimum.functions}`,
);

const child = spawn(process.execPath, args, {
  cwd: apiRoot,
  env: process.env,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(
    `coverage-ratchet failed to start from ${root}: ${error.message}`,
  );
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`coverage-ratchet terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
