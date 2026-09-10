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


## D089 — Визуальная проверка Content/Tasks принятого образа

После завершения D088 protected observation обновить main reference. Review/merge новых семи source/workflow файлов и append-only записей; merge title начинается D089: hosted Content Tasks visual. Тогда existing source job и first-attempt owner/main push запускают hosted visual job. Ручной workflow_dispatch остаётся доступен owner наmain. Не менять main во время банковского protected job.

Runtime отдельно закреплён за accepted R12 source77f26ec9/treeac3fcaac/run34326274447; runner checkout может быть более новым. Workflow перепроверяет producer/artifact, launcher — inner archive/source hashes/fingerprint. Исполнять только на GitHub-hosted runner с новым пустым volume и синтетической учёткой. prepare-visual-fixture.mjs удаляет auth records и никогда не применяется к рабочим данным. Ожидаются14 PNG+manifest+scoped-result+evidence. Частичные картинки при failure не являются PASS.

Проверить реальное отображение, отсутствие обрезки/переполнения и Task «Задача №801» в двух размерах. Результат относится к принятому image snapshot и синтетическим данным. Form persistence, backend content generation, delivery/права и банковская приёмка остаются отдельными доказательствами. Подробные пути, artifact checksum и ограничения — deploy/v52/visual/CONTENT_TASKS_HOSTED.md и DECISIONS D089.


## D090 — CSRF-запросы мастера AlfaCRM

Переносить после D089 на актуальный main, сохраняя полную историю D088/D089. Code/test scope — одна строка `deploy/v52/overrides/app/components/AlfaCrmSetupWizard.tsx` и новый `deploy/v52/overrides/tests/alfacrm-csrf-contract.test.mjs`. Серверный auth не изменять; не добавлять приём legacy header/cookie и не включать импорт.

Локальная команда: `node --test deploy/v52/overrides/tests/alfacrm-csrf-contract.test.mjs`. Зафиксировано RED 1 failure / 5 tests (`csrf_denied` на валидной canonical cookie), GREEN 5/5 и независимый review. Fixture выполняет реальный sender/cookie reader и неизменённые серверные cookie writer, CSRF verifier и origin guard; DB, upstream и production не вызываются. Повторять targeted tests при изменении кода или зависимости. Hosted полный build/test aggregate и exact-source CI пока pending; новый тест входит в прежний application `tests/*.test.mjs`.

После проверенного выпуска наблюдать обычный запрос мастера через настоящую сессию, не подменяя UI ручным добавлением токена. Проверить принятие корректной CSRF-пары и сохранение остальных отказов. Отдельно учитывать connected/importEnabled и разрешения; открытие wizard может создавать lazy schema, preview пишет state/audit, import пишет данные. Эти действия не являются read-only диагностикой и не выполнялись в D090 preparation. Направление финансовых операций и import-enable gate не меняются; успешный CSRF не объявлять приёмкой upstream или импорта. Evidence — acceptance note `docs/acceptance/2026-09-09-d090-alfacrm-csrf.md`.


## D091 — Различить сохранённые результаты scheduler

После D088 читать дополнительно autosync.httpStatus/httpStatusState/updatedAtUtc. Выводить только целый HTTP-код 100–599 или null и фиксированный статус качества поля. Это сохранённый результат callback scheduler, а не доказанный HTTP-ответ банка. В частности, 500 может обозначать исключение на любом этапе до возвращения ответа. Не читать и не печатать произвольный connection config или исключения.

Запускать прежним D075 merge prefix после review и CI; main сохранять неизменным до terminal protected outcome. Accepted live по-прежнему 77f26ec9. Записать source/run/job, валидный bounded JSON, READONLY_RESULT и READONLY_FINISHED. Exit 2 при incomplete_or_issues означает завершённое наблюдение с замечаниями. Не выполнять принудительный resync в диагностике. D088 facts: две ошибки, следующая попытка 09:01:16.902Z, операции отсутствуют; D091 пока не имеет фактического результата.


## D092 — Собрать читаемый hosted browser context

Исходный отказ D089: run `34331175805` / job `102399900660`, head `3632008d57f149b9e300b22f502e6dc48a5326ac`. Application artifact/import, pnpm install и Docker build прошли; browser smoke завершился `ERR_MODULE_NOT_FOUND`. Fixture не достигнут, artifacts/PNG отсутствуют. Не повторять неизменённый job как доказательство исправления.

Подготовить собственный временный context только из восьми frozen browser inputs принятого R12. Установить locked package через pnpm `11.7.0` с локальным `umask 022` и copy import. Перед permission normalization проверить, что ссылки не dangling и не выходят из context, а специальные файлы отсутствуют. Нормализовать права только собственного public context: файлы читаемы, каталоги доступны для обхода браузером UID1000 после root-owned Docker COPY. Не менять исходный checkout, общий store, global `umask 077`, secret files, application pin или Dockerfile.

Одного `umask 022` недостаточно: реальная установка под `077` создала `0700`/`0600`, а cache может вернуть `0600` при следующей установке. Symlinks в локальном воспроизведении были внутри context. Проверка UID1000 здесь недоступна (`OS EINVAL`), Docker отсутствует. Четыре assembly regression tests PASS с реальным pnpm `11.7.0`: relocation и импорт `playwright-core` работают после удаления install context; private modes обнаруживаются, unsafe links/shared hardlinks отклоняются до chmod, `077` восстанавливается. Фактическую image/UID1000/Chromium проверку учитывать отдельно: она ещё не выполнена.

После review и требуемого exact-source CI использовать прежний технический prefix `D089: hosted Content Tasks visual` и прежние owner/main условия. Main не менять до terminal outcome активного protected банковского job. D092 не требует нового production release: application source остаётся accepted R12 `77f26ec9` / tree `ac3fcaac` / producer `34326274447`. Следующий критерий — успешный hosted smoke, затем полный scoped run с 14 PNG, manifest/scoped-result/evidence и просмотром изображений. До этого visual status — failure/not accepted; live content, persistence, numbering rules и банковская полнота не доказаны. Подробный scope — DECISIONS D092 и `docs/acceptance/2026-09-09-d092-browser-assembly.md`.


## D093 — Собственные обращения и backup denial через настоящую сессию

После D092 main `b4c39d5af8ab348882759c48c0f82dbe810a8065` использовать отдельный `check-arthello-employee-controls.yml` с prefix `D093: employee controls`. Перед публикацией сверить точный manifest и четыре документа. Канонические D076 workflow/flow/smoke/test должны byte-for-byte совпадать с базой: R8/R9 recovery contracts сравнивают bundle с этими bytes. Первоначальный PR387 прошёл собственный browser fixture, но не frozen contracts; новый standalone source должен пройти все CI. Сохранить owner/Quality/main, production-ru, gateway/School locks, точный checkout, sandbox, единственный обычный login и текущую сетевую политику. Требуются hosted policy/retirement tests и настоящий image/UID1000/Chromium smoke. Локальные 74 browser/retirement/canonical PASS и reviews не являются live evidence.

В настоящем employee flow: открыть «Разработчикам» → проверить own-list GET и диалог → «Мои обращения» → дождаться aria-busy=false без ошибки и без «Все обращения» → закрыть → GET `/api/settings/backups` с redirect:error, требовать 403. Не читать/печатать response body, не заполнять и не отправлять обращение. Own-list GET может лениво инициализировать schema; не называть эту навигацию D075 strict read-only. Отдельно записать четыре фиксированных result flags, сохраняя прежние SSO/Education/School/navigation результаты. Отказ backup подтверждает только запрет для этого сотрудника, а не состояние резервных копий или полный набор прав.

Перед download/import новый workflow выполняет только fixed R12 browser retirement с размерами нового bundle; канонический D076/R8 workflow не меняется. При отсутствии fixed ID/tag пропустить удаление; при наличии требовать свежие identity, unused и recoverable-artifact проверки, удалить только immutable browser ID без force/prune и повторно измерить capacity. Не удалять app/containers/volumes и не ослаблять guard при истёкшем artifact или нехватке места. Current main держать неизменным до terminal result и финального current-browser cleanup. Зафиксировать source/tree/run/job и проверяемый bounded JSON. Если smoke, identity, result или cleanup не подтверждены, оставить этап незавершённым. Контракт — DECISIONS D093 и `docs/acceptance/2026-09-09-d093-employee-controls.md`.


## D094 — Наблюдать этап банковского сбоя

После включения четырёх D094 application/test overlays в новый verified release дождаться обычного scheduler tick по сохранённому расписанию. Не обходить backoff, не менять selected scope/даты, не вызывать service capability вручную и не выдавать наблюдение за resync. D094 в main сам по себе не меняет live R12.

D075 fixed report дополнительно читает autosync.failureStage/failureStageState. При missing этап неизвестен (в том числе старый runtime); при invalid значение не выводится; observed допустим только для outcome=error и одного из 11 закреплённых имён. Сопоставлять его с accepted app source/image, updatedAtUtc и завершённым read-only отчётом. HTTP500 означает сохранённый callback status, а не доказанный ответ банка. Сохранять прежние checksComplete, exit2, оба consumer observations, canonical D1 identity и отсутствие raw financial/credential data. Причину исправлять после фактического результата; ноль operations и исторические READY imports не объявлять полноценной загрузкой.


## D095 — Проверить формат номера задачи

После нового выпуска проверить единый `Задача №0001`/`№0801` в очереди, карточке и drawer, сохранив открытие того же raw ID. До нового runtime фиксировать статус prepared, не live PASS. Старый D089 visual adapter работает с accepted R12 source77f и literal№801; новый padded visual expectation требует нового закреплённого artifact/runtime. Модуль10000 и поиск по raw ID не меняются и не объявляются исправленными.


### D092 — Диагностика уже сохранённого visual artifact

После D092 smoke PASS / scoped BLOCKED читать existing artifact10096640452 через новый owner push-main workflow с prefix `D092: inspect existing visual evidence`. Сначала exact current head и fixed unexpired producer/artifact metadata, затем ordinary GET и frozen ZIP reader. PR только проверяет исходники; никаких production permissions или UI rerun. Результат даёт ограниченный stage/result/completedCaptures/archive PNG count; произвольная ошибка и содержимое PNG не выводятся. Проверка receipt не равна визуальному просмотру или полной UI приёмке. Полный контракт — READ_EXISTING_EVIDENCE.md. При отказе identity/digest/схемы оставить stage неизвестным и не ослаблять границы.


### D092 — Исправить неполную модель прав в synthetic workflow fixtures

Existing receipt прочитан в run34337932856: tasks-empty-390x844,2 capture records,4 PNG entries; изображения не просмотрены. Scoped adapter дополняет verified frozen overview/detail fixtures точным permission shape synthetic OWNER. Полный harness, UI assertions, old R12 runtime pin и №801 остаются прежними.

После exact-source CI и независимого review использовать существующий технический prefix `D089: hosted Content Tasks visual` для одного обусловленного исправлением hosted запуска. Не менять main до результата. Фиксировать реальный completed stage/PNG inventory/task-number assertion; screenshot inspection и save persistence отмечать отдельно. Если вновь BLOCKED, читать конкретный новый receipt и не ослаблять проверку. Полный контракт и ограничения — docs/acceptance/2026-09-09-d092-workflow-fixture.md.


## D096 — Продолжение после работающего R12

Запускать новый R13 только с закреплённым merged PR/current main и успешными exact-source Quality, Proof, V52, R12 и R13 gates. Успешный R12 run34326582961 — исторический baseline; actual fresh live identity проверяется отдельно. Пока protected run активен, main не менять. Не перезапускать старый R12 и не использовать его rollback snapshot как свежий.

Сохранять accepted backup worker/history/control. Проверять полный phase-specific canonical consumer inventory, включая только доказанного остановленного historical predecessor. До cutover — свежий snapshot. До copyback — containment, worker quiesce, actual verify-copyback, точные stopped/restart-no consumers; затем доказанное восстановление reader. Перед candidate-state begin sealed adoption digest связывается с private context; ошибка или потенциально записанный seal запрещает очистку/restore. После authentication/public-start любые старые data restores запрещены.

Candidate и after browser проходят через новый expected-ID wrapper вокруг неизменённого natural browser harness. New RELEASE_SHA остаётся новым source; accepted77f используется только в fresh baseline. Actual result и image/source/container identity сохранять как bounded receipts, без diary content, password, callback URL или raw financial errors. После R13 дождаться обычного банковского запуска и читать D094 stage только при новом observed error; не форсировать backoff/leases. Отчёт о выпуске отдельно указывает опубликованную версию и незавершённые бизнес-критерии.


## D075 — Read-only наблюдение после принятого R13

Accepted live-source pin — `f5fa3e46e3510e6fc98ae4455f4b499c0ba30695`, tree `3f49b1b7c0e3ed6dfdaaafbccc071386c9b5edde`: protected run `34340461537` / attempt `1`, deploy job `102430586207` завершён SUCCESS в `2026-09-09T10:35:58Z`. Candidate natural acceptance — `10:35:33.120Z`, after-public — `10:35:51.449Z`. Новый consumer proof закрепляет actual run/resource attempt/accepted attempt, image/fingerprint, candidate ID и context SHA256 из принятого receipt. Это release evidence; нового D075 наблюдения ещё нет. Новое D-решение в этой технической подготовке не назначено.

Для точного source R13 launcher вызывает отдельный read-only consumer proof: public-started R13 context и D063 activation, фактический public gateway, sealed adoption и прежний R12 backup worker, полный canonical inventory с только доказанными stopped predecessors. Старый D083/R12 proof не меняется; отказ нового не вызывает fallback. До и после прежнего read-only DB report требуются одинаковые bounded identity/proof receipts. Current diagnostic `CHECKED_SOURCE_SHA` — отдельный будущий merge SHA; его нельзя подменять accepted-live source.

После независимого review окончательных pins и CI использовать прежний merge prefix `D075: read-only production data`; main сохранять неизменным до terminal protected outcome. Зафиксировать diagnostic source/run/job, accepted R13 proof, autosync nextAtUtc/leaseState/updatedAtUtc/outcome/httpStatus/failureStage и качество полей, bounded financial coverage и READONLY_RESULT/READONLY_FINISHED. Сохранённый backoff, включая возможные два часа, не сбрасывать; ждать обычный scheduler tick. HTTP500 остаётся сохранённым callback status, а не доказанным ответом банка. Exit 2 при incomplete_or_issues — завершённое наблюдение с замечаниями, не полная банковская приёмка. Никаких retry, resync, SQL-записей, quiesce/restore, сообщений или денежных действий.


## D098 — Выпустить исправление Точки после принятого R13

PR398: `codex/arthello-r14-20260909`, parent `e74e41d9b6d49f8854e8ad50b0cffc0a6b2cde80`, технический merge prefix `D098: guarded R14`. Перед merge проверить exact-head Quality, Proof, v52 и три jobs R14 (архивные R12/R13 contracts плюс текущий R14). Во время protected run сохранять main до terminal result и cleanup.

Проверить fresh R13 live baseline и исторический run34340461537 отдельно; сохранить R12 backup worker, receipts и историю. Два остановленных predecessors допустимы только с точной отдельной provenance каждого. Пройти capacity, recoverable exact-browser retirement, свежий snapshot/adoption, natural candidate и after-public acceptance. При неоднозначном seal/auth/public boundary не восстанавливать старые данные. Account-scoped unique index после отката кода не сужать; новый R13 IF NOT EXISTS его не заменяет.

После фактического выпуска закрепить новые source/tree/image/run/job/container и public context для read-only D075. До этого old R13 diagnostic не является наблюдением R14. Дождаться обычного банковского запуска по сохранённому nextAtUtc, не сбрасывать backoff и не вызывать service key вручную. Проверить четыре выбранных счёта, период с 2026-09-01, bank/finance counts, суммы, отсутствие дубликатов и broken links; при error разрешён только фиксированный commitFailureKind без exception text. До этих доказательств задача Точки остаётся открытой.



## D101 — Порядок нового R15 после остановленного R14

Не повторять R14 run34391105865. Для PR404 требуется final SHA/tree/diff review, exact-head Quality/Proof/V52 и четыре jobs `Verify ArtHello Tochka continuation`. Merge только с prefix `D101: guarded Tochka R15`, parent `9862a6e863d4d791c00ddeaba9480154ad5b8c4d`; затем неизменный main до terminal protected run и cleanup. Старый R14 YAML сохранён побайтно в `deploy/v52/recovery-r15/r14-controller.yml` и восстанавливается лишь в историческом fixture.

Новый ZIP downloader проверяет exact producer/owner/main/attempt1, artifact identity/expiry/size/digest и три ordinary members до extract. Отказ выдаёт фиксированный stage/reason; не выводить URL, API body, исключения или секреты. Разрешены только ограниченные network retries до import. Старые image/gzip/evidence/fingerprint и все downstream guards неизменны. При отказе читать actual terminal graph и bounded receipts, не обходить проверку и не публиковать недоказанный кандидат.

Retirement касается только unused R14 browser image `sha256:19a8671fd03ba31bcfc3ddc7d479dceeabcfbcb836b61bfa7fda17fbf8f77f1a`, дважды доказанного recoverable artifact10119716232 (expiry 2026-09-11T18:48:33Z), затем свежая capacity. При ином consumer/alias/identity/expiry отказ; app/volumes/history не удаляются. R13 baseline, School и R12 healthy backup обязательны. После potential seal/auth/public start старую БД не восстанавливать.

Фактический successful R15 фиксировать source/tree/run/resourceAttempt/acceptedAttempt/image/fingerprint/container/context, candidate/after-public, School/backup. Лишь после этого адаптировать и закрепить actual pins в PR399, выполнить final review/CI, затем D075 текущим защищённым read-only путём. Bank nextAtUtc не сбрасывать. Завершение — четыре счёта, полное окно с 01.09, реальные операции и копеечная сверка ДДС без дублей/потерь/общих связей. CI и выпуск не заменяют эту приёмку.


### D101 — Обязательный squash после отказа первого R15

Актуальное продолжение — PR405, branch `codex/tochka-r15-squash-fix-20260910`, parent `bd3553187c6adcda3e0be1586b25c9c3b61dc3de`, prefix `D101: guarded Tochka R15`. После final SHA/tree/diff review и exact-head Quality/Proof/V52/четырёх continuation jobs объединять только с `merge_method: squash` и `expected_head_sha` окончательного head. Обычный merge с двумя parents не соответствует неизменённому provenance gate. Сразу после merge свежо проверить verified signature, ровно одного parent (указанный SHA), точное reviewed tree и actual current main. Сохранить main до terminal нового protected run/cleanup.

Первый R15 run34443217193 attempt1 terminal failure06:00:42Z: identity/history PASS, provenance отказ до checkout/import/cutover, cleanup PASS. Fresh commit metadata signature=true, parents=2; исходный jq gate требует parents=1. Не повторять этот source/run, не переписывать историю и не менять gate ради двух-parent commit. Новый PR добавляет явный mergeMethod=squash и регрессию на actual public commit metadata; synthetic допустимая форма не является production receipt. Все data/backup/School/auth/capacity boundaries прежние. Банковская приёмка остаётся открытой.


## D102 — Read-only сверка принятого R15 и банковских сумм

После явно разрешённого владельцем штатного ручного запуска получить новый D075 report, даже если старый automatic nextAtUtc ещё впереди. `latestRun.status/failureKind` относятся только к последнему сохранённому non-dry-run Точки; `autosync` остаётся отдельной историей scheduler. Generic `statement_read_unclassified` не означает 401/403, не раскрывает фактический HTTP status и не доказывает ошибку банка вместо transport bridge. Сопоставить время запуска, retainedJobs, imports и bank/financial counts. Не повторять ручной запуск или менять ключ только по generic message. Вести дальнейшее исправление по наблюдённым фактам; никакого автоматического обхода lease/backoff.

Accepted runtime: source `4a0713b4a7d87f132e49836fe0ce9ca9258bc1ec`, tree `ac0ec2a2845eee6254ba7cf8c0e0b83d0e5848de`, run `34445017241`, attempt `1`, image `sha256:0f15a32c9dff9cd7278a1449bd66f282abc514f0392edfd57262ed25ef247a6f`, runtime fingerprint `b64e4dcb206ded758f4c636c74bf42588961f2a88e044689207e9dda7939274e`. Candidate `3b81e98433e7d948d899fcfc1a9e94ee15faa3ef17cb1d1d4d1cb5c371ff67c7`, context `9c4ef4d58a8a7d97835bc1f8f00cc4aad44849a8cd62b7bcd4869cce247d96ca`; candidate acceptance `2026-09-10T06:29:36.391Z`, after-public `2026-09-10T06:29:53.317Z`. School source/health and sealed R12 backup adoption verified in the same successful job.

Обновить draft PR399 от точного current main, сохранить materialized source и frozen release history, заменить занятый номер D099 на D102 и закрепить actual pins. После review окончательного SHA/tree/diff и exact-head Quality/Proof/V52/diagnostic CI объединить с prefix `D075: read-only production data`. Main не менять до terminal protected observation. Отчёт принимает банк только при четырёх счетах за окно с 2026-09-01, реальных bank и linked financial rows, нуле дублей/потерь/shared links/mismatch и равенстве income/expense totals в копейках. При будущем `nextAtUtc` ждать ordinary scheduler; force/resync и сброс backoff запрещены.

## D103 — Исчезнувший retained statement

Для нового manual error использовать actual D075 08:53:54.807Z и latestRun 08:35:08.056Z; старый scheduler error не выдавать за новый. Generic message плюс retainedJobs4→3 поддерживают гипотезу 404/410, но не дают точного HTTP или срока хранения Точки. В D103 подготовлен bounded recovery: один replacement только сохранённой ссылки после фактического 404/410, под той же statement lease, с тем же окном и scope. Не сбрасывать pending state SQL-записью и не обходить backoff. Непосредственный вызов банка по service-key запрещён; штатная owner UI-кнопка разрешена прежним поручением.

Перед публикацией source fix: exact-head review/Quality/Proof/V52, current canonical source и R12/R13/R14/R15 historical contracts. R15 source-pins/controller не менять и старый run не повторять. Новый guarded release adapter должен принять actual R15 predecessor и сохранить backup/history/School/snapshot/auth/identity/capacity/public boundary. Пока такого accepted release нет, live остаётся R15. Затем ordinary manual/scheduler sync и bounded D075 по реальным банковским суммам. Подготовленные unit tests не заменяют business acceptance.
## D104 — Выпуск R16 после ручной ошибки Точки

PR408 закреплён на D103 parent `422f32e52b38a8a5b6b942c4ea9d1cef71e15d05`; использовать только squash и prefix `D104: guarded Tochka R16`. До merge проверить окончательные SHA/tree/diff, полный source contract (97 inputs, 31 transforms), exact-head attempt1 Quality/Proof/V52 и все пять continuation jobs. Проверить отсутствие конкурирующих protected runs, затем actual GitHub signed commit, ровно одного parent, tree и fresh main. Держать main неизменным до terminal protected R16 и cleanup; старые R13/R14/R15 runs не перезапускать.

История actual R15 run34445017241, accepted runtime/context, backup R12 и School проверяются до нового cutover. Архив R15 controller и старые helpers/pins сохраняются. Новый history-chain validator добавляет только доказанный R13 predecessor между actual R15 и прежней R12 цепочкой. Любой identity/context/state/mount drift останавливает установку. Retirement касается только точного unused recoverable R15 browser image; отсутствие image не заменяет capacity gate. Ни lock bypass, ни восстановление БД после seal/auth/public boundary не разрешены.

После successful release сохранить actual source/tree/run/resourceAttempt/acceptedAttempt/image/runtime/container/context, candidate и after-public acceptance, healthy backup/history и School. Затем адаптировать существующий D075 read-only consumer к этому actual runtime, review/CI/squash с техническим prefix `D075: read-only production data`, frozen main до terminal report. Обычный owner UI manual sync уже разрешён; не создавать sessions/roles/service-key calls и не менять scheduler state/lease/backoff вручную. Если новая обычная попытка дала ошибку, разбирать только фиксированные failureStage/failureKind/commitFailureKind и bounded facts. UI toast не доказывает точный HTTP и не требует автоматически менять ключ.
## D105 — Прочитать банк на фактически принятом R16

Сначала получить terminal success нового protected R16 с complete job graph, candidate/after-public receipts и cleanup. Сверить source/tree/run/resourceAttempt/acceptedAttempt/image/runtimeFingerprint/container/context, retained healthy R12 backup/history и School. Только actual pins закрепляются в D075 consumer; None, fixtures или старые R15 receipts не допускаются. Проверить полный diff, новые 36 consumer tests и прежние 25 launcher/51 aggregate tests, exact-head Quality/Proof/V52/continuation/diagnostic. Публиковать squash с prefix `D075: read-only production data`, держать main неизменным до terminal отчёта. Existing environment и обе блокировки обязательны.

Не запускать одинаковое наблюдение до новой обычной manual/scheduler попытки. При готовой старой выписке ordinary sync может сначала сохранить её и вернуть pending для нового дня; продолжение проходит через прежний scheduler/lease без SQL reset. Полный успех банка требует текущего окна четырёх счетов, реальных строк и точных равных сумм, нулевых нарушений. При ошибке использовать fixed failureKind/commitFailureKind и свежий timestamp; не восстанавливать HTTP из generic UI текста и не запрашивать новый ключ без доказательства. Сам D075 не вызывает банк и не меняет production.

## D110 — Проверить и выпустить статьи через R17

PR412 публиковать только после реального browser/DB PASS на том же hosted image, просмотра desktop/mobile PNG, review полного SHA/tree/diff и exact-head Quality/Proof/V52/шести continuation jobs. Новый controller проверяет squash parent93cb27839584f7f59d2ef5f1f0ecafc5b6bbd682, PR412 и prefix `D110: guarded finance R17`. Перед merge свежо проверить main и отсутствие competing protected run; затем actual signed single-parent/tree и frozen main до terminal+cleanup. Если база изменилась, сохранить чужую работу, пересмотреть новый adapter и повторить exact-head CI. Старый R16 success не повторять.

После actual R17 сохранить runtime/source/tree/run/attempt/context и candidate/after-public receipts, здоровый backup/history и School. Bound D075 адаптировать только к actual accepted pins и получить агрегированные финансовые инварианты; никакие raw bank/PII не экспортировать. Никаких рабочих тестовых статей, фиктивных платежей или переназначения существующих операций. Синтетический CI не заменяет release receipt.

## D111 — Повторная публикация исправленного R17

D110 terminal failed до изменения production, cleanup success. Новый PR414 — только squash, branchcodex/finance-r17-receipt-fix-20260910, prefix `D111: guarded finance R17`, parenta3ccfb3af2118dc7ebc734d3f994092b7ebc52e2. Проверить exact-head Quality/Proof/V52/6continuation,14contract regression включая исполнение actual accepted R16 receipt inline consumer. После merge проверить actual signed single-parent/tree/main; freeze main до terminal нового R17+cleanup. Не rerun failed D110 или accepted R16. Новый runtime принимается только по actual candidate/after-public/backup/School receipts, затем bound D075 и реальная сверка банка/ДДС.

## D112 — Выпуск после ARTIFACT_INVENTORY

Использовать PR415 / codex/finance-r17-artifact-fix-20260910 / parentc2b29672bb4d42a535ff44ea2b407622282aa0ac / squash prefix `D112: guarded finance R17`. Пройти Quality/Proof/V52/6continuation на final head, review SHA/tree/diff и fresh main/runs; после merge проверить signed single-parent/tree и заморозить main до terminal+cleanup. Exact app+proof inventory не допускает лишние artifacts; application ZIP остаётся с тремя обычными членами и прежними SHA/CRC/path/size/current-main guards. Не удалять failed R17 browser ради удобства; штатный capacity gate решает допустимость. Actual successful runtime receipts затем закрепить в D075, подтвердить реальные банковские суммы.

## D113 — Новый R17 после отказа main Proof

Не менять main1a45eb6aa5b1a9b21c4390105016b8b0e54afef5, пока protected34491463434/cleanup активны. После terminal complete graph review использовать PR416/codex/finance-r17-browser-startup-20260910, squash prefix `D113: guarded finance R17`, parent1a45eb6. Required final-head Quality/Proof/V52/6continuation; actual signed one-parent/tree/main. Затем freeze до terminal нового выпуска/cleanup, actual candidate/after-public/backup/School receipts, bound D075 и сверка банка/ДДС. Перезапуск только hosted Chrome startup ограничен одним новым процессом до любой проверки страницы; это не rerun release/CI и не ослабляет assertions.

## D114 — Read-only проверка accepted R17

После actual successful run34495273615 закреплены sourceff8559254faaedade63a9ee7567a45686d08c13a и фактические pins. Требуются exact-head diagnostic/Quality/Proof/V52/6continuation, review SHA/tree/diff; только squash с prefix `D075: read-only production data`. Freeze main до terminal отчёта. Реальные bank/financial суммы и связи проверять отдельно от optional Alfa findings; raw exports и production writes запрещены.
