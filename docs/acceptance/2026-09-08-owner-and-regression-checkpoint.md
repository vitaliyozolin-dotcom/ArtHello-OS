# ArtHello: owner diary confirmation and remaining acceptance

Recorded: 2026-09-08. This is a status/evidence checkpoint, not a machine-generated
SSO receipt and not authority to bypass a production release gate.

## Owner observation

In the current project conversation Vitaliy reported, in sequence:

- Employee entry from the School site succeeded with his usual credentials.
- ArtHello OS → Education → diary opened an authenticated diary immediately.
- The same path worked in other browsers.

Result: **manual owner-account diary scenario confirmed by the owner**. Do not
reopen the earlier universal claim that this path fails, or ask him to repeat the
same check without a new failure. Other employee roles were not tested by this report.
Browser names, precise observation timestamps, session traces and production SHA
at the moment of each navigation were not captured. Do not invent them or turn
this report into an automated, exact-candidate browser receipt.

This newer observation supersedes the older *unverified owner diary behavior*
status in historical recovery notes, but does not rewrite those historical runs
or waive the identity/freshness requirements of an actual release.

## Source and performed checks

- Reviewed candidate: `c1d817fc0e872d3fac5584c084284156d5ab3bc2` (PR #364).
- Candidate tree: `9f306ceae6d982a7397083e4f455fd4539d2b6a3`.
- PR #364 changed only `DECISIONS.md`: 18 added lines, no removed lines. It closes
  the review finding that D-074 was missing from the canonical decision log.
- Merged main: `575148fa6c66802fca10f6256edfd7b515d08ee5`, with the identical tree.
- Exact-head Quality [34250308015](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34250308015): success.
- Proof [34250308026](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34250308026): success.
- Exact-head v52 Verify [34250307973](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34250307973),
  job `102142747859`: success. The application-stage summary is **760 tests,
  760 passed, 0 failed, 0 skipped**. This is not a count of live user scenarios.
- Verification artifact: `10065837633`, `arthello-v52-verification-34250307973`,
  173084373 bytes; API digest
  `sha256:7e01d49f24ca82b2aa3d3549ac62d191c332cd66463dd4d776c3d43fd1d6d21b`.
  Existence, size and digest were read from GitHub metadata; this checkpoint did
  not download or independently rehash the image archive.
- Local rerun at 2026-09-08T16:47:27Z: `node --test
  scripts/test/server-e2e-preflight.test.mjs scripts/test/visual-readiness.test.mjs`
  — 19 passed, 0 failed, 0 skipped. These are prerequisite/readiness regressions,
  not authenticated tests of the production sites.

## Acceptance matrix

| Scenario | Evidence actually checked | Still unverified in production |
| --- | --- | --- |
| Education → diary | Owner's successful navigation in multiple browsers | Other employee roles; fresh exact-release browser receipt |
| Personnel grants | Successful checked/unchecked screen and direct API tests across the role matrix; scoped HR reads reject foreign-branch data | Saved checkbox changes and effective access under real employee sessions |
| Tochka / DDS | 12/12 named pending-lifecycle tests found passing in the application build log; all-account statements, restart/retry, idempotency and rejected-row handling also passed | Actual four-account operations for the owner's requested period, bank/registry reconciliation and repeated live import without duplicates |
| Developer feedback | 14/14 named tests found passing: persistence, author isolation, atomic audit, deduplication, status revisions, authentication and CSRF | Sending an actual report through the published UI and seeing it in the owner's backlog after reload |
| Selective AlfaCRM | 8/8 staged-integration tests found passing; explicit branch/module dependencies, date bounds, no automatic weak identity merge, financial source separation | Real tenant/branch selection and counts; staged import against the configured tenant; verified payment-direction mapping |
| Backups | 7/7 backup-control tests found passing; actual hosted Docker tests listed below | Installation and first verified backup on production; manual completion and daily schedule of that installation |

Counts above identify named test cases within the same successful application
suite. They must not be added to 760 as extra application coverage.

Hosted Docker markers were checked in the Verify log: volume copy-up ownership,
worker isolation, live-WAL restore, singleton worker, actual Node/socket transport,
manual admission, durable restart history, missed-slot catch-up without duplicate
execution, consistent snapshots under writes, source preservation and refusal of
foreign/incorrectly owned input. Final marker:
`ARTHELLO_BACKUP_R7_HOSTED_DOCKER_RO_WAL_SOCKET_RESTART_ISOLATION=VERIFIED`.
These were disposable synthetic Docker fixtures, not the live ArtHello database.

## Access and release boundary

The last completed server prerequisite diagnostic available when this checkpoint
was prepared is run [34250193295](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34250193295),
observed at 2026-09-08T16:18:14.494Z on source
`b7183df258105a5a94446121ad66f8a0b7d73d2c`. Both fixed origins answered HEAD HTTP200.
It reported missing test login, missing/invalid test password, unconfirmed dedicated
account and unpinned browser image/source. The image was not inspected or run;
`liveAcceptance=not_run`, `productionMutations=false`.

A successful login on the owner's device does not expose that session to the
agent. A dedicated Education account is useful for diary/employee checks but does
not grant canonical-owner authority for bank settings, global feedback management
or backup operations. Those require their own authorized verification path.

No employee passwords, production keys, sessions or database records were
extracted in this continuation. No payment, bank sync, broad CRM import, backup
restore or production cutover was initiated. Existing release consumers and
their protected workflow, current-source, receipt and public-write guards were
not changed or rearmed. This Markdown file is deliberately not the JSON path
consumed by `check-school-live-acceptance-r7.py`.

## Next transition

Finish fresh main checks and obtain the scoped authenticated test access and
isolated browser runtime. Verify employee behavior and arrange a separate
authorized path for owner-only scenarios. Only then prepare the current release
identity and perform its actual clone/backup/cutover and post-release checks.
Owner-reported diary success stays accepted at its stated scope; lack of other
evidence must not be presented as a new failure of that already tested path.

Verdict for the **whole production release**: return to work — live acceptance
and protected delivery are incomplete. This is not rejection of the owner's
successful diary check.
