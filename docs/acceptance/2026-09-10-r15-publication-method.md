# D101: correct the R15 publication method

Status: draft; no production or bank acceptance.

Actual protected R15 run34443217193 attempt1 / deploy102762766189 completed failure on 2026-09-10T06:00:42Z. Accepted R13 history passed. The next provenance step stopped before checkout, imports, snapshot, cutover or authentication. Both cleanup steps passed.

Fresh GitHub commit evidence for bd3553187c6adcda3e0be1586b25c9c3b61dc3de shows a valid verified signature and two parents: 9862a6e863d4d791c00ddeaba9480154ad5b8c4d and 2b8a72941c938df33cda9d5d697c272f92e663e4. The unchanged controller requires exactly one parent equal to PREVIOUS_RELEASE_SHA. Codex used merge_method=merge for PR404, which is incompatible with that gate. The prior release audit missed this publication-method requirement; the gate itself must remain unchanged.

Prepare a fresh reviewed source/PR identity from current main, retain the failed source/run in history, and publish only with merge_method=squash. Verify the resulting GitHub commit signature, sole expected parent and exact reviewed tree immediately after merge. Do not rerun the incompatible old commit, rewrite main history, or relax the one-parent/signature gate. Existing main CI and a new protected run remain mandatory. All bank, School, backup, snapshot, auth and publication boundaries remain unchanged.

## Prepared successor

PR405, branch `codex/tochka-r15-squash-fix-20260910`, base/current main
`bd3553187c6adcda3e0be1586b25c9c3b61dc3de`. The new release pins explicitly
require `mergeMethod: squash`; the controller retains its original signed,
exact-one-parent predicate byte-for-byte. The fixed failed R15 source/run are
added to forbidden history identities. The R14 browser retirement remains the
same because the failed R15 never downloaded or imported a browser on gateway.
No controller steps are added, removed or weakened; the bounded transformation
from archived R14 still has 17 counted operations, and 70 exact source inputs.

The new regression executes the actual unchanged jq predicate against minimal
public GitHub commit metadata from the failed release. It refuses that actual
verified two-parent merge and also wrong signature/source/parent/empty/duplicate
parents. Its synthetic admissible single-parent case is explicitly not live
acceptance. The explicit merge-method test failed before the contract update;
after the change all 12 contract and 23 history tests pass locally. Final
exact-head CI, source review and resulting main commit verification are still
mandatory. Use only `merge_method: squash` with the exact final head SHA.


### D101 — Устранить случайное ложное срабатывание банковского теста

Exact-head V52 run34443910215/job102764455280 остановился 2026-09-10T06:11:10Z в `tochka-autosync.test.mjs`: regex `/synthetic-private|provider-payload|418/` ошибочно нашёл 418 внутри случайного lease UUID. Actual httpStatus был безопасным 500. Ошибка воспроизведена локально фиксированным valid UUID с 418 до исправления assertions. Исправлен только этот тест: response/state сравниваются целиком с точными полями и числовыми HTTP status, проверки private payload сохранены. Все22 scheduler tests и12 R15 contract tests PASS. Runtime, lease/backoff и банковская логика не менялись.

Единственный изменённый файл materialized source — `deploy/v52/src/tests/tochka-autosync.test.mjs`. Его осознанное изменение отражено в canonical manifest: v52 c76256a9f9239560598df62d3ee2da49e9713da1a83c4af2c9910532482b88ce → b20f022c0865e88dd7c1c62e40c7a0d315780abdf3e2e386c308ace70530bec3; v44 прежний. Current-source/historical-runner/R15 pins обновлены по фактическим bytes, frozen R14 pins/guards не меняются. Final head требует новых обязательных CI; провалившийся старый V52 не повторяется ради случайного удачного UUID.
