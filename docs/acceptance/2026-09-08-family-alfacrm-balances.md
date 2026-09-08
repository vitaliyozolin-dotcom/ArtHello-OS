# Family AlfaCRM monetary balances — 2026-09-08

Base: c9e7da06f7d3637c0032af542085f28acb02816a. Existing FamilyWorkspace blob verified as 8609599d54e68c5fe768dd1f3925da5d9edebc8a before modification.

## Behavior

The family detail card reads a separate GET /api/families/alfacrm-balances?familyId=... endpoint. It requires an authenticated canonical context and both Clients and Finance section read permissions. Non-owner reads require an active assigned branch (administrative users get all active branches). Unknown family/hidden branch/child IDs return the same 404. Source rows must belong to exactly the requested family and the stored local branch must still equal the current import mapping. Removed mappings, remapped branches and inactive imported customers suppress prior snapshots.

Every displayed amount is from the new importer-owned alfacrm_customer_balances projection with source_field Customer.balance. The projection joins its exact customer/remote branch/source-contract observation and payload hash through alfacrm_projection_lineage. Failed lineage returns an unconfirmed amount, never zero. The UI labels this as the last confirmed balance with its accepted source observation timestamp. When a newer raw observation failed projection, the prior amount remains dated and explicitly warns that the latest refresh is unconfirmed. Currency is unspecified because provider data does not establish it; no RUB symbol, cross-account sum, bank payment or financial_operation is manufactured.

## Verification

13 actual handler/SQLite and React SSR tests PASS. Fixtures compile the DDL directly from the paired importer source, execute actual parameterized SELECTs, and use the actual role/module/branch policy. Cases cover 401/403/404/503, spoofed owner, two-section grants, archived/other branch isolation, removed/remapped mappings, inactive customers, stale projection after failed refresh, zero/negative precision, malformed/missing lineage, generic DB errors, and unknown UI rendering. Targeted ESLint passes for endpoint and both affected TSX files.

Route inventory: the existing API_RULES /api/families prefix covers this nested path; a test demonstrates that a clients-only user passes proxy family read policy but is rejected by this route's finance check. quality-gates/permission-matrix.json was inspected; it governs the separate Express/PostgreSQL API, so its existing cases are retained unchanged. This SQLite endpoint is covered by the new runtime matrix tests.

Assembly: both FamilyWorkspace and the new component/route are regular v52 overrides copied by the existing Dockerfile. The exact base Dockerfile has 27 assembly script calls; the inspected local corresponding scripts contain only a read-only FamilyWorkspace reference in verify-system-wide-operational-shells. No new patch hook or main page replacement is introduced. The aggregate release must still execute its exact CI assembly/build/tests before publication; no live UI verification or production import is claimed here.

Changes are read-only and create no schema, credentials, sessions, imports, bank operations, or data mutations. The paired importer owns the new table and its migration/idempotence proof.

Root review follow-up: the parent mounts the balance component with key={detail.family.id}. The component also scopes errors to familyId and clears errors on allowed success or denied responses; all asynchronous state writes check cancellation. This prevents a previous family outage from leaving a financial error card visible after a subsequent family access denial. Targeted ESLint passed after this correction.
