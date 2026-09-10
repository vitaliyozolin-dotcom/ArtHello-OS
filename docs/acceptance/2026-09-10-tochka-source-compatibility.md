# Tochka source compatibility after D-099

Status: source correction; production and bank acceptance remain open.

Reviewed baseline: main `f52f5cbcd15e011ee16b581f905c818b19366562`, tree
`8b6712bd5718a3c9f113e999968976d7fccfe036`. Its parent R14 source is
`d44137d8342b7eacec510f9f70ffeba6c3bf4f3a`. This correction preserves all
materialized application files and the frozen R14 controller/contracts.

## Reproduced failures

- Quality run `34408783911` rejects the v44 canonical source hash. The same
  mismatch occurs in a clean Git checkout: expected `adf06829…`, actual `c99a5f6d…`.
- V52 verification run `34408783941` fails in the account identity tests because
  they still import removed `deploy/v52/overrides` files.
- R14 verification run `34408783882` rejects its frozen source transformation.
  That separate rejection is valid: D-099 changed the pinned Dockerfile and
  removed pinned source paths. This patch does not repin or bypass that gate.

## Independent content comparison

The old source archives were decoded from the parent checkout and checked
against their existing SHA-256 pins before extraction. The v44 reconstruction
then received its old overrides. The v52 reconstruction received both override
sets and all 27 patch commands in the parent Dockerfile, in order. Patches with
absolute `/app` paths ran against a temporary reconstruction through a temporary
symlink, which was removed after the comparison. No production files were read.

All 237 tracked v44 files and all 454 v52 files are byte-identical to D-099.
The only excluded old v44 file was the ignored compiler cache
`tsconfig.tsbuildinfo`; no application source was excluded. There are no added,
missing or changed source files in either comparison.

Using sorted GNU tar, epoch timestamps, numeric owner/group zero, and explicit
`--mode=u+rwX,go+rX,go-w`, the reconstructed and checked-out trees independently
produce the same hashes:

| Source | SHA-256 |
| --- | --- |
| v44 | `c99a5f6ded03d5c8071a4f0601e4ae2504ffa7cd6af4ccc21a8aaf00e8adf020` |
| v52 | `c76256a9f9239560598df62d3ee2da49e9713da1a83c4af2c9910532482b88ce` |

The old tar contract did not normalize checkout permissions. For v52,
normalizing to group-writable modes reproduces the old `1c683f12…` manifest
exactly. The original v44 `adf06829…` is not reproduced and is not claimed to
have been explained completely. The replacement v44 hash is justified by the
independent reconstruction above, not by trusting the failing checkout alone.

## Correction and verification

Manifest schema 2 fixes canonical modes without changing on-disk permissions.
File contents, paths and executable identity remain part of the hash. Both
manual v44 checksum readers use the same contract. Bank tests import the
materialized v52 source; their assertions are unchanged.

`node --test scripts/test/school-source.test.mjs scripts/test/tochka-account-identity.test.mjs`
passes 14 tests. Source tests reject content edits, added/missing files, changed
executable identity and unsupported canonicalization, while allowing checkout
read/write permission differences. Bank tests exercise cross-account provider
IDs, idempotent replay, transactional index migration and fixed error codes
against local fixtures. These numbers are not production bank counts.

Hosted exact-head CI and final source review remain mandatory. R14 remains
frozen and cannot publish this changed source. A separate reviewed release must
resolve its identity and the previously failed artifact delivery before any
cutover. Last accepted runtime remains R13; PR399 observation pins remain
unbound. No current bank/DDS acceptance is claimed.
