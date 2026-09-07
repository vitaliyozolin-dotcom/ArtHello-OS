# ArtHello v52: ограниченный проект переноса CI в GitVerse

Статус: **READ-ONLY REVIEW / NOT RUN / NOT RELEASE EVIDENCE**. Исполняемого workflow и production-переключения в этом пакете нет.

Назначение: перенести сначала проверку точного кода, не запуская непроверенный PR на production-сервере и не выдавая частичный build за готовый релиз. Исходный GitHub остаётся действующим источником и архивом до отдельной сверки переноса.

## Зафиксированный источник

- GitHub: `vitaliyozolin-dotcom/ArtHello-OS`.
- На момент чтения `main`: `9e4c49161e643997fe821a91b84c60c6e38ede33`.
- Tree: `7cd0fe0bd2a643fd79c35878e4406db7ce5d54de`.
- `source-manifest.json` содержит SHA-256 и Git blob SHA шести изученных файлов. Все шесть совпали с immutable GitHub tree.
- Прочитаны `AGENTS.md`, repo skill `workflow-hygiene`, D-040, три workflow, `scripts/workflow-policy.mjs`, v52 Dockerfile. Все локальные записи ограничены этим candidate-каталогом.

## Решение для первого этапа

**Не копировать Verify v52 под новым названием и не менять только `runs-on`.** GitVerse cloud подходит для пробного checkout/исходных проверок, но текущий Verify требует работающий Docker daemon, запускает итоговый образ, проверяет auth/secret mounts и затем сохраняет именно проверенный образ. Kaniko заменяет только часть сборки. Выдавать такой частичный результат за полный Verify нельзя.

До выбора и проверки изолированной машины сборки допустим отдельный непродуктовый пробный workflow с ручным запуском на фиксированном SHA. У него должны быть отдельные имя и отчёт, ясно означающие **migration preflight**, без статуса `verify-v52` и без downstream-деплоя. Этот пакет описывает контракт; он не включает YAML с вымышленными runner labels или неподтверждёнными правами.

## Проверенные различия платформ

| Поверхность | Исходное требование | GitVerse и необходимая адаптация |
|---|---|---|
| Тип репозитория | Приватный исходник, обычная разработка | В документации CI/CD недоступен для repository в режиме mirror. Для пилота нужна обычная приватная копия, не live mirror. [FAQ](https://gitverse.ru/docs/cicd/faq/) |
| Облачная среда | Эфемерная VM `ubuntu-latest`, Docker build/run/exec/inspect/save и временный volume | GitVerse выдаёт эфемерный контейнер без `docker.sock`, предлагает Kaniko для build. Runtime-proof текущего Verify там нельзя считать перенесённым. [Cloud runners](https://gitverse.ru/docs/cicd/docs/runners/cloud-hosted/) |
| Завершение проверки → выпуск | `workflow_run` только от exact Verify; проверка run, attempt, PR, SHA и API перед capability | `workflow_run` прямо указан как неподдерживаемый. Его нельзя заменить на `push` в production без нового эквивалентного контракта. [Triggers](https://gitverse.ru/docs/cicd/docs/triggers/) |
| Длительность | Verify: 60 мин; Quality test: 25 мин; Proof: 15 мин | Документация указывает максимум cloud job 15 мин. Увеличение YAML timeout само по себе не решает. [Limits](https://gitverse.ru/docs/cicd/docs/limits/) |
| Артефакты | Проверенный Docker archive + JSON/digest; Quality/Proof evidence | GitVerse описывает upload/download artifact. Справка упоминает 500 МБ, но текущий тариф Free указывает 1 ГБ общего хранения пакетов, CI/CD-артефактов и релизов. Это расхождение документации; фактическую квоту целевого аккаунта ещё надо проверить. Наш архив релизов 3,35 ГБ не помещается ни в один из этих бесплатных объёмов. [Artifacts](https://gitverse.ru/docs/cicd/manuals/artifacts/) |
| Контекст | `github.*`, `$GITHUB_*`, run attempt и pinned action SHA | GitVerse документирует совместимый alias `github` и собственный `gitverse`; полноценное соответствие полей/attempt/API не следует из alias. Поля в provenance проверять явно. [Context](https://gitverse.ru/docs/cicd/docs/context/) |
| Права и protection | `permissions: contents: read`, нет production Environment/секретов в Verify | Поддержку и фактические scope токена/Environment review нужно подтвердить на целевом аккаунте. Наличие YAML-ключа не доказывает enforcement. [Workflow syntax](https://gitverse.ru/docs/cicd/docs/workflow/) |

Квоты минут и хранения в разных страницах GitVerse расходятся с [тарифами](https://gitverse.ru/home/pricing/). Для решения о бюджете использовать фактические настройки `ozolin` и письменные условия тарифа, не обещать конкретный бесплатный лимит по этой технической справке. Приведённые ограничения — опубликованные на момент чтения, не измеренные на целевом аккаунте.

## Обязательные ворота и минимальная адаптация

| Файл / шаги | Triggers / runner сейчас | Действие в пилоте | Доказательство в исходнике |
|---|---|---|---|
| `.github/workflows/quality.yml`: secret-scan | PR + main push / hosted | Оставить полный tree + history scan и synthetic negative control. Для cloud вместо `docker run` нужен отдельно закреплённый проверенный бинарник scanner; пока этого нет, gate BLOCKED, не skipped. | Полная история и `git fsck`; Gitleaks digest; synthetic exit code 23; два реальных сканирования |
| Quality: test | PR + main push / hosted + PostgreSQL 16 | Сохранить `pnpm@11.7.0`, Node 24, frozen install, `test:full`, `test:postgres`, `build:full` и runtime-contract checks. PostgreSQL должен быть временным; production DATABASE_URL запрещён. | `quality.yml`, jobs `test`, services `postgres`, заключительный provenance |
| `.github/workflows/proof-gates.yml` | PR + filtered main push / hosted + PostgreSQL 16 | Сохранить workflow-policy, permission proof, migration twin, front-office build + реальный visual probe и evidence. Проверить адрес сервисной БД в контейнерной среде и зависимости браузера. | `proof-gates.yml`, job `prove` |
| Verify: source и production-policy boundary | PR + filtered main push / hosted | Полный Git, exact PR-head SHA, fsck. Существующая Ruby-проверка GitHub release contract остаётся: её нельзя удалить ради нового YAML. Новая GitVerse политика добавляется отдельно. | `verify-arthello-v52.yml:42`, большой guard до release-file checks |
| Verify: восстановление checkout → pristine gate → image | Те же / hosted | Сохранить порядок, закреплённую checkout implementation, отсутствие persistent credentials, tree/ignored/untracked clean до и после build. Внешние state/artifact-файлы не класть в build context до этих проверок. | `verify-arthello-v52.yml:392`, `:400`, `:412` |
| Verify: итоговый образ | Docker build + exact base digest | Не менять Dockerfile/toolchain в migration-пилоте. Сохранить source archive checksum, overlay sequence, patched DB checksum, lint/tests внутри Dockerfile. | `deploy/v52/Dockerfile:1–45` |
| Verify: runtime/секреты | Docker run/exec/inspect/volume | Сохранить fail-closed старт без ключа, fixture-only secret files, read-only mounts, ephemeral D1, health/assets/auth/CSRF/logout tests. Это blocker для Kaniko-only схемы. | `verify-arthello-v52.yml:438–626` |
| Verify: immutable evidence → maintenance | Docker save, fingerprint, pinned upload; затем Python | Сохранять archive SHA-256, runtime fingerprint, source SHA/tree, Dockerfile/lock/inventory/CA hashes, реальную платформу и run identity; maintenance только после immutable upload. | `verify-arthello-v52.yml:628–710` |

Счётчики: изучено 3 постоянных workflow, 4 jobs; наивное копирование имеет 5 блокирующих поверхностей: Docker runtime, platform trigger/API trust, time budget, artifact transport/capacity, policy coverage. Ни один workflow этим review не удалён, не отключён и не запущен.

## Порядок ограниченного пилота

1. Подтвердить целевой repo `ozolin/ArtHelloOS` как приватный обычный репозиторий; сохранить GitHub source/ветки/PR/релизы. Не включать импортированные старые одноразовые release workflows автоматически.
2. Выбрать приоритет `.gitverse/workflows`; убедиться, что CI не исполняет параллельно унаследованные production jobs из `.github/workflows`. Старые файлы сохранить для аудита, а фактический routing проверить непродуктовым запуском.
3. Запустить ручной source preflight без project script/package install: точные repository/event/actor/ref/SHA, полный Git и fsck, scope auth token. Не логировать целиком event/context/env: они могут содержать токены.
4. Проверить pinned checkout action и маленький artifact round trip: файл с заранее известным содержимым → upload → download → SHA-256, запись действительных run IDs/attempt. Без этого не переносить большие приватные образы.
5. Подключить изолированный build/runtime executor с необходимой ёмкостью, runtime и временем. Не использовать текущий production gateway для PR-head. D-040 запрещает PR-head на self-hosted; новая модель ephemeral external build потребует отдельного решения/эквивалентного guard, а не переименования метки.
6. Перенести все четыре jobs с теми же фактическими assertion; runner-specific plumbing вынести отдельно. Подтвердить PostgreSQL fixtures, политику секрета, exact source и полноту тестов. В CI report каждая невыполненная поверхность остаётся BLOCKED.
7. Сверить проверенный образ и evidence с неизменённым v52 контрактом на одном exact SHA. После этого отдельно проектировать promotion/deploy с эквивалентными main/PR/run/attempt, protection и immutable artifact gates.

Ни один пункт 3–7 в GitVerse этим review не выполнялся. Локальные 507 тестов предыдущего пакета правок не являются GitVerse CI evidence и не повторялись здесь.

## Необходимые изменения политики: proposal

См. `policy-patch-proposal.md`. Сейчас scanner видит только `.github/workflows`; добавление `.gitverse/workflows` без адаптации оставляет новую поверхность вне machine-readable proof. Обе директории нужно проверять, и `gitverse.*` условия должны анализироваться наравне с совместимым `github.*`.

## Граница данных и хранения

Данные производства и секреты находятся на Timeweb и в защищённых источниках, они не являются частью Git-переноса. Ни credentials, ни production DB в CI не копируются. Указанные ранее 333 ветки / 33 открытых PR / архив release assets 3,35 ГБ — входные данные от координатора; этот агент их заново не инвентаризировал. Тариф Free указывает 1 ГБ совместного хранения пакетов, CI/CD-артефактов и релизов; устаревшая справка о 500 МБ не доказывает отдельную дополнительную квоту. Не публиковать приватные artifacts публично для обхода квоты.

## Проверка самого пакета

- Фактическое совпадение 6 Git blob SHA с immutable upstream tree: **PASS**.
- Parsing структуры YAML и наличие описанных обязательных steps: выполнено в локальном candidate-каталоге, результаты сохранены в `review-source-check.log`. Этот отчёт не заменяет выполнение CI.
- Hosted GitVerse jobs, Docker/Kaniko build, runtime proof, artifact roundtrip, production deployment: **NOT RUN**.

Этот пакет — проверяемый план адаптации, а не свидетельство работоспособного переноса или выпуска.
