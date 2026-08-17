# ArtHello OS

AI-native business cockpit for a Russian educational center (ArtHello).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `pnpm --filter @workspace/alpha-crm-sync run dev` — frontend (port 21987)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build:full` — typecheck + build all packages
- `pnpm run build` — package-manager-neutral build безопасного Sites artifact
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run generate` — generate drizzle migration file after schema changes (**required before deploy**)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind + shadcn/ui, wouter routing
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

---

## 1. Current Project Status

- **Project**: ArtHello OS
- **Current phase**: P8.4b — Bank ↔ AlphaCRM Reconciliation. COMPLETE (2026-05-24). p85CanStart=true. Next step: P8.5 — Verified ДДС + ОПиУ (bank is expense truth; revenue truth requires collection reconciliation).
- **Scope**: Atlas branchId=6 (AlphaCRM Atlas branch)
- **Alpha operational layer**: READY_WITH_CAVEATS
- **Bank reconciliation**: PARTIAL_READY
- **Final financial truth**: NOT_READY

---

## 2. Final AlphaCRM Audit Summary

| Layer | Status |
|---|---|
| Big AlphaCRM Audit | COMPLETE_WITH_CAVEATS |
| Alpha Operational Layer | READY_WITH_CAVEATS |
| Bank Reconciliation | PARTIAL_READY |
| Final Financial Truth | NOT_READY |

AlphaCRM data is normalized and linked, but AlphaCRM payments are not bank-reconciled financial truth.

---

## 3. Current Data Counts (Atlas / branchId=6)

**Students / Identities**
- Active student IDs in attendance: 144
- Inactive student IDs: 6
- Historical placeholders (hard-deleted): 158
- Unresolved attendance identities: 0 ✅

**Attendance**
- Total records: 99,148
- Active student attendance: 70,813
- Inactive student attendance: 41
- Historical-only attendance: 28,335
- Unresolved: 0 ✅

**Lessons**
- Normalized: 15,370 | Date range: 2024-01-09 → 2026-05-22 (29 months)
- With visit details: 15,291 | Without details: 79

**Teachers**: 132 raw → 132 normalized

**Groups**: 60 total | 56 with teacher | 47 with inferred subject | 2 ambiguous | 11 no subject | 4 no teacher

**Subjects**: 343 total | 82 referenced by lessons | 0 unresolved

**Payments**
- Normalized: 22,365 | Parse errors: 0
- income: 14,757 | correction: 7,317 | outcome: 229 | refund: 12 | unknown (legacy): 50
- Linked to active student: 16,002 | Linked to identity: 5,959 | Unlinked after cleanup: 404
- Risk HIGH: 279 | MEDIUM: 7,450 | LOW: 14,636
- Issues: 566 (collection_high_risk×229, customer_not_found×122, suspicious_amount×115, unknown_type×50, possible_duplicate×30, correction_high_risk×18, refund_review×2)
- Collection/internal encashment: 229 records / ~135M ₽

---

## 4. Current Known Caveats

- AlphaCRM payments are operational CRM records — **not bank truth**.
- 229 collection/encashment records (~135M ₽) are `collection_internal` — excluded from client revenue until bank reconciliation.
- 50 unknown payment records are legacy with NULL data — not auto-resolvable.
- 158 historical placeholders are **not active students** — must not appear as active clients in analytics.
- Some AlphaCRM customers were hard-deleted and are no longer exposed via API.
- `customer_tariffs` status: UNKNOWN / limited.
- `tariff_movements`: NOT_FOUND — subscription burn history unavailable.
- `balance/debt` fields not in customer payload — outstanding balances unavailable.
- Some AlphaCRM endpoints ignore date range filters.
- AlphaCRM enforces max 50 records/page regardless of requested PAGE_SIZE.
- `discounts` endpoint ignores pagination — returns all records on every page.
- Some branch `customer/index` endpoints return a global pool, not branch-filtered students.

---

## 5. Key Technical Decisions

- **Raw data first**: always preserve full AlphaCRM JSON in `alpha_raw_records`.
- **Atlas is active scope**: branchId=6. Do not mix non-Atlas branches into product truth.
- **Historical deleted customers** are represented via `crm_student_identities` — not as fake active students.
- **AlphaCRM payments** remain separate from `bank_transactions` until bank reconciliation.
- **collection_internal** is excluded from client revenue until bank reconciliation.
- **Contractor/counterparty layer** belongs to P8, not the AlphaCRM audit.
- **UI visual unification** is later — not current priority.

---

## 6. Important Endpoints

**AlphaCRM coverage / audit**
- `GET /api/coverage/final-alpha-audit-report?branchId=6` — full P7.7 structured report
- `GET /api/coverage/atlas-summary`
- `GET /api/coverage/payment-truth-audit?branchId=6`
- `GET /api/coverage/payment-cleanup-audit?branchId=6`
- `GET /api/coverage/attendance-student-identity?branchId=6`
- `GET /api/coverage/entity-reconciliation?branchId=6`
- `GET /api/coverage/normalization-audit?branchId=6`

**Sync / repair (idempotent)**
- `POST /api/sync/normalize-students-from-raw`
- `POST /api/sync/normalize-teachers-from-raw`
- `POST /api/sync/normalize-groups-from-raw`
- `POST /api/sync/normalize-lessons-from-raw`
- `POST /api/sync/extract-attendance-from-raw`
- `POST /api/sync/normalize-historical-students`
- `POST /api/sync/normalize-payments-from-raw`
- `POST /api/sync/p76-cleanup-payments`

**Scope / branch**
- `GET /api/coverage/scope`
- `GET /api/coverage/branches`

---

## 7. Database / Environment Warning

Production and dev databases may contain different data.
- Production is the source of truth for real bank data.
- Dev may contain synthetic/test data.

**Before P8**: verify current DB environment, bank accounts, bank transactions, and confirm environment guard is active.

---

## 8. Next Stage: P8 — Bank Operations Truth Audit + Counterparty Foundation

**P8.1 — Bank Accounts Verification** ✅ COMPLETE
**P8.2 — Bank Transactions Audit** ✅ COMPLETE
**P8.3 — Counterparty Foundation** ✅ COMPLETE (production verified 2026-05-24)
- DB: 4 tables (counterparties, bank_transaction_counterparty_links, counterparty_aliases, counterparty_duplicate_candidates)
- Sync: `POST /api/sync/build-counterparties-from-bank` (idempotent, ran on production)
- Audit: `GET /api/coverage/counterparties-audit`
- UI: tab "🏢 Контрагенты (P8.3)" in AlphaCRM Coverage
- Production results: 79 counterparties, 854/854 tx linked (100%), 66 duplicate candidate pairs, readiness: READY_WITH_REVIEW
- byType: tax_authority×38, contractor×27, employee_or_self_employed×10, parent_client×2, bank_or_fee×1, internal_company×1
- byConfidence: high×40, medium×25, low×14
- Internal transfers: ООО "АРТХЕЛЛО" (INN 7802561028) flagged — must be excluded from revenue/expense in P8.4
- 66 duplicate candidate pairs (reason: same_inn_diff_key) — manual review only, DO NOT auto-merge

**P8.4 — Bank ↔ AlphaCRM Reconciliation** ✅ COMPLETE (2026-05-24)
- runId: db34494c-0da9-4e46-962f-90733faf4bb0
- bankAlphaReconciliationReadiness: PARTIAL_READY, p85CanStart: true
- 854 bank tx checked | 10,611 CRM payments checked (6,791 income-eligible)
- 380 excl bank_fee (Точка) | 273 excl internal_company (ООО АРТХЕЛЛО) | 97 excl collection_internal
- 0 confirmed matches | 1 possible (low conf, Δ341d) | 6 needs_review (all СМИЛОВИЦКАЯ, Δ200-340d)
- 194 unmatched bank tx — ALL expenses (direction=expense): contractors, taxes, utilities, leasing
- STRUCTURAL FINDING: ArtHello income model is CASH-BASED. Client payments come as cash → инкассация (collection_internal, 229 records ~135M ₽). Individual bank income transfers = ~7 (one payer). CRM income records (6,791) are not individually matched to bank because they are cash, not wire transfers.
- Reconciliation approach for P8.5: bank = expense truth | collection batch deposits = revenue truth (инкассация matching)
- New endpoint: POST /api/sync/backfill-payments-normalize (idempotent, sets type/date from raw JSON)

**P8.5 — Verified ДДС + ОПиУ**
- UNBLOCKED: p85CanStart=true
- Bank is the source of truth for expenses (contractors, taxes, utilities, leasing)
- Revenue source of truth: requires matching bank cash deposits to CRM collection_internal records (229 inкассация records, ~135M ₽)
- DO NOT use CRM individual income payments as revenue until collection reconciliation is done

---

## 9. Do Not Do

- Build final ДДС before bank reconciliation
- Build final ОПиУ before bank reconciliation
- Build AI CFO before reconciled data exists
- Treat AlphaCRM payments as bank truth
- Count `collection_internal` as client revenue
- Show historical placeholders as active students
- Mix non-Atlas branches into Atlas product truth
- Redesign UI before data truth is complete
- Create contractor cards before bank operations truth audit
- Draw final financial conclusions before bank reconciliation

---

## 10. Immediate Next Task

**P8.4 — Bank ↔ AlphaCRM Reconciliation**

Prerequisites: ✅ ALL MET — P8.3 READY_WITH_REVIEW, 854 tx linked, counterparties built.
Goal: match bank transactions to AlphaCRM payments, classify parents/collection/refunds, mark confirmed/partial/unmatched.

Key constraints for P8.4:
- ООО "АРТХЕЛЛО" (internal_company) must be EXCLUDED from all revenue/expense calculations
- 2 parent_client counterparties need AlphaCRM family matching
- 66 duplicate candidate pairs need manual review (not auto-merge)
- 14 low-confidence counterparties need type review
- DO NOT build final ДДС or ОПиУ before P8.4 completes

---

## Where Things Live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/crm.ts` — CRM DB tables (branches, students, teachers, groups, lessons, attendance, payments, student_identities)
- `lib/db/src/schema/persons.ts` — Identity layer: persons, families, student_profiles, guardian_student_links
- `lib/db/src/schema/banking.ts` — Bank tables: bank_transactions, bank_transactions_raw, bank_sync_runs
- `artifacts/api-server/src/lib/alphaCrmClient.ts` — AlphaCRM HTTP client (auth, rate-limiting, pagination)
- `artifacts/api-server/src/routes/sync.ts` — all sync route handlers
- `artifacts/api-server/src/routes/audit.ts` — all audit/coverage route handlers
- `artifacts/alpha-crm-sync/src/AppShell.tsx` — main app shell (sidebar + mobile nav + Owner/Technical mode)
- `artifacts/alpha-crm-sync/src/pages/coverage.tsx` — Technical Mode → AlphaCRM Coverage (13 tabs)
- `artifacts/alpha-crm-sync/src/pages/pulse.tsx` — Owner Mode: Executive Pulse Dashboard

## Architecture Decisions

- Read-only mirror: nothing is written back to AlphaCRM
- Rate-limited client: max ~4.75 req/s (under AlphaCRM's 5/s limit)
- Paginated fetching: `crmGetAllPages()` walks all pages automatically
- Upsert pattern: all synced data uses `onConflictDoUpdate` — re-syncing is idempotent
- Every sync operation writes a `sync_logs` entry for audit

## AlphaCRM Client

- ALFACRM_DOMAIN: `arthellonew.s20.online` (hardcoded default in `alphaCrmClient.ts`)
- Secrets: `ALFACRM_EMAIL`, `ALFACRM_API_KEY`
- Token expires after ~1 hour; client auto-refreshes on 401
- Atlas branch lookup: `lower(name) LIKE '%атлас%' OR '%atlas%'`

## Gotchas

- Always run `pnpm run typecheck:libs` after changing `lib/db/src/schema/` before typechecking api-server
- `crmGetAllPages` uses POST for AlphaCRM index endpoints (not GET)
- Never use `console.log` in server code — use `req.log` in handlers, `logger` elsewhere

## ⚠️ Migration Rules (critical — violating these breaks Publish/Deploy)

Replit's Publish flow validates the drizzle migration chain (`lib/db/drizzle/meta/`). Breaking the chain causes **"Failed to validate database migrations / Load failed"** in the Publish UI.

### Correct workflow for any schema change:
1. Edit `lib/db/src/schema/*.ts` (the Drizzle source of truth)
2. Run `pnpm --filter @workspace/db run generate` → creates a new `XXXX_*.sql` + `XXXX_snapshot.json` in `lib/db/drizzle/`
3. Run `pnpm --filter @workspace/db run push` to apply to dev DB
4. Commit both the SQL file AND the snapshot file
5. Republish → Replit applies the generated SQL to production automatically

### What will break Publish:
- **NEVER** manually add `.sql` files to `lib/db/drizzle/` without running `generate` — the snapshot will be missing and Publish will fail with "Load failed"
- **NEVER** add schema changes only to `migrate.ts` (startup DDL) without also updating the Drizzle schema + running `generate` — Replit won't know about them
- `drizzle.config.ts` must NOT throw on missing `DATABASE_URL` (use `?? "postgresql://localhost/placeholder"`)

### migrate.ts role:
- `migrate.ts` is a **legacy idempotent guard** — it catches tables/columns that exist in DB but aren't tracked by drizzle migrations
- New schema changes should go through Drizzle `generate`, NOT only through `migrate.ts`
- If a change is added to `migrate.ts`, also add it to the Drizzle schema and run `generate`

## User Preferences

- ALFACRM_DOMAIN: arthellonew.s20.online
