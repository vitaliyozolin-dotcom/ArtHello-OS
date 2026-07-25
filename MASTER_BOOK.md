# ArtHello OS — Master Book

## Дополнение A.4 — изолированный импорт реальных источников

Correction candidate после `FAIL` v13 использует migration `0014`: `alpha_raw_records` является append-only, каждое наблюдение хранится отдельно с batch/scope/page, а нормализованные AlfaCRM-строки требуют существующие raw и batch FK. Snapshot reconciliation разрешён только завершённому scope; partial/repeated-page/max-guard оставляют предыдущий current-state без tombstone. Findings `A4-13-01`, `A4-13-02`, `A4-13-03` считаются исправленными только в candidate и остаются открыты до независимого PASS финального Ревизора и Координатора.

Владелец расширил разрешение на текущие временные credentials: AlfaCRM можно читать полноценно и сохранять в отдельную sandbox-БД, а новый production-клиент «Точки» можно использовать для проверки read-only банковского контура. Это разрешение не включает запись в AlfaCRM, платежи, production-миграции, публикацию персональных или финансовых строк в Sites и хранение секретов в Git.

Реальная зарплатная таблица импортирована в отдельную PostgreSQL-совместимую БД: исходные строки и формулы сохранены как evidence, выплаты и вычисленные начисления сверены с источником. Формулы, ставки и KPI не активированы как правила ArtHello OS. Юридические лица заведены по прямому подтверждению владельца, но фактическая связь каждого филиала AlfaCRM с юрлицом ждёт свежей выгрузки.

Полный AlfaCRM importer готов читать филиалы, учеников и лидов раздельно, оплаты, группы, состав, занятия, посещаемость, педагогов, абонементы клиентов, платёжные справочники и журнал изменений. Raw-слой и нормализованные таблицы имеют обязательный provenance и snapshot-state в candidate `0014`; incremental-режим пока является только обнаружением изменений по `log/index` с перекрытием watermark, а не полной материализацией изменившихся сущностей. Свежий запуск из текущей среды завершился безопасным `request_timeout` до получения филиалов и сохранил ноль CRM-записей; историческое число 8 не является текущей истиной.

Новый клиент «Точки» получил service token, но запрос счетов закономерно требует пользовательский hybrid OAuth. Redirect URI на Sites запрещён: authorization code должен принимать только точный HTTPS callback защищённого backend `/api/banking/oauth/callback`. Consent нельзя создавать до исправления зарегистрированного URI, защищённого runtime environment, backup/rollback и проверки state. Платёжные scopes и платёжные действия запрещены.

## Дополнение A.3 — ограниченная live read-only проверка

Владелец разрешил временно использовать текущие credentials для проверки работоспособности. Допустимы только ephemeral auth, metadata/count probes и read-only запросы; секреты и полученные записи не сохраняются и не публикуются. Подтверждены AlfaCRM auth и 8 филиалов, а также Tochka client credentials/service token. Банковские счета требуют отдельного hybrid OAuth consent. Эти результаты не открывают production, sync, финансовую правду или AI CFO.

## Дополнение A.2 — технические ворота

Bank connector config хранится в authenticated encrypted envelope и fail closed при legacy plaintext secrets. AlfaCRM read-only клиент сериализует запросы ниже лимита 4 req/s. PostgreSQL 16 проверки исторических checkpoints прошли migrations, HTTP/session/CSRF/audit smoke, webhook rollback/retry, schema drift, rollback и fail-closed startup. Candidate цикла 3 дополнительно публикует immutable CI head/tree/digest evidence. Эти PASS не открывают production gate без оставшихся HIGH, восстановленной sandbox-копии и ротации credentials. Credentials, появившиеся в переписке или скриншотах, считаются раскрытыми и требуют ротации.

Статус документа: рабочая книга проекта, восстановлена 2026-07-23 и обновлена 2026-07-25 на основе `ArtHello_OS_Master_Plan_and_Agent_Prompts_v0.1.md`.

## Миссия

ArtHello OS — единая операционная и финансовая система ArtHello. Она должна соединять AlfaCRM, семьи, учеников, группы, сотрудников, зарплату, банки, ДДС, ОПиУ, финансовую модель и рекомендации собственнику.

Система не считается готовой, пока данные нельзя проследить до источника, расчёты нельзя воспроизвести, а денежные и персональные данные не защищены.

## Неподвижные принципы

1. Реальные источники важнее исторических отчётов и интерфейсных заглушек.
2. Наличие таблицы, маршрута или экрана не доказывает полноту и корректность данных.
3. Банк — источник факта движения денег; AlfaCRM — операционный источник. Различия должны быть явно сверены.
4. Нельзя автоматически объединять семьи по одному слабому признаку.
5. Нельзя придумывать оклады, ставки, KPI, финансовые статьи и продуктовые правила.
6. AI CFO и финансовые рекомендации запрещены до прохождения ворот качества финансовой правды.
7. Интеграции банков в этом проекте не инициируют платежи.
8. Production-миграции выполняются только после backup, проверенного rollback и отдельного разрешения.
9. Sites — постоянная приватная контрольная оболочка интерфейса. Реальные персональные, зарплатные и банковские данные в неё не публикуются без подтверждённой защищённой авторизации.
10. Все неподтверждённые значения показываются как «не подтверждено» или «неизвестно», а не заменяются случайными числами.

## Источники истины

Приоритет доказательств:

1. свежая read-only выгрузка или запрос к авторизованному источнику;
2. воспроизводимый запрос и журнал синхронизации;
3. схема БД и код текущей проверенной версии;
4. исторические отчёты — только как гипотеза для перепроверки.

Архив исходников не содержит исходную `.git`-историю. Поэтому прежняя ветка, незавершённые изменения и авторство коммитов пока не подтверждены.

## Контуры

| Контур | Назначение | Допустимые данные | Текущий статус |
|---|---|---|---|
| Replit / рабочее приложение | исторический runtime приложения | только после проверки доступа и защиты | исходники восстановлены; live-выпуск не выполнялся |
| Production DB / интеграции | операционные и финансовые данные | только авторизованный доступ | DB недоступна; для A.3 временно разрешён только ephemeral auth/metadata/count probe интеграций |
| Sites `arthello-os-control` | owner-only контроль интерфейса | обезличенные статусы аудита | активный контрольный контур |
| Локальная рабочая копия | разработка и тестирование | без production-секретов | активна |

## Архитектурный контур

- pnpm-монорепозиторий;
- React/Vite интерфейс `artifacts/alpha-crm-sync`;
- Express API `artifacts/api-server`;
- PostgreSQL/Drizzle в `lib/db`;
- AlfaCRM read-only клиент и синхронизация;
- банковские коннекторы и raw/normalized слои;
- модули семей, обучения, сотрудников, зарплаты и финансов;
- отдельная Sites control surface в `sites-control`, использующая только обезличенный аудит.

## Этапы и ворота

### Фаза A — аудит и восстановление

Выход:

- восстановлена реальная кодовая база;
- зафиксирована её доказуемая версия и происхождение;
- составлена карта сервисов, интеграций, БД и рисков;
- публичные демо-реквизиты удалены из исходников;
- служебный интерфейс закрыт от индексации в исходниках;
- production, локальная разработка и Sites разделены;
- подготовлены документы эксплуатации и качества;
- опубликован owner-only Sites checkpoint без реальных данных.

Фаза A не включает production-миграции, банковские платежи или подтверждение актуальных бизнес-метрик без доступа.

Owner-only checkpoint принимается только если он показывает полный известный реестр существенных рисков. До guarded migration legacy bank config после проверенного backup, ротации раскрытых credentials и закрытия HIGH по upstream errors/debug endpoints, scoped handlers и provider-auth callbacks запрещены production, Replit release, постоянная синхронизация и чтение детальных business records. D-021 разрешает только ephemeral auth/metadata/count probe без сохранения записей. Реализация sessions/RBAC в исходниках сама по себе не открывает gate: migrations `0009–0010` должны пройти backup → sandbox restore → apply → HTTP/PostgreSQL smoke → rollback и интеграционные проверки.

### Фаза A.1 — security perimeter

В исходниках подготовлен первый security-срез:

- устойчивые PostgreSQL sessions с хранением только hash session token;
- Secure/HttpOnly/SameSite cookie вместо bearer token в browser storage;
- double-submit CSRF для изменяющих запросов;
- route-level RBAC `owner/accountant/viewer` с deny-by-default;
- branch/legal-entity scope metadata в session; non-owner business routes fail closed до handler-level predicates;
- fail-closed security access audit с registry шаблонов маршрутов: slug, email, phone, UUID, numeric и percent-encoded identifiers не записываются открыто;
- распределённый login lockout через PostgreSQL;
- централизованная redaction структурированных logs;
- public 5xx response boundary с фиксированным error code и без exception/upstream/PII details;
- историческая `/sync` поверхность fail closed до замены на scoped source jobs;
- generic banking errors и strict-allowlist detailed health response, неизвестные будущие поля автоматически отбрасываются;
- migration failure и отсутствие обязательных columns/indexes/точных hash записей migrations `0009–0010` блокируют listener и banking polling;
- website lead handler требует idempotency key, связывает его с canonical payload, выполняет raw + lead + source update в одной PostgreSQL transaction под advisory lock и возвращает `409` при повторном key с другим payload; внешний вызов всё ещё закрыт;
- удалён fallback-ключ шифрования Evotor;
- sessions/lockout оформлены migration `0009`, scope/audit — migration `0010`; обе не применялись к production.

Pure/unit regression tests доказывают rollback mid-write, retry с одной парой raw/lead, восстановление legacy raw-only записи, payload conflict, schema inventory, allowlist, route canonicalization, cross-scope deny, public error redaction и базовые синтетические финансовые инварианты. Одноразовый PostgreSQL 16 CI подтвердил runtime apply/rollback, session/CSRF, разрешённый access audit, транзакционный failure/retry и fail-closed startup. Candidate evidence всегда связывается с exact PR head/tree через immutable CI artifact. Production и восстановленная sandbox-копия не затрагивались.

Исторический срез A.1 не закрывал plaintext bank secrets и AlfaCRM concurrency limiter. В A.2 vault и serialized queue реализованы и покрыты unit-тестами; A.3 добавляет PostgreSQL 16 CI evidence. Цикл 3 закрыл public 5xx boundary и заблокировал legacy `/sync`, но удаление недоступного legacy code остаётся отдельной release-задачей. Открыты guarded migration legacy rows, ротация ключей, handler-level scope predicates, provider-specific webhook authentication/replay protection, PostgreSQL deny/outage tests и restored-sandbox evidence.

### Следующие фазы

1. Авторизованная read-only инвентаризация источников и покрытия.
2. Надёжный raw → normalized → domain pipeline с наблюдаемостью и дедупликацией.
3. Семьи, ученики, группы и образовательная модель.
4. Сотрудники и проверяемая зарплата.
5. Банк, сверка, ДДС и ОПиУ.
6. Финансовая модель, закрытие месяца и только затем AI CFO.

## Ворота финансовой правды

Переход к расчётам разрешён только когда:

- подтверждены филиалы, юридические лица и банковские счета;
- известны временные границы и свежесть каждого источника;
- проверены пропуски, дубли и несверенные записи;
- утверждены финансовые статьи и правила признания;
- зарплатные формулы имеют подтверждённый источник;
- денежные расхождения объяснены или вынесены в явный реестр исключений;
- Reviewer и Coordinator оценили одну и ту же точную версию.

## Роли контроля

- **Создатель** — единственный редактор исходников и Sites checkout.
- **Ревизор** — новый read-only агент, независимо проверяющий безопасность, данные, расчёты, интерфейс и тесты; итог `PASS`, `CONDITIONAL PASS`, `FAIL` или `BLOCKED`.
- **Координатор** — новый read-only агент, проверяющий единство версии и решение о переходе дальше.

Не более трёх циклов «Создатель → Ревизор → Координатор → исправления».

## Обязательный комплект проектной документации

- `MASTER_BOOK.md` — неизменяемые принципы и ворота проекта;
- `CURRENT_STATE.md` — доказанное состояние и точные версии;
- `DECISIONS.md` — существенные решения и ограничения;
- `BACKLOG.md` — открытая работа по приоритетам;
- `DATA_COVERAGE.md` — покрытие и свежесть источников;
- `RUNBOOK.md` — воспроизводимые операции, backup и rollback;
- `SECURITY_CHECKLIST.md` — security gate;
- `MONTH_CLOSE_CHECKLIST.md` — финансовые ворота закрытия периода.

Наличие файла не означает прохождение gate. Каждый статус должен ссылаться на доказательство одной точной версии.

## Текущая управленческая формулировка

На 2026-07-25 технический фундамент и security perimeter усилены, payroll source проверяемо загружен в изолированную sandbox-БД, а новый клиент «Точки» прошёл только auth gate. Операционная полнота AlfaCRM, банковские данные и финансовая правда ещё не подтверждены. Sites checkpoint обязан показывать разницу между «подтверждено источником», «проверено в sandbox», «реализовано в коде» и «выпущено live», а не имитировать готовую аналитику.
