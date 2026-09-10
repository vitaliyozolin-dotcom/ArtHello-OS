import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const root = new URL("../../", import.meta.url);

test("phase-one review ownership covers workflow and deploy changes", () => {
  const codeowners = readFileSync(new URL(".github/CODEOWNERS", root), "utf8");

  assert.match(codeowners, /^\.github\/ @vitaliyozolin-dotcom$/m);
  assert.match(codeowners, /^deploy\/ @vitaliyozolin-dotcom$/m);
});

test("quality runs the blocking repository lint command", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("package.json", root), "utf8"),
  );
  const quality = parse(
    readFileSync(new URL(".github/workflows/quality.yml", root), "utf8"),
  );

  assert.equal(typeof manifest.scripts?.lint, "string");
  assert.match(manifest.scripts.lint, /prettier --check/);
  assert.ok(
    Object.values(quality.jobs).some((job) =>
      job.steps?.some((step) => step.run === "pnpm run lint"),
    ),
    "quality must execute the root lint script",
  );
});

test("lint includes a non-regressing legacy application ratchet", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("package.json", root), "utf8"),
  );
  const ratchet = JSON.parse(
    readFileSync(
      new URL("quality-gates/legacy-format-ratchet.json", root),
      "utf8",
    ),
  );

  assert.match(manifest.scripts.lint, /lint:legacy/);
  assert.match(manifest.scripts["lint:legacy"], /legacy-format-ratchet\.mjs/);
  assert.deepEqual(ratchet.roots, [
    "artifacts/api-server/src",
    "artifacts/alpha-crm-sync/src",
  ]);
  assert.ok(Array.isArray(ratchet.allowedUnformattedFiles));
});
