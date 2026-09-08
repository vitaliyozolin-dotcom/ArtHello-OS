import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const sourceRoots = ["artifacts", "lib", "scripts"];
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;
const zodImport = /from\s+["'](zod(?:\/v4)?)["']/g;

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["dist", "node_modules"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (sourceExtension.test(entry.name)) files.push(path);
  }
  return files;
}

function inventory() {
  const imports = [];
  for (const sourceRoot of sourceRoots) {
    for (const file of sourceFiles(resolve(root, sourceRoot))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(zodImport)) {
        imports.push({
          path: relative(root, file),
          specifier: match[1],
        });
      }
    }
  }
  return imports.sort((left, right) => left.path.localeCompare(right.path));
}

test("Zod root imports are forbidden after D-061", () => {
  const rootImports = inventory().filter(
    ({ specifier }) => specifier === "zod",
  );

  assert.deepEqual(rootImports, []);
});

test("the catalog pin and deterministic Zod v4 codegen remain explicit", () => {
  const workspace = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
  const orvalConfig = readFileSync(
    resolve(root, "lib/api-spec/orval.config.ts"),
    "utf8",
  );

  assert.match(workspace, /^  zod: 3\.25\.76$/m);
  assert.match(orvalConfig, /zod:\s*\{[\s\S]*?version:\s*4[,\s]/);
  assert.ok(inventory().some(({ specifier }) => specifier === "zod/v4"));
});
