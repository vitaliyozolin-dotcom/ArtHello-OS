# D193 directory transfer — candidate evidence

Production data has not been changed by this candidate. The live Alfa audit counts dated September 15 are historical observations, not a September 19 roster.

## Candidate components

- OS sender and owner UI: PR506. Requires completed family/group imports under the current branch and status contracts, paused autosync, explicit class mapping, signed remote preview and a fresh matching application token. A wrong acknowledgment cannot mark success. The preview includes the number of managed pupils planned for archival.
- Atlas receiver: PR511, source `fdd8316ce50962476dbfee446181ca6c9d71fcc8`, tree `f590f1f7d7cc838025762acc5e6eb0fb3afe0f84`.
- School 1–11 receiver: PR512, source `a3443da4b1e74112c44bcae8dc58aea9fd5b50f6`, tree `994b0eeafbf5c8b5bf358ef82c275a1b58c42896`.

The receiver PRs compare against their own pinned diary source, not the unrelated central OS tree. They add two SQLite tables and preserve existing data. Institution signatures, source IDs and explicit classroom bindings prevent cross-school projection and implicit adoption. Teacher profiles are not teacher accounts or permissions.

## Executed verification

- OS: 111 tests passed across diary-directory, customer-policy, correctness, lifecycle, legacy-rollout and repeat-assembly suites.
- Both sender destinations were also retested after adding wrong-receipt rejection and explicit archival-count validation: 2/2 pass.
- Each diary: 7/7 directory/family regression tests using real SQLite. Tests include repeated application, conflicting family/class data, preservation of manual pupils and passwords, institution/signature rejection, rollback after partial statement execution and stale concurrent-plan refusal.
- OS and both diary TypeScript checks passed; changed-file ESLint passed. Diary checks used the already installed matching dependency bundle, without changing their dependency manifests.
- Earlier OS candidate `6a619187ac40557e637315d3ed243ba0d09a7fa9` passed hosted Quality gates 35016902484, Proof gates 35016902511 and Verify v52 35016902270. These runs do not validate later sender changes. The unrelated frozen Tochka continuation remains failing; its implementation was not changed.

## Remaining before completion

1. Hosted validation of the final sender and receiver versions and visual verification of the class-mapping screen.
2. Fresh source reconciliation, unknown-status resolution and confirmed real classroom bindings in both diaries.
3. Protected deployment of all three components with database backups and rollback proof. Existing spent deployment workflows must not be replayed for new sources.
4. Apply reviewed Alfa reconciliation and each diary snapshot, then verify the real roster, family links, statuses and repeat-import idempotency.
5. Connect periodic diary refresh to the verified Alfa schedule; current directory transfer is an explicit owner-controlled operation.

No production completion, automatic directory refresh, unique-family count or live teacher-rights verification is claimed.
