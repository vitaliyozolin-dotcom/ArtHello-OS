# ArtHello OS — Security Checklist

## A.4 data sandbox и новый Tochka client

- [~] `A4-13-01/02/03` исправлены в source candidate `0014`, но не закрыты до финального независимого Reviewer/Coordinator.
- [ ] `QA-A4-02`: текущий candidate `0014` ещё не прошёл wire-protocol suite на PostgreSQL 16 — `TEST_DATABASE_URL` отсутствует. PGlite и source gates PASS; исторический v10 PG16 PASS не является доказательством этого candidate.
- [x] Raw AlfaCRM append-only на уровне БД; UPDATE/DELETE отклоняются trigger.
- [x] Нормализованные AlfaCRM rows требуют существующие raw и batch FK; audit проверяет NULL и orphan anti-join.
- [x] Snapshot reconciliation запускается только для completed scope; partial/repeated/max-guard не tombstone-ят.
- [x] Pagination использует `page` + `pageSize: 50`; transport failure/retry и repeat guard покрыты PGlite.
- [x] Sandbox DB находится вне source checkout; production DB не подключена.
- [x] Реальные payroll rows, имена, формулы и суммы не опубликованы в Sites.
- [x] Payroll formulas сохранены как evidence и не активированы как rules.
- [x] Несопоставленные identities оставлены unresolved; automatic merge отсутствует.
- [x] AlfaCRM importer использует только read endpoints, serialized queue и safe error codes.
- [x] AlfaCRM leads и students разделены; leads не попадают в student/family normalizer.
- [x] Customer tariffs, четыре payment dictionaries и change log сохраняются raw + normalized с idempotent keys и provenance.
- [x] Incremental discovery требует watermark, применяет bounded overlap 1–7 дней и не выдаётся за полную materialization.
- [x] Migrations `0013–0014` применены только к отдельной sandbox-БД; перед `0014` сохранена отдельная копия и подготовлен rollback companion.
- [x] Семьи создаются только как manual-review candidates.
- [x] Свежий failed Alfa run записал безопасный batch status без provider body/PII.
- [x] Новый Tochka client secret использовался только в памяти одноразового процесса и не сохранён в source, Git, Sites или logs.
- [x] Token HTTP 200 и accounts HTTP 403 подтверждены без consent и bank records.
- [x] OAuth redirect validator запрещает Sites, HTTP, root path и неточный callback.
- [x] Сохранение encrypted bank connector config завершается fail closed при ошибке persistence.
- [x] Login больше не показывает публичный role/account selector или default owner identifier.
- [ ] Настроить exact protected backend callback и persistent state store.
- [ ] Выполнить backup/restore/rollback до сохранения hybrid bank credentials.
- [ ] Пройти OAuth только с read-only permissions; payment actions запрещены.
- [ ] Перевыпустить все credentials, раскрытые в сообщениях и скриншотах, после end-to-end проверки.
- [ ] Выпустить и внешне перепроверить noindex/auth изменения в публичном Replit.
- [~] Agent preview runtime здоров, но exact preview URL возвращает gateway 502 и browser-инструмент недоступен; 10 Sites tests с navigation/mobile contracts PASS, интерактивная desktop/mobile проверка текущего candidate не выполнена.

## A.3 live probe

- [x] Владелец явно разрешил временный read-only тест текущими credentials.
- [x] Секреты использовались только в памяти процесса и не сохранялись.
- [x] AlfaCRM auth HTTP 200 и 8 филиалов подтверждены без вывода записей.
- [x] Tochka client credentials HTTP 200; service token получен.
- [x] Accounts с service token получили ожидаемый 403; consent и платежи не создавались.
- [x] Tochka raw upstream bodies/customer identifiers удалены из logs/errors.
- [x] Sanitized live probe имеет limiter, timeout и circuit breaker.
- [x] Sanitized live probe не возвращает реальные branch IDs, токены или upstream records.
- [ ] Завершить live AlfaCRM entity coverage после сетевых timeout и проверить counts/dates/orphans для новых обязательных сущностей.
- [ ] Настроить защищённый OAuth callback и получить отдельное пользовательское подтверждение «Точки».
- [ ] Перед production перевыпустить текущие credentials.

## A.2

- [x] AlfaCRM queue сериализует запросы с интервалом 260 ms; unit PASS.
- [x] Параллельная AlfaCRM auth объединяется.
- [x] Bank connector secrets шифруются AES-256-GCM с привязкой к connector ID.
- [x] Plaintext secrets, tampering и неизвестный key ID завершаются fail closed.
- [x] Bank-config migration требует backup ID и explicit confirmation.
- [x] PostgreSQL 16 integration suite подготовлен.
- [x] PostgreSQL 16 suite фактически выполнен в историческом checkpoint v10, CI run #8: test/build/migrations/rollback/fail-closed PASS.
- [x] Candidate workflow закреплён на exact PR head и экспортирует immutable `head_sha/tree_sha` provenance artifact.
- [ ] Раскрытые AlfaCRM и Tochka credentials перевыпущены.
- [ ] Новые credentials сохранены только в protected backend Secrets.

Дата: 2026-07-24
Обозначения: `[x]` выполнено в исходниках, `[~]` частично/требует выпуска, `[ ]` открыто.

## Публичная поверхность

- [x] Демо-реквизиты удалены из login page.
- [x] Hardcoded fallback-пароли удалены из API.
- [x] `VIEWER_PASSWORD` также требуется из защищённого environment.
- [x] HTML использует `noindex, nofollow, noarchive, nosnippet`.
- [x] `robots.txt` запрещает crawling.
- [x] API и Sites добавляют `X-Robots-Tag`.
- [x] `x-powered-by` отключён.
- [~] Изменения ещё не выпущены в публичный Replit runtime.

## Аутентификация и авторизация

- [x] Все API-маршруты закрыты общим auth-gate по умолчанию.
- [x] Browser frontend не хранит bearer token в `localStorage`.
- [x] Session token передаётся HttpOnly/Secure/SameSite cookie и хранится в БД только как hash.
- [x] `/auth/users` доступен только owner.
- [x] Пароли короче 12 символов игнорируются конфигурацией.
- [x] Login принимает только JSON и использует PostgreSQL rate limiting/lockout.
- [x] Добавлены role-level permissions для owner/accountant/viewer.
- [x] Non-owner accounts требуют непустые branch и legal-entity scope lists.
- [x] Все non-owner business routes fail closed до handler-level scope predicates.
- [ ] Реализовать route-specific branch/legal-entity predicates и cross-scope tests.
- [x] Добавлены cross-scope negative tests, подтверждающие, что неподготовленные non-owner handlers остаются недоступны.
- [x] Добавлена double-submit CSRF-защита для cookie-based write actions.
- [x] Auth/scope migrations `0009–0010` прошли apply/rollback на одноразовом PostgreSQL 16 CI.
- [ ] Перед Replit release повторить migrations на восстановленной репрезентативной sandbox-копии; production не затрагивать.

## Сеть и callbacks

- [x] CORS по умолчанию выключен; allowlist задаётся `APP_ORIGINS`.
- [x] Browser callback Точки остаётся public только с проверкой OAuth state.
- [x] Bank и Evotor callbacks закрыты auth-gate; website callback открыт только через HMAC/replay boundary.
- [x] Website lead handler требует payload-bound `Idempotency-Key`, пишет raw/lead/source одной transaction под advisory lock, возвращает `409` при payload conflict и восстанавливает legacy raw-only partial write.
- [x] Общая fail-closed граница и отдельные website/bank/Evotor контракты спроектированы в `docs/security/webhook-authentication.md`; website adapter подключён, остальные providers закрыты без официальных test vectors.
- [x] Website HMAC проверяет exact raw-body digest, explicit current/previous key ID, timestamp и event ID до JSON parsing; PostgreSQL replay claim использует unique hash и advisory transaction lock. Missing/invalid keyring, tamper, stale timestamp, replay conflict и DB outage покрыты fail-closed тестами; HTTP accept/duplicate/conflict доказаны на PostgreSQL 16.
- [x] Public allowlist содержит только HMAC-защищённый website POST callback; payload conflict/retry покрыты отдельно.
- [ ] Проверить callback URL после каждого deployment change.
- [x] Hardcoded AlfaCRM tenant fallback удалён; без `ALFACRM_DOMAIN` клиент fail closed.
- [x] AlfaCRM limiter concurrency-safe: serialized queue 260 ms и конкурентный unit-тест.

## Секреты

- [x] В Sites source и artifact нет AlfaCRM или банковских секретов.
- [x] `.env*` и runtime caches исключены из Git.
- [x] Удалён tracked fallback-ключ шифрования Evotor; без `SESSION_SECRET` token operations fail closed.
- [x] Secret-bearing bank connector config шифруется authenticated envelope и plaintext fail closed.
- [ ] Выполнить guarded migration legacy config после проверенного backup и настроить плановую ротацию.
- [x] Public 5xx response boundary заменяет exception/upstream/PII details фиксированным `INTERNAL_ERROR`; canary regression PASS.
- [x] Structured logs очищают token masks, customer codes, raw payload, contacts и Error messages/stacks.
- [x] Banking health response использует strict allowlist; raw body, customer code, authorize URL, token diagnostics и неизвестные будущие поля отбрасываются.
- [~] Историческая `/sync` поверхность fail closed кодом `LEGACY_SYNC_DISABLED`; недоступный legacy code удалить только после restored-sandbox замены.
- [~] Canary tests проверяют response/log/Sites redaction; полноценный repository secret scanner ещё не добавлен.

## Персональные и финансовые данные

- [x] Первый Sites checkpoint содержит только обезличенный аудит.
- [x] Не публикуются дети, родители, сотрудники, зарплаты и операции.
- [x] Введена recursive field-level redaction для structured logs.
- [~] Детальные banking customer/OAuth read endpoints ограничены owner; legacy debug/probe endpoints требуют удаления.
- [x] Legacy `/sync` logs/probes/writes недоступны на API boundary до проектирования новой scoped поверхности.
- [ ] Утвердить retention и deletion policy для raw events/statements.
- [x] Sensitive access audit реализован fail closed; registry шаблонов скрывает slug/email/phone/UUID/numeric/percent-encoded identifiers.
- [~] Access audit migration/runtime не проверены в sandbox.
- [ ] Провести threat model identity resolution семей.

## БД и миграции

- [x] В Фазе A production-миграции не выполнялись.
- [x] Зафиксирована необходимость backup/restore test до миграции.
- [x] Auth schema оформлена отдельной migration `0009` и не встроена в legacy startup runner.
- [x] Rollback companion для `0009` выполнен на одноразовом PostgreSQL 16 CI; production не затрагивался.
- [x] Migration `0010` и rollback companion выполнены на одноразовом PostgreSQL 16 CI; production не затрагивался.
- [x] Migration error больше не поглощается; listener и polling fail closed в исходниках.
- [x] Pre-listen gate проверяет auth/audit columns, indexes и точные timestamp+hash migrations `0009–0010`.
- [x] Rollback `0010` явно документирует, что отозванные non-owner sessions не восстанавливаются и нужен повторный вход.
- [ ] Доказать migration failure-path, apply, HTTP/PG smoke и rollback на sandbox.
- [ ] Ограничить production DB credentials read/write ролями.
- [ ] Проверить TLS к БД.
- [ ] Проверить RPO/RTO и восстановление snapshot.

## Sites

- [x] Используется единственный project `arthello-os-control`.
- [x] Project ID сохранён в `.openai/hosting.json`.
- [x] Доступ подтверждён как owner-only.
- [x] Control surface не обращается к production API.
- [x] Worker выставляет CSP с `frame-ancestors` только для self/ChatGPT, no-referrer и no-store.
- [x] Для checkpoint v7 выполнены desktop/mobile preview, CTA, навигация и drawer.
- [x] Исторический checkpoint v10: source commit `8735824a214e980ff9cb492fa7253959ab6c2123`, Sites version 10, deployment `appgdep_6a64d3b5e134819193ba100f503db92d`, owner-only; Reviewer `CONDITIONAL PASS`, Coordinator `CONDITIONAL GO` только для sanitized оболочки.
- [x] Checkpoint №1: commit `14639db870af9dc69a0702fa33a5a10b2ae8ddc8`, Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_fa731a9248348191902409ebe3f68bde`, deployment `appgdep_6a629f0960fc81918f1e925d0daffd21`, owner-only.
- [x] Checkpoint №1 получил `NO-GO`: risk register был неполным; это не production release.
- [x] Исправленный checkpoint Фазы A: commit `3417a986dc559d5b89ac3d480eb885b3701013e9`, owner-only; Reviewer `PASS`, Coordinator `GO` только для sanitized control surface.
- [x] Checkpoint A.1 cycle 1: commit `41b131659072b083d99a24ca7bf0f0ba38e26c4f`, Sites version №4, owner-only; Reviewer `CONDITIONAL PASS`, Coordinator `CONDITIONAL GO` только на просмотр и `BLOCKED` для runtime/live.
- [x] Checkpoint A.2 v7: commit `5a62864fdb4ba1237eeef5a8b47d9e6f9040cb66`, Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_30b80923a4c88191b4e838e434fdf37f`, deployment `appgdep_6a64b18edf788191a9cf2a2ae41e1982`, owner-only; build PASS, security `21/21`, Sites `8/8`, desktop/mobile preview PASS.

## Gate

Security gate для production/live data: **FAIL / BLOCKED**, пока открыты migration legacy bank config, ротация раскрытых credentials, удаление недоступного legacy code, scoped handlers, provider-auth callbacks, restored-sandbox evidence и обязательные provider/runtime negative/failure tests.

Security gate для обезличенного owner-only Sites checkpoint: **может быть рассмотрен после preview и независимого Reviewer**, но не разрешает Replit release, live integrations или реальные данные.
