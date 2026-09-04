# Zod import boundary

Status: **mixed semantics recorded; no migration decision has been made**.

The workspace catalog pins `zod: 3.25.76`. Runtime source currently uses the
package through two different public entry points:

- `zod/v4` is the established entry point in database schemas and most API
  route validation;
- the root `zod` entry point remains in the generated API schemas and the
  banking route.

The root imports are compatibility boundaries, not a preferred convention.
Changing either one can change validation semantics and therefore requires the
D-decision called for by Phase 1 of `REFACTORING_PLAN.md`. Generated code must
be changed through the OpenAPI/codegen source rather than edited by hand.

`scripts/test/zod-import-boundary.test.mjs` prevents an accidental third root
consumer and pins this evidence to the catalog version. It intentionally does
not authorize a bulk import rewrite.
