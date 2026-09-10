# D112 — Exact application and finance-proof delivery inventory

Owner: Виталий. Existing authorization: «Проверяй и выпускай в прод». Production acceptance remains pending.

## Actual failed D111 evidence

Protected run34488786763 attempt1, source c2b29672bb4d42a535ff44ea2b407622282aa0ac, tree cd30abc706f1d9eeff44a3207c968edde2ba0fde. Bundle102909795411 succeeded. Deploy102910480254 failed at 2026-09-10T14:28:21.6798457Z with fixed stage metadata / reason ARTIFACT_INVENTORY. History, provenance, accepted R16/School baseline, capacity and browser import succeeded. Application import/snapshot/cutover/auth/public were skipped; cleanup succeeded. Actual production remains accepted R16. The exact old R16 browser retirement completed; no application, worker, container, volume or database was deleted.

Fresh actual producer run34488251067 metadata is recorded in `.github/scripts/fixtures/r17-producer-artifacts.json`. It contains application artifact10156784922 (173128340 bytes, sha256:2a6810e390aacf03b2e145d79248e2c306bec904598afbef2ff60b7c240762ae) and finance-browser proof10156748683 (421338 bytes, sha256:ba615a46c2e1950abe7db122e5c43895da6d1c7457953e0a01369e0232ad95ac). The unchanged R15 downloader rejects this exact inventory because it requires one artifact. This reproduces the actual fixed failure; it is not a bank error.

## Reviewed correction

New versioned `download-v52-artifact-r17.py` requires exactly the two reviewed names for the same owner/main/push/attempt1 successful producer. It validates both artifacts' identity, repository, source, digest metadata, expiration and positive bounded size. Only the exact application artifact is downloaded. Its full size/SHA, exactly three ordinary ZIP members, path/type/CRC, extraction boundary, current-main recheck, redirect/token isolation, bounded retries/deadline and fixed errors remain byte-identical to frozen R15. The proof is not imported or extracted on production. Missing, duplicate, third or unknown artifacts are refused. Frozen R15 downloader remains byte-identical.

R17 controller is reconstructed from byte-identical archived R16 by 30 counted transformations with 142 pinned inputs. The sole additional delivery transformation selects the versioned R17 downloader. All application verify/import→cleanup gates remain exact under the pre-existing R17 adapter substitutions. D111 and D110 failed source/run identities are explicitly forbidden. No frozen release pins/history are changed. R16 browser retirement may report already absent; normal capacity gates still apply, and the unused browser from failed D111 is preserved.

## Verification and publication

Local PASS: 7 new artifact tests (actual red/green metadata, strict inventory, both producer identities, proof bounds, frozen tail, only-app integration), 13 frozen download tests, 14 R17 contract tests, 23 history tests, 6 historical isolation tests, full 142-input source contract. Application source bytes, all v44 source, banking/lease/backoff, roles and data are unchanged.

PR415 must be squash merged only from `codex/finance-r17-artifact-fix-20260910`, parent c2b29672bb4d42a535ff44ea2b407622282aa0ac, with prefix `D112: guarded finance R17`, after exact-head Quality/Proof/V52 and all six continuation jobs succeed. Review full SHA/tree/diff and preserved blobs; fresh-check no competing protected run. Verify actual signed single-parent/source/tree/main after merge, then freeze main until terminal protected release and cleanup. Old D111/D110 and accepted R16 are not rerun.

Only actual successful candidate/after-public/backup/School receipts establish accepted R17. Bind read-only D075 to those actual pins after success and verify bank/financial counts, links, duplicates and exact minor-unit sums. Hosted browser tests and fixture metadata alone do not establish production acceptance.
