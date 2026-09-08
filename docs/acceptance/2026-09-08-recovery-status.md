# ArtHello recovery release — 2026-09-08

Status: IN PROGRESS / NOT DEPLOYED. The owner explicitly selected GitHub plus a separate build machine and authorized publishing all six corrections. No additional approval of code changes or deployment is being requested.

## Confirmed production observations

- The protected owner login to ArtHello succeeded in a fresh browser session. Education rendered normally.
- A natural click on “Открыть дневник” redirected to School `/login` with `authError=central_denied` and no `reason`. This identifies the School callback catch path but does not distinguish cookie/state, exchange/network or database failure. The allowlisted host diagnostic is prepared; it has not run.
- Tochka has an existing saved key and selected legal entity. Its visible configuration requests all allowed accounts, statements beginning `2026-09-01`, every hour at minute `5`. No configuration was changed.
- The financial registry is empty. Four accounts are visible without balances; the last integration run is `2026-09-07 08:00`, waiting for the bank. A historical run showed 15 rejected rows, zero accepted operations and a misleading successful status. These are unresolved live facts, not proof that automatic import works.
- AlfaCRM's existing form contains a tenant address, branch 1 and selected modules. That form does not prove credentials, coverage, selective import or synchronization have been accepted.

No passwords, bank keys, authorization codes, callback state or cookies were copied into the report or repository.

## Prepared work

- PR348 Education access, PR349 Docker network preflight, PR350 verified backup package, PR351 pending Tochka statements and PR352 developer feedback remain preserved.
- Today's product candidate adds an internal Tochka scheduler, backup Settings UI and a bounded Unix socket bridge, corrections to AlfaCRM staged import, and shared module access checks with session revalidation.
- Independent review found that merely removing old role checks could expose unscoped HR data. That finding is being corrected and is not waived by menu tests. Backup socket lifetime and malformed history handling were also corrected after independent review.
- The combined source is reconstructed from the pinned archive and checked against the original database checksum before new patches. The combined test/build result will be recorded separately; individual agent test counts are not added together as a claim about the final candidate.
- [PR353](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/353) preserves the isolated builder candidate. It is draft and has not run on a VM.

## Fresh CI evidence superseding the old quota blocker

PR353 commit `ea4b22cc7cc421a942c210d1a94c90147849f2c5` actually ran on GitHub-hosted Ubuntu runners today: Verify run `34189642144` and Quality run `34189642189` succeeded. Verify artifact `10041764058` exists, is not expired and contains 156,071,423 bytes; its API digest is `sha256:b6b6a8543bfe6d20bb732d27aa3003f802448cae53f49f35f7961a6fd4f508d6`. This proves that the previous hosted-minute/artifact blocker must not be assumed current. The immediate release continues using the available checks; the separate builder preparation remains preserved in draft PR353. No VM purchase or billing change was made.

Proof run `34189642216` reached visual acceptance and failed there. Its upload step succeeded without uploading a file because hidden `.artifacts` contents were excluded. A narrow diagnostic/evidence correction is being prepared; the visual threshold is not waived.

## Remaining execution requirements

1. The separately accessible build VM remains unconnected, but this is not a blocker to the immediate release now that hosted verification and image upload have actually succeeded.
2. The connected GitHub interface does not expose runner registration administration or a fresh `workflow_dispatch` action. A new, separately reviewed release consumer is being prepared for the current owner-authorized release after exact main Quality/Proof/Verify. It does not rearm the expired D-059 release.
3. Actual hosted verification produced an immutable private artifact. The new production consumer must validate this exact artifact contract, source SHA/tree and successful checks; the old screenshot is historical evidence, not a current upload failure.
4. Timeweb's panel rendered “Site Unavailable” in this cloud browser. No Timeweb account or server inventory was reached, no machine was purchased, and no server was modified through that route.
5. School's callback category must be obtained on its host before choosing a functional correction. Local SSO code and generic public health do not establish the production cause.
6. Exact candidate Docker/runtime checks, restored production-data preflight, backup installation/restore proof, guarded cutover and live acceptance of all six scenarios remain required. The local environment does not offer Docker; Unix socket smoke checks explicitly fail/skip on its `EPERM` restriction rather than being called successful.

## Next execution order

Finish and preserve the combined candidate and review findings. Use the verified available hosted checks and private artifact delivery while retaining the separate builder candidate. Run the prepared read-only School diagnostic through the reviewed production preflight, fix the proven callback defect, and retest. Run all exact-source gates, test a restored copy with real integrations disabled, install and verify backup services, then publish the immutable image with rollback available. Finally verify SSO, employee access, saved feedback/history, actual bank counts/sums and idempotent repeated imports, selective AlfaCRM import and manual/automatic backup results.

The user-facing statement “new version published, everything works” is not supported at this checkpoint.

## Combined product PR354 — initial hosted checks

The frozen 105-file candidate is preserved in PR354, branch `codex/recovery-release-20260908`, head `49d17d65d1b39d50b9d4d1a8ae9eb24a511c9cbf`, tree `861b974747eb14c12df64f0af36149b42d8d402d`. Main remains `9e4c49161e643997fe821a91b84c60c6e38ede33`. No production deployment has occurred.

- Fresh assembly: all27 hooks and original database-source checksum PASS. Production build and ESLint PASS. Serial700 tests:698PASS,0FAIL,2 explicit Unix skips due to local bind restrictions; Docker application stage requires those checks to run. Host/network30 tests PASS.
- Quality34192125105: test and secret-scan jobs SUCCESS.
- Proof34192125115: permission, migration, workflow-policy and visual gates SUCCESS. Private evidence artifact10042587534 exists,67034 bytes, digest `sha256:fc5257c3426f98447d5224854e03047867c9316d6e16fbbf37962074e19c0cfd`. These checks do not replace live v52 acceptance.
- Verify34192125095 stopped before build on the old exact single-TOCHKA service-binding assertion. Combined runtime legitimately adds the restricted backup transport; the strict expected binding set is being updated and independently reviewed.
- Consumer review found two real pre-release risks: snapshot rollback after public writes and Tochka timer activation before verified cutover. The next revision must close both with a durable public-write boundary and SHA/attempt-bound activation marker. Production is unchanged while these are fixed.
- Fresh natural School SSO still returns `central_denied`. No passing acceptance JSON has been created. Real bank and AlfaCRM synchronization, personnel acceptance, feedback persistence and backup installation/restore still require live checks.
