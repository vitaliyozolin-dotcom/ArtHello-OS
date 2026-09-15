# Customer status policy — implementation checkpoint

Status: policy connected to candidate preview/import code, not deployed. No production application data changed.

Owner-approved rules: active statuses remain active; Open stays open; single visits are an attendance format with unverified activity; Registration is a lead; Trial and Completed are excluded. Missing status requires review. These rules must apply per source branch assignment, not globally to a family. No weak-contact merges. Preserve existing IDs, source evidence, contracts, financial history and access.

Implemented pure functions in `deploy/v52/src/lib/alfacrm-customer-policy.ts`: classification and branch/source-ID summary, duplicate observation detection, foreign membership exclusion, incomplete/unknown evidence blocking. School status produces routing-review evidence and never silently moves a person to another branch. Source preview is not an OS mutation plan or an active-family count.

Implemented account/branch-specific dictionary resolution, authenticated `previewCustomers`, family import exclusions, lifecycle/attendance/source-status metadata, stable linked sales leads, and enrollment filtering. Entity existence/archive state remains separate from customer lifecycle. The family list displays lifecycle and attendance; merged branch assignments preserve each source status. Unknown statuses stop before observations/projection/archival. Preview signatures and autosync scope include the new policy version; old schedules pause and enabling requires a completed family import under this policy. Raw customer payloads remain verbatim.

Validation: the actual SQLite import test first reproduced three imported pupils instead of one; after the fix it passes, including repeat-import identity stability. Tests cover read-only branch dictionary preview, unknown status preserving all entities/raw, linked lead idempotency and preservation of local sales stage. Existing finance fixture was updated to explicitly include its synthetic status ID, retaining exact raw-payload equality. No database DDL added; existing authenticated route extended.

Live availability on 2026-09-15: OS returned 502 / Connection refused on navigation and one reload; Atlas diary returned the same error. School 1–11 reached its sign-in page. No current session to verify its private roster. Existing diary family-access handlers derive class from member scope; source group routing and independent directory transfer remain required before any mass access action.

Remaining release work (mandatory):

1. Persist dictionary evidence in import lineage as well as resolved per-card status metadata; current raw lineage is the original customer observation.
2. Complete lifecycle transitions of already-linked leads when source status changes (current re-import preserves the local sales stage).
3. Build a database-aware comparison including existing aliases, local archives and access bindings. Protect manual records, retain financial/history rows, and reconcile only complete authoritative scopes.
4. Confirm Atlas educational routing by groups; the school label alone cannot rewrite source membership.
5. Complete tests for lead transitions and directory snapshots; run hosted release gates.
6. Publish via an appropriate protected release controller with backup/rollback. The old D182 one-shot cannot release this candidate.
7. Apply reviewed reconciliation and check both diaries, then repeat sync to verify no new duplicates. Enable scheduled sync only after successful verification.

The existing PR505 foundation remains unpublished. This checkpoint does not make that PR release-ready and must not be used to claim the approved migration has run.
