import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { resolveSandboxDatabasePath } from "../src/sandbox-db.ts";

const sourceRoot = resolve(import.meta.dirname, "../..");

test("sandbox database path must be absolute and outside source checkout", () => {
  assert.throws(
    () => resolveSandboxDatabasePath("relative/database"),
    /must be an absolute path/,
  );
  assert.throws(
    () => resolveSandboxDatabasePath(sourceRoot),
    /outside the source checkout/,
  );
  assert.throws(
    () => resolveSandboxDatabasePath(resolve(sourceRoot, "private/database")),
    /outside the source checkout/,
  );
});

test("sandbox database path accepts a dedicated external directory", () => {
  assert.equal(
    resolveSandboxDatabasePath("/tmp/arthello-os-isolated-sandbox"),
    "/tmp/arthello-os-isolated-sandbox",
  );
});
