# ArtHello OS — Security Checklist

## A.11 exact v28 / owner-session evidence

- [x] Commit `025f82973807c03c90c558136b3a508aa17ed345`,
  tree `6fa44f49c99c9f21e05550ae8621f61a87dce4a1`, Sites v28 и deployment
  `appgdep_6a66b291be588191909e6daff1fc23d1` зафиксированы.
- [x] Deployment terminal `succeeded`; access повторно подтверждён как
  `custom / 1 owner / 0 groups`.
- [x] Environment revision 5 содержит owner email, совпадающий с sole allowed
  Sites account; значение не встроено во frontend.
- [x] Официальный Sites identity contract использует
  `oai-authenticated-user-email`.
- [x] Machine bypass удаляет caller-spoofed identity; insecure fallback/debug
  route не добавлялись.
- [x] Owner API unit matrix: configured owner `200`, missing/foreign `403`.
- [x] Full local gate PASS: typecheck, build, data `62`, security `31`, Sites
  `22`, Front Office `47`, diff check.
- [x] Desktop agent preview и основные переходы PASS; application console
  errors отсутствуют.
- [~] Mobile static contracts PASS; отдельный cloud viewport harness запрещён
  browser policy и не обходился.
- [x] Post-deploy safe status не раскрывает PII/суммы/идентификаторы и
  маркирует rows как `legacy_unattested`.
- [ ] Владелец подтверждает на своём устройстве production owner API `200`.
- [ ] Свежий Reviewer и Coordinator закрывают третий цикл без HIGH.
- [ ] Новый protected atomic snapshot публикуется только после отдельного
  informed approval.

## A.10 server attestation / owner identity

- [x] Exact v27 зафиксирован; Reviewer `FAIL`, Coordinator `NO-GO`, новый PII import запрещён.
- [x] Terminal Alfa gate требует `full_sandbox_read_only` и полный scope inventory.
- [x] Completed incremental discovery отвергается отдельным negative test.
- [x] Worker пересчитывает SHA-256 из staged rows и не доверяет присланному 64-hex.
- [x] Same-count row tampering, arbitrary digest и missing dataset возвращают `409`; предыдущий active snapshot сохраняется.
- [x] Row order не влияет на digest.
- [x] Staging блокируется после перехода batch в `verifying`.
- [x] Legacy state раскрывается как `legacy_unattested` и `atomicSnapshot=false`.
- [x] Protected owner identity согласована с единственным Sites user; access остаётся `custom / 1 / 0`.
- [x] Owner API unit matrix: владелец `200`, missing/foreign identity `403`.
- [x] UI валидирует массивы ответов и не выводит raw exception message.
- [x] Local PASS: typecheck, full build, data `62`, security `31`, Sites `22`, Front Office `47`.
- [x] Agent preview desktop: пульс, quality, employees, System, Front Office, Integration drawer и возврат PASS; raw app console errors отсутствуют.
- [~] Mobile static responsive/navigation contracts PASS; cloud-browser policy не разрешила отдельный viewport harness.
- [ ] Новый exact owner-only deployment получил `succeeded`.
- [ ] Production owner APIs возвращают `200`, deny-сценарии подтверждены без PII/секретов в evidence.
- [ ] Новый Reviewer не имеет открытых HIGH; новый Coordinator разрешил handoff.
- [ ] Protected payroll v5 повторно публиковать только после отдельного информированного approval.

## A.9 atomic publication correction

- [x] V25 PII import остановлен до сетевой отправки; инцидента раскрытия не зафиксировано.
- [x] Full-mode требует terminal gate, completed batch, failed entities `0`, incomplete scopes `0` и согласованный Alfa status.
- [x] Partial-mode физически запрещает строки во всех восьми operational AlfaCRM datasets.
- [x] Publication manifest фиксирует полный набор из 14 datasets, expected counts и SHA-256 payload.
- [x] Staging не влияет на active read-model до commit.
- [x] D1 batch атомарно заменяет datasets, переключает active snapshot и пишет audit; constraint failure откатывает всё.
- [x] Legacy live import закрыт `410 ATOMIC_SNAPSHOT_REQUIRED`.
- [x] Machine status раскрывает только batch ID, digest, counts/status и признак atomic snapshot; PII и суммы не возвращаются.
- [x] Полный quality run: typecheck/build, security `31`, data `60`, Sites `17`, Front Office `47`.
- [x] Agent preview daemon перезапущен и `running`; live URL внутри не открывался, cloud route 502 зафиксирован как ограничение QA.
- [x] V26: commit `8482395a…`, tree `7ffcbed6…`, terminal deployment `appgdep_6a66a6a4d90c8191bb54af36d4e84523` = `succeeded`.
- [x] Повторная owner-only policy verification: `custom`, 1 owner, 0 groups.
- [x] Safe status: money missing/mismatch `0`; Alfa operational rows `0`; payment actions false.
- [ ] Существующие legacy payroll rows имеют counts `114/842/1318/1855/36`, но active atomic batch отсутствует; повторно публиковать только после явного PII approval.
- [ ] Новый независимый Ревизор и Координатор проверяют одну exact version.
- [ ] Реальные payroll rows не публиковать без отдельного информированного owner approval.

## A.8 branch identity и split publication

- [x] AlfaCRM identities и joins используют `branch_crm_id + crm_id`.
- [x] Branch migrations `0017–0018` применялись только к sandbox после backup mode `600`; additive `0019` сводит migration fork без изменения production.
- [x] Raw/observation/batch/scope/page provenance сохранён; broken provenance = 0.
- [x] Rollback companions завершаются fail closed при потере branch-scoped identity.
- [x] Family candidates остаются `pending_review`; confirmed = 0; automatic merge = false.
- [x] Partial Alfa режим физически выдаёт 0 operational CRM rows и только allowlisted aggregate counts/status.
- [x] Проверенный payroll допускается независимо только в owner-only Sites; source/formulas/secrets не встраиваются.
- [x] Protected export v5 хранится вне checkout с mode `600`; bank/source secrets included = false.
- [x] Money source-to-minor mismatches = 0; rules/taxes/financial calculations remain disabled.
- [x] Safe Alfa probe не выполнил domain read/write и вернул `auth_request_timeout`; secrets/PII не напечатаны.
- [x] Local PASS объединённой версии: 57 scripts/data tests, 31 security test, 16 Sites/Worker tests, 47 Front Office tests и полный build/typecheck.
- [x] Publisher partial-mode отвергает любую операционную AlfaCRM row и требует точные fail-closed status flags.
- [~] Agent preview healthy; интерактивный browser QA недоступен из-за отсутствующего cloud-browser runtime, static responsive/navigation contracts PASS.
- [x] Повторно подтвердить Sites access policy: custom, 1 owner, 0 groups перед deployment.
- [x] Выполнить полный monorepo quality/security/build gate.
- [x] V25 deployment terminal `succeeded`; PII import не выполнялся, поэтому deployed payroll counters не заявляются как v5.
- [ ] Получить PASS/CONDITIONAL PASS Ревизора и разрешение Координатора.
- [ ] Завершить AlfaCRM batch и разобрать 1 125 source-linkage issues до публикации CRM rows.
- [ ] После end-to-end проверки перевыпустить временно раскрытые AlfaCRM/Tochka credentials.

## A.7 exact money и runtime status

- [x] Авторитетные денежные поля представлены safe integer minor units; scale = 2.
- [x] Source-to-minor reconciliation для payroll export: mismatches = 0.
- [x] UI форматирует копейки строковым способом и всегда показывает две цифры после запятой.
- [x] Legacy `REAL` неавторитетен; новые financial calculations выключены.
- [x] Machine status выдаёт только безопасные counts для missing/mismatched minor rows, без сумм и PII.
- [x] Publisher завершится fail closed, если любой money counter или source reconciliation не равен нулю.
- [x] D1 migration `0003_harsh_forge.sql` аддитивна; production PostgreSQL/Replit не изменялись.
- [x] Статический OAuth status удалён; фактический status «Точки» берётся из runtime API.
- [x] Последняя machine verification: `active`, 16 счетов, error code отсутствует, payment actions false.
- [x] Partial AlfaCRM export повторно отклонён `ALFACRM_TERMINAL_SNAPSHOT_REQUIRED`.
- [x] Post-deploy 500 v17 не скрыт; повторная передача payroll остановлена, machine audit разбит на два bounded batches.
- [x] Local PASS: typecheck, full build, 31 API security tests, 34 data/import tests, 13 Sites/Worker tests.
- [~] Agent preview healthy; cloud browser заблокирован инфраструктурно, поэтому визуальный desktop/mobile QA ограничен static/responsive contract tests.
- [ ] Подтвердить terminal owner-only correction checkpoint и неизменную access policy.
- [ ] Подтвердить deployed money counters = 0 после повторной публикации payroll.
- [ ] Получить PASS нового Ревизора и разрешение нового Координатора.
- [ ] Возобновить AlfaCRM только после защищённого предоставления трёх credentials.

## A.6 resumable import и расширенная read-модель

- [x] Resume требует явный `ALFACRM_RESUME_RUNNING_BATCH=1` и не переключается на другой mode/batch.
- [x] Completed scopes не читаются повторно; incomplete scopes не считаются нулевым покрытием.
- [x] Batch completion и family candidate build блокируются при любом incomplete scope.
- [x] AlfaCRM importer по-прежнему содержит только read endpoints.
- [x] Teacher/payroll, class и extra-lesson признаки помечены review-only; automatic merge/rule activation отсутствуют.
- [x] Налоги имеют `not_sourced`; ставки, базы, взносы и суммы не придуманы.
- [x] Machine status использует фиксированный aggregate allowlist без PII, сумм, account IDs, номеров счетов и токенов.
- [x] Publisher больше не подделывает owner email и сверяет точные dataset counts через machine status.
- [x] D1 migration `0002_familiar_blockbuster.sql` аддитивна и относится только к Sites; production migrations не выполнялись.
- [x] Local PASS: typecheck, full build, 31 API security tests, 33 data tests, 12 Sites/Worker tests.
- [~] Agent preview server healthy; cloud browser access заблокирован инфраструктурно, поэтому interactive desktop/mobile QA текущего candidate не завершён.
- [ ] Подтвердить terminal owner-only checkpoint status и неизменный access policy.
- [ ] Машинно подтвердить Tochka status/account count без чтения detailed bank data.
- [ ] Завершить AlfaCRM full batch и integrity audit до публикации операционных rows.
- [ ] Перевыпустить временно раскрытые AlfaCRM/Tochka credentials после end-to-end проверки.

## A.5 owner-only real data gate

- [x] Sites access policy подтверждена: `custom`, 1 allowed user, 0 groups.
- [x] Owner API fail closed без `oai-authenticated-user-email`; negative test возвращает `403`.
- [x] Read-model import использует отдельный secret, fixed datasets/columns, maximum 100 rows и не доверяет frontend.
- [x] Runtime secrets сохранены только в Sites protected environment; `.openai/hosting.json`, Git и frontend их не содержат.
- [x] Frontend не содержит embedded персональных, зарплатных или банковских строк.
- [x] D1 read-модель минимизирована; raw AlfaCRM, исходные payroll rows/formulas и source credentials не публикуются.
- [x] Просмотры owner API и imports журналируются в `sensitive_access_audit` без PII, сумм, search query и secrets.
- [x] Номер банковского счёта маскируется; provider account ID заменяется SHA-256 key до хранения/выдачи.
- [x] Банковские tokens шифруются AES-GCM 256-bit key из protected environment; cleartext token не возвращается API.
- [x] OAuth state хранится только как SHA-256 hash и очищается после success/failure code exchange.
- [x] OAuth scopes ограничены `accounts balances customers statements`; consent permissions только Read*.
- [x] Source/tests не содержат payment scope, payment route или действие создания/подписания платежа.
- [x] `Expected` не используется как остаток; test подтверждает приоритет `ClosingAvailable`, отсутствие инверсии знака и unknown при недоступном balance type.
- [x] Технические подключения вынесены в «Систему»; «Деньги» не инициирует OAuth или платежи.
- [x] Реальные зарплатные данные помечены как source evidence; formulas/KPI/rules не активированы.
- [x] Семьи остаются manual-review candidates; automatic merge отсутствует.
- [x] `LEGAL_DATA_CHECKLIST.md` фиксирует 152‑ФЗ/банковскую тайну/retention/incidents как открытые юридические вопросы, не как собственное заключение.
- [x] Local PASS: typecheck, full build, 31 API security, 32 data import и 11 Sites tests.
- [~] Agent preview runtime здоров, но browser policy блокирует страницу до загрузки; интерактивный desktop/mobile QA не выполнен.
- [ ] Завершить AlfaCRM terminal report + integrity audit до публикации read-модели.
- [ ] Создать owner-only checkpoint и напрямую подтвердить terminal deployment status.
- [ ] Проверить deployed aggregate APIs без чтения/печати PII во внутреннем процессе.
- [ ] Пройти owner consent «Точки» и проверить real multi-customer accounts/balances.
- [ ] Перевыпустить раскрытые AlfaCRM/Tochka credentials после end-to-end проверки.
- [ ] Закрыть юридические и retention пункты до расширения аудитории или длительного production-режима.

## A.4 data sandbox и новый Tochka client

- [~] `A4-13-01/02/03` исправлены в source candidate `0014–0015`, но не закрыты до финального независимого Reviewer/Coordinator.
- [ ] `QA-A4-02`: текущий candidate `0014–0015` ещё не прошёл wire-protocol suite на PostgreSQL 16. PGlite и source gates PASS; исторический v10 PG16 PASS не является доказательством этого candidate.
- [x] Raw AlfaCRM append-only на уровне БД; UPDATE/DELETE отклоняются trigger.
- [x] Нормализованные AlfaCRM rows требуют существующие raw и batch FK; audit проверяет NULL и orphan anti-join.
- [x] Snapshot reconciliation запускается только для completed scope; partial/repeated/max-guard не tombstone-ят.
- [x] Pagination использует `page` + `pageSize: 50`; transport failure/retry и repeat guard покрыты PGlite.
- [x] Sandbox DB находится вне source checkout; production DB не подключена.
- [x] В A.4 реальные payroll rows, имена, формулы и суммы не публиковались; A.5 отдельно разрешает минимальную owner-only read-модель без raw/formulas.
- [x] Payroll formulas сохранены как evidence и не активированы как rules.
- [x] Несопоставленные identities оставлены unresolved; automatic merge отсутствует.
- [x] AlfaCRM importer использует только read endpoints, serialized queue и safe error codes.
- [x] AlfaCRM leads и students разделены; leads не попадают в student/family normalizer.
- [x] Customer tariffs, четыре payment dictionaries и change log сохраняются raw + normalized с idempotent keys и provenance.
- [x] Incremental discovery требует watermark, применяет bounded overlap 1–7 дней и не выдаётся за полную materialization.
- [x] Migrations `0013–0014` применены только к отдельной sandbox-БД; перед `0014` сохранена отдельная копия и подготовлен rollback companion.
- [x] Семьи создаются только как manual-review candidates.
- [x] Свежий failed Alfa run записал безопасный batch status без provider body/PII.
- [x] Новый Tochka client secret отсутствует в source/Git/frontend/logs; в A.5 сохранён как protected Sites environment secret по разрешению владельца.
- [x] Token HTTP 200 и accounts HTTP 403 подтверждены без consent и bank records.
- [x] Legacy redirect validator запрещает static Sites; A.5 server-side Worker принимает exact registered HTTPS root по D-039.
- [x] Сохранение encrypted bank connector config завершается fail closed при ошибке persistence.
- [x] Login больше не показывает публичный role/account selector или default owner identifier.
- [x] Настроить exact protected Sites Worker callback и persistent D1 state store.
- [ ] Выполнить backup/restore/rollback до сохранения hybrid bank credentials.
- [ ] Пройти OAuth только с read-only permissions; payment actions запрещены.
- [ ] Перевыпустить все credentials, раскрытые в сообщениях и скриншотах, после end-to-end проверки.
- [ ] Выпустить и внешне перепроверить noindex/auth изменения в публичном Replit.
- [~] Agent preview runtime здоров, но облачный браузер блокирует внутреннюю страницу до загрузки (`ERR_BLOCKED_BY_CLIENT`); 11 Sites tests с worker/D1, owner/import, OAuth, navigation и mobile contracts PASS, интерактивная desktop/mobile проверка текущего candidate не выполнена.

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
- [x] Website, bank и Evotor callbacks закрыты auth-gate до безопасного контракта.
- [x] Website lead handler требует payload-bound `Idempotency-Key`, пишет raw/lead/source одной transaction под advisory lock, возвращает `409` при payload conflict и восстанавливает legacy raw-only partial write.
- [ ] Определить HMAC/signature/mTLS контракт для каждого webhook.
- [ ] Проверить durable replay protection и idempotency всех callbacks.
- [x] Negative source test подтверждает, что provider POST callbacks не добавлены в public allowlist; website payload conflict/retry покрыты.
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
