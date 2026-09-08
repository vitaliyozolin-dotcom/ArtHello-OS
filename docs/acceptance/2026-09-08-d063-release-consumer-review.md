# D063 release consumer independent review — 2026-09-08

Verdict: **CONDITIONAL PASS for submitting this revision to hosted CI.** No remaining P0/P1 finding in the reviewed provenance, delivery, replay and rollback controls. This is not a production deployment receipt or a claim that the six product scenarios pass.

## Reviewed identity

- Repository: `vitaliyozolin-dotcom/ArtHello-OS`.
- Intended release: PR `354`, branch `codex/recovery-release-20260908`, signed squash descendant of `9e4c49161e643997fe821a91b84c60c6e38ede33`.
- Frozen manifest SHA-256: `9383b4591b9021c8f510da635bd3c0ad0ea6b3ab2409a4118fe15e608d26d779`.
- All eight manifest file digests were independently recomputed and matched.
- Deploy workflow SHA-256: `246bf0cd6c19e98fceb96ae608fb6fd2b11272baf98be5abfcf116f663cef53b`.
- Verify workflow SHA-256: `5949b38fa56575cc1006332a0389ce1e2d935d05997b1a3b66dd75b8b63e1ab9`.
- Activation helper SHA-256: `dcb1a3501498cc05948f7b87d29f191444c60a0860828528f958fc29d1df3707`.

The merged release SHA/tree does not exist in this review. The consumer obtains and verifies it from the actual successful main Verify run, current main, signed commit and merged PR; it does not substitute the workflow event controls SHA.

## Findings closed

1. **P1 — incompatible runtime binding guard.** Both the production checkout step and hosted Verify required the obsolete Tochka-only service binding string. The combined application also contains `BACKUP_TRANSPORT`, so the old guard deterministically aborted the release. Both now verify the actual two-binding contract, with a corresponding contract ratchet.
2. **P1 — accepted writes could be lost during rollback.** The initial consumer opened the public route before its remaining checks and restored the pre-cutover database on any subsequent failure. It now completes candidate-local, HMAC, restart-policy and current-main checks first, atomically publishes and fsyncs a non-replaceable activation record, then crosses a publication boundary before any public route mutation. After that boundary, ambiguous reload, public verification failure or cancellation preserves the candidate, current data, rollback volume, routes and diagnostic work directory, and reports `ARTHELLO_POST_ACTIVATION_RECOVERY_REQUIRED`. Snapshot rollback remains available before publication.

The durable record contains the release/run/attempt, exact candidate and previous container IDs, rollback volume, both route digests and diagnostic directory. A pre-existing record fails closed.

## Controls confirmed

- The expired D059 one-shot is not rearmed. D063 is scoped to PR354, the expected repository/branch/owner and current signed main.
- Exact main Quality, Proof and Verify success, expected required jobs, hosted runner identity and first-attempt upstream evidence are required before checkout or production capabilities.
- Image delivery is tied to the verified workflow run; evidence checks bind SHA/tree, archive checksum, Dockerfile/lock/inventory/CA/filter hashes and portable runtime fingerprint. No production JavaScript build is introduced.
- Read-only School diagnosis and fresh, correctly scoped natural-browser evidence precede image import and cutover. An absent or mismatched evidence record stops the release.
- Shared production/School workflow locks remain; retries require proof that every prior cutover step was skipped. Started, successful or ambiguous cutovers cannot be replayed.
- Canonical D1 path and open file descriptors, isolated clone, preservation of encrypted credentials, verified backup and a separate rollback volume remain required.
- SSH host fingerprint pinning and secret redaction remain. Issue write permission and automated issue comments were removed.

## Independent validation

- All eight frozen file SHA-256 values: PASS.
- All 17 shell run blocks from the two generated workflows: `bash -n` PASS.
- `python3 -I .github/scripts/test-d063-release-gates.py`: **12/12 PASS**. Fault tests execute the extracted rollback function in subprocesses and prove that post-boundary route/reload/public-check/cancellation failures preserve simulated new writes and do not run cleanup; pre-boundary failure restores the snapshot.
- `school-sso-readonly-diagnostic.sh --self-test`: redaction PASS.
- Standalone replay guard and the embedded workflow implementation match.
- Ruby is not installed in this local environment. The Ruby release contract was read but was **not successfully executed locally**; hosted Verify must execute it for this exact revision.

## Remaining release gates

Fresh exact-revision hosted Quality/Proof/Verify, real School browser acceptance, actual host clone/backup/cutover evidence and post-release acceptance remain necessary. Runtime/backup bridge/Tochka activation and Alfa scope are additionally reviewed by the separate runtime reviewer. No merge, host mutation or deployment was performed by this review agent.
