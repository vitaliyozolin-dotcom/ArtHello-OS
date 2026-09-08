# R7 source and hosted image verified; actual server stopped before cutover on missing natural diary acceptance — 2026-09-08T12:44:15Z

PR362 is merged at `dbe630145a3828643fcfb9f202b1239e8cc54826`, exact tree `183babfe77884ae6375b50e19488b02bb0a2d461`. Exact PR and main Quality/Proof/Verify passed. Main Verify34227255309/job102064300592 executed760 application tests,20 real UID authority tests and actual Docker backup/restore/manual/restart/activation/controller fixtures successfully. Immutable artifact10056362266 is recorded in the R7 release checkpoint.

Actual protected R7 consumer34227595623/job102065872459 attempt1 passed identity, replay, exact-main gates, installed R5 read-only verification and gateway/source prerequisites. D1 was actually readable by UID1000, UID/GID1000, mode0600; gateway995 has the existing Docker deployment authority. The R6 unavailable root-installer blocker no longer stops this continuation.

At12:44:12Z ArtHello was still `6596f69390ad539577ec2640e8ef40c7e12c22dc`. School R5 identity/source/image/StartedAt remained preserved. Actual School-side HTTPS received ArtHello200 with healthy database. However, the cloud browser again returned502 before login; no natural authenticated Education-to-diary pass was observed. The mandatory fresh browser gate failed at12:44:15Z. Image loading, secret resolution, backup installation and cutover were all skipped. No production publication or all-six acceptance is claimed.

Resume from this exact main and consumer only after genuine current navigation evidence satisfying `.github/scripts/check-school-live-acceptance-r7.py` exists. Do not fabricate evidence, infer SSO from HTTP200, blindly rerun, or advance main just to update status. A real owner navigation/screenshot/time can supply the missing observation if this browser remains inaccessible; that is a functional observation, not another deployment approval. Repeat natural login after cutover and complete the other five live acceptance scenarios.

Alfa is still substantively incomplete: `Customer.balance` and scoped family display are implemented; payment direction/currency effects and accepted selective tenant imports remain unverified, and R7 does not add its background import schedule. The documented PayType read endpoint may be used for a later authorized read-only diagnostic, but names/IDs cannot be guessed into money movements. Missing env variables do not establish absence of encrypted DB credentials.

See `2026-09-08-r7-release-checkpoint.json`, `2026-09-08-r7-existing-relay-receipt.json` and `2026-09-08-r7-school-diagnostic.json` for actual evidence. Earlier R6/R5 history follows unchanged.

---

# R6 source verified; installed School relay verified read-only; gateway backup installation capability unavailable — 2026-09-08T11:35:43Z

PR361 merged as eb47c1360fbd701876a3c49efe029194707304db, tree 7e7b14ecbfbfb29e1268edaae7e620e4a62eda1c. All exact first-attempt PR and main Quality, Proof and Verify runs succeeded. PR hosted Verify executed 756/756 application tests; the R6 Ruby contract, 23 gate and 29 read-only relay tests also passed. Full identifiers and immutable artifact digest are in `2026-09-08-r6-release-checkpoint.json`.

Actual R6 run34221458013 / attempt1 / job102045375780 successfully verified the already-installed R5 School relay at11:35:42Z. Its original activation09:16:10Z, config, container and School source identities remain unchanged; no School reinstall or mutation was performed. Fresh read-only receipt is in `2026-09-08-r6-existing-relay-receipt.json`.

The next step measured gateway UID995 and found neither root nor existing passwordless sudo capability. The unchanged host backup installer requires that capability. The run stopped there: natural SSO diagnostic, image loading, secret resolution, clone, backup installation and ArtHello cutover were skipped. The live ArtHello SHA was freshly observed as6596f69390ad539577ec2640e8ef40c7e12c22dc.

A new installation design using only dedicated Docker resources and ordinary UIDs is under review. No host-root capability was obtained or granted. The existing root-owned Tochka activation marker is a separate dependency that must retain an equivalent independent writer boundary; removing the backup installer alone is insufficient.

Natural Education-to-diary browser acceptance remains unverified: the cloud browser returned502 / connection refused before login, while the server-side relay probe succeeded. These are distinct observations. No passing SSO evidence was created. All-six production acceptance is incomplete; Alfa financial movement projection remains explicitly blocked pending verified PayType direction semantics.

---

# R5 School repair verified; ArtHello cutover blocked on natural browser acceptance — 2026-09-08T09:25:29Z

PR360 is merged as ee8f3080d941a12be357eec0fd1d902acd01a2f9, tree ad4a288b52e053ca778b956e2d45e5266893ed9b, parent ce7c50ba367fca14d71669305bf4e82b791ce4f7. A fresh branch read still confirms this main SHA. Architectural decision D-071, technical consumer D067. Concurrent refactoring history is preserved.

Exact first-attempt PR gates succeeded: Quality34208420904, Proof34208420947, Verify34208420873. Exact main gates succeeded: Quality34208709041, Proof34208709085, Verify34208709057. Hosted verification includes 733/733 application tests, ordinary UID bootstrap/lock tests, actual Docker DNS/TLS/UID443/ACL and before-peer/after-peer/after-peer-removal mount fingerprint fixtures. Immutable image artifact10048949895 is 156181847 bytes, digest sha256:9d3b9f68cf27bd7cde30b956067267ba8d884dbb3d3852521f437a21796071b3.

Actual D067 run34208952716, attempt1, job102005327418:
- School repair step SUCCESS. Existing same-owner lock0644 was verified without another chmod.
- R5 relay was created at09:16:10Z and independently verified at09:16:12Z, execution UID1000.
- Repair config SHA256 2ba0ad1ce530db9c9abb622e5727e6345ab74a85699e121b718d9a0405b1f40a; runtime config SHA256 1bdef8cee0ed6e5b69e4aeaa24ae4a7441487dc5e69b9c4f48d9a125a47204a9.
- School source54242340f2d9b6a9887d69ecc03520ddf9f7982c, image, StartedAt and internal backend configuration stayed unchanged.
- Read-only School diagnostics confirm ArtHello DNS resolves and HTTPS returns200 with healthy=true and databaseAvailable=true. expectedGatewayPresent=false is expected with the new relay address, separately verified by the controller. SQLite quick_check, required schema and UID1001 filesystem access pass.
- Natural browser acceptance step FAILURE: fresh, real matching acceptance is absent. Image loading, secret resolver, clone and ArtHello cutover all SKIPPED.

The cloud browser returned502 Bad Gateway / Connection refused for both application origins, including an ArtHello reload after successful relay activation. No authentication form was reached in that fresh browser. Server-side HTTP200 does not establish natural browser SSO, and the cloud-browser502 does not establish a public server outage. No passing acceptance file has been manufactured.

Last previously observed live ArtHello remains6596f69390ad539577ec2640e8ef40c7e12c22dc; this is a historical observation, not a newly measured SHA. No ArtHello cutover occurred in R5. There is no claim of completed six-scenario acceptance or a newly published ArtHello product version.

The original R4 false-positive mechanism was reproduced by read-only diagnostic34207628005: twelve real samples showed only Mounts order changes; complete canonical mount values, all other School fields and backend fingerprint stayed identical. R4 cleanup was confirmed. R5 canonicalizes only complete Mounts entries and preserves duplicate entries, values and all other configuration checks.

Safe continuation: obtain real authenticated ArtHello -> Education -> Open diary -> authenticated School diary evidence after09:16:10Z, record its true observation time and provenance, and write exact schema3 evidence at docs/acceptance/2026-09-08-school-live-acceptance-r5.json on this evidence branch. The validator requires evidence no older45minutes and checks the actual live/candidate/School/repair identities. Only then retry the failed jobs of existing run34208952716; successful repair plus skipped cutover is explicitly resumable. Do not rerun failed historical D065/D066 repair, fabricate acceptance, inject sessions or remove release gates.

R5 also contains reviewed AlfaCRM unknown-balance rejection, incomplete-import failure and preview-expiry corrections. Real tenant import is not yet accepted. Official API research additionally identified an unresolved monetary-source issue: Customer.balance is documented as money, whereas CustomerTariff.balance units are unspecified. See the separate source-contract research note. False current-arthello environment presence flags do not prove absence of encrypted database credentials.

---

# D066 stopped after successful lock normalization — 2026-09-08T08:46:31Z

R4 main d872842e1dd99f1ec90790af54c00e9ff964b61c passed first-attempt Quality34206003379, Proof34206003315 and Verify34206003343 (724/724 application tests). Immutable artifact10047830480, digest sha256:e4ab821369560112942629598b76c01f7059a553f96045acaf762feb40f20832.

D066 run34206196494/job101996459827 passed exact release gates. The actual normalization receipt at08:46:30Z confirms existing UID/GID1000 lock device27/inode12 changed0664→0644 with same-owner verified result. This was a real production configuration mutation.

At08:46:31Z R3 controller refused school_changed_during_setup before docker start of the new relay. The code attempts cleanup of its own created IDs in finally, but actual post-failure cleanup still needs read-only confirmation. The diagnostic, image loading, secret resolver and ArtHello cutover were all skipped. Do not rerun D066 failed repair.

Static regression reproduces a possible false fingerprint change when Docker returns the identical full Mounts entries in another order. This mechanism is proven by local tests; the original failing pair was not retained, so the exact incident cause is not yet declared proven. A new bounded read-only diagnostic will compare12 real observations, component hashes, full-mount canonical hashes and cleanup metadata without raw secret/config values.

Current main separately advanced to055773c73f214b43caddb643cbccbe4b3d3d1755 with concurrent migration-evidence refactoring; it preserves R4 and has successful Quality34206517347/Proof34206517342/Verify34206517352. No successful School repair, SSO, ArtHello publication or six-scenario acceptance is claimed.

---

# R4 merged; exact main verification pending — 2026-09-08

The owner reran D065. Attempt2/job101982122878 failed in School bootstrap and skipped image/clone/cutover. The failed repair was not retried. Read-only diagnostic PR357 main52770ad3f10b0ed874263c28e932eb532d77e461, run34203383943/job101987156275, proved the existing UID/GID1000-owned shared lock had mode0664. Home and School baseline checks passed; R3 state and relay were absent. Egress network remained diagnostically unknown.

PR358 adds bounded normalization of that exact existing inode to0644 under exclusive flock, a fresh R4/D066 consumer, and queue:max in the unchanged shared groups of all active consumers. Architectural decision is D-069; technical release label remains D066. Concurrent refactoring main3cc30b6ad2790bfe15d43ab38adebb9cdf6a1f26 is preserved.

Exact first-attempt PR checks passed: Quality34205724098, Proof34205724153 and Verify34205724170 at head d72c768e1bbd0738d2e109817172adbfb0017606. Verify included actual ordinary-UID R4 bootstrap9/9, lock9/9, R4contract and17 boundary tests, plus real Docker relay checks. Reviewed 21-file tree12138dbef4d19c561003fee4b31e0b14a6c1342b was verified against every uploaded Git blob.

PR358 merged as d872842e1dd99f1ec90790af54c00e9ff964b61c with exactly that tree and parent3cc30b6ad2790bfe15d43ab38adebb9cdf6a1f26. Main Quality34206003379, Proof34206003315 and Verify34206003343 are pending/in progress at this checkpoint. Production mutation by R4 has not occurred. Last server-observed live ArtHello remains6596f69390ad539577ec2640e8ef40c7e12c22dc.

The fresh cloud browser currently returns502/Connection refused for both application origins. This is a browser observation, not proof of a server outage. Actual server diagnostic and real authenticated Education→Diary navigation remain mandatory. No live-acceptance PASS record has been manufactured. All six user scenarios remain unaccepted pending production checks.

---

# M3 verified; D065 cancelled before job creation — 2026-09-08T07:22:13+00:00

PR356 merged as `8a0bf989e0c271b009d8f14f0f3d21b3ab47966c` (M3), tree `5bc6c1bf49e7e609ec7a5e8193a60723c736f92f`.

Exact first-attempt main checks all succeeded:
- Quality `34198562442`.
- Proof `34198562451`.
- Verify `34198562465`, job `101971825380`: D065 Ruby contract, real non-root bootstrap (22/22 framework, no skips), R3 Docker DNS/TLS/UID443/ACL, and 724/724 application tests passed.
- Immutable artifact `10044909919`, `arthello-v52-verification-34198562465`, 156173450 bytes, digest `sha256:7a966fa76f13d5397c77dcbe123b4812e4b76e8e1312e38f6eb9459846b537da`.

D065 run `34198718003` was cancelled by pending concurrency before job creation at 2026-09-08T07:19:00Z. The jobs API returns `total_count=0, jobs=[]`. No School repair or ArtHello cutover started. Other consumers from the same event finished: D063 `34198717970` and D059 `34198718027` failed their exact historical identity gates before checkout/mutation; D064 `34198717913` was cancelled.

The exposed failed-jobs retry action was attempted only after verifying the empty job list and completion of the competing runs. GitHub returned HTTP403 `This workflow run cannot be retried`, because there are no failed jobs. The connection exposes neither full-workflow rerun nor workflow_dispatch. No alternate token, browser fallback, or production transport was used to bypass that capability limit.

Required next action is **Re-run all jobs on existing D065 run34198718003**. This reuses exact M3 evidence and does not trigger competing consumers from a fresh Verify event. The replay guard accepts a fully enumerated empty prior attempt; it still rejects any ambiguous repair or started ArtHello cutover.

After that action: observe actual School repair receipt, perform real authenticated ArtHello Education-to-Diary navigation, record fresh schema3 acceptance only on success, safely resume the consumer, then verify production and all business workflows. No passing browser evidence JSON exists yet. ArtHello remains the previously observed live release `6596f69390ad539577ec2640e8ef40c7e12c22dc`; School has not been changed by D065. The six-item task is not claimed complete and the new product version is not claimed published.

---

# R2 deployment result and reduced-privilege R3 — 2026-09-08T06:58:21+00:00

All exact M2 main gates passed: Quality `34196009060`, Proof `34196008965`, Verify `34196009029` (724 application tests plus actual relay Docker/Ruby gates).

D064 consumer `34196169336`, job `101964316036`, failed during School repair with `sudo: a password is required` at 2026-09-08T06:47:15Z. The bootstrap calls sudo before reading stdin, creating files or invoking the controller. No School relay/network/state was created by this attempt. Diagnostic, image download/load, secret resolver and ArtHello cutover were skipped. This is a real missing host-root capability, not a build/test failure. R2 is not retried.

The existing School transport previously executed ordinary Docker deployment operations and shared School locking. The successful D058 run `33762398372`, job `100671690779`, used `/var/lock/school-1-11-production.lock` and confirmed remote School sync at 2026-09-03T13:40:58.486Z.

R3 is being prepared with reduced required privileges: existing Docker deployment API, passwd-derived own private state, the existing shared lock opened readonly, a UID1001 read-only relay and no host-root writes/privileged-container bypass. Independent design review accepts this bounded approach; live prerequisites remain checked before mutations. D065/root documents are prepared for planned PR356; no new R3 run or successful SSO is claimed yet.

---

# R2 merged — 2026-09-08 06:46 UTC

PR355 merged as `8d4fc1cb589db8550cc4e7857e1a7537ac771ae5` (M2).
Exact PR head `cb1f917c7ab4aa879be2f83f4fbec3252a8b685b` passed first-attempt Quality `34195727761`, Proof `34195727725`, Verify `34195727733`. Actual hosted Ruby contract, Docker DNS/TLS/non-root443/ACL, and 724 application tests passed. Verified private artifact ID `10043854782`, 156167124 bytes, digest `sha256:e83b8b18fc499085563c20467616085a1211c3558139460b563b6a9e0c897666`.

Exact M2 main checks are running. No production mutation yet. The D064 consumer will repair School only after all exact main gates, then stop before ArtHello cutover until genuine fresh schema2 browser evidence exists.

---

# Current R2 candidate — 2026-09-08 06:41 UTC

PR355: https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/355

- Branch: `codex/school-arthello-recovery-r2-20260908`.
- Head: `cb1f917c7ab4aa879be2f83f4fbec3252a8b685b`.
- Tree: `a0a8b1f507bb7a2112f849da8d49db9c18b15ecc`.
- Parent main: `68a159dc647f35cdd30ce586fc6d5beb93b89a51`.
- 30 changed files: constrained School HTTPS repair, separate D064 consumer, final Alfa raw-source fixes, decision/passport and review records.
- Relay config digest: `ede8c38cc4bf5d7bf3aabc4fa9161ed9d00293532708d3bdd3f995199ffd4176`.
- Local verification: 54 Alfa + 18 consumer + 14 repair + 8 transport tests passed, lint/build and YAML/shell syntax passed. Independent bounded review: no open P1/P2; real hosted Docker/Ruby gates pending.
- Main and ArtHello production remain unchanged at this point. No School mutation has executed. No live SSO acceptance is claimed or manufactured.

The next required sequence is exact PR/main CI, School configuration repair, natural authenticated Education-to-Diary browser navigation, exact schema2 evidence, safe consumer resume, guarded ArtHello cutover and live business-workflow acceptance.

---

# ArtHello recovery release — 2026-09-08

Status: IN PROGRESS / NOT DEPLOYED. The owner explicitly selected GitHub plus a separate build machine and authorized publishing all six corrections. No additional approval of code changes or deployment is being requested.

## Confirmed production observations

- The protected owner login to ArtHello succeeded in a fresh browser session. Education rendered normally.
- A natural click on “Открыть дневник” redirected to School `/login` with `authError=central_denied` and no `reason`. This identifies the School callback catch path but does not distinguish cookie/state, exchange/network or database failure. The allowlisted host diagnostic is prepared; it has not run.
- Tochka has an existing saved key and selected legal entity. Its visible configuration requests all allowed accounts, statements beginning `2026-09-01`, every hour at minute `5`. No configuration was changed.
- The financial registry is empty. Four accounts are visible without balances; the last integration run is `2026-09-07 08:00`, waiting for the bank. A historical run showed 15 rejected rows, zero accepted operations and a misleading successful status. These are unresolved live facts, not proof that automatic import works.
- AlfaCRM's existing form contains a tenant address, branch 1 and selected modules. That form does not prove credentials, coverage, selective import or synchronization have been accepted.

No passwords, bank keys, authorization codes, callback state or cookies were copied into the report or repository.

## Prepared work

- PR348 Education access, PR349 Docker network preflight, PR350 verified backup package, PR351 pending Tochka statements and PR352 developer feedback remain preserved.
- Today's product candidate adds an internal Tochka scheduler, backup Settings UI and a bounded Unix socket bridge, corrections to AlfaCRM staged import, and shared module access checks with session revalidation.
- Independent review found that merely removing old role checks could expose unscoped HR data. That finding is being corrected and is not waived by menu tests. Backup socket lifetime and malformed history handling were also corrected after independent review.
- The combined source is reconstructed from the pinned archive and checked against the original database checksum before new patches. The combined test/build result will be recorded separately; individual agent test counts are not added together as a claim about the final candidate.
- [PR353](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/353) preserves the isolated builder candidate. It is draft and has not run on a VM.

## Fresh CI evidence superseding the old quota blocker

PR353 commit `ea4b22cc7cc421a942c210d1a94c90147849f2c5` actually ran on GitHub-hosted Ubuntu runners today: Verify run `34189642144` and Quality run `34189642189` succeeded. Verify artifact `10041764058` exists, is not expired and contains 156,071,423 bytes; its API digest is `sha256:b6b6a8543bfe6d20bb732d27aa3003f802448cae53f49f35f7961a6fd4f508d6`. This proves that the previous hosted-minute/artifact blocker must not be assumed current. The immediate release continues using the available checks; the separate builder preparation remains preserved in draft PR353. No VM purchase or billing change was made.

Proof run `34189642216` reached visual acceptance and failed there. Its upload step succeeded without uploading a file because hidden `.artifacts` contents were excluded. A narrow diagnostic/evidence correction is being prepared; the visual threshold is not waived.

## Remaining execution requirements

1. The separately accessible build VM remains unconnected, but this is not a blocker to the immediate release now that hosted verification and image upload have actually succeeded.
2. The connected GitHub interface does not expose runner registration administration or a fresh `workflow_dispatch` action. A new, separately reviewed release consumer is being prepared for the current owner-authorized release after exact main Quality/Proof/Verify. It does not rearm the expired D-059 release.
3. Actual hosted verification produced an immutable private artifact. The new production consumer must validate this exact artifact contract, source SHA/tree and successful checks; the old screenshot is historical evidence, not a current upload failure.
4. Timeweb's panel rendered “Site Unavailable” in this cloud browser. No Timeweb account or server inventory was reached, no machine was purchased, and no server was modified through that route.
5. School's callback category must be obtained on its host before choosing a functional correction. Local SSO code and generic public health do not establish the production cause.
6. Exact candidate Docker/runtime checks, restored production-data preflight, backup installation/restore proof, guarded cutover and live acceptance of all six scenarios remain required. The local environment does not offer Docker; Unix socket smoke checks explicitly fail/skip on its `EPERM` restriction rather than being called successful.

## Next execution order

Finish and preserve the combined candidate and review findings. Use the verified available hosted checks and private artifact delivery while retaining the separate builder candidate. Run the prepared read-only School diagnostic through the reviewed production preflight, fix the proven callback defect, and retest. Run all exact-source gates, test a restored copy with real integrations disabled, install and verify backup services, then publish the immutable image with rollback available. Finally verify SSO, employee access, saved feedback/history, actual bank counts/sums and idempotent repeated imports, selective AlfaCRM import and manual/automatic backup results.

The user-facing statement “new version published, everything works” is not supported at this checkpoint.

## Combined product PR354 — initial hosted checks

The frozen 105-file candidate is preserved in PR354, branch `codex/recovery-release-20260908`, head `49d17d65d1b39d50b9d4d1a8ae9eb24a511c9cbf`, tree `861b974747eb14c12df64f0af36149b42d8d402d`. Main remains `9e4c49161e643997fe821a91b84c60c6e38ede33`. No production deployment has occurred.

- Fresh assembly: all27 hooks and original database-source checksum PASS. Production build and ESLint PASS. Serial700 tests:698PASS,0FAIL,2 explicit Unix skips due to local bind restrictions; Docker application stage requires those checks to run. Host/network30 tests PASS.
- Quality34192125105: test and secret-scan jobs SUCCESS.
- Proof34192125115: permission, migration, workflow-policy and visual gates SUCCESS. Private evidence artifact10042587534 exists,67034 bytes, digest `sha256:fc5257c3426f98447d5224854e03047867c9316d6e16fbbf37962074e19c0cfd`. These checks do not replace live v52 acceptance.
- Verify34192125095 stopped before build on the old exact single-TOCHKA service-binding assertion. Combined runtime legitimately adds the restricted backup transport; the strict expected binding set is being updated and independently reviewed.
- Consumer review found two real pre-release risks: snapshot rollback after public writes and Tochka timer activation before verified cutover. The next revision must close both with a durable public-write boundary and SHA/attempt-bound activation marker. Production is unchanged while these are fixed.
- Fresh natural School SSO still returns `central_denied`. No passing acceptance JSON has been created. Real bank and AlfaCRM synchronization, personnel acceptance, feedback persistence and backup installation/restore still require live checks.

## Merged main and confirmed live School blocker

PR354 was merged as `68a159dc647f35cdd30ce586fc6d5beb93b89a51` (tree `d43506688384741d70ad98066417d68e55e02387`). First-attempt main Quality34192976544, Proof34192976483 and Verify34192976402 all succeeded. D063run34193103822 verified exact source and reached its read-only School diagnostic, then stopped before all image/clone/cutover steps because genuine School acceptance was absent.

The actual runtime reports Docker `arthello-os_backend` with `Internal=true`; ArtHello DNS and HTTPS both return EAI_AGAIN, matching the fresh callback's fetch_failed category. SQLite quick_check, required schema and UID1001 filesystem access pass. This identifies the first live blocker without claiming later SSO acceptance. See `2026-09-08-school-runtime-diagnostic.md`. The next change is a reviewed, narrow communication repair; the shared network must not be globally opened.

ArtHello production has not yet changed. The old D059 run34193103820 correctly rejected the different release at its first gate, before checkout or cutover; it was not rearmed.
