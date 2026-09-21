import test from "node:test";
import assert from "node:assert/strict";

import { coverageNormalizationPercent } from "../src/features/coverage/summary.tsx";

test("coverage normalization percent preserves rounding and empty totals", () => {
  assert.equal(coverageNormalizationPercent(0, 0), 0);
  assert.equal(coverageNormalizationPercent("0", "5"), 0);
  assert.equal(coverageNormalizationPercent("3", "2"), 67);
  assert.equal(coverageNormalizationPercent(4, 4), 100);
});
