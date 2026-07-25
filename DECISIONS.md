# ArtHello OS — Decisions

## D-027 — Tree является ключом идентичности local/remote package

Статус: принято для приватной Git Data history

Local и remote commit SHA могут различаться, потому что remote branch создаётся через Git Data API поверх отдельной истории. Пакет считается содержательно одинаковым только при точном равенстве Git tree. Для каждого checkpoint дополнительно фиксируются private PR head, terminal CI run, Sites version/deployment и owner-only access. PR body обновляется после CI и deployment как внешний provenance manifest; это исключает невозможную самоссылку commit на собственный SHA.

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
