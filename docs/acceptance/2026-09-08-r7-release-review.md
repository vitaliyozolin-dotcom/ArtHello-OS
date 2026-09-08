# R7 publication candidate review — 2026-09-08

## Actual starting point

Base main is eb47c1360fbd701876a3c49efe029194707304db, tree7e7b14ecbfbfb29e1268edaae7e620e4a62eda1c (PR361). Its exact PR/main Quality, Proof and Verify passed; hosted application verification executed756 tests. Actual R6 run34221458013/job102045375780 reverified the already-installed School R5 read-only at11:35:42Z, then measured gatewayUID995 without the root/passwordless-sudo capability required by the host backup installer. Image import, clone and ArtHello cutover were skipped. Fresh live source remained6596f69390ad539577ec2640e8ef40c7e12c22dc.

## Change and authority boundary

Architectural D-073 / technical D069 replaces only the failed host installation path. The same exact hosted image contains the existing unchanged SQLite backup/restore implementation and a fixed-operation ordinary-UID worker. Existing D1 is mounted read-only/nocopy; new backup/control volumes are initialized using image build ownership. The app receives only the control socket volume read-only.

The activation writer has a separate ordinary UID1002 and dedicated volume. The appUID1000 reads that volume; the backup worker cannot mount it. V2 checks fixed SHA40/nonce64, owner/group/mode/link count, bounded exact bytes and no-follow/nonblocking reads at every tick. The writer runs only after the existing public gates. There is no host-root fallback, sudoers, systemd installation, privileged helper, host-root mount, runtime chown or Docker socket in the new services.

Original scoped Docker clone/restore helpers and Caddy operations retain their existing authority; this is not a claim that every original container process runs without UID0. Durable public-write state and the prohibition on restoring old snapshots over possible new public writes remain. Backup resource ownership state must survive both successful publication and ambiguous public failure independently of transient data snapshots.

Installed School R5, its original identity and actual receipt remain unchanged. R7 uses the existing R6 read-only verifier. Earlier workflows/writers/contracts remain unchanged.

## Verification and source review

- Consumer identity, replay, early read-only source probe and source/artifact/live gates have behavioral coverage. Resource controller tests cover fresh-resource refusal, private durable state, exact resource identity, foreign consumers, ambiguous creation and strict optional Docker tmpfs representation.
- Worker/probe independently passed13 behavioral tests, including actual SQLite CLI backup/restore, admission concurrency, failed/partial state, restart/catch-up and invalid path/mount/state refusal. Existing backup.py and bridge.py bytes are preserved.
- Activation source was independently reviewed. Local namespace permits only UID0; thirteen local model/filesystem checks therefore do not establish real UID1002/UID1000 authority. Twenty real writer/reader authority cases are a mandatory hosted same-image test with skipping forbidden.
- Same-image hosted Docker fixtures must prove copy-up ownership, sourceRO during ongoing WAL transactions, coherent restored snapshots, actual Node socket transport, manual admission, restart/catch-up, V2 default-path interoperability and lack of app/worker activation write access.
- A second hosted fixture executes the exact production resource controller CLI against a newly-created synthetic canonical D1 volume. It verifies actual Node source probing, prepare/receipt/cleanup and source preservation. It runs only on an ephemeral hosted engine, refuses any existing canonical volume, and creates no production data.
- Verify executes those actual-image tests before uploading immutable evidence. Exact PR/main Quality, Proof, Verify, image/tree/digest identity and actual server receipts remain mandatory. Local syntax/model checks do not replace them.

## Six requested scenarios

| Scenario | Source/readiness evidence | Remaining production acceptance |
|---|---|---|
| Tochka/DDS | Bank lifecycle, idempotence and timer fixes preserved; V2 activation remains after public checks | Actual bank account/balance/statement imports, totals and repeat without duplicates |
| Education/diary | Actual School R5 transport restored and reverified without changing School | Natural authenticated Education-to-diary navigation before and after ArtHello cutover |
| Staff module permissions | Shared checkbox/server module and branch policy preserved | Actual limited employee navigation and forbidden direct-route results |
| Developer feedback | Feedback button, owner backlog and persistence implementation preserved | Actual UI submission, reload and owner status handling |
| AlfaCRM | Confirmed Customer.balance monetary source, separate lesson balance and scoped family UI merged in R6 | Actual configured tenant credentials, branch/module coverage and selective imports; payment directions remain explicitly blocked until verified |
| Backups | Ordinary worker, manual socket contract and daily00:15UTC schedule in candidate | Actual production first backup/restore, owner manual creation and enabled durable schedule |

The cloud browser still returns502 before an authentication form. This prevents live natural navigation evidence and does not itself prove a public server outage. No passing SSO evidence has been manufactured. This document records a reviewable candidate and required checks, not a completed publication or all-six acceptance.
