import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const spec = parse(
  readFileSync(
    new URL("../../lib/api-spec/openapi.yaml", import.meta.url),
    "utf8",
  ),
);

test("OpenAPI operationId values are unique for deterministic codegen", () => {
  const locations = new Map();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!operation?.operationId) continue;
      const location = `${method.toUpperCase()} ${path}`;
      const previous = locations.get(operation.operationId);
      assert.equal(
        previous,
        undefined,
        `duplicate operationId ${operation.operationId}: ${previous}, ${location}`,
      );
      locations.set(operation.operationId, location);
    }
  }
});
