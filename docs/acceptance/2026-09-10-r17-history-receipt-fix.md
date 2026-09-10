# D111 — exact accepted history receipt for finance R17

Owner: Виталий. Existing instruction «Проверяй и выпускай в прод» authorizes this technical correction, PR/squash and the standard protected release.

## Actual failed attempt

D110 PR412 source a3ccfb3af2118dc7ebc734d3f994092b7ebc52e2, tree70b9c89e34a06c53bfb91febd15bab724a4927c6. Protected run34486783972 attempt1, bundle102902979505 SUCCESS; deploy102903703906 failed at identity/history on 2026-09-10T14:07:46Z. Checkout, imports, retirement, snapshot, cutover and authentication were SKIPPED; cleanup SUCCESS. Last accepted production remains R16. Do not rerun the failed source/run.

Actual helper validates accepted R16 run34461449594 / sourcecb990279e070fddbfa9a0adbd21b56de25b85588 / tree1ce4c733034060dc84d558d49dab96d1be9b1cf8 against its complete actual successful graph. Fresh REST reads reproduce accepted_success PASS. The inherited inline receipt consumer still required acceptedRun34445017241 (R15), while source/tree predicates already named R16. Thus its successful helper receipt was refused at the next exact comparison. The actual log reached ARTHELLO_R14_HISTORY_RECEIPT=BLOCKED; the helper command had already returned successfully under set -Eeuo pipefail.

The new regression obtains a receipt from the helper using independently recorded accepted R16 metadata, then executes the exact inline Python consumer extracted from the controller. It first reproduced the actual refusal on D110. After the fix it passes. Seven negative cases still reject old run/source/tree, boolean run ID, restore authorization and inconsistent resume state, before writing GITHUB_ENV. No fixture substitutes for new production acceptance.

## New publication

PR414, branchcodex/finance-r17-receipt-fix-20260910, squash prefix `D111: guarded finance R17`, parenta3ccfb3af2118dc7ebc734d3f994092b7ebc52e2. 29 counted transformations from unchanged archived R16,139 source inputs. The sole new receipt transformation compares the actual accepted R16 run ID; signature/single-parent/current-main/owner/attempt1/environment/dual-lock/capacity/artifact/snapshot/backup/seal/School gates remain. Failed D110 source/run are explicitly forbidden by current history validation.

No application source, schema, browser scenario, bank logic, data, secrets or roles change. Canonical v52 remains00f89f0e295d95223d3366fcf56018186dcc182ed43a59aca26480ffec64e2f8; v44 unchanged. Existing D108 and D109 remain. D110 main CI had797/797 tests, actual desktop/mobile natural browser and independent D1 verification PASS; these do not mean production acceptance.

Local14contract+23history+6historical runner PASS; exact-head hosted Quality/Proof/V52/all6continuation jobs remain required. Before squash, review full SHA/tree/diff and fresh main; after merge verify actual signed one-parent/tree and freeze main through terminal new R17+cleanup. Old accepted R16 and failed D110 are not rerun. Bind prepared D075 only after actual successful candidate/after-public receipts, then obtain bounded real bank/DDС invariant proof. No DB restore after public boundary, no real test articles or payment reclassification.
