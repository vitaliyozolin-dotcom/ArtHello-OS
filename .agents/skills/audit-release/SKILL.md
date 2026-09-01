---
name: audit-release
description: Read-only аудит provenance релиза ArtHello OS — SHA/tree, CI-runs, checksums payload, release manifest и свежесть validation. Использовать перед dispatch deploy workflow, публикацией RU/School/Sites или по запросу проверить релиз, деплой либо кандидата.
---

# Аудит релиза

Работать только read-only. Не запускать deploy, не менять файлы и внешнее состояние. Если путь доставки не следует из запроса или репозитория, запросить его у пользователя.

1. Определить путь: RU (`deploy-ru.yml`, `deploy/pull-release.sh`), School cutover (парные deploy/validate workflows) либо Sites (`pnpm build:sites`, ручная публикация).
2. Зафиксировать полный candidate SHA, tree SHA и принадлежность `origin/main`. Отсутствие удалённых данных обозначить `BLOCKED`, а не угадывать.
3. Проверить для SHA успешные `quality.yml`, `proof-gates.yml` и provenance artifact. Сопоставить `head_sha`, `tree_sha`, candidate SHA и валидированный tree.
4. Для School локально собрать chunked payload, сверить SHA-256, число частей и workflow-константы. Проверить свежесть `VALIDATION_RUN_ID` и отсутствие нескольких живых вариантов cutover.
5. Для RU проверить boundary-значения (`real_data=not_loaded`, `integrations=disabled`, `first_owner=not_created`, `dns=not_changed`), assets/checksums, `target_commitish` и OCI revision.
6. Для Sites выполнить только локальную сборку/валидацию; не публиковать.

Для каждого пункта привести статус и доказательство: команду с существенным выводом либо `path:line`/run URL. Завершить вердиктом `PASS`, `CONDITIONAL PASS`, `FAIL` или `BLOCKED`. PASS допустим только после всех применимых проверок.
