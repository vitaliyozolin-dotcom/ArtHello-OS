# ArtHello OS — Decisions

## D-058 — V28 не переаттестует legacy PII автоматически

Статус: принято для exact checkpoint v28

Успешный code deployment не является разрешением повторно отправить protected
payroll snapshot. Пока отдельное информированное подтверждение не получено,
существующие D1 rows остаются `legacy_unattested`, operational AlfaCRM datasets
остаются пустыми, а digest-bound atomic publication не запускается.

## D-057 — Не ослаблять owner API ради машинного bypass

Статус: принято для exact checkpoint v28

Официальный Sites identity header —
`oai-authenticated-user-email`. Protected owner email и sole allowed account
совпадают. Машинный bypass удаляет caller-supplied identity headers, а
служебный renderer не является owner session. Поэтому bypass `403` не
устраняется fallback-заголовком, query token, debug route или разрешением
любой непустой identity. Серверная проверка остаётся fail closed. Реальный
owner-browser `200` подтверждает только владелец на своём устройстве; до этого
это явно открытое verification evidence.

## D-056 — Incremental AlfaCRM никогда не является terminal snapshot

Дата: 2026-07-26
Статус: принято после FAIL v27

Full operational publication требует source `mode = full_sandbox_read_only`, `completed`, ненулевой согласованный inventory, `entitiesSucceeded = entitiesRequested = scopeRuns`, failed/incomplete `0`. `incremental_discovery_read_only` используется только для change discovery и не может провести прежнее normalized state как свежую полную materialization.

## D-055 — Owner API и Sites allowlist используют одну identity

Дата: 2026-07-26
Статус: принято после FAIL v27

`ARTHELLO_OWNER_EMAIL` обязан точно совпадать с единственным разрешённым Sites-пользователем. Изменение выполняется только в protected environment; frontend, Git и `.openai/hosting.json` identity не хранят. Access остаётся `custom / 1 user / 0 groups`; отсутствие или чужая identity всегда `403`.

## D-054 — Digest считается Worker из staged rows

Дата: 2026-07-26
Статус: принято после FAIL v27

Присланный payload digest является только ожидаемым manifest. До live transaction Worker блокирует batch в `verifying`, заново проецирует и канонизирует каждую staged row, вычисляет per-dataset SHA-256 и общий digest, сверяет их с manifest и сохраняет отдельный `computed_digest`. При любом mismatch — `409`, live rows и прежний active batch не меняются. Порядок строк не влияет на digest.

## D-053 — Read-model переключать только атомарным snapshot

Дата: 2026-07-26
Статус: принято после FAIL v25

Последовательная замена live datasets запрещена. Publisher создаёт manifest всех 14 datasets с expected counts и SHA-256 payload, загружает строки в generic staging и только после полной сверки вызывает commit. Один D1 transactional batch заменяет live tables, переключает active publication, пишет безопасный audit и удаляет staging. При любом constraint/query failure транзакция откатывается, а предыдущий active snapshot остаётся целиком. Legacy per-dataset endpoint отвечает `410`.

## D-052 — Full publication требует независимого terminal evidence

Дата: 2026-07-26
Статус: принято после FAIL v25

Строка `dataMode` не является доказательством завершённой AlfaCRM выгрузки. Full owner-only publication требует одновременно safety flag `alfaTerminalGatePassed = true`, source batch `completed`, `entitiesFailed = 0`, `incompleteScopes = 0`, `operationalRowsPublished = true` и согласованный `sync_status` с `real_read_only_terminal`. Невыполнение любого условия завершает publisher fail closed. Partial split остаётся отдельным режимом с физически пустыми operational AlfaCRM datasets.

## D-051 — Диагностические кандидаты семей не являются подтверждёнными семьями

Дата: 2026-07-26
Статус: принято

После branch-scoped migration кандидаты семей разрешено воспроизводимо перестраивать в sandbox из уже сохранённых immutable observations для проверки схемы и очереди ручного разбора. При незавершённом AlfaCRM batch они остаются `pending_review`, не публикуются в Sites и не считаются полным покрытием. После terminal batch кандидаты строятся повторно. Ни один слабый признак не подтверждает семью автоматически.

## D-050 — Проверенный payroll публиковать независимо от частичного AlfaCRM

Дата: 2026-07-26
Статус: принято для owner-only checkpoint

Terminal AlfaCRM gate продолжает блокировать любые операционные строки CRM. Он не должен блокировать отдельный, уже сверенный payroll source. Явный режим `owner_authorized_payroll_only` разрешает экспорт реальных payroll rows только в подтверждённый owner-only Sites, одновременно передавая по AlfaCRM только безопасные агрегированные counts/status. Экспортер и publisher обязаны физически требовать ноль строк branches/students/families/groups/teachers/rates/lessons/payments AlfaCRM, точный status `partial_aggregate_no_rows` и false-флаги `partialAlfaRowsPublished`/`operationalRowsPublished`/`alfaTerminalGatePassed`. Финансовые правила, налоги и межисточниковые связи не активируются.

## D-049 — Расхождения источника показывать, а не превращать в зелёный статус

Дата: 2026-07-26
Статус: принято

Терминальный `completed` batch доказывает завершение всех scope, но сам по себе не доказывает связность данных провайдера. Owner read-модель отдельно считает orphan membership, attendance, tariff и family-candidate связи. При ненулевом результате AlfaCRM получает статус `attention`, а центр качества показывает точное количество. Строки остаются доступны владельцу для проверки; ДДС, ОПиУ, зарплатные правила и финансовые выводы по расхождениям не активируются.

## D-048 — Идентификаторы AlfaCRM являются branch-scoped

Дата: 2026-07-26
Статус: принято после фактического integrity audit

Аудит immutable raw-наблюдений доказал повторное использование одних CRM-ID в разных филиалах. Поэтому ученики, профили, группы, педагоги, оплаты, занятия и посещаемость идентифицируются составным ключом `branch_crm_id + crm_id`; joins и Sites row IDs также включают филиал. Кандидат семьи хранит составную идентичность обоих учеников и остаётся только ручной гипотезой.

После объединения с независимым Front Office-срезом его migration сохраняет номер `0016`, а sandbox migrations AlfaCRM перенумерованы в `0017–0018`. `0017` fail closed при отсутствии филиального provenance и backfill-ит филиал посещаемости только из точного immutable observation. `0018` сохраняет однозначные reviewed family decisions, блокирует неоднозначные reviewed decisions и может удалить только неоднозначные `pending_review/stale` производные кандидаты, которые затем воспроизводимо перестраиваются. Additive `0019` сходится для обеих историй конкурентных migrations и не переписывает business data. Перед каждой миграцией обязателен backup; rollback блокируется, если потерял бы branch-scoped identity.

## D-047 — Интерфейс показывает фактический runtime status источника

Дата: 2026-07-26
Статус: принято

Статический HTML не является источником статуса подключения. «Точка», AlfaCRM и payroll отображаются по ответу защищённого runtime API; недоступный ответ показывается как неизвестный/ошибка, но не заменяется старым optimistic текстом. Последняя безопасная machine verification «Точки»: `active`, 16 счетов, без error code, только read-only, payment actions выключены.

## D-046 — Денежные значения owner read-модели хранить в minor units

Дата: 2026-07-26
Статус: принято после FAIL v16

Авторитетное денежное представление — safe integer в копейках с масштабом 2. Legacy `REAL`-колонки допускаются только для обратной совместимости и не участвуют в новых расчётах. Экспорт выполняет source-to-minor сверку каждой строки; publisher требует mismatches = 0, а deployed machine status — ноль отсутствующих minor полей и ноль legacy reconciliation mismatches. UI показывает ровно две цифры после запятой без binary-float arithmetic. Финансовые расчёты остаются выключены до отдельной модели на minor/decimal типах.

## D-045 — Налоги не рассчитывать без подтверждённого источника

Дата: 2026-07-26
Статус: принято

Зарплатная таблица подтверждает строки начислений и выплат, но не даёт достаточного источника для налоговых ставок, баз, льгот и страховых взносов. До отдельного подтверждённого источника налоговый контур имеет статус `not_sourced`; никакие ставки и суммы не достраиваются.

## D-044 — Классификации и кадровые связи являются кандидатами

Дата: 2026-07-26
Статус: принято

Точное совпадение ФИО педагога AlfaCRM и сотрудника payroll, наличие слова «класс» в названии группы и keywords дополнительного занятия создают только review candidates. Они не являются authoritative связью, типом группы, кадровой ставкой или зарплатным правилом до ручного подтверждения.

## D-043 — Прерванный full import продолжать только явно

Дата: 2026-07-26
Статус: принято

`ALFACRM_RESUME_RUNNING_BATCH=1` продолжает только последний running full batch в той же sandbox-БД. Завершённые scopes пропускаются, незавершённые перечитываются. Без явного флага создаётся новый batch. Batch не получает `completed`, а family candidates не строятся, пока существует incomplete scope.

## D-042 — Машинная проверка Sites использует только безопасный агрегат

Дата: 2026-07-26
Статус: принято

Publisher и deployment verification не подделывают owner email. Машинный endpoint доступен только через owner-only Sites perimeter или его защищённый bypass и возвращает фиксированный агрегат: counts, безопасный статус/время банка и error code. PII, суммы, account identifiers, токены и detailed payroll evidence остаются только в owner endpoints.

## D-041 — Остаток «Точки» не выводится из направления операции

Статус: принято для read-only банковского среза

В owner dashboard текущим доступным остатком считается документированный balance type `ClosingAvailable`; `Expected` является заблокированной суммой и не используется как остаток. `CreditDebitIndicator` не инвертирует знак balance amount: направление применяется только к операциям выписки. Если `ClosingAvailable` отсутствует, допускается `OpeningAvailable`; остальные типы и отсутствие корректного числового amount остаются `unknown`.

## D-040 — Sites содержит минимальную owner-only read-модель реальных источников

Статус: принято для текущего контрольного среза

Владелец явно разрешил показать реальные AlfaCRM, payroll и read-only bank данные в единственном Sites-проекте после подтверждения owner-only access policy. D1 не является новым источником истины: это производная read-модель из изолированной БД и банковского API. В неё передаются только поля, необходимые для карточек и статусов. Frontend не содержит embedded data или secrets; API проверяет владельца; отдельный import secret защищает публикацию; чувствительные просмотры и imports журналируются без PII. Расширение аудитории требует нового решения владельца.

## D-039 — Защищённый Sites Worker принимает OAuth callback «Точки»

Статус: принято; заменяет D-034 для текущей server-side архитектуры

Предыдущая D-034 исходила из статического Sites artifact без защищённого backend и vault. Текущий Sites Worker выполняет server-side code exchange, хранит secrets в protected environment, проверяет state, шифрует tokens и имеет persistent D1. Поэтому точный зарегистрированный root redirect допустим для текущего owner-only проекта. Технический control находится в «Системе». Запрашиваются только `accounts balances customers statements` и permissions чтения; payment scopes, payment endpoints и действия физически отсутствуют.

## D-038 — Точный AlfaCRM observation является частью ключа происхождения

Статус: принято в source candidate; независимый gate ожидается

Ссылки только на raw payload и batch недостаточно: одинаковый payload мог наблюдаться на разных scope/page. Migration `0015` требует у каждой из 13 materialized tables exact `raw_observation_id` и composite FK raw/batch/scope/page. Raw records и observations неизменяемы через UPDATE, DELETE и TRUNCATE. Rollback `0014` исправлен и проверяется через rollback → reapply перед `0015`.

## D-037 — Реальные зарплатные строки не превращаются в правила

Статус: принято

Owner-only интерфейс может показывать фактические карточки, начислено и выплачено из подтверждённой ведомости. Это не активирует формулы, ставки, KPI, оклады или юридические выводы. Unresolved identities остаются отдельной очередью, суммы помечаются как неутверждённые правила, а любое изменение расчётной логики требует отдельного подтверждения.

## D-036 — Raw lineage и snapshot-state не восстанавливать догадкой

Статус: принято в source candidate; независимый финальный gate ожидается

`alpha_raw_records` является append-only. Повторное получение того же payload создаёт новое observation batch/scope/page, а изменённый payload — новую raw-версию. Каждая материализованная AlfaCRM-строка обязана ссылаться на существующие raw и batch; migration `0014` завершается fail closed при legacy rows без доказуемого provenance вместо автоматического backfill.

Current/stale reconciliation выполняется только после полной успешной пагинации минимального scope. Partial, repeated page, max guard и network error не tombstone-ят предыдущий snapshot. Лиды и ученики сохраняют историю, но после успешного student snapshot одна запись не может одновременно оставаться current lead. Pending family candidates без текущего evidence становятся stale; решения человека не переписываются.

## D-035 — Incremental AlfaCRM начинается с проверяемого change discovery

Статус: принято в исходниках; live data не проверены

Полный read-only snapshot остаётся обязательной базой. Лиды загружаются отдельно от учеников; абонементы клиентов, платёжные справочники и журнал изменений имеют raw + normalized слои с provenance и идемпотентными business keys. Incremental-режим читает `log/index` от watermark с перекрытием 1–7 дней и честно называется discovery: до реализации безопасной rematerialization он не доказывает обновление всех domain-таблиц. Запись в AlfaCRM запрещена.

## D-034 — Sites не является банковским OAuth backend (заменено D-039)

Статус: заменено D-039 после появления server-side Worker, protected env и persistent D1

Корень owner-only Sites нельзя регистрировать как Redirect URI «Точки»: контрольная оболочка не хранит банковские secrets и не должна получать authorization code. Допустим только точный HTTPS URL защищённого API вида `/api/banking/oauth/callback`, совпадающий с runtime config. `.chatgpt.site`, HTTP, корневой путь и произвольные callback-пути завершаются fail closed.

## D-033 — Новый клиент «Точки» использовать только в read-only контуре

Статус: protected client настроен; доступ к данным ждёт owner consent

Владелец разрешил временно использовать новый production client. Service token проверяет приложение, но не даёт доступа к счетам. До корректного callback, пользовательского consent, hybrid token, protected backend Secrets и backup/rollback разрешены только безопасные auth/status probes. Платёжные scopes, создание платежей и иные денежные действия запрещены.

## D-032 — Реальный payroll импортировать как evidence, а не как утверждённые правила

Статус: принято и выполнено в изолированной sandbox-БД

Значения и formula snapshots реальной таблицы сохраняются с происхождением строки. Вычисленные выплаты и начисления можно сверять, но формулы, ставки, KPI и условия не становятся payroll rules без явного утверждения. Несопоставленные identities не объединяются автоматически. Запрет публикации персональных строк относился к sanitized A.4; D-040 разрешает минимальную owner-only read-модель после отдельной авторизации владельца.

## D-031 — Полный AlfaCRM read разрешён только в отдельную sandbox-БД

Статус: разрешено владельцем; новый full import выполняется

Текущие временные credentials допускаются для read-only загрузки всех требуемых CRM-сущностей в отдельную БД вне source checkout. Запись в AlfaCRM и production sync запрещены. Семьи не подтверждаются автоматически по телефону: importer создаёт только кандидатов для ручного решения. D-040 отдельно разрешает минимальную PII read-модель только в подтверждённый owner-only Sites. После end-to-end проверки credentials перевыпускаются и помещаются только в protected backend environment.

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
Статус: заменено D-039 после появления server-side Worker, protected env и persistent D1

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
