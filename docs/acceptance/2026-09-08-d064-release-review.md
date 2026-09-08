# D064 R2 release review — 2026-09-08

Parent main: `68a159dc647f35cdd30ce586fc6d5beb93b89a51`. This candidate follows the measured School DNS/TLS failure in D063 run `34193103822`, job `101955030295`.

## Reviewed changes

The School repair preserves the current School container, image, configuration, secrets and database. One bounded TCP relay, using the existing immutable School image only as a Node runtime, connects the internal bridge to the exact ArtHello HTTPS address. TLS remains end-to-end. The controller verifies source identity, network identity, source ACL, no conflicting alias, configuration fingerprints and normal DNS/TLS from the live School container.

Root review required durable state publication (file fsync, no-replace publication, directory fsync) and correction of normal TCP half-close handling so a queued response is not destroyed. Both are covered by behavioral regressions. Final repair configuration digest is `ede8c38cc4bf5d7bf3aabc4fa9161ed9d00293532708d3bdd3f995199ffd4176`. Local transport tests: 8 passed; controller tests: 14 passed. Actual Docker DNS/TLS/non-root port 443/source ACL smoke remains a mandatory hosted gate.

The separate R2 consumer preserves exact source and artifact verification, backup and isolated clone checks, the durable public-write boundary and delayed Tochka activation. D059 and D063 remain unchanged. School configuration receipts do not substitute for browser SSO. Fresh evidence must bind the intended R2 candidate, actual live ArtHello and School revisions, verified relay configuration, and a natural authenticated Education-to-Diary navigation after relay activation.

Independent bounded consumer review passed 18 framework tests, including extracted current-main checks proving zero mutating SSH calls when main has moved. All 18 workflow shell blocks and the Docker smoke script pass Bash syntax checks. No open P1/P2 was reported in the reviewed bootstrap, replay, receipt and boolean-only credential-presence probe; hosted Ruby and Docker execution remain required.

A replay is allowed only when previous ArtHello cutover did not start and any School repair step succeeded or was skipped. Existing School repair is verified read-only. Failed or ambiguous repair/cutover refuses automatic replay. The current main revision is checked again immediately before the protected School mutation.

AlfaCRM retains saved legacy configuration as an unauthenticated draft, fixes the reproduced workerd redirect-mode incompatibility, and displays the import gate honestly. Root review also removed an unintended assembled SQL duplicate and required repeat-assembly idempotence. No new live Alfa credential or credential rotation is claimed.

## Acceptance boundary

At preparation time this candidate has not run in production. Successful hosted checks, live School repair and natural SSO are required before ArtHello cutover. After cutover, real user workflows still require verification. A successful build is not represented as completion of the six requested business workflows.
