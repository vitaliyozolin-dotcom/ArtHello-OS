# D063 runtime/backup review — 2026-09-08

Independent read-only review. No shared code changed. Provenance/replay/rollback review is assigned to release_consumer_review; this note covers runtime integration only.

## Findings sent to author

1. **P1: Tochka imports can start before verified cutover.** New consumer starts the live candidate with TOCHKA_AUTOSYNC_ENABLED=1, then runs local health, canonical D1/inventory, route activation and public health checks. The assembled runtime starts its first timer 30 seconds after runtime.ready. A slow or failing gate can therefore allow imports before cutover verification. D-062 requires activation after verified cutover. Fix requires a tested activation boundary; an arbitrary longer timer delay does not establish it. Author and Tochka agent notified.
2. **P2: backup bridge readiness race.** install-bridge.sh uses a Type=simple service, starts/restarts it and returns; the consumer immediately tests the socket. Active systemd state does not prove Python has bound the socket yet. Bounded functional Unix /status readiness before live stop will prevent false aborts and verify transport readiness. No failure on the actual host is claimed.
3. **P2 conditional execution defect in supported non-root mode.** The consumer tests the host Docker-volume mountpoint before choosing sudo -n fallback. On a docker-group runner unable to traverse the root-owned /var/lib/docker tree, the check fails even when subsequent root installation is authorized and available. Choose root_command first and perform exact host-path checks through it. Current gateway permissions have not been independently observed here.

## Important acceptance boundary

ALFACRM_IMPORT_ENABLED is not written into runtime_env. The assembled runtime defaults it to the empty string; actual import/dry-run actions that require the gate respond409 while disabled. This correctly preserves the existing fail-closed policy, but the consumer cannot be cited as real AlfaCRM synchronization acceptance. Live tenant coverage/integrity and rotated-key evidence remain necessary according to the implementation.

## Checked runtime properties

- Clone explicitly has Tochka autosync disabled, network none, no backup socket bind mount, and a separate copied volume.
- New production container gets only the persistent backup-control directory readonly plus the numeric supplemental group; no Docker socket, backup files or arbitrary host path is exposed through the Node backup transport.
- Backup source comes from the exact named live DATA_VOLUME plus the canonical D1 relative path already checked via live file descriptors. It does not choose a discovered first database.
- Backup install executes online SQLite backup plus restore verification before enabling the daily timer, then installs the bridge before stopping old live application.
- Node transport only permits fixed /status GET and /create POST, bounds response bytes, uses a fixed Unix socket and refuses unexpected upstream statuses. It does not run a shell.
- The earlier P1 RuntimeDirectory lifecycle and P2 malformed manifest failures have been fixed in the integration candidate.
- Production cannot yet be declared accepted merely from bridge service active or queued202; actual owner API and completed verified manifest checks are still required.

Runtime literal TOCHKA-only serviceBindings source guard conflict was independently found by release_consumer_review; author acknowledged a fix. This review does not duplicate that finding.

## Closure verdict on frozen consumer

Frozen consumer manifest SHA-256: 9383b4591b9021c8f510da635bd3c0ad0ea6b3ab2409a4118fe15e608d26d779; all8 payload hashes rechecked. This closure requires the separate frozen tochka-activation-finish-20260908/manifest.json product overlay.

- P1 closed: timer now checks the fixed root-owned regular0640 marker through O_NOFOLLOW|O_NONBLOCK, bounded161-byte descriptor read, exact release SHA and unique activation nonce. Absent/stale/invalid marker yields zero dispatch. Workflow publishes marker only after local/public/School HMAC/current-main gates.
- P2 root-path fallback closed: actual extracted shellblock passes a non-root/sudo fixture where direct host-path traversal is unavailable.
- P2 bridge readiness race closed: bounded actual-shell fixture succeeds on the third delayed socket attempt, and never-ready fixture fails after exactly30 attempts.
- Independent rerun: 26/26 Tochka activation/service tests PASS, 12/12 consumer gates PASS, three focused runtime shell fixtures PASS. Full product suite not repeated. Harness: permissions-finish-20260908/test-consumer-runtime-closure.py. Ruby contract was not executed locally; hosted CI remains required.
- Alfa remains default-off and returns409 for gated import actions; release documentation does not claim tenant synchronization. This is an explicit remaining product acceptance limitation.

Verdict: no remaining P1/P2 from these three bounded runtime findings in the jointly integrated frozen consumer+marker delta. This is code-review/test closure, not real production acceptance, backup API acceptance or bank/Alfa live sync evidence.
