import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const inventory = JSON.parse(
  readFileSync(
    new URL("docs/refactoring/legacy-sync-inventory.json", root),
    "utf8",
  ),
);
const source = readFileSync(new URL(inventory.source, root), "utf8");

function routeKey(route) {
  return `${route.method.toUpperCase()} ${route.path}`;
}

test("legacy sync inventory covers every declared route exactly once", () => {
  const declared = [
    ...source.matchAll(
      /router\.(get|post|put|patch|delete)\("(\/sync\/[^"?]+)"/g,
    ),
  ]
    .map((match) => `${match[1].toUpperCase()} ${match[2]}`)
    .sort();
  const inventoried = inventory.routes.map(routeKey).sort();

  assert.equal(
    new Set(inventoried).size,
    inventoried.length,
    "inventory contains duplicate routes",
  );
  assert.deepEqual(inventoried, declared);
});

test("every route has a proposed, actionable disposition", () => {
  const allowed = new Set(Object.keys(inventory.dispositions));

  assert.equal(inventory.status, "proposed");
  assert.equal(inventory.authority, "D-029");
  for (const route of inventory.routes) {
    assert.ok(
      allowed.has(route.disposition),
      `${routeKey(route)} has an unknown disposition`,
    );
    assert.ok(
      route.replacement.length >= 20,
      `${routeKey(route)} lacks replacement guidance`,
    );
    assert.match(
      source.split("\n")[route.line - 1],
      new RegExp(
        `router\\.${route.method.toLowerCase()}\\(\\"${route.path.replaceAll("/", "\\/")}\\"`,
      ),
    );
  }
});

test("known call-site groups still exist and reference the legacy surface", () => {
  for (const callSite of inventory.knownCallSiteGroups) {
    const contents = readFileSync(new URL(callSite.path, root), "utf8");
    assert.match(
      contents,
      /sync/i,
      `${callSite.path} no longer appears to reference sync`,
    );
  }
});

test("every route records its exact literal call-site files", () => {
  const searchableCallSites = inventory.knownCallSiteGroups.filter(
    ({ kind }) => kind !== "mount",
  );

  for (const route of inventory.routes) {
    const expected = searchableCallSites
      .filter(({ path }) =>
        readFileSync(new URL(path, root), "utf8").includes(route.path),
      )
      .map(({ path, kind }) => ({ path, kind }));

    assert.deepEqual(
      inventory.routeCallSites[route.path],
      expected,
      `${routeKey(route)} call-site evidence is incomplete`,
    );
  }

  assert.deepEqual(
    Object.keys(inventory.routeCallSites).sort(),
    inventory.routes.map(({ path }) => path).sort(),
    "call-site map must not omit or invent routes",
  );
});

test("every sandbox disposition has verifiable replacement evidence", () => {
  const sandboxRoutes = inventory.routes.filter(
    ({ disposition }) => disposition === "sandbox-script",
  );

  assert.deepEqual(
    Object.keys(inventory.sandboxReplacementEvidence).sort(),
    sandboxRoutes.map(({ path }) => path).sort(),
    "sandbox replacement map must cover exactly the sandbox dispositions",
  );

  for (const route of sandboxRoutes) {
    const evidence = inventory.sandboxReplacementEvidence[route.path];
    assert.ok(
      ["covered", "blocked"].includes(evidence.status),
      `${routeKey(route)} has an invalid replacement status`,
    );
    assert.ok(
      evidence.reason.length >= 20,
      `${routeKey(route)} lacks rationale`,
    );
    for (const reference of evidence.references) {
      const contents = readFileSync(new URL(reference.path, root), "utf8");
      for (const needle of reference.needles) {
        assert.ok(
          contents.includes(needle),
          `${routeKey(route)} evidence ${reference.path} lacks ${needle}`,
        );
      }
    }
  }
});
