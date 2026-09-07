# ArtHello OS — готовность к миграции в GitVerse

Проверено 7 сентября 2026. Статус: первичная копия кода обнаружена на предоставленном владельцем GitVerse; полная миграция и выпуск не завершены. Исходный GitHub сохранён.

## Проверка предоставленного GitVerse 7 сентября 2026

Владелец предоставил https://gitverse.ru/ozolin/ArtHelloOS.

- Страница открылась без авторизации с явной меткой **«Публичный»** и доступным деревом кода. Исходный GitHub закрытый. Необходимо вернуть приватность; мы не разрешали публичную публикацию исходников.
- Видны 333 ветки, 8 тегов, main **9e4c49161e643997fe821a91b84c60c6e38ede33**, размер 829.43 MiB. Число веток/тегов и SHA main совпадают с исходным GitHub. Это первичная сверка; равенство каждого ref, LFS и полнота истории ещё не доказаны.
- На целевой странице PR: 0; releases: 0. На GitHub остаются 33 открытых PR и 8 releases с 39 asset-файлами. Наличие веток не переносит обсуждения и состояние PR.
- REST API без токена вернул 401; этот ответ не доказывает приватность — код был доступен в публичном UI.
- Переход по штатной ссылке входа GitVerse завершился «Access to resource was blocked». Одно обновление подтвердило блокировку. Повторные пути обхода не использовались; блокировка отмечена средствами браузера. Формы входа и защищённого запроса авторизации не было.
- В текущем Work Mode авторизованные GitVerse tools не подключены. Наличие сетевого доступа к MCP не даёт прав на запись. Токены/пароли в чат не запрашивались.
- Владелец может закрыть публичность в своём GitVerse: страница репозитория → настройки → «Сделать приватным» → подтверждение. [Официальная инструкция](https://gitverse.ru/docs/collaborative/repositories/guides/team-repository/repository-visibility). Это не авторизует рабочий браузер автоматически.
- План адаптации CI сохранён рядом: [gitverse-ci-review/README.md](gitverse-ci-review/README.md). Шесть исходных Git blob SHA сверены с immutable main. Обнаружены отсутствие Docker socket на cloud runner, неподдерживаемый workflow_run и отсутствие .gitverse/workflows в нынешнем policy scanner.
- В справке CI и тарифах расходятся лимиты времени/хранения; реальные квоты аккаунта не проверены. Не обещать запуск текущего Verify простым копированием YAML.
- В GitVerse не выполнены push, изменение настроек, CI, merge и deploy. Новый production release не опубликован.

## Фактический исходный объём

- main: 9e4c49161e643997fe821a91b84c60c6e38ede33.
- 333 ветки (GitHub branches: страницы 100+100+100+33, следующая пустая).
- 8 тегов через Git refs.
- 33 открытых PR; вместе с открытыми issues GitHub показывает 71, то есть 38 issues.
- 8 GitHub releases, 39 asset-файлов, суммарно 3 346 675 803 байта, максимальный asset 533 483 230 байт.
- GitHub repository size: 848 859 КБ; это показатель GitHub, не обещанный размер будущего clone.
- PR348–352 и PR340 сохранены, SHA совпадают с предыдущим аудитом. Перенос одного main не переносит незамерженные изменения.

## Доступ для Codex

Официальный GitVerse поддерживает Git HTTPS/SSH, REST API и удалённый MCP https://mcp.gitverse.ru. MCP документирует 42 инструмента для кода, веток, PR, релизов, ручных workflow и логов. Требуются API token и клиент с remote HTTP/custom headers. Текущее подключение GitHub автоматически не даёт доступа к GitVerse. Авторизованные чтение/запись и выполнение workflow именно из текущего Work Mode ещё не проверены.

В опубликованном MCP-каталоге отдельного merge PR нет; Git merge/push не должен использоваться для обхода защищённого PR-процесса. До обещания полной автономности проверить весь нужный цикл в отдельном приватном тестовом репозитории.

## Что можно сохранить и что требует проверки

- Код, commits, ветки и теги: копировать и сверять имена refs и полные SHA. Проверить git fsck, отдельные LFS objects при наличии. Не force-push в исходный GitHub.
- API migration имеет отдельные pull_requests, releases, use_lfs; они по умолчанию false. private тоже по умолчанию false: для ArtHello только явное private=true.
- Полнота issues, comments/reviews, approvals, авторов/номеров/ссылок, release assets и wiki не гарантирована изученной migration specification. Экспортировать инвентарь; сравнить после пробного импорта и сохранить неподдержанный контекст отдельно.
- Secrets, environments, permissions, branch protection, webhooks, runner registration, CI history/caches/artifacts не являются обычным Git-клоном. Планировать отдельное восстановление, не извлекать plaintext GitHub secrets и не просить их в чат.
- Рабочая база ArtHello и School остаётся на Timeweb. Миграция Git-хостинга не подразумевает перенос или удаление рабочих данных.
- GitHub сохранить исходной площадкой до полного сравнения и первого проверенного выпуска/rollback из нового контура.

## Что удлиняет переход

GitVerse частично совместим с Actions. Не поддерживаются workflow_run, repository_dispatch, check_run, check_suite, issues, issue_comment; pull_request поддержан частично. Наши provenance, GitHub API, release gates и защиты необходимо адаптировать и заново проверить. Для CI нужен самостоятельный приватный репозиторий: в режиме mirror CI/CD недоступен.

Официальный UI import ограничен 16 ГБ и timeout 1 час — это ограничение одной задачи импорта, а не срок всей миграции.

GitVerse Free даёт 1 ГБ общего хранения пакетов/артефактов/релизов. Наш существующий архив релизных файлов 3,35 ГБ в этот объём не помещается. Нужен платный объём (Pro указывает 10 ГБ) либо сохранение старых файлов в GitHub/отдельном закрытом хранилище. Git-репозиторий, LFS и release assets проверять как разные виды хранения.

Оценка планирования, пока без авторизованной пробы: копирование и первичная сверка — несколько часов; полноценный перенос проверок и выпуска — ориентировочно 1–3 рабочих дня после доступов. Реальные сроки зависят от совместимости; исправление оставшихся функций ArtHello сюда не включено.

## Новый факт: собственный GitHub runner уже работает при исчерпанной квоте

Владелец штатно запустил probe-school-production-topology.yml на main. [Run34159568739](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34159568739), 7 сентября 2026 20:28:55 UTC, success. Job101858359890 и все его шаги прошли. Лог подтвердил SCHOOL_TOPOLOGY_SSH=VERIFIED, health=healthy, SCHOOL_DATABASE_INTEGRITY=OK, SCHOOL_TOPOLOGY_PROBE=PASS. Это проверка транспорта/топологии/целостности, не SSO login и не новый deploy. Значит GitVerse не является единственным способом снять ограничение GitHub-hosted compute; отдельный builder всё ещё нужен.

## Предлагаемая безопасная последовательность

1. Подключить GitVerse и проверить read/write/PR/workflow/logs в отдельном приватном тестовом репозитории без production secrets.
2. Создать приватную копию ArtHello со всеми ветками/тегами и согласованным архивом метаданных; исходный GitHub не удалять.
3. Получить машинный отчёт сверки refs/SHA/PR/issues/releases/assets и восстановить права/CI/деплой.
4. Получить тот же проверенный application SHA и release manifest; пройти приёмку и проверенный rollback.
5. Только затем выбрать GitVerse основной площадкой и отключить дублирующие старые процессы, сохранив историю.

Источники:
- https://gitverse.ru/docs/ai/mcp/
- https://gitverse.ru/docs/ai/mcp/gitverse-mcp-tools
- https://gitverse.ru/docs/developers/public-api/migration/api-post-repos-migrate
- https://gitverse.ru/docs/collaborative/repositories/guides/repository-workflow/import
- https://gitverse.ru/docs/cicd/docs/triggers
- https://gitverse.ru/docs/cicd/faq
- https://gitverse.ru/home/pricing/
