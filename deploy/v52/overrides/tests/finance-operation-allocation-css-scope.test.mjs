import test from "node:test";
import assert from "node:assert/strict";
import { scopeD069FinanceCss } from "../scripts/patch-finance-operation-allocation-css-scope.mjs";

test("D-069 scopes every added finance selector under the canonical finance page", () => {
  const source = `.existing { display:block; }
/* D069_FINANCE_OPERATION_ALLOCATION */
.operation-classification { display:grid; }
.operation-classification-head > div { display:grid; }
.finance-table td:first-child small { display:block; }
@media (max-width: 767px) {
  .operation-classification-form { grid-template-columns: 1fr; }
}`;
  const out = scopeD069FinanceCss(source);
  assert.match(out, /D069_FINANCE_OPERATION_ALLOCATION_SCOPED/);
  assert.match(out, /^\.ahFinancePage \.operation-classification \{/m);
  assert.match(out, /^\.ahFinancePage \.operation-classification-head > div \{/m);
  assert.match(out, /^\.ahFinancePage \.finance-table td:first-child small \{/m);
  assert.match(out, /^\s*\.ahFinancePage \.operation-classification-form \{/m);
  assert.doesNotMatch(out, /^\.operation-classification/m);
  assert.equal(scopeD069FinanceCss(out), out);
});
