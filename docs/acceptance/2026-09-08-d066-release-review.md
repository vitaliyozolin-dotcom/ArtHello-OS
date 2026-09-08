# D066 release review and actual School evidence

The owner authorized completing the six ArtHello corrections and publishing the working product without repeated code/deployment approval. This review records the next bounded correction after an actual failed deployment; it does not claim the product is already published.

Current main before this PR: `3cc30b6ad2790bfe15d43ab38adebb9cdf6a1f26`, a concurrent phase-one refactoring commit on diagnostic PR357 main. All 44 changed paths are preserved; none overlap the 17 R4 technical delta files. Its Quality34204053510, Proof34204053460 and Verify34204053516 passed; R4 still requires fresh exact checks. Decision D-069 records this release; D066 remains only its technical task label, avoiding collision with the refactoring D-066/D-067/D-068 decisions. The previous product candidate M3 `8a0bf989e0c271b009d8f14f0f3d21b3ab47966c` passed its exact main Quality, Proof and Verify, including 724 application tests. D065 run34198718003 attempt2/job101982122878 passed identity/source gates, failed School bootstrap, and skipped all image/clone/cutover steps. It is not retried.

Actual diagnostic run34203383943/job101987156275 at `2026-09-08T08:14:10Z` passed and returned the adjacent sanitized JSON record. The confirmed blocker is the UID/GID1000-owned regular shared lock mode0664. Home and ancestors pass. The R3 state root and relay container were absent, School image/source/StartedAt/network matched and health was healthy. The egress network observation remains unknown, not absent.

| Reviewed change | Required boundary |
| --- | --- |
| Owner lock normalization | Only existing exact UID/GID1000 regular single-link inode, mode0664→0644 under descriptor-based exclusive flock, fsync and same-inode verification. Already0644 is read-only. No create/replace/truncate/chown/root/sudo or foreign-file change. |
| R4 transport | Validates protected identity, safe home/state and exact raw bundle before normalization. Preserves normalization receipt, primary failure and separate cleanup failure. Does not restore0664 on error. |
| Relay | Existing R3 controller, image, scripts and config digest `7a358ba8a8c69d67d5dffcd3f2047967f43c33292b4c4767a9a20a1e02d36278` unchanged. |
| Queue | Four active historical consumers add only `queue: max` in the existing gateway/School groups. Their identity, replay, environment and execution bytes remain unchanged. Three contract files change only the corresponding expected queue maps. Historical manual/push workflows remain untouched. |
| Fresh D066 consumer | Exact planned PR358/branch/parent, first-attempt PR/main gates, immutable image and current-main checks; same production environment and both shared groups. Failed/ambiguous repair or started cutover cannot be auto-replayed. |
| Live acceptance | Fresh real browser Education→Diary navigation is required before ArtHello image loading/cutover; no session injection or manufactured acceptance. Recheck after new ArtHello activation. |
| Data and recovery | Existing clone, verified backup, encrypted-credential preservation, delayed bank activation and durable public-write boundary retained. No automatic old-database restoration after public writes. |

Local evidence: 17 R4 release-boundary tests, 9 lock tests and 8 bootstrap tests passed. One test explicitly skips the local root environment; hosted CI must execute the complete ordinary-UID bootstrap path and fails if it cannot. All ten deployment shell steps passed syntax checks. New Verify path filters include all 17 delta files on PR and push; actual Ruby and Docker gates remain mandatory in hosted CI. These local checks do not replace that CI or live business acceptance.

Independent review found and resolved two relevant errors: the read-only diagnostic opening non-regular lock types, and cleanup hiding the primary bootstrap failure. Final reviewed R4 bootstrap SHA256: `93a2a3dd8f9cae761d90ca19394824e20044ade4fb843b3677b59facd99861e1`; normalizer: `baab6b3b28d412798e6f05752db270302c3aa2ad9b7fec9ee9f3a6aa32fa23d7`. No remaining P1/P2 in the bounded normalizer/transport/scheduling review.

Root integration additionally checked the seven historical workflow/contract baseline strings against their immutable Git blob identities. Reversing only queue additions yields those exact current-main bytes, including final newlines. Frozen 17-file manifest SHA256: `402be522136816b3d5e6a0c7ba2fc7ab4bb0a5123950c99d2948a951f7d56f12`.

GitHub documents the queue feature in its [May 7, 2026 announcement](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/) and [concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency). Old run snapshots are not retroactively changed and must not be rerun alongside this release.

Remaining acceptance: actual normalization and durable relay receipt, real natural School SSO, successful guarded ArtHello cutover, then bank statement/account reconciliation, access behavior, saved feedback/backlog, verified manual/daily backups and selective AlfaCRM synchronization with valid current credentials. Unverified workflows remain unverified.
