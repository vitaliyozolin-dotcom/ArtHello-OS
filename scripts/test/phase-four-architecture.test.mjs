import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url).pathname;
const routesRoot = join(root, "artifacts/api-server/src/routes");

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("route public API stays thin and uses named exports", () => {
  const routeFiles = filesBelow(routesRoot).filter((path) =>
    path.endsWith(".ts"),
  );
  const oversized = routeFiles
    .map((path) => ({
      path: relative(root, path),
      lines: readFileSync(path, "utf8").split("\n").length,
    }))
    .filter(({ lines }) => lines > 500);
  assert.deepEqual(oversized, []);

  for (const path of routeFiles) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /^export default/m, relative(root, path));
  }
  assert.equal(
    statSync(join(routesRoot, "audit.ts"), { throwIfNoEntry: false }),
    undefined,
  );
});

test("frontend god pages expose stable wrappers backed by feature catalogs", () => {
  for (const page of ["coverage", "banking", "employees"]) {
    const wrapper = readFileSync(
      join(root, `artifacts/alpha-crm-sync/src/pages/${page}.tsx`),
      "utf8",
    );
    assert.match(wrapper, new RegExp(`@/features/${page}/page`));
    assert.ok(
      statSync(
        join(root, `artifacts/alpha-crm-sync/src/features/${page}/page.tsx`),
      ).isFile(),
    );
  }
});
