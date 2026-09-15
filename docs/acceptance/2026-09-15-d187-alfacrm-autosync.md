# D187 — AlfaCRM background refresh candidate

Base: `818c2019c6118f02b06367a02d4363b7194d3848`, tree `c2920e7a33a4a1191e24576d84276506acdd8758`.
Branch: `fix/alfacrm-background-sync`. Code prepared; production not activated; independent release acceptance pending.

## Evidence

- Before this change, central runtime had a Tochka timer but no AlfaCRM timer. AlfaCRM browser continuation is a finite manual import, not recurring server sync.
- RED: new state-machine/auth tests failed because scheduler functions did not exist (4 failures). GREEN: 6/6 state-machine, auth and timer tests.
- RED: repeat-import review test demonstrated that existing code resets `Проверено`. GREEN: stable imported fields preserve review and local metadata; changed source fields invalidate review.
- Explicit AlfaCRM suite: `node --test tests/alfacrm-autosync.test.mjs tests/alfacrm-lifecycle.test.mjs tests/alfacrm-correctness.test.mjs tests/alfacrm-node-transport.test.mjs tests/alfacrm-staged-integration.test.mjs tests/d180-alfacrm-live-import.test.mjs tests/alfacrm-repeat-assembly.test.mjs` from `deploy/v52/src`: 92/92. Two old runtime adapter failures were corrected by adding the explicit timer adapter, without weakening import activation assertions.
- Final stop/disconnect follow-up: `node --test --test-name-pattern='autosync|preserves local notes' tests/alfacrm-correctness.test.mjs`: 4/4, including clearing the advertised next-run time and disabling the schedule on disconnect.
- Root `pnpm run typecheck`: passed. Application `pnpm run typecheck` and final `pnpm exec tsc -p tsconfig.json --noEmit --incremental false`: passed.
- Application `pnpm run build`: passed. Local pnpm dependency installation did not replace the checked-in production npm lock; protected Docker CI must still verify that exact dependency graph.
- Targeted eslint: zero errors; one pre-existing unused `policy` warning in correctness test fixture.
- `node scripts/permission-proof.mjs`: 21/21, four pre-existing persona gaps. Its matrix covers the Express surface, so new V52 service-header and owner-action boundaries are additionally tested by the actual route fixtures.
- `git diff --check`: passed.

## Behavior and boundaries

One server timer checks every minute; no overlapping timer call. Existing single-worker connector mutex serializes manual and automatic mutations. Cycle, scope, phase, cursor and exponential retry state live in existing persisted connector JSON; no schema migration. Retry delays are 5, 10, 20 and 40 minutes; the fifth consecutive failure pauses. A successful cycle schedules the next one one hour later. Data rejection, stale preview, changed source/mappings and invalid cursor pause instead of inventing completeness.

The runtime flag defaults off. Owner enables only successfully imported selected modules after reconciliation; repeated import uses existing stable source identities and append-only observations. Families/staff/groups/subscriptions are supported. Lesson scheduling is intentionally outside this queue because the user selected worksheet Лист2, effective 2026-09-01. CRM finance remains behind the existing direction-validation gate. No credentials, passwords, access grants, live writes or data repairs were performed in production.

## Open production issues

- Live OS showed imported educational records under inconsistent Atlas branch labels. Reconcile source IDs and branch ownership before activation; do not automatically relabel or merge people.
- Both live diary directories were checked: School 1–11 has 6 classes, 0 pupils, 13 teacher positions; Atlas has 0 classes/pupils/teachers. A browser login is not a completed roster transfer.
- The separate OS→diary outbox previously showed six sync errors and four pending events. Current error sanitization collapses multiple transport/HTTP failures into one message; precise cause is not established. This candidate does not claim to fix that separate integration.
- Full protected CI/Docker runtime release, live hourly cycle, visual acceptance of the new controls and cross-process lease support are not verified. Current runtime is single-worker; require a durable lease before horizontal scaling.
