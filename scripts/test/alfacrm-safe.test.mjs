import assert from "node:assert/strict";
import test from "node:test";
import {
  familyCandidateReasonCodes,
  operatingUnitRule,
  relatedCustomerId,
  safeAlfaErrorCode,
  stringValue,
} from "../src/alfacrm-safe.ts";

test("object values are never coerced into identifiers", () => {
  assert.equal(stringValue({ id: 42 }), null);
  assert.equal(stringValue([42]), null);
});

test("customer id resolves from explicit and nested AlfaCRM shapes", () => {
  assert.equal(relatedCustomerId({ customer_id: 101, id: 999 }), "101");
  assert.equal(relatedCustomerId({ customer: { id: 202 }, id: 999 }), "202");
  assert.equal(relatedCustomerId({ student: { id: "303" }, id: 999 }), "303");
  assert.equal(relatedCustomerId({ id: 999 }), null);
});

test("owner-confirmed operating units match punctuation variants", () => {
  assert.equal(
    operatingUnitRule("Атлас — садик и школа")?.operatingUnitCode,
    "atlas-kindergarten-school",
  );
  assert.equal(
    operatingUnitRule("Лиственная")?.operatingUnitCode,
    "listvennaya",
  );
  assert.equal(
    operatingUnitRule("Школа 1-11")?.operatingUnitCode,
    "school-1-11",
  );
  assert.equal(
    operatingUnitRule("Школа 1 – 11")?.operatingUnitCode,
    "school-1-11",
  );
  assert.equal(operatingUnitRule("Неизвестный филиал"), null);
});

test("shared phone remains a candidate, not a confirmed guardian fact", () => {
  assert.deepEqual(
    familyCandidateReasonCodes(false),
    ["shared_contact_phone"],
  );
  assert.deepEqual(
    familyCandidateReasonCodes(true),
    ["shared_contact_phone", "shared_guardian_name"],
  );
});

test("unexpected provider errors are reduced to safe non-secret codes", () => {
  assert.equal(
    safeAlfaErrorCode(new Error("proxy user:password@example.invalid")),
    "network_unavailable",
  );
  assert.equal(
    safeAlfaErrorCode({ safeCode: "http_403" }),
    "http_403",
  );
});
