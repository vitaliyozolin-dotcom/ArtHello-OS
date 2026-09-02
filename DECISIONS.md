# ArtHello OS — Decisions

## D-041 — School 2026/2027 публиковать ручным проверяемым cutover

Дата: 2026-09-02  
Статус: принято владельцем для product release; запуск только через D-040 gate

Владелец поручил внести в School утверждённый набор 2026/2027 и вывести принятый релиз в production. Источником истины для расписания является приложенный файл: в нём подтверждены 189 еженедельных уроков только для классов 1–6 (41/28/29/29/31/31); отсутствие строк 7–11 не восполняется догадкой и не даёт права удалять существующие данные других классов. Для математики 2 класса принято КТП на 170 тем и 170 часов при пяти уроках в неделю. После исключения четырёх периодов каникул календарь даёт 171 слот: занятия распределяются с 01.09.2026 по 28.05.2027, а 31.05.2027 остаётся резервом.

Импорт расписания, каникул и КТП идемпотентен и до открытия записи обязан пройти точную read-only сверку 189 строк, 4 периодов, 170 тем, 170 сессий, provenance, SQLite integrity и foreign keys. Замена расписания ограничена классами источника 1–6; строки уроков, связанные с ними сессии и исключения других классов сравниваются до/после импорта и обязаны остаться неизменными. Ручное сопоставление ученика в утверждённом исключении также сохраняется. Архивные аккаунты преподавателей не назначаются. Учитель сохраняет право вручную менять фактическую тему и домашнее задание; кнопка «урок проведён» и автоматический сдвиг будущих тем не вводятся. Методист проверяет и возвращает план с комментарием, завуч утверждает календарь, расписание, назначения и активацию программы.

Production cutover разрешён только из `main` отдельным `workflow_dispatch` с точным typed confirmation `DEPLOY-SCHOOL-2026-2027`, от владельца, через защищённый Environment `production-ru` с required reviewer. Workflow обязан до checkout и Docker проверить confirmation, затем сверить immutable controls SHA, принятый release `af1f262abdbdfa0db6bf6db2262efe9bb0c029b0` и tree `66e0b81f6a81309f096acf0b61c3451d87e9c804`.

Допуск source подтверждается до checkout через GitHub API: hotfix PR №301 должен быть слит exact head `75c01c2c2cc5e371d6cd87b013dcf98026d9bd6b` в release SHA, validation run `33591551705` workflow `346579718` должен иметь `conclusion=success` на том же head и tree, а squash commit — быть подписан GitHub и сохранять тот же tree. Validation включает полный импорт 189 строк с sentinel 7 класса и доказывает сохранность данных вне источника. Любое расхождение fail closed останавливает job до доступа к Docker/SSH.

До открытия записи выполняются offline build, clone-preflight, остановка старого контейнера, maintenance gate, финальный проверенный SQLite snapshot, live import и сверка защищённого scope. Любая ошибка до commit boundary восстанавливает snapshot и прежний контейнер. После успешной полной сверки rollback snapshot отключается до снятия gate; затем внутри cutover проверяются публичные health, login/CSS, SSO и семейный вход. Любая ошибка после boundary повторно включает gate и требует roll-forward; независимая внешняя проверка workflow при сбое также обязана re-gate production до завершения job. Старый контейнер и отдельный rollback volume сохраняются остановленными как операционное доказательство и средство ручного восстановления.


## D-040 — Недоверенная автоматизация не получает production capability

Статус: принято владельцем для кандидата Фазы 0A; требует Reviewer/Coordinator gate

Код из `pull_request` или PR-head checkout не исполняется на self-hosted runner, job с production Environment, SSH-доступом к production или ином production capability. Доступ к Docker socket считается root-эквивалентным независимо от Unix-пользователя. Production-destructive workflow запускается только вручную через `workflow_dispatch`, требует точное typed confirmation до checkout/Docker и protected Environment с required reviewer. Replit post-merge не изменяет схему БД. Постоянный YAML-aware gate анализирует все workflow и fail closed блокирует возвращение опасных trigger/job/checkout сочетаний; его machine-readable отчёт входит в proof evidence.

## D-036 — Raw lineage и snapshot-state не восстанавливать догадкой

Статус: принято в source candidate; независимый финальный gate ожидается

`alpha_raw_records` является append-only. Повторное получение того же payload создаёт новое observation batch/scope/page, а изменённый payload — новую raw-версию. Каждая материализованная AlfaCRM-строка обязана ссылаться на существующие raw и batch; migration `0014` завершается fail closed при legacy rows без доказуемого provenance вместо автоматического backfill.

Current/stale reconciliation выполняется только после полной успешной пагинации минимального scope. Partial, repeated page, max guard и network error не tombstone-ят предыдущий snapshot. Лиды и ученики сохраняют историю, но после успешного student snapshot одна запись не может одновременно оставаться current lead. Pending family candidates без текущего evidence становятся stale; решения человека не переписываются.

## D-035 — Incremental AlfaCRM начинается с проверяемого change discovery

Статус: принято в исходниках; live data не проверены

Полный read-only snapshot остаётся обязательной базой. Лиды загружаются отдельно от учеников; абонементы клиентов, платёжные справочники и журнал изменений имеют raw + normalized слои с provenance и идемпотентными business keys. Incremental-режим читает `log/index` от watermark с перекрытием 1–7 дней и честно называется discovery: до реализации безопасной rematerialization он не доказывает обновление всех domain-таблиц. Запись в AlfaCRM запрещена.

## D-034 — Sites не является банковским OAuth backend

Статус: принято, текущий consent заблокирован

Корень owner-only Sites нельзя регистрировать как Redirect URI «Точки»: контрольная оболочка не хранит банковские secrets и не должна получать authorization code. Допустим только точный HTTPS URL защищённого API вида `/api/banking/oauth/callback`, совпадающий с runtime config. `.chatgpt.site`, HTTP, корневой путь и произвольные callback-пути завершаются fail closed.

## D-033 — Новый клиент «Точки» использовать только в read-only контуре

Статус: production client auth подтверждён, доступ к данным заблокирован до OAuth

Владелец разрешил временно использовать новый production client. Service token проверяет приложение, но не даёт доступа к счетам. До корректного callback, пользовательского consent, hybrid token, protected backend Secrets и backup/rollback разрешены только безопасные auth/status probes. Платёжные scopes, создание платежей и иные денежные действия запрещены.

## D-032 — Реальный payroll импортировать как evidence, а не как утверждённые правила

Статус: принято и выполнено в изолированной sandbox-БД

Значения и formula snapshots реальной таблицы сохраняются с происхождением строки. Вычисленные выплаты и начисления можно сверять, но формулы, ставки, KPI и условия не становятся payroll rules без явного утверждения. Несопоставленные identities не объединяются автоматически; персональные строки, суммы и реквизиты не публикуются в Sites.

## D-031 — Полный AlfaCRM read разрешён только в отдельную sandbox-БД

Статус: разрешено владельцем; свежий импорт заблокирован сетью

Текущие временные credentials допускаются для read-only загрузки всех требуемых CRM-сущностей в отдельную БД вне source checkout. Запись в AlfaCRM, production sync и передача PII в Sites запрещены. Семьи не подтверждаются автоматически по телефону: importer создаёт только кандидатов для ручного решения. После end-to-end проверки credentials перевыпускаются и помещаются только в protected backend environment.

## D-030 — Финансовые инварианты проверять без бизнес-допущений

Статус: принято как synthetic guardrail, не как финансовая готовность

Регрессионные тесты используют только integer minor units и вымышленные test IDs: проверяют `opening + inflows - outflows = closing`, исключение внутренних переводов из консолидированного ДДС, раздельные cashflow/accrual/P&L периоды, единственную активную версию payroll rule, точные reversals и deterministic rounding. Они не содержат реальных сумм, ставок, KPI или финансовых статей и не открывают financial truth gate.

## D-029 — Legacy sync и public 5xx fail closed

Статус: принято в исходниках, runtime release не выполнен

Public 5xx boundary никогда не возвращает exception message, upstream body, probe output, идентификаторы или PII. Историческая `/sync` поверхность централизованно возвращает `LEGACY_SYNC_DISABLED` и остаётся недоступной, пока не заменена scoped source jobs. Это безопасное отключение, а не утверждение, что legacy code полностью удалён.

## D-028 — PR body является индексом, CI artifact — доказательством

Статус: принято для финального цикла 3

Quality workflow checkout-ит точный `pull_request.head.sha`, сверяет фактический `HEAD` и публикует immutable artifact с `head_sha`, `tree_sha`, source archive SHA-256 и deterministic Sites artifact SHA-256. PR body обновляется после CI/Sites и только индексирует доказательства. Он изменяем и сам по себе не подтверждает равенство local/remote tree.

## D-027 — Tree является ключом идентичности local/remote package

Статус: принято для приватной Git Data history

Local и remote commit SHA могут различаться, потому что remote branch создаётся через Git Data API поверх отдельной истории. Пакет считается содержательно одинаковым только при точном равенстве Git tree. Для каждого checkpoint дополнительно фиксируются private PR head, terminal CI run, Sites version/deployment и owner-only access. D-028 уточняет механизм: PR body — индекс, а равенство tree доказывается immutable CI artifact.

Равенство tree и отчёт Создателя не заменяют независимую проверку Ревизора.

## D-021 — Временная проверка текущими credentials

Статус: разрешено владельцем только для A.3 read-only probe

Текущие credentials можно использовать до ротации только в памяти одноразового процесса и только для авторизации, metadata/count probes и чтения после отдельного OAuth consent. Запрещены сохранение в source/Sites/CI logs, запись business data, sync в production БД и любые платежные действия. Перед production credentials всё равно перевыпускаются.

Это ограниченное исключение уточняет D-010 и D-026: источник можно проверить без публикации записей, но production, детальная выгрузка, постоянная синхронизация и финансовые расчёты не открываются.

## D-022 — Service token «Точки» не считать доступом к счетам

HTTP 200 на `client_credentials` подтверждает приложение, но не банковские данные. Доступ к счетам и выпискам признаётся только после Authorization Code flow, hybrid token и read-only smoke. HTTP 403 с service token является ожидаемым безопасным результатом.

## D-023 — Шифровать банковскую connector config

Статус: принято в исходниках

Secret-bearing config хранится только как AES-256-GCM envelope. AAD связывает ciphertext с connector ID и key ID. Активный key выбирается защищёнными env; отсутствие ключа, подмена ciphertext или legacy plaintext secret завершаются fail closed. Миграция разрешена только после подтверждённого backup ID и явного confirmation token.

## D-024 — PostgreSQL 16 sandbox создаётся CI-сервисом

Статус: выполнено, GitHub Actions run #6 PASS

Quality workflow поднимает одноразовый PostgreSQL 16 service и выполняет реальные migrations, HTTP/session/CSRF/audit checks, webhook rollback/retry, schema drift, rollback и fail-closed startup. Run #6 (`30161527465`) прошёл `test:full`, `test:postgres` и `build:full`. Это evidence только для синтетической одноразовой БД; оно не заменяет восстановленную sandbox-копию и не разрешает production migration.

## D-025 — Все AlfaCRM запросы проходят одну очередь

Статус: принято в исходниках, unit PASS

Очередь сериализует запросы и выдерживает 260 ms между стартами. Ошибка задачи не ломает очередь; одновременная аутентификация объединяется.

## D-026 — Раскрытые в переписке ключи скомпрометированы

Ключи со скриншотов не переносятся в код, Sites, CI или постоянный env. D-021 разрешает их временное использование только в памяти одноразового read-only probe. До production и постоянной синхронизации владелец перевыпускает AlfaCRM API/X-APP keys и Tochka client secret и сохраняет новые значения только в protected backend Secrets.

## D-001 — Продолжать существующий монорепозиторий

Дата: 2026-07-23
Статус: принято

Архив признан существующей кодовой базой ArtHello OS. Новый несвязанный продукт не создаётся. Sites control surface добавлена как отдельный безопасный runtime-адаптер внутри того же репозитория.

## D-002 — Исторические числа не являются текущей истиной

Дата: 2026-07-23  
Статус: принято

Значения из `replit.md` и прежних отчётов сохраняются только как исторические свидетельства. Они не показываются как актуальные метрики и должны быть перепроверены через авторизованный read-only доступ.

## D-003 — Sites не подключается к production на первом checkpoint

Дата: 2026-07-23  
Статус: принято

Первый owner-only checkpoint содержит только обезличенные статусы аудита. В нём нет секретов, персональных данных, зарплаты и банковских операций.

## D-004 — Не имитировать цифры

Дата: 2026-07-23  
Статус: принято

Если факт нельзя подтвердить, интерфейс показывает `не подтверждено`, `неизвестно` или `нужен доступ`. Случайные метрики запрещены.

## D-005 — Закрыть исходники по принципу deny by default

Дата: 2026-07-23  
Статус: принято с условием

Общий auth-gate защищает API. Публичными остаются только health, login/session и browser OAuth callback Точки, защищённый state. Входящие website, bank и Evotor callbacks временно закрыты до определения проверяемой аутентификации. Перед выпуском в Replit совместимость callback-контрактов должна быть протестирована.

## D-006 — Не хранить банковские секреты в Sites

Дата: 2026-07-23  
Статус: принято

Sites не получает банковские или AlfaCRM секреты. A.2 реализует encrypted vault в исходниках; включать или обновлять банковские подключения нельзя до backup, guarded migration legacy rows, ротации раскрытых credentials и проверки на восстановленной репрезентативной sandbox-копии.

## D-007 — Сохранить существующий визуальный язык

Дата: 2026-07-23  
Статус: принято

Контрольная оболочка использует обнаруженный стиль ArtHello: светлый фон, белые карточки, компактная боковая навигация и фиолетовый акцент. Отдельный дизайн-конкурс не проводился.

## D-008 — Принудительно пересобирать declaration-файлы

Дата: 2026-07-23  
Статус: принято

Из-за сохранённых `tsconfig.tsbuildinfo` и отсутствующих `dist` обычный `tsc --build` давал ложные ошибки `TS6305`. `typecheck:libs` использует `tsc --build --force`.

## D-009 — Не запускать production migrations в Фазе A

Дата: 2026-07-23  
Статус: принято

Migration runner и схема изучаются только статически. Любая production-миграция требует snapshot/backup, проверенного rollback, отдельного разрешения и ворот Reviewer/Coordinator.

## D-010 — Не открывать live gate до закрытия HIGH

Дата: 2026-07-23
Статус: принято по решению Координатора

Owner-only sanitized checkpoint и production readiness — разные статусы. Одноразовый PostgreSQL 16 CI gate пройден, но пока открыты migration legacy bank config, ротация раскрытых credentials, небезопасные legacy errors/probes, scoped handlers, callback authentication и проверка на восстановленной репрезентативной sandbox-копии, запрещены Replit release, production, постоянная синхронизация и чтение детальных AlfaCRM/банк/БД records, polling и реальные персональные или финансовые данные. D-021 разрешает только ephemeral auth/metadata/count probe без сохранения записей. Owner UI обязан показывать эти блокеры полностью; отсутствие детального live-доступа не считается доказательством безопасности.

## D-011 — Browser auth только через server-side session

Дата: 2026-07-24
Статус: PostgreSQL 16 CI PASS; production release gate не пройден

Browser frontend не хранит bearer token. Session token передаётся в HttpOnly Secure SameSite cookie, а в PostgreSQL хранится только его SHA-256 hash. Изменяющие запросы требуют double-submit CSRF. Login lockout хранится в БД, чтобы несколько API-процессов не обходили лимит.

## D-012 — RBAC deny by default

Дата: 2026-07-24
Статус: заменено более строгим D-014

Первоначальная policy давала viewer чтение, а accountant — явный финансовый write allowlist. Ревизия выявила отсутствие обязательных branch/legal-entity predicates, поэтому эта policy больше не считается достаточной.

## D-013 — Security migration не запускается автоматически

Дата: 2026-07-24
Статус: принято

Таблицы `auth_sessions` и `auth_login_attempts` оформлены Drizzle migration `0009`. Scope/audit оформлены migration `0010`. Они намеренно не добавлены в legacy startup runner и не применялись к production. До sandbox backup → restore → apply → HTTP/PostgreSQL smoke → rollback выпуск API запрещён.

## D-014 — Non-owner business access закрыт до scoped handlers

Дата: 2026-07-24
Статус: принято в исходниках, runtime gate не пройден

Session хранит явные списки филиалов и юридических лиц из protected environment. Наличие metadata само по себе не доказывает фильтрацию результата. Поэтому все business routes для accountant/viewer fail closed, пока конкретный handler не применяет оба predicates и не проходит cross-scope negative tests. Owner сохраняет полный authenticated access.

## D-015 — Sensitive access audit и startup должны быть fail closed

Дата: 2026-07-24
Статус: startup и allowed access audit подтверждены в PG16 CI; deny/outage audit smoke открыт

Migration `0010` добавляет канонизированный audit разрешённых и запрещённых sensitive routes. Если разрешённый запрос нельзя записать в audit store, API возвращает `503`. Ошибка startup migration теперь прерывает запуск до listener и banking polling. Обе защиты должны быть доказаны на восстановленной sandbox-копии.

## D-016 — Внешние callbacks не публиковать без provider-auth

Дата: 2026-07-24
Статус: принято

Website, bank и Evotor POST callbacks остаются за user auth/CSRF gate и поэтому неработоспособны для внешних провайдеров. Website handler получил обязательный `Idempotency-Key`, но этого недостаточно для public exposure. Нужны provider-specific signature/token verification, replay window, durable idempotency и negative tests; до этого callback endpoints не добавляются в public allowlist.

## D-017 — Website lead записывать одной транзакцией

Дата: 2026-07-24
Статус: принято в исходниках, PostgreSQL 16 CI PASS

Одинаковый `Idempotency-Key` сериализуется PostgreSQL advisory transaction lock. Raw event, lead event, processed flag и source status записываются одной транзакцией. Key связан с hash canonical payload: другой payload получает `409`. Старый raw-only partial write восстанавливается повтором без второй raw-записи. PostgreSQL 16 CI подтвердил rollback/retry/recovery; до public callback всё равно обязательны provider-auth, replay protection и negative tests.

## D-018 — Security schema проверять до listener

Дата: 2026-07-24
Статус: принято в исходниках, PostgreSQL 16 CI PASS

Успех legacy startup runner недостаточен. API до `listen()` обязан подтвердить catalog columns и indexes auth/audit schema, а также timestamp и SHA-256 hash migrations `0009–0010` в `drizzle.__drizzle_migrations`. Любое расхождение останавливает процесс до polling.

## D-019 — Диагностика только по allowlist, audit только по route templates

Дата: 2026-07-24
Статус: принято в исходниках

Banking health response строится только из явно разрешённых полей; неизвестное новое поле не может автоматически попасть клиенту. Audit path выбирается из registry шаблонов, а любой незарегистрированный путь сворачивается в безопасный placeholder. Значения slug, email, phone, UUID, numeric и percent-encoded identifier в audit не сохраняются.

## D-020 — Rollback 0010 не восстанавливает отозванные sessions

Дата: 2026-07-24
Статус: принято и документировано

Migration `0010` отзывает существующие non-owner sessions. Down migration удаляет scope/audit schema, но не может восстановить отозванные токены. После rollback accountant/viewer должны войти заново; это обязательный шаг runbook, а не дефект, который маскируется SQL.
