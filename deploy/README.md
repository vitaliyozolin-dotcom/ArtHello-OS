# ArtHello OS: российский production-контур

Этот каталог готовит отдельный сервер ArtHello OS в московском регионе Timeweb. Он не меняет и не перезапускает нидерландский сервер Telegram/Claude-агентов.

## Границы первого запуска

- DNS `arthelloteam.ru` и действующие webhook агентов не меняются.
- Кандидат проверяется сначала по IP и локальному Host-заголовку.
- До создания персонального владельца API не считается готовым.
- До отдельной приёмки AlfaCRM, Точка и реальные файлы остаются выключенными.

## Сервер

Ubuntu 24.04 LTS, Docker Engine с Compose v2, отдельный пользователь `deploy-arthello`, вход только по SSH-ключу. Каталоги:

- `/srv/arthello/releases` — неизменяемые релизы;
- `/srv/arthello/current` — активный релиз;
- `/srv/arthello/shared/.env.production` — секреты с правами `0600`;
- `/srv/arthello/backups/postgres` — ежедневные дампы и SHA-256.

PostgreSQL backup публикуется атомарно только после `pg_restore --list`; неуспешный dump или validation оставляет лишь удаляемый `.partial` и повторяется через `BACKUP_RETRY_SECONDS`. Интервал, retry и retention принимают только положительные целые значения (`BACKUP_INTERVAL_SECONDS`, `BACKUP_RETRY_SECONDS`, `BACKUP_RETENTION_DAYS`). `BACKUP_RUN_ONCE=1` предназначен для timer/ручной проверки. Этот каталог пока хранится на том же VPS: off-host provider, alert destination и утверждённые RPO/RTO в репозитории не заданы, поэтому disaster recovery нельзя считать принятым только по наличию локального dump.

Fallback через Git SSH в двух исторических manual v44 scripts разрешён только с непустым заранее проверенным `GITHUB_KNOWN_HOSTS_FILE`; TOFU/`accept-new` запрещены. Основной release path остаётся HTTPS artifact delivery.

Скопировать `production.env.example` в защищённый файл, заменить все `CHANGE_ME` и не коммитить результат.

GitHub Environment `production-ru` хранит deploy-secrets. `ARTHELLO_RU_HOST` сначала равен `:80` для закрытой проверки по IP. После DNS-приёмки его меняют на `os.arthelloteam.ru`, и Caddy получает публичный TLS-сертификат.

## Закрытая сборка вне VPS

Российский VPS не собирает JavaScript-зависимости и не обращается к npm во время deployment. Workflow `Build closed RU release` проверяет точный application SHA, собирает API/web-образы в GitHub Actions, добавляет образ PostgreSQL, формирует manifest и SHA-256 и публикует assets как prerelease приватного репозитория.

Сервер скачивает эти assets существующим fine-grained токеном только с `Contents: Read`, проверяет target SHA, release manifest, GitHub asset digest и локальные SHA-256, затем выполняет `docker load` и `docker compose up --no-build --pull never`. Проверенный pull-скрипт входит в тот же checksum-set и после первой активации устанавливается в `/srv/arthello/shared/bin/arthello-pull-release`. Токен хранится только в `/srv/arthello/shared/github-https/token` с правами `0600`.

Запуск из локальной консоли Timeweb:

```bash
bash /srv/arthello/shared/bin/arthello-pull-release <SHA> :80
```

До успешного health-check активный symlink не переключается. DNS, первый владелец, реальные данные и интеграции этим сценарием не настраиваются.

## Первый владелец

После миграций выполнить на сервере одну команду внутри API-контейнера, передав логин, имя и временный пароль только в локальном терминале. Команда `pnpm --filter @workspace/api-server auth:create-owner` создаёт запись в PostgreSQL. После выполнения удалить `AUTH_BOOTSTRAP_OWNER_PASSWORD` из окружения. Первый вход принудительно потребует новый пароль и отзовёт стартовую сессию.

## Переключение домена

`os.arthelloteam.ru` можно направлять на российский IP только после прохождения health-check, входа владельца, смены пароля, проверки logout/lockout и восстановления тестового дампа. Корневой домен и агентские поддомены на этом этапе не трогать.
