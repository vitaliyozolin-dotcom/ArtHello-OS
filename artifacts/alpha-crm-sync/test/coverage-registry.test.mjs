import test from "node:test";
import assert from "node:assert/strict";

import { countCoverageRegistryStatuses } from "../src/features/coverage/registry.tsx";

test("coverage registry status counts preserve the existing categories", () => {
  const rows = [
    { status: "OK" },
    { status: "OK" },
    { status: "EMPTY" },
    { status: "ERROR" },
    { status: "FORBIDDEN" },
    { status: "NOT_FOUND" },
    { status: "NOT_EXPOSED" },
    { status: "UNKNOWN" },
    { status: null },
  ];

  assert.deepEqual(countCoverageRegistryStatuses(rows), {
    ok: 2,
    empty: 1,
    error: 4,
    unknown: 1,
    total: 9,
  });
});
