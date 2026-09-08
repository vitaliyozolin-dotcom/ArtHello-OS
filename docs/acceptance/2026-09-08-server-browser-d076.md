# D076 server browser observations — 2026-09-08

This records actual runs. It is not a schema3 release acceptance receipt.

- The owner reports that Education → diary works in multiple browsers.
- Dedicated employee setup was reported complete. D074 job102209067350 at19:37:42.012Z observed both protected login/password inputs present; it did not log in.
- PR368 merged as `5f836029e4a8a68031ff512c942f76be3b7b13d0`, tree `951e1b045ff2a7e36b8225f8cf78cde4b518fb46`.
- Reviewed PR head `c3862388f4757addc8f9d929f886d33de51c0847`: completed Codex review at20:42:23.691702Z, no new findings. Earlier role/main-freshness/mandatory403 findings were fixed.

| Evidence | Run / job | Result |
| --- | --- | --- |
| Exact PR Quality | [34275798986](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34275798986) | success |
| Exact PR Proof | [34275799156](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34275799156) | success |
| Exact PR v52 Verify | [34275799053](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34275799053), job102228367399 | 760/760 application tests; pristine source/tree; real isolated Docker backup/restore fixture |
| Exact PR browser | [34275799068](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34275799068), job102228369271 | namespace sandbox; actual local HTTPS303 flow; Finance/Medical denial cases; owner rejection |
| Main Quality / Proof / Verify | 34276466443 / 34276466461 / 34276466450 | all success |
| First protected browser | [34276706523](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34276706523), job102231975465 | failure before login |

The protected job checked current main, checked out that exact source, and downloaded the same-run artifact. At20:49:44.086Z its archive/import prerequisite exited1. The old shell did not label the failed assertion. The possible causes before any Docker load output include archive verification or its8GiB free-space check; insufficient space is not yet a confirmed measurement. The credential-bearing step was skipped. Its downloaded archive was removed. No new application cutover, backup installation or live SSO PASS occurred.

PR369 prepares a smaller full-Chromium bundle and explicit capacity/import diagnostics. It uses measured compressed/expanded sizes, three expanded copies, two download copies and2GiB host headroom, checking the actual Docker store and workspace. The full original namespace sandbox and natural HTTPS fixture remain mandatory. No image, backup, volume or application cleanup is used to create space.

R8 release preparation is separate and unbound until the browser actually passes. Its proposed cutover step preserves the R7 clone/backup/activation/after-public-write protection exactly. Local tests for identity-bound receipt construction and replay rejection are preparation only, not production evidence.

The original task remains open: a hosted fixture is not real authenticated acceptance, bank reconciliation, completed production deployment, or installed daily/manual backups.
