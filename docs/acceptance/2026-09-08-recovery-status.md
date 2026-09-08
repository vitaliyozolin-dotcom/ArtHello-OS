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

## Actual release blockers

1. No separately accessible build VM or provisioning authority is present. The confirmed self-hosted executor is on the production server; it is not the separate builder chosen by the owner.
2. The connected GitHub interface does not expose runner registration administration or a fresh `workflow_dispatch` action. No administrative credential was requested through chat or fabricated.
3. The owner's screenshot shows exhausted Actions artifact storage as well as hosted minutes. A self-hosted runner does not by itself provide artifact storage. Private image delivery and its production consumer still need a real endpoint and validation.
4. Timeweb's panel rendered “Site Unavailable” in this cloud browser. No Timeweb account or server inventory was reached, no machine was purchased, and no server was modified through that route.
5. School's callback category must be obtained on its host before choosing a functional correction. Local SSO code and generic public health do not establish the production cause.
6. Exact candidate Docker/runtime checks, restored production-data preflight, backup installation/restore proof, guarded cutover and live acceptance of all six scenarios remain required. The local environment does not offer Docker; Unix socket smoke checks explicitly fail/skip on its `EPERM` restriction rather than being called successful.

## Next execution order

Finish and preserve the combined candidate and review findings. Connect a separately isolated builder and private artifact delivery. Run the prepared read-only School diagnostic through an authorized host channel, fix the proven callback defect, and retest. Run all exact-source gates, test a restored copy with real integrations disabled, install and verify backup services, then publish the immutable image with rollback available. Finally verify SSO, employee access, saved feedback/history, actual bank counts/sums and idempotent repeated imports, selective AlfaCRM import and manual/automatic backup results.

The user-facing statement “new version published, everything works” is not supported at this checkpoint.
