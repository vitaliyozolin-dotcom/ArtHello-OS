# Legacy `/sync` inventory

Status: **retired under D-067**.

The canonical inventory is [`legacy-sync-inventory.json`](./legacy-sync-inventory.json). It covers every route declared in `artifacts/api-server/src/routes/sync.ts`, records one proposed disposition and maps exact literal call-site files per endpoint:

- `remove` — retire the generic status surface after supported consumers have replacements;
- `sandbox-script` — keep source probing, bulk import and one-off repair outside the public runtime;
- `scoped-job` — design a source-specific authenticated job with least-privilege scope, audit, idempotency and failure evidence.

`sandboxReplacementEvidence` distinguishes existing guarded importer coverage from blocked legacy capabilities. `covered` means only that the required source-reading capability exists outside the public runtime; it does not authorize route removal. `blocked` records the missing decision or evidence explicitly.

## Safety boundary

D-029 remains authoritative. D-067 approves the recorded dispositions and removes the universal router without enabling any replacement. The central `LEGACY_SYNC_DISABLED` gate stays in place for the remaining historical Google-leads path and any accidentally reintroduced legacy path.

The retired capabilities were not silently reimplemented. Covered read-only source access remains in guarded sandbox scripts; scoped jobs and blocked repair/classification capabilities remain unavailable until separately approved and proven.

## Drift check

`node --test scripts/test/legacy-sync-inventory.test.mjs` proves that the source router and mount are absent and that every retired literal disappeared from the API contract, generated client and operator surfaces.
