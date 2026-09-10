import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const ratchet = JSON.parse(
  await readFile(
    new URL("../quality-gates/coverage-visual-browser.json", import.meta.url),
    "utf8",
  ),
);

if (ratchet.schemaVersion !== 1 || ratchet.scope !== "visual-browser-startup") {
  throw new Error("Unsupported visual browser coverage ratchet");
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

console.log(
  `coverage-ratchet scope=${ratchet.scope} lines=${minimum.lines} branches=${minimum.branches} functions=${minimum.functions}`,
);
const child = spawn(
  process.execPath,
  [
    "--test",
    "--experimental-test-coverage",
    `--test-coverage-include=${ratchet.include}`,
    `--test-coverage-lines=${minimum.lines}`,
    `--test-coverage-branches=${minimum.branches}`,
    `--test-coverage-functions=${minimum.functions}`,
    ...ratchet.tests,
  ],
  { stdio: "inherit" },
);

child.once("error", (error) => {
  console.error(`visual browser coverage failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
