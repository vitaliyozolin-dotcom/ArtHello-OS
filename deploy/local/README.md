# Локальный запуск в Docker

Нужны Docker Engine и Docker Compose v2+. Node и pnpm на хосте не нужны:
сборка использует Node 24 и locked pnpm 11.7.0 из `deploy/Dockerfile`.
Запускать команды из корня репозитория. Образы workspace настроены для Linux amd64.

```bash
docker compose -f docker-compose.local.yml up -d --build --wait
```

При запуске API автоматически применяет проверенные миграции к отдельной локальной
PostgreSQL 16. Данные сохраняются в томе `arthello-local_postgres-data`.
CRM и `/api` доступны через один адрес; дополнительная настройка Vite не нужна.
Live integration credentials в контейнеры не передаются.

| Сервис | Адрес на хосте |
| --- | --- |
| CRM | http://localhost:23187 |
| API health | http://localhost:28087/api/healthz |
| PostgreSQL | localhost:25487 |

Все порты привязаны к `127.0.0.1`. Локальная БД: `arthello_local`, пользователь
`arthello`, пароль `local-development-password`. Это публичные локальные реквизиты.

Для новой БД один раз создать владельца (Bash):

```bash
read -rsp 'Пароль владельца (14+ символов, буквы и цифры): ' AUTH_BOOTSTRAP_OWNER_PASSWORD
echo
export AUTH_BOOTSTRAP_OWNER_PASSWORD
docker compose -f docker-compose.local.yml run --rm create-owner
unset AUTH_BOOTSTRAP_OWNER_PASSWORD
```

Логин по умолчанию `owner`, при первом входе потребуется сменить пароль.
Имя и логин можно задать через `AUTH_BOOTSTRAP_OWNER_NAME` и
`AUTH_BOOTSTRAP_OWNER_LOGIN` перед командой. Повторный bootstrap для существующего
логина не нужен. Свежая БД не содержит импортированных школьных данных.

Если выбранные порты заняты, создать в корне `.env` (он исключён из Git и Docker context):

```dotenv
ARTHELLO_WEB_PORT=23188
ARTHELLO_API_PORT=28088
ARTHELLO_DB_PORT=25488
```

Compose использует эти переменные для портов и разрешённых browser origins.
После смены портов повторить `up -d --wait` и открыть новый адрес CRM.

```bash
# Состояние и логи
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs -f api web

# Пересобрать после изменений исходников
docker compose -f docker-compose.local.yml up -d --build --wait

# Остановить, сохранив БД
docker compose -f docker-compose.local.yml down
```

Для намеренного удаления локальной БД использовать `down -v`.
Это окружение для локальной разработки; опубликованные production workflows не меняются.
