# ArtHello — production read-only observation, D-075

## Scope and evidence

Owner explicitly approved a separate read-only inspection through existing service access, without production mutations, extracting passwords or exporting personal records. This is not an application release or full user acceptance. Passport D-075 and decision index were merged in PR365.

Initial actual job: https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34266481429/job/102197005517

- Diagnostic source: `c62e98a87567d4f70d79f81e9f17b635c3bdc9d7`.
- Reviewed/merged tree: `305ea754901ad6d364ed19e1499bf776e5f6df05`.
- Observed at: `2026-09-08T19:01:44.132Z`.
- Live application source: `6596f69390ad539577ec2640e8ef40c7e12c22dc`.
- Live image: `sha256:94aa3feef7ccb431c6e4fc7ae879399c4c9d93721cc9fb13775d999b4b73f711`.
- Exact canonical live D1 open-file identity and ordinary UID1000 were checked before reading. The helper used this already-running image, read-only source/rootfs, no network/secrets/Docker socket, dropped capabilities and bounded resources. Application remained running with the same image after inspection.
- No database copy, rows, contact information, descriptions, secrets or amounts were exported. No import/sync/payment/backup/restore/cutover was performed.

## Observed facts, not inferred acceptance

| Area | Actual observation | What is not proved |
| --- | --- | --- |
| Diary | Owner previously reported successful Education-to-diary login in several browsers | No fabricated identity-bound machine browser receipt; this diagnostic did not log in |
| Bank / register | 4 accounts;8 statement-import records;0 bank transactions;0 financial operations | Statement records are not evidence that payments were downloaded; no live upstream request or financial reconciliation |
| Access | 5 application users;10 system grants;1 branch grant;system-grant user references have0 orphans | UI visibility, API enforcement and all grant endpoints were not covered by the initial probe |
| Developer feedback | `developer_feedback` and `developer_feedback_events` tables absent | New durable feedback feature is not installed in this database; no UI submission attempted |
| Integration / AlfaCRM | 19 integration connection records;6 sync-run records;run-to-connection references have0 orphans;`alfacrm_finance_snapshots` and `alfacrm_family_merge_candidates` absent | Connection/run counts are across integrations, not Alfa-only; no claim of configured credentials, successful staged import or verified customer balances |
| Backups | R7 backup-control mount absent on the live app | Other historical backups, schedule, history, restore and off-host copies not verified |

Zero bank-link violations with zero transactions is vacuous, not a bank success. Missing newer tables is consistent with the observed older production source; candidate tests are not installation evidence.

## Diagnostic review and limits

PR365 initial process exit did not fail on partial/unavailable results. Late reviewer findings3961260715 and3961260719 were accepted: the initial green GitHub job MUST NOT be interpreted as complete validation. PR366 adds nonzero exit for missing/partial/error/violated checks and checks both endpoints of system/branch grants. TDD missing-export red then7/7 green. New results must retain these facts rather than rewrite initial history.

PR365 reviewed head `be93cba909ace6cda94099732da5045154a1d91f`: Quality34265851232, Proof34265851225 and Verify34265851229 succeeded. Main Quality34266249178 and Proof34266249120 succeeded before the initial observation. These gates concern their exact sources, not the older deployed app. Local combined diagnostic/prerequisite/readiness suites24/24 passed before the two review fixes; that count is not a live acceptance count.

## Decision at this checkpoint

The requested fully updated production system is not accepted. Bank transaction/register population, installed feedback, newer AlfaCRM projections, backup runtime and full employee-role checks remain open. Owner-confirmed diary login remains closed as a reported working path. Do not reopen it as broken without new evidence.

Next: complete strict diagnostic validation and preserve evidence; then prepare the appropriate exact-source release under existing backup/SSO/public-write guards. Do not rearm old pinned consumers, infer a fresh SSO receipt from undated owner messages or restore a stale database over current writes. Content image design and task numbering were outside this read-only database probe and are not marked checked.

## Release blockers freshly observed

- Existing R7 run34266620111/job102197996998 rejected its immutable release identity at the first gate. Checkout, School verification, browser acceptance, image load, secret resolution and clone/cutover were all skipped. No application deployment resulted from PR365.
- Browser prerequisite run34266481489/job102197231725 at19:01:59.659Z observed HTTP200 from both fixed origins, but reported missing test login, missing/invalid test password, unconfirmed dedicated account, unpinned browser image and unpinned browser source. It did not log in or inspect a browser image. These missing prerequisites are not evidence that the owner's working diary login is broken.
- PR366 reviewed head652060da1bcf71c9d1d676f492cb39fb348fd78b passed Quality34266524229 and Proof34266524234. Codex review completed19:04:22.145941Z with no findings. Merged as904deb2963675281897446f7f5903466dc08a9fd. It changes only diagnostic logic/tests, not product code or deployment guards.

## Strict follow-up: stopped before database access

Main904deb2963675281897446f7f5903466dc08a9fd passed Quality34266833102. The protected follow-up https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34267058423/job/102198949990 passed current-main verification, exact checkout and diagnostic tests, then exited2 at19:07:06.7556347Z with `READONLY_BLOCKED=live_file_identity`.

This guard runs before creating the read-only helper or opening SQLite. No follow-up database aggregates were obtained, and the expanded grant-endpoint checks were NOT executed against production. The guard can reject scanner/UID/timeout/open-handle mismatches; this fixed error alone does not distinguish the cause and is not evidence of corruption or a changed application. The earlier19:01:44.132Z observation remains the last successful data read, not a fresh19:07 result.

Stop condition respected: no relaxation of identity checks, root escalation, alternate database selection, copied snapshot or production mutation. Final acceptance remains blocked. Next authorized diagnostic requirement is to distinguish the fixed scanner failure categories while preserving the canonical live-file guard; full rollout additionally retains the separate release prerequisites above.

## Classified follow-up after renewed owner authorization

Owner again said «Разрешаю». PR367 implements the authorized next diagnostic step, preserving the D075 contract. A single Node process reads only proc UID/descriptor metadata, replacing shell forks per descriptor. Fixed counters/reasons distinguish missing/foreign handles, inaccessible descriptors, inventory limits and external timeout. Canonical file and ordinary UID requirements remain mandatory; this is not permission to select an alternate database.

- Reviewed head:89761279a9485333fbbf21bd25cec33c35e0c83a; merged main:1d70d200cc02e12723df6269c98d418c3c59b5c0; identical tree6507aa0f44136675ab1ff5420e4eb6f3cc2bcc69.
- Local TDD: missing-module red;13/13 green (6 scanner,7 database). Main aggregate includes the scanner suite. PR Quality34267801894 and Proof34267801954 passed; review completed19:18:25.769676Z with no findings. Main Quality34268240687 passed.
- Actual https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34268455364/job/102203699910 at19:21:25.3114325Z: `expected_handle_absent`; expectedHandles0;unexpectedHandles0;processCount3;descriptorCount68;disappearedProcesses0;disappearedHandles1. Ordinary scanner/application UID checks passed, readable process inventory completed. One descriptor disappeared while scanning; it was not treated as a valid expected handle.
- The observed absence of the expected open file is now distinguished from permission/foreign-handle/timeout errors. No foreign D1 handle was observed in the checked namespace. This does not retrospectively establish why the19:07 scan failed or prove that the database is corrupt. Application idle/connection lifecycle is a possible explanation, not a verified root cause. No new SQLite read or database aggregate followed the refusal.
- Current live source is NOT newly claimed from this failed scan: metadata printing and DB helper follow the identity gate. The last successful data observation remains19:01:44.132Z with source6596f69390ad539577ec2640e8ef40c7e12c22dc.

The live6596 health route calls ensureCoreTables; ensureCoreTablesOnce includes initializeCoreTables, migration/normalization and stored-credential validation. A health request therefore cannot be guaranteed to be a purely read-only wake-up in this scope, and was not invoked to manufacture open handles. No production mutation, root escalation, session injection or gate relaxation occurred.

Browser prerequisites were refreshed in run34268455354/job102203790228 at19:21:41.203Z: both origins HTTP200; test login missing, test password missing/invalid, dedicated account unconfirmed, browser image/source unpinned. No actual browser login. The connector cannot administer Environment secrets. The owner must supply a dedicated active test account through the protected Environment for authenticated verification; password extraction or identity injection is not an alternative. A pinned isolated browser bundle still needs preparation and is not claimed ready.

Final status: diagnostic code/review complete; exact missing-handle condition observed; full functional acceptance and deployment remain blocked. Owner's earlier diary success is preserved. Next required user input is the dedicated test account with Education/School access and protected inputs described in docs/acceptance/server-browser-prerequisites.md, followed by remaining browser preparation and release gates. No renewed generic deployment permission is requested.
