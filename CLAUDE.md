# ArtHello OS — карта проекта для Claude Code

Внутренняя операционно-финансовая система частной школы ArtHello. Доминирующий принцип — **доказуемость, а не фичи**: каждое число прослеживается до источника, неподтверждённое рендерится как «не подтверждено», никогда не выдумывается. Почти вся документация на русском.

## Структура

- `artifacts/api-server` — Express 5 API (~290 путей). `artifacts/alpha-crm-sync` — React 19 SPA бэк-офиса.
- `lib/db` — Drizzle + PostgreSQL 16: схемы, миграции `drizzle/`, rollbacks, `scripts/migration-twin.mjs`. `lib/api-spec` — `openapi.yaml` (источник для orval-кодгена в `lib/api-zod` и `lib/api-client-react`).
- `scripts` — sandbox-импортёры AlfaCRM/payroll (PGlite, отдельная sandbox-БД вне checkout — D-031).
- `sites-control` — workspace-пакет `@workspace/sites-control`, owner-only статусная поверхность для OpenAI Sites; владеет корневыми `dev`/`build`/`test`.
- `deploy/` — RU-прод контур (Timeweb VPS): Dockerfile/compose/`pull-release.sh` + School-контур v44/v52 (исходник как base64-чанки + патч-скрипты — см. REFACTORING_PLAN.md).
- Ключевые документы: `MASTER_BOOK.md` (процесс и принципы), `DECISIONS.md` + `docs/decisions/` (D-001…D-039, нумерация продолжается), `BACKLOG.md`, `CURRENT_STATE.md`, `RUNBOOK.md`, `SECURITY_CHECKLIST.md`, `DATA_COVERAGE.md`, `DESIGN_CODE.md`, `REFACTORING_PLAN.md` (аудит 2026-09 + план из 7 фаз).

## Команды

```bash
pnpm run typecheck        # tsc --build libs + пакеты
pnpm run test:full        # typecheck + front-office + security + sites
pnpm run test:postgres    # интеграция с реальным PG16, требует TEST_DATABASE_URL
pnpm run build:full       # приложения + sites
pnpm run dev              # ВНИМАНИЕ: это vite для sites-control, не приложения
```

Ловушки: `pnpm test`/`pnpm build` относятся к **sites-control**, не к приложению. `test:full` НЕ включает `test:postgres` и suite `scripts/` (`cd scripts && pnpm test`). Только pnpm (preinstall-хук блокирует npm/yarn).

## Процесс и жёсткие правила

- Три роли: **Создатель** (единственный редактор) → **Ревизор** (read-only, вердикты PASS / CONDITIONAL PASS / FAIL / BLOCKED, максимум 3 цикла) → **Координатор** (go/no-go). Скил `/reviewer` реализует роль Ревизора.
- Каждый статус — с доказательством для одной точной версии. «Файл существует ≠ ворота пройдены».
- **Запрещено**: выдуманные числа/ставки/KPI/статьи (D-004); автослияние семей по слабому сигналу; AI CFO до ворот финансовой правды; инициирование платежей банковскими интеграциями; включение живых интеграций (AlfaCRM/банки) до их гейтов — `deploy/pull-release.sh` отказывает при живых секретах.
- Прод-VPS никогда не собирает JS и не ходит в npm. Non-owner роли fail-closed (D-014). `alpha_raw_records` append-only (D-036).
- Изменение принятого поведения = новое D-решение (следующий свободный номер, сейчас D-040+).

## CI-гейты

- `quality.yml`: gitleaks (fail-closed self-test + полная история), test:full + test:postgres + build:full, immutable provenance artifact.
- `proof-gates.yml`: `scripts/permission-proof.mjs` (против `quality-gates/permission-matrix.json` — известно-неполный enforcement там first-class ожидание: «молчаливое улучшение» тоже роняет гейт), `migration-twin.mjs`, `scripts/visual-acceptance.mjs` (против `quality-gates/visual-canon.json`).
- **Анти-дрейф рачеты**: `sites-control/tests/security-regression.test.mjs` ассертит содержимое исходников api-server, миграций и самого `quality.yml`; `sites-control.test.mjs` ассертит точные строки контента. Падение этих тестов после рутинной правки — ожидаемо by design: обнови рачет синхронно в том же PR, осознанно.
- Правки route-файлов → синхронное обновление `permission-matrix.json`; правки схем → см. скил `/migration-check` (известный дефект: snapshots 0016–0017 отсутствуют при journal до 0017).

## Скилы проекта

`/reviewer` — проверка кандидата как Ревизор; `/audit-release` — provenance-цепочка перед деплоем; `/migration-check` — целостность миграций; `/workflow-hygiene` — ревизия `.github/workflows/`; `/grill-me` — адверсариальная критика идеи до реализации; `/triage` — разбор BACKLOG.md; `/tdd` — red-green-refactor (node --test, PGlite); `/domain-model` — сверка доменной модели.

## Известное состояние (2026-09-02)

Полный аудит и план рефакторинга — в `REFACTORING_PLAN.md`: 9 CRITICAL-рисков (Фаза 0 — срочная), реестр всех уязвимостей с файлами-доказательствами, 7 фаз с зависимостями. Открытые HIGH-блокеры также в `CURRENT_STATE.md` и `BACKLOG.md`. `routes/sync.ts` (4 785 строк) недостижим за 503-гейтом — не «чинить», подлежит удалению (Фаза 1).
