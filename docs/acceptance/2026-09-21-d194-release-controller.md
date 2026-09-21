# D194 release controller — candidate, not deployed

Application D187–D193 merged in PR506 as `372c3b88400c06c4be6ed31f347e656dbc4370b0`. Exact-main Quality35641563172, Proof35641563136 and Verify35641563137 passed, including immutable image/HTTP smoke for both diaries.

Fresh read-only inventory35641981048 completed checkout, 19 Node prerequisite tests, 22 route tests and runtime inventory. Active central container is `8fab3235b3c53ef7f2b876ad9d07e606a95879f9067b0b469f018f6283dc2c21`, source `95873e519113e93d9d52ac08166eb46b317e5c6e`. Atlas is running; central/school HTTP probes returned200. Final browser step failed on `dedicated_account_unconfirmed`, `browser_image_unpinned`, `browser_source_unpinned`. No login or production mutation occurred. Atlas secret readiness in the old diagnostic checks mode600, whereas D186 uses a read-only444 mount; the false flag alone is not evidence that the configured mounted secret is missing.

## Workflow audit before extension

| Workflow | Trigger / runner | Change / boundary |
| --- | --- | --- |
| deploy-ru.yml | Owner dispatch; original hosted package jobs | Keep package default; add explicit protected central/Atlas installation under existing gateway lock |
| verify-arthello-v52.yml | Hosted PR/main | Add controller and WAL snapshot tests; no production access |
| Other nine active workflows | Existing policies | No changes |
| Archived D182/D186 | No active trigger | Keep archived; no replay |

Count11 and ratchet11 remain unchanged. No administrative bypass, new secrets or banking configuration changes. `.github/` and `deploy/` remain CODEOWNERS protected. Owner's previous authorization covers publishing and merging; dispatch still requires the owner's UI action because the connected GitHub tool has no workflow-dispatch capability.

## Verification and limits

Local controller tests cover unchanged bank environment/mounts, unsupported runtime rejection, backup failure before cutover, post-public failure with current data retained, and temporary env deletion. Artifact tests cover exact four-artifact inventory, expiry/source mismatch, producer identity and ZIP traversal. Real SQLite test preserves committed WAL rows in a standalone backup and blocks an enabled Alfa schedule. These tests are included in both hosted diary jobs.

Runtime installation does not apply Alfa records, grant access, or populate a diary. School delivery via its separate SSH host is not implemented by D194; do not infer completion from a central or Atlas receipt. Periodic diary refresh, teacher login migration and real grade/homework/KTP acceptance remain outstanding. New controller requires its own exact-head CI before merge and exact-main CI before dispatch.
