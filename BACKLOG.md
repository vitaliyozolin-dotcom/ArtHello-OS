# ArtHello OS — Backlog

## A.11 — exact checkpoint v28

- [x] Развернуть исправленный source commit
  `025f82973807c03c90c558136b3a508aa17ed345` как owner-only Sites v28.
- [x] Получить terminal deployment `succeeded` и повторно подтвердить access
  `custom / 1 owner / 0 groups`.
- [x] Подтвердить Sites identity header по официальной локальной документации.
- [x] Подтвердить protected environment revision 5 и совпадение configured
  owner email с sole allowed account.
- [x] Проверить, что машинный bypass не принимает caller-spoofed identity.
- [x] Зафиксировать post-deploy `legacy_unattested`, Alfa operational rows `0`
  и payment actions `false` без раскрытия PII/сумм/секретов.
- [ ] Владелец открывает exact live checkpoint на своём устройстве и
  подтверждает, что owner summary, сотрудники, зарплата, Tochka, интеграции и
  Front Office загружаются без `403`.
- [ ] Новый read-only Reviewer проверяет exact documentation commit и v28
  executable; затем новый read-only Coordinator выдаёт итог третьего цикла.
- [ ] Только после отдельного информированного approval заменить legacy payroll
  rows одним server-attested atomic snapshot.

## A.10 — третий correction cycle после FAIL v27

### Выполнено в source candidate

- [x] Зафиксировать exact v27 и решения Reviewer `FAIL` / Coordinator `NO-GO`.
- [x] Запретить terminal publication для `incremental_discovery_read_only`.
- [x] Требовать полный согласованный AlfaCRM scope inventory.
- [x] Добавить per-dataset digest manifest и server-computed SHA-256 staged rows.
- [x] Блокировать staging на время `verifying`; mismatch не меняет прежний active snapshot.
- [x] Покрыть arbitrary digest, same-count row tampering, missing dataset и row-order invariance негативными тестами.
- [x] Согласовать protected owner identity с единственным Sites user без расширения доступа.
- [x] Убрать raw UI exception и показать `legacy_unattested` / `atomic_attested`.
- [x] Пройти local gate: data `62`, security `31`, Sites `22`, Front Office `47`, typecheck/build.

### Открытые ворота

- [x] Проверить candidate через agent preview на desktop; основные переходы и drawer PASS, application console errors отсутствуют.
- [~] Mobile static responsive/navigation contracts PASS; отдельный viewport harness заблокирован browser URL policy и требует независимой визуальной проверки.
- [ ] Зафиксировать exact commit/tree и создать новый owner-only Sites checkpoint.
- [ ] Подтвердить deployment `succeeded`, access `custom / 1 / 0` и owner API `200`; deny cases должны оставаться `403`.
- [ ] Получить новый независимый Reviewer без открытых HIGH.
- [ ] Получить решение нового Координатора по exact version.
- [ ] Только после PASS/GO запросить отдельное информированное разрешение на повторную публикацию protected payroll v5.
- [ ] После разрешения выполнить один digest-bound atomic snapshot; до этого legacy payroll rows не считать аттестованными.

## A.9 — correction cycle после FAIL v25

### P0 — до нового owner-only checkpoint

- [x] Закрыть обход terminal Alfa gate одной сменой `dataMode`.
- [x] Добавить отрицательные тесты: false gate, incomplete source batch и incomplete scopes.
- [x] Заменить последовательный live import на manifest → staging → atomic D1 commit.
- [x] Закрыть legacy per-dataset import и проверить полный rollback при invalid staged row.
- [x] Зафиксировать, что PII import v25 остановлен до отправки и в Sites не выполнялся.
- [x] Выполнить полный monorepo quality run и production build: `31/60/17/47`, typecheck/build PASS.
- [x] Перезапустить agent preview: daemon `running`; cloud HTTP route остаётся заблокирован proxy 502, static responsive/navigation contracts PASS.
- [x] Зафиксировать commit `8482395a…` / tree `7ffcbed6…`; Sites v26 повторно развёрнут как `succeeded`.
- [x] Повторно подтвердить Sites policy `custom / 1 owner / 0 groups`.
- [x] Проверить безопасный machine status: legacy payroll `114/842/1318/1855/36`, Alfa operational `0`, money errors `0`, Tochka active/16/read-only.
- [ ] После явного PII approval перевести существующие legacy payroll rows на digest-bound atomic active snapshot.
- [ ] Передать одну exact version новому read-only Ревизору, затем Координатору.

### P0 — отдельное разрешение на PII

- [ ] Получить информированное подтверждение владельца на публикацию реальных ФИО сотрудников и строк начислений/выплат в точный owner-only Sites URL.
- [ ] После подтверждения ротировать import token и выполнить один atomic snapshot import.
- [ ] Машинно проверить только counts, SHA-256 active snapshot и money mismatches = 0; реальные строки проверяет владелец со своего устройства.

## A.8 — текущие ворота

### P0 — до принятия owner-only checkpoint

- [x] Создать backup sandbox перед family migration `0018`, сохранить mode `600` и SHA-256.
- [x] Перевести AlfaCRM domain IDs и family candidates на branch-scoped identity.
- [x] Rehydrate immutable raw observations и подтвердить ноль broken provenance/branch-key duplicates.
- [x] Добавить bounded retry/timeout и overlap сетевых ожиданий без параллельных DB writes.
- [x] Разрешить только явный payroll + partial Alfa aggregate export с нулём операционных CRM rows.
- [x] Выполнить exporter SQL на disposable migrated DB и повторить 52 data + 13 Sites tests.
- [x] Выполнить полный monorepo typecheck/build/security gate и `git diff --check`.
- [x] Зафиксировать exact commit/tree и owner-only Sites checkpoint v25.
- [x] Не выполнять protected payroll import: external safety gate потребовал отдельного информированного PII-разрешения.
- [x] Получить ревизию v25: `FAIL`; correction cycle продолжается в A.9.

### P0 — AlfaCRM terminal gate

- [ ] Возобновить именно текущий batch после восстановления сетевого маршрута к `/auth/login`; новый ключ не запрашивать без provider evidence.
- [ ] Получить `completed`, 0 incomplete scope и повторить integrity audit.
- [ ] Разобрать 2 membership и 1 123 attendance без normalized student; не скрывать и не сливать identities автоматически.
- [ ] Повторно построить family candidates после terminal snapshot.
- [ ] Только после этого экспортировать и публиковать операционные строки AlfaCRM.

### P1 — после ворот данных

- [ ] Подтвердить teacher↔employee links, классы и дополнительные занятия вручную.
- [ ] Получить авторитетный источник окладов, ставок, KPI и налоговых правил до расчётов.
- [ ] Загрузить и сверить выписки «Точки» с CRM-оплатами; не инициировать платежи.
- [ ] Открывать ДДС, ОПиУ и финансовую модель только после сверки источников.

## A.7 — correction gate денежных данных

- [x] Устранить округление копеек во всех payroll, CRM payment, teacher rate и bank views.
- [x] Ввести exact integer minor units и source-to-minor reconciliation с нулём расхождений.
- [x] Добавить аддитивную Sites D1 migration и safe aggregate counters для missing/mismatched minor rows.
- [x] Обновлять статус «Точки» из runtime API; убрать устаревший статический OAuth status.
- [x] Подтвердить локально `typecheck`, `build:full`, 31 security, 34 data/import и 13 Sites/Worker tests.
- [x] Повторно доказать, что частичный AlfaCRM batch не экспортируется.
- [x] Поймать post-deploy HTTP 500 v17 и заменить сложные union-audits на отдельный bounded batch простых `COUNT`.
- [ ] Создать correction checkpoint, дождаться terminal `succeeded` и подтвердить owner-only policy.
- [ ] Повторно загрузить payroll read-модель и получить deployed money counters = 0.
- [ ] Провести нового Ревизора и затем нового Координатора на одной exact версии.
- [ ] Защищённо получить `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`, `ALFACRM_API_KEY` и возобновить 52 incomplete scopes.
- [ ] Разобрать 70 attendance rows без нормализованного ученика до публикации AlfaCRM.
- [ ] После end-to-end проверки перевыпустить раскрытые AlfaCRM/Tochka credentials.

## A.6 — завершение реальной загрузки

- [x] Исправить AlfaCRM array relationships для групп, педагогов и занятий.
- [x] Добавить явное возобновление interrupted full batch без повторного чтения completed scopes.
- [x] Добавить owner-only представления педагогов, связанных начислений и фактических выплат.
- [x] Пометить teacher/payroll, class и extra-lesson классификации как review candidates.
- [x] Оставить налоги `not_sourced`, не создавать ставки и расчёты по догадке.
- [x] Добавить безопасный machine status без PII, сумм и account identifiers.
- [x] Подтвердить локально typecheck, full build, security/data/Sites tests.
- [~] Опубликовать owner-only checkpoint и машинно проверить пользовательский consent «Точки».
- [ ] Возобновить 52 незавершённых AlfaCRM scopes и получить terminal `completed`.
- [ ] Разобрать 70 attendance rows без нормализованного ученика.
- [ ] Импортировать payroll snapshot в ту же завершённую sandbox-БД и повторить cross-source audit.
- [ ] Опубликовать полную owner-only read-модель только после terminal audit.
- [ ] Провести Reviewer, затем Coordinator по одной точной версии.
- [ ] После end-to-end проверки перевыпустить временно раскрытые AlfaCRM/Tochka credentials.

## A.5 — owner-only данные и подключение источников

- [x] Полностью перечитать главный Library-документ и применить его интерфейсные/защитные ограничения.
- [x] Подтвердить owner-only Sites policy: один пользователь, без групп и публичного доступа.
- [x] Создать D1 read-модель без embedded frontend data и protected import API.
- [x] Вывести реальные сотрудники, помесячные начисления/выплаты, ученики, кандидаты семей, группы, занятия, CRM-оплаты, счета и остатки.
- [x] Перенести технические подключения из «Денег» в «Систему».
- [x] Добавить журнал разрешённых просмотров чувствительных API и import read-модели.
- [x] Добавить `LEGAL_DATA_CHECKLIST.md`; не выдавать его за юридическое заключение.
- [x] Усилить AlfaCRM provenance migration `0015`, исправить rollback `0014` и проверить rollback → reapply.
- [x] Добавить stale student cascade и запрет resurrection зависимостей.
- [x] Настроить Tochka client в protected env и реализовать server-side read-only OAuth без payment scopes/routes.
- [~] Завершить AlfaCRM full import, выполнить integrity audit и зафиксировать фактические counts/coverage.
- [ ] Экспортировать минимальную owner-only read-модель из проверенной sandbox-БД и загрузить её в Sites D1.
- [ ] Пройти owner consent «Точки», получить все business customers, счета и остатки; не инициировать выписку до отдельной проверки периода.
- [ ] Выполнить agent preview desktop/mobile; текущее окружение блокирует внутренний браузер до загрузки страницы.
- [ ] Создать owner-only Sites checkpoint, дождаться terminal deployment status и проверить server API безопасными aggregate-запросами.
- [ ] Опубликовать точный candidate в GitHub Draft PR #1 и запустить PostgreSQL 16 CI; `gh` отсутствует в текущей среде.
- [ ] Передать exact commit/version отдельному read-only Ревизору, затем Координатору.
- [ ] После end-to-end проверки перевыпустить раскрытые AlfaCRM/Tochka credentials.

## A.4 — sandbox ingestion и банковский OAuth

- [~] `A4-13-01`: append-only raw + exact observations + обязательные composite FK реализованы в migrations `0014–0015`, 32 data tests PASS; закрыть только после финального независимого Reviewer PASS.
- [~] `A4-13-02`: completed-scope reconciliation, current/stale, lead→student и stale family evidence реализованы; partial scope не tombstone-ит. Закрыть только после финального Reviewer/Coordinator.
- [~] `A4-13-03`: `pageSize`, repeated-page fail, max guard, transport failure и idempotent retry покрыты PGlite tests. Закрыть только после финального Reviewer/Coordinator.
- [ ] `QA-A4-02`: выполнить `test:postgres` для exact candidate с migrations `0014–0015` на одноразовом PostgreSQL 16; исторический v10 PASS не переносится на этот candidate.
- [x] Создать отдельную PostgreSQL-совместимую sandbox-БД вне source checkout.
- [x] Добавить migration `0011` для raw imports, CRM normalized records, owner-confirmed master data и payroll evidence; подготовить rollback companion.
- [x] Добавить migration `0012` с индексами sandbox-import hot paths и отдельным rollback companion.
- [x] Импортировать реальную зарплатную таблицу и сверить raw, formulas, выплаты, начисления, дубли и юрлица.
- [x] Оставить несопоставленные payroll identities unresolved; не активировать formulas как rules.
- [x] Реализовать read-only AlfaCRM importer для учеников, архивов, оплат, групп, состава, занятий, посещаемости, педагогов и справочников.
- [x] Отделить AlfaCRM leads (`is_study=0`) от students и запретить их попадание в student/family pipeline.
- [x] Добавить customer subscriptions, четыре платёжных справочника и `log/index` с raw + normalized provenance.
- [x] Добавить incremental discovery по change log с обязательным watermark и перекрытием 1–7 дней; не считать его полной rematerialization.
- [x] Добавить migration `0013` и rollback companion; применить только в отдельной sandbox-БД.
- [x] Перед `0014` создать копию отдельной sandbox-БД, применить migration и сохранить rollback companion; production не затрагивать.
- [x] Запретить автоматическое объединение семей; создавать только manual-review candidates.
- [x] Выполнить свежий AlfaCRM full run и честно зафиксировать network timeout с нулём сохранённых CRM records.
- [x] Подтвердить новый production client «Точки» по token endpoint и отказ accounts без hybrid OAuth.
- [x] Сделать сохранение encrypted bank connector config fail closed.
- [ ] Запустить AlfaCRM full importer из защищённого backend с доступом к CRM и повторить coverage/integrity audit по всем обязательным endpoint.
- [ ] После успешного full snapshot реализовать и проверить rematerialization сущностей по incremental change discovery.
- [x] Реализовать точный server-side callback на зарегистрированном owner-only Sites root с state verification и encrypted vault.
- [ ] После backup/rollback и protected env пройти read-only OAuth consent; не запрашивать payment permissions.
- [ ] Выгрузить счета, остатки и операции в sandbox и провести контроль полноты без Sites PII.
- [ ] После подтверждённого end-to-end перевыпустить раскрытые AlfaCRM/Tochka credentials.
- [ ] Выпустить security/noindex/login исправления в Replit только через отдельные runtime-ворота.

## A.3 — историческая live read-only verification

- [x] Подтвердить AlfaCRM credentials без сохранения секретов.
- [x] Получить актуальное количество филиалов: 8.
- [x] Подтвердить Tochka client credentials и service token.
- [x] Доказать, что service token не даёт доступ к счетам без hybrid OAuth.
- [x] Удалить raw Tochka bodies/customer identifiers из logs и errors.
- [x] Добавить повторяемый sanitized live probe.
- [x] Расширить обязательный `MONTH_CLOSE_CHECKLIST.md` без вымышленных финансовых правил.
- [x] Зафиксировать исторический provenance v10 и решение Reviewer/Coordinator.
- [x] Закрепить candidate CI на exact PR head и экспортировать immutable `head_sha/tree_sha` + source/Sites digests.
- [ ] Повторить AlfaCRM entity-count probes после восстановления сетевого контура.
- [ ] Настроить корректный защищённый callback runtime и пройти Tochka consent.
- [ ] После завершения проверки перевыпустить оба комплекта credentials.

## A.2 — текущий gate

- [x] Реализовать authenticated encryption для банковской connector config.
- [x] Добавить guarded migration существующей config после backup.
- [x] Сделать AlfaCRM limiter concurrency-safe и покрыть unit-тестом.
- [x] Подготовить disposable PostgreSQL 16 integration suite и CI workflow.
- [x] Импортировать source в приватный GitHub и выполнить quality workflow (Draft PR #1; исторический v10 run #8 PASS).
- [ ] Перевыпустить раскрытые AlfaCRM и Tochka credentials.
- [ ] Выполнить bank-config migration на sandbox-копии, не production.

Приоритеты отражают ворота качества, а не желаемый порядок экранов.

## P0 — блокеры безопасности и доказуемости

- [ ] Получить оригинальный Git remote или Git bundle и сопоставить его с архивом.
- [ ] Подготовить контролируемый выпуск security-исправлений в Replit после теста callback-контрактов.
- [x] Удалить hardcoded AlfaCRM tenant fallback и останавливать клиент без `ALFACRM_DOMAIN`.
- [x] Реализовать encrypted vault для bank connector config; legacy rows требуют guarded sandbox migration после backup.
- [~] Structured logs и public 5xx responses очищаются централизованно; legacy `/sync` API fail closed, но недоступный исторический code ещё требует замены/удаления.
- [ ] Спроектировать аутентификацию website, bank и Evotor webhooks.
- [x] Website lead handler использует payload-bound idempotency key, atomic transaction, advisory lock, `409` conflict и recovery raw-only partial write; public exposure всё ещё запрещён.
- [x] Заменить in-memory bearer sessions на PostgreSQL session model с secure HttpOnly cookie и CSRF-защитой в исходниках.
- [x] Ввести role RBAC и обязательные branch/legal-entity scope metadata.
- [x] Fail closed все non-owner business routes до handler-level predicates.
- [~] Cross-scope negative tests подтверждают fail-closed; route-specific predicates ещё не реализованы.
- [x] Добавить fail-closed audit разрешённого sensitive access в исходниках.
- [x] Добавить PostgreSQL rate limiting и lockout для login.
- [ ] Прогнать migrations `0009–0010` на восстановленной sandbox-копии, проверить session lifecycle, CSRF, scope, audit и rollback.
- [x] Любая ошибка startup migration останавливает listener и polling в исходниках.
- [x] До listener проверять обязательные security columns/indexes и точные journal timestamp+hash migrations `0009–0010`.
- [x] Доказать fail-closed startup реальной контролируемой ошибкой PostgreSQL в одноразовом CI sandbox.
- [x] Заменить AlfaCRM timestamp limiter на сериализованную очередь и доказать интервал 260 ms конкурентным unit-тестом.
- [x] Добавлены unit/source regression tests для website transaction rollback/retry/recovery/conflict, schema inventory, strict health allowlist и identifier-safe audit templates.
- [~] Negative role/scope/security regression tests расширены; остаются provider replay и restored-sandbox failure tests.
- [~] Историческая `/sync` debug/probe поверхность заблокирована централизованно; недоступный code удалить после проектирования безопасной замены.

## P0 — read-only аудит данных

Полная read-only инвентаризация AlfaCRM в отдельную sandbox-БД разрешена D-031. Production sync, запись в источники, bank data до OAuth и публикация детальных записей в Sites остаются запрещены.

- [ ] Получить авторизованный read-only доступ или обезличенный snapshot БД.
- [ ] Проверить текущее подключение AlfaCRM и зафиксировать время проверки.
- [ ] Перечислить все филиалы и сопоставить их с внутренними сущностями.
- [ ] Перечислить юридические лица и карту `юрлицо → банковские счета → филиалы`.
- [ ] Проверить подключения Точки, Т-Банка и ВТБ без изменения данных.
- [ ] Пересчитать фактические объёмы, минимальные/максимальные даты, дубли и пропуски.
- [ ] Выдать свежий DATA_COVERAGE с источниками каждого значения.

## P1 — надёжность платформы

- [x] CI workflow с typecheck, build, unit и PostgreSQL 16 integration/migration tests выполнен на историческом v10 run #8; candidate дополнительно публикует immutable provenance artifact.
- [ ] Добавить health/readiness checks для БД и каждой интеграции.
- [~] Введены recursive redaction и access audit; allowed route подтверждён в PostgreSQL, остаются deny/outage smoke, retention и correlation ID.
- [ ] Зафиксировать RPO/RTO и проверить восстановление из backup.
- [ ] Удалить tracked build metadata или гарантировать воспроизводимую пересборку.

## P1 — операционная модель

- [ ] Подтвердить сущности семей и правила identity resolution.
- [ ] Сверить учеников, представителей, группы, зачисления и расписание.
- [ ] Подтвердить структуру подразделений, сотрудников, ролей и договоров.
- [ ] Получить утверждённые ставки, KPI и правила зарплаты без домыслов.
- [ ] Добавить объяснимый payroll calculation trail.

## P1 — финансовая правда

- [ ] Сверить счета, остатки и полноту банковских операций.
- [ ] Утвердить правила дедупликации и reconciliation банка с AlfaCRM.
- [ ] Утвердить статьи ДДС и ОПиУ.
- [~] Шаблон месяца закрытия и synthetic invariants формализованы; runtime, реальные источники, утверждённые правила и business-value regression tests отсутствуют.
- [x] Добавлены синтетические regression tests базовых инвариантов без реальных ставок: balance, transfers, reporting dates, payroll rule versions, reversals и rounding.
- [ ] Достичь статуса финансовой правды `READY`.

## P2 — интерфейс и развитие

- [ ] Подключить Sites control surface к безопасному staging/read-only API.
- [ ] Развить карточки семей, учеников и групп.
- [ ] Реализовать workflow проверки зарплаты.
- [ ] Реализовать drill-down ДДС и ОПиУ до источника.
- [ ] Добавить финансовую модель с явными допущениями.
- [ ] Запускать AI CFO только после прохождения ворот финансовой правды.
