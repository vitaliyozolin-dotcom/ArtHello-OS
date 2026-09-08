# D063: controlled ArtHello recovery consumer

This is a reviewed-candidate handoff, **not deployment evidence**. The old D059 workflow remains unchanged.

Fresh API evidence on 2026-09-08 supersedes the previous hosted-billing blocker for this run: Verify `34189642144` for PR353 head `ea4b22cc7cc421a942c210d1a94c90147849f2c5` succeeded, ran all runtime/maintenance steps, and uploaded artifact `10041764058`, 156071423 bytes, digest `sha256:b6b6a8543bfe6d20bb732d27aa3003f802448cae53f49f35f7961a6fd4f508d6`. Its name is `arthello-v52-verification-34189642144`. This does not assert unlimited future quota or successful verification of the product release candidate.

## New release identity

- `.github/workflows/deploy-arthello-recovery-20260908.yml`
- Name: `Deploy ArtHello recovery D063`
- Repository: `vitaliyozolin-dotcom/ArtHello-OS`
- Release branch: `codex/recovery-release-20260908`
- Release PR: 354
- Required parent of the GitHub-verified main squash commit: `9e4c49161e643997fe821a91b84c60c6e38ede33`
- Protected environment: `production-ru`; existing dedicated gateway runner.
- Shared ArtHello/School concurrency scopes are preserved.
- Completion event from canonical hosted Verify only; exact main Quality, Proof and Verify jobs must all succeed on first source-verification attempts. Production retry is separately handled below.

## D063 decision text for coordinator

Владелец явно поручил 08.09.2026 выпустить все исправления ArtHello и подтвердил сохранение GitHub. Фактический hosted Verify снова работает; выпуск может использовать его неизменяемый проверенный артефакт без покупки отдельной машины. Для нового общего PR354 из `codex/recovery-release-20260908` создаётся отдельный consumer D063. Это новое разрешение в рамках текущего поручения, не повторное включение старого D059.

Из-за недоступного исполнителю workflow_dispatch consumer запускается через workflow_run после канонического Verify на точном GitHub-verified squash-коммите main, являющемся прямым потомком `9e4c49161e643997fe821a91b84c60c6e38ede33`. До checkout/production capability повторно сверяются repository, PR, release branch, owner actor/merge identity, current main, источник Verify и все Quality/Proof/Verify jobs. Environment `production-ru`, shared concurrency, hosted provenance, clone proof, canonical D1 identity, secrets digest, backup-first cutover и rollback сохраняются.

Отдельный первый stage читает School diagnostic и требует свежую фактическую естественную браузерную приёмку SSO. При её отсутствии он останавливается до загрузки image, установки backup/service и cutover. Нулевые error logs не считаются приёмкой. Исполнитель вправе записать machine-readable acceptance только после реального browser PASS в существующую private recovery-evidence ветку. Такой отчёт — результат проверки, не новое согласование владельца.

Повтор production-run для того же SHA допустим только после safe pre-cutover failure/cancellation: GitHub API по каждому прежнему attempt должен подтвердить, что единственный cutover step имеет conclusion skipped. Успешный выпуск, начатый cutover, незавершённый run или неполная история запрещают replay того же SHA. При изменении release SHA обязательны новые exact gates и соответствующая новая release identity. После cutover исполнитель повторяет естественный SSO уже на новом ArtHello SHA и только затем может объявить весь выпуск принятым.

## SSO evidence stage

First run intentionally fails closed if evidence is missing. It prints only the allowlisted remote diagnostic before stopping. It does not claim SSO success from historical logs or endpoint health.

The gate reads data only from:

`docs/acceptance/2026-09-08-school-live-acceptance.json`

at existing branch `codex/recovery-evidence-20260907` in the same private repository. No success file is created by this candidate or workflow. Do not create it before real natural browser verification.

Required data fields:

- `schemaVersion`: 1
- `intendedCandidateArtHelloSha`: exact SHA to be deployed.
- `observedLiveArtHelloSha`: actual currently deployed ArtHello image revision. Pre-cutover this normally differs from the intended candidate.
- `observedLiveSchoolSha`: actual School `school.candidate-sha` label from the fresh remote diagnostic.
- `observedAtUtc`: timezone-aware timestamp, at most 45 minutes old, no future timestamp.
- `arthelloOrigin`: `https://arthello-188-225-38-55.sslip.io`
- `schoolOrigin`: `https://school-188-225-38-55.sslip.io`
- `method`: `natural-browser-navigation`
- `sessionInjected`: false; `callbackUrlConstructed`: false.
- `verifiedSteps`: exact ordered list `open_education_in_authenticated_arthello`, `click_diary_entry`, `follow_natural_sso_redirects`, `authenticated_school_diary_visible`.
- `result`: `pass` only after the real check.
- `evidenceReference`: a reference to the actual recorded browser evidence; no passwords, auth tokens or callback query data.

The pipeline independently compares live ArtHello and School revision labels to the record. A successful pre-cutover check is not represented as a check of the new ArtHello build. Post-cutover natural browser verification remains mandatory for final acceptance.

## Runtime integration

After the unchanged clone validation passes, the existing canonical active D1 relative path is joined to the exact named Docker volume mountpoint; no database search is performed. The live fd guard has already verified that binding. Backup installer performs a real online backup and restore drill before enabling its daily timer. Bridge installer creates the persistent `/var/lib/arthello-v52-backup-control` directory and UNIX socket group. Production receives only that directory readonly and numeric supplementary GID. Clone does not receive the bridge.

Clone explicitly receives `TOCHKA_AUTOSYNC_ENABLED=0`; production receives `TOCHKA_AUTOSYNC_ENABLED=1`, exact `RELEASE_SHA`, and a fresh 32-hex `TOCHKA_AUTOSYNC_ACTIVATION_ID`. The required timer overlay is `tochka-activation-finish-20260908/manifest.json`. Without its strict marker checks this consumer must not be released. Imports remain disabled until all real public, School HMAC and current-main checks pass. Only then root atomically writes/fsyncs `/var/lib/arthello-v52-backup-control/tochka-autosync.activation` as root:arthello-backup-control mode0640 with exact content `ARTHELLO_TOCHKA_AUTOSYNC_V1 <SHA> <ACTIVATION_ID>\n`. A previous SHA/attempt marker cannot enable the new process. The timer rechecks this bounded regular file before each tick.

The bridge/service install needs root or `sudo -n` on the gateway. Host volume inspection uses that same privilege path. The bridge socket/service has a bounded 30-second readiness poll before live stop. A missing privilege or socket fails before live stop. Alfa import remains default off; this consumer does not claim real tenant synchronization.

## Publication boundary and recovery

Both runtime service binding checks now require Tochka and Backup, matching the combined product. Candidate-local functional/auth/assets checks, School HMAC, current-main, restart policy and container identity checks precede the public route change. The immutable root-owned bank marker is still absent or mismatched at this point.

Immediately before public route mutation, `.github/scripts/d063-activation-state.py` publishes a no-replace, fsync-backed marker under the gateway runner's durable `~/.config/arthello/release-state/activation-<SHA>.json`. It records release/run/attempt, exact old/new container IDs, rollback volume, route SHA256s and diagnostic directory. An existing marker fails closed. Once the marker succeeds, the rollback handler never removes the candidate, restores the stale snapshot, or deletes route/work evidence. Ambiguous route reload, failed public checks and cancellation produce `ARTHELLO_POST_ACTIVATION_RECOVERY_REQUIRED` while preserving current user data. Before this boundary, the verified snapshot rollback remains available.

Public URL and School HMAC checks are repeated after activation. Only their success allows bank activation and the release-active receipt. Natural browser acceptance on the new ArtHello release still remains the coordinator's final acceptance step. No issue comment is sent; the receipt is recorded in GitHub step summary without `issues:write` permission.

## Validation completed locally

- 12 acceptance/replay/activation behavioral tests PASS, including immutable marker/no-symlink checks and real Bash subprocess fault tests showing snapshot restoration only before the public boundary; route-move, ambiguous reload, failed public check and cancellation preserve new writes.
- All 17 shell blocks across new consumer and modified Verify pass `bash -n`.
- YAML parsing PASS.
- Ruby contract **NOT RUN locally**: Ruby is absent; an attempted package install failed because this scratch namespace cannot set apt user/group IDs. Hosted Verify already uses Ruby and will execute this additional contract before any image build.
- Actual new GitHub run / production execution / School repair / browser acceptance: **NOT RUN by this subagent**.

`manifest.json` contains exact files/hashes for independent review and integration. `render.py` adapts the existing verified-artifact and clone gates to the explicit D063 identity, Proof/replay checks, diagnostic stage, backup/autosync integration and corrected durable publication boundary.
