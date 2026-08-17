import assert from "node:assert/strict";
import test from "node:test";
import {
  decimalToMinorUnits,
  nullableDecimalToMinorUnits,
} from "../src/money-minor.ts";

test("money evidence converts to exact integer minor units", () => {
  assert.equal(decimalToMinorUnits("0"), 0);
  assert.equal(decimalToMinorUnits("12.3"), 1230);
  assert.equal(decimalToMinorUnits("23879.41"), 2_387_941);
  assert.equal(decimalToMinorUnits("-7,05"), -705);
  assert.equal(decimalToMinorUnits("10.1200"), 1012);
  assert.equal(decimalToMinorUnits(0.1), 10);
  assert.equal(nullableDecimalToMinorUnits(null), null);
  assert.throws(
    () => decimalToMinorUnits("1.001"),
    /MONEY_DECIMAL_PRECISION_EXCEEDS_CENTS/,
  );
  assert.throws(
    () => decimalToMinorUnits(Number.NaN),
    /MONEY_DECIMAL_INVALID/,
  );
});
