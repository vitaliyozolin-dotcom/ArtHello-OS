# ArtHello OS — Current State

## Обновление A.11 — exact checkpoint v28

- Исполняемый candidate: commit
  `025f82973807c03c90c558136b3a508aa17ed345`, tree
  `6fa44f49c99c9f21e05550ae8621f61a87dce4a1`.
- Sites version:
  `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_377621254d0881919134e482c2649393`.
- Deployment: `appgdep_6a66b291be588191909e6daff1fc23d1`,
  terminal status `succeeded`.
- Access: `custom`, один разрешённый owner account, ноль групп. Environment
  revision `5`; `ARTHELLO_OWNER_EMAIL` совпадает с email этого account.
- Полный local gate: typecheck PASS, full build PASS, scripts/data `62/62`,
  security `31/31`, Sites/Worker `22/22`, Front Office `47/47`,
  `git diff --check` PASS.
- Agent preview desktop PASS: пульс, центр качества, сотрудники, система,
  Front Office, интеграции и возврат из drawer. Raw application console errors
  не найдены. Mobile подтверждён static responsive/navigation tests; отдельный
  cloud-browser viewport harness запрещён политикой браузера и не обходился.
- Sites identity contract подтверждён локальной документацией платформы:
  `oai-authenticated-user-email`. Owner unit matrix возвращает `200`, missing
  и foreign identity — `403`.
- Production machine bypass не способен эмулировать owner identity: он удаляет
  caller-supplied identity header. Служебный cloud renderer использует
  отдельную redacted identity и ожидаемо получает `403`. Live URL во внутреннем
  браузере не открывался. Фактический owner-session `200` остаётся внешней
  проверкой на устройстве владельца.
- Безопасный post-deploy status: `activeBatchId = null`,
  `atomicSnapshot = false`, `attestationStatus = legacy_unattested`; payroll
  counts `114 / 842 / 1318 / 1855 / 36`; все восемь operational AlfaCRM
  datasets `0`; Tochka `active`, 16 счетов, payment actions `false`.
- В A.11 новые PII rows не передавались, production PostgreSQL/Replit не
  подключались и миграции production не выполнялись.

## Обновление A.10 — 2026-07-26

- Exact v27: commit `f0eea01f0d27ac5afdacbd71c9753401222577b9`, tree `48fe2669cf7ebf28fe5ed125117abd71b35cc52a`, Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_5581beb0e1308191ae6721b460e4bb68`, deployment `appgdep_6a66a77b5a408191b060ad9eece3f52e` = `succeeded`, access `custom / 1 owner / 0 groups`.
- Reviewer v27: `FAIL`. Coordinator: `NO-GO`. Открыты были incremental terminal bypass, круговая digest-аттестация, production owner API `403`, raw UI error и отсутствие точного v27 evidence в документах.
- В correction candidate exporter требует `full_sandbox_read_only` и полный scope inventory; publisher создаёт per-dataset manifest; Worker переводит batch в `verifying`, блокирует конкурентный staging, пересчитывает SHA-256 из канонических staged rows и только затем выполняет одну D1 transaction.
- Произвольный digest, изменение строки после manifest и пропущенный непустой dataset возвращают `409`; предыдущий active snapshot остаётся неизменным. Порядок передачи одинаковых строк не влияет на digest.
- Sites environment revision `5` подготовлена с `ARTHELLO_OWNER_EMAIL=vitaliyozolin@gmail.com`, совпадающим с единственным разрешённым Sites-пользователем. Access policy не менялась: `custom`, 1 user, 0 groups. Ревизия применяется только следующим deployment.
- UI явно различает `atomic_attested` и `legacy_unattested`; malformed API rows дают безопасное пустое состояние, raw `error.message` пользователю не выводится.
- Local gate candidate: typecheck PASS, full build PASS, scripts/data `62/62`, security `31/31`, Sites/Worker `22/22`, Front Office `47/47`, `git diff --check` PASS.
- Agent preview desktop PASS: пульс, центр качества, сотрудники, Система, Front Office, Integration drawer и возврат проверены кликами; raw application console errors отсутствуют. Отдельный mobile iframe harness отклонён политикой cloud browser, поэтому mobile подтверждён только static responsive/navigation contract tests и остаётся ограничением независимой визуальной проверки.
- Реальные данные в этом correction cycle не передавались. Текущие D1 counts `114/842/1318/1855/36` остаются legacy/unattested; Alfa operational datasets остаются `0`. Новый protected snapshot v5 запрещён до независимого PASS/GO и отдельного информированного PII approval.

## Обновление A.9 — 2026-07-26

- Sites v25 и exact source `1638b7d047b5cc72a6b902dce7d5119693c3eb66` были успешно развёрнуты owner-only, но защищённый payroll import не выполнялся: внешний safety gate остановил передачу PII до первого сетевого запроса.
- Повторная независимая ревизия v25 выдала `FAIL`: full-mode publisher не проверял terminal Alfa evidence, а последовательная замена 14 datasets не была атомарной. Поэтому v25 допустим только как ограниченная оболочка с нулём новых PII rows и не является воротами следующей фазы.
- Correction candidate требует completed Alfa batch, 0 failed entities, 0 incomplete scopes, terminal flags и согласованный `sync_status`; смена только `dataMode` теперь отклоняется.
- Добавлены аддитивные Sites D1 таблицы publication manifest/staging. Все datasets сначала загружаются в batch с SHA-256 и expected counts, затем заменяются одной D1 transaction. Legacy per-dataset live import возвращает `410`; rollback-test доказывает сохранение прежнего active snapshot при ошибке staged row.
- Текущий protected export v5 не изменён: payroll `114/842/1318/1855/36`, mismatches `0`; AlfaCRM operational rows `0`, batch `2672/2355/317/56659`, linkage findings `1125`, family candidates `555 pending / 0 confirmed`.
- Реальные ФИО и зарплатные строки не передавались в Sites этим correction cycle. Для новой digest-bound передачи по-прежнему нужно отдельное информированное подтверждение владельца с указанием payload и owner-only назначения.
- На correction candidate локально проходят полный monorepo typecheck/build, 31 security tests, 60 scripts/data tests, 17 Sites/Worker tests и 47 Front Office tests. Набор включает отрицательные terminal-gate сценарии и атомарный rollback; `git diff --check` также PASS. Agent preview перезапущен и сообщает `running`, но облачный HTTP proxy возвращает 502 до приложения; после bounded troubleshooting интерактивный browser QA остаётся инфраструктурно недоступен, static responsive/navigation contracts проходят. Live Sites URL внутри не открывался. Новый exact checkpoint и второй цикл Ревизор → Координатор ещё обязательны.
- Correction checkpoint v26: source commit `8482395a71f234e982bcd52dcc9fb9a7801f9db7`, tree `7ffcbed66c30f0b919a28fc0124e4fd449216c85`, version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_b7891fb810008191a51b9c6aa114ec01`. Первая deployment-попытка `appgdep_6a66a625002481918d52bebae9bad4ad` завершилась до build из-за npm metadata timeout; повтор той же version `appgdep_6a66a6a4d90c8191bb54af36d4e84523` получил `succeeded`.
- Post-deploy policy повторно подтверждена: `custom`, 1 owner, 0 groups. Safe machine status: payroll datasets `114/842/1318/1855/36`, Alfa operational datasets все `0`, money missing/mismatch `0`, «Точка» `active/16/read_only/paymentActions=false`.
- Эти payroll rows уже существовали в D1 после прежнего per-dataset lifecycle; текущий correction cycle их не передавал и не заменял. Поэтому `publication.activeBatchId = null`: deployed rows нельзя аттестовать как новый digest-bound atomic snapshot до отдельного разрешённого повторного импорта. Source status AlfaCRM остаётся `not_loaded` в Sites, а sandbox batch — partial.

## Обновление A.8 — 2026-07-26

- В отдельной sandbox-БД применены исходные branch-scoped migrations после файлового backup mode `600`; backup SHA-256: `e3631c6aecc40e8097d137ee7e2ef3e1fa4162867b18af38314cce938ac22805`. После объединения с Front Office они имеют номера `0017–0018`; additive `0019` безопасно сводит обе конкурентные migration-истории. Production БД и legacy Replit не изменялись.
- AlfaCRM IDs переведены на branch-scoped identity. Rehydrate из immutable raw-наблюдений восстановил 2 020 учеников, 362 педагогов, 435 групп, 15 550 оплат и 19 678 занятий; broken provenance и normalized branch-key duplicates = 0.
- Последний batch остаётся `partial`: 2 672 scope запрошено, 2 355 завершено, 317 не завершено, 56 659 записей fetched/saved. Все незавершённые scope имеют `request_timeout`; повторный probe остановился на timeout `/auth/login` до чтения domain endpoint.
- Текущая диагностическая нормализация содержит 8 филиалов, 1 548 лидов, 2 335 клиентских тарифов, 10 550 записей change log, 74 770 посещений и 1 332 membership. Это неполное покрытие, а не текущая операционная истина.
- Data-quality findings не скрыты: 2 membership без нормализованного ученика и 1 123 attendance без нормализованного ученика. Attendance без занятия, tariffs без ученика, broken provenance и family-candidate orphans = 0.
- Построено 555 branch-scoped кандидатов семей только для ручной проверки. Подтверждённых семей и автоматических объединений — 0. До terminal batch эти строки не публикуются в Sites.
- Protected export v5 имеет mode `owner_only_verified_payroll_partial_alfa_aggregate`: 114 сотрудников, 842 помесячные строки, 1 318 компонентов, 1 855 связанных выплат, 36 unresolved; money mismatches = 0. Все восемь операционных AlfaCRM datasets содержат 0 строк, доступен только агрегированный partial-status.
- Runtime «Точки» остаётся ранее подтверждённым как `active`, 16 счетов, read-only, payment actions = false. Полнота выписок и банковская сверка ещё не доказаны.
- Локально PASS: полный monorepo typecheck/build, 31 security test, 57 scripts/data tests, 16 Sites/Worker tests и 47 Front Office tests после выполнения exporter SQL на disposable migrated DB. Отдельные publication tests доказывают, что partial-mode отвергает любую операционную строку AlfaCRM. Front Office остаётся `DRAFT_ONLY` без outbound action. `git diff --check` также PASS. Agent preview запущен; модуль облачного браузера отсутствует, поэтому интерактивный desktop/mobile QA ограничен production build и static responsive/navigation contracts.
- V25 lifecycle завершён owner-only deployment и независимой ревизией, но получил `FAIL`; PII import не выполнялся. Следующие ворота вынесены в A.9.

## Обновление A.7 — 2026-07-26

- Независимый Ревизор версии v16 выдал `FAIL`: общий formatter округлял реальные денежные значения до целых рублей. В затронутых наборах копейки присутствуют у 203/842 начислений, 437/842 выплат по месяцам, 241/1 318 компонентов, 650/1 855 фактических выплат и 16/36 unresolved rows. Координатор запретил переход дальше до exact minor-unit хранения и повторной сверки.
- Correction candidate хранит авторитетные суммы в целых копейках, отдаёт через API только `*_minor` и форматирует их без деления через binary float. Legacy `REAL` оставлен неавторитетной совместимостью. Новая аддитивная Sites D1 migration backfill-ит minor-unit поля; production PostgreSQL/Replit не изменялись.
- Свежий owner payroll export содержит 114 сотрудников, 842 помесячные строки, 1 318 компонентов, 1 855 связанных выплат и 36 unresolved rows. Все minor-unit поля являются safe integers; source-to-minor reconciliation mismatches = 0.
- Machine endpoint считает отсутствующие minor-unit значения и расхождения legacy↔minor без выдачи сумм или персональных строк. Publisher обязан получить оба счётчика равными нулю.
- Первый correction deployment v17 не принят: post-deploy machine check вернул HTTP 500 при выполнении объединённых money-audit запросов. Runtime log подтвердил точный маршрут и отказ без утечки данных. Candidate разделяет стабильный dataset/status batch и отдельный bounded money-audit batch из простых `COUNT` запросов; новый checkpoint обязателен.
- Runtime status «Точки» подтверждён как `active`: 16 счетов, `lastErrorCode = null`, scope только read-only, payment actions = false. Статические тексты «ожидает OAuth» удалены; интерфейс отображает ответ runtime.
- AlfaCRM batch всё ещё частичный: 76 scopes завершены, 52 не завершены; integrity finding — 70 attendance rows без нормализованного ученика. Экспорт частичного snapshot повторно заблокирован `ALFACRM_TERMINAL_SNAPSHOT_REQUIRED`; операционные rows в Sites не публикуются.
- Локально проходят `typecheck`, `build:full`, 31 security test, 34 data/import tests и 13 Sites/Worker tests. Agent preview runtime доступен, но cloud browser возвращает `ERR_BLOCKED_BY_CLIENT`; live Sites URL во внутреннем браузере не открывался.
- Следующие ворота: owner-only checkpoint correction candidate → безопасная machine verification → новый read-only Ревизор → новый Координатор. После этого AlfaCRM можно продолжить только с заново защищённо предоставленными тремя AlfaCRM credentials.

## Обновление A.6 — 2026-07-26

- Реализован явный resume прерванного полного AlfaCRM batch. Candidate пропускает 76 уже завершённых scopes и должен повторить 52 незавершённых; завершение batch и построение family candidates запрещены, пока остаётся хотя бы один incomplete scope.
- Существующая sandbox-БД содержит частичное наблюдение, не финальную истину: 8 филиалов, 1 820 учеников, 998 лидов, 286 групп, 131 педагог, 18 700 оплат, 7 448 занятий и 22 452 посещения. Memberships и family candidates пока равны нулю; найдено 70 attendance rows без нормализованного ученика. Эти количества не публикуются как полное покрытие AlfaCRM.
- Исправлена нормализация связей, которые AlfaCRM возвращает как массивы `teacher_ids`/`group_ids`. Для групп объединяются вложенные teachers и отдельные teacher IDs.
- Owner read-model candidate содержит 114 карточек сотрудников, 842 помесячные строки, 1 318 связанных компонентов начислений, 1 855 связанных выплат и 36 unresolved payroll rows. Исходный payroll audit и формулы сохраняются отдельно; read-модель не превращает их в правила.
- Добавлены экраны и API педагогов, ставок/evidence, компонентов начислений и фактических выплат. Связи педагог↔сотрудник по точному ФИО, class candidates и extra-lesson candidates явно требуют ручного подтверждения.
- Налоги и страховые взносы имеют статус `not_sourced`: поиски по зарплатному источнику не выявили подтверждённой налоговой модели, расчёт не выполняется.
- Добавлен безопасный агрегированный endpoint для машинной проверки deployment: только counts, статус/время банковской синхронизации и безопасный error code; без имён, сумм, account IDs, номеров счетов и секретов. Детальные owner endpoints остаются закрытыми.
- D1 migration `0002_familiar_blockbuster.sql` аддитивно расширяет только Sites read-модель; production PostgreSQL и production migrations не затрагивались.
- Локально PASS: полный TypeScript check, full production build, 31 API security test, 33 AlfaCRM/data tests и 12 Sites/Worker tests.
- Agent preview server подтверждён healthy, но cloud browser возвращает инфраструктурный `ERR_BLOCKED_BY_CLIENT`; интерактивная desktop/mobile проверка текущего candidate ограничена статическими responsive/navigation contracts и production build. Live Sites URL во внутреннем браузере не открывался.
- Пользователь сообщил об успешном consent «Точки». Статус считается неподтверждённым до машинной проверки именно нового deployment и агрегированного read-model status.

## Обновление A.5 — 2026-07-26

- Главный Library-документ версии 0.1 найден и полностью перечитан; текущий срез остаётся в воротах достоверных данных и не открывает AI CFO.
- Единственный Sites-проект `arthello-os-control` подтверждён owner-only: разрешён один пользователь, групп и публичной аудитории нет. Runtime secrets внесены как protected environment variables; `.openai/hosting.json` содержит только opaque project ID и binding `DB`.
- Добавлена D1 read-модель для сотрудников, помесячных начислений/выплат, unresolved payroll, филиалов, учеников, кандидатов семей, групп, занятий, оплат AlfaCRM, состояния «Точки» и маскированных счетов. В frontend нет встроенных персональных строк или секретов.
- Owner API завершается `403` без подтверждённого владельца. Import API имеет отдельный длинный secret, ограничивает batch до 100 строк и принимает только фиксированные datasets/columns. Разрешённые просмотры и импорт журналируются в `sensitive_access_audit` без имён, сумм и поисковых запросов.
- Интерфейс теперь загружает реальные строки: списки сотрудников, помесячную зарплату выбранного сотрудника, учеников, кандидатов семей, группы, занятия, оплаты AlfaCRM, счета и остатки. Неподключённый источник показывает ошибку/пустое состояние, а не demo-числа.
- Технический OAuth перенесён в раздел «Система» согласно мастер-плану. Раздел «Деньги» оставлен для счетов, остатков и CRM-оплат; сверка ещё не заявлена готовой.
- Tochka OAuth Worker использует одинаковые read-only scopes `accounts balances customers statements`, получает consent, проверяет SHA-256 state, обменивает code server-side, шифрует токены AES-GCM и перебирает все доступные business customers. Payment permissions, payment routes и инициирование платежей отсутствуют.
- Банковский остаток берётся только из `ClosingAvailable` (резервно `OpeningAvailable`); `Expected` не показывается как деньги на счёте, а `CreditDebitIndicator` не меняет знак balance amount.
- Зарплатный snapshot повторно посчитан: 2 593 raw-строки, 114 карточек сотрудников, 1 881 принятая выплата, 1 328 принятых начислений, 2 отклонённые строки без суммы, 26 unresolved payments и 17 unresolved accrual identities. Старое число 3 689 признано ошибочным и не используется.
- Migration `0015` добавляет точный composite observation lineage для 13 нормализованных AlfaCRM-таблиц и защищает raw/observation от UPDATE, DELETE и TRUNCATE. Rollback `0014` теперь действительно удаляет все шесть оставшихся FK и допускает reapply перед `0015`. Stale students каскадируют зависимости и не могут быть воскрешены дочерними импортами.
- Локально PASS: typecheck, full build, 31 API security tests, 32 AlfaCRM/data tests и 11 Sites tests, включая in-memory SQLite/D1 OAuth flow, multi-customer accounts, token sealing, owner/import denial и отсутствие полных account IDs в ответе.
- Agent preview runtime запущен, но облачный браузер блокирует внутреннюю страницу до загрузки приложения (`ERR_BLOCKED_BY_CLIENT`). После обязательной ограниченной диагностики это классифицировано как инфраструктурное ограничение; responsive/navigation contracts проверены тестами, но интерактивный desktop/mobile просмотр ещё не получен.
- Полный AlfaCRM read-only импорт продолжает писать в отдельную sandbox-БД. До terminal report и integrity audit фактическое покрытие не утверждается. Production БД и legacy Replit не изменялись.
- Public legacy Replit отвечает, но остаётся индексируемым и имеет незащищённые read endpoints; реальные данные в него не направляются.
- GitHub Draft PR #1 ещё не обновлён текущим candidate: обязательный `gh` отсутствует в среде. Sites checkpoint использует отдельный связанный source repository и не считается доказательством обновления GitHub PR.

## Обновление A.4 — 2026-07-25

- Создана отдельная PostgreSQL-совместимая sandbox-БД вне source checkout; перед `0014` сохранена отдельная копия, затем применены 15 миграций. Аудит видит 113 таблиц с учётом sandbox migration ledger. Production БД не читалась и не изменялась.
- По подтверждению владельца заведены три юридических лица и три операционных правила: «Атлас садик и школа» → ООО «АртХелло», «Лиственная» → ИП Тюрин Павел Олегович, «Школа 1-11» → ООО «УК Детское образование». Фактическая CRM-привязка филиалов ещё не доказана.
- Реальная зарплатная таблица импортирована в sandbox: 2 593 raw-строки с formula snapshots, 114 уникальных внешних employee identities, 1 881 выплат и 1 328 ненулевых результатов начислений. Две строки выплат без суммы отклонены; 26 связей выплат и 17 связей начислений оставлены unresolved. Дублей нет, 11 периодов имеют юрлицо.
- Контрольный аудит подтвердил совпадение числа и суммы принятых выплат/начислений с source snapshot. Формулы сохранены как evidence, но ни одно payroll rule, ставка или KPI не активированы.
- Полный read-only AlfaCRM importer покрывает учеников отдельно от лидов, архив, группы, состав, педагогов, занятия трёх статусов, посещаемость, оплаты, абонементы клиентов, четыре платёжных справочника и журнал изменений. Candidate `0014` делает raw append-only, сохраняет отдельное observation на batch/scope/page, требует реальный raw/batch FK у каждой материализованной строки и выполняет stale reconciliation только после полностью успешной пагинации scope. Partial, repeated-page и pagination-guard не tombstone-ят отсутствующие записи. Incremental discovery остаётся только обнаружением изменений.
- Свежий AlfaCRM full run из текущей среды завершился `partial/request_timeout` до branch inventory: fetched 0, saved 0. Прямое соединение также оборвано cloud proxy. Исторические 8 филиалов остаются только historical provenance и не показываются как текущее покрытие.
- Предыдущий auth-probe production-клиента «Точки» вернул HTTP 200, accounts с service token — HTTP 403. Владелец передал новый временный credential, но он не записан в source/Sites/БД и ещё не введён через protected backend environment. Для счетов всё равно требуются Authorization Code consent и hybrid token. Consent не создавался, счета/операции не читались, платежные действия не выполнялись.
- Историческое ограничение статического Sites-клиента снято решением D-039: текущий owner-only Sites Worker принимает зарегистрированный root redirect, проверяет state и обменивает code server-side. До owner consent банковские записи всё равно отсутствуют.
- Public Replit 25.07.2026 всё ещё отдаёт старую индексируемую сборку: исходники уже закрывают индексирование и убирают публичные account hints, но выпуск не выполнялся.
- Ревизор v13 выдал `FAIL`: `A4-13-01` — raw provenance перезаписывался, `A4-13-02` — не было безопасного snapshot reconciliation, `A4-13-03` — использовался неверный pagination-параметр и не было failure tests. Поэтому прежнее заявление о закрытии A4-01 отозвано.
- Migrations `0014–0015` и rollback companions исправляют эти finding в source candidate и применены только к отдельной sandbox-БД после копии. 32 data-import tests, включая точный observation lineage, raw/observation UPDATE/DELETE/TRUNCATE rejection, rollback → reapply, atomic page rollback, pagination failures, stale student cascade и запрет resurrection, проходят. `typecheck`, `build:full`, 31 API security test и 11 Sites tests также проходят. Текущий PostgreSQL 16 wire-protocol gate ждёт CI; исторический PG16 PASS не считается доказательством migrations `0014–0015`. Независимые Reviewer/Coordinator ещё не завершены; `A4-13-01/02/03` остаются открытыми до их PASS.
- Agent preview daemon подтвердил запущенный Sites runtime, но облачный браузер заблокировал внутреннюю страницу до загрузки (`ERR_BLOCKED_BY_CLIENT`). Live Sites внутри не открывался; интерактивный desktop/mobile browser QA заменён 11 Sites tests: worker/D1 artifact, owner/import gates, OAuth, навигация и responsive contracts. Это ограничение должен учитывать Ревизор.

## Обновление A.3 — 2026-07-25

- Цикл 3 является последним корректирующим циклом. Точная candidate-версия не записывается самоссылкой внутрь собственного commit: её определяют immutable CI provenance artifact, source metadata Sites и поздний индекс в Draft PR #1.
- Владелец явно разрешил временно использовать текущие раскрытые credentials только для ограниченной read-only проверки. Они извлекались в память процесса, не записывались в файлы, Git, Sites, БД или постоянный environment.
- AlfaCRM live auth вернул HTTP 200; `/0/branch/index` вернул 8 филиалов. Имена и записи не выводились. Последующие запросы стали получать сетевые timeout, поэтому количества учеников, групп, педагогов, занятий и оплат пока не считаются проверенными.
- Tochka `client_credentials` вернул HTTP 200 и service token. Запрос счетов с service token вернул ожидаемый HTTP 403: требуется пользовательский Authorization Code/consent и hybrid token. Consent не создавался, платежные действия не выполнялись.
- Добавлен повторяемый `probe:live-read-only`: принимает секреты только через process environment, имеет limiter/circuit breaker и выводит лишь статусы и количества.
- В коннекторе «Точки» upstream response bodies, customer identifiers и token fragments удалены из logs и исключений. Security suite дополнена response-boundary, cross-scope, fail-closed sync и synthetic finance regressions.
- Полное дерево source опубликовано в приватную ветку `codex/a3-live-read-only`; открыт Draft PR #1 без merge в `main`.
- Исторический checkpoint v10 прошёл GitHub Actions run #8 (`30163177884`): `test:full`, `test:postgres` и `build:full`. Это evidence предыдущего checkpoint, а не идентификатор candidate цикла 3.
- Quality workflow цикла 3 checkout-ит точный PR head и публикует immutable artifact с `head_sha`, `tree_sha`, source archive digest и deterministic Sites artifact digest.
- Public 5xx response boundary заменяет exception/upstream/PII details фиксированным кодом; историческая `/sync` поверхность по умолчанию недоступна. Это уменьшает автономную часть HIGH, но не открывает production.
- Добавлены синтетические финансовые инварианты: баланс банка, исключение внутренних переводов из консолидированного ДДС, даты cashflow/accrual/P&L, версии payroll rules, reversals и integer-minor-unit rounding. Они не используют и не утверждают реальные ставки.
- Production, подробные live-данные, банковские счета/операции, sync в БД и финансовая аналитика остаются заблокированы.

## Candidate provenance — нормативный порядок

Актуальный candidate определяется только внешним пакетом, созданным после commit:

1. private PR head;
2. immutable CI artifact `arthello-provenance-<run_id>`;
3. равенство `local tree = CI tree` и `PR head = CI head`;
4. source commit и artifact digest Sites version;
5. terminal Sites deployment и owner-only access;
6. поздний PR manifest как индекс этих неизменяемых доказательств.

PR body сам по себе не является доказательством, потому что изменяем. Любые SHA/IDs ниже — явно исторические checkpoints, а не «текущая версия».

## Историческое provenance A.3 checkpoint v10

| Узел доказательства | Точное значение |
|---|---|
| Local source commit | `8735824a214e980ff9cb492fa7253959ab6c2123` |
| Local Git tree | `b3ede5bc05cd8685b64031f80db8fc9bbd6ad799` |
| Private Draft PR | `vitaliyozolin-dotcom/ArtHello-OS#1`, open, draft, unmerged |
| Remote PR head | `7f175fa7f14a55b0f329b95a6f63d326682ec113` |
| Claimed remote Git tree | `b3ede5bc05cd8685b64031f80db8fc9bbd6ad799`; не было независимого `tree.sha` evidence |
| GitHub Actions | run #8, `30163177884`, conclusion `success` |
| Sites version | `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_71ff653bbc548191b1b138dec8eaa332` |
| Sites deployment | `appgdep_6a64d3b5e134819193ba100f503db92d`, status `succeeded` |
| Reviewer | `CONDITIONAL PASS` только owner-only sanitized checkpoint |
| Coordinator | `CONDITIONAL GO` только owner-only; цикл 3 разрешён; Phase A/production/next phase `BLOCKED` |

## Историческое provenance A.3 checkpoint v9

| Узел доказательства | Точное значение |
|---|---|
| Local source commit | `0900b9cff88e330afd095bcc8ac17da11a6ce50c` |
| Local Git tree | `609e64852c47808c0447f247976d6dd4513bb038` |
| Private branch | `codex/a3-live-read-only` |
| Private Draft PR | `vitaliyozolin-dotcom/ArtHello-OS#1`, open, draft, unmerged |
| Remote PR head | `3ab2cfe4310f5d22a42e0c874180428894dae788` |
| Remote Git tree | `609e64852c47808c0447f247976d6dd4513bb038` |
| GitHub Actions | run #7, `30161981773`, conclusion `success` |
| Sites version | `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_37098405ed048191ab3943dfea63c76c` |
| Sites deployment | `appgdep_6a64cae273e881919dc83dbf2f8645e0`, status `succeeded` |
| Sites access | owner-only/custom, только владелец |

Local и remote commit SHA различались, потому что приватная ветка собрана через Git Data API поверх отдельной remote history. Sites v9 создан из local commit после desktop/mobile agent preview; опубликованный URL не открывался во внутреннем cloud browser.

Это provenance Создателя. Оно не заменяет независимый отчёт Ревизора: в цикле v9 Ревизор не вернул отчёт и поэтому имеет статус `BLOCKED`; Координатор разрешил оставить только owner-only обезличенный checkpoint и заблокировал завершение Фазы A, production и следующую продуктовую фазу.

## Обновление A.2 — 2026-07-25

- На момент A.2 приватный GitHub `vitaliyozolin-dotcom/ArtHello-OS` был пуст; в A.3 source опубликован в отдельную ветку и открыт Draft PR #1.
- Для bank connector config реализован AES-256-GCM vault с key ID, AAD по connector ID, fail-closed чтением plaintext secrets и guarded migration после backup.
- AlfaCRM вызовы сериализованы с интервалом 260 ms; параллельная аутентификация объединяется.
- Подготовлены PostgreSQL 16 integration suite и GitHub Actions quality workflow; фактическое runtime evidence получено в A.3 run #6.
- На этапе A.2 ключи со скриншотов не использовались; в A.3 владелец разрешил только ephemeral read-only probe. До production и постоянной синхронизации они должны быть перевыпущены.
- Sites preview embedding исправлен ограниченным allowlist ChatGPT; индексация и кэширование остаются запрещены.

Дата среза: 2026-07-24
Этап: Фаза A.1 — readiness for real data, security perimeter

## Происхождение исходников

- Источник: предоставленный архив `arthello-os-src.zip`.
- SHA-256 архива: `714388e45dbd49d58fd3e3f6abb48e5f04d1896eaab3dc164407175e7944cf6e`.
- Архив прошёл проверку целостности и проверку путей перед распаковкой.
- В архиве не было `.git`; прежнюю ветку, историю и незавершённые изменения подтвердить невозможно.
- Для продолжения Sites создана локальная baseline-версия на ветке `main`: `5b9546778bb7ec42cff2880849699550d896fe6a`.
- Checkpoint №1 проверял commit `14639db870af9dc69a0702fa33a5a10b2ae8ddc8`, Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_fa731a9248348191902409ebe3f68bde`, deployment `appgdep_6a629f0960fc81918f1e925d0daffd21`.
- Checkpoint №1 был owner-only и технически успешно развёрнут, но Координатор выдал `NO-GO`: owner UI не показывал все найденные production-блокеры.
- Первая техническая попытка checkpoint №2 сохранила commit `4f57f9c92fcaf3e0dcc970a533154ec4d2ccd4c7` как Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_9d38f22c6aec819185cbfc117f5d34d8`, deployment `appgdep_6a62a6854b9c8191ad9b750d44633b9c`, но remote build завершился до deployment: builder не находил вложенный `pnpm`.
- Root `build` сделан package-manager-neutral для Sites; полный монорепо-прогон сохранён как `build:full`. Новая immutable Sites version создаётся из отдельного commit, failed version повторно не разворачивается.
- Security checkpoint цикла 1 проверял commit `41b131659072b083d99a24ca7bf0f0ba38e26c4f`, Sites version №4 `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_c09fda5b22488191b576857bdb0eda35`, deployment `appgdep_6a62c158cd9881919b3d0b004a5d3ffa`.
- Ревизор цикла 1: `CONDITIONAL PASS` только для owner-only оболочки и `BLOCKED` для production/live. Координатор: `CONDITIONAL GO` на просмотр, `GO` на корректирующий цикл A.1 и `BLOCKED` для production/live/финансов.
- Security checkpoint цикла 2 проверял commit `aa0543f8478787059c590750df77888b8f508573`, Sites version №5 `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_57b4c3a09b788191a61d4e2964a5c775`, deployment `appgdep_6a62c8edd18881919260fce24734d4dd`.
- Ревизор цикла 2 разрешил owner-only sanitized checkpoint, но выявил потерю website lead при partial failure и отсутствие pre-listen проверки фактической security schema. Координатор разрешил третий, финальный корректирующий цикл и сохранил `NO-GO` для production/live/следующей продуктовой фазы.

## Срез A.1

После принятого owner-only checkpoint Фазы A начат отдельный security-срез без production-доступов:

- bearer session token удалён из browser `localStorage`;
- session token передаётся только в HttpOnly/SameSite cookie и хранится в БД только как SHA-256 hash;
- CSRF token проверяется по cookie, header и hash в server-side session;
- `owner`, `accountant`, `viewer` проверяются централизованной route policy;
- owner сохраняет полный authenticated access; для accountant/viewer обязательны списки branch и legal-entity scope из protected environment;
- все business routes для non-owner теперь fail closed, пока конкретный handler не применяет оба scope predicates и не получает cross-scope negative tests;
- login attempts и lockout хранятся в PostgreSQL без raw login/IP;
- разрешённые sensitive routes требуют записи обезличенного access audit; недоступность audit store возвращает `503`;
- структурированные logs проходят recursive redaction; Error message и stack не журналируются;
- fallback-ключ Evotor удалён, отсутствие `SESSION_SECRET` останавливает операции с token fail closed;
- Drizzle migration `0009_famous_ma_gnuci.sql` создана отдельно и не применялась ни к sandbox, ни к production.
- migration `0010_outstanding_cargill.sql` добавляет session scopes и security access audit; она также не применялась;
- migration error теперь пробрасывается; перед listener выполняется fail-closed inventory обязательных auth/audit columns, indexes и точных timestamp+hash записей migrations `0009–0010`;
- website lead handler требует `Idempotency-Key`; raw event, lead event, processed flag и source status теперь изменяются в одной PostgreSQL transaction под advisory lock;
- повтор того же key с иным canonical payload получает `409`, а legacy raw-only partial write восстанавливается без второй raw-записи;
- banking health sanitization переведена с denylist на strict allowlist;
- access audit использует явные route templates и не сохраняет slug/email/phone/UUID/numeric/percent-encoded identifiers.

Unit/source regression suite проверяет эти ветки без production-данных. В Sites checkout нет локального PostgreSQL (`DATABASE_URL`, `psql`, `postgres`, `initdb` отсутствуют), поэтому создана одноразовая PostgreSQL 16 CI-база. Run #6 подтвердил transaction, migrations 0009–0010, rollback и fail-closed startup на синтетических данных. Это не является production migration или runtime-release; перед выпуском Replit нужна восстановленная sandbox-копия и отдельные ворота.

## Репозиторий

| Область | Фактическое состояние |
|---|---|
| Package manager | pnpm workspace, lock-файл восстановлен |
| Frontend | React 19, Vite, Tailwind, wouter, React Query |
| API | Express 5, TypeScript |
| БД | PostgreSQL, Drizzle, большой набор схем и встроенный migration runner |
| Runtime Replit | Node 24, PostgreSQL 16 по `.replit` |
| Sites | отдельная безопасная control surface внутри того же репозитория |

В исходной конфигурации TypeScript incremental metadata считал отсутствующие declaration-файлы актуальными. Команда `typecheck:libs` переведена на принудительную пересборку, после чего baseline typecheck проходит.

## Модули, найденные в коде

- source connectors, raw events и lead events;
- AlfaCRM branches, students, payments, lessons, attendance, teachers, groups и identities;
- persons, families, student profiles и guardian links;
- educational units, class groups, enrollments и schedule;
- bank connectors, accounts, sync runs, raw statements, transactions и reconciliation;
- ledger, financial articles, cashflow, P&L, recurring obligations и payables;
- departments, employees, roles, assignments, payroll rules и payroll periods;
- contracts, documents, taxes, contractors, month closing, trust score и ранний AI CFO.

Наличие этих модулей не подтверждает production-готовность или текущую полноту данных.

## AlfaCRM

Подтверждено по коду:

- read-only клиент использует `/v2api/auth/login` и `X-ALFACRM-TOKEN`;
- реализованы пагинация, raw-слой, нормализация и журналы синхронизации;
- все вызовы идут через сериализованную очередь с интервалом 260 ms; конкурентный unit-тест доказывает порядок и восстановление после ошибки;
- `ALFACRM_DOMAIN` обязателен: hardcoded tenant fallback удалён, отсутствие переменной останавливает клиент fail closed;
- учётные данные читаются из environment.

Подтверждено live в A.3:

- авторизация API вернула HTTP 200;
- endpoint филиалов вернул 8 записей без публикации названий или идентификаторов.

Не подтверждено:

- состав и полнота филиалов;
- свежесть и количество остальных сущностей;
- охват юридических лиц.

## Банки

Подтверждено по коду:

- обнаружены коннекторы Точки, Т-Банка и ВТБ;
- есть сущности счетов, остатков, операций, sync runs и raw statements;
- у Точки реализованы OAuth, accounts, balances и statements;
- явного кода инициирования банковских платежей не найдено.

Критический gate:

- новые secret-bearing `bank_connectors.config` шифруются AES-256-GCM и fail closed при plaintext; legacy rows ещё не мигрированы и требуют sandbox backup/guarded migration;
- banking health response очищен от raw debug; public 5xx errors проходят фиксированную безопасную границу; legacy `/sync` handlers/probes недоступны и требуют последующей замены/удаления перед release.

Не подтверждено:

- какие коннекторы реально активны;
- какие счета и юридические лица покрыты;
- актуальность контрактов Т-Банка и ВТБ;
- свежесть и полнота банковских операций.

## Безопасность

Найдено в исходной версии:

- публично показанные демо-реквизиты входа;
- fallback-пароли в API;
- `robots=index,follow` и разрешающий `robots.txt`;
- все API-модули монтировались без общего `requireAuth`;
- CORS был открыт для любого origin;
- bearer token хранится в `localStorage`, а серверные сессии — в памяти процесса;
- route-level RBAC и login rate limiting отсутствуют;
- webhook endpoints не имели подтверждённой схемы аутентификации;
- исторически банковские секреты могли храниться в JSONB открытым текстом; A.2 добавляет vault, но legacy rows ещё не мигрированы;
- token masks, customer identifiers, raw bank responses и lead PII могут попадать в diagnostics;
- migration runner исторически поглощал ошибку, поэтому API listener и polling могли стартовать после неуспешной миграции;
- исторический limiter AlfaCRM не защищал параллельные вызовы; в A.2 это исправлено serialized queue.

Исправлено в текущих исходниках:

- демонстрационные реквизиты удалены;
- все пароли требуются из environment и не имеют fallback;
- browser frontend больше не хранит bearer token; API использует server-side PostgreSQL sessions и HttpOnly cookie;
- API закрыт общим auth-gate, кроме health, JSON-only login и state-protected browser callback Точки;
- CORS по умолчанию выключен и открывается только через `APP_ORIGINS`;
- credentialed CORS разрешён только для allowlist origin;
- добавлены базовые security headers и `X-Robots-Tag`;
- HTML и `robots.txt` запрещают индексацию;
- входящие website, bank и Evotor webhooks теперь закрыты auth-gate до проектирования проверяемой аутентификации;
- hardcoded AlfaCRM tenant fallback удалён; без `ALFACRM_DOMAIN` клиент останавливается fail closed.
- добавлены route-level RBAC, CSRF и PostgreSQL login lockout;
- добавлены branch/legal-entity scope metadata; non-owner business access безопасно отключён до route-level predicates;
- добавлен fail-closed audit чувствительных разрешённых запросов с канонизацией resource IDs;
- migration error теперь прерывает startup до listener и banking polling;
- website lead handler получил atomic transaction, advisory lock, payload-bound idempotency key, `409` conflict и recovery raw-only partial write;
- структурированные logs централизованно очищаются от token, raw body, customer, contact и banking identifiers;
- detailed banking health использует allowlist и не возвращает raw upstream body, customer code, authorize URL, token diagnostics или неизвестные будущие поля;
- startup проверяет обязательные security columns/indexes и точные journal timestamp+hash migrations `0009–0010` до listener;
- access audit сворачивает неизвестные identifier-bearing paths в зарегистрированные route templates или `/unregistered/:path`;
- удалён tracked fallback-ключ шифрования Evotor.
- bank connector config использует authenticated encryption с fail-closed legacy plaintext handling;
- AlfaCRM использует serialized queue 260 ms и coalesced authentication.

Важно: эти исправления не выпускались в публичный Replit runtime в рамках Фазы A.

Открытые HIGH-блокеры:

- legacy bank config не прошла guarded migration после backup; раскрытые credentials не перевыпущены;
- недоступный legacy `/sync` code и отдельные non-5xx diagnostics ещё требуют замены/удаления; public 5xx boundary уже fail closed;
- scoped non-owner handlers ещё не реализованы и поэтому business access этих ролей намеренно заблокирован;
- provider-auth, replay protection и idempotency для bank/Evotor callbacks не реализованы;
- migrations `0009` и `0010` прошли apply/rollback на одноразовом PostgreSQL 16 CI, но ещё не проверялись на восстановленной репрезентативной sandbox-копии и не применялись к production.

До их закрытия production, Replit release и любые live-данные запрещены.

## Тесты и сборка

- Отдельных baseline unit/integration тестов почти нет; файлы `test-data` генерируют тестовые записи и не являются тестовым набором.
- После принудительной пересборки library declarations TypeScript-проверка всех workspace-проектов проходит.
- Для Sites добавлены проверка worker artifact, тесты безопасного интерфейса, полного risk register и fail-closed Alfa tenant configuration.
- Checkpoint v7 A.2: commit `5a62864fdb4ba1237eeef5a8b47d9e6f9040cb66`, Sites version `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_30b80923a4c88191b4e838e434fdf37f`, deployment `appgdep_6a64b18edf788191a9cf2a2ae41e1982`, owner-only; desktop/mobile preview и переходы пройдены.
- Прямые security regression tests проверяют отрицательные role/scope-сценарии, отсутствие browser bearer storage, cookie contract, route-template access audit, log redaction, strict health allowlist, schema inventory, fail-closed startup, atomic website idempotency/rollback/retry/recovery/conflict и отсутствие fallback-ключа Evotor.
- Исторический PostgreSQL 16 integration suite v10 выполнен в GitHub Actions run #8: `test:full`, `test:postgres`, `build:full` — PASS. Для текущего candidate `typecheck`, `test:full`, 32 data-import tests и `build:full` прошли локально, но `test:postgres` ждёт exact GitHub candidate и одноразовый PostgreSQL 16. Candidate обязан экспортировать CI `head_sha/tree_sha` artifact. Audit-store outage/deny PostgreSQL smoke, provider-auth replay и реальные финансовые calculation tests остаются открыты; добавлены только синтетические инварианты. AlfaCRM concurrency unit test пройден.

## Production и миграции

- `DATABASE_URL` и интеграционные секреты в Sites checkout отсутствуют.
- Production БД не читалась и не изменялась.
- Migration `0009_famous_ma_gnuci.sql` только сгенерирована; она создаёт `auth_sessions` и `auth_login_attempts`, но нигде не применялась.
- Migration `0010_outstanding_cargill.sql` только сгенерирована; она добавляет business scope и `security_access_audit`, но нигде не применялась.
- Startup sequence теперь fail closed в исходниках: ошибка migration или отсутствие обязательного security schema inventory блокирует listener и polling. Runtime failure-path ещё должен быть доказан в sandbox.
- Backup production не выполнялся, потому что доступ не предоставлен.
- Разрушительные и production-миграции не выполнялись.

## Текущий вывод

Кодовая база реальна и содержит значительный функциональный фундамент. Реальный payroll source прошёл изолированный импорт и контрольные сверки, но формулы и identities ещё требуют ручного утверждения. Owner-only sanitized Sites checkpoint можно проверять без production-данных; production/Replit и detailed live-data gate остаётся `BLOCKED`. Свежие количества AlfaCRM, фактическая карта филиалов/юрлиц, банковские счета и операции не подтверждены. Поэтому ДДС, ОПиУ, финансовая модель и AI CFO не могут открываться до закрытия HIGH, full Alfa import, read-only bank OAuth и нового Reviewer/Coordinator gate.
