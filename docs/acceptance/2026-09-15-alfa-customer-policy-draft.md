# Customer status policy — implementation checkpoint

Status: policy connected to candidate preview/import code, not deployed. No production application data changed.

Owner-approved rules: active statuses remain active; Open stays open; single visits are an attendance format with unverified activity; Registration is a lead; Trial and Completed are excluded. Missing status requires review. These rules must apply per source branch assignment, not globally to a family. No weak-contact merges. Preserve existing IDs, source evidence, contracts, financial history and access.

Implemented pure functions in `deploy/v52/src/lib/alfacrm-customer-policy.ts`: classification and branch/source-ID summary, duplicate observation detection, foreign membership exclusion, incomplete/unknown evidence blocking. School status produces routing-review evidence and never silently moves a person to another branch. Source preview is not an OS mutation plan or an active-family count.

Implemented account/branch-specific dictionary resolution, authenticated `previewCustomers`, family import exclusions, lifecycle/attendance/source-status metadata, stable linked sales leads, and enrollment filtering. Entity existence/archive state remains separate from customer lifecycle. The family list displays lifecycle and attendance; merged branch assignments preserve each source status. Unknown statuses stop before observations/projection/archival. Preview signatures and autosync scope include the new policy version; old schedules pause and enabling requires a completed family import under this policy. Raw customer payloads remain verbatim.

Validation: the actual SQLite import test first reproduced three imported pupils instead of one; after the fix it passes, including repeat-import identity stability. Tests cover read-only branch dictionary preview, unknown status preserving all entities/raw, linked lead idempotency and preservation of local sales stage. Existing finance fixture was updated to explicitly include its synthetic status ID, retaining exact raw-payload equality. No database DDL added; existing authenticated route extended.

Live availability on 2026-09-15: the initial browser path returned 502 for OS and Atlas. Later protected gateway run 35013864337 confirmed HTTP 200 for OS and both diaries; the browser result did not establish a production outage. Read-only source audit runs 35014168259 and 35014398866 confirmed 175 active source clients and 807 included records in the five mapped branches, plus one unresolved status. These are not unique-family counts. Existing diary family-access handlers derive class from member scope; independent directory transfer remains required before any mass access action.

D191 adds explicit source branch/group routing, checked against actual groups and accessible destination branches, plus a database-aware comparison that preserves manual archives and isolates unknown statuses for review. D192 adds owner-only preservation of complete legacy rows into immutable historical evidence, without creating current pointers or business projections. The importer verifies every copy; interrupted migration remains blocked and is resumable. Neither feature has been applied in production.

Remaining release work (mandatory):

1. Persist dictionary evidence in import lineage as well as resolved per-card status metadata; current raw lineage is the original customer observation.
2. Complete lifecycle transitions of already-linked leads when source status changes (current re-import preserves the local sales stage).
3. Extend the implemented database-aware comparison to the final application plan including existing aliases and access bindings. Protect manual records, retain financial/history rows, and reconcile only complete authoritative scopes.
4. Apply the verified Atlas group routing: source 6 groups 1050–1053 belong to BR-ATLAS-SCHOOL; source IDs stay unchanged and nursery groups retain their destination. The owner-only routing editor is implemented, but production configuration is unchanged.
5. Complete tests for lead transitions and directory snapshots; run hosted release gates.
6. Publish via an appropriate protected release controller with backup/rollback. The old D182 one-shot cannot release this candidate.
7. Apply reviewed reconciliation and check both diaries, then repeat sync to verify no new duplicates. Enable scheduled sync only after successful verification.

The existing PR505 foundation remains unpublished. This checkpoint does not make that PR release-ready and must not be used to claim the approved migration has run.
