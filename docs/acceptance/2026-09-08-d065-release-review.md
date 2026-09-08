# D065 R3 reduced-privilege release review — 2026-09-08

M2 parent is `8d4fc1cb589db8550cc4e7857e1a7537ac771ae5`. Its exact main Quality, Proof and Verify passed; R2 deployment failed before any School controller mutation because the existing SSH user cannot invoke general sudo. The failed R2 attempt and its replay restrictions are preserved.

## Security and implementation review

R3 requires fewer host privileges. It uses the existing Docker deployment API and creates only the same UID1001 read-only relay/network. It does not use Docker to obtain host root, mount a host root filesystem, change sudoers, chown foreign files or alter School settings/data/secrets.

The state location is fixed below the real caller's passwd home. The controller verifies ordinary uid/euid/gid, canonical safe ancestors and exact owner/modes. Receipt, runtime configuration and scripts use bounded O_NOFOLLOW/O_NONBLOCK reads with fstat, regular-file/single-link/owner/mode checks; persistent state is not adopted from a different owner. Publication remains no-replace and fsync-backed. The container sees only a readonly bind of the public relay code and runtime configuration.

The existing shared School lock is retained via readonly O_NOFOLLOW/O_NONBLOCK open and exclusive Linux flock. No private lock substitutes for it; missing, unsafe or unreadable shared state blocks before network mutation. Its use is evidenced by successful prior production run `33762398372`, job `100671690779`, which used that exact lock and reported remote School synchronization verification on 2026-09-03T13:40:58.486Z.

Root independently reviewed the controller delta and required closing persistent-file ownership/read bounds and FIFO-safe lock opening. Both changes are present. The bounded design assessment by a separate reviewer agrees this uses existing authorized capabilities without obtaining the refused root access.

The new consumer retains exact source and image gates, shared workflow concurrency, current-main checks, conservative replay, isolated clone and backup, durable public-write boundary and delayed Tochka activation. R3 evidence must link actual live ArtHello/School identities, intended candidate, verified repair configuration, caller UID and private-state path digest, with a real natural Education-to-Diary browser navigation after repair activation. Receipts describe deployment-user ownership, not root ownership.

## Verification boundary

Final repair configuration digest: `7a358ba8a8c69d67d5dffcd3f2047967f43c33292b4c4767a9a20a1e02d36278`.

The relay controller author reports 24 Python and 10 Node tests passed, including owner/mode/symlink/hardlink/oversize rejection, unsafe home identity, shared readonly lock exclusion and FIFO refusal. These are prepublication results. Actual hosted bootstrap/contract/Docker verification, production repair, natural SSO, ArtHello deployment and business-workflow acceptance remain required. No successful live acceptance file is created by this change.

Integrator correction: the Verify trigger now includes all new R3 controller/consumer paths for both pull requests and main pushes. This prevents an R3-only fix from missing its required Verify run. YAML and trigger coverage were checked; all execution steps remain the frozen consumer candidate.

Consumer author verification: 21 framework tests passed locally and one actual non-root bootstrap test was skipped only because this scratch environment has no ordinary UID mapping. That test fails instead of skipping on a root hosted runner and must execute under the actual hosted ordinary UID. Ruby and Docker gates remain mandatory.
