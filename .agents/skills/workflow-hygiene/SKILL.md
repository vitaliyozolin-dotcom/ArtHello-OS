---
name: workflow-hygiene
description: Read-only аудит `.github/workflows` ArtHello OS — опасные triggers/runners, production destruction, duplicate cutovers, spent one-shots, dead paths, hardcoded ephemeral IDs, toolchain drift и review barriers. Использовать перед добавлением workflow или по запросу проверить GitHub Actions.
---

# Гигиена workflows

По умолчанию ничего не удалять и не отключать. Для каждого workflow собрать triggers, runner, production access, environment, concurrency и hardcoded SHA/run IDs/tags/dates.

1. Критично: `pull_request` или `pull_request_target` вместе с self-hosted; отдельно проверить checkout PR head.
2. Критично: stop/rm/reset/wipe production по push. Требовать `workflow_dispatch`, typed confirmation и protected Environment.
3. Найти несколько живых v1/v2/v3/candidate вариантов одной операции и конфликты concurrency.
4. Найти spent one-shot по замороженным входам, датам и `tmp-*`; рекомендовать архивировать run evidence перед удалением.
5. Проверить существование каждого `paths` target через `rg --files`, не через предположение.
6. Найти дубли hardcoded image tags, run IDs, fingerprints и разъезд Node/pnpm/actions versions.
7. Проверить CODEOWNERS для `.github`/`deploy` и protected Environment для production jobs.
8. Не предлагать удалить постоянные `quality.yml` и `proof-gates.yml`. Учесть, что security anti-drift тест может проверять точное содержимое `quality.yml`.

Выдать таблицу «файл / triggers / runner / риск / удалить, отключить, исправить или оставить / доказательство», затем счётчики и приоритетные действия. Использовать `rg`; команды с удалением или изменением внешнего состояния запрещены без отдельной просьбы.
