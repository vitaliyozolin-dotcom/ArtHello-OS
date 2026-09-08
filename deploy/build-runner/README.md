# ArtHello: GitHub + отдельная машина сборки

Дата: 2026-09-08. Статус: **локальный reviewable candidate; NOT DEPLOYED; VM / Docker / artifact delivery NOT RUN**.

Исходник `vitaliyozolin-dotcom/ArtHello-OS@9e4c49161e643997fe821a91b84c60c6e38ede33`, tree `7cd0fe0bd2a643fd79c35878e4406db7ce5d54de`. Пользователь явно выбрал GitHub + собственную машину сборки и потребовал выпуск подготовленных исправлений. Это основание для нового D-061, но не доказательство существования такой машины или наличия доступа к ней.

## Что подготовлено

| Файл в candidate | Конкретное поведение |
|---|---|
| `.github/workflows/verify-arthello-isolated-candidate.yml` | Новый manual-only контроллер из актуального `main`. Проверяет заранее одобренные controller SHA, candidate SHA/tree и фиксированную ветку `codex/recovery-release-20260908` через API до checkout. Также разрешает exact current main для повторной проверки после merge. Запускает четыре исходных job: secret-scan, Quality, Proof, Verify v52. |
| `deploy/build-runner/bootstrap.sh` | На новой внешне изолированной VM сверяет provisioning record, boot ID, hostname/IP, SHA-256 официального runner archive и отсутствие существующих Docker containers/volumes; создаёт отдельного пользователя и регистрирует runner `--ephemeral --no-default-labels`. После одного job выключает VM; внешнее удаление VM по TTL обязательно даже при потере процесса. |
| `deploy/build-runner/check-ready.py` | Перед каждым checkout сверяет root-owned readiness с фактическим boot ID, runner name, сроком, exact controller/candidate SHA/tree. Это дополнительная проверка свежести, не доказательство сетевой изоляции. |
| `scripts/workflow-policy.mjs` | Новый custom label продолжает классифицироваться как self-hosted. Автоматический PR/PR-target по-прежнему блокируется. Исключения вида `productionCapability:false` в YAML нет. |
| Два файла тестов | Негативные случаи PR scheduling, смены кандидата/контроллера/VM, истечения срока, production IP и отсутствия внешних provisioning references. |

Оригинальные `.github/workflows/quality.yml`, `proof-gates.yml`, `verify-arthello-v52.yml` и одноразовый D-059 deploy **не изменены**. `render.py` воспроизводимо извлекает исходные gate jobs; `validate.py` доказывает, что shell-тела проверок сохранены, и отвергает шесть опасных мутаций. В новом provenance честно записано `self-hosted-isolated-ephemeral`. Старый deploy такой provenance не принимает — новый promotion contract должен быть реализован и проверен отдельно, старые D-059 pin не переиспользуются.

## Текст D-061 для включения координатором

**D-061 — Проверять release-кандидат на внешне изолированной одноразовой машине сборки.**

Основание: явное поручение владельца от 08.09.2026 вернуться к GitHub + собственной машине сборки и выпустить все исправления. Код из reviewable release-ветки разрешено выполнять до merge только на новой физически/виртуально отдельной build-VM, которая не имеет production credentials, production volumes, host sockets других серверов, маршрутов в production private network или доступа к cloud control plane. Граница сети и гарантированное удаление по TTL устанавливаются контроллером вне VM и вне candidate checkout. Указанные ограничения проверяются по фактическому provisioning record; runner labels и самоописание JSON не заменяют их.

Рассмотренный workflow-контроллер находится в `main`, а исполняемый candidate закреплён точным SHA/tree и внешним provisioning record. Запуск `workflow_dispatch` принадлежит владельцу; автоматические PR/PR-target не получают этот runner. На одну VM приходится один job; после job VM не переиспользуется. GitHub default labels отсутствуют, чтобы старые generic self-hosted jobs не могли попасть на builder. Docker внутри build-VM root-эквивалентен; по этой причине изоляция обеспечивается снаружи.

Постоянные secret-scan/history, Quality, PostgreSQL, migration/permission/visual proof, точный Dockerfile/runtime-image, auth/CSRF/fixture secret mounts, image fingerprint, immutable source/provenance и послеобразные maintenance tests сохраняются. Политика D-040 продолжает запрещать PR code на production runner; новое разрешение ограничено внешне изолированным builder. Production получает готовый проверенный image, не запускает пакетный менеджер или сборку. Неизменяемый artifact transport и production promotion проходят отдельную проверку; build PASS сам по себе не является разрешением или доказательством deployment.

## Реальные блокеры

1. **Отдельная машина не найдена.** `188.225.38.55` — production gateway, `188.225.47.207` — production origin. Ни один не является builder. Нет подтверждённых API/SSH полномочий создать, изолировать, зарегистрировать и удалить build-VM. Скрипт здесь не запускался.
2. **GitHub runner registration требует доступ владельца/администратора.** Текущий GitHub connector не предоставляет POST runner registration token / runner administration. Нужен краткоживущий registration token через защищённую консоль/секреты provisioning, не PAT в чате. Токен из root-only `/run/runner-registration-token` удаляется после регистрации.
3. **GitHub Actions storage заполнен.** Собственный runner решает оплату вычислительных минут, но не объём GitHub artifact storage. В показанном аккаунте 0.5/0.5 GB. Новый workflow пока сохраняет исходные upload steps; при отказе upload он завершится ошибкой и не станет evidence. Retention новых artifacts сокращён до трёх суток, это не освобождает уже занятую квоту немедленно. Полный production image может не поместиться даже при освобождении части старой квоты.
4. **Delivery / promotion ещё не подключены.** Нужен подтверждённый private artifact backend и новый consumer проверенного image. Существующий D-059 consumer не открывается заменой trust string. См. контракт ниже.

## Контракт private external artifact delivery

При заполненной квоте рекомендуемый transport — приватное object storage либо отдельный защищённый artifact-сервер; физический экземпляр, цена, endpoint и access policy пока не подтверждены. Существующая build-VM может держать временный archive до upload, но единственная копия на одноразовой VM не является надёжной доставкой.

- Namespaced create-only ключ: `arthello/<source-sha>/<workflow-run-id>/<attempt>/...`; отдельные Docker archive, JSON provenance, SHA-256 manifest и Quality/Proof evidence.
- Builder получает короткоживущие полномочия PUT только для конкретного release prefix, без LIST/DELETE/overwrite, доступа к production или cloud control plane. Лучше presigned PUT, выдаваемые внешним контроллером. Проверить поддержку create-only операции у выбранного провайдера, не предполагать её по названию S3-compatible.
- Архив приватен; публичный bucket и публичный release для обхода квот запрещены. Promotion получает отдельное read-only разрешение. Секреты и presigned URLs не записываются в Git, workflow outputs или логи.
- Приёмка upload: завершённый объект, совпадение длины и SHA-256 после независимого скачивания; ETag не подменяет SHA-256. Manifest включает platform/trust, runner provisioning identity, workflow controller SHA, source SHA/tree, run/attempt, точные image/dockefile/runtime lock/CA/fingerprint hashes и результаты всех jobs.
- Promotion перечитывает GitHub API: exact workflow path из main, actor, inputs SHA/tree, run/attempt, завершение **всех четырёх** jobs. Затем проверяет private artifact bytes, provenance и image fingerprint до production capability. Для main после squash выполняется новая точная проверка: pre-merge image нельзя выдать за образ другого SHA.
- Старая рабочая версия и данные сохраняются до clone-preflight, проверенного backup, cutover и публичной приёмки; ошибка включает существующие rollback guards. Artifact retention и возможность отката проверяются до удаления build-VM.

## Подготовка первой машины после получения доступа

Нужна одноразовая Linux x64 VM, 4 vCPU / 8 GB RAM / 40–60 GB свободного диска как исходная оценка, **не измеренный минимум**. Доступ к GitHub, npm/package registries и container registries нужен для сборки; соединения к production private endpoints и cloud metadata/control plane запрещены на внешней сетевой границе. VM image должен содержать Docker, Node/corepack prerequisites, Python 3, Ruby, Git, curl, jq, tar/gzip, xz/unzip, build tools и необходимые зависимости официального GitHub runner. Саму версию runner archive и SHA-256 брать из текущей официальной инструкции GitHub регистрации и фиксировать до запуска.

Для четырёх jobs нужны четыре fresh VM либо четыре создания/восстановления VM внешним контроллером. Обычная повторная регистрация runner на том же диске не подходит. Это можно автоматизировать после получения доступа к провайдеру; данный пакет не содержит вымышленных API tokens или resource IDs.

`approved-builder.json` создаёт внешний контроллер с фактическими полями: `schemaVersion`, `repository`, `runnerLabel`, `runnerName`, `controllerSha`, `sourceSha`, `sourceTree`, `bootId`, `hostname`, `addresses`, `createdAt`, `expiresAt`, `ephemeral`, `productionCapability`, `providerInstanceId`, `networkPolicyRef`, `externalExpiryRef`, `baseImageRef`, `runnerArchiveSha256`. Root ownership и mode 0600 обязательны. Проверка здесь доказывает согласованность и свежесть записи; внешний network/TTL proof должен быть проверен отдельно до регистрации.

На этой новой VM после review контроллера и provisioning:

```bash
bash deploy/build-runner/bootstrap.sh \
  /root/approved-builder.json \
  /root/actions-runner-linux-x64.tar.gz \
  /run/runner-registration-token
```

Нельзя запускать эту команду на production gateway/origin. Никакого скачивания ключей production, установки runner на существующий сервер или покупки VM этим пакетом не произведено.

## Выполненная локальная проверка

- Workflow-policy: **11/11 PASS**, включая восемь прежних regression tests.
- Freshness/candidate/controller binding: **7/7 PASS**, с несколькими негативными случаями внутри тестов.
- Extraction of all four gate jobs: **PASS**; шесть unsafe mutations отвергнуты; shell-синтаксис всех extracted run blocks и bootstrap — **PASS**.
- Node test harness использовал ту же `yaml@2.9.0`, что root package исходного main. Локальные harness `package.json`/lock/node_modules не входят в patch manifest.
- Production Docker build/runtime test, artifact delivery, GitHub run и deployment: **NOT RUN / BLOCKED**.

## Официальные источники

- GitHub self-hosted runner cost/maintenance: https://docs.github.com/actions/hosting-your-own-runners
- Ephemeral runner lifecycle (one job and required external cleanup): https://docs.github.com/en/actions/reference/runners/self-hosted-runners
- Runner API / required administration permissions: https://docs.github.com/en/rest/actions/self-hosted-runners

