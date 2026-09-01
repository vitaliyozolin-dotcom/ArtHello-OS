# ArtHello OS — инструкции для Codex

Внутренняя операционно-финансовая система частной школы. Главный принцип: доказуемость важнее фич. Каждое число прослеживать до источника; неподтверждённое обозначать как «не подтверждено», не домысливать.

## Карта проекта

- `artifacts/api-server` — Express API; `artifacts/alpha-crm-sync` — React SPA.
- `lib/db` — Drizzle/PostgreSQL: схемы, миграции, rollbacks и `migration-twin.mjs`.
- `lib/api-spec/openapi.yaml` — источник API-контракта и кодогенерации.
- `scripts` — sandbox-импортёры AlfaCRM/payroll с отдельной sandbox-БД.
- `sites-control` — owner-only поверхность; владеет корневыми `dev`, `build`, `test`.
- `deploy` — RU production и School cutover.
- Перед существенной работой читать релевантные части `MASTER_BOOK.md`, `DECISIONS.md`, `BACKLOG.md`, `CURRENT_STATE.md`, `RUNBOOK.md`, `SECURITY_CHECKLIST.md`, `DATA_COVERAGE.md`, `DESIGN_CODE.md`, `REFACTORING_PLAN.md`.

## Команды и ловушки

- Использовать только pnpm: preinstall блокирует npm/yarn.
- Основные ворота: `pnpm run typecheck`, `pnpm run test:full`, `pnpm run build:full`.
- `pnpm test`, `pnpm build`, `pnpm dev` относятся к `sites-control`, не ко всему приложению.
- `test:full` не включает `test:postgres` и тесты `scripts`; запускать их отдельно для БД и импортёров.

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
