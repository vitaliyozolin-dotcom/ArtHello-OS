---
name: workflow-hygiene
description: Инвентаризация .github/workflows — одноразовые/просроченные workflow, опасные триггеры (pull_request на self-hosted, push-триггеры деструктивных действий), отчёт «удалить / задизейблить / оставить». Использовать периодически и перед любым добавлением нового workflow.
---

# Гигиена workflows

Контекст: в репо исторически накапливались одноразовые ops-workflow (пик — 39 файлов / 14k строк, ~28 одноразовых). Известные классы риска описаны в REFACTORING_PLAN.md (R1, R3–R5, R13, R14). Задача скила — регулярная ревизия и недопущение рецидива.

## Проверки

Для каждого файла `.github/workflows/*.yml` собери: триггеры, runner (`runs-on`), затрагивает ли прод (ssh/docker к хостам, environment `production-ru`), захардкоженные константы (SHA, run id, image tag, даты в имени).

Классифицируй по красным флагам:

1. **КРИТИЧНО — `pull_request` × self-hosted**: `pull_request`/`pull_request_target` с `runs-on` содержащим `self-hosted` = исполнение кода PR на прод-хосте (R1). Также проверь `pull_request_target` с checkout head PR.
   ```bash
   grep -l 'pull_request' .github/workflows/*.yml | xargs grep -l 'self-hosted'
   ```
2. **КРИТИЧНО — деструкция по push**: push-триггер (в т.ч. по paths) запускающий stop/rm/reset/wipe прод-ресурсов (эталон анти-паттерна: `production-data-reset.yml` до перевода на dispatch). Деструктивное — только `workflow_dispatch` + typed confirmation + protected Environment.
3. **Дубликаты cutover/candidate**: несколько живых вариантов одной операции (`*-v2-*`, `*-v3-*`, `*candidate*`) в одной concurrency-группе — старые версии удалить (R3).
4. **Spent one-shot**: все входы — замороженные литералы (SHA/даты/run id в env), дата в имени файла, `tmp-*` — исполнение через месяцы разворачивает устаревшего кандидата (R13). Рекомендация: удалить с записью run-URL в `docs/ops-archive.md`.
5. **Мёртвые path-фильтры**: `paths:` указывает на каталоги, которых нет в корне main (например `app/**`, `tests/**` — они существуют только внутри `deploy/v52/overrides/`).
6. **Захардкоженные ссылки на эфемерное**: image tags, run id, фингерпринты хостов, продублированные в нескольких файлах (риск разъезда — R10).
7. **Разъезд тулчейна**: версии pnpm/node/actions между workflow (известно: 11.7.0 vs 10.4.1 — R16).
8. **Отсутствие ревью-барьера**: есть ли `CODEOWNERS` на `.github/` и `deploy/`; какие прод-workflow не за protected Environment.

## Не трогать (постоянный набор)

`quality.yml` и `proof-gates.yml` — живые гейты; их логику не предлагать к удалению. Помни: `sites-control/tests/security-regression.test.mjs` ассертит содержимое `quality.yml` (пин head.sha, имя provenance-artifact) — любая правка quality.yml требует синхронного обновления этого теста.

## Отчёт

Таблица: файл → триггеры → runner → класс риска → вердикт (**удалить** / **задизейблить** / **исправить триггер** / **оставить**) → обоснование. В конце — счётчики (всего / one-shot / критичных) и первоочередные действия. Сам ничего не удаляй — только отчёт, если пользователь явно не попросил применить.
