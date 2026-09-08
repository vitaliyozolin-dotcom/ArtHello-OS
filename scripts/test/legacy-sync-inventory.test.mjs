import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const inventory = JSON.parse(
  readFileSync(
    new URL("docs/refactoring/legacy-sync-inventory.json", root),
    "utf8",
  ),
);

test("approved legacy sync inventory is retired from the public runtime", () => {
  assert.equal(inventory.status, "retired");
  assert.equal(inventory.authority, "D-067");
  assert.equal(existsSync(new URL(inventory.source, root)), false);

  const routesIndex = readFileSync(
    new URL("artifacts/api-server/src/routes/index.ts", root),
    "utf8",
  );
  assert.doesNotMatch(routesIndex, /syncRouter|["']\.\/sync["']/);
});

test("retired legacy routes have no contract, generated client, or operator call-sites", () => {
  const searchableFiles = [
    "artifacts/api-server/src/routes/audit.ts",
    "artifacts/alpha-crm-sync/src/pages/coverage.tsx",
    "lib/api-spec/openapi.yaml",
    "lib/api-client-react/src/generated/api.ts",
  ];

  for (const route of inventory.routes) {
    for (const path of searchableFiles) {
      const source = readFileSync(new URL(path, root), "utf8");
      assert.equal(
        source.includes(route.path),
        false,
        `${route.method} ${route.path} remains in ${path}`,
      );
    }
  }
});

test("retirement evidence preserves every approved disposition", () => {
  assert.equal(inventory.routes.length, 30);
  assert.ok(
    inventory.routes.every(({ disposition }) => disposition !== "proposed"),
  );
  assert.ok(
    inventory.routes.every(({ retirementEvidence }) =>
      Array.isArray(retirementEvidence),
    ),
  );
});
