# Alfa release preparation, 2026-09-21

Production is unchanged. This is release preparation, not a deployment receipt.

## Source integration

Integrated current main `2ef85c4609acb2fcdcd19b8f6e9af1a203a5ec40` with the Alfa sender candidate `5f7c3818431a218c19c610ae060af6dfac907b64`. The only merge conflict was CURRENT_STATE.md; both histories were retained. Main's coverage/phone refactors and archived historical workflows are preserved. No bank implementation or settings were changed.

The old candidate's Quality 35438277153, Proof 35438277154 and Verify 35438277165 succeeded. They do not prove the newly integrated tree.

## Hosted diary verification

Extended the existing v52 verifier, without a new workflow or changing the reviewed maximum of 11 workflows. Two GitHub-hosted matrix jobs pin both diary commits and trees, execute their receiver regressions, build images, and exercise the actual HTTP receiver inside network-isolated disposable containers. Synthetic credentials and pupil data only; production secrets, volumes and SSH are unavailable. The School bootstrap entrypoint is deliberately bypassed for the fresh isolated database.

The smoke test checks unsigned and foreign-school rejection, preview without class creation, signed application, repeated application, stale-version rejection and archival. SQLite inspection checks a single archived synthetic pupil, one source link and database integrity. Each image is packaged with source/tree/controller IDs, portable runtime fingerprint and checksums. Additional artifacts mean the historical D182 downloader's exact two-artifact inventory is deliberately not reusable.

Locally: smoke-denial tests 2/2; workflow-policy tests 10/10; the full smoke sequence against each actual receiver module and a real in-memory SQLite database passed. Docker is unavailable locally; full image/HTTP checks must run on hosted CI before any release.

## Workflow hygiene

| Scope                      | Runner / trigger                 | Action                                 | Evidence                                                                  |
| -------------------------- | -------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Existing v52 verification  | GitHub hosted / PR and main push | Extend with isolated diary builds only | No production environment, secrets or self-hosted runner in the added job |
| D182 and D186 controllers  | Archived                         | Keep archived                          | Main moved them to docs/workflow-history                                  |
| Other ten active workflows | Unchanged                        | Preserve                               | Active count remains 11, policy reports zero violations                   |

The analyzer flags the new job's `docker rm` as a potential destructive push operation. Its target is a uniquely named disposable container on the hosted runner, never a production host or volume. No production-capable job was introduced.

## Still required

- Successful checks on this exact integrated source, including both image smoke jobs.
- A new reviewed owner-dispatched production controller: exact-main provenance, current runtime inventory, WAL-complete backups, reversible cutovers and retained receipts. Do not reactivate old one-shot controllers or widen the workflow-count ratchet silently.
- Fresh Alfa status/branch reconciliation; previous counts and unknown status are September 15 observations.
- Reviewed application, both diary mappings and real roster/idempotency verification. Scheduled diary refresh and teacher account/permission migration remain separate incomplete work.
