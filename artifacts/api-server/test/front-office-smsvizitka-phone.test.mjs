import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSmsVizitkaPhone } from "../src/lib/front-office/smsvizitka-phone.ts";

test("SMS-Vizitka phone normalization preserves the accepted provider boundary", () => {
  assert.equal(normalizeSmsVizitkaPhone("+7 (999) 123-45-67"), "+79991234567");
  assert.equal(normalizeSmsVizitkaPhone("8 999 123 45 67"), "+79991234567");
  assert.equal(normalizeSmsVizitkaPhone("9991234567"), "+79991234567");
  assert.equal(normalizeSmsVizitkaPhone("12345678901"), "+12345678901");
  assert.equal(normalizeSmsVizitkaPhone("12-34"), null);
  assert.equal(normalizeSmsVizitkaPhone("1234567890123456"), null);
  assert.equal(normalizeSmsVizitkaPhone("not a phone"), null);
});
