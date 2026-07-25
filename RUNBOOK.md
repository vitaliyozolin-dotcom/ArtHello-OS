# ArtHello OS — Runbook

## A.3: безопасный live read-only probe

Команда: `pnpm --filter @workspace/api-server run probe:live-read-only`.

Credentials передаются только в process environment:

- `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`, `ALFACRM_API_KEY`;
- `PROBE_TOCHKA_CLIENT_ID`, `PROBE_TOCHKA_CLIENT_SECRET`.

Дополнительные ограничения: `PROBE_REQUEST_TIMEOUT_MS`, `PROBE_MAX_BRANCHES`. Probe не сохраняет ответы, не создаёт consent, не пишет в БД и не вызывает платежные API. В stdout допустимы только HTTP-статусы, количества и boolean-признаки. После выполнения process environment уничтожается вместе с процессом.

## A.2: изолированный PostgreSQL 16

1. Source импортирован в приватную ветку `codex/a3-live-read-only` без секретов; открыт Draft PR #1.
2. `.github/workflows/quality.yml` выполнен на одноразовом PostgreSQL 16.
3. Evidence: run #6 (`30161527465`) — `test:full`, `test:postgres`, `build:full` PASS.
4. При каждом изменении runtime-кода повторять весь quality workflow; подготовленный или частично прошедший run доказательством не считать.
5. Для bank-config migration сначала проверить snapshot, затем задать backup ID и одноразовый confirmation token.
6. Не выполнять первый прогон против production `DATABASE_URL`.

## Безопасные контуры

- Рабочая копия и Sites не содержат production `.env`.
- `.openai/hosting.json` хранит только Sites `project_id`; секретов в нём нет.
- Sites project: `arthello-os-control`, доступ owner-only.
- Не открывать опубликованный Sites URL во внутреннем cloud browser; для внутренней проверки использовать agent preview.
- Owner-only sanitized checkpoint не означает production readiness. Текущий production/live-data gate: **BLOCKED**.

## Локальная установка

Требования: Node 24 и pnpm через Corepack.

```bash
pnpm install --frozen-lockfile
```

Никогда не добавлять secrets в tracked-файлы. Для runtime использовать защищённые environment variables.

## Основные команды

```bash
pnpm run typecheck
pnpm run test:security
pnpm run test:sites
pnpm run test:full
pnpm run build:full
pnpm run dev
```

`pnpm run build:full` проверяет и собирает весь монорепозиторий. Package-manager-neutral `npm run build`/`pnpm run build` собирает только Sites artifact, потому что Sites remote builder вызывает root build через npm. `pnpm run dev` запускает только безопасную Sites control surface. Рабочие сервисы Replit запускаются их package scripts и требуют отдельного environment.

## Environment variables

Имена, обнаруженные в коде:

- `DATABASE_URL`;
- `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`, `ALFACRM_API_KEY`;
- `DASHBOARD_PASSWORD`, `ACCOUNTANT_PASSWORD`, `VIEWER_PASSWORD`;
- `ACCOUNTANT_BRANCH_IDS`, `ACCOUNTANT_LEGAL_ENTITY_IDS`;
- `VIEWER_BRANCH_IDS`, `VIEWER_LEGAL_ENTITY_IDS`;
- `APP_ORIGINS`;
- `SESSION_SECRET`;
- `AUTH_SESSION_TTL_MS`;
- `AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_LOGIN_WINDOW_MS`, `AUTH_LOGIN_LOCK_MS`;
- `TRUST_PROXY_HOPS`;
- `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`;
- `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID_PROMOTION`;
- platform variables Replit и `PORT`.

Пароли должны быть не короче 12 символов. Non-owner account не включается без непустых списков и филиалов, и юридических лиц; даже после этого business routes остаются fail closed до handler-level predicates. `SESSION_SECRET` для Evotor должен содержать не менее 32 символов; fallback-ключа нет. `AUTH_*`, scope lists и `TRUST_PROXY_HOPS` являются runtime-настройками, а не секретами, но раскрывать operational scope в Sites нельзя. Реальные значения секретов запрещено помещать в frontend, документацию, Git или Sites.

`ALFACRM_DOMAIN` обязателен и не имеет tenant fallback. Без него AlfaCRM client останавливается fail closed. Значение задаётся только в защищённом runtime environment.

## Запуск API

Текущий `artifacts/api-server/src/index.ts` вызывает `runMigrations()`, затем `assertSecuritySchemaReady()`, и только потом `listen()`. Ошибка migration, отсутствующий auth/audit column/index или несовпадение timestamp+hash migrations `0009–0010` останавливают listener и polling с кодом 1. Это подтверждено unit/source regression tests и controlled rollback/fail-closed процессом на одноразовом PostgreSQL 16 в CI run #6. Против production `DATABASE_URL` запуск запрещён.

Новый auth runtime требует migration `0009_famous_ma_gnuci.sql`, а session scope и access audit — `0010_outstanding_cargill.sql`. Обе прошли apply/rollback на одноразовом PostgreSQL 16 CI и не применялись к production. Нельзя выпускать auth-код до проверки `backup → restore → apply → session/CSRF/scope/audit smoke → rollback` на восстановленной репрезентативной sandbox-копии.

Безопасный порядок для sandbox:

1. проверить, что `DATABASE_URL` указывает только на sandbox;
2. проверить отсутствие production bank/Alfa secrets;
3. запустить typecheck и build;
4. проверить план миграций на копии;
5. запустить API;
6. искусственно проверить, что ошибка миграции останавливает runtime до listener/polling;
7. применить migrations `0009` и `0010` только к восстановленной sandbox-копии;
8. проверить `/api/healthz`, login, lockout, session expiry/revocation, CSRF, audit allow/deny и отрицательные cross-scope сценарии;
9. удалить по одной обязательной column/index/journal-записи только в одноразовых копиях и подтвердить, что API не начинает listen/polling;
10. проверить website lead: injected mid-write failure → полный rollback → retry → ровно один raw и один lead; тот же key с другим payload → `409`;
11. проверить rollback companions `0009_auth_security.down.sql` и `0010_auth_scope_audit.down.sql` вместе с возвратом к предыдущей версии кода;
12. после rollback `0010` потребовать повторный вход всех accountant/viewer: отозванные migration sessions не восстанавливаются удалением columns;
13. проверить, что non-owner business routes возвращают `403`, пока predicates не зарегистрированы;
14. отдельно проверить callback-контракты, provider authentication, replay и idempotency.

До guarded migration legacy bank config после backup, ротации credentials, закрытия legacy upstream error/debug leaks, scoped handlers, callback authentication и проверки на восстановленной репрезентативной sandbox-копии запрещены production/Replit release, постоянный live AlfaCRM/банк/БД sync, polling и персональные/зарплатные данные.

## Agent preview и Sites checkpoint

1. Запустить `sites-preview start "$PWD"`.
2. Открыть только `http://terminal.local:4173/` в cloud browser.
3. Проверить desktop и mobile viewport.
4. Проверить навигацию, CTA, фильтры и drawer.
5. Исправить найденные проблемы.
6. Запустить checkpoint через Sites lifecycle CLI.
7. Дождаться terminal deployment status.
8. Главный агент напрямую подтверждает точные `project_id`, `version_id`, `deployment_id`.
9. Пользователю передаётся только подтверждённый owner-only URL.

Release evidence хранит immutable связку `commit_sha → Sites version_id → deployment_id`. Оpaque Sites IDs нельзя придумывать или записывать до ответа Sites.

## Backup перед production-миграцией

Production backup пока не выполнялся: доступ отсутствует.

Обязательный порядок:

1. зафиксировать точный commit и migration set;
2. остановить write jobs или включить контролируемое окно;
3. создать provider snapshot;
4. создать зашифрованный logical backup схемы и данных;
5. записать snapshot ID, checksum, время, размер и ответственного;
6. восстановить backup в изолированный sandbox и выполнить smoke test;
7. подготовить forward-fix и rollback SQL;
8. получить Reviewer и Coordinator gate;
9. запросить отдельное разрешение владельца;
10. только затем выполнять production migration.

## Rollback

- Код: возврат на предыдущую проверенную immutable version, без `git reset --hard`.
- Sites: развернуть ранее сохранённую проверенную version через разрешённый Sites workflow.
- БД: использовать заранее проверенный rollback для обратимой миграции или восстановление snapshot для необратимой.
- Migration `0010`: rollback не восстанавливает отозванные non-owner sessions; accountant/viewer проходят повторную аутентификацию.
- Интеграции: отключить scheduler/connector, сохранить raw события и не удалять их.
- После rollback повторить контрольные суммы и smoke tests.

## Инцидент с утечкой секрета

1. немедленно отключить соответствующий connector;
2. отозвать и перевыпустить token/client secret;
3. проверить Git, logs, DB audit и deployment artifacts;
4. удалить секрет из доступных runtime stores безопасным способом;
5. определить затронутые данные и временной интервал;
6. зафиксировать инцидент и remediation;
7. не возобновлять синхронизацию до проверки.
