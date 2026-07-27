# ArtHello OS — Runbook

## A.11: owner-session verification для exact v28

1. Не открывать live Sites URL во внутреннем cloud browser; для внутреннего QA
   использовать только agent preview.
2. Подтвердить через Sites metadata access `custom`, одного allowed owner и
   отсутствие groups.
3. Подтвердить protected environment revision и совпадение
   `ARTHELLO_OWNER_EMAIL` с sole allowed account, не выводя секреты.
4. Проверить unit matrix: owner identity даёт `200`, missing/foreign identity
   дают `403` для owner summary, employees/payroll, Tochka status, integrations
   и Front Office.
5. Не считать bearer bypass owner session: dispatcher удаляет переданный
   caller `oai-authenticated-user-email`. Служебный browser renderer также не
   является доказательством identity владельца.
6. Передать owner-only live URL владельцу. Владелец открывает его со своей
   разрешённой ChatGPT/Sites учётной записью и проверяет указанные разделы.
7. Если owner device получает `403`, зафиксировать только route, UTC time и
   request ID без ФИО/сумм/токенов; не добавлять fallback auth. Проверить
   redacted Worker logs и актуальность Sites account/environment.
8. До успешной owner-device проверки не объявлять production owner access
   доказанным и не публиковать новый protected snapshot.

## A.10: server-attested snapshot

Безопасный порядок публикации:

1. Exporter подтверждает safety contract и terminal Alfa gate. Full mode допустим только для `full_sandbox_read_only` с полным scope inventory; incremental batch немедленно отклоняется.
2. Publisher канонизирует строки каждого из 14 datasets, сортирует пары `row_key + row_digest`, вычисляет per-dataset digests и общий snapshot digest.
3. `snapshot/begin` принимает exact counts, per-dataset digests и общий expected digest. Произвольный или несогласованный manifest получает `409`.
4. Все chunks записываются только в staging. Каждый stage выполняет transactional guard `status = staging`.
5. Commit атомарно переводит batch в `verifying`; после этого новые stage writes fail closed.
6. Worker повторно читает staged rows, проецирует allowlisted columns, канонизирует, вычисляет все digests и сравнивает их с manifest.
7. Любой count/dataset/payload mismatch получает `409`; прежний active snapshot и live tables не меняются.
8. Только после полного совпадения одна D1 transaction заменяет все live datasets, записывает `computed_digest`, переключает active batch, добавляет audit и очищает staging.
9. Machine status обязан вернуть тот же Worker-computed digest, exact counts, `atomicSnapshot=true` и `attestationStatus=atomic_attested`.

При `activeBatchId=null` интерфейс и API показывают `legacy_unattested` и `atomicSnapshot=false`. Нельзя называть такие rows новым проверенным snapshot. Для повторной передачи реальных ФИО/зарплат нужны независимые PASS/GO, подтверждение `custom / 1 user / 0 groups` и отдельное информированное owner approval.

Production owner verification после deployment:

- sole allowed Sites account и `ARTHELLO_OWNER_EMAIL` должны совпадать;
- owner summary, employees/payroll, Tochka status, integrations и Front Office возвращают `200` владельцу;
- те же маршруты без authenticated identity и с чужой identity возвращают `403`;
- в логах проверки не печатаются identity headers, PII, суммы, токены или банковские идентификаторы.

## A.9: атомарная публикация owner read-модели

Publisher сначала проверяет safety contract и exact minor units локально. Затем он вычисляет SHA-256 исходного protected JSON, создаёт manifest со всеми 14 datasets и expected counts, загружает строки только в D1 staging и вызывает один commit. Commit внутри одного `DB.batch` проверяет staging state, удаляет прежние live rows, копирует все datasets, переключает active batch, записывает audit и удаляет staging. D1 batch является транзакцией: ошибка любой строки откатывает весь набор.

Оборванный процесс до commit не меняет live read-модель. Повторный запуск использует новый batch ID; begin помечает старый незавершённый staging как `abandoned`. Старый endpoint `/api/admin/read-model/:dataset` запрещён и должен отвечать `410 ATOMIC_SNAPSHOT_REQUIRED`.

После commit `/api/admin/read-model/status` обязан вернуть:

- exact active batch ID и SHA-256 payload;
- `atomicSnapshot = true`;
- counts всех 14 datasets, равные manifest;
- missing minor rows `0` и legacy reconciliation mismatches `0`.

При `SNAPSHOT_COMMIT_FAILED` или count mismatch не пытаться вручную дописывать datasets. Проверить, что active batch и его counts остались прежними, исправить protected source и повторить полный snapshot. D1 не очищать и не удалять.

Terminal Alfa publication допустима только при `completed`, failed entities `0`, incomplete scopes `0`, terminal flags и `real_read_only_terminal`. Partial payroll split допустим только с нулём строк во всех восьми operational AlfaCRM datasets. В обоих случаях PII-флаг `owner_authorized` означает технический процессный gate и не заменяет отдельное информированное разрешение владельца.

## A.8: восстановление branch-scoped идентичности AlfaCRM

Эта процедура относится только к изолированной sandbox-БД. Production PostgreSQL/Replit не подключать.

1. Остановить процессы, использующие sandbox, создать файловый backup БД и payroll snapshot, установить mode `600`, зафиксировать SHA-256.
2. Применить migration `0017` только через транзакционный `openSandboxDatabase` после Front Office migration `0016`. Она должна завершиться fail closed, если нормализованная строка не имеет филиала или филиал attendance нельзя доказать точным `raw_observation_id`.
3. Выполнить `sandbox:rehydrate:alfacrm`: переигрываются последние immutable raw-наблюдения студентов, педагогов, групп, оплат и занятий. Ничего не удалять и не запрашивать у провайдера.
4. Запустить `sandbox:audit:alfacrm`; обязательны ноль `normalizedBranchKeyDuplicates`, ноль broken provenance и ноль attendance без lesson. Повторное использование CRM-ID между филиалами является доказанным свойством источника, а не дублем.
5. После отдельного backup разрешено применить `0018` и выполнить диагностический `sandbox:rebuild:family-candidates` на уже сохранённых observations. При partial batch все кандидаты остаются неполной sandbox-очередью, не публикуются и не считаются семьями. После terminal batch rebuild обязателен повторно. Reviewed decision с неоднозначным филиалом блокирует migration; его нельзя исправлять догадкой. Автоматическое подтверждение семьи запрещено.
6. Экспорт owner read-модели разрешён только при `completed`, нуле incomplete scopes и выполненном audit. Ненулевые source-linkage issues публикуются как `attention` и отображаются в центре качества, а не скрываются.
7. Rollback `0017`/`0018` допустим только если companion script проходит lossless guard. `0019` намеренно не удаляет Front Office: для отката convergence используется сохранённый pre-migration backup.
8. Единственное исключение до terminal gate — явный `ARTHELLO_ALLOW_PARTIAL_ALFA_AGGREGATE=owner_authorized_payroll_only`: разрешены проверенные payroll rows и AlfaCRM aggregate status, но все операционные AlfaCRM datasets обязаны иметь 0 строк.
9. При `auth_request_timeout` не менять ключи и не создавать новый batch. Зафиксировать безопасный код, проверить, что запрос остановился до domain endpoint, и повторить один bounded probe после восстановления сети.
10. После восстановления маршрута продолжить точный partial batch с resume, получить `completed`, повторить audit/rebuild/export и только затем заменить нулевые AlfaCRM datasets.

## A.7: exact-money checkpoint и восстановление источников

1. Экспортировать owner payroll read-модель только во внешний private path с mode `600`.
2. До публикации проверить `moneyStorageMode = integer_minor_units`, scale `2`, safe-integer поля и source-to-minor mismatches `0`; строки и суммы в stdout не выводить.
3. Выполнить `typecheck`, `build:full`, security/data/Sites tests и negative export частичного AlfaCRM snapshot.
4. Проверить healthy agent preview. При подтверждённом `ERR_BLOCKED_BY_CLIENT` после bounded troubleshooting не открывать live Sites URL внутри; использовать artifact, worker/D1 и responsive static contracts и явно сохранить ограничение.
5. Создать checkpoint только существующего `project_id`, дождаться terminal `succeeded`, повторно подтвердить access `custom`, 1 allowed user, 0 groups.
6. Публиковать payroll JSON через protected import token и Sites bypass. После публикации machine endpoint обязан вернуть точные dataset counts, `missingMinorRows = 0`, `legacyReconciliationMismatches = 0`.
7. Убедиться, что «Точка» остаётся `active`, account count не уменьшился без объяснения, scope read-only и payment actions false.
8. Передать exact source commit/tree, Sites version/deployment и безопасные агрегаты новому Ревизору, затем Координатору.

AlfaCRM resume запрещён без заново предоставленных через защищённый environment значений `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`, `ALFACRM_API_KEY`. После их получения использовать `ALFACRM_RESUME_RUNNING_BATCH=1`; не создавать новый batch и не публиковать данные до `completed`, нуля incomplete scopes и разбора integrity findings.

Если `/api/admin/read-model/status` отвечает 5xx, checkpoint не принимать и payroll не публиковать. Сначала проверить Sites Worker logs по точному маршруту. Dataset/status и money-audit запросы должны выполняться двумя bounded D1 batches; raw provider/DB error не возвращать клиенту.

## A.6: возобновление AlfaCRM и безопасная верификация

Перед resume сделать файловую копию sandbox-БД и зафиксировать её checksum. Production DB не подключать. Возобновление разрешено только для последнего running full batch:

```bash
ALFACRM_RESUME_RUNNING_BATCH=1 \
ARTHELLO_SANDBOX_DB_PATH=/absolute/private/sandbox \
pnpm --filter @workspace/scripts run sandbox:import:alfacrm
```

Credentials передаются только через защищённый process environment и не попадают в shell history, stdout, Git или Sites. После завершения обязательны:

1. terminal batch status `completed`;
2. ноль incomplete scopes;
3. provenance audit без missing raw/observation/batch links;
4. отдельный разбор integrity findings;
5. только затем построение family candidates и export owner read-модели.

Для payroll сначала повторно импортировать owner-provided snapshot в ту же завершённую sandbox-БД, затем выполнить payroll и cross-source audits. Exact-name teacher links, class candidates и extra-lesson candidates остаются review-only. Налоговый расчёт не запускать, пока источник ставок и правил не утверждён.

Machine verification deployment выполняет запрос только к `/api/admin/read-model/status` через защищённый Sites bypass. В вывод допускаются counts, банковский status/account count/timestamp и безопасный error code. Bypass/import tokens, owner identity, PII, суммы, номера счетов и account IDs не печатать.

Перед каждым checkpoint: healthy agent preview, browser QA если среда доступна, full build, security/data/Sites tests, source commit, owner-only deployment и terminal deployment status. Если cloud browser не может открыть healthy agent preview, применить bounded troubleshooting, не открывать live Sites URL внутри и явно зафиксировать ограничение доказательства.

## A.5: owner-only Sites read-модель

Перед публикацией:

1. Проверить, что `.openai/hosting.json` содержит существующий `project_id` и D1 binding `DB`; новый Sites-проект не создавать.
2. Через Sites access policy подтвердить ровно одного allowed user, отсутствие групп и режим `custom`.
3. Проверить наличие protected runtime keys `ARTHELLO_OWNER_EMAIL`, `ARTHELLO_IMPORT_TOKEN`, `ARTHELLO_VAULT_KEY`, `TOCHKA_CLIENT_ID`, `TOCHKA_CLIENT_SECRET`; значения не выводить.
4. Запустить `typecheck`, security/data/Sites tests, full build и agent preview. Если облачный браузер не достигает здорового preview после ограниченной диагностики, зафиксировать инфраструктурное ограничение и использовать production artifact contracts, не открывая live URL внутри.
5. Убедиться, что D1 migration не содержит DROP/ALTER/DELETE. Текущий initial schema создаёт только новые таблицы и индексы; до него D1 не содержит business data.
6. Создать Sites checkpoint, дождаться terminal status и только после подтверждённого deployment использовать protected import endpoint.

Экспорт read-модели выполняется только после terminal AlfaCRM report и integrity audit. JSON содержит PII и должен находиться по абсолютному пути вне source checkout, не попадать в stdout, Git, Library или checkpoint artifact.

```bash
ARTHELLO_ALLOW_PII_EXPORT=owner_authorized \
ARTHELLO_SANDBOX_DB_PATH=/absolute/private/sandbox \
pnpm --filter @workspace/scripts run sandbox:export:sites-read-model \
  > /absolute/private/sites-read-model.json
```

Публикация принимает URL и tokens только через environment защищённого процесса, делит данные на batches и выводит лишь dataset counts:

```bash
ARTHELLO_ALLOW_PII_EXPORT=owner_authorized \
ARTHELLO_SITES_READ_MODEL_PATH=/absolute/private/sites-read-model.json \
ARTHELLO_SITES_URL=https://owner-only-site.example/ \
ARTHELLO_SITES_IMPORT_TOKEN=protected \
OAI_SITES_BYPASS_TOKEN=protected \
ARTHELLO_OWNER_EMAIL=protected \
pnpm --filter @workspace/scripts run sites:publish:read-model
```

После публикации проверить только агрегированный `/api/admin/read-model/status`, затем пользователь проверяет реальные строки со своего устройства. Доступы к API без owner identity должны возвращать `403`; snapshot begin/stage/commit без отдельного token — `403`. Успешный atomic commit и каждый разрешённый чувствительный просмотр должны создавать запись `sensitive_access_audit`.

Rollback UI выполняется повторным deployment предыдущей сохранённой Sites version. D1 не удалять. Если read-модель ошибочна, остановить дальнейший import и опубликовать предыдущий проверенный JSON новым atomic snapshot; source sandbox и raw evidence остаются неизменными.

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

Перед `0014` обязательно создать копию sandbox. Migration завершается fail closed, если в legacy normalized AlfaCRM-таблицах есть строки без доказуемого raw/batch provenance; автоматического backfill по догадке нет. Затем применить `0015`, выполнить `sandbox:audit:alfacrm`, проверить exact observation lineage, raw/observation UPDATE/DELETE/TRUNCATE rejection и сценарий rollback `0014` → reapply `0014` → apply `0015`.

Для режима только обнаружения изменений задать `ALFACRM_SYNC_MODE=incremental`, `ALFACRM_WATERMARK=<ISO timestamp>` и при необходимости `ALFACRM_OVERLAP_DAYS=1..7` (по умолчанию 2). Если watermark не передан, importer использует время последнего завершённого batch; при отсутствии такого batch останавливается fail closed. Этот режим обновляет change log, но не утверждает, что все изменившиеся domain rows rematerialized.

### Tochka OAuth

1. Использовать только owner-only Sites Worker с persistent D1, protected environment и зарегистрированным exact root redirect.
2. Проверить `state` hash, одноразовость callback, AES-GCM vault и отсутствие secrets в frontend/source.
3. Создать consent только с scopes `accounts balances customers statements` и permissions `ReadAccountsBasic`, `ReadAccountsDetail`, `ReadBalances`, `ReadStatements`, `ReadCustomerData`.
4. Передать владельцу short-lived банковскую authorize URL; code живёт 5 минут. Не открывать ссылку внутренним браузером и не передавать code/tokens через чат.
5. После callback перечислить все `Business` customers, счета и остатки. Account ID хранить как hash, номер показывать маскированно.
6. Выписки загружать отдельным срезом с явным периодом, raw evidence, дедупликацией и инвариантом; до этого не заявлять банковскую сверку.
7. Payment permissions, endpoints и actions не добавлять и не вызывать.
8. После end-to-end проверки перевыпустить временно раскрытый client secret и сохранить новый только в protected environment.

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

Текущий `artifacts/api-server/src/index.ts` вызывает `runMigrations()`, затем `assertSecuritySchemaReady()`, и только потом `listen()`. Ошибка migration, отсутствующий auth/audit column/index или несовпадение timestamp+hash migrations `0009–0010` останавливают listener и polling с кодом 1. Это подтверждалось unit/source regression tests и controlled rollback/fail-closed процессом на одноразовом PostgreSQL 16; каждый candidate обязан повторить тот же CI gate на exact PR head. Против production `DATABASE_URL` запуск запрещён.

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
