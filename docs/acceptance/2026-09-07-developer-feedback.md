# ArtHello OS: developer feedback candidate

Baseline repository main: `9e4c49161e643997fe821a91b84c60c6e38ede33`.
This directory is a candidate, not a production publication. No GitHub or production mutation was performed by this agent.

## Behavior

- Global “Разработчикам” button above the existing Help button, including mobile safe-area spacing.
- Native modal dialog: error/proposal, title, description; “Мои обращения” shows the caller’s persisted reports and status.
- “Все обращения” is returned and exposed only for the canonical system owner, who can change status. Other users cannot list anybody else’s reports or change status.
- Author ID/name come from the authenticated server context. Caller-supplied identity/status on creation is rejected. Same-origin, CSRF, must-change-password, role and session checks apply both at proxy and handler level.
- Messages stay within ArtHello OS. There are no email, messaging or GitHub-issue deliveries.
- Dedicated `developer_feedback` and `developer_feedback_events` SQLite tables. Author-scoped retry UUIDs prevent duplicate reports after a lost response; report and event writes use atomic D1 batches. Status revisions reject stale updates.
- Pagination is bounded to 50 records. Input title/body and total request size are bounded. Only a known module identifier is stored as page context; URLs, cookies, query strings and browser logs are not collected.

## Integration

Copy `candidate/deploy/v52/overrides/` into the repository’s same path. After the existing finance allocation build hooks, before lint/test, add to `deploy/v52/Dockerfile`:

```dockerfile
    && node /app/scripts/patch-developer-feedback.mjs \
```

The idempotent, fail-closed build patch registers the API permission, mounts the UI in ArtHelloShell and appends the Drizzle schema. It does not modify `db/index.ts`, its pinned checksum, deployment triggers or approval controls.

Migration `0025_developer_feedback.sql`, generated Drizzle snapshot and journal accompany the schema. Runtime `ensureDeveloperFeedbackTables` executes the same additive, idempotent statements in D1 before use; both forms have exact parity coverage. No migration is run against production by this candidate.

Code rollback should retain the additive tables and feedback records. Destructive schema rollback SQL is included only for a backed-up database after a verified restore; it deletes the feedback tables. Production release must back up and verify restore before schema activation.

## Evidence

Integration ratchet update: `tests/tochka-bank-schema-migration.test.mjs` now pins the bank migration to journal entry24 and checks the complete contiguous journal/snapshot chain including25. Existing bank-table/index and 23→24 snapshot invariants are unchanged. Combined feedback + bank-migration checks: **16/16 PASS**.

- `node --test tests/developer-feedback.test.mjs`: **14/14 PASS** on Node 24 SQLite. Covers real SQL migration apply/reapply/down/reapply, prior-row preservation, integrity/FK checks, unchanged prior Drizzle snapshot tables, persistence/audit atomic rollback, idempotence, author scope, cursor pagination, stale-status concurrency, malformed/oversized input, real API policy, HTTP authentication/CSRF/origin and canonical-owner boundaries. HTTP auth is injected; live login is not simulated as proof.
- Targeted ESLint: **PASS** for new UI/API/library/build patch/tests.
- Strict TypeScript check of new component, service and schema: **PASS**.
- Build patch reapply: **PASS** in an isolated assembled application copy.
- Independent review found overlap with existing Help; button positions were moved above Help. Desktop/mobile browser hit testing remains required.

Full assembled baseline `tsc` is not green: missing Cloudflare worker declarations and pre-existing errors in HR/procurement/workflow/access-policy/readiness. No full build, live login, browser visual/hit-test or production acceptance is claimed for this candidate.

## Migration-check application

| Check | Status | Evidence |
| --- | --- | --- |
| SQLite journal/snapshot delta | OK | idx25 follows24; snapshot prevId is checked; only the two feedback tables are added |
| Prior data and idempotence | OK | Node SQLite applies migration twice, checks legacy user, integrity and foreign keys |
| Runtime/migration parity | OK | Exact SQL statement equality in test |
| Rollback companion | OK | down/reapply tested; code rollback retains data; destructive down requires backup |
| PostgreSQL journal/barrel/migration-twin | SKIPPED | v52 uses SQLite/D1; legacy Express/PostgreSQL schemas are unchanged |
| Existing post-build snapshot drift | OPEN | Finance allocation build patch adds five financial_operations fields absent from0024 snapshot; this migration deliberately does not repeat the already existing live changes |
| Representative restored production copy | SKIPPED | No production DB access/backup was used for this candidate |
| Exact-head CI and production UI | SKIPPED | Root owns publication and acceptance |

Verdict: **CONDITIONAL PASS for candidate review**, not a production readiness claim. `manifest.json` records candidate paths, byte sizes and SHA-256 hashes.
