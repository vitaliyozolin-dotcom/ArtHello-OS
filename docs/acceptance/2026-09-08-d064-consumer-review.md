# D064 R2 consumer — independent bounded review

Verdict: CONDITIONAL PASS for reviewed source. No production deployment or real browser/tenant acceptance performed by this reviewer. Root independently reviewed the relay controller.

## Finding and closure

P2: the first candidate entered mutating School SSH after potentially lengthy connection setup without re-reading current main. The final repair step now compares the GitHub main ref with RELEASE_SHA immediately before the mutating call. A regression executes the extracted shell block: moved main fails with zero mutating SSH calls; exact main permits exactly one. Finding closed.

## Verified boundaries

- D064 has a separate PR355/branch/M1-parent identity. The earlier D063 workflow is not replaced. Exact hosted Quality/Proof/Verify and current main gates precede production capability. Existing immutable ArtHello artifact, durable activation and post-verification Tochka marker boundaries remain inherited.
- The SSH host fingerprint is pinned before credential authentication; remote shell inputs are restricted hex/numeric/base64 identities. Root transition carries only the allowlisted public release/config identities and reviewed bootstrap source. It occurs before reading the bundle or creating files.
- Remote bundle input is limited to1MiB plus one detection byte, checked against the expected transport digest, and permits exactly4 fixed filenames. Decoded files are bounded to256KiB each and created in a root-private random directory with exclusive/no-follow opens. No envelope path/command is executed.
- Receipt gate requires exact manifest digest, fixed School source/image, distinct container IDs, bounded file, exact allowed fields and fresh verification timestamp. Configuration proof does not stand in for browser SSO. Schema2 natural-navigation evidence must follow the verified repair activation and match intended ArtHello SHA, live identities and repair config.
- Replay rejects started ArtHello cutover and failed/cancelled/ambiguous School repair. A completed successful School repair can only proceed through the controller’s exact verified-existing path. Missing/ambiguous provenance remains a denial.
- Alfa probe emits only environment-variable presence booleans and targetPresent; fixture secrets never appear in output. These flags do not establish whether encrypted credentials exist in the application database. No actual Alfa synchronization acceptance is claimed.
- Hosted smoke source uses real mock TLS with a certificate, normal Docker DNS, uid1001 binding443, no capability grants, and a foreign-source negative. The production relay has a fixed upstream; the mock connector is fixture-only. The smoke is a required hosted step.

## Independent checks

- 18/18 R2 framework tests PASS, including moved-main mutation denial, bounded bundle, receipt identity/time, replay, browser requirements, and boolean-only Alfa output.
- 8/8 relay behavior tests PASS, including ACL, byte/connection/time limits, half-close and backpressure.
- All18 workflow shell blocks and hosted Docker-smoke shell syntax PASS.
- Ruby contract and actual Docker DNS/TLS/non-root443 smoke NOT RUN locally: tools unavailable. Their successful exact hosted execution is required before production.
- Controller internals and actual production repair were not duplicated in this bounded review.

## Frozen identity

Manifest SHA-256: 72b4f6cfcc7e8ebde3016cc68ac5aaa1e9964d1619a8db3e7b74e69a232119c7. All16 payload hashes independently matched after freeze. Verdict remains CONDITIONAL PASS subject to exact hosted Ruby/Docker gates; no remaining P1/P2 found in the bounded consumer scope.
