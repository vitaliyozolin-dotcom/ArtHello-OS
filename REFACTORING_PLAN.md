# ArtHello OS — Архитектурный аудит и план рефакторинга

Дата аудита: 2026-09-01. Ревизия плана: 2026-09-02 после удаления мёртвых workspace/UI-пакетов. Статус: REVISED DRAFT — до повторного независимого Reviewer PASS.
Метод: полное исследование кодовой базы (артефакты, библиотеки, deploy-контур, CI, документация, тесты). Каждая находка привязана к файлам-доказательствам. Документ не дублирует открытые пункты `BACKLOG.md` — на них даются ссылки.

---

## 1. Инвентаризация

**Монорепо (pnpm), 8 workspace-членов:**

| Пакет                      | Назначение                                                   | Объём                         |
| -------------------------- | ------------------------------------------------------------ | ----------------------------- |
| `artifacts/api-server`     | Express 5 REST API, 290 путей / 44 route-модуля              | ~38 300 строк                 |
| `artifacts/alpha-crm-sync` | React 19 SPA бэк-офиса (финансы, банк, staff, front-office)  | ~41 500 строк                 |
| `lib/db`                   | Drizzle + 26 схем + 18 миграций + rollbacks + migration-twin | ~3 700 строк                  |
| `lib/api-spec`             | `openapi.yaml` (171 путь) + orval codegen                    | 7 516 строк yaml              |
| `lib/api-client-react`     | Сгенерированный React Query клиент (80 хуков) + custom-fetch | ~18 400 строк                 |
| `lib/api-zod`              | Сгенерированные Zod-схемы                                    | ~4 400 строк                  |
| `scripts`                  | Sandbox-импортёры AlfaCRM/payroll на PGlite                  | ~5 700 строк                  |
| `sites-control`            | Owner-only статусная поверхность OpenAI Sites                | статический UI + worker build |

**Вне workspace:** `deploy/` (~22 000 строк TS/TSX/MJS, невидимых для tsc: v44/v52 School-контур на Cloudflare D1, третья реализация auth).

**Пути «commit → production» (3 активных после cleanup 2026-09-01):**

1. **Sites control** — `pnpm build:sites` → воркер → ручная публикация через Sites CLI.
2. **Closed RU release** — `deploy-ru.yml` (dispatch, пин ref) → docker-образы → prerelease → **ручной** `pull-release.sh` root'ом на Timeweb VPS (с boundary-гейтами и rollback).
3. **Replit autoscale** — платформенный, с `postMerge`-хуком.

Исторический School SSO cutover и остальные spent workflow удалены из активной
`.github/workflows`; восстановительная опись с исходными blob SHA находится в
`docs/workflow-archive-2026-09-01.md`.

На обычные изменения кода работают только два гейта: `quality.yml` (gitleaks fail-closed self-test, полный history-scan, test:full + test:postgres + build:full, immutable provenance artifact) и `proof-gates.yml` (permission-proof, migration-twin, visual-acceptance).

---

## 2. Реестр уязвимостей и рисков

### 2.1 CRITICAL — безопасность и целостность продакшена

| ID       | Уязвимость                                                                                                                                                                                                                        | Доказательство                                                                                     | Мера устранения                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1       | **Устранено в активных workflow:** исторические `pull_request`/`pull_request_target` пути к production capability удалены cleanup 2026-09-01; постоянный YAML-aware gate оставлен                                                 | `docs/workflow-archive-2026-09-01.md`; `scripts/workflow-policy.mjs`                               | Не возвращать архивные workflow без нового D-решения и негативного policy evidence                                                                                                         |
| R2       | Self-hosted runner установлен на прод-хосте **как root** (`RUNNER_USER=root`, `RUNNER_ALLOW_RUNASROOT=1`); версия runner не зафиксирована. Перевод пользователя в группу `docker` не устраняет root-эквивалентность Docker socket | `deploy/install-school-self-hosted-runner.sh:9,55-58,75,85`; Docker-операции в `v52-candidate.yml` | Убрать недоверенный execution path с production runner; целево — отдельная VM/ephemeral runner без production Docker socket; пин версии. Смена Unix-пользователя без изоляции недостаточна |
| R3       | **Устранено в активных workflow:** три dispatchable School SSO cutover удалены как spent                                                                                                                                          | `docs/workflow-archive-2026-09-01.md`                                                              | Git-история сохраняется; повторный запуск требует нового проверенного workflow                                                                                                             |
| R4       | **Устранено удалением spent cutover:** активного deploy с hardcoded `VALIDATION_RUN_ID` больше нет                                                                                                                                | `docs/workflow-archive-2026-09-01.md`                                                              | Любой будущий cutover обязан проверять свежий successful validation run через API                                                                                                          |
| R5       | Стирание прод-данных по push текстового файла в main; recovery легитимно заканчивается `FAILED_PRODUCTION_LEFT_STOPPED/PAUSED`                                                                                                    | `production-data-reset.yml:5-8`                                                                    | `workflow_dispatch` + typed confirmation + protected Environment c required reviewers                                                                                                      |
| R7       | Секреты School-контура (`CENTRAL_ACCESS_SECRET`, `IDENTITY_CORE_SECRET`) существуют **только внутри работающего контейнера** (перенос через `docker inspect Config.Env`). Потеря контейнера = невосстановимый отказ SSO           | cutover-payload v3                                                                                 | Environment secrets + зашифрованный офлайн-бэкап; перенос через env-file; drill восстановления в RUNBOOK                                                                                   |
| R8       | Прерывание cutover между `docker rename` и `docker run` (kill runner'а, обрыв ssh 3300s-сессии) оставляет прод без контейнера `school-1-11`; восстановление — только bash EXIT-trap, внешнего watchdog нет                        | cutover-payload v3                                                                                 | Standalone `deploy/rollback-school-1-11.sh` + watchdog/systemd; rename только после успешного старта нового                                                                                |
| R11      | `post-merge.sh`: `pnpm --filter db push` — имя пакета неверно (реальное `@workspace/db`): хук либо молча падает на каждом merge, либо при резолве выполнил бы **неревьюируемый `drizzle-kit push` в живую БД**                    | `scripts/post-merge.sh:4`; `.replit [postMerge]`                                                   | Удалить строку целиком (не «чинить» имя — сама операция и есть опасность)                                                                                                                  |
| SEC-CRED | Раскрытые credentials AlfaCRM/Точка **не ротированы** (открытый HIGH-блокер; D-026: увиденное в чате скомпрометировано)                                                                                                           | `CURRENT_STATE.md`, BACKLOG A.2/A.4                                                                | Уже в BACKLOG — эскалировать в Фазу 0 с подтверждением отзыва у провайдера                                                                                                                 |

### 2.2 HIGH

| ID    | Уязвимость                                                                                                                                                                                       | Доказательство                                                                                                                     | Мера                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| R6    | Исходник v52-приложения — непрозрачный base64-блоб 4.2 МБ + 14 последовательных string-patch-скриптов; работающий в проде код нечитаем из репо, порядок патчей load-bearing и недокументирован   | `deploy/v52/Dockerfile:6-33`; `deploy/v52/overrides/scripts/patch-*.mjs`                                                           | Материализовать дерево в git, патчи применить один раз и закоммитить      |
| R6b   | v44 — тот же блоб-паттерн **без чексуммы** на пересобранном tarball                                                                                                                              | `deploy/v44/Dockerfile:7-9`                                                                                                        | Минимум sha256; целево — как R6                                           |
| R9    | Base64-чанки (~920 байт/шт.) как постоянный механизм релиза: прод-логика нерецензируема в PR-диффе; изменение байта = регенерация всех чанков + 4 hex-констант в 2 файлах                        | `.github/scripts/school-staff-sso-*.sh.gz.b64.part-*`                                                                              | Обычные файлы (~30 КБ каждый), чексумма по файлу                          |
| R10   | SSH host-key pin через TOFU-then-compare; пин зарыт в gzip-блоб и продублирован plain-text во втором workflow (могут разъехаться); третий workflow использует конкурирующую конвенцию с секретом | controller-payload; `verify-school-staff-sso-live-20260831.yml`; `repair-production-ru-lb-backend.yml`                             | Единая конвенция: known_hosts из GitHub secret                            |
| R17   | Бэкапы прод-БД: `while true; sleep 86400` с `set -eu` — первый сбой `pg_dump` навсегда убивает цикл; рестарт контейнера сбрасывает таймер; нет офф-хост копии и алертинга                        | `deploy/backup.sh`                                                                                                                 | cron/systemd-timer + алертинг + офф-хост; проверка RPO/RTO (BACKLOG P1)   |
| MIGR  | Journal миграций 0000–0017, snapshots только до 0015 → следующий `drizzle-kit generate` даст неверный diff; 0009–0010 не проверены на репрезентативной копии                                     | `lib/db/drizzle/meta/`                                                                                                             | Восстановить snapshots 0016–0017; прогон на sandbox-копии (BACKLOG)       |
| MIGR2 | Вторая конкурирующая система миграций: `migrate.ts` (1 135 строк, 237 raw SQL) выполняет **деструктивные DELETE и DROP INDEX при каждом старте сервера**                                         | `artifacts/api-server/src/lib/migrate.ts:29-56`; `src/index.ts:24`                                                                 | Заморозить, дельты → drizzle, boot-time только read-only schema assertion |
| FETCH | 43 ручных `fetch("/api/...")` в 14 файлах фронта в обход `custom-fetch` (baseUrl/auth/**CSRF**)                                                                                                  | `pages/coverage.tsx` (19), `staff.tsx` (14), `employees.tsx` (12) и др.                                                            | Закрыть дрейф контракта, перевести на сгенерированный клиент              |
| PHONE | `normalizePhone` реализован 3–4 раза с разными сигнатурами — identity-matching логика; расхождение = риск неверного сопоставления семей/платежей                                                 | `routes/identity.ts:23`; `routes/front-office-smsvizitka.ts:45`; `scripts/src/import-alfacrm-sandbox.ts:139`; `routes/sync.ts:488` | Единая реализация в shared-lib + characterization-тесты                   |

### 2.3 MEDIUM

| ID        | Риск                                                                                                                                                                                              | Доказательство                                                               | Мера                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R12       | Инлайнер sites-control: две exact-string `String.replace` — любое переформатирование HTML делает replace молчаливым no-op (воркер отдаст страницу без стилей/JS); ни один гейт этого не ловит     | `sites-control/scripts/build.mjs:18-20`                                      | Ассертить отсутствие исходных подстрок / наличие `<style>` в бандле                        |
| R13       | **Устранено:** 41 одноразовый workflow удалён из активной директории с описью blob SHA                                                                                                            | `docs/workflow-archive-2026-09-01.md`                                        | Не восстанавливать frozen candidates как постоянный CD                                     |
| R14       | После cleanup: 6 активных workflow; `tmp-*` и мёртвые path-фильтры удалены; **CODEOWNERS всё ещё отсутствует**                                                                                    | `.github/workflows/`; `docs/workflow-archive-2026-09-01.md`                  | Добавить CODEOWNERS минимум для `.github/` и `deploy/`                                     |
| R15       | `visual-acceptance.mjs` всё ещё зависит от незадекларированного Chrome; workflow с магическим счётчиком 595 удалён                                                                                | `scripts/visual-acceptance.mjs:18-25`; `docs/workflow-archive-2026-09-01.md` | Пин браузера для постоянного proof gate                                                    |
| R16       | **Устранено для активного CI:** `quality.yml`, `proof-gates.yml`, `deploy-ru.yml`, `deploy/Dockerfile` и корневой `packageManager` закреплены на pnpm 11.7.0; npm-based v52 candidate архивирован | CI + deploy; `docs/workflow-archive-2026-09-01.md`                           | Сохранять единый pin; floating dependency ranges разбирать отдельно как dependency hygiene |
| ZOD       | 20 файлов импортируют `zod/v4` при catalog-пине `zod: 3.25.76`; `api-zod` используется в 2 из 83 файлов сервера — 42 route-модуля валидируют вручную                                              | api-server                                                                   | Унификация; валидация через сгенерированные схемы                                          |
| ENV-THROW | Module-level `throw` при импорте `lib/db` (`DATABASE_URL`) и `alphaCrmClient` (`ALFACRM_DOMAIN`) — импорт с побочным эффектом, слой нетестируем в изоляции                                        | `lib/db/src/index.ts:5-9`; `.../alphaCrmClient.ts:4-7`                       | Ленивая инициализация / фабрики                                                            |

### 2.4 LOW / гигиена

| ID   | Риск                                                                                                                                                                                                                                              | Мера                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| R18  | Мёртвые payload'ы: 4 patch-скрипта + 8 b64-чанков ни на что не ссылаются; `mobile-qa.html` не собирается; ~5.6 МБ бинарщины в `deploy/`                                                                                                           | Удалить                                                       |
| R19  | `preview.allowedHosts: true` в vite-конфиге sites-control (DNS-rebinding класс, dev-only); `build.outDir` — мёртвый конфиг                                                                                                                        | Ограничить/удалить                                            |
| R20  | Анти-дрейф тесты ассертят содержимое CI-файлов и прозу («3 689 raw-строк») — работают как рачеты, но рутинные правки копирайта ломают suite                                                                                                       | Осознанно сохранить; задокументировать в CLAUDE.md            |
| R21  | Governance `.company-os` (`production_requires_ai_contract: true`) ничем не энфорсится; pytest-тесты grant-subsidy-hunter не запускает ни один CI-job                                                                                             | CI-джоб валидации контрактов или явная пометка «документация» |
| DEAD | `routes/sync.ts` 4 785 строк недостижим (503-гейт `legacy-sync-gate.ts`), но смонтирован, включая one-off repair-эндпоинты; 40/55 UI-компонентов не используются (в т.ч. `sidebar.tsx` 727 строк ×2); схемы `messages`/`conversations` вне barrel | Удаление (частично уже в BACKLOG: `/sync`)                    |

### 2.5 Архитектурные находки (не уязвимости, но входят в план)

- **Файлы-гиганты — 32 файла >500 строк**: `coverage.tsx` 5 358, `banking.tsx` 4 358, `audit.ts` 4 753 (17 эндпоинтов, все под `/coverage/*`; под `/audit` не монтирует ничего), `employees.tsx` 2 672, `tochka.ts` 1 728, `migrate.ts` 1 135 и далее.
- **Дублирование**: 50/55 UI-компонентов побайтово одинаковы в двух пакетах (нет `lib/ui`); 2 клиента AlfaCRM; `sha256` ×5; форматирование валюты inline в 18 файлах; CSRF-логика в 3 местах; `formatDate` ×3; `toNum`/`toMonth`/`normalizeIds`/`logSync` ×2.
- **Фрагментация роутов**: `/staff/*` в 3 файлах, `/coverage/*` в 2, finance в 6; произвольные суффиксы (`-module`, `-complete`, `-hr`, `-core`, `-qa`); смесь default/named exports в `routes/index.ts`.
- **Слои**: `routes/auth.ts` экспортирует глобальные middleware (место — `src/lib/security/`, где уже 11 файлов); 4 стиля доступа к БД (drizzle builder — 24 файла, `db.execute(sql)` — 11, raw `pool.query` — 12, PGlite в scripts); 3 файла смешивают ORM и raw в одном модуле.
- **SPA-роутинг**: wouter установлен, но `App.tsx` регистрирует 2 маршрута; вся навигация — `useState`-switch по 28-членному union в `AppShell.tsx` → нет deep links, back/forward, shareable URL.
- **Workspace**: `sites-control` включён как `@workspace/sites-control`, пустой глоб `lib/integrations/*` удалён; `deploy/` 22k строк вне tsc; все deps приложений в `devDependencies`; `.js`-расширения в импортах непоследовательны (60 vs 51 — работает только из-за esbuild); orval-codegen пишет через границы пакетов + shell-`printf` в чужой `src/index.ts`.
- **Тесты**: ~4 100 строк тестов на ~86 000 строк исходников; многие — regex-по-исходникам, а не поведение; `test:full` **не включает** `test:postgres` и suite `scripts` (29 data-import тестов, цитируемых как evidence в CURRENT_STATE, не входят ни в один агрегат); 27/28 тестов `deploy/v52/overrides/tests` — сироты; lint-job нет (prettier установлен, ничем не запускается).
- **Документация**: `CURRENT_STATE.md` заканчивается 2026-07-25 при истории репо до 2026-08-31; `replit.md` описывает уже удалённое поведение.

### 2.6 Что сделано хорошо (сохранить при любом рефакторинге)

- gitleaks **fail-closed self-test** перед реальным сканом (`quality.yml:46-67`) + скан полной истории.
- Пин CI на `pull_request.head.sha`, non-shallow, `git fsck`, immutable provenance artifact (head/tree/archive/dist digests).
- Boundary-гейты `pull-release.sh`: отказ деплоить при живых интеграционных секретах — политика как исполняемый код.
- Cutover: backup-first → preflight на клоне бэкапа (со вставкой синтетического scrypt-пользователя и проверкой 410/401/нуля сессий) → drift-recheck → swap → независимая публичная пост-проверка.
- `permission-proof.mjs`: known-incomplete enforcement как first-class ожидание — «молчаливое улучшение» тоже роняет гейт.
- Валидатор v3 кодирует баг v2 как постоянный негативный ассерт.

---

## 3. План рефакторинга — 7 фаз

Конвенции: **[DEL]** = чистое удаление (git-обратимо), **[BEH]** = меняет поведение, требует собственного proof-артефакта. Долгоживущее `[BEH]`-решение принимается до или в том же кандидате, который меняет поведение. Фаза может иметь umbrella D-решение, но независимые политики (runner isolation, destructive workflow, migration authority, credential recovery) получают отдельные D-решения, чтобы их можно было проверять и заменять независимо. Чистое удаление без изменения политики может закрываться evidence без отдельного D. Фазы 0–2 строго последовательны; 3/4 чередуются; Фаза 5 требует prune из Фазы 1 и fetch-миграцию 3.4; треки Фазы 6 имеют собственные зависимости ниже.

### Фаза 0 — остановить кровотечение (effort M; единственная календарно срочная)

Цель: ни один PR, push файла в main или Replit-merge не приводит к исполнению недоверенного кода / уничтожению данных на прод-хосте; runner с Docker socket считается privileged независимо от Unix-пользователя; ни один секрет не является невосстановимым.

Фаза выполняется отдельными кандидатами, каждый со своим rollback и proof:

**0A — немедленная repo-only блокировка trigger'ов и неявного DDL**

1. **[BEH] R1**: построить полный структурный инвентарь `trigger → job if → checkout ref → runner → permissions/secrets/environment → Docker/SSH/production capability` для всех 47 workflow, включая `pull_request_target`, reusable workflows и GitHub-hosted jobs с SSH-доступом. До завершения инвентаря снять `pull_request` с `v52-candidate.yml` и `school-diary-safety-baseline.yml`; кандидаты выполнять только на GitHub-hosted или изолированной ephemeral VM без production capability. Мгновенная внешняя митигация: require approval + ограниченный runner group.
2. **[BEH] R5**: удалить `push` из `production-data-reset.yml`; оставить `workflow_dispatch` с обязательным typed confirmation, проверяемым до checkout/Docker, и protected Environment с required reviewer.
3. **[DEL] R11**: удалить строку `pnpm --filter db push` из `scripts/post-merge.sh` целиком; не исправлять имя пакета.
4. **[BEH] R1-policy**: добавить постоянный YAML-aware gate, запрещающий недоверенный PR head на runner/job с production capability. `grep` оставить только дополнительным smoke-check, не acceptance.

**0B — единственный доказуемый School cutover**

5. **[DEL] R3**: удалить cutover v1/v2, оставить только один v3-механизм.
6. **[BEH] R4**: убрать push-trigger и hardcoded candidate/validation constants. `workflow_dispatch` принимает candidate SHA и validation run ID; deploy через GitHub API проверяет точный validation workflow, `conclusion == success`, `head_sha`, ref/event, candidate tree, provenance artifact и payload checksums. Исторический run или mismatch любого поля = fail closed.

**0C — изоляция production runner**

7. **[BEH] R2**: удалить возможность исполнения недоверенного candidate-кода на production runner. Целевое состояние — отдельная VM/ephemeral runner без production Docker socket; production runner выполняет только пинованные controls/artifacts. Версию runner зафиксировать, installer и `RUNBOOK.md` обновить. Непривилегированный пользователь с доступом к Docker socket не считается устранением R2.

**0D — восстановимость и credentials**

8. **[BEH] R7**: секреты School → GitHub Environment secrets + зашифрованный офлайн-бэкап; entrypoint/compose читают из env-file; процедура восстановления в `RUNBOOK.md`.
9. **[BEH] R8**: standalone `deploy/rollback-school-1-11.sh` + сохранение предыдущего образа до замены; восстановление не зависит от EXIT-trap одной ssh-сессии.
10. **[BEH] SEC-CRED**: ротация AlfaCRM/Точка с подтверждением отзыва старых у провайдера; секреты и их значения не попадают в Git/evidence.

НЕ трогать: исходники приложений; payload'ы `deploy/v44|v52`; логику `quality.yml`/`proof-gates.yml`; гейты живых интеграций (остаются выключенными).

Acceptance evidence: machine-readable workflow inventory без необъяснённых production-capability путей; зелёный YAML-aware policy-gate с негативными fixtures для `pull_request`, `pull_request_target`, PR-head checkout, reusable workflow и SSH-to-production; reset без confirmation останавливается до checkout/Docker; доказательство отсутствия недоверенного execution path к production Docker (одного `ps user != root` недостаточно); свежий validation run на exact candidate SHA/tree; scratch rollback и secret-recovery drills; подтверждение ротации без значений секретов в `SECURITY_CHECKLIST.md`; отдельные D-решения и run-URL по кандидатам 0A–0D; финальный Reviewer/Coordinator gate всей Фазы 0.

### Фаза 1 — закрыта 2026-09-08: мёртвый код, гигиена репо и workspace

1. **[выполнено 2026-09-08] [DEL]** D-067 утвердило dispositions 30 endpoints. Универсальный `routes/sync.ts`, mount, legacy OpenAPI/generated operations и операторские call-sites удалены; sandbox capabilities сохранены, а неподтверждённые scoped jobs остались заблокированными.
2. **[DEL, выполнено 2026-09-01]** Удалены `lib/integrations-openai-ai-react`, `-server` и сирота-форк `lib/integrations/openai_ai_integrations`; поиск потребителей перед удалением был пуст.
3. **[DEL, выполнено 2026-09-01]** Удалён `artifacts/mockup-sandbox`; ссылки workspace и lockfile очищены.
4. **[DEL, выполнено 2026-09-02]** Удалены 40 недостижимых UI-компонентов из `alpha-crm-sync`; 15 компонентов с runtime-потребителями сохранены. Вторая копия исчезла вместе с `mockup-sandbox` на шаге 3.
5. **[BEH, выполнено 2026-09-02]** `sites-control` включён как `@workspace/sites-control`; корневые scripts делегируют пакетные команды, а package-manager-neutral hosting `build` сохранён. Анти-дрейф тесты не менялись.
6. **[выполнено 2026-09-08] [BEH]** D-066 фиксирует `zod/v4`; D-068 разделяет import policy: явные `.js` в Node-executed/db контурах, extensionless в bundler/generated. Оба правила защищены постоянными тестами.
7. **[выполнено 2026-09-08] [BEH]** Добавлены `CODEOWNERS`, blocking Prettier сопровождаемых файлов и legacy application formatting ratchet: baseline может сокращаться, новые нарушения блокируются.
8. **[выполнено 2026-09-08]** `CURRENT_STATE.md` обновлён честным checkpoint без объявления Фазы 1 закрытой.

НЕ трогать: схемы `messages`/`conversations` (их удаление порождает drizzle-diff — ждёт ремонта snapshots в фазе 2); `deploy/`; `migrate.ts`; бизнес-логику route-файлов. Для `/sync` до design gate разрешены только inventory и тесты; удаление mount/файла — отдельный кандидат после замены зависимостей.

Гейты: `proof-gates.yml` сработает (routes/**); `permission-matrix.json` обновить в том же PR, что удаление sync.ts; `visual-acceptance` обязан остаться байт-стабильным (удаление неиспользуемого не меняет рендер — скриншот-diff и есть доказательство).

Evidence: отчёт дельты строк (`git log --diff-filter=D`); `pnpm -r typecheck` теперь покрывает sites-control; неизменный вывод visual-acceptance; permission-proof зелёный с обновлённой матрицей; D-номер.

### Фаза 2 — слой данных и унификация миграций (L; наивысший риск корректности, блокирует все schema-работы)

1. **[выполнено 2026-09-08] [BEH]** 2.1 `0016_snapshot.json`/`0017_snapshot.json` восстановлены из точных исторических schema trees; `drizzle-kit generate` на неизменной текущей схеме дал пустой diff.
2. **[выполнено 2026-09-08 для disposable PostgreSQL 16; restored-sandbox gate BACKLOG остаётся] [BEH]** 2.2 `migration-twin.mjs` проверяет 0009–0010 на owner/accountant/viewer sessions, login attempts и audit evidence, включая rollback/reapply и необратимый отзыв non-owner sessions.
3. **[выполнено 2026-09-09] [BEH]** 2.3 D-080 вывело из эксплуатации `migrate.ts`: измеренная legacy schema-дельта перенесена в `0018_retire_orphan_chat`, runtime применяет только manifest-verified checked-in SQL, а API boot выполняет read-only assertion полного ledger до security gate и listener.
4. **[выполнено 2026-09-09] [DEL]** 2.4 Сиротские схемы `messages`/`conversations` удалены из исходников; `0018` fail closed при непустых legacy-таблицах, удаляет только пустые и имеет structural rollback/twin-proof. Живые `front_office_*` сохранены.
5. **[выполнено 2026-09-08] [BEH]** 2.5 В `lib/db` module-level env-throw заменён на `createDb(env)` и ленивые совместимые exports; `alphaCrmClient` читает tenant-конфигурацию лениво через `createAlphaCrmConfig(env)` и fail closed до сетевого запроса.
6. **[выполнено 2026-09-09] [BEH]** 2.6 D-077 закрепляет политику доступа к БД: drizzle builder по умолчанию; `db.execute(sql)` допустим для отчётности; новые `pool.query` запрещены сокращаемым baseline-ratchet; PGlite разрешён только в `scripts/`. Policy включён в lint и агрегатный `test:refactoring`.

НЕ трогать: бизнес-логику роутов, openapi.yaml, фронтенд, `deploy/`.

Evidence: лог пустого diff `drizzle-kit generate` только в CI/scratch; нулевая дельта schema-dump'ов (путь migrate.ts vs путь checked-in SQL) до удаления; manifest с SHA-256; негативный тест, что deploy отказывает при altered/unmanifested SQL и не содержит `push|generate`; boot-лог сервера assertion-only без DDL; D-решение «checked-in Drizzle SQL — единственный авторитет миграций».

### Фаза 3 — унификация контракта и общих корректностно-критичных утилит (L)

1. **[выполнено 2026-09-09] [BEH]** D-082 создало `lib/shared` для канонических `normalizePhone`, SHA-256, CSRF-cookie и RUB-format helpers; characterization-тесты фиксируют выбранную семантику, а identity merge остаётся запрещённым.
2. **[выполнено 2026-09-09] [BEH]** `openapi.yaml` объявлен источником публичного типизированного контракта. Актуальный runtime/OpenAPI разрыв измеряется исполняемым inventory; каждый существующий server-only method/path имеет disposition `document-in-openapi`, новый необъяснённый путь запрещён.
3. **[выполнено 2026-09-09] [BEH]** `scripts/contract-drift.mjs` импортирует Express-приложение, сравнивает route table с OpenAPI и inventory и включён в `proof-gates.yml` рядом с permission proof.
4. **[выполнено 2026-09-09] [BEH]** Исполняемые frontend API-вызовы переведены с глобального `fetch` на `lib/api-client-react`: generated operations остаются основным путём, `apiFetch` — совместимый transport для инвентаризированных server-only операций. Ratchet запрещает возврат прямого API `fetch`.
5. **[выполнено 2026-09-09]** api-zod применяется только в стабильных route-модулях; гиганты Фазы 4 намеренно не получили промежуточную перепись.

НЕ трогать: внутреннюю структуру god-файлов, топологию mount'ов, UI-компоненты, `deploy/`.

Evidence: contract-drift отчёт с 0 необъяснённых путей; `grep -rn 'fetch("/api' artifacts/alpha-crm-sync/src` = 0; characterization-suite normalizePhone с provenance каждого legacy-варианта; D-номера.

### Фаза 4 — закрыта 2026-09-09: декомпозиция сервера, топология роутов и слои

По прямому решению владельца фаза выполнена одним кандидатом вместо серии PR; route-table snapshot до/после идентичен.

1. **[выполнено]** `routes/audit.ts` удалён; 17 `/coverage/*` обработчиков разнесены по тематическим модулям с именованным агрегатором.
2. **[выполнено]** Большие route implementations изолированы по feature-каталогам за тонким стабильным public API; в `routes/**/*.ts` нет файлов свыше 500 строк.
3. **[выполнено]** `coverage.tsx`, `banking.tsx`, `employees.tsx` перенесены в feature-каталоги; compatibility wrappers сохраняют импорты и lazy-loading contract.
4. **[выполнено]** Приложение получает глобальные auth middleware через `src/lib/security/auth-middleware.ts`.
5. **[выполнено]** Route public API переведён на named exports и защищён исполняемым architecture ratchet.
6. **[выполнено]** Существующие api-zod границы сохранены; промежуточного изменения validation semantics не выполнялось.

НЕ трогать: URL, статус-коды, формы ответов (энфорсится contract-drift гейтом); схему БД; `deploy/`.

Evidence: пустой route-table diff в каждом PR; permission-proof зелёный с неизменной семантикой матрицы; `wc -l` по `routes/` без файлов >500; неизменный visual-acceptance для фронтовых разборов; D-номер на каждую принятую структурную конвенцию.

### Фаза 5 — закрыта 2026-09-09: frontend-платформа и настоящий роутинг

1. **[снято после Фазы 1]** Общий `lib/ui` не создаётся: вторая копия компонентов удалена вместе с `mockup-sandbox`, поэтому межпакетной дедупликации больше нет.
2. **[выполнено] [BEH]** `wouter` заменил `useState`-switch в `AppShell.tsx`: section выводится из URL, внутренние переходы используют history, неизвестный путь заменяется на `/`.
3. **[выполнено]** `visual-canon.json` и `visual-acceptance.mjs` проверяют per-route URL; каждый screenshot содержит route/URL provenance, а mismatch блокирует gate.

НЕ трогать: серверный код; api-client слой (сделан в фазе 3); UI sites-control (отдельный продукт).

Evidence: доказательство deep-link (прямая загрузка `/banking`); back-button в записанном прогоне visual-acceptance; отчёт хэш-дедупликации компонентов между пакетами = пусто; D-номер.

### Фаза 6 — в работе с 2026-09-09: консолидация CI, нормализация School-исходника, тестовая стратегия (L; набор независимых треков)

1. **[частично] [DEL]** Два cleanup-блока архивировали и удалили 31 завершённый workflow: D060–D069, recovery R2–R12, ранние School diagnostics/cutover и legacy RU D059; активный набор сокращён с 47 до 16, а `workflow_run` consumers — с 17 до 5. Blob provenance сохранён в `docs/workflow-archive-2026-09-09.md`; R13 и текущие checks оставлены до сверки фактических Actions runs и run URL.
2. Постоянный набор: `quality.yml`, `proof-gates.yml`, параметризованный `deploy-ru.yml`, один school-deploy + его validation (в форме после фазы 0); всё деструктивное — за protected Environments.
3. **[BEH]** Де-тарболизация School (R6/R6b/R9; не переписывание — нормализация version control): (a) в scratch-checkout декодировать чанки v52, применить 14 патчей по порядку → истинное текущее дерево; (b) закоммитить как обычные файлы (например `deploy/v52/src/`), sha256 tarball'а и post-patch дерева — в D-номер; **перед коммитом прогнать gitleaks локально по извлечённому дереву** (tarball может содержать секреты, которые history-scan потом зафиксирует навсегда); (c) пересборка из закоммиченного дерева и hash-эквивалентность артефакта против tarball+patches; (d) **[DEL]** удалить чанки и патч-скрипты; повторить для v44.
4. `deploy/` под tsc (собственный tsconfig-проект); усыновить 27 сиротских тестов `deploy/v52/overrides/tests` в CI-job.
5. Единая ssh-конвенция: known_hosts из GitHub secret (R10). Бэкапы: cron/systemd-timer + офф-хост + алертинг (R17).
6. **[частично]** Тестовая стратегия: `test:full` включает `test:postgres` и актуальный importer/sandbox suite workspace `scripts`, а `quality.yml` больше не дублирует PostgreSQL gate отдельным запуском. Полный legacy glob `scripts/test/*.test.mjs` ещё содержит spent release-contract tests и требует отдельного усыновления/архивирования; также остаются замена source-regex поведенческими тестами и ratcheting coverage floor (стартует с текущего измеренного %, не убывает — ratchet-файл и есть evidence).

НЕ трогать: runtime-поведение School (v3-cutover остаётся механизмом доставки); прод-хосты — только через выжившие параметризованные workflow.

Evidence: счётчик workflow до/после + архивный индекс; отчёт hash-эквивалентности сборки School (tarball vs source); CI-прогон с typecheck `deploy/` и исполнением 27 тестов; закоммиченный ratchet-файл; D-номер, закрывающий находку «теневая кодовая база».

Зависимости внутри Фазы 6:

- 6.1–6.2 workflow cleanup стартуют после полного закрытия Фазы 0;
- 6.3 де-тарболизация стартует после Фазы 0 и отдельного secret-scan gate, независимо от Фаз 2–5;
- 6.4 включение `deploy/` в typecheck требует завершённой материализации затрагиваемого School-дерева из 6.3; остальные deploy-файлы можно подключать раньше отдельным кандидатом;
- 6.5 SSH/backup hardening стартует после Фазы 0 и не зависит от продуктовых фаз;
- 6.6 тестовая стратегия может начинаться после Фазы 0, но изменение root scripts/workspace координируется с Фазой 1, чтобы не создавать конфликтующие кандидаты.

### Зависимости

```
P0 (ops) ──► P1 (мёртвый код) ──► P2 (данные) ──► P3 (контракт) ──► P4 (декомпозиция)
   │              │
   │              └──► P5 (фронтенд) [prune UI из P1 + fetch-миграция P3.4 до роутинга]
   └──► P6.1/2/3/5/6 (CI/School tracks; точные зависимости перечислены выше)
                     P6.4 после материализации 6.3 для School-дерева
```

Жёсткие связки: удаление `/sync` ← endpoint/call-site inventory + scoped replacement design по D-029; удаление сиротских схем ← ремонт snapshots (2.1); вывод `migrate.ts` ← доказательство 0009–0010 (2.2) + immutable checked-in SQL deploy-path; разбор god-файлов ← contract-drift гейт (3.3); дедуп UI ← prune (1.4); переделка visual-гейта (5.3) — не раньше fetch-миграции (3.4), иначе падения неоднозначны.

---

## 4. Проектные скилы Claude Code и Codex

На ревизии 2026-09-01 в Git добавлены два согласованных набора: 8 Claude-скилов в `.claude/skills/<name>/SKILL.md` и 8 Codex-скилов в `.agents/skills/<name>/SKILL.md` с `agents/openai.yaml`. Корневой `AGENTS.md` закоммичен; локальный `CLAUDE.md` существует, но до отдельного коммита не считается частью проверяемого tree. Оба набора реализуют одинаковые проектные инварианты с адаптацией под механизм обнаружения соответствующего агента.

**Проектно-специфичные** (отвечают на конкретные находки аудита):

| Скил               | Что делает                                                                                                                                                                                         | Закрывает         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `audit-release`    | Проверка provenance-цепочки перед деплоем: совпадение SHA/tree, чексуммы чанков/скриптов, boundary-строки манифеста, свежесть validation run                                                       | R4, R13           |
| `migration-check`  | Паритет journal/snapshots drizzle, наличие rollback-companion на каждую миграцию, прогон `migration-twin.mjs`, отсутствие конфликта с `migrate.ts`                                                 | MIGR, MIGR2       |
| `reviewer`         | Роль Ревизора из MASTER_BOOK: read-only проверка кандидата с вердиктом PASS / CONDITIONAL PASS / FAIL / BLOCKED и цитируемыми доказательствами на одну точную версию                               | evidence-культура |
| `workflow-hygiene` | Инвентаризация `.github/workflows/`: одноразовые/просроченные workflow, опасные триггеры (pull_request × self-hosted, push-триггеры деструктивных действий), отчёт «удалить/задизейблить/оставить» | R1, R3, R13, R14  |

**Адаптации с aihero.dev/skills** (настроенные под конвенции проекта):

| Скил           | Оригинал      | Проектная адаптация                                                                                                                                                                    |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grill-me`     | /grill-me     | Адверсариальная критика предложенного изменения до выполнения — в терминах D-решений, security-инвариантов и запретов MASTER_BOOK (никаких выдуманных чисел, fail-closed по умолчанию) |
| `triage`       | /triage       | Разбор `BACKLOG.md`: сверка статусов `[~]`/`[ ]` с реальностью репо, предложение следующего шага с доказательствами                                                                    |
| `tdd`          | /tdd          | Red-green-refactor под конвенции проекта: `node --test`, PGlite для БД-логики; явный запрет regex-по-исходникам как замены поведенческих тестов                                        |
| `domain-model` | /domain-model | Фиксация доменной модели (семьи/ученики/группы/платежи/юрлица) при изменении схем; сверка с `DATA_COVERAGE.md` и правилом «никакого автослияния семей» (D-принцип)                     |

`AGENTS.md` уже фиксирует структуру монорепо, команды, инварианты и правила доказательств для Codex. Перед добавлением `CLAUDE.md` в Git его необходимо сверить с этой картой и текущей ревизией плана, чтобы две agent-инструкции не расходились.

---

## 5. Порядок принятия

1. Добавить этот документ в Git отдельным docs-only кандидатом и получить повторный независимый Reviewer PASS на точный commit/tree; несогласия — правками разделов, спорные меры — через D-решения.
2. Фаза 0 — единственная календарно срочная; выполнять кандидатами 0A–0D с независимыми rollback/proof и финальным Reviewer/Coordinator gate.
3. Остальные фазы — в каденции проекта «малые шаги с доказательствами». Umbrella D фиксирует цель фазы; отдельные долгоживущие `[BEH]`-политики получают собственные D-решения до или вместе с изменением.
