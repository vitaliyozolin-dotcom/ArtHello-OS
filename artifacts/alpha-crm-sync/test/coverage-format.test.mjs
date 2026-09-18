import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCoverageDuration,
  formatCoverageTimestamp,
} from "../src/features/coverage/format.ts";

test("coverage formatters preserve existing empty and duration output", () => {
  assert.equal(formatCoverageTimestamp(null), "—");
  assert.equal(formatCoverageTimestamp(undefined), "—");
  assert.equal(formatCoverageDuration(null), "—");
  assert.equal(formatCoverageDuration(0), "—");
  assert.equal(formatCoverageDuration(850), "850ms");
  assert.equal(formatCoverageDuration(12_500), "12.5s");
  assert.equal(formatCoverageDuration(120_000), "2.0min");
});
