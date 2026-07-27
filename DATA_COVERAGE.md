# ArtHello OS — Data Coverage

## Correction A.11 — deployed evidence v28

| Контур | Фактический deployed status | Интерпретация |
|---|---:|---|
| Publication | `activeBatchId = null`, `atomicSnapshot = false`, `legacy_unattested` | существующие rows не имеют server-attested batch |
| Сотрудники | 114 | legacy owner-only read-model; новая передача не выполнялась |
| Payroll months | 842 | legacy owner-only read-model; не финансовый расчёт |
| Payroll components | 1 318 | source evidence, правила не активированы |
| Linked payments | 1 855 | source evidence; не банковская сверка |
| Unresolved payroll rows | 36 | остаются видимым quality backlog |
| AlfaCRM operational datasets | 0 во всех 8 datasets | terminal full snapshot не доказан и не опубликован |
| Tochka | `active`, 16 счетов, payment actions `false` | read-only connection status; полнота выписки не доказана |
| Money integrity counters | missing minor `0`, legacy mismatch `0` | формат хранения проверен; не подтверждает бизнес-полноту |

Machine status не содержит ФИО, сумм, account identifiers или токенов.
Повторная публикация protected payroll v5 и любые реальные AlfaCRM rows
остаются закрыты отдельным informed approval и source-quality gate.

## Correction A.10 — attestation и identity, 2026-07-26

| Контроль | V27 finding | Correction candidate |
|---|---|---|
| Alfa terminal mode | completed incremental мог пройти | только `full_sandbox_read_only` |
| Scope inventory | проверялись status/incomplete | requested = succeeded = scope runs, failed/incomplete = 0 |
| Snapshot digest | присланный 64-hex сохранялся и возвращался | Worker считает digest из канонических staged rows |
| Staging race | digest отсутствовал | batch `verifying` + transactional stage guard |
| Publication state | `atomicSnapshot=true` даже без active batch | `legacy_unattested` при `activeBatchId=null` |
| Owner identity | разрешённый Sites user получал API `403` | protected owner email согласован с sole allowlisted user |
| UI failure | raw `undefined.map` | shape validation + безопасное пустое состояние |

Новые protected rows в A.10 не передавались. Фактическое безопасное состояние D1 до разрешённой повторной публикации:

| Dataset | Existing rows | Attestation |
|---|---:|---|
| Employees | 114 | legacy / unattested |
| Employee × month | 842 | legacy / unattested |
| Payroll components | 1 318 | legacy / unattested |
| Linked payroll payments | 1 855 | legacy / unattested |
| Payroll unresolved | 36 | legacy / unattested |
| Восемь Alfa operational datasets | 0 | terminal gate closed |

Отсутствие active atomic batch показано владельцу явно. Counts не являются новым v5 snapshot и не разрешают финансовые выводы. Налоги `not_sourced`, правила начислений/ставок/KPI не активированы, банковская сверка и AI CFO закрыты.

## Correction A.9 — publication safety, 2026-07-26

Фактическое покрытие source snapshot не изменилось относительно A.8. V25 не получил реальные payroll rows: PII import остановлен до сетевой отправки. Correction candidate меняет только гарантию публикации:

| Контроль | До correction | Correction candidate |
|---|---|---|
| Full Alfa gate | принимал один `dataMode` | completed batch + terminal flags + failed `0` + incomplete `0` + согласованный status |
| Partial Alfa | 8 operational datasets = `0` | без изменений, fail closed |
| Dataset replace | последовательный live replace | staging manifest + SHA-256 + один atomic D1 commit |
| Сбой посередине | мог оставить mixed state | прежний active snapshot остаётся целиком |
| Legacy import | писал live dataset | `410 ATOMIC_SNAPSHOT_REQUIRED` |
| PII в текущем Sites | не переданы новым импортом | не передаются без отдельного owner approval |

Контрольные counts protected v5: employees `114`, monthly `842`, components `1 318`, payments `1 855`, unresolved `36`, money mismatches `0`; все восемь operational AlfaCRM datasets `0`. Это приватный candidate, не deployed coverage.

После v26 safe machine status показывает те же payroll counts и нулевые Alfa operational datasets, но `activeBatchId = null`. Эти D1 rows созданы прежним последовательным import lifecycle и не были повторно переданы correction cycle. До atomic re-publication их counts видимы owner-only, однако exact payload digest нового protected v5 не аттестован. Новая передача требует отдельного информированного PII approval.

## Срез A.8 — branch-scoped partial snapshot, 2026-07-26

| Источник / набор | Sandbox rows | Публикация в текущий Sites | Статус / ограничение |
|---|---:|---:|---|
| AlfaCRM branches | 8 | 0 | partial aggregate only |
| AlfaCRM students | 2 020 | 0 | 317 incomplete scopes в batch |
| AlfaCRM leads | 1 548 | 0 | отдельно от учеников |
| AlfaCRM groups | 435 | 0 | класс только review candidate |
| AlfaCRM teachers | 362 | 0 | payroll link не подтверждён |
| AlfaCRM teacher rates | 77 | 0 | evidence, не payroll rule |
| AlfaCRM payments | 15 550 normalized / 14 447 current | 0 | не сверены с банком |
| AlfaCRM lessons | 19 678 | 0 | тип допзанятия не authoritative |
| AlfaCRM attendance | 74 770 | 0 | 1 123 без normalized student |
| AlfaCRM memberships | 1 332 | 0 | 2 без normalized student |
| Family candidates | 555 | 0 | pending review; confirmed = 0 |
| AlfaCRM sync status | 1 | 1 aggregate | `partial_aggregate_no_rows` |
| Payroll employees | 114 | 114 legacy D1 / 0 новых rows | active atomic digest отсутствует |
| Payroll monthly | 842 | 842 legacy D1 / 0 новых rows | evidence, не формула расчёта |
| Payroll components | 1 318 | 1 318 legacy D1 / 0 новых rows | formulas/rules не активированы |
| Payroll payments | 1 855 | 1 855 legacy D1 / 0 новых rows | не банковская сверка |
| Payroll unresolved | 36 | 36 legacy D1 / 0 новых rows | ручная очередь |
| Tochka accounts | 16 runtime | runtime owner API | active/read-only; выписки не доказаны |

AlfaCRM batch: requested 2 672, succeeded 2 355, incomplete 317, fetched/saved 56 659. Broken provenance, normalized branch-key duplicates, attendance-without-lesson, tariff-without-student и family-candidate orphan counts равны 0. Повторное использование student CRM-ID между филиалами — 200 и учитывается составным ключом.

Protected export v5 содержит персональные payroll rows и потому хранится только вне source checkout с mode `600`; source secrets и bank secrets в нём отсутствуют. Source-to-minor reconciliation mismatches = 0. Публикация допустима только после повторного подтверждения owner-only policy.

## Candidate A.7 — exact money correction, 2026-07-26

| Источник / набор | Проверенное состояние | Rows | Статус |
|---|---|---:|---|
| Payroll employees | owner source → isolated DB → owner read-model | 114 | сверено |
| Payroll monthly | accrued/paid имеют exact `*_minor` | 842 | mismatches 0 |
| Payroll components | source evidence, не rules | 1 318 | mismatches 0 |
| Payroll linked payments | source evidence, не bank reconciliation | 1 855 | mismatches 0 |
| Payroll unresolved | отдельная очередь, без auto merge | 36 | exact money, требует review |
| Payroll taxes | подтверждённый источник не найден | 0 | `not_sourced`, расчёт выключен |
| Tochka accounts | deployed read-only runtime | 16 | `active`, payment actions false |
| Tochka statements/operations | период и полнота ещё не подтверждены | неизвестно | не использовать для сверки |
| AlfaCRM domain rows | partial sandbox batch | см. A.6 ниже | не публикуются |
| Families | terminal full batch отсутствует | 0 published | auto merge запрещён |

Payroll export safety: `moneyStorageMode = integer_minor_units`, `moneyScale = 2`, `sourceToMinorReconciliation.mismatches = 0`, `legacyRealColumnsAuthoritative = false`, `financialCalculationsEnabled = false`. Частичный AlfaCRM export завершается fail closed с `ALFACRM_TERMINAL_SNAPSHOT_REQUIRED`.

## Candidate A.6 — 2026-07-26

| Dataset | Доказанное состояние | Rows в candidate | Полнота | Ограничение |
|---|---|---:|---|---|
| Alfa branches | partial sandbox observation | 8 | не подтверждена | running batch |
| Alfa students | partial sandbox observation | 1 820 | не подтверждена | 52 incomplete scopes в batch |
| Alfa leads | partial sandbox observation | 998 | не подтверждена | не смешиваются с учениками |
| Alfa groups | partial sandbox observation | 286 | не подтверждена | class status только review candidate |
| Alfa teachers | partial sandbox observation | 131 | не подтверждена | payroll link только exact-name candidate |
| Alfa payments | partial sandbox observation | 18 700 | не подтверждена | не сверены с банком |
| Alfa lessons | partial sandbox observation | 7 448 | не подтверждена | extra status только keyword candidate |
| Alfa attendance | partial sandbox observation | 22 452 | не подтверждена | 70 rows без normalized student |
| Alfa memberships | partial sandbox observation | 0 | неизвестно | scopes не завершены |
| Family candidates | не построены | 0 | ожидаемо | запрещены до terminal full batch |
| Payroll employees | owner-provided source, linked read-model | 114 | source audit выполнен | кадровая identity требует проверки |
| Payroll monthly | linked read-model | 842 | candidate | не является формулой расчёта |
| Payroll components | linked read-model | 1 318 | candidate | source evidence, не правило |
| Payroll payments | linked read-model | 1 855 | candidate | source evidence, не bank reconciliation |
| Payroll unresolved | отдельная очередь | 36 | открыто | automatic merge запрещён |
| Payroll taxes | отсутствующий источник | 0 | `not_sourced` | ставки/суммы не рассчитываются |
| Tochka | owner consent заявлен пользователем | неизвестно | ожидает machine verification | без payment scopes/actions |

Частичная AlfaCRM sandbox содержит 76 completed и 52 incomplete scopes. Эти rows годятся для восстановления прерванной загрузки и data-quality диагностики, но не для утверждения полной операционной картины и не публикуются как завершённая read-модель.

## Owner-only read-model gate A.5 — 2026-07-26

| Источник / область | Фактическая проверка | Результат без раскрытия строк | Статус |
|---|---|---|---|
| Payroll Google Sheet | полный snapshot values + formulas → isolated DB → source-vs-DB audit | 22 вкладки; 2 593 raw; 114 employees; 1 881 выплат; 1 328 начислений | VERIFIED |
| Payroll unresolved | identities не сливались автоматически | 2 строки без суммы отклонены; 26 выплат и 17 начислений требуют ручной проверки | ATTENTION |
| Payroll rules | перенос формул в executable rules | не выполнялся | BLOCKED PENDING OWNER APPROVAL |
| Legal entities | прямое подтверждение владельца | 3 юрлица и 3 operating-unit mappings | OWNER-CONFIRMED; CRM LINK PENDING |
| AlfaCRM full import | полный serial read-only run в отдельную DB | процесс активен; terminal counts ещё не зафиксированы | RUNNING |
| AlfaCRM lineage | migrations `0014–0015` + PGlite | exact observation FK, append-only raw/observation, rollback → reapply, stale cascade | 32 TESTS PASS; REVIEW PENDING |
| Family identity | candidates only | automatic merge = 0 | SAFE MANUAL REVIEW |
| Sites owner auth | access policy + API negative test | 1 allowed user; 0 groups; unauthenticated API = 403 | VERIFIED |
| Sites read-model | D1 schema + import/API/OAuth tests | 13 tables; real rows не embedded; sensitive access audit enabled | LOCAL 11 TESTS PASS; DEPLOY PENDING |
| Tochka credentials | protected environment revision 1 | client configured; secrets absent from Git/frontend | VERIFIED CONFIG |
| Tochka OAuth | synthetic end-to-end D1/provider contract | read-only scope/permissions, state, sealed tokens, multi-customer accounts | TEST PASS; OWNER CONSENT PENDING |
| Tochka accounts/balances | реальный hybrid OAuth | ещё не выполнен | NOT LOADED |
| Legacy Replit | внешний HTTP audit | old indexable build; business read endpoints отвечают без session | HIGH; DO NOT LOAD NEW DATA |

Все строки Sites будут производной минимальной read-моделью. Источниками истины остаются AlfaCRM, утверждённая зарплатная ведомость и банковская выписка. Публикация разрешена только в подтверждённый owner-only проект и журналируется. ДДС, ОПиУ, финансовая модель и AI CFO остаются заблокированы.

## Sandbox data срез A.4 — 2026-07-25

Migration `0014` применена после отдельной копии только к sandbox. Аудит показывает 0 broken provenance по 13 материализуемым таблицам, но сами AlfaCRM-таблицы пока содержат 0 свежих строк из-за предыдущего network timeout. Это доказывает схему и guardrails, а не фактическое покрытие источника. `A4-13-01/02/03` ждут независимого финального PASS.

| Источник / область | Свежая проверка | Обезличенный результат | Статус |
|---|---|---|---|
| Payroll Google Sheet | полный snapshot с evaluated values и formulas | 22 вкладки, 2 593 raw, 114 identities, 1 881 выплат, 1 328 начислений | VERIFIED IN ISOLATED SANDBOX |
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
| Sites control | historical sanitized static artifact | без PII, payroll sums, bank records и secrets | SUPERSEDED BY A.5 OWNER READ-MODEL |

Исторический AlfaCRM count `8` не является свежим результатом A.4. Пока защищённый backend не завершит full import, все фактические CRM counts, даты и branch-to-legal-entity mappings имеют статус `NOT VERIFIED`.

Это описание относится к A.4. В A.5 D-040 разрешает минимальную owner-only read-модель с именами и агрегатами зарплаты; исходные строки и формулы по-прежнему не встраиваются во frontend/deployment artifact.

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
