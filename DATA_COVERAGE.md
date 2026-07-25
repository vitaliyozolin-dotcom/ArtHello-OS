# ArtHello OS — Data Coverage

## Live read-only срез A.3 — 2026-07-25

| Источник | Проверка | Результат | Статус данных |
|---|---|---|---|
| AlfaCRM auth | официальный `/v2api/auth/login` | HTTP 200 | VERIFIED |
| AlfaCRM branches | `/0/branch/index`, без публикации записей | 8 филиалов | VERIFIED COUNT |
| AlfaCRM students/groups/teachers/subjects/payments/lessons | минимальные probes | сетевой контур нестабилен | NOT VERIFIED |
| Tochka client credentials | официальный `/connect/token` | HTTP 200, service token получен | VERIFIED AUTH |
| Tochka accounts | service token, без consent | HTTP 403 | BLOCKED BY HYBRID OAUTH |
| Tochka payments | не вызывались | действий не было | NOT ATTEMPTED |

Sites показывает только статус источника и число филиалов. Названия филиалов, сведения о людях, суммы, счета, токены и операции туда не передаются.

## Обновление A.2

Никакие live-записи не читались. Новых количеств семей, учеников, филиалов, юридических лиц, счетов или операций нет. Credentials со скриншотов намеренно не использованы. PostgreSQL 16 suite использует только синтетические sandbox-записи.

Дата: 2026-07-24
Режим проверки: статический аудит исходников, без production-секретов и без доступа к БД

Легенда:

- `CODE FOUND` — реализация или схема найдена;
- `NOT VERIFIED` — фактический источник и данные не проверены;
- `BLOCKED` — использование запрещено до устранения риска;
- `SAFE CONTROL` — в Sites используются только обезличенные статусы.

| Область | Реализация | Live-подключение | Свежесть / период | Охват | Решение |
|---|---|---|---|---|---|
| AlfaCRM branches | CODE FOUND | NOT VERIFIED | неизвестно | филиалы не подтверждены | read-only инвентаризация |
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
| Auth/RBAC evidence | CODE FOUND | migrations 0009–0010 не применялись | source snapshot 2026-07-24 | non-owner business routes fail closed | sandbox HTTP/PG apply/rollback |
| Branch/legal access scope | CODE FOUND | runtime NOT VERIFIED | source snapshot 2026-07-24 | scoped handlers отсутствуют | BLOCKED для non-owner business data |
| Sensitive access audit | CODE FOUND | runtime NOT VERIFIED | source snapshot 2026-07-24 | canonical route metadata, без payload | sandbox allow/deny audit test |
| Website lead atomicity | CODE FOUND + UNIT PASS | PostgreSQL NOT VERIFIED | source snapshot 2026-07-24 | canonical payload, без Sites data | sandbox PostgreSQL failure/retry smoke |
| Security schema preflight | CODE FOUND + UNIT PASS | PostgreSQL NOT VERIFIED | source snapshot 2026-07-24 | columns/indexes/journal timestamp+hash | sandbox missing-schema startup test |
| Banking health allowlist | CODE FOUND + UNIT PASS | live bank NOT VERIFIED | source snapshot 2026-07-24 | unknown fields dropped | sandbox connector contract test |

## Филиалы и юридические лица

Текущий список филиалов не подтверждён. Исторические упоминания конкретного филиала в `replit.md` не считаются доказательством текущего охвата.

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
