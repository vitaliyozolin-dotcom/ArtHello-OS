# ArtHello OS — Backlog

## A.3 — live read-only verification

- [x] Подтвердить AlfaCRM credentials без сохранения секретов.
- [x] Получить актуальное количество филиалов: 8.
- [x] Подтвердить Tochka client credentials и service token.
- [x] Доказать, что service token не даёт доступ к счетам без hybrid OAuth.
- [x] Удалить raw Tochka bodies/customer identifiers из logs и errors.
- [x] Добавить повторяемый sanitized live probe.
- [ ] Повторить AlfaCRM entity-count probes после восстановления сетевого контура.
- [ ] Настроить корректный защищённый callback runtime и пройти Tochka consent.
- [ ] После завершения проверки перевыпустить оба комплекта credentials.

## A.2 — текущий gate

- [x] Реализовать authenticated encryption для банковской connector config.
- [x] Добавить guarded migration существующей config после backup.
- [x] Сделать AlfaCRM limiter concurrency-safe и покрыть unit-тестом.
- [x] Подготовить disposable PostgreSQL 16 integration suite и CI workflow.
- [ ] Импортировать source в приватный GitHub и выполнить quality workflow.
- [ ] Перевыпустить раскрытые AlfaCRM и Tochka credentials.
- [ ] Выполнить bank-config migration на sandbox-копии, не production.

Приоритеты отражают ворота качества, а не желаемый порядок экранов.

## P0 — блокеры безопасности и доказуемости

- [ ] Получить оригинальный Git remote или Git bundle и сопоставить его с архивом.
- [ ] Подготовить контролируемый выпуск security-исправлений в Replit после теста callback-контрактов.
- [x] Удалить hardcoded AlfaCRM tenant fallback и останавливать клиент без `ALFACRM_DOMAIN`.
- [x] Реализовать encrypted vault для bank connector config; legacy rows требуют guarded sandbox migration после backup.
- [~] Structured logs очищаются централизованно; отдельно убрать raw upstream body из пользовательских ошибок и ограничить debug responses.
- [ ] Спроектировать аутентификацию website, bank и Evotor webhooks.
- [x] Website lead handler использует payload-bound idempotency key, atomic transaction, advisory lock, `409` conflict и recovery raw-only partial write; public exposure всё ещё запрещён.
- [x] Заменить in-memory bearer sessions на PostgreSQL session model с secure HttpOnly cookie и CSRF-защитой в исходниках.
- [x] Ввести role RBAC и обязательные branch/legal-entity scope metadata.
- [x] Fail closed все non-owner business routes до handler-level predicates.
- [ ] Реализовать scoped predicates по маршрутам и cross-scope negative tests.
- [x] Добавить fail-closed audit разрешённого sensitive access в исходниках.
- [x] Добавить PostgreSQL rate limiting и lockout для login.
- [ ] Прогнать migrations `0009–0010` на восстановленной sandbox-копии, проверить session lifecycle, CSRF, scope, audit и rollback.
- [x] Любая ошибка startup migration останавливает listener и polling в исходниках.
- [x] До listener проверять обязательные security columns/indexes и точные journal timestamp+hash migrations `0009–0010`.
- [ ] Доказать fail-closed startup реальной контролируемой ошибкой PostgreSQL в sandbox.
- [x] Заменить AlfaCRM timestamp limiter на сериализованную очередь и доказать интервал 260 ms конкурентным unit-тестом.
- [x] Добавлены unit/source regression tests для website transaction rollback/retry/recovery/conflict, schema inventory, strict health allowlist и identifier-safe audit templates.
- [~] Negative role/scope/security regression tests расширены; остаются HTTP+PG migration/rollback/transaction, callback replay, concurrency и финансовые failure tests.
- [ ] Проверить и ограничить debug/probe endpoints, способные вернуть PII.

## P0 — read-only аудит данных

Полная инвентаризация бизнес-записей и синхронизация запрещены до закрытия открытых HIGH и нового Reviewer/Coordinator gate. Ограниченный auth/metadata/count probe без сохранения записей разрешён решением D-021.

- [ ] Получить авторизованный read-only доступ или обезличенный snapshot БД.
- [ ] Проверить текущее подключение AlfaCRM и зафиксировать время проверки.
- [ ] Перечислить все филиалы и сопоставить их с внутренними сущностями.
- [ ] Перечислить юридические лица и карту `юрлицо → банковские счета → филиалы`.
- [ ] Проверить подключения Точки, Т-Банка и ВТБ без изменения данных.
- [ ] Пересчитать фактические объёмы, минимальные/максимальные даты, дубли и пропуски.
- [ ] Выдать свежий DATA_COVERAGE с источниками каждого значения.

## P1 — надёжность платформы

- [~] CI workflow с typecheck, build, unit и PostgreSQL 16 integration/migration tests подготовлен; фактический run ожидает импорт source в GitHub.
- [ ] Добавить health/readiness checks для БД и каждой интеграции.
- [~] Введены recursive redaction и access audit source; остаются runtime evidence, retention и correlation ID.
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
- [ ] Ввести месяц закрытия, исключения и контрольные суммы.
- [ ] Достичь статуса финансовой правды `READY`.

## P2 — интерфейс и развитие

- [ ] Подключить Sites control surface к безопасному staging/read-only API.
- [ ] Развить карточки семей, учеников и групп.
- [ ] Реализовать workflow проверки зарплаты.
- [ ] Реализовать drill-down ДДС и ОПиУ до источника.
- [ ] Добавить финансовую модель с явными допущениями.
- [ ] Запускать AI CFO только после прохождения ворот финансовой правды.
