# Test strategy

`pnpm run test:full` is the single blocking aggregate. It owns application
typecheck, front-office/security suites, both coverage ratchets, importer tests,
Sites, PostgreSQL, every `scripts/test/*.test.mjs` file and the four bounded
production-consumer Python contracts.

The legacy Node glob runs with `--test-concurrency=1` because browser/process
fixtures share ports and process identities. `migration-twin-report.test.mjs`
is the only conditional case: without `MIGRATION_TWIN_REPORT` it reports an
explicit skip; the PostgreSQL migration gate creates the report and executes
the assertion.

## Test classes

- Behavioral tests execute exported logic or a process boundary against
  synthetic inputs. New application rules and bug fixes belong here. Backup
  publication/rejection and owned browser startup are current examples and
  have coverage where Node can measure it.
- Structural policy tests inspect parsed YAML, JSON, TypeScript imports,
  manifests or filesystem topology. They are retained only for negative
  properties that runtime examples cannot prove, such as “no unapproved raw
  fetch exists”, migration ledger completeness or layer direction.
- Frozen recovery contracts reproduce historical release inputs. They are not
  ordinary product unit tests and must remain while an active verifier consumes
  that recovery generation. Archive them together with the last consumer and
  record blob/run provenance.

Exact prose and incidental formatting are not acceptable new assertions.
Workflow assertions parse YAML where practical; source-policy scanners expose
fixture-testable functions. A structural assertion may be removed only after a
behavioral or structured replacement proves the same failure modes.

## Current boundary

The full legacy catalog is adopted, so there are no unowned `.test.mjs` files.
The former standalone hosted production diagnostic is folded into the root
aggregate instead of duplicating Node and Python checks in another workflow.
Remaining source inspections protect architecture, migration, generated-code
and recovery invariants; they are intentionally not mislabeled as behavioral
coverage.
