# Read-only diagnosis after failed School bootstrap

The owner authorized continuing the six-item ArtHello recovery and publishing the verified product. The owner restarted D065 run `34198718003`; attempt 2, job `101982122878`, passed release identity and source gates but failed during School repair at `2026-09-08T07:56:16Z`. The generic bootstrap error does not prove which condition failed or whether cleanup masked an earlier result. Image delivery and ArtHello cutover were skipped. The failed repair is not retried.

The initial diagnostic branch run `34202817175` failed before any job step and produced no log. No remote command executed. The exact platform rejection reason is not available through the connected read API. The diagnostic is now proposed through a reviewed main-branch PR using the existing protected Environment, without changing its access policy. This adds only a bounded read-only investigation; the immutable image, D065 repair code, replay rules, School and ArtHello configuration are unchanged.

| Control | Scope and evidence |
| --- | --- |
| Trigger | Push to main only when this exact diagnostic workflow changes, same repository and owner actor/triggering actor. No PR trigger or checkout. The executing main commit must be signed and have exact M3 as its sole parent. |
| Server access | Existing protected `production-ru` environment and School SSH credentials, exact existing ed25519 fingerprint. No credential values are reported. |
| Serialization | Existing `school-1-11-production` concurrency, cancellation disabled. |
| Precondition | Exact executing main commit and fully enumerated failed D065 attempt 2, repair failed and ArtHello cutover skipped. |
| Remote operations | Isolated Python with bytecode writes disabled; fixed-path metadata/read capability and four literal Docker inspect commands only. No root transition, writes, permission changes, flock, container exec/create/stop/start, network change, or application mutation. |
| Output | Numeric identity, hashed paths, modes, ownership/check booleans, allowlisted error categories and sanitized known-container/network identity. Missing, denied and unknown states remain distinct. |
| Transport cleanup | Only this invocation's three temporary SSH files and empty directory on the runner. |
| Release relation | Diagnostic output is evidence only. It cannot authorize or trigger a repair, release, relaxed gate, or successful SSO claim. |

AI process contract: input is the exact failed attempt, current main and fixed School metadata; result is a reproducible observed precondition failure and state inventory. Authorized actions are the read-only operations above. Forbidden actions are mutations, secret output, arbitrary targets and bypassing the existing access/environment policy. Responsible person is Vitaliy Ozolin; executor is the current ArtHello agent. Execution uses the existing runner and server, purchases and billing changes are not authorized; exact marginal cost is not available. Benefit is identifying the proven repair blocker before another mutation. Stop on changed main/attempt, denied protected access, invalid metadata or timeout. The owner may stop the task; the currently running product remains available and no integration or access configuration is changed by this diagnostic.

The generated workflow payload is checked byte-for-byte against the separately reviewed Python source, and every shell step is syntax checked before publishing this branch. Local tests exercise fixed scope, redaction, missing-versus-denied states and safe metadata checks. Independent review is completed before the branch is created.

Validation: 11 local diagnostic tests passed. Independent reviewer identified and resolved non-regular lock opening; the final script SHA256 is `d3aa676108eeda204db713c2a5cef69cab9dfed82a6c6493e603398fcc6ef650`. Payload equality and all four shell syntax checks passed.
