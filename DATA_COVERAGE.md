# ArtHello OS — Data Coverage

## Sandbox data срез A.4 — 2026-07-25

Migration `0014` применена после отдельной копии только к sandbox. Аудит показывает 0 broken provenance по 13 материализуемым таблицам, но сами AlfaCRM-таблицы пока содержат 0 свежих строк из-за предыдущего network timeout. Это доказывает схему и guardrails, а не фактическое покрытие источника. `A4-13-01/02/03` ждут независимого финального PASS.

| Источник / область | Свежая проверка | Обезличенный результат | Статус |
|---|---|---|---|
| Payroll Google Sheet | полный snapshot с evaluated values и formulas | 22 вкладки, 3 689 raw, 114 identities, 1 881 выплат, 1 328 начислений | VERIFIED IN ISOLATED SANDBOX |
| Payroll integrity | повторный source-vs-DB audit | counts и суммы совпали; duplicates 0; 26/17 unresolved | PASS WITH MANUAL REVIEW |
| Payroll rules | активация formulas/KPI | не выполнялась | BLOCKED PENDING APPROVAL |
| Legal entities | прямое подтверждение владельца | 3 юрлица и 3 operating-unit rules | OWNER-CONFIRMED MASTER DATA |
| AlfaCRM full import | свежий read-only run | request timeout; fetched 0; saved 0 | NETWORK BLOCKED |
| AlfaCRM importer coverage | code + 18 AlfaCRM tests, включая PGlite normalization smoke | students/leads separately, groups, memberships, teachers, lessons, attendance, payments, customer tariffs, payment dictionaries, change log | CODE/TEST VERIFIED, DATA NOT VERIFIED |
| AlfaCRM incremental discovery | `log/index` + watermark overlap | change discovery with 1–7 day overlap; entity rematerialization not claimed | CODE/TEST VERIFIED, LIVE NOT VERIFIED |
| Family identity | importer policy | manual candidates only; automatic merges 0 | SAFE CANDIDATE MODE |
| Tochka production client | token + accounts probe | token HTTP 200; accounts HTTP 403 | AUTH VERIFIED, DATA REQUIRES OAUTH |
| Tochka accounts/transactions | consent не создавался | 0 records | BLOCKED BY CALLBACK/OAUTH |
| Public Replit | внешний HTTP audit | old build; indexing protections отсутствуют live | HIGH / RELEASE REQUIRED |
| Sites control | sanitized static artifact | без PII, payroll sums, bank records и secrets | OWNER-ONLY SAFE CONTROL |

Исторический AlfaCRM count `8` не является свежим результатом A.4. Пока защищённый backend не завершит full import, все фактические CRM counts, даты и branch-to-legal-entity mappings имеют статус `NOT VERIFIED`.

В payroll Sites показывает только контрольные количества. Реальные имена, строки, суммы и формулы остаются в локальной sandbox-БД и source snapshot, не в frontend или deployment artifact.

## Исторический live read-only срез A.3 — 2026-07-25

| Источник | Проверка | Результат | Статус данных |
|---|---|---|---|
| AlfaCRM auth | официальный `/v2api/auth/login` | HTTP 200 | VERIFIED |
| AlfaCRM branches | `/0/branch/index`, без публикации записей | 8 филиалов | VERIFIED COUNT |
| AlfaCRM students/groups/teachers/subjects/payments/lessons | минимальные probes | сетевой контур нестабилен | NOT VERIFIED |
| AlfaCRM leads/subscriptions/payment dictionaries/change log | обязательные read-only endpoints | реализованы и протестированы в коде; live rows не получены | CODE VERIFIED, DATA NOT VERIFIED |
| Tochka client credentials | официальный `/connect/token` | HTTP 200, service token получен | VERIFIED AUTH |
| Tochka accounts | service token, без consent | HTTP 403 | BLOCKED BY HYBRID OAUTH |
| Tochka payments | не вызывались | действий не было | NOT ATTEMPTED |
| PostgreSQL 16 CI | одноразовая БД, только синтетические записи | migrations/session/CSRF/audit/webhook/rollback/startup PASS | VERIFIED SANDBOX RUNTIME |
| Financial invariants | pure synthetic tests, integer minor units | balance/transfers/reporting dates/payroll versions/reversals/rounding PASS локально | SYNTHETIC ONLY |
| Legacy `/sync` API | централизованный fail-closed gate | `LEGACY_SYNC_DISABLED` | DISABLED |

Sites показывает только статус источника и число филиалов. Названия филиалов, сведения о людях, суммы, счета, токены и операции туда не передаются.

Synthetic financial invariants не являются данными ArtHello и не подтверждают реальные остатки, статьи, ставки, payroll или закрытие месяца.

## Обновление A.2

На этапе A.2 live-записи не читались. В A.3 подтверждены только auth и количество филиалов без публикации записей. PostgreSQL 16 suite использует исключительно синтетические sandbox-записи и не подключается к AlfaCRM или банкам.

Дата: 2026-07-24
Режим проверки: статический аудит исходников, без production-секретов и без доступа к БД

Легенда:

- `CODE FOUND` — реализация или схема найдена;
- `NOT VERIFIED` — фактический источник и данные не проверены;
- `BLOCKED` — использование запрещено до устранения риска;
- `SAFE CONTROL` — в Sites используются только обезличенные статусы.

| Область | Реализация | Live-подключение | Свежесть / период | Охват | Решение |
|---|---|---|---|---|---|
| AlfaCRM branches | CODE FOUND + LIVE COUNT | auth/endpoint HTTP 200 | 2026-07-25 | 8 филиалов; состав не подтверждён | обезличенная read-only инвентаризация |
| AlfaCRM students | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | профиль объёма, дублей и дат |
| AlfaCRM payments | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | сверка с банком |
| Lessons / attendance | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | проверить endpoint и полноту |
| Teachers / groups | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | сопоставить с HR/education |
| Families / persons | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | проверить identity rules |
| Educational model | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | подтвердить бизнес-правила |
| Employees / roles | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | подтвердить штат и юрлица |
| Payroll | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | ставки и формулы не утверждены |
| Tochka accounts | CODE FOUND + VAULT UNIT PASS | NOT VERIFIED | неизвестно | счета/юрлица не подтверждены | BLOCKED до backup, guarded legacy migration и ротации |
| Tochka transactions | CODE FOUND + VAULT UNIT PASS | NOT VERIFIED | неизвестно | неизвестно | BLOCKED до backup, guarded legacy migration и ротации |
| T-Bank | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | проверить актуальный контракт |
| VTB | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | проверить актуальный контракт |
| Ledger / reconciliation | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | свежая сверка |
| ДДС | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | нельзя использовать |
| ОПиУ | CODE FOUND | NOT VERIFIED | неизвестно | неизвестно | нельзя использовать |
| AI CFO | CODE FOUND | не запускается | неприменимо | неприменимо | ждать `READY` |
| Sites control | SAFE CONTROL | owner-only подтверждён | audit snapshot | без PII и денег | разрешён checkpoint |
| Auth/RBAC evidence | CODE FOUND + PG16 CI PASS | migrations 0009–0010 apply/rollback в одноразовом CI | CI 2026-07-25 | non-owner business routes fail closed | restored sandbox до Replit release |
| Branch/legal access scope | CODE FOUND | runtime NOT VERIFIED | source snapshot 2026-07-24 | scoped handlers отсутствуют | BLOCKED для non-owner business data |
| Sensitive access audit | CODE FOUND + UNIT PASS | allowed route PG16 PASS; deny/outage PG NOT VERIFIED | CI 2026-07-25 | canonical route metadata, без payload | PostgreSQL deny/outage smoke |
| Website lead atomicity | CODE FOUND + PG16 CI PASS | failure/rollback/retry/duplicate/conflict PASS | CI 2026-07-25 | canonical payload, без Sites data | provider-auth до public callback |
| Security schema preflight | CODE FOUND + PG16 CI PASS | controlled drift и fail-closed startup PASS | CI 2026-07-25 | columns/indexes/journal timestamp+hash | сохранить обязательный quality gate |
| Banking health allowlist | CODE FOUND + UNIT PASS | live bank NOT VERIFIED | source snapshot 2026-07-24 | unknown fields dropped | sandbox connector contract test |

## Филиалы и юридические лица

Количество филиалов подтверждено live как 8. Названия, идентификаторы, состав и сопоставление с юридическими лицами не подтверждены и не публикуются. Исторические упоминания конкретного филиала в `replit.md` не считаются доказательством текущего охвата.

Текущий список юридических лиц, ИНН, счетов и их связи с филиалами не извлекался и не публикуется.

## Контрольные запросы для следующего этапа

Для каждой сущности нужно получить:

- источник и endpoint/table;
- минимальную и максимальную дату;
- общее число строк;
- число уникальных business keys;
- число дублей;
- число строк без обязательных связей;
- время последней успешной синхронизации;
- филиал и юридическое лицо;
- долю raw-записей, дошедших до normalized/domain слоя.

Результаты должны быть обезличены до передачи в Sites.

Security-срез A.1 не меняет ни одного live-показателя покрытия. Количества, даты, филиалы, юридические лица и источники остаются `NOT VERIFIED`.
# Обновление 2026-09-10 — финансовый контур D123

| Область | Подтверждённый охват | Статус |
|---|---|---|
| Юрлица и филиалы | 3 юрлица, 5 раздельных филиалов; подтверждено владельцем | OWNER CONFIRMED |
| ООО «АртХелло» | 4 счёта; Атлас-школа и Атлас-садик | BANK VERIFIED, CLASSIFICATION PARTIAL |
| ИП Тюрин | Лиственная | MASTER DATA ONLY; ACCOUNTS NOT CONNECTED |
| ООО «УК Детское образование» | 1–11, Небо, управленческие услуги, праздники | MASTER DATA ONLY; ACCOUNTS NOT CONNECTED |
| Банк → финансовая проекция | 64 операции за 2026-09-01–2026-09-10, 24 поступления и 40 списаний; связи 1:1, нарушения 0 | VERIFIED READ-ONLY SNAPSHOT |
| Авторазнесение Атласа | только неразнесённые RUB-поступления с одним явным признаком школы или детского сада | GUARDED PARTIAL |
| Консолидация УК | правило исключения внутригрупповых управленческих оборотов подтверждено | LOGIC CONFIRMED; IMPLEMENTATION PENDING |

## Обновление 2026-09-10 — филиальные отчёты D132

| Область | Правило покрытия | Статус |
|---|---|---|
| Дата начала | операции управленческого учёта только с 01.09.2026 | OWNER CONFIRMED; CODED |
| Справочник статей | 148 активных утверждённых статей; рабочие изменения заблокированы | OWNER CONFIRMED; CODED |
| ОДДС / ОПиУ | только один явно выбранный активный доступный филиал | CODED; LIVE NOT VERIFIED |
| Общий отчёт | не формируется | OWNER CONFIRMED; CODED |
| Наборы без филиального ключа | общие остатки юрлица, начисления и зарплатные агрегаты не включаются | FAIL-CLOSED |
| Авторазнесение Атласа | новые однозначные RUB-поступления школы/садика с даты старта | TESTED IN CODE; LIVE NOT VERIFIED |

Платежи других юрлиц нельзя считать отсутствующими: их счета ещё не подключены. Неоднозначные назначения нельзя угадывать.
