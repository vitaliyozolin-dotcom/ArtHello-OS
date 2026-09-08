import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const runtimeRoots = ["artifacts/api-server/src", "lib/db/src", "scripts/src"];
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const relativeSpecifier =
  /(?:import|export)(?:\s+type)?[\s\S]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : sourceExtensions.has(extname(entry.name))
        ? [path]
        : [];
  });
}

test("Node-executed TypeScript uses explicit .js relative specifiers", () => {
  const violations = [];
  for (const relativeRoot of runtimeRoots) {
    for (const path of files(fileURLToPath(new URL(relativeRoot, root)))) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(relativeSpecifier)) {
        const specifier = match[1] ?? match[2];
        if (!/\.(?:js|json|node)$/.test(specifier)) {
          violations.push(`${path}: ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});
