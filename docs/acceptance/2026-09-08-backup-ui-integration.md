# Backup Settings integration candidate — 2026-09-08

This extends PR #350; it does not replace its SQLite Online Backup implementation,
retention, restore drill, host service or daily timer. No database schema changes.
No runtime or deployment secrets have been read. Nothing has been installed on
production by this candidate.

## Product behavior

Canonical owner sees Settings → «Резервные копии»: create button, current attempt
state, actual timer enabled state and next execution time, and 50 most recent
complete manifests. The API independently revalidates the live authenticated
session and canonical owner, password-change gate, same-origin mutation and
session CSRF. Owner HTTP headers alone grant no access.

POST accepts exactly `{ "action": "create" }`. HTTP 202 means accepted, never
successful completion. UI polls while running; failed attempts remain visible
beside earlier successful copies. Manifest history explicitly means verification
at creation, not a fresh re-verification of every stored snapshot on each read.
Malformed, partial and symlinked copies are omitted with a visible count.

The host bridge exposes two fixed Unix HTTP operations, GET /status and POST
/create. Its only mutation is `/usr/bin/systemctl start --no-block
arthello-v52-backup.service`. There are no user-controlled shell/units/paths,
restore commands, backup downloads, Docker socket or TCP listener. The bridge
uses root solely to read private manifest summaries and start that fixed service;
its dedicated persistent StateDirectory survives bridge restart and host reboot,
so the application bind mount continues to see replacement sockets;
systemd restricts its filesystem, capabilities and address families.

## Integration order (existing protected deployment process)

1. Include the PR #350 files and this candidate in the immutable reviewed release.
   Merge access-policy.ts and runtime-server.mjs additions with other concurrent
   changes rather than replacing their files. Dockerfile runtime stage must copy
   production/backup-transport.mjs (also ensure any reviewed alternate runtime
   artifact packaging includes it).
2. Install PR #350 with the explicitly identified **active** ArtHello D1 database
   host path. `install.sh` performs a real SQLite restore drill before enabling the
   daily timer. Never discover the DB by taking the first .sqlite file.
3. Run `bash deploy/v52/backup/install-bridge.sh` as root from the immutable release.
   It creates dedicated group `arthello-backup-control`, installs the root host
   bridge and prints the numeric group ID. It reads no credentials and does not
   modify any existing app container.
4. Add only these two options to the reviewed application container replacement:

   ```sh
   --mount type=bind,src=/var/lib/arthello-v52-backup-control,dst=/var/lib/arthello-v52-backup-control,readonly \
   --group-add <numeric-arthello-backup-control-gid>
   ```

   Keep app USER node, existing volume and protected secrets mounts unchanged.
   Do not expose the bridge as a public reverse-proxy route. Do not mount all of
   /run, /var/backups, the live host DB, systemd or Docker sockets into the app.
5. Run the Unix socket integration tests in the isolated builder with
   `ARTHELLO_BACKUP_REQUIRE_UNIX=1 node --test tests/backup-control.test.mjs`
   (this turns EPERM into failure instead of an explicit local skip); then verify in
   the restored production database application contour that anonymous, temporary
   password and every non-owner role are rejected, owner status loads, foreign
   origin/missing CSRF cannot trigger a command, and two concurrent manual requests
   create one accepted service job.
6. Verify the Settings button in a real owner browser: accepted → running → new
   manifest with restored-copy proof. Test one controlled backup failure on the
   restored contour and confirm UI failure plus existing history. Confirm the
   next daily job from the real timer and resulting manifest after it executes.

Rollback of this feature removes the app socket mount/group and disables only
`arthello-v52-backup-bridge.service`; preserve the PR #350 backup service/timer and
all existing backups. Reverting the app image does not require a DB rollback.

## Permission proof

Existing quality-gates/permission-matrix.json describes legacy Express API roles
(owner/accountant/viewer), not the v52 worker. It was inspected and is unchanged.
The separate backup matrix below and executable v52 access-policy tests verify
the actual route/roles without silently changing legacy policy expectations.

## Actual verification and remaining boundary

- Python host control/HTTP behavioral tests: 11 PASS (metadata filtering, concurrent
  admission, active timer exclusion, failed attempt, disabled timer, command error).
- v52 API/policy behavioral tests: 5 PASS (all roles, authenticated owner, password
  gate, CSRF/origin, exact action schema, bounded input, error and 409 propagation).
- Two real Node Unix socket transport tests explicitly SKIP in this environment:
  the environment denies AF_UNIX socket creation with EPERM. They remain required
  in the isolated builder/host acceptance; this is not a transport PASS.
- Existing Settings/access/design regressions: 21 PASS; total Node checks 26 PASS, 2 SKIP.
- Isolated assembled v52 production Vinext build PASS, including /api/settings/backups.
- Changed-file ESLint, `bash -n install-bridge.sh` and systemd unit verify PASS.
- Production installation, restored production application runtime, owner browser
  operation and next scheduled execution have not been performed by this agent.

Scope stays one ArtHello SQLite database. School, external documents, encrypted
credentials' decryption keys, off-server copies and live restore require their
separate existing recovery procedures. UI states this boundary explicitly.
