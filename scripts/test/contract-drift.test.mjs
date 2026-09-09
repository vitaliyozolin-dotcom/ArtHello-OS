import assert from "node:assert/strict";
import test from "node:test";

import {
  collectOpenApiRoutes,
  compareContracts,
  normalizePath,
} from "../contract-drift.mjs";

test("normalizes Express and OpenAPI parameter names", () => {
  assert.equal(normalizePath("/families/:familyId"), "/families/{param}");
  assert.equal(normalizePath("/families/{id}"), "/families/{param}");
});

test("extracts only HTTP operations from OpenAPI path items", () => {
  assert.deepEqual(
    collectOpenApiRoutes({
      paths: { "/items/{id}": { parameters: [], get: {} } },
    }),
    ["GET /items/{param}"],
  );
});

test("fails new runtime routes and stale spec or inventory entries", () => {
  assert.deepEqual(
    compareContracts(
      ["GET /live", "POST /new"],
      ["GET /live", "GET /gone"],
      [],
    ),
    {
      unexplainedRuntime: ["POST /new"],
      staleSpec: ["GET /gone"],
      staleInventory: [],
    },
  );
  assert.deepEqual(
    compareContracts(
      ["GET /live"],
      ["GET /live"],
      [{ route: "GET /live" }, { route: "GET /gone" }],
    ).staleInventory,
    ["GET /live", "GET /gone"],
  );
});
