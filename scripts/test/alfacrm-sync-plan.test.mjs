import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAlfaSyncMode,
  resolveIncrementalWindow,
  resolveOverlapDays,
} from "../src/alfacrm-sync-plan.ts";

test("full mode is the safe default", () => {
  assert.equal(resolveAlfaSyncMode(undefined), "full_sandbox_read_only");
  assert.equal(resolveAlfaSyncMode("full"), "full_sandbox_read_only");
  assert.equal(
    resolveIncrementalWindow("full_sandbox_read_only", null, undefined),
    null,
  );
});

test("incremental discovery applies a bounded overlap to the watermark", () => {
  const window = resolveIncrementalWindow(
    resolveAlfaSyncMode("incremental"),
    "2026-07-25T10:30:00.000Z",
    "2",
    new Date("2026-07-26T12:00:00.000Z"),
  );
  assert.deepEqual(window, {
    watermark: "2026-07-25T10:30:00.000Z",
    overlapDays: 2,
    dateFrom: "2026-07-23",
    dateTo: "2026-07-26",
  });
});

test("incremental discovery refuses a missing or invalid watermark", () => {
  assert.throws(
    () =>
      resolveIncrementalWindow(
        "incremental_discovery_read_only",
        null,
        undefined,
      ),
    /missing_incremental_watermark/,
  );
  assert.throws(
    () =>
      resolveIncrementalWindow(
        "incremental_discovery_read_only",
        "not-a-date",
        undefined,
      ),
    /invalid_incremental_watermark/,
  );
});

test("overlap is constrained to one through seven days", () => {
  assert.equal(resolveOverlapDays(undefined), 2);
  assert.equal(resolveOverlapDays("1"), 1);
  assert.equal(resolveOverlapDays("7"), 7);
  assert.throws(() => resolveOverlapDays("0"), /invalid_overlap_days/);
  assert.throws(() => resolveOverlapDays("8"), /invalid_overlap_days/);
  assert.throws(() => resolveOverlapDays("2.5"), /invalid_overlap_days/);
});
