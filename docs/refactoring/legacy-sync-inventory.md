# Legacy `/sync` inventory

Status: **proposed design inventory; not an authorization to enable or remove routes**.

The canonical inventory is [`legacy-sync-inventory.json`](./legacy-sync-inventory.json). It covers every route declared in `artifacts/api-server/src/routes/sync.ts`, records one proposed disposition and maps exact literal call-site files per endpoint:

- `remove` — retire the generic status surface after supported consumers have replacements;
- `sandbox-script` — keep source probing, bulk import and one-off repair outside the public runtime;
- `scoped-job` — design a source-specific authenticated job with least-privilege scope, audit, idempotency and failure evidence.

## Safety boundary

D-029 remains authoritative. The central `LEGACY_SYNC_DISABLED` gate stays in place. A representative 503 proves only that the surface is unavailable; it does not prove that the underlying capability is unnecessary.

No route, mount, OpenAPI operation or generated client is removed by this candidate. Before a later removal candidate:

1. approve or revise every proposed disposition;
2. implement and prove every required replacement;
3. replace operator guidance in `routes/audit.ts` and the coverage UI;
4. update the OpenAPI source, regenerate the client and update the permission matrix together;
5. prove the route-table change, permission policy and visual acceptance on the exact candidate.

## Drift check

`node --test scripts/test/legacy-sync-inventory.test.mjs` compares the manifest with route declarations and scans the known consumer files for each exact route literal. Empty arrays explicitly mean that no literal reference was found in the searched groups. Any route or call-site change must therefore update this inventory deliberately.
