# D113 — Bound startup of the hosted visual-proof browser

Existing owner authorization: «Проверяй и выпускай в прод». Production acceptance remains pending.

## Actual evidence and limits

D112 source1a45eb6aa5b1a9b21c4390105016b8b0e54afef5 / treecfa5c4fe4758dfc3e0fa8e9bac13d7eb373f9f50. Exact-head PR415 checks passed, including 797 application tests and actual finance browser/independent D1 verification. Main Proof34490868754/job102916942503 failed at2026-09-10T14:44:24.5649904Z: ECONNREFUSED127.0.0.1:9223, before visual page evaluation. Its artifact10157721271 was downloaded and ZIP digest9b08d552c1f55d3887d3c17fdc2723ee55f7115e8aa83ac2ed529e5b3a649b42 verified; it contains four permission/migration/contract/workflow reports and no browser startup evidence. Chrome stderr was discarded by the previous launcher. The underlying reason Chrome failed to provide that endpoint is unknown; port collision, startup load or policy are not claimed as proven causes.

Main Quality34490868733, V5234490868763 and all6continuation34490868808 succeeded. Protected run34491463434 is still active during preparation. Its unchanged gate requires successful attempt1 main Proof and cannot accept the failed run. Do not rerun Proof as attempt2 to bypass that gate. Do not merge this PR until the old protected run and cleanup are terminal and their complete actual graph has been reviewed. No cancellation capability is available; no cancellation or lock bypass was performed.

## Bounded correction

The hosted generic visual launcher now starts an owned Chrome profile and uses its dynamically allocated loopback CDP port by default. DevToolsActivePort or the exact endpoint reported by that child must match the actual version response. An explicit CLI port still requires this owned endpoint. Child startup/spawn/exit/readiness has fixed bounded diagnostic fields; raw Chrome output is never persisted. Each startup has the existing30second bound and at most one replacement process, only before any application navigation or assertion. Wrong debugger identity or other non-transient validation fails immediately. Only this child/profile is cleaned; no shared browser is adopted.

All route/viewport loops, app navigation, rendered-root readiness, geometry/assertions, screenshots/report and final acceptance decision remain byte-identical. The existing hosted Chrome flags are retained. Production's separate sandboxed natural-browser acceptance is unchanged. No finance/banking/runtime/v44 source, roles, credentials, data or scheduler state changes.

Seven real-child/loopback tests PASS: delayed readiness; first process exit followed by one successful start; two exits refuse; readiness deadline refuses; foreign debugger identity refuses without retry; explicit owned port; invalid bounds before spawn. They verify child/profile cleanup and absence of a synthetic private sentinel from diagnostic output. Existing7rendered-readiness tests remain PASS. Local14R17contract+23history+7artifact+6historical isolation pass;146source inputs and30counted transformations. Local workflow-policy test cannot load the absent yaml dependency; it remains required in hosted Proof, along with real Chrome visual acceptance. No local full-CI claim.

## Protected publication

PR416 / codex/finance-r17-browser-startup-20260910 / parent1a45eb6aa5b1a9b21c4390105016b8b0e54afef5 / squash prefix `D113: guarded finance R17`. New history gate refuses failed/blocked D112 source/run34491463434 as a candidate, preserving all prior bans. Current R17 app+proof downloader remains unchanged. The archived R16 controller, historical validators, exact main/owner/signed-single-parent/attempt1, both locks, environment, image/context, backup/snapshot/capacity/seal/auth/public and School gates remain.

After the old run is terminal with reviewed cleanup, require final exact-head Quality/Proof/V52/6continuation success and complete SHA/tree/blob review. Squash, verify actual signed single-parent/tree/main, freeze main through the new release and cleanup. Only actual successful receipts may bind D075. Bank/financial counts, links and minor-unit sums still require a fresh bounded production observation. Synthetic tests and CI alone are not accepted runtime or financial evidence.
