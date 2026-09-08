# ArtHello v52 combined product recovery candidate — 2026-09-08

Source base: `9e4c49161e643997fe821a91b84c60c6e38ede33` (GitHub main).
This is a product code candidate, not a claim of production publication.
Infrastructure/builder policy remains in the separate infrastructure PR.
The proof workflow only gains hidden-artifact upload and actionable failure
diagnostics; its visual acceptance rules remain unchanged.

## Included product changes

- PR348: Education reads follow assigned modules and active branch grants.
- PR349: Docker preflight parses network output correctly without changing gates.
- PR350: verified host SQLite Online Backup, manual service and daily timer.
- PR351: durable pending bank statements, fenced lifecycle, resumable retrieval.
- PR352: authenticated developer feedback and canonical-owner triage, additive migration 0025.
- September 8: automatic read-only Tochka timer and schedule integration; disabled
  in clone/preflight by default and enabled only through reviewed production config.
- September 8: backup owner Settings UI/API and fixed-command host Unix bridge.
  Dedicated persistent state directory preserves the mounted directory across
  bridge restart and host reboot. Malformed manifests do not break all history.
- September 8: personnel permission/session refresh and scoped read corrections.
- PR340 plus September 8 lifecycle fixes: selective AlfaCRM inbound import,
  append-only raw observations with lineage, cursor/pagination reconciliation,
  role and scope checks. Live import flag remains closed by default.
- Updated readonly School callback diagnostic and production observation report.
  School SSO is still unresolved; no functional SSO fix is claimed.

## Source integration

The fresh application tree is reconstructed from the original archive with SHA256
`e76fb44dca272825fda4486e7584290b14969c1fd054a8c955eae738899b7c12`, followed by
v44 and v52 overrides and all 27 ordered Dockerfile patch scripts. Before finance,
bank/autosync and feedback changes, the existing db/index.ts checksum remains
`e78978c13431d32a0db2db25da73f24fd6245703aa14d4cb3ec34647324f6f40`.

Common runtime bindings, backup/Alfa permission rules and Settings/Shell changes
were merged as deltas. Raw source is retained before build hooks; assembled
DeveloperFeedback injection is not duplicated. Pending statements patch runs
before autosync; both run after the existing DB checksum; feedback migration0025
and its schema patch follow them. Alfa schema adds its own D1 tables/triggers.

Two test fixtures were extended for added runtime dependencies/bindings without
weakening authorization assertions. Tailwind now excludes tests from source
scanning, retaining application source scanning; this prevents fixture strings
from generating production CSS utilities. The existing 250000-byte CSS gate is
unchanged. This uses the [documented Tailwind source exclusion](https://tailwindcss.com/docs/detecting-classes-in-source-files#ignoring-specific-paths).

## Deployment boundaries

- No GitHub merge, image build, host installation or production publication was
  performed by the integration agent.
- Docker is unavailable; no immutable deploy image/digest is asserted.
- This environment prohibits Unix socket creation. The two real backup transport
  smoke tests explicitly skip locally; an isolated builder must run them with
  `ARTHELLO_BACKUP_REQUIRE_UNIX=1` so unsupported sockets fail rather than skip.
  This flag is now mandatory in the application Docker build stage only; it is
  not inherited by the production runtime stage.
- Representative restored production DB and owner/non-owner browser acceptance
  remain required. Synthetic SQLite tests do not replace this recovery gate.
- Preserve additive data tables on application rollback. Do not run destructive
  down migrations against live data as part of an app image rollback.
- Host backup covers one ArtHello database on the same server. School, external
  files, decryption keys and off-server retention remain separate recovery scopes.
- Production-only configuration/install details are in the backup, Tochka,
  AlfaCRM and School acceptance documents. Automatic flags stay disabled in
  preflight/clone and live Alfa is not activated by a code merge alone.

## Permission boundary and decision provenance

Newly assigned sections now respect active branch grants where a provable row
relationship exists. Accounting/Analytics/Readiness/Acceptance lack a complete
independent row-scope contract for newly assigned roles; they open with restricted
data and an explicit explanation. HR also restricts native non-owner reads to
active branches and omits private financial/legal records. These boundaries are
recorded in `2026-09-08-personnel-scoped-access.md`; opening a section is not a
claim that all desired business data is available.

Root DECISIONS D-061/D-062 and the project passport record the recovery decisions.
The existing PR340 `docs/decisions/D-068-alfacrm-staged-import.md` remains in its
original separate legacy document namespace; its history was not renumbered.

## Verification

Final combined verification completed on 2026-09-08:

- Fresh source assembly: PASS, 27 Dockerfile hooks, pinned archive and pre-candidate
  DB source checksums verified. See `2026-09-08-recovery-source-assembly.log`.
- `npm test -- --test-concurrency=1`: PASS, production Vinext build followed by
  **700 tests: 698 passed, 0 failed, 2 explicitly skipped**. See
  `2026-09-08-recovery-full-test.log`. The two local skips are real Unix socket
  tests blocked by this environment; Docker CI requires them and may not skip.
- Full ESLint: PASS. See `2026-09-08-recovery-full-eslint.log`.
- Host backup Python suite: 10 passed; bridge Python suite: 11 passed. These use
  temporary SQLite databases and injected command adapters, not production data.
  See `2026-09-08-recovery-backup-host-tests.log`.
- Network preflight regression suite: 9 passed. See
  `2026-09-08-recovery-network-tests.log`.
- Installer/network shell syntax, three systemd unit syntax checks and readonly
  School diagnostic redaction self-test passed in the local integration session.
- Global production CSS: 247242 bytes against the unchanged 250000-byte limit.
- Whole-project TypeScript has pre-existing declaration/implicit-any diagnostics;
  no successful global typecheck is claimed.

Two existing Analytics/Readiness source assertions were updated to recognize
`scopedRead` as an additional empty-data guard while retaining the mandatory
empty mode and all previous Education assertions. Their targeted four tests and
subsequent full suite passed. No runtime behavior was changed for these ratchets.

Production image publication, live Unix container mount/restart, a restored
production DB, and real owner/non-owner browser acceptance are separate gates.
The local successful build and tests do not certify those gates.
The source manifest contains additions/updates only, preserving all GitHub files
that were not present in the local sparse mirror. Installed dependencies and
build output are excluded from the repository payload.
