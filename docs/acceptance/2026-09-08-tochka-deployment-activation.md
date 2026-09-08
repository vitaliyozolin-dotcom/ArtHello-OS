# Tochka scheduler activation after deployment acceptance

The candidate container may start with `TOCHKA_AUTOSYNC_ENABLED=1`, but the host
timer cannot dispatch its integration request until the consumer publishes a
matching activation marker after public cutover verification. A missing, stale,
malformed or unsafe marker is a closed gate, without bank or database activity
from the timer.

## Exact consumer contract

- Container environment: `RELEASE_SHA` is exactly 40 lowercase hex characters;
  `TOCHKA_AUTOSYNC_ACTIVATION_ID` is a fresh 32-character lowercase hex value
  generated for every candidate container launch, including the same release SHA.
- The host generates the activation ID with `secrets.token_hex(16)` or an
  equivalent cryptographic generator. It is deployment identity, not a banking
  credential. Reuse the same ID only when restarting the existing container.
- The container mounts `/var/lib/arthello-v52-backup-control` readonly and joins
  its dedicated numeric `arthello-backup-control` group.
- Fixed marker path:
  `/var/lib/arthello-v52-backup-control/tochka-autosync.activation`.
- Exact UTF-8/ASCII content, including the final LF:

  ```text
  ARTHELLO_TOCHKA_AUTOSYNC_V1 <RELEASE_SHA> <TOCHKA_AUTOSYNC_ACTIVATION_ID>
  ```

- The marker must be a regular non-symlink file owned by root, with exact mode
  `0640` and group `arthello-backup-control`. The parent directory is the existing
  persistent root-owned `0750` backup-control directory. Maximum accepted file
  size is 160 bytes; the exact identity line is required.
- Publish only after verified public cutover, application identity/HMAC checks
  and the consumer's current-main gate. Write a temporary file in the same
  directory, set ownership/mode, fsync the file, atomically rename to the fixed
  path, then fsync the directory.
- Clone/preflight keep `TOCHKA_AUTOSYNC_ENABLED=0` or absent, with no control
  mount, activation ID or marker.

The timer reopens and validates the marker before every tick. A stale marker
from the previous container cannot activate a fresh launch of the same SHA
because its activation ID differs. Ordinary process/container restart preserves
the existing deployment identity and resumes against the existing marker.

## Rollback boundary

Removing/replacing the marker prevents subsequent ticks. It does not cancel a
bank import that already passed the gate. The consumer must stop the candidate
before rollback and preserve the latest database after accepting public traffic
or publishing activation. Restoring a pre-release snapshot after that boundary
could erase user or integration writes and is prohibited by this contract.

## Local evidence

26/26 targeted tests passed; targeted ESLint passed.

The targeted suite covers actual regular marker files, missing/malformed/oversize
contents, wrong release and same-release stale IDs, actual symlink/directory/mode
rejection, atomic replacement, removal, zero pre-activation dispatches, disabled
clones, and stop during a pending gate. The non-root UID branch uses an explicit
descriptor fixture because local user-namespace chown to UID65534 is unavailable.
The existing automatic scheduling/lease/credential/route tests remain included.

No production activation, bank synchronization, host mount or live rollback was
performed by the integration agent. The frozen base product manifest is unchanged;
this additive overlay requires the next reviewed CI revision.
