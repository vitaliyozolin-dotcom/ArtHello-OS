# ArtHello OS — карта проекта и инструкции для Codex

Внутренняя операционно-финансовая система частной школы. Главный принцип: доказуемость важнее фич. Каждое число прослеживать до источника; неподтверждённое обозначать как «не подтверждено», не домысливать.

## Карта проекта

- `artifacts/api-server` — Express 5 API; `artifacts/alpha-crm-sync` — React 19 SPA бэк-офиса.
- `lib/db` — Drizzle/PostgreSQL 16: схемы, миграции `drizzle/`, rollbacks и `migration-twin.mjs`.
- `lib/api-spec/openapi.yaml` — источник API-контракта и кодогенерации в `lib/api-zod` и `lib/api-client-react`.
- `scripts` — sandbox-импортёры AlfaCRM/payroll на PGlite с отдельной sandbox-БД вне checkout (D-031).
- `sites-control` — workspace-пакет `@workspace/sites-control`, owner-only поверхность OpenAI Sites; владеет корневыми `dev`, `build`, `test`.
- `deploy/` — RU production на Timeweb VPS и School cutover v44/v52; production получает готовые артефакты.
- `.github/workflows/quality.yml` — основной CI; `proof-gates.yml` — permission, migration и visual proof.
- Перед существенной работой читать релевантные части `MASTER_BOOK.md`, `DECISIONS.md`, `BACKLOG.md`, `CURRENT_STATE.md`, `RUNBOOK.md`, `SECURITY_CHECKLIST.md`, `DATA_COVERAGE.md`, `DESIGN_CODE.md`, `REFACTORING_PLAN.md`.

## Команды и ловушки

- Использовать только pnpm: preinstall блокирует npm/yarn.
- Основные ворота: `pnpm run typecheck`, `pnpm run test:full`, `pnpm run build:full`.
- `pnpm test`, `pnpm build`, `pnpm dev` относятся к `sites-control`, не ко всему приложению.
- `test:full` не включает `test:postgres` и тесты `scripts`; запускать их отдельно для БД и импортёров.

## CI и анти-дрейф

- `quality.yml`: gitleaks по дереву и истории, `test:full`, PostgreSQL 16, `build:full`, immutable provenance.
- `proof-gates.yml`: `permission-proof.mjs`, `migration-twin.mjs`, `visual-acceptance.mjs`.
- `sites-control/tests/security-regression.test.mjs` и `sites-control.test.mjs` намеренно проверяют исходники и точные строки; менять рачеты синхронно и осознанно.
- Production VPS не запускает package manager, codegen или JavaScript-сборку.

## Инварианты

- Не выдумывать числа, ставки, KPI и статьи (D-004).
- Не сливать семьи автоматически по слабому сигналу.
- Не вводить AI CFO до ворот финансовой правды и не инициировать банковские платежи.
- Не включать live AlfaCRM/банковские интеграции до их гейтов.
- Production VPS не собирает JavaScript и не обращается к npm.
- Non-owner доступ fail-closed (D-014); `alpha_raw_records` append-only (D-036).
- Изменение принятого поведения требует нового D-решения со следующим подтверждённым свободным номером.
- Изменение routes требует проверки `quality-gates/permission-matrix.json`; изменение схем — применения `$migration-check`.
- Анти-дрейф тесты могут намеренно проверять точные строки. Обновлять рачет только осознанно и синхронно.

## Работа и доказательства

- Сначала проверять локальный контекст и `git status`; сохранять пользовательские изменения.
- Для поиска использовать `rg`/`rg --files`.
- Read-only запрос не даёт права исправлять найденное.
- Не объявлять PASS без выполненной проверки; для непроверенного указывать причину.
- При review фиксировать SHA/tree/diff и давать `path:line` либо вывод команд.
- Проектные навыки находятся в `.agents/skills`; применять навык при совпадении запроса с его `description` или явном `$skill-name`.
- Основные навыки: `$reviewer`, `$audit-release`, `$migration-check`, `$workflow-hygiene`, `$grill-me`, `$triage`, `$tdd`, `$domain-model`.
