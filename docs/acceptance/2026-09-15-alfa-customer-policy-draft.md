# Customer status policy — implementation checkpoint

Status: incomplete, not connected to production preview/import. No application data changed.

Owner-approved rules: active statuses remain active; Open stays open; single visits are an attendance format with unverified activity; Registration is a lead; Trial and Completed are excluded. Missing status requires review. These rules must apply per source branch assignment, not globally to a family. No weak-contact merges. Preserve existing IDs, source evidence, contracts, financial history and access.

Implemented pure functions in `deploy/v52/src/lib/alfacrm-customer-policy.ts`: classification and branch/source-ID summary, duplicate observation detection, foreign membership exclusion, incomplete/unknown evidence blocking. School status produces routing-review evidence and never silently moves a person to another branch. Source preview is not an OS mutation plan or an active-family count.

Validation: four behavioral tests failed before implementation (module missing), then passed. No database schema or existing routes changed.

Remaining release work (mandatory):

1. Read and validate the account-specific study-status dictionary; numeric IDs must not be guessed. Preserve source ID/name/batch provenance.
2. Connect the policy to the same family preview and import path; distinguish lead creation from student enrollment. Keep entity archive state separate from relationship activity.
3. Build a database-aware comparison including existing aliases, local archives and access bindings. Protect manual records, retain financial/history rows, and reconcile only complete authoritative scopes.
4. Confirm Atlas educational routing by groups; the school label alone cannot rewrite source membership.
5. Add actual route/SQLite tests for repeated import, exclusions, archives, lead transitions and rejected snapshots. Update source manifest and run hosted release gates.
6. Publish via an appropriate protected release controller with backup/rollback. The old D182 one-shot cannot release this candidate.
7. Apply reviewed reconciliation and check both diaries, then repeat sync to verify no new duplicates. Enable scheduled sync only after successful verification.

The existing PR505 foundation remains unpublished. This checkpoint does not make that PR release-ready and must not be used to claim the approved migration has run.
