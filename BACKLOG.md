# ArtHello OS — Backlog

## A.4 — sandbox ingestion и банковский OAuth

- [~] `A4-13-01`: append-only raw + отдельные observations + обязательные raw/batch FK реализованы в migration `0014`, 29 data tests PASS; закрыть только после финального независимого Reviewer PASS.
- [~] `A4-13-02`: completed-scope reconciliation, current/stale, lead→student и stale family evidence реализованы; partial scope не tombstone-ит. Закрыть только после финального Reviewer/Coordinator.
- [~] `A4-13-03`: `pageSize`, repeated-page fail, max guard, transport failure и idempotent retry покрыты PGlite tests. Закрыть только после финального Reviewer/Coordinator.
- [ ] `QA-A4-02`: выполнить `test:postgres` для exact candidate с migration `0014` на одноразовом PostgreSQL 16; текущая среда не содержит `TEST_DATABASE_URL`, поэтому исторический v10 PASS не переносится на этот candidate.
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
- [ ] Заменить Redirect URI «Точки» на точный защищённый backend `/api/banking/oauth/callback`.
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

## P0 — RU-04 production backup/restore

- [x] Утвердить канонический контракт `D-PROD-RU-008` для фактической production D1/SQLite: daily `03:00 Europe/Moscow`, 30 daily, 12 monthly, manual до явного удаления, canonical-owner-only, AES-256-GCM.
- [~] Реализовать manual, daily, monthly, pre-deploy и pre-restore точки с checksum, SQLite integrity, manifest, fail-closed совместимостью core schema и внешним append-only журналом операций.
- [ ] Подключить отдельную production backup-volume и ключ AES-256-GCM, хранящийся вне data/backup volumes; подтвердить права доступа и отсутствие plaintext-копий.
- [ ] Добавить owner-only раздел «Резервные копии» в настройках: состояние расписания, история, ручное создание и контролируемое восстановление с текущим паролем и точной подтверждающей фразой.
- [ ] При restore всегда создавать safety backup, отзывать восстановленные сессии и сохранять доступ текущего канонического владельца.
- [ ] Доказать ежедневный запуск в production и хранение по policy без удаления ручных копий.
- [~] Синтетический изолированный restore из зашифрованной копии покрыт integration test; остаётся выполнить drill из фактической production-копии, проверить контрольные данные и измерить RPO/RTO против `24h/4h`.
- [ ] Настроить off-server copy в российском контуре и доказать её получение и изолированное восстановление; локальный том сам по себе этот gate не закрывает.
- [ ] Реализовать и проверить offline break-glass restore при повреждённой или отсутствующей текущей SQLite: приложение остановлено, target полностью проверен без live DB, повреждённое состояние сохранено для forensic recovery, владелец получает новый принудительно сменяемый доступ, затем проходит health-check.
- [ ] Добавить pre-create retention/capacity gate и alerting для backup-volume и tmpfs; предусмотреть audited удаление manual-точек с защитой минимального набора исправных копий.
- [ ] Зафиксировать escrow/rotation-процедуру ключа шифрования без хранения ключа на data/backup volumes.
- [ ] Добавить внешний host-level commit-aware supervisor для cutover: после SIGKILL/потери runner он должен по durable state безопасно завершить commit либо вернуть данные, маршруты и ровно один writer; проверить fault-injection после остановки production writer.
- [ ] Не открывать gate реальных данных, пока isolated restore и off-server copy не подтверждены evidence.

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
- [~] Целевые RPO/RTO зафиксированы как `24h/4h`; фактический замер и проверка восстановления остаются P0 RU-04.
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
