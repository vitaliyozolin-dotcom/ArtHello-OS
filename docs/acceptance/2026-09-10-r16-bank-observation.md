# D105 — Read-only bank observation after guarded R16

Status: bound to actual accepted R16; final review/CI and fresh bank report pending.
The runtime source is the signed one-parent R16 commit
`cb990279e070fddbfa9a0adbd21b56de25b85588`, tree
`1ce4c733034060dc84d558d49dab96d1be9b1cf8`. Actual protected run34461449594
attempt1 completed successfully, including cleanup. Candidate acceptance at
09:41:21.086Z and after-public acceptance at 09:41:39.617Z were read from the
completed deploy102820502860 log; bundle102819996124 also succeeded. The seven
pins are bound to those receipts. The bounded receipt is preserved in
`2026-09-10-r16-release-receipt.json`; no fixture supplies deployment evidence.

The accepted image is
`sha256:556216a36f878fad5b99bc1e2cca0158ebdcc3f7d2ee23fda191285d4ad4ef44`,
runtime fingerprint `e77874370bebb875bab6e661011eccbaee1748e9bc3bb7e7b48b05fc328e6442`,
container `d012fe547d8e57d13677d921b07d7847219705a4e0202faee3134c328f07c498`,
context SHA256 `a43ac4fa996ffcf18854afc83c3245552fe804e80abb94a25a0fa515cd2a9eef`.
The existing R12 worker/history/control volumes were adopted and sealed, with
two history records and the same initial and last verified backup IDs. School
and ArtHello were healthy, and both natural browser acceptance phases passed.

A fresh cloud-browser attempt after deployment still returned 502 before login;
the agent did not execute manual sync. This is distinct from the successful
server-side acceptance and does not establish a production outage. The existing
ordinary scheduler remains the safe path. Last observed automatic nextAt was
2026-09-10T10:02:22.834Z; do not merge a diagnostic solely to repeat old results
before a new manual/scheduler attempt. Bank success after R16 is not yet observed.

The stable D075 consumer filename now loads the byte-pinned R16 resume/state/
backup validators. Those validators retain durable schema14 and prove accepted
R15 plus the exact stopped R13/R12/older chain. The read-only Docker facade,
private public-state/activation/adoption evidence, runtime fingerprint, gateway
route, canonical consumers and twice-checked proof remain unchanged. No restore,
seal, resume, maintenance repair, bank API request or production write is allowed.

The launcher still uses existing owner/current-main/Quality/attempt1/environment
and both production locks, with a read-only/no-copy volume, no network or secrets,
bounded output and final identity check. Fixed manual failure categories and
commitFailureKind remain the only error facts; no HTTP or raw exception is inferred.

Local preparation checks: 36 consumer/launcher integration tests, including the
full three-ancestor chain, each context digest and byte-for-byte preservation;
25 launcher refusal/output tests; 51 aggregate/reconciliation tests PASS. These
must be repeated on the final bound head with exact-head hosted CI and source/tree/
diff review. No raw banking or personal data is part of this change.

Required business result: four configured accounts; current-date statement coverage
from 2026-09-01; real bank_transactions and linked financial_operations; zero
duplicates, missing/dangling/shared links and financialMismatchRows; exact equal
income/expense amounts in minor units. Zero rows cannot pass through vacuous
integrity counts. A retained previous-day statement may first complete and be
acknowledged; ordinary scheduling then advances to the current day without a
lease or backoff reset. A new actual report, not this document or CI, closes proof.
