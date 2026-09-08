# AlfaCRM staged import — release candidate 2026-09-08

Scope: fixes to PR #340 head `041e037e0458426657dcf51385f0dd8dd0baa2c1`, assembled over main `9e4c49161e643997fe821a91b84c60c6e38ede33` and locally checked together with existing Education/Tochka/Feedback candidates. No Git push, merge, production deployment, live CRM reads or credential mutation performed by this agent.

## Changes

- Dedicated AlfaCRM POST policy for DIRECTOR/INTEGRATIONS. The route also checks the explicit integration assignment, checked module, actual authenticated identity, CSRF and active local branch grants. Credentials/disconnect/global branch mappings are canonical-owner-only. UI reflects these permissions.
- Generic integrations GET now respects the owner's section checkbox instead of a second obsolete read-role list. Connection assignment and bank-owner redaction remain. Existing source ratchets are updated to assert the module boundary.
- The runtime forwards `ALFACRM_IMPORT_ENABLED` into Miniflare with an empty default. No gate was enabled or removed.
- Every import appends immutable raw observations and a batch; mutable current pointers are separate. Every materialized family, parent, child, employee, group, lesson, membership, tariff and CRM payment has an explicit observation/batch lineage record. DB triggers reject UPDATE/DELETE on observations, including unchanged repeated payloads.
- Completed fully accepted family/staff/group snapshots reconcile only the selected branch scopes. Departed source entities and membership are archived, preserving local/manual data and historical raw records. Malformed/partial/error reads never prove absence. A rejected materialized row prevents retirement and sets module error status.
- Membership rebuild follows both families and groups; the allowed staff→groups→families order now works, group departures and ceased memberships are retired.
- Finished imports consume preview tokens and reset cursors. Subscription batches retain the preview only until completion; a frozen customer-list signature prevents changed membership from silently skipping clients. Reconnect/mapping changes invalidate preview readiness.
- Pagination rejects malformed payloads, invalid totals, duplicate/overlapping IDs, repeated pages, contradictory totals, premature empty responses and page-limit truncation. It handles a server-enforced page size below 500 by continuing until authoritative total or explicit empty terminal page.
- Mutations are serialized inside the deployed single worker, preventing concurrent tabs from consuming the same preview or updating its cursor concurrently. This is not a distributed lock for a future multi-worker deployment.
- Existing legacy `alfacrm_import_records` data is retained unchanged. If legacy rows exist, import returns 409 pending a reviewed migration rather than inventing historical provenance.

## Validation

- Original regression harness: 4 controls passed, 5 expected failures reproduced before fixes (`red-results.txt`).
- New SQLite behavioral suite: 28/28 passed, including real policy, branch restrictions, raw/lineage constraints, reconciliation, pagination, batched cursor and concurrent POST. Additional runtime-binding/legacy tests: 3/3 passed. Final suite contains 31 cases.
- Combined application suite (previous 507 + PR340 9 + new lifecycle 28): **544/544 passed**, 42.2 seconds, `full-test-results.txt`.
- Production Vinext build: **PASS**, `production-build-results.txt`. No Docker available here; this is not a built/published deploy image.
- Full application ESLint: **PASS**, `full-eslint-results.txt`; targeted changed sources also PASS.
- Global TypeScript: **not green**. Existing application errors remain; Alfa route now only reports the existing missing `cloudflare:workers` module declaration, not new implicit-any errors. `typecheck-results.txt`.
- Live tenant coverage, representative restored production DB, actual new credentials, production browser workflow, scheduled incremental sync and deployment are **not verified**. Release gate stays closed until those conditions are actually satisfied. This code enables selective manual inbound import after the gate; it does not silently enable automatic sync.

## Integration instructions

`repo/` is a repository-relative overlay. `manifest.json` lists exact files and SHA256. Apply semantic deltas for shared files instead of overwriting other agents' updates:

1. `deploy/v52/overrides/lib/access-policy.ts`: add only the dedicated `/api/integrations/alfacrm` API rule. Preserve the current Education/Feedback/Backup policy additions.
2. `deploy/v52/overrides/production/runtime-server.mjs`: add only `ALFACRM_IMPORT_ENABLED: process.env.ALFACRM_IMPORT_ENABLED || "",` in bindings. Preserve backup transport/service and other runtime additions.
3. `deploy/v52/Dockerfile`: add `patch-alfacrm-staged-integration.mjs` then `patch-alfacrm-style-import.mjs` after `patch-system-operational-modules.mjs`; add `patch-css-budget-shell-split.mjs` after `patch-school-sso-entry.mjs`. Preserve every other candidate's build step.
4. `app/api/integrations/route.ts`: remove obsolete `readers` and `readers.has` GET denial; preserve concurrent bank/owner changes.
5. `tests/tochka-owner-connection.test.mjs` and `tests/acceptance-gaps.test.mjs`: replace the obsolete readers.has ratchet with canAccessModule/allowedModules and deny the old reader list. Preserve Tochka pending-lifecycle test transformations. The source test copies are based on main, while the local `build/` uses the already-patched final Tochka test file.
6. Copy all dedicated Alfa files and D068. Run original staged/style/shell split scripts only once on a fresh assembled source tree (style script removes its transient .styles.txt; shell split is not idempotent). Route itself already includes the correctness changes the staged script normally applies, and its guarded replacements are compatible.
7. No change to SettingsWorkspace, migration0025 or backup schema. New Alfa SQLite schema is additive runtime `ensureAlfaTables` DDL, as in PR340. PostgreSQL journal/migration-twin do not govern this D1 runtime.

## Migration-check applicability

| Check | Result | Evidence |
|---|---|---|
| D1 new schema additive | PASS | New batch/raw/current/lineage tables and observation immutability triggers; no ALTER/DROP/destructive raw mutation |
| D036 raw append-only | PASS locally | Repeated same and changed payloads preserved; UPDATE/DELETE rejected; explicit lineage joins |
| Old raw data preservation | PASS locally | Legacy rows cause409 before network/current materialization |
| PostgreSQL journal/barrel/rollback parity | N/A | No changes under lib/db/src/schema, lib/db/drizzle, or manual migrate.ts |
| PostgreSQL migration-twin | SKIPPED | D1 SQLite candidate; no TEST_DATABASE_URL |
| Representative production restore | NOT VERIFIED | Parent release gate must prove this on a backup before enabling live import |

Rollback: old application can ignore new additive tables. Preserve new observations/lineage and backup data; do not drop tables as part of application rollback. Raw preservation does not substitute for the production backup/restore gate.
