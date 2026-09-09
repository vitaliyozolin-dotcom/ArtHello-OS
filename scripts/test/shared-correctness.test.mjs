import assert from "node:assert/strict";
import test from "node:test";

import { readCsrfCookie } from "@workspace/shared/csrf";
import { formatRubleNumber, formatRubles } from "@workspace/shared/money";
import { normalizePhone } from "@workspace/shared/normalize-phone";
import { sha256Hex } from "@workspace/shared/sha256";

test("normalizePhone preserves the accepted legacy Russian-phone behavior", () => {
  assert.equal(normalizePhone("+7 (999) 123-45-67"), "+79991234567");
  assert.equal(normalizePhone("8 999 123 45 67"), "+79991234567");
  assert.equal(normalizePhone("9991234567"), "+79991234567");
  assert.equal(normalizePhone("12-34"), "+1234");
  assert.equal(normalizePhone([null, "8 999 123 45 67"]), "+79991234567");
  assert.equal(normalizePhone("not a phone"), null);
  assert.equal(normalizePhone(null), null);
});

test("sha256Hex uses the established lower-case hexadecimal representation", () => {
  assert.equal(
    sha256Hex("arthello"),
    "6b8c5e9456c58a967f86384fa1b02b8f477255fc0223e7ea7d3b05a94d92c4d5",
  );
});

test("readCsrfCookie accepts production first and development second", () => {
  assert.equal(
    readCsrfCookie("arthello_csrf=dev; __Host-arthello_csrf=prod"),
    "prod",
  );
  assert.equal(readCsrfCookie("arthello_csrf=hello%20world"), "hello world");
  assert.equal(readCsrfCookie("unrelated=value"), null);
});

test("money helpers preserve zero-decimal Russian formatting", () => {
  assert.match(formatRubles(1234), /^1[\s\u00a0\u202f]234\s₽$/);
  assert.match(formatRubleNumber(1234), /^1[\s\u00a0\u202f]234$/);
});
