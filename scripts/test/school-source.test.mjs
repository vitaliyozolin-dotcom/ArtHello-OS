import assert from "node:assert/strict";
import { test } from "node:test";

import { verifySchoolSource } from "../verify-school-source.mjs";

test("materialized School source matches the reviewed canonical tree hashes", async () => {
  const results = await verifySchoolSource();
  assert.deepEqual(
    results.map(({ version }) => version),
    ["v44", "v52"],
  );
});
