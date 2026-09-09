import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(
  new URL("../../artifacts/alpha-crm-sync/src/", import.meta.url),
);

async function sourceFiles(directory, result = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await sourceFiles(path, result);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) result.push(path);
  }
  return result;
}

test("application API traffic uses the generated-client transport boundary", async () => {
  const violations = [];
  for (const path of await sourceFiles(root)) {
    const source = await readFile(path, "utf8");
    if (
      /\bfetch\s*\(/.test(source) &&
      !path.endsWith("/pages/integrations.tsx")
    ) {
      violations.push(relative(root, path));
    }
  }
  assert.deepEqual(violations, []);
});
