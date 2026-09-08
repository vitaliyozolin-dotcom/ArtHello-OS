# Procurement / Food — scoped reads for explicitly added sections

Source: permissions-finish-20260908 GET candidate, combined recovery-build-20260908.

This patch applies row filtering only when the section was explicitly granted beyond the user's native role template. It preserves existing native role read models and all mutation permissions. Shared authorization contract is owned by permissions_acceptance in `lib/section-read-scope.ts`:

- `requiresAssignedReadScope(user, pathname)` strips only the explicit module grants to detect new read access.
- `assignedActiveBranchScope(user, branches, grants)` accepts persisted active branch grants (administrative flag means all active branches).
- `allowsBranch` accepts an exact branch ID or an unambiguous exact active branch name; object reference fields accept only exact branch IDs. Entity metadata or fuzzy text never creates scope authority.

## Data boundaries

Procurement: purchase-request `unit` establishes branch scope; offers/orders/deliveries follow their documented request/order references. Assets require an allowed branch `objectEntityId`; maintenance follows the asset. Stock requires a scoped warehouse; a shared SKU link alone does not prove a stock location. Inventory movements with foreign endpoints are omitted. Suppliers, names and tasks are restricted to retained related records. Hidden item/asset references are blanked.

Food: shipment destination and check object require allowed branch IDs. A production aggregate is visible only when it has linked shipments and all are visible. A shift is visible only when all its linked production runs are visible. An allowed shipment can remain while its inaccessible production reference is blank. Recipes/ingredients/products are included only through retained references; batches require both a scoped purchase request and a scoped warehouse. Related names and tasks are filtered.

For these newly scoped reads, neither route queries financial_operations. An added section checkbox does not establish legal-entity authority over the financial register.

If a retained food shipment/production references hidden production or shift costs, profit/margin and incomplete cost totals are `null`, not zero. FoodWorkspace shows “Недостаточно данных” and an unknown margin. Its candidate differs from the raw main FoodWorkspace by exactly four replacements; there are no build-hook changes.

## Integration

Copy `payload/deploy/v52/overrides/` after the previous permissions candidate. It contains two routes, `lib/scoped-operational-reads.ts`, four-line nullable-economic UI change, and regression tests. Include the shared `section-read-scope.ts` from the latest permissions_acceptance payload. No Dockerfile, runtime, migration, schema, credentials or production data changes.

Initial targeted ESLint passed. Production Vinext build passed. Global typecheck retains baseline errors; no errors reference these changed files. Regression fixtures: **17/17 PASS** (`scope-tests.log`), including 9 real-handler cases; grants are bound to the authenticated user, financial reads throw in newly scoped fixtures, revoked checkbox blocks before DB, native PROCUREMENT/KITCHEN catalog behavior is retained. Updated source and test ESLint: PASS (`eslint.log`). No production verification or deployment was performed by this agent.
