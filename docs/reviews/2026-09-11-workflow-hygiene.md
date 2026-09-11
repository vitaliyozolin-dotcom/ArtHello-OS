# Workflow hygiene review — 2026-09-11

Reviewed the 13 tracked files under `.github/workflows` from committed head
`6537d0ab331167d64e4e1d96cd5ee00d1749008c`, plus the dirty worktree (which did
not modify workflows). `quality.yml` and `proof-gates.yml` remain permanent.

| Workflow                               | Trigger / runner                                              | Disposition and evidence                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quality.yml`                          | PR + main push / hosted                                       | Keep: primary quality and provenance gate.                                                                                                                               |
| `proof-gates.yml`                      | PR + main push / hosted                                       | Keep: permission, migration and visual proof.                                                                                                                            |
| `deploy-ru.yml`                        | dispatch / hosted                                             | Keep: parameterized closed release builder; no production runner.                                                                                                        |
| `production-data-reset.yml`            | typed dispatch / production                                   | Keep guarded; confirmation precedes destructive work and uses `production-ru`.                                                                                           |
| `verify-arthello-v52.yml`              | PR + main push / hosted                                       | Keep while it is the active School validation contract.                                                                                                                  |
| `verify-arthello-r14.yml`              | PR + main push / hosted                                       | Keep while frozen R12–R17 history consumers remain required.                                                                                                             |
| `check-arthello-production-data.yml`   | successful Quality workflow-run / production                  | Keep: bounded read-only D075 consumer with exact prefix and main gates.                                                                                                  |
| `check-arthello-server-e2e.yml`        | dispatch/workflow-run / production                            | Keep pending documented production prerequisite acceptance.                                                                                                              |
| `check-arthello-server-browser.yml`    | PR hosted bundle; gated workflow-run production consumer      | Keep pending browser acceptance/cleanup. PR code does not run on the production job.                                                                                     |
| `check-arthello-employee-controls.yml` | PR hosted bundle; gated workflow-run production consumer      | Keep pending employee-control acceptance/cleanup.                                                                                                                        |
| `verify-content-tasks-visual.yml`      | dispatch/PR/main / hosted                                     | Keep pending visual evidence; it has no production runner.                                                                                                               |
| `deploy-diaries-d133.yml`              | PR hosted bundle; exact D138 workflow-run production consumer | Keep: D138 remains a candidate in `CURRENT_STATE.md`/`DECISIONS.md`.                                                                                                     |
| `import-finance-articles-20260911.yml` | path-filtered main push / hosted verify then production       | Archive candidate: its exact parent/title gate is spent and cannot accept a new main commit. Do not delete until terminal D124 run evidence is retrievable and archived. |

No `pull_request` job directly executes candidate code on a self-hosted runner.
Production jobs use `production-ru`, and `.github/` plus `deploy/` are covered by
CODEOWNERS. The only safe repo-only reduction found is the spent finance-import
workflow, but remote terminal evidence could not be retrieved because `gh` is
not installed in this environment; deletion is therefore deferred rather than
asserted safe. Active count remains 13, matching
`quality-gates/workflow-policy-ratchet.json`.
