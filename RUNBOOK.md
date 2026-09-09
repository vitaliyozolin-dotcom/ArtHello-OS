# ArtHello OS — Runbook

## A.4: изолированный импорт данных

Sandbox DB обязана находиться по абсолютному пути вне source checkout. Единственная переменная пути — `ARTHELLO_SANDBOX_DB_PATH`; команда завершится fail closed при пустом, относительном, корневом или вложенном в репозиторий пути.

```bash
pnpm --filter @workspace/scripts run sandbox:init
pnpm --filter @workspace/scripts run sandbox:import:alfacrm
pnpm --filter @workspace/scripts run sandbox:audit:alfacrm
pnpm --filter @workspace/scripts run sandbox:audit:payroll
pnpm --filter @workspace/scripts run test
```

Payroll importer принимает owner-provided snapshot только через stdin. Snapshot и sandbox DB не помещаются в Git, Sites, stdout или frontend. Перед импортом payroll отдельно получить snapshot Google Sheet с `FORMATTED_VALUE` и `FORMULA`, затем передать один JSON-пакет в stdin без shell-history с секретами.

AlfaCRM importer принимает `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`, `ALFACRM_API_KEY` только через process environment защищённого процесса. Он использует только read endpoints, сериализует запросы не чаще одного старта в 260 ms, сохраняет raw + normalized records и выводит только безопасный агрегированный отчёт. `partial/request_timeout` не интерпретируется как нулевое покрытие источника.

Полный режим используется по умолчанию: `ALFACRM_SYNC_MODE=full`. Он отдельно получает leads и students, затем groups, teachers, payments, lessons, memberships, customer tariffs, справочники и change log. Пагинация передаёт `page` + `pageSize: 50`. Каждая страница атомарно сохраняет immutable raw, observation и normalized row; reconciliation current/stale запускается только после полного completed scope. Repeat page, max guard, transport/normalization error оставляют scope `incomplete` и не tombstone-ят отсутствующие rows. Независимые customer/group scopes продолжаются после локальной ошибки.

Перед `0014` обязательно создать копию sandbox. Migration завершается fail closed, если в legacy normalized AlfaCRM-таблицах есть строки без доказуемого raw/batch provenance; автоматического backfill по догадке нет. После apply выполнить `sandbox:audit:alfacrm`, проверить `normalizedRowsWithBrokenProvenance = 0`, raw UPDATE/DELETE rejection и rollback `0014_alfa_lineage_snapshot.down.sql`.

Для режима только обнаружения изменений задать `ALFACRM_SYNC_MODE=incremental`, `ALFACRM_WATERMARK=<ISO timestamp>` и при необходимости `ALFACRM_OVERLAP_DAYS=1..7` (по умолчанию 2). Если watermark не передан, importer использует время последнего завершённого batch; при отсутствии такого batch останавливается fail closed. Этот режим обновляет change log, но не утверждает, что все изменившиеся domain rows rematerialized.

### Tochka OAuth

1. Поднять защищённый backend с exact callback `/api/banking/oauth/callback`, HTTPS, persistent DB, `SESSION_SECRET`, encryption key ring и protected Secrets.
2. Создать backup ID, проверить restore/rollback и guarded migration encrypted connector config в sandbox.
3. Зарегистрировать в кабинете банка exact backend URL. Sites root и любой `.chatgpt.site` URL запрещены.
4. Проверить state-bound Authorization Code flow и запросить только read-only permissions для accounts, balances, customers и statements.
5. Выполнить owner consent в пользовательском браузере. Authorization code, tokens и customer identifiers не выводить и не передавать через чат.
6. Проверить accounts/balances/statements в sandbox; payment endpoints не вызывать.
7. После end-to-end проверки перевыпустить временно раскрытый client secret и сохранить новый только в protected backend Secrets.

## A.3: безопасный live read-only probe

Команда: `pnpm --filter @workspace/api-server run probe:live-read-only`.

Credentials передаются только в process environment:

- `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`, `ALFACRM_API_KEY`;
- `PROBE_TOCHKA_CLIENT_ID`, `PROBE_TOCHKA_CLIENT_SECRET`.

Дополнительные ограничения: `PROBE_REQUEST_TIMEOUT_MS`, `PROBE_MAX_BRANCHES`. Probe не сохраняет ответы, не создаёт consent, не пишет в БД и не вызывает платежные API. В stdout допустимы только HTTP-статусы, количества и boolean-признаки. После выполнения process environment уничтожается вместе с процессом.

## A.2: изолированный PostgreSQL 16

1. Source импортирован в приватную ветку `codex/a3-live-read-only` без секретов; открыт Draft PR #1.
2. `.github/workflows/quality.yml` выполнен на одноразовом PostgreSQL 16.
3. Последнее историческое evidence перед циклом 3: checkpoint v10, run #8 (`30163177884`) — `test:full`, `test:postgres`, `build:full` PASS на remote head `7f175fa7f14a55b0f329b95a6f63d326682ec113`.
4. При каждом изменении runtime-кода повторять весь quality workflow; подготовленный или частично прошедший run доказательством не считать.
5. Для bank-config migration сначала проверить snapshot, затем задать backup ID и одноразовый confirmation token.
6. Не выполнять первый прогон против production `DATABASE_URL`.

## Безопасные контуры

- Рабочая копия и Sites не содержат production `.env`.
- `.openai/hosting.json` хранит только Sites `project_id`; секретов в нём нет.
- Sites project: `arthello-os-control`, доступ owner-only.
- Не открывать опубликованный Sites URL во внутреннем cloud browser; для внутренней проверки использовать agent preview.
- Owner-only sanitized checkpoint не означает production readiness. Текущий production/live-data gate: **BLOCKED**.

## Локальная установка

Требования: Node 24 и pnpm через Corepack.

```bash
pnpm install --frozen-lockfile
```

Никогда не добавлять secrets в tracked-файлы. Для runtime использовать защищённые environment variables.

## Основные команды

```bash
pnpm run typecheck
pnpm run test:security
pnpm run test:sites
pnpm run test:full
pnpm run build:full
pnpm run dev
```

`pnpm run build:full` проверяет и собирает весь монорепозиторий. Package-manager-neutral `npm run build`/`pnpm run build` собирает только Sites artifact, потому что Sites remote builder вызывает root build через npm. `pnpm run dev` запускает только безопасную Sites control surface. Рабочие сервисы Replit запускаются их package scripts и требуют отдельного environment.

## Environment variables

Имена, обнаруженные в коде:

- `DATABASE_URL`;
- `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`, `ALFACRM_API_KEY`;
- `DASHBOARD_PASSWORD`, `ACCOUNTANT_PASSWORD`, `VIEWER_PASSWORD`;
- `ACCOUNTANT_BRANCH_IDS`, `ACCOUNTANT_LEGAL_ENTITY_IDS`;
- `VIEWER_BRANCH_IDS`, `VIEWER_LEGAL_ENTITY_IDS`;
- `APP_ORIGINS`;
- `SESSION_SECRET`;
- `AUTH_SESSION_TTL_MS`;
- `AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_LOGIN_WINDOW_MS`, `AUTH_LOGIN_LOCK_MS`;
- `TRUST_PROXY_HOPS`;
- `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`;
- `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID_PROMOTION`;
- platform variables Replit и `PORT`.

Пароли должны быть не короче 12 символов. Non-owner account не включается без непустых списков и филиалов, и юридических лиц; даже после этого business routes остаются fail closed до handler-level predicates. `SESSION_SECRET` для Evotor должен содержать не менее 32 символов; fallback-ключа нет. `AUTH_*`, scope lists и `TRUST_PROXY_HOPS` являются runtime-настройками, а не секретами, но раскрывать operational scope в Sites нельзя. Реальные значения секретов запрещено помещать в frontend, документацию, Git или Sites.

`ALFACRM_DOMAIN` обязателен и не имеет tenant fallback. Без него AlfaCRM client останавливается fail closed. Значение задаётся только в защищённом runtime environment.

## Запуск API

Production entrypoint запускает `lib/db/scripts/checked-migration-runner.mjs`: до подключения он сверяет все SQL с `migration-manifest.json`, затем принимает только точный префикс ledger и применяет оставшиеся checked-in миграции последовательно в транзакциях. После этого `artifacts/api-server/src/index.ts` выполняет read-only `assertMigrationStateReady()`, затем `assertSecuritySchemaReady()`, и только потом `listen()`. Изменённый/незарегистрированный SQL, ошибка migration, отсутствующий auth/audit column/index или несовпадение ledger останавливают listener и polling с кодом 1. Runtime `drizzle-kit`, package manager, codegen и legacy `migrate.ts` запрещены. Каждый candidate обязан повторить CI gate на exact PR head; против production `DATABASE_URL` запуск без отдельного разрешения D-009 запрещён.

Новый auth runtime требует migration `0009_famous_ma_gnuci.sql`, а session scope и access audit — `0010_outstanding_cargill.sql`. Обе прошли apply/rollback на одноразовом PostgreSQL 16 CI и не применялись к production. Нельзя выпускать auth-код до проверки `backup → restore → apply → session/CSRF/scope/audit smoke → rollback` на восстановленной репрезентативной sandbox-копии.

Безопасный порядок для sandbox:

1. проверить, что `DATABASE_URL` указывает только на sandbox;
2. проверить отсутствие production bank/Alfa secrets;
3. запустить typecheck и build;
4. проверить план миграций на копии;
5. запустить API;
6. искусственно проверить, что ошибка миграции останавливает runtime до listener/polling;
7. применить migrations `0009` и `0010` только к восстановленной sandbox-копии;
8. проверить `/api/healthz`, login, lockout, session expiry/revocation, CSRF, audit allow/deny и отрицательные cross-scope сценарии;
9. удалить по одной обязательной column/index/journal-записи только в одноразовых копиях и подтвердить, что API не начинает listen/polling;
10. проверить website lead: injected mid-write failure → полный rollback → retry → ровно один raw и один lead; тот же key с другим payload → `409`;
11. проверить rollback companions `0009_auth_security.down.sql` и `0010_auth_scope_audit.down.sql` вместе с возвратом к предыдущей версии кода;
12. после rollback `0010` потребовать повторный вход всех accountant/viewer: отозванные migration sessions не восстанавливаются удалением columns;
13. проверить, что non-owner business routes возвращают `403`, пока predicates не зарегистрированы;
14. отдельно проверить callback-контракты, provider authentication, replay и idempotency.

До guarded migration legacy bank config после backup, ротации credentials, удаления недоступного legacy sync/debug code, scoped handlers, callback authentication и проверки на восстановленной репрезентативной sandbox-копии запрещены production/Replit release, постоянный live AlfaCRM/банк/БД sync, polling и персональные/зарплатные данные.

## Agent preview и Sites checkpoint

1. Запустить `sites-preview start "$PWD"`.
2. Открыть только `http://terminal.local:4173/` в cloud browser.
3. Проверить desktop и mobile viewport.
4. Проверить навигацию, CTA, фильтры и drawer.
5. Исправить найденные проблемы.
6. Запустить checkpoint через Sites lifecycle CLI.
7. Дождаться terminal deployment status.
8. Главный агент напрямую подтверждает точные `project_id`, `version_id`, `deployment_id`.
9. Пользователю передаётся только подтверждённый owner-only URL.

Release evidence хранит immutable связку `commit_sha → Sites version_id → deployment_id`. Оpaque Sites IDs нельзя придумывать или записывать до ответа Sites.

### Provenance package

Для каждого gate Создатель передаёт Ревизору и Координатору один пакет:

1. local commit и `git rev-parse HEAD^{tree}`;
2. private PR number, draft/state и remote head;
3. tree remote head; он должен совпадать с local tree;
4. CI run ID, его head SHA и terminal conclusion;
5. скачанный immutable CI artifact `arthello-provenance-<run_id>` с `head_sha`, `tree_sha`, source archive digest и deterministic Sites artifact digest;
6. Sites project/version/deployment IDs, source commit/digest, terminal deployment status и подтверждённый owner-only access;
7. результаты agent preview для desktop/mobile и проверенных переходов.

Workflow обязан checkout-ить `${{ github.event.pull_request.head.sha }}`, а не synthetic merge ref, и завершиться ошибкой при несовпадении `HEAD`. Local и remote commit SHA могут различаться только при отдельной Git Data history; в этом случае равенство tree обязательно подтверждает immutable CI artifact. PR body обновляется после terminal CI и Sites deployment и служит только индексом внешних evidence, а не доказательством. Ревизор повторяет сравнение независимо.

Зафиксированный исторический пакет v10:

```text
local commit  8735824a214e980ff9cb492fa7253959ab6c2123
local tree    b3ede5bc05cd8685b64031f80db8fc9bbd6ad799
remote head   7f175fa7f14a55b0f329b95a6f63d326682ec113
remote tree   b3ede5bc05cd8685b64031f80db8fc9bbd6ad799 (claimed; independent tree evidence absent)
PR            #1, open/draft/unmerged
CI            run #8 / 30163177884 / success
Sites version appgprj_6a626e9e441481919bb30eee8ba97165~appgver_71ff653bbc548191b1b138dec8eaa332
deployment    appgdep_6a64d3b5e134819193ba100f503db92d / succeeded
```

Это исторический predecessor candidate цикла 3. Актуальная candidate chain всегда берётся из нового CI artifact + Sites metadata + позднего PR index; ни один SHA внутри source не называется «текущим». Любой такой пакет разрешает максимум owner-only обезличенный checkpoint и не является production gate.

## Backup перед production-миграцией

Production backup пока не выполнялся: доступ отсутствует.

Обязательный порядок:

1. зафиксировать точный commit и migration set;
2. остановить write jobs или включить контролируемое окно;
3. создать provider snapshot;
4. создать зашифрованный logical backup схемы и данных;
5. записать snapshot ID, checksum, время, размер и ответственного;
6. восстановить backup в изолированный sandbox и выполнить smoke test;
7. подготовить forward-fix и rollback SQL;
8. получить Reviewer и Coordinator gate;
9. запросить отдельное разрешение владельца;
10. только затем выполнять production migration.

## Rollback

- Код: возврат на предыдущую проверенную immutable version, без `git reset --hard`.
- Sites: развернуть ранее сохранённую проверенную version через разрешённый Sites workflow.
- БД: использовать заранее проверенный rollback для обратимой миграции или восстановление snapshot для необратимой.
- Migration `0010`: rollback не восстанавливает отозванные non-owner sessions; accountant/viewer проходят повторную аутентификацию.
- Интеграции: отключить scheduler/connector, сохранить raw события и не удалять их.
- После rollback повторить контрольные суммы и smoke tests.

## Инцидент с утечкой секрета

1. немедленно отключить соответствующий connector;
2. отозвать и перевыпустить token/client secret;
3. проверить Git, logs, DB audit и deployment artifacts;
4. удалить секрет из доступных runtime stores безопасным способом;
5. определить затронутые данные и временной интервал;
6. зафиксировать инцидент и remediation;
7. не возобновлять синхронизацию до проверки.

## D081 — Продолжение защищённого выпуска кандидата

Этот раздел относится только к R9/PR377 и D081; исторические запреты/описания других выпусков не переиспользуются как актуальная инструкция.

При отказе до candidate auth boundary действует прежний проверенный pre-public rollback. После boundary не восстанавливать snapshot, не удалять candidate/rollback volume и не открывать непроверенный public route. Штатные auth/SSO записи ArtHello и независимое состояние School сохраняются.

Если protected job завершился с проверенным candidate-maintenance hold marker, current main/source не изменился и public/bank activation не начинались, допустим только защищённый rerun failed jobs этого же run. Controller заново проверяет предыдущий job graph, durable context, оригинальные routes/nonce/School repair, exact runtime/volumes/networks/mounts/backup; затем продолжает полный candidate browser и public activation. Файлы продолжения должны переживать очистку RUNNER_TEMP. Смена source, неизвестный route/state или начавшийся public marker блокируют этот путь.

Если условие продолжения не выполнено, требуется конкретный новый проверенный forward-fix с сохранением текущей БД. Не использовать старые R1–R8, ручную подмену receipt, смену роли сотрудника, отключение sandbox или snapshot restore для обхода отказа. Разрешение на исходный выпуск уже предоставлено владельцем; новое общее согласование не заменяет техническую проверку.

Результат считать готовым только после actual candidate PASS, публичного повторного прохода и исходной бизнес-приёмки. Успешный локальный тест/CI или ручной вход владельца не являются таким результатом.

Уточнение идентичности 2026-09-09: пока кандидат PR377 проходил проверки, main обновился с 582edaf1a66a953edb2d61e03040d1a13e70a0ad до 59372b139fb0b2345cf3e41fc23c8223099b187f (checked PostgreSQL migrations), заняв D-080. Решению этого выпуска присвоен следующий свободный номер D-081. Технические имена файлов d080-*, схемы и маркеры ARTHELLO_D080 сохранены как неизменённые идентификаторы проверенного протокола; они относятся к D-081 и не запускают миграции PostgreSQL. Префикс активации нового выпуска — D081: guarded R9. Все изменения другого участника сохранены; R9 собирает отдельный v52 runtime с D1 и не выполняет deploy/api-entrypoint.sh или SQL0018.


## D084 — R10 и штатный домен общего шлюза

R10/PR379 продолжает D081 только после доказанного pre-auth abort R9 и D083 read-only причины. Frozen R9 не перевзводить. Перед маршрутизацией получить private gateway evidence из конкретного Caddy; не подставлять домен в реальный Caddyfile. Этот файл привязан к durable context/receipt, его нельзя пересоздавать для обхода отказа. При смене gateway ID/image/domain/main config продолжение блокируется.

До нового import допускается только точный unused recoverable R9 browser image из DECISIONS D084, без force/prune и без application image/volume удаления. Capacity проверяется после этого штатно.

Сохранены полный runtime/route/hash/backup/current-main gates и порядок maintenance → real candidate browser → public → повторный browser. Если same-source R10 остановился после auth с проверенным maintenance hold и до public/bank activation, разрешён только предусмотренный controller rerun failed jobs с новой проверкой всех evidence. Неизвестный исход или public boundary требуют отдельного проверенного forward-fix с текущей БД; snapshot restore и подмена receipt запрещены. Результат не считать готовым до всей исходной бизнес-приёмки.


## D085 / R11: продолжение после pre-auth cleanup failure R10

Run34322039891/job102371510204 остановился после Caddy134 PASS и ARTHELLO_TARGET_CADDY_FIXTURE=VERIFIED на удалении test-fixtures. Не повторять R10 как новый кандидат и не считать fixture PASS выпуском. В R11 используется новый helper, который перед удалением возвращает право записи только собственным обычным каталогам текущего fixture; частичная подготовка допускается, подмена/symlink запрещены.

R11 PR380/префикс `D085: guarded R11`/parent2e57dd22 запускается после exact CI с дополнительным d085-candidate-tests. Frozen R10/R9/V52 и D083 state/browser/backup/public протоколы не редактируются. Новый guard доказывает полный R10 pre-auth abort; fresh capacity и прежний точный R9 retirement остаются, удаление иных образов не добавляется. Изменять main во время protected run нельзя. При held-candidate resume действуют все прежние identity/runtime/route/backup проверки; после auth/public rollback snapshot не допускается. Результат принимать только по реальным evidence шагов; все исходные бизнес-проверки вести отдельно.


## D086 / R12: ёмкость после R11 pre-import abort

R11 run34324235442/job102378379405 завершился insufficient_import_space/exit2 до download/import, при5807140KiB свободно против7995084KiB необходимо. Его replay доказательство закрепляет весь граф и отсутствие поздних шагов. R12 PR381/префикс D086: guarded R12/parent e579a20a сохраняет старые workflows и Quality; отдельный Verify ArtHello R12 continuation с d086-candidate-tests обязателен по exact main вместе с прежними gates.

Новый helper deploy/browser/retire-r10-images.mjs не принимает CLI targets и может удалить только immutable unused R10 browser44ef654e после повторных source/tag/role/UID/fingerprint/no-consumer/current-main/recovery-artifact проверок. Application image не является целью. Подмена/ошибка/consumer/истёкший artifact — blocked. После удаления или доказанного отсутствия новый замер обязан удовлетворить прежнюю capacity с резервом2GiB; иначе остановка до archive download. Дальнейший исходный capacity step также остаётся обязательным. Main во время protected run не менять. Full authority/target/evidence: DECISIONS D086.

Не возвращать отклонённую mutable-tag очистку application image, не понижать reserve, не подменять новый browser старым. Не выдавать освобождённое место за принятый выпуск. Требуются фактические candidate и post-public browser outcomes, backup evidence и отдельная исходная бизнес-приёмка. До actual accepted live source банковский PR371 и visual runtime pin остаются закрытыми.

## D087 / PR371 — Счётчики банка после accepted public release

1. Дождаться terminal outcome защищённого выпуска и проверить фактические candidate/post-public browser, public runtime и backup evidence. Не менять main во время protected run. Accepted source заполняется только по этой связке: `77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed` / tree `ac3fcaac06acf33bf9ee32e438d0c040adb38fd7` / image `sha256:5a39c36001cb79abe6d0bc8d691275b58cdec5456e7d13d95fc717eba6702284`, release run `34326582961`, deploy `102386111240`, outcome `success`; evidence [R12 protected release](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34326582961). Если факт не подтверждён, `EXPECTED_LIVE_SOURCE_SHA: ''` остаётся пустым.
2. Обновить PR371 от свежего main, сохранить исторические документы и Quality, проверить номер D087. Перенести только рассмотренные шесть code/test overlays и две workflow proposals. В PR заменить устаревшие 23 tests на ранее подтверждённые 57: 26 aggregate, 27 metadata/consumer, 4 launcher. Это локальная история проверки; для rebased PR-head/main нужны собственные exact-source hosted evidence. Повторять локальные тесты при конкретно изменившейся зависимости или коде, не вместо проверки provenance.
3. Закрепить `EXPECTED_LIVE_SOURCE_SHA` за фактически принятым приложением. `CHECKED_SOURCE_SHA` оставить значением из события для кода диагностики. Исправить устаревший комментарий workflow о R10 на актуальное основание. Не подставлять диагностический merge SHA как live source: этот PR не публикует приложение.
4. Сохранить owner/repository restrictions, первый attempt successful Quality push-main, `production-ru`, обе блокировки `gateway-38-55-arthello-production` и `school-1-11-production`. Merge title обязан начинаться **`D075: read-only production data`**; номер решения D087 не заменяет технический trigger. Hosted workflow называется `Verify bounded production data diagnostic`; protected job повторяет целевые тесты и проверяет current main перед исполнением checkout.
5. В protected job runtime observer должен подтвердить точное опубликованное приложение и его штатный R7 backup worker, immutable image/source/tree, приватный контекст и текущий public route. Затем проверяются активная D1 и ограниченный UID1000 helper с read-only/no-copy volume, без сети, secrets или RW mount. Неизвестное состояние, дополнительный работающий consumer, несовпадение выборки после probe или deadline блокируют завершение. Удаляется только собственный временный helper.
6. Сохранить безопасные `READONLY_LIVE_SOURCE`, `READONLY_IMAGE`, `observedAtUtc`, JSON status и фактический terminal outcome. `READONLY_BACKUP=exact_readonly_consumer_history_not_verified` сообщает только о допустимом worker. `READONLY_FINISHED=aggregate_observation_not_live_acceptance` и `bounded_checks_complete` не заменяют исходную бизнес-приёмку. При `incomplete_or_issues`/blocked сохранить фиксированную причину; не исправлять её resync/SQL writes в диагностическом job.
7. Интерпретировать счётчики по фактическому периоду `2026-09-01`…UTC-дата наблюдения. `accountsWithContainingStatementInLatestRun` показывает включение периода последней готовой выпиской, но не заменяет точное окно и совпадение количества операций. Четыре содержащие выписки сами по себе не дают `checksComplete`. Production launcher не передаёт `syncNotBefore`; `freshness=not_requested` оставляет fresh-resync proof открытым. Суммы, ДДС, банковская полнота и финансовое соответствие не проверяются.
8. После отчёта дополнить acceptance note и PR evidence index действительными source/run/time/counts и следующим проверяемым шагом. Продолжить отдельную сверку денег/ДДС и остальные исходные бизнес-сценарии в их разрешённых границах. Браузерный PASS, выборочный AlfaCRM, обращения, роли и manual/automatic backup доказательства учитывать раздельно по фактическим результатам.


## D088 — Различить замечания данных и отказ probe

D087run34328837388/job102392362747 получил valid incomplete_or_issues snapshot с4счетами/12statement records/0операций иpending sync, но launcher послеexit2 пропустил повторный observer. Не называть это подтверждённым timeout или ошибкой банка. D088 сохраняет diagnosticExitCode2 для замечаний, проверяет ограниченный JSON, затем завершает финальную сверку consumers для валидных complete/incomplete отчётов. Data issues не становятся зелёным финансовым PASS.

Новый schedule/retained-job metadata section читается только из сохранённого canonical D1; dates/status/counts не содержат IDs/credentials/денежных значений. Различать actual bank_statement_imports status и retained-job providerStatus:not_stored; scopeMatch:unverified не трактовать как current-scope. Setup/nextAt/lease и latestsync timestamp помогают определить, чего ждёт уже установленный scheduler. Не выполнять банковские запросы или resync в этом read-only job.

Запуск — прежний owner-controlled merge с D075: read-only production data prefix после exactCI; source checkout диагностики отличается от acceptedlive77f. Environment/locks/mounts/deadlines/Quality остаются прежними. После terminal outcome сохранить весь валидный ограниченный отчёт, фиксированный READONLY_RESULT, marker финальной сверки и exitcode. Приincomplete продолжать по фактам, приblocked сначала выяснять конкретное ограничение. Main не менять во время protected observation. См.DECISIONS D088; visuals вынесены в отдельное D089 и не смешаны с этим изменением.
