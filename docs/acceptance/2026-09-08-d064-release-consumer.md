# D064 / R2 release consumer handoff

Frozen review candidate, not a production receipt. This package adds a new controller for PR355 (`codex/school-arthello-recovery-r2-20260908`) whose signed main squash parent must be `68a159dc647f35cdd30ce586fc6d5beb93b89a51`. The old D059 and D063 workflow files are not changed or rearmed. The existing `d063-activation-state.py` is reused unchanged as an already-reviewed utility; its local dependency copy is excluded from the manifest.

The production diagnosis came from D063 run34193103822/job101955030295: School's existing backend bridge is Internal=true, normal external DNS fails EAI_AGAIN, and SSO callback fails fetch. D063 stopped before ArtHello image download and cutover. This is the concrete reason for the separate configuration repair stage.

## Exact release sequence

1. Canonical hosted Verify completion, exact owner/repository/PR355/branch identity, signed current-main parent/tree, and first-attempt successful exact-M2 Quality, Proof and Verify jobs. No checkout or production capability precedes these gates.
2. Check out exact M2. Prepare a four-file reviewed School relay bundle and verify its canonical manifest/file hashes. Existing protected SSH transport retains the pinned host fingerprint. Immediately before the mutating SSH invocation, re-read current main; an advanced main causes zero repair invocations.
3. Send the bounded bundle over SSH stdin. The small reviewed Python bootstrap passes only nonsecret release identity through sudo-n, checks the complete transport SHA256, accepts exactly four fixed filenames, and creates/removes only its own root-owned0700 temporary directory. No application build, package installation or image download runs on the School host.
4. The independently reviewed relay controller preserves School's image, container, configuration, data and internal backend. It adds a dedicated bounded TCP/TLS passthrough to the fixed ArtHello endpoint using the already-loaded School image as a Node runtime. The stable internal alias points only to that relay. Its receipt binds the exact reviewed configuration and School image/source/container identities.
5. Validate the fresh sanitized receipt; run the allowlisted School diagnostic. Print only presence booleans for three Alfa environment variables in the exact current ArtHello container. On School, inspect only the exact name `arthello-os-api`; absence prints targetPresent=false and stops that lookup. Values and Config.Env are not logged or stored. These flags establish environment presence only, not absence of encrypted DB credentials, successful rotation or valid tenant coverage.
6. Require actual natural browser SSO evidence described below. Missing evidence stops before ArtHello image import or cutover while preserving a verified School relay.
7. Consume the exact immutable hosted-M2 image and retain the previously reviewed ArtHello clone, canonical-D1, secrets digest, backup, rollback and public-write-boundary controls. Before public activation the verified snapshot may be restored. After the durable boundary, new data and candidate are preserved on failure; stale snapshot restore is prohibited. Bank auto-sync remains held by the exact SHA plus fresh nonce marker until public/HMAC/main checks pass. Alfa import is not automatically enabled.
8. The coordinator must repeat natural browser acceptance on the newly published ArtHello SHA. Relay health and deployment health do not establish completion of the user's six requirements.

## Relay bundle

Final canonical `repairConfigSha256`: `ede8c38cc4bf5d7bf3aabc4fa9161ed9d00293532708d3bdd3f995199ffd4176`.

Bundle paths: `deploy/school/sso-relay/{manifest.json,repair.py,relay.mjs,healthcheck.mjs}`. Canonical digest uses UTF-8 JSON with sorted keys, compact separators, and no trailing newline. Manifest hashes the other three files. School source remains `54242340f2d9b6a9887d69ecc03520ddf9f7982c`; image remains `sha256:664c2c0c3e628a53ca492953803b420e0c4a44acab35eb250f5f899c10bc93df`.

The relay controller has its own root-owned durable receipt and lock. Its verified-existing path checks exact deployed configuration, current School identity/fingerprint, addresses, scripts, ownership, network properties and normal DNS/TLS health. It does not recreate or modify an already verified matching repair. A failed/cancelled/ambiguous repair is not automatically replayed by this consumer.

## Browser evidence and replay

Data-only evidence lives at `docs/acceptance/2026-09-08-school-live-acceptance-r2.json` in existing private branch `codex/recovery-evidence-20260907`. No success evidence is created by this package.

SchemaVersion=2. All original fields remain mandatory: intendedCandidateArtHelloSha, observedLiveArtHelloSha, observedLiveSchoolSha, exact public origins, method=natural-browser-navigation, sessionInjected=false, callbackUrlConstructed=false, the four ordered natural browser steps, result=pass, evidenceReference, and observedAtUtc. Added field `observedSchoolRepairConfigSha256` must equal the current verified relay receipt. Evidence must be no more than45minutes old, not future-dated, and observed after the stable relay activatedAtUtc. Pre-cutover evidence normally references the older live ArtHello SHA; it is never represented as a test of M2.

Every previous run/attempt must be completely enumerated. ArtHello cutover must have been skipped. School repair must have succeeded or itself been skipped; failure/cancellation/unknown repair state blocks replay. A previous successful or started ArtHello cutover always blocks replay. A permitted retry revalidates the existing School repair and consumes new exact current browser evidence.

## Validation and remaining gates

Local validation:18 framework/transport/receipt/privacy/replay/fault tests,14 controller tests,8 relay socket tests passed. All18 workflow shell blocks plus2 shell scripts passed Bash syntax; both YAML files parsed.

The added hosted Docker smoke is mandatory in Verify. It creates only isolated mock networks, a disposable TLS fixture, and a real UID1001/cap-drop/read-only listener on443. It checks normal Docker DNS, certificate verification, exact allowed source and rejected foreign source using the production relay factory; the mock connector exists only in the test harness. Production's executable destination remains fixed. This smoke was not executed locally because Docker is unavailable. The new Ruby contract was likewise not executed locally because Ruby is unavailable. Both are required hosted gates before merge/release.

No production mutation, PR, push, key copy, Alfa enablement, successful browser acceptance or deployment is claimed by this subagent. Root's D064/passport documents must be integrated separately from its own reviewed paths.
