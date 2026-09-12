# Docker network preflight correction

Candidate only. No repository branch, workflow, production container, bank data, or remote configuration was changed.

## Defect and change

Docker's template already prints a newline for each network with `println`. Docker also adds a trailing newline when rendering the template. The original direct process-substitution `mapfile` therefore reads a valid single network as two array entries and rejects it. That form also does not propagate the `docker inspect` process-substitution status reliably.

Capture `docker inspect` into `network_names_output` first and feed that quoted value to `mapfile`. Bash strips trailing newlines in command substitution, while the direct assignment retains the inspect command's exit status under the existing `set -Eeuo pipefail`. The existing exact-one-entry and nonempty-name checks remain unchanged. Names are parsed by lines, with no whitespace trimming or word splitting. Existing network-ID, topology, fencing, backup and reconciliation checks are unchanged.

## Files

- `candidate/.github/scripts/d069-tochka-import-rollout.sh`: minimal parsing fix and comment.
- `candidate/.github/scripts/test-d069-tochka-network-preflight.py`: executes the actual production preflight block with a deterministic Docker shell adapter, without invoking Docker.
- `network-preflight.patch`: unified patch applicable from the source repository root.

## Validation

`python candidate/.github/scripts/test-d069-tochka-network-preflight.py -v`

9 tests pass: real Docker trailing-newline output; normal single-network output; zero, two and three networks; interior blank line; whitespace preservation; failure status and stderr propagation with partial output and without output.

Running those same tests against `baseline/` produces four failures, including reproduction of the valid-network rejection and swallowed inspect errors. This confirms that the tests distinguish the buggy production implementation from the corrected one.

- `bash -n` passes.
- Existing rollout `--self-test` passes with `D069_TOCHKA_ROLLOUT_SELF_TESTS=VERIFIED` using a temporary local test environment.
- `git apply --check` passes against the baseline tree.

Evidence: `test-results.txt`, `baseline-test-results.txt`, `existing-self-test-results.txt`.

## Pinned rollout impact

The byte-verified main script blob changes from `8bfd66da4e34642edc8c2b5ddb9eeec9b155008f` to `c7e8526c032c3134ad0ce5aafe7f695be05ce8b3`. The initial local fetch had an extra trailing newline (blob `05c1707d9ee314e1844699677af4267e9265e173`); the baseline and diff have been corrected to the exact GitHub blob, with no unrelated end-of-file change.

The current `.github/workflows/d069-tochka-statements-production.yml` pins `EXPECTED_ROLLOUT_BLOB: 8bfd66da4e34642edc8c2b5ddb9eeec9b155008f` and `TOCHKA_END_DATE: '2026-09-05'`. It triggers only when that workflow file changes on main. This patch changes the script and its regression test, so it does not trigger that import workflow. Its former runtime pin is intentionally left stale against the new source, and the exact-source/date/provenance checks continue to reject unauthorized combinations. A run checking out the old pinned source still has the original implementation.

This patch does not update pins, authorize a new run, alter dates/provenance/approval checks, or trigger/rearm the import workflow. A separately reviewed release revision is needed before the corrected runtime can be used in an authorized import.
