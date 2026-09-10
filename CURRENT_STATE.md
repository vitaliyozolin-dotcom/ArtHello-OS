# ArtHello OS — Current State

- Первый D122 protected run `34520906921/103018492882` остановился до контейнеров и Caddy: artifact/checksums прошли, gateway Docker не разрешил raw image-ID lookup после load. D123 сохраняет тот же receipt и добавляет обязательное разрешение через immutable tag с немедленной сверкой tag→image ID; production Atlas ещё не принят.
- D-122 готовит первый защищённый запуск отдельного дневника «Атласа» на `https://atlas-188-225-38-55.sslip.io`. Read-only runs `34517280798` и `34518569941` доказали: central healthy и единственный, но Atlas secret/env/container/volumes/route отсутствуют; живой central — accepted D113 source `ff8559254faaedade63a9ee7567a45686d08c13a`, image `sha256:34402014063a05c81754716f46b3f9059297f1d21d37da7e5f00b1eb8f7fdd46`. Кандидат D-122 ещё не принят: до CI, merge, protected receipt и публичных health/SSO проверок production остаётся без Atlas.
- D-120 консолидирует hosted bounded production diagnostic в основной Quality: четыре Python recovery contracts стали частью `test:full`, а уже усыновлённые Node tests больше не запускаются повторно отдельными командами. Последний standalone diagnostic run `34497446356` был SUCCESS; workflow архивирован с blob/SHA-256 provenance, активный ratchet снижен с 14 до 13. Тестовая стратегия отделяет behavioral tests от структурных policy assertions и frozen recovery contracts; проверка запуска lint переведена с regex текста workflow на YAML structure.
- D-119 усыновляет полный `scripts/test/*.test.mjs` как последовательный legacy CI suite; локальная инвентаризация дала 374 PASS и один fixture-зависимый migration-twin test, который теперь явно skip без report и по-прежнему исполняется PostgreSQL gate. Coverage расширен вторым фактически измеренным scope `visual-browser-startup` (100% lines, 78.69% branches, 90% functions; ratchet 100/78/90).
- PostgreSQL backup теперь пишет `.partial`, проверяет custom archive через `pg_restore --list`, атомарно публикует dump/checksum и после отдельной ошибки повторяет попытку вместо смерти контейнера. Manual v44 Git fallback больше не использует TOFU. Off-host/alerts/RPO/RTO остаются не подтверждены: провайдер, destination и целевые значения владельцем не заданы.
- D-106 начинает оставшуюся часть трека 6.6: `test:full` получил обязательный Node 24 coverage ratchet для явно ограниченного API policy-core. Checked-in baseline измерен фактическим прогоном: lines 93.32%, branches 70.51%, functions 92.92%, 56/56 тестов PASS; это не заявляется покрытием всего API.
- Exact D-106 run `34473673544` выявил загрязнение v44 manifest локальным `tsconfig.tsbuildinfo`; D-107 устранил причину. Исправленный SHA `2acc22559ca11f784c07ad6b2a859ee907c87306` / tree `7b3022803ee85ec8e95831b3a2e66fc0adc4d645` прошёл Quality `34477515417`: все 6 jobs SUCCESS, включая coverage, secret-scan и School v44/v52. Provenance artifact `10152210530` не истёк, head/tree совпадают, checksum его `provenance.txt` подтверждён. CI/provenance треков 6.4 и coverage-части 6.6 закрыт; production deploy этим не разрешён.

## Tochka source compatibility checkpoint (2026-09-10)

- D-100 исправляет воспроизведённые после D-099 ошибки canonical source verification и банковских test imports. Независимая реконструкция дала совпадение 237 v44 и 454 v52 source files; локально 14 targeted tests PASS. Hosted exact-head CI ещё обязателен.
- Hosted R14 verification разделён на current source/bank checks и frozen historical comparisons в частном temporary fixture. Четыре локальных regression tests подтверждают отказ при current source/protocol drift; protected R14 controller и его runtime contract неизменны и по-прежнему не разрешают выпуск изменённого D-099 source.
- Это подготовка исходников, не выпуск. Run34391105865 attempt2 завершился до cutover, cleanup завершён. Последний принятый runtime — R13. Новый actual банк/ДДС report не получен, PR399 остаётся UNBOUND.
- Подробности: `docs/acceptance/2026-09-10-tochka-source-compatibility.md`.

## Refactoring Phase 6 — workflow cleanup checkpoint (2026-09-09)

- D-105/D-107 закрыли трек 6.4: v44/v52 получили воспроизводимую генерацию Cloudflare runtime declarations и обязательный `tsc`; `quality.yml` запускает отдельную GitHub-hosted matrix-сборку application stage обоих School Dockerfile без secrets, Environment или production runner. Этот checkout содержит 135 School test-файлов. Локально оба application stage прошли typecheck, lint, production build и тесты: v44 — 102/102, v52 — 772/772; exact Quality `34477515417` подтвердил оба School jobs и общий test job.
- Трек 6.3 завершён кандидатом D-099: v44/v52 School source материализован в обычные деревья `deploy/*/src`, а Dockerfile больше не декодируют архивы и не исполняют patch transport.
- Exact legacy reconstruction дала пустой файловый diff с materialized source. Canonical tree SHA проверяются `scripts/verify-school-source.mjs` через `test:refactoring`; обе Docker-сборки с внутренними lint/test/build воротами прошли локально. Старые 16 archive chunks и patch/override transport удалены после этой проверки; одна неисполняемая immutable evidence-копия `deploy/v52/overrides/production/backup-transport.mjs` сохранена для frozen R13 source contract.
- Secret-scan, заявленный при подготовке materialized деревьев, не был повторён в текущей сессии: локальный `gitleaks` отсутствует. Поэтому immutable CI/history-scan остаётся обязательным evidence до принятия кандидата.

- Три доказанных cleanup-блока удалили из активной `.github/workflows` 33 завершённых one-shot: production hotfix D060–D069, recovery R2–R12, ранние School recovery diagnostics, frozen SSO/curriculum cutover, topology probe, legacy RU D059, R12 verifier и завершённый D092 artifact inspector.
- После параллельного добавления approved-catalog importer активный набор составлял 15 workflow; D116 архивировал завершённый accepted R17 controller после successful run `34495273615` и skipped post-acceptance run `34498059829`, снизив ratchet до 14. Исходные blob SHA, accepted evidence и восстановление записаны в `docs/workflow-archive-2026-09-09.md`.
- Workflow policy gate проверяет оставшийся набор. R13, текущие browser/data checks, `quality.yml` и `proof-gates.yml` не затронуты до проверки фактических GitHub run provenance.
- Checked-in ratchet `quality-gates/workflow-policy-ratchet.json` ограничивает активный каталог текущим максимумом 14: дальнейшее уменьшение разрешено, незаявленный рост блокирует workflow policy gate.
- `test:full` теперь включает актуальный importer/sandbox suite workspace `scripts` и PostgreSQL 16 gate; дублирующий отдельный `test:postgres` после агрегата удалён из `quality.yml`. Полный legacy glob `scripts/test/*.test.mjs` пока не считается зелёным CI-suite: в нём остаются spent release contracts и sandbox-sensitive server tests.
- Фаза 6 остаётся открытой только там, где нет доказанного безопасного repo-only закрытия: дальнейшая консолидация живых workflow, внешний off-host/alert/RPO/RTO контур и постепенная замена сохраняемых recovery/source-policy assertions эквивалентными behavioral contracts.

## Refactoring Phase 5 — closed (2026-09-09)

- D-086 делает URL источником выбранного раздела back-office: 28 owner sections имеют уникальные канонические пути, а внутренние переходы используют browser history через `wouter`.
- Прямые загрузки и обновление страницы сохраняют раздел; Back/Forward меняют section вместе с history. Неизвестный путь заменяется на `/` без эвристического выбора экрана.
- Visual canon теперь содержит route provenance. Локальный acceptance проверил `/`, `/banking`, `/employees` и `/integrations/alfacrm/coverage` в desktop/mobile: 8/8 проверок приняты.
- Сервер, API client и Sites control не изменялись. Frontend typecheck, 7 frontend/visual regression tests и production build прошли.

## Refactoring Phase 4 — closed (2026-09-09)

- D-085 фиксирует структурную декомпозицию без изменения HTTP-контракта и permission semantics; номер обновлён после появления параллельных D-083/D-084 в `origin/main`.
- Исторический `routes/audit.ts` удалён: его 17 `/coverage/*` обработчиков перенесены в тематические именованные Router-модули под `routes/coverage/`, а порядок подключения сохранён агрегатором.
- После переноса contract-drift сохранил 302 runtime method/path, 156 OpenAPI method/path и 146 явно инвентаризированных server-only method/path без необъяснённых или stale записей; permission proof сохранил результат 14/14.
- Все публичные `routes/**/*.ts` теперь не превышают 500 строк и используют именованные exports; крупные реализации изолированы за тонкими feature entrypoints. Auth middleware импортируется приложением через `lib/security/auth-middleware.ts`.
- `coverage`, `banking` и `employees` перемещены в frontend feature-каталоги со стабильными compatibility wrappers в `pages/`; production build и desktop/mobile visual acceptance прошли без изменения принятого интерфейса.
- Постоянный `phase-four-architecture` ratchet запрещает возврат oversized route API, default route exports, `audit.ts` и giant-page implementations в `pages/`.

## Refactoring Phase 3 — contract and correctness boundary (2026-09-09)

- D-082 закрепляет OpenAPI как источник публичного типизированного контракта. Исполняемый contract-drift gate видит 302 runtime method/path, 156 OpenAPI method/path и 146 существующих server-only method/path с явным disposition; необъяснённых и stale записей нет. Это технический inventory, не продуктовые количества.
- `@workspace/shared` консолидирует phone normalization, SHA-256, CSRF-cookie parsing и форматирование рублей. Нормализация не выполняет автоматического identity/family merge.
- Прямые исполняемые frontend-вызовы глобального `fetch` удалены: OpenAPI-операции используют generated client, а ещё не документированные legacy операции проходят через совместимый `apiFetch` того же пакета с едиными credentials/base URL/CSRF. Демонстрационный текст интеграции не является вызовом.
- `api-zod` продолжает применяться в стабильных route-модулях; god-файлы Фазы 4 не переписывались ради промежуточной схемы.

## Refactoring Phase 2.3–2.4 — checked migrations and orphan schema retirement (2026-09-09)

- D-080 делает manifest-verified checked-in Drizzle SQL единственным runtime-авторитетом миграций; `migrate.ts` и runtime `drizzle-kit` удалены из startup path.
- Schema-diff на одноразовом PostgreSQL 16 подтвердил равенство конечного legacy и checked-in путей: normalized catalog SHA-256 `f0078f8046a7b986194e8ccc56ec583b80f026b412b612138af7fda7971079e0`. Это технический snapshot, не продуктовая метрика.
- Миграция `0018_retire_orphan_chat` сохраняет доказанную legacy schema-дельту и удаляет только пустые общие `messages`/`conversations`; непустые таблицы блокируют транзакцию. Живые `front_office_messages`/`front_office_conversations` остаются.
- API boot только читает полный migration ledger и security catalog до `listen()`/polling. Production применение по-прежнему запрещено без backup, restored-sandbox evidence и отдельного разрешения D-009.

## Production continuation R7 — 2026-09-08

- R6 source PR361 is merged as eb47c1360fbd701876a3c49efe029194707304db; exact PR and main Quality, Proof, Verify passed, including 756 application tests.
- Actual R6 run34221458013/job102045375780 verified the installed School R5 read-only at11:35:42Z. Original relay activation09:16:10Z and School source/config/container identities are preserved.
- The same run measured gateway UID995 without root or passwordless sudo for the existing host backup installer. Image import, clone and ArtHello cutover were skipped. Live ArtHello was freshly observed as6596f69390ad539577ec2640e8ef40c7e12c22dc.
- D-073 selects R7 with a separate ordinary-UID backup worker on exact D1 read-only and dedicated backup/control volumes; a separate UID1002 activation writer owns another volume. This removes host installer dependencies without granting host administration. Actual Docker isolation/restore checks and exact CI remain required.
- Natural authenticated Education-to-diary navigation remains unverified; the cloud browser returns502 before login. Server-side transport success is separate evidence.
- Alfa deposits now use confirmed Customer.balance semantics; real tenant coverage/import acceptance and verified PayType direction for CRM payments remain open. No completed six-scenario production acceptance is claimed.

Full R6 receipt and gate identifiers are retained on branch `codex/recovery-evidence-20260907` in `docs/acceptance/2026-09-08-r6-release-checkpoint.json`. New runtime operation is documented in `deploy/v52/backup/README.md`.

## Refactoring Phase 2.6 — database access policy checkpoint (2026-09-09)

- D-077 закрепляет Drizzle builder как основной путь, допускает `db.execute(sql)` для отчётных запросов и запрещает новые `pool.query` точным сокращаемым baseline.
- PGlite ограничен `scripts/`; policy-check включён в `lint` и агрегатный `test:refactoring` с поведенческими allow/deny/stale-baseline тестами.
- Существующие запросы и бизнес-поведение не изменены. Шаги 2.3–2.4 завершены отдельным кандидатом D-080; до окончательного закрытия Фазы 2 остаются restored-sandbox, backup/rollback, удалённый CI и независимый Reviewer gate.

## Refactoring Phase 2.5 — lazy configuration checkpoint (2026-09-08)

- `lib/db` теперь можно импортировать без `DATABASE_URL`; подключение создаётся лениво через `createDb(env)` или при первом использовании совместимых exports `db`/`pool`.
- Отсутствующий `DATABASE_URL` по-прежнему обрабатывается fail closed при первой попытке создать или использовать подключение; поведение закреплено в агрегатном `test:refactoring`.
- `alphaCrmClient` также импортируется без tenant env; `createAlphaCrmConfig(env)` проверяет явный `ALFACRM_DOMAIN` только перед сетевой операцией и сохраняет fail-closed поведение до `fetch`.
- Пункт 2.5 выполнен; схемы, API-контракт и production-конфигурация не изменялись.

## Рефакторинг, Фаза 2 — локальный checkpoint 2026-09-08

- Snapshots `0016` и `0017` воспроизведены из точных исторических schema trees; текущий неизменный schema tree даёт `No schema changes, nothing to migrate`.
- Migration Twin на одноразовом PostgreSQL 16 доказал все 18 миграций и отдельный representative round-trip 0009–0010: owner scope, отзыв accountant/viewer, audit insert, сохранение sessions через rollback 0010 и явно деструктивный rollback 0009.
- Это disposable synthetic evidence, а не прогон на восстановленной sandbox-копии. Соответствующий BACKLOG gate и production migrations остаются открыты.

## Рефакторинг, Фаза 1 — закрыта 2026-09-08

- Локальный Zod/OpenAPI candidate восстановлен поверх актуального `origin/main` с решениями D-061–D-065; Zod policy получила следующий свободный номер D-066.
- Cleanup workspace/UI, включение `sites-control`, единый pnpm pin и удаление опасного Replit schema push сохраняются. Runtime dependency placement теперь защищён поведенческим inventory-тестом.
- Zod runtime imports унифицированы на `zod/v4`; generated schemas имеют characterization tests, Orval явно генерирует v4, а два последовательных codegen дали одинаковые SHA-256 generated outputs. Это локальное evidence рабочего дерева, не immutable CI provenance.
- Добавлены `CODEOWNERS` для `.github/` и `deploy/` и blocking lint-step в `quality.yml` для сопровождаемых файлов Фазы 1. Полное форматирование legacy application tree намеренно не заявлено выполненным.
- Для legacy `/sync` зафиксирован полный inventory 30 routes и literal call-sites; D-067 утвердило dispositions. Legacy router, mount, OpenAPI/generated operations и операторские call-sites удалены без переноса неподтверждённых jobs; sandbox capabilities сохранены.
- Остальные implementation-пункты Фазы 1 выполнены под D-068: Node/bundler import policies разделены и lint-ratchet расширен на application tree.
- Финальные локальные ворота выполнены под Node 22.13.0 и pnpm 11.7.0: `pnpm run typecheck`, `pnpm run test:full`, `pnpm run build:full`, `pnpm run lint`, `node scripts/permission-proof.mjs` и visual acceptance на desktop/mobile завершились успешно. Фаза 1 закрыта; это локальное evidence, не immutable CI provenance и не разрешение production-выпуска.

## Обновление A.4 — 2026-07-25

- Создана отдельная PostgreSQL-совместимая sandbox-БД вне source checkout; перед `0014` сохранена отдельная копия, затем применены 15 миграций. Аудит видит 113 таблиц с учётом sandbox migration ledger. Production БД не читалась и не изменялась.
- По подтверждению владельца заведены три юридических лица и три операционных правила: «Атлас садик и школа» → ООО «АртХелло», «Лиственная» → ИП Тюрин Павел Олегович, «Школа 1-11» → ООО «УК Детское образование». Фактическая CRM-привязка филиалов ещё не доказана.
- Реальная зарплатная таблица импортирована в sandbox: 3 689 raw-строк с formula snapshots, 114 уникальных внешних employee identities, 1 881 выплат и 1 328 ненулевых результатов начислений. Две строки выплат без суммы отклонены; 26 связей выплат и 17 связей начислений оставлены unresolved. Дублей нет, 11 периодов имеют юрлицо.
- Контрольный аудит подтвердил совпадение числа и суммы принятых выплат/начислений с source snapshot. Формулы сохранены как evidence, но ни одно payroll rule, ставка или KPI не активированы.
- Полный read-only AlfaCRM importer покрывает учеников отдельно от лидов, архив, группы, состав, педагогов, занятия трёх статусов, посещаемость, оплаты, абонементы клиентов, четыре платёжных справочника и журнал изменений. Candidate `0014` делает raw append-only, сохраняет отдельное observation на batch/scope/page, требует реальный raw/batch FK у каждой материализованной строки и выполняет stale reconciliation только после полностью успешной пагинации scope. Partial, repeated-page и pagination-guard не tombstone-ят отсутствующие записи. Incremental discovery остаётся только обнаружением изменений.
- Свежий AlfaCRM full run из текущей среды завершился `partial/request_timeout` до branch inventory: fetched 0, saved 0. Прямое соединение также оборвано cloud proxy. Исторические 8 филиалов остаются только historical provenance и не показываются как текущее покрытие.
- Предыдущий auth-probe production-клиента «Точки» вернул HTTP 200, accounts с service token — HTTP 403. Владелец передал новый временный credential, но он не записан в source/Sites/БД и ещё не введён через protected backend environment. Для счетов всё равно требуются Authorization Code consent и hybrid token. Consent не создавался, счета/операции не читались, платежные действия не выполнялись.
- Зарегистрированный у банка redirect ведёт на корень Sites и не соответствует защищённому backend callback. Код требует точный HTTPS `/api/banking/oauth/callback` вне `.chatgpt.site`, строгий state и только read-only scopes.
- Public Replit 25.07.2026 всё ещё отдаёт старую индексируемую сборку: исходники уже закрывают индексирование и убирают публичные account hints, но выпуск не выполнялся.
- Ревизор v13 выдал `FAIL`: `A4-13-01` — raw provenance перезаписывался, `A4-13-02` — не было безопасного snapshot reconciliation, `A4-13-03` — использовался неверный pagination-параметр и не было failure tests. Поэтому прежнее заявление о закрытии A4-01 отозвано.
- Migration `0014` и rollback companion исправляют эти три finding в source candidate и применены только к отдельной sandbox-БД после копии. 29 data-import tests, включая PGlite apply/upsert/rollback, FK/orphan rejection, raw UPDATE/DELETE rejection, atomic page rollback, page 0/1/2, repeated page, max guard, transport failure, retry, lead→student, stale branch exclusion и stale family evidence, проходят. `typecheck`, `build:full`, 31 API security test и 10 Sites tests также проходят. Текущий PostgreSQL 16 wire-protocol gate заблокирован отсутствующим `TEST_DATABASE_URL`; исторический PG16 PASS не считается доказательством migration `0014`. Независимые Reviewer/Coordinator ещё не завершены; `A4-13-01/02/03` остаются открытыми до их PASS.
- Agent preview daemon подтвердил запущенный Sites runtime, но точный `terminal.local:4173` не отдал байты за 10 секунд (предыдущая попытка возвращала gateway `502`), а browser-инструмент в текущей сессии недоступен. Live Sites внутри не открывался; интерактивный desktop/mobile browser QA заменён 10 Sites tests: worker artifact, навигация, CTA, mobile drawer и responsive CSS. Это ограничение должен учитывать Ревизор.

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

| Узел доказательства     | Точное значение                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Local source commit     | `8735824a214e980ff9cb492fa7253959ab6c2123`                                                   |
| Local Git tree          | `b3ede5bc05cd8685b64031f80db8fc9bbd6ad799`                                                   |
| Private Draft PR        | `vitaliyozolin-dotcom/ArtHello-OS#1`, open, draft, unmerged                                  |
| Remote PR head          | `7f175fa7f14a55b0f329b95a6f63d326682ec113`                                                   |
| Claimed remote Git tree | `b3ede5bc05cd8685b64031f80db8fc9bbd6ad799`; не было независимого `tree.sha` evidence         |
| GitHub Actions          | run #8, `30163177884`, conclusion `success`                                                  |
| Sites version           | `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_71ff653bbc548191b1b138dec8eaa332`          |
| Sites deployment        | `appgdep_6a64d3b5e134819193ba100f503db92d`, status `succeeded`                               |
| Reviewer                | `CONDITIONAL PASS` только owner-only sanitized checkpoint                                    |
| Coordinator             | `CONDITIONAL GO` только owner-only; цикл 3 разрешён; Phase A/production/next phase `BLOCKED` |

## Историческое provenance A.3 checkpoint v9

| Узел доказательства | Точное значение                                                                     |
| ------------------- | ----------------------------------------------------------------------------------- |
| Local source commit | `0900b9cff88e330afd095bcc8ac17da11a6ce50c`                                          |
| Local Git tree      | `609e64852c47808c0447f247976d6dd4513bb038`                                          |
| Private branch      | `codex/a3-live-read-only`                                                           |
| Private Draft PR    | `vitaliyozolin-dotcom/ArtHello-OS#1`, open, draft, unmerged                         |
| Remote PR head      | `3ab2cfe4310f5d22a42e0c874180428894dae788`                                          |
| Remote Git tree     | `609e64852c47808c0447f247976d6dd4513bb038`                                          |
| GitHub Actions      | run #7, `30161981773`, conclusion `success`                                         |
| Sites version       | `appgprj_6a626e9e441481919bb30eee8ba97165~appgver_37098405ed048191ab3943dfea63c76c` |
| Sites deployment    | `appgdep_6a64cae273e881919dc83dbf2f8645e0`, status `succeeded`                      |
| Sites access        | owner-only/custom, только владелец                                                  |

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

| Область         | Фактическое состояние                                                 |
| --------------- | --------------------------------------------------------------------- |
| Package manager | pnpm workspace, lock-файл восстановлен                                |
| Frontend        | React 19, Vite, Tailwind, wouter, React Query                         |
| API             | Express 5, TypeScript                                                 |
| БД              | PostgreSQL, Drizzle, большой набор схем и встроенный migration runner |
| Runtime Replit  | Node 24, PostgreSQL 16 по `.replit`                                   |
| Sites           | отдельная безопасная control surface внутри того же репозитория       |

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
- Исторический PostgreSQL 16 integration suite v10 выполнен в GitHub Actions run #8: `test:full`, `test:postgres`, `build:full` — PASS. Для текущего candidate `typecheck`, `test:full`, 29 data-import tests и `build:full` прошли локально, но `test:postgres` корректно остановился до запуска из-за отсутствующего `TEST_DATABASE_URL`. Candidate цикла 3 обязан пройти этот шаг на exact head и экспортировать CI `head_sha/tree_sha` artifact. Audit-store outage/deny PostgreSQL smoke, provider-auth replay и реальные финансовые calculation tests остаются открыты; добавлены только синтетические инварианты. AlfaCRM concurrency unit test пройден.

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

## 2026-09-10 — D100 source исправлен; D101/R15 подготовлен

PR403 объединён: `9862a6e863d4d791c00ddeaba9480154ad5b8c4d`, tree `7a08a2e88e8ea45c2ef1e9631f62ba5c612d6034`. Exact PR head `1912996e925cbf5c26ff7d2e2f789c8bcc6e1657` прошёл Quality34440928812, Proof34440928740, V5234440928818 и R14/R13/R1234440928953. Чужая materialization сохранена; bank tests и historical source checks восстановлены. Это исходники, не новый live.

R15 готовится в PR404 поверх этой базы: pinned R14-to-R15 transformation, bounded verified artifact delivery и exact unused R14 browser retirement. Protected R15 ещё не выполнен. Старый R14 run34391105865 attempt2 terminal failure до cutover; cleanup success. Accepted live остаётся R13, новый D075 не получен, реальные банковские операции и суммы не приняты. PR399 остаётся draft/UNBOUND. Следующий шаг — окончательный review/CI PR404, штатный guarded release и затем реальные bank/DDS receipts.

## 2026-09-10 06:00Z — Первый R15 остановлен до установки; исправление в PR405

R15 run34443217193 attempt1 / deploy102762766189 завершился failure на provenance после successful accepted-R13 history. Checkout, image downloads/import, snapshot, cutover и after-public SKIPPED; обе cleanup SUCCESS. Current main `bd3553187c6adcda3e0be1586b25c9c3b61dc3de` подписан GitHub, но имеет два parents; неизменённый gate требует один. Причина — выбранный Codex обычный merge PR404 вместо необходимого squash. Все основные CI на этом main PASS; они не являются установленным выпуском.

Новый PR405 (`codex/tochka-r15-squash-fix-20260910`) сохраняет guard и фиксирует squash в publication contract. Локально actual-metadata jq regression и 12 contract +23 history tests PASS; exact-head CI/final review ожидаются. Старый R15 source/run нельзя повторять. App/data/backup/School не менялись этим failed запуском. Accepted baseline остаётся R13; PR399 UNBOUND, новые bank/DDS числа не получены.

### D101 — Устранить случайное ложное срабатывание банковского теста

Exact-head V52 run34443910215/job102764455280 остановился 2026-09-10T06:11:10Z в `tochka-autosync.test.mjs`: regex `/synthetic-private|provider-payload|418/` ошибочно нашёл 418 внутри случайного lease UUID. Actual httpStatus был безопасным 500. Ошибка воспроизведена локально фиксированным valid UUID с 418 до исправления assertions. Исправлен только этот тест: response/state сравниваются целиком с точными полями и числовыми HTTP status, проверки private payload сохранены. Все22 scheduler tests и12 R15 contract tests PASS. Runtime, lease/backoff и банковская логика не менялись.

Единственный изменённый файл materialized source — `deploy/v52/src/tests/tochka-autosync.test.mjs`. Его осознанное изменение отражено в canonical manifest: v52 c76256a9f9239560598df62d3ee2da49e9713da1a83c4af2c9910532482b88ce → b20f022c0865e88dd7c1c62e40c7a0d315780abdf3e2e386c308ace70530bec3; v44 прежний. Current-source/historical-runner/R15 pins обновлены по фактическим bytes, frozen R14 pins/guards не меняются. Final head требует новых обязательных CI; провалившийся старый V52 не повторяется ради случайного удачного UUID.

## 10.09.2026 — новый этап статей, кандидат D108

После поручения владельца начата отдельная ветка статей и ручного разнесения от actual main `1bfe6634bf1a0e90ae20c64cbf428d9cd3358549`. Действующий runtime и банковские данные не изменялись этим этапом. Конкретные статьи не утверждены и не назначены. Контракт/ограничения: `docs/acceptance/2026-09-10-finance-articles.md`; production acceptance отсутствует.

## Дневник Атласа — D109, подготовка выпуска 10.09.2026

Отдельная реализация дневника сохранена в PR411. Центральное подключение подготовлено отдельным кандидатом: [приёмка](docs/acceptance/2026-09-10-atlas-central.md). Production для Атласа ещё не объявляется выпущенным; права реальных сотрудников и семей не менялись. Требуются новый защищённый выпуск центрального runtime, изолированный сервис Атласа и natural browser acceptance.
