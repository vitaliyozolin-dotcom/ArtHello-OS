import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/features/navigation/section-routes.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { SECTION_PATHS, pathForSection, sectionForPath } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("every owner section has one stable canonical URL", () => {
  const entries = Object.entries(SECTION_PATHS);
  assert.equal(entries.length, 28);
  assert.equal(new Set(entries.map(([, path]) => path)).size, entries.length);
  assert.ok(entries.every(([, path]) => path.startsWith("/")));

  for (const [section, path] of entries) {
    assert.equal(pathForSection(section), path);
    assert.equal(sectionForPath(path), section);
    if (path !== "/") assert.equal(sectionForPath(`${path}/`), section);
  }
});

test("unknown paths fail closed instead of selecting an arbitrary section", () => {
  assert.equal(sectionForPath("/unknown"), null);
  assert.equal(sectionForPath(""), null);
  assert.equal(sectionForPath("/banking?tab=payments"), null);
});
