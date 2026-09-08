import assert from "node:assert/strict";
import test from "node:test";

import {
  GetReconciliationTransactionsQueryParams,
  SetAtlasBranchBody,
} from "../../lib/api-zod/src/generated/api.ts";

test("generated object schemas strip unknown input fields", () => {
  assert.deepEqual(
    SetAtlasBranchBody.parse({ branchCrmId: "atlas", ignored: "value" }),
    { branchCrmId: "atlas" },
  );
});

test("generated schemas preserve required-field failure semantics", () => {
  const parsed = SetAtlasBranchBody.safeParse({});

  assert.equal(parsed.success, false);
  assert.deepEqual(
    parsed.error.issues.map(({ code, path }) => ({ code, path })),
    [{ code: "invalid_type", path: ["branchCrmId"] }],
  );
});

test("generated query schemas preserve coercion and defaults", () => {
  assert.deepEqual(
    GetReconciliationTransactionsQueryParams.parse({
      page: "2",
      ignored: "value",
    }),
    { page: 2, limit: 50 },
  );
});
