import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  findMisclassifiedRuntimeDependencies,
} from "../lib/dependency-hygiene.mjs";

function fixture({ dependencies = {}, devDependencies = {}, source }) {
  const directory = mkdtempSync(join(tmpdir(), "arthello-dependency-hygiene-"));
  mkdirSync(join(directory, "src"));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ dependencies, devDependencies }),
  );
  writeFileSync(join(directory, "src", "main.ts"), source);
  return directory;
}

test("reports runtime imports declared only as development dependencies", () => {
  const directory = fixture({
    devDependencies: { react: "19.1.0", vite: "7.3.2" },
    source: 'import React from "react";\nimport local from "./local";\n',
  });

  assert.deepEqual(findMisclassifiedRuntimeDependencies(directory), ["react"]);
});

test("accepts runtime imports declared as dependencies or peer dependencies", () => {
  const directory = fixture({
    dependencies: { react: "19.1.0" },
    devDependencies: { vite: "7.3.2" },
    source: 'import React from "react";\n',
  });

  assert.deepEqual(findMisclassifiedRuntimeDependencies(directory), []);
});

test("alpha CRM runtime imports are not development-only dependencies", () => {
  const packageDirectory = new URL(
    "../../artifacts/alpha-crm-sync/",
    import.meta.url,
  );

  assert.deepEqual(findMisclassifiedRuntimeDependencies(packageDirectory), []);
});
