# ArtHello OS — Security Checklist

## A.3 live probe

- [x] Владелец явно разрешил временный read-only тест текущими credentials.
- [x] Секреты использовались только в памяти процесса и не сохранялись.
- [x] AlfaCRM auth HTTP 200 и 8 филиалов подтверждены без вывода записей.
- [x] Tochka client credentials HTTP 200; service token получен.
- [x] Accounts с service token получили ожидаемый 403; consent и платежи не создавались.
- [x] Tochka raw upstream bodies/customer identifiers удалены из logs/errors.
- [x] Sanitized live probe имеет limiter, timeout и circuit breaker.
- [x] Sanitized live probe не возвращает реальные branch IDs, токены или upstream records.
- [ ] Завершить AlfaCRM entity coverage после сетевых timeout.
- [ ] Настроить защищённый OAuth callback и получить отдельное пользовательское подтверждение «Точки».
- [ ] Перед production перевыпустить текущие credentials.

## A.2

- [x] AlfaCRM queue сериализует запросы с интервалом 260 ms; unit PASS.
- [x] Параллельная AlfaCRM auth объединяется.
- [x] Bank connector secrets шифруются AES-256-GCM с привязкой к connector ID.
- [x] Plaintext secrets, tampering и неизвестный key ID завершаются fail closed.
- [x] Bank-config migration требует backup ID и explicit confirmation.
- [x] PostgreSQL 16 integration suite подготовлен.
- [x] PostgreSQL 16 suite фактически выполнен в CI run #6: test/build/migrations/rollback/fail-closed PASS.
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
- [x] Добавлена double-submit CSRF-защита для cookie-based write actions.
- [x] Auth/scope migrations `0009–0010` прошли apply/rollback на одноразовом PostgreSQL 16 CI.
- [ ] Перед Replit release повторить migrations на восстановленной репрезентативной sandbox-копии; production не затрагивать.

## Сеть и callbacks

- [x] CORS по умолчанию выключен; allowlist задаётся `APP_ORIGINS`.
- [x] Browser callback Точки остаётся public только с проверкой OAuth state.
- [x] Website, bank и Evotor callbacks закрыты auth-gate до безопасного контракта.
- [x] Website lead handler требует payload-bound `Idempotency-Key`, пишет raw/lead/source одной transaction под advisory lock, возвращает `409` при payload conflict и восстанавливает legacy raw-only partial write.
- [ ] Определить HMAC/signature/mTLS контракт для каждого webhook.
- [ ] Проверить durable replay protection и idempotency всех callbacks.
- [ ] Проверить callback URL после каждого deployment change.
- [x] Hardcoded AlfaCRM tenant fallback удалён; без `ALFACRM_DOMAIN` клиент fail closed.
- [x] AlfaCRM limiter concurrency-safe: serialized queue 260 ms и конкурентный unit-тест.

## Секреты

- [x] В Sites source и artifact нет AlfaCRM или банковских секретов.
- [x] `.env*` и runtime caches исключены из Git.
- [x] Удалён tracked fallback-ключ шифрования Evotor; без `SESSION_SECRET` token operations fail closed.
- [x] Secret-bearing bank connector config шифруется authenticated envelope и plaintext fail closed.
- [ ] Выполнить guarded migration legacy config после проверенного backup и настроить плановую ротацию.
- [ ] Проверить, что error bodies не раскрывают upstream secrets или PII.
- [x] Structured logs очищают token masks, customer codes, raw payload, contacts и Error messages/stacks.
- [x] Banking health response использует strict allowlist; raw body, customer code, authorize URL, token diagnostics и неизвестные будущие поля отбрасываются.
- [ ] Убрать raw error responses из оставшихся legacy API handlers и probes.
- [ ] Провести secret scan в CI.

## Персональные и финансовые данные

- [x] Первый Sites checkpoint содержит только обезличенный аудит.
- [x] Не публикуются дети, родители, сотрудники, зарплаты и операции.
- [x] Введена recursive field-level redaction для structured logs.
- [~] Детальные banking customer/OAuth read endpoints ограничены owner; legacy debug/probe endpoints требуют удаления.
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
- [x] Checkpoint №1: commit `14639db870af9dc69a0702fa33a5a10b2ae8ddc8`, Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_fa731a9248348191902409ebe3f68bde`, deployment `appgdep_6a629f0960fc81918f1e925d0daffd21`, owner-only.
- [x] Checkpoint №1 получил `NO-GO`: risk register был неполным; это не production release.
- [x] Исправленный checkpoint Фазы A: commit `3417a986dc559d5b89ac3d480eb885b3701013e9`, owner-only; Reviewer `PASS`, Coordinator `GO` только для sanitized control surface.
- [x] Checkpoint A.1 cycle 1: commit `41b131659072b083d99a24ca7bf0f0ba38e26c4f`, Sites version №4, owner-only; Reviewer `CONDITIONAL PASS`, Coordinator `CONDITIONAL GO` только на просмотр и `BLOCKED` для runtime/live.
- [x] Checkpoint A.2 v7: commit `5a62864fdb4ba1237eeef5a8b47d9e6f9040cb66`, Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_30b80923a4c88191b4e838e434fdf37f`, deployment `appgdep_6a64b18edf788191a9cf2a2ae41e1982`, owner-only; build PASS, security `21/21`, Sites `8/8`, desktop/mobile preview PASS.

## Gate

Security gate для production/live data: **FAIL / BLOCKED**, пока открыты migration legacy bank config, ротация раскрытых credentials, legacy upstream errors/probes, scoped handlers, provider-auth callbacks, restored-sandbox evidence и обязательные negative/failure tests.

Security gate для обезличенного owner-only Sites checkpoint: **может быть рассмотрен после preview и независимого Reviewer**, но не разрешает Replit release, live integrations или реальные данные.
