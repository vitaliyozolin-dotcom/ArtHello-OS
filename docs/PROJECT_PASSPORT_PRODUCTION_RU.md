# Паспорт: ArtHello OS Production RU

- `project_id`: `ARTHELLO-OS-PRODUCTION-RU`
- владелец: Виталий Озолин
- состояние: `approved` → `active`
- актуально на: 2026-08-22
- область: перенос ArtHello OS на отдельный российский сервер Timeweb с персональными учётными записями; затем восстановление уже подключённых AlfaCRM и Точки.

## Цель и конечный результат

Рабочая ArtHello OS доступна на `https://os.arthelloteam.ru`, хранит первичную базу персональных данных в России, требует персональный логин и пароль, ведёт аудит доступа и может безопасно получать read-only данные AlfaCRM и Точки. Нидерландский сервер продолжает обслуживать Telegram/Claude-агентов и не хранит полную операционную базу ArtHello OS.

## Критерии завершения

1. Отдельный сервер Timeweb в Москве, TLS, закрытая PostgreSQL и автоматический backup.
2. Персональные пользователи в PostgreSQL; общих паролей ролей нет.
3. Временный пароль обязательно меняется; lockout, CSRF, Secure/HttpOnly cookies, отзыв сессий и аудит подтверждены тестами.
4. Восстановление backup фактически проверено.
5. DNS `os.arthelloteam.ru` переключён без изменения агентских записей.
6. AlfaCRM и Точка восстановлены из защищённого старого окружения; новые ключи запрашиваются только при доказанном `expired`, `revoked` или `invalid`.
7. Два последовательных автоматических read-only обновления дают воспроизводимые результаты и время синхронизации.

## Этапы и зависимости

1. `RU-01` — атомарный baseline + production-код, персональная аутентификация, exact-head CI. Статус: `completed`; PR #27 направлен прямо в `main`, Quality gates пройдены.
2. `RU-02` — отдельный RU-сервер, key-only deploy-user, SSH hardening, Docker/UFW и защищённый runtime env без данных и интеграций. Статус: `completed`.
3. `RU-03` — merge завершён; приложение SHA `f7bb971f362bb8fe3f76209eba01237c602d9946` собирается вне VPS в GitHub Actions, публикуется закрытыми release-assets и загружается RU-сервером по HTTPS; после health-check отдельно проверяются первый владелец, обязательная смена пароля, login/logout/lockout/session revocation. Статус: `active`; зависит от зелёного `RU-01` и подготовленного `RU-02`.
4. `RU-04` — backup/restore и security acceptance. Зависит от `RU-03`.
5. `RU-05` — DNS и TLS. Зависит от `RU-04`.
6. `RU-06` — восстановление AlfaCRM/Точки и файловый импорт в `SHADOW + DATA_AUDIT`. Зависит от `RU-05`.

## Метрики и ворота

- ноль API бизнес-данных без действующей персональной сессии;
- ноль общих паролей ролей в runtime;
- ноль секретов в текущем дереве, достижимой Git-истории и CI-артефактах;
- обязательный `secret-scan` использует pinned Gitleaks, fail-closed self-test, redacted output и полный history checkout;
- каждый SHA, разрешённый к merge, обязан иметь зелёный exact-head CI;
- RPO 24 часа, целевой RTO 4 часа до фактического замера;
- health-check и login/logout/lockout/password-change проходят на опубликованном кандидате;
- никакого merge, deploy или DNS cutover без отдельного разрешения Виталия и прохождения соответствующего ворота.

## Подтверждённое состояние на 2026-08-21

- российский Timeweb VPS: `188.225.47.207`;
- нидерландский сервер агентов не изменялся;
- deploy-user `deploy-arthello` входит только по SSH-ключу;
- Docker `29.7.2`, Docker Compose `v5.5.0`;
- UFW активен; разрешены только SSH, HTTP и HTTPS/HTTP3;
- password authentication, keyboard-interactive authentication и root login по SSH отключены;
- `/srv/arthello/shared/.env.production` создан с правами `600` и владельцем `deploy-arthello`;
- AlfaCRM, banking и SMS-Vizitka выключены;
- реальные данные не загружены;
- PR #27 squash-merged в `main`; immutable release SHA: `f7bb971f362bb8fe3f76209eba01237c602d9946`;
- GitHub Environment `production-ru` создан, ограничен веткой `main`, deploy-secrets сохранены;
- два deploy-запуска успешно прошли verify/build, но доставка по SSH `22` оборвалась через 120 секунд с runner-регионов `westus` и `northcentralus` до запуска server activation;
- `sshd`, UFW и fail2ban на RU-сервере исправны; Виталий применил дополнительный listener `2222`, основной SSH `22` сохранён;
- приложение, данные, интеграции и DNS предыдущими неудачными попытками не изменены;
- fine-grained GitHub token с доступом только к `vitaliyozolin-dotcom/ArtHello-OS` и `Contents: Read` сохранён только на RU-сервере; HTTPS-fetch исходников SHA `f7bb971f…` подтверждён;
- диагностика `ARTHELLO_NET_DIAG_VERSION=1`: DNS `registry.npmjs.org` работает, но HTTPS с самого VPS завершается `curl 28 / SSL connection timeout`; проблема возникает до Docker;
- публичный npm status в момент диагностики показывает Package installation `Operational`, поэтому локальный build на VPS исключён как невоспроизводимый;
- Виталий утвердил off-server build и private release pull 2026-08-21.

## Риски и блокеры

- прямой SSH delivery из GitHub-hosted runner и локальный npm build на VPS признаны непригодными для этого контура; новый критерий закрытия — опубликованный private release с точным target SHA, проверенные digest/SHA-256, `docker load`, запуск с `--no-build --pull never` и успешный health-check;
- первый owner и опубликованный auth flow ещё не проверены end-to-end;
- фактический backup restore ещё не выполнен;
- старое защищённое окружение AlfaCRM/Точки ещё не инвентаризировано;
- PR #7 имеет красный CI на своём head и не должен сливаться отдельно;
- любые реальные данные, интеграции и DNS остаются заблокированы до отдельных ворот.

## Текущий шаг

- исполнитель: Codex; владелец решения — Виталий Озолин;
- действие: в ветке `codex/arthello-offserver-build` добавить сборку API/web/PostgreSQL images на GitHub-hosted runner, private prerelease assets, проверяемый HTTPS pull на VPS и shell gate; получить зелёный CI, squash-merge, собрать exact application SHA `f7bb971f362bb8fe3f76209eba01237c602d9946`, затем выполнить server pull;
- ограничения: без DNS, реальных данных, интеграций и первого owner; нидерландский сервер не изменять; существующие SSH listeners не менять; сторонние npm mirrors не использовать;
- доказательство выполнения: successful PR checks, merge SHA инфраструктуры, private release target=`f7bb971f…`, asset digest + SHA-256, image revision labels, `GET /api/healthz` через временный host `:80`, active release symlink;
- следующий переход: после принятого закрытого deploy — создать первого владельца и проверить полный auth flow.

## Контракт AI-процесса: CI и подготовка релиза

- входные данные: head SHA PR #27, workflow `Quality gates`, паспорт и production-конфигурация;
- ожидаемый результат: один воспроизводимый кандидат с зелёным exact-head CI и подтверждаемым provenance;
- разрешённые действия: обновлять паспорт и описание PR, перезапускать CI, исправлять только CI-дефекты в `codex/arthello-production-ru`;
- запрещённые действия: merge, deploy, DNS, загрузка данных, подключение интеграций, изменение нидерландского сервера;
- ответственный человек: Виталий Озолин;
- исполнитель: Codex;
- стоимость выполнения: инфраструктурные расходы отсутствуют сверх действующих GitHub Actions и VPS;
- метрика пользы: ноль красных обязательных проверок и ноль недоказанных release-фактов;
- автоматическое отключение: остановиться при необходимости расширить полномочия, изменить production-данные, получить секрет либо выполнить merge/deploy;
- отказ пользователя: разрешён в любой момент; ветка и draft PR сохраняются, production не изменяется, данные не обрабатываются.

## Контракт AI-процесса: закрытый RU deployment

- входные данные: immutable application SHA `f7bb971f362bb8fe3f76209eba01237c602d9946`, workflow из актуального `main`, private GitHub repository, существующий fine-grained token `Contents: Read`, подготовленный RU VPS;
- ожидаемый результат: GitHub Actions проверяет source SHA, тесты и build, публикует закрытый bundle API/web/PostgreSQL и pull-скрипт с manifest и SHA-256; VPS проверяет release target, GitHub asset digest, manifest, image revision labels и запускает Compose без build/pull;
- разрешённые действия: создать `codex/arthello-offserver-build`, commit/push/PR, обновить workflow/документацию/паспорт, исправлять CI, squash-merge после зелёного CI, опубликовать private prerelease и развернуть указанный application SHA на `188.225.47.207`;
- запрещённые действия: DNS cutover, создание первого owner, загрузка реальных данных, подключение AlfaCRM/Точки, изменение нидерландского сервера, сторонние package mirrors, передача сохранённого токена в чат или CI;
- ответственный человек: Виталий Озолин; исполнитель — Codex;
- стоимость выполнения: GitHub Actions storage/compute и трафик в пределах действующих ресурсов; новых VPS и платных сервисов не добавляется;
- метрика пользы: private release и successful health-check при нуле npm-запросов с VPS во время activation и нуле запрещённых побочных эффектов;
- автоматическое отключение: остановиться при несовпадении target SHA/digest/checksum/image label, расширении token scope, необходимости изменить данные/DNS/интеграции либо невозможности безопасного rollback;
- отказ пользователя: разрешён до server activation; PR/release сохраняются как технические артефакты, production и данные не изменяются.

## Утверждённые решения

```yaml
decision:
  decision_id: D-PROD-RU-001
  project_id: ARTHELLO-OS-PRODUCTION-RU
  status: active
  question: Где размещать ArtHello OS и агентов?
  statement: Оставить один доменный контур, но разделить серверы. Telegram/Claude-агенты остаются на нидерландском сервере. ArtHello OS и её первичная PostgreSQL размещаются на отдельном российском Timeweb; сначала персональные логины, затем интеграции.
  rationale: Сохранить работу Claude и изолировать операционные персональные данные, доступы и отказоустойчивость системы.
  approved_by: Виталий Озолин
  approved_at: 2026-08-20
  owner: Виталий Озолин
  affected_stages: [RU-01, RU-02, RU-03, RU-04, RU-05, RU-06]
  dependencies: [new_ru_server, deploy_access, protected_runtime_secrets]
  supersedes: []
  rejected_alternatives:
    - option: Разместить OS на существующем нидерландском VPS агентов
      reason: Общая точка отказа и неподходящий контур для первичной базы персональных данных.
      reopen_condition: Только после отдельного юридического и архитектурного пересмотра.
  actions:
    - action: Подготовить production-ветку и draft PR
      owner: Codex
      due: 2026-08-20
      evidence_required: branch, commit SHA, draft PR, CI
      status: completed
    - action: Создать и безопасно подготовить московский VPS
      owner: Виталий Озолин и Codex
      due: 2026-08-21
      evidence_required: Timeweb server evidence without secrets, key-only SSH verification, hardened runtime env
      status: completed

decision:
  decision_id: D-PROD-RU-002
  project_id: ARTHELLO-OS-PRODUCTION-RU
  status: active
  question: Как доставить baseline и production-контур в main без промежуточного красного состояния?
  statement: Перенести draft PR #27 из codex/arthello-production-ru прямо на main и рассматривать его как единый атомарный baseline + production-кандидат. PR #7 отдельно не сливать. До отдельного разрешения Виталия выполнять только обновление документации и CI-исправления.
  context: Default branch main почти пуст; PR #7 является baseline, но его exact-head CI красный. PR #27 содержит baseline, production-изменения и зелёные исправления.
  rationale: Не допустить заведомо сломанного промежуточного main и сделать каждый разрешённый к merge SHA проверяемым.
  evidence:
    - repository default_branch=main
    - PR #7 head 90318e8547252fd2f17f32ca464575021b330523: Quality gates failure
    - PR #27 head 1a7bc8bc7e0be447ac4499e49d6217769ad2b26b: Quality gates run #57 success after retarget to main
    - RU server preparation evidence accepted 2026-08-21
  assumptions:
    - PR #27 после смены base остаётся mergeable
    - новый exact-head CI будет запущен и проверен
  approved_by: Виталий Озолин
  approved_at: 2026-08-21
  owner: Виталий Озолин
  deadline: null
  review_at: null
  affected_stages: [RU-01, RU-02, RU-03]
  dependencies: [green_exact_head_ci, explicit_merge_authorization, explicit_deploy_authorization]
  supersedes: []
  superseded_by: null
  source_links:
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/27
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/7
  raw_deliberation_ref: ChatGPT project conversation 2026-08-21
  rejected_alternatives:
    - option: Сначала слить PR #7, затем PR #27
      reason: PR #7 имеет красный CI на своём текущем head и создал бы сломанный промежуточный main.
      reopen_condition: Только если PR #7 получит отдельный зелёный exact-head CI и маршрут будет повторно утверждён.
    - option: Ручная загрузка приложения на VPS в обход GitHub
      reason: Невоспроизводимый deployment без immutable provenance и release gate.
      reopen_condition: Только как документированное аварийное восстановление после отдельного разрешения.
  actions:
    - action: Обновить паспорт на candidate branch
      owner: Codex
      due: 2026-08-21
      evidence_required: commit SHA
      status: completed
    - action: Перенести PR #27 на main и обновить описание
      owner: Codex
      due: 2026-08-21
      evidence_required: PR metadata base=main
      status: completed
    - action: Получить зелёный exact-head CI
      owner: Codex
      due: 2026-08-21
      evidence_required: completed successful workflow tied to current head SHA
      status: completed

decision:
  decision_id: D-PROD-RU-003
  project_id: ARTHELLO-OS-PRODUCTION-RU
  status: active
  question: Как исключить попадание секретов в ArtHello OS до merge?
  statement: Сделать secret-scan обязательным отдельным job в Quality gates. Проверять текущую файловую систему и всю Git-историю, достижимую из candidate HEAD, официальным Gitleaks v8.30.0, закреплённым по immutable GHCR digest; перед каждым сканированием выполнять fail-closed synthetic self-test; секреты в логах редактировать.
  context: Зелёный functional CI не содержал явного repository-level secret scan. Gitleaks v8.30.1 не используется из-за опубликованной false-negative регрессии.
  rationale: Удалённый из текущего файла ключ остаётся доступным в Git-истории; самописный regex и непроверенный запуск сканера дают ложную уверенность.
  evidence:
    - https://github.com/gitleaks/gitleaks
    - https://github.com/gitleaks/gitleaks/issues/2170
    - https://github.com/gitleaks/gitleaks/pkgs/container/gitleaks
    - workflow job secret-scan tied to the exact PR head
  assumptions:
    - official v8.30.0 GHCR manifest digest remains retrievable by GitHub-hosted runners
    - no allowlist is introduced without evidence that a finding is synthetic and safe
  approved_by: Виталий Озолин
  approved_at: 2026-08-21
  owner: Виталий Озолин
  deadline: 2026-08-21
  review_at: null
  affected_stages: [RU-01, RU-03]
  dependencies: [full_git_checkout, pinned_scanner, green_exact_head_ci]
  supersedes: []
  superseded_by: null
  source_links:
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/27
  raw_deliberation_ref: ChatGPT project conversation 2026-08-21
  rejected_alternatives:
    - option: Проверять только текущие файлы
      reason: Секрет может быть удалён из HEAD, но остаться доступным в истории.
      reopen_condition: Никогда для release gate; допустимо только как дополнительная локальная проверка.
    - option: Использовать Gitleaks v8.30.1
      reason: Опубликована подтверждённая false-negative регрессия с пропуском canonical GitHub PAT.
      reopen_condition: После исправленного официального релиза и отдельной проверки synthetic self-test.
    - option: Разрешить широкие allowlist-исключения
      reason: Они маскируют реальные утечки и превращают gate в декорацию.
      reopen_condition: Только для конкретного redacted fingerprint после ручной классификации.
  actions:
    - action: Добавить fail-closed secret-scan в Quality gates
      owner: Codex
      due: 2026-08-21
      evidence_required: workflow diff and immutable scanner digest
      status: completed
    - action: Получить зелёный secret-scan на exact candidate head
      owner: Codex
      due: 2026-08-21
      evidence_required: successful GitHub Actions job tied to current head SHA
      status: completed

decision:
  decision_id: D-PROD-RU-004
  project_id: ARTHELLO-OS-PRODUCTION-RU
  status: superseded
  question: Как доставить проверенный релиз на RU VPS после сетевого отказа SSH 22 с GitHub-hosted runners?
  statement: Сохранить административный SSH на 22, добавить отдельный listener 2222 для GitHub deployment, хранить порт и port-qualified pinned host key в Environment production-ru и повторно развернуть тот же immutable SHA f7bb971f362bb8fe3f76209eba01237c602d9946.
  context: Два независимых runner-региона westus и northcentralus успешно собрали artifact, но оба scp-сеанса на 22 завершились через 120 секунд до server activation. Диагностика RU VPS подтвердила active sshd, открытый UFW, отсутствие fail2ban bans и отсутствие ошибки приложения.
  rationale: Устранить внешний сетевой блокер без ослабления SSH, без ручной невоспроизводимой загрузки и без использования нидерландского сервера как relay.
  evidence:
    - GitHub Actions run 32437357216, deploy jobs 96641590977 and 96642441389
    - Timeweb SSH diagnostic ARTHELLO_SSH_DIAG=END, 2026-08-21
    - explicit approval and server-side application by Vitaly, 2026-08-21
  assumptions:
    - Timeweb принимает входящий TCP 2222 после server-side listener/UFW change
    - host key на 2222 совпадает с ранее проверенным ED25519 key сервера
  approved_by: Виталий Озолин
  approved_at: 2026-08-21
  owner: Виталий Озолин
  deadline: 2026-08-21
  review_at: null
  affected_stages: [RU-03]
  dependencies: [green_exact_head_ci, production_ru_port_secret, port_qualified_known_hosts]
  supersedes: []
  superseded_by: D-PROD-RU-005
  source_links:
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/32437357216
  raw_deliberation_ref: ChatGPT project conversation 2026-08-21
  rejected_alternatives:
    - option: Продолжать перезапускать delivery на SSH 22
      reason: Два разных runner-региона воспроизвели одинаковый сетевой отказ; повтор без изменения фактов не даёт новой информации.
      reopen_condition: Только после подтверждённого изменения внешнего маршрута Timeweb/GitHub.
    - option: Использовать нидерландский сервер агентов как relay
      reason: Нарушает утверждённую изоляцию серверов и создаёт новую общую точку отказа.
      reopen_condition: Только по отдельному архитектурному и юридическому решению.
    - option: Выполнить ручную загрузку приложения в обход GitHub
      reason: Теряется immutable provenance и воспроизводимый release gate.
      reopen_condition: Только как документированное аварийное восстановление по отдельному разрешению.
  actions:
    - action: Проверить порт 2222 реальным GitHub deployment
      owner: Codex
      due: 2026-08-21
      evidence_required: successful artifact upload and server activation logs
      status: open
    - action: Зафиксировать результат deployment и следующий auth gate
      owner: Codex
      due: 2026-08-21
      evidence_required: health-check, active release SHA, updated passport
      status: open



## Обновление транспорта 2026-08-22

- API GitHub с RU VPS доступен по IPv4: контрольный запрос к `api.github.com/meta` вернул HTTP 200.
- Git HTTPS исходников ранее подтверждён и остаётся рабочим.
- скачивание private release asset через redirect GitHub CDN стабильно завершается `curl 28 / SSL connection timeout`; IPv4 не устранил отказ;
- ошибка происходит до Docker activation, поэтому приложение, база, интеграции, первый владелец и DNS не изменены;
- аварийный маршрут: тот же проверенный bundle exact SHA делится в GitHub Actions на части по 45 MiB, публикуется в отдельной неизменяемой private Git-ветке, скачивается подтверждённым Git HTTPS, проверяется двумя слоями SHA-256, собирается и запускается без build/pull.
- временная стоимость маршрута: около 383 МБ в отдельной transport-ветке приватного репозитория; удаление ветки выполняется только после принятого health-check отдельным действием.

decision:
  decision_id: D-PROD-RU-005
  project_id: ARTHELLO-OS-PRODUCTION-RU
  status: superseded
  question: Как воспроизводимо доставить runtime на RU VPS, если GitHub SSH delivery недоступен, а VPS не устанавливает TLS к официальному npm registry?
  statement: Собирать точный application SHA на GitHub-hosted runner, сохранять API/web/PostgreSQL images и проверенный pull-скрипт как private prerelease assets репозитория, а на RU VPS скачивать их существующим fine-grained token с Contents Read, проверять release target, GitHub digest, SHA-256 и image revision labels и запускать только через docker load и Compose --no-build --pull never.
  context: GitHub HTTPS source fetch на VPS работает. SSH 22/2222/443 delivery не дал рабочей цепочки. DNS registry.npmjs.org работает, но curl -4 с самого VPS завершается SSL connection timeout; Docker build падает на corepack prepare. npm status сообщает Package installation Operational.
  rationale: Убрать npm и build toolchain из production activation, не использовать нидерландский relay, сторонние mirrors и дополнительный package token, сохранить immutable provenance и переиспользовать уже ограниченный repository token.
  evidence:
    - ARTHELLO_HOST_DNS=OK
    - ARTHELLO_HOST_NPM_HTTPS=FAIL:curl_28:http_000:SSL connection timeout
    - successful GitHub HTTPS fetch of f7bb971f362bb8fe3f76209eba01237c602d9946
    - https://status.npmjs.org/
    - https://docs.github.com/en/rest/releases/assets
    - explicit approval by Vitaly, 2026-08-21
  assumptions:
    - GitHub-hosted runner сохраняет доступ к официальному npm registry
    - private release assets остаются доступны RU VPS через api.github.com
    - compressed image bundle не превышает GitHub release asset limit
  approved_by: Виталий Озолин
  approved_at: 2026-08-21
  owner: Виталий Озолин
  deadline: null
  review_at: 2026-11-01
  affected_stages: [RU-03]
  dependencies: [green_exact_head_ci, private_release_publication, existing_contents_read_token, server_health_check]
  supersedes: [D-PROD-RU-004]
  superseded_by: D-PROD-RU-006
  source_links:
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS
    - https://docs.github.com/en/rest/releases/assets
    - https://status.npmjs.org/
  raw_deliberation_ref: ChatGPT project conversation 2026-08-21
  rejected_alternatives:
    - option: Менять Docker DNS
      reason: Ошибка воспроизводится curl с самого host после успешного DNS resolution; Docker DNS не является причиной.
      reopen_condition: Только при новом доказательстве DNS failure.
    - option: Использовать сторонний npm mirror
      reason: Добавляет неутверждённый supply-chain источник в production build.
      reopen_condition: Только после отдельного security review и pinning всех artifacts.
    - option: Использовать private GHCR
      reason: Для server pull потребуется отдельный classic token read:packages; существующий fine-grained Contents Read уже достаточен для private release assets.
      reopen_condition: При переходе на централизованный container registry с отдельным утверждённым credential lifecycle.
    - option: Использовать нидерландский сервер агентов как relay
      reason: Нарушает серверную изоляцию и создаёт общую точку отказа.
      reopen_condition: Только по отдельному архитектурному и юридическому решению.
  actions:
    - action: Создать off-server build PR и получить зелёный CI
      owner: Codex
      due: 2026-08-21
      evidence_required: PR head SHA, successful test and secret-scan
      status: open
    - action: Squash-merge инфраструктуру и опубликовать private image release exact SHA f7bb971f
      owner: Codex
      due: 2026-08-21
      evidence_required: merge SHA, workflow run, release tag, asset digests
      status: open
    - action: Выполнить server pull и проверить health
      owner: Codex и Виталий Озолин
      due: 2026-08-21
      evidence_required: ARTHELLO_HEALTH=OK, active release symlink, compose ps
      status: open
decision:
  decision_id: D-PROD-RU-006
  project_id: ARTHELLO-OS-PRODUCTION-RU
  status: active
  question: Как доставить закрытый runtime на RU VPS, если GitHub release CDN недоступен, но обычный Git HTTPS работает?
  statement: Переиспользовать уже проверенный private release exact application SHA f7bb971f362bb8fe3f76209eba01237c602d9946; в GitHub Actions разделить bundle на Git-safe части по 45 MiB, опубликовать их в отдельной неизменяемой private transport-ветке, на VPS скачать эту ветку существующим Contents Read token, проверить transport SHA-256 и исходный release SHA-256, затем выполнить docker load и Compose --no-build --pull never.
  context: Контрольный IPv4-запрос RU VPS к api.github.com вернул HTTP 200, Git HTTPS source fetch ранее прошёл, но release asset redirect стабильно завершается curl 28 ещё до Docker activation. Повторные ручные попытки не добавляют новой информации.
  rationale: Использовать единственный подтверждённый канал без новых ключей, внешних хранилищ, публичных образов и нидерландского relay, сохраняя exact SHA, boundary manifest и воспроизводимую проверку целостности.
  evidence:
    - api.github.com/meta over IPv4: HTTP 200, 2026-08-22
    - private release asset redirect: repeated curl 28 / SSL connection timeout, 2026-08-22
    - previous successful Git HTTPS fetch of f7bb971f362bb8fe3f76209eba01237c602d9946
    - private release workflow run 32537614123 succeeded
  assumptions:
    - private Git branch push accepts individual chunks below GitHub file-size limit
    - RU VPS continues to fetch ordinary repository objects over HTTPS
  approved_by: Виталий Озолин
  approved_at: 2026-08-22
  owner: Виталий Озолин
  deadline: null
  review_at: 2026-08-23
  affected_stages: [RU-03]
  dependencies: [existing_contents_read_token, verified_private_release, source_git_https, server_health_check]
  supersedes: [D-PROD-RU-005]
  superseded_by: null
  source_links:
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/32537614123
  raw_deliberation_ref: ChatGPT project conversation 2026-08-22
  rejected_alternatives:
    - option: Продолжать повторять release asset download
      reason: IPv4 API доступен, но отдельный CDN route воспроизводимо даёт curl 28; повтор не меняет маршрут.
      reopen_condition: Только после подтверждённого изменения сетевой доступности CDN.
    - option: Создать ещё один package/storage token
      reason: Добавляет новый секрет и ручную настройку, хотя уже есть подтверждённый read-only Git HTTPS.
      reopen_condition: При переходе на постоянный централизованный registry с отдельным credential lifecycle.
    - option: Сделать runtime images публичными
      reason: Нарушает утверждённый закрытый контур исходного приложения.
      reopen_condition: Только после отдельного решения владельца о публикации кода.
    - option: Использовать нидерландский сервер агентов как relay
      reason: Нарушает серверную изоляцию и создаёт общую точку отказа.
      reopen_condition: Только по отдельному архитектурному решению.
  actions:
    - action: Опубликовать transport branch с exact release chunks и двойными checksum gates
      owner: Codex
      due: 2026-08-22
      evidence_required: workflow success, transport branch, transport commit, chunk checksums
      status: in_progress
    - action: Выполнить Git fetch, reassemble, docker load и health-check на RU VPS
      owner: Codex и Виталий Озолин
      due: 2026-08-22
      evidence_required: ARTHELLO_HEALTH=OK, active release SHA, compose ps
      status: open

decision:
  decision_id: D-PROD-RU-007
  project_id: ARTHELLO-OS-PRODUCTION-RU
  status: active
  question: Как исключить любые обращения production API к npm при запуске?
  statement: Удалить Corepack из финальной API-стадии, запускать миграции напрямую встроенным в образ локальным drizzle-kit и принимать runtime-образ только после успешного health-check в Docker-сети без внешнего выхода.
  context: Первый verified Git-chunk deploy полностью доставил и проверил bundle, загрузил Docker images и поднял PostgreSQL, но API перезапускался: Corepack под runtime-пользователем node пытался получить pnpm/latest с registry.npmjs.org и завершался EAI_AGAIN. Это дефект образа, а не сервера или действий владельца.
  rationale: Production runtime должен быть самодостаточным. Package manager и официальный registry допустимы на GitHub build-runner, но не на RU VPS во время запуска.
  evidence:
    - transport fetch 364.88 MiB completed and all transport/release SHA-256 checks passed
    - postgres container became healthy
    - API log: Corepack fetch pnpm/latest -> getaddrinfo EAI_AGAIN registry.npmjs.org
  assumptions:
    - /app/lib/db/node_modules/.bin/drizzle-kit присутствует после frozen pnpm install в build stage
    - внутренний offline Docker smoke-test воспроизводит production read-only/tmpfs режим
  approved_by: Виталий Озолин
  approved_at: 2026-08-22
  owner: Виталий Озолин
  affected_stages: [RU-03]
  dependencies: [green_exact_head_ci, offline_runtime_smoke, immutable_git_transport, server_health_check]
  supersedes: []
  superseded_by: null
  source_links:
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS
  raw_deliberation_ref: ChatGPT project conversation 2026-08-22
  rejected_alternatives:
    - option: Исправлять DNS или разрешать npm на RU VPS
      reason: Production runtime не должен скачивать package manager; это маскирует дефект образа и сохраняет сетевую зависимость.
      reopen_condition: Не применяется к production activation.
    - option: Вручную изменить уже загруженный Docker image
      reason: Теряются immutable provenance, checksum gate и воспроизводимость.
      reopen_condition: Только как отдельно разрешённое аварийное восстановление.
  actions:
    - action: Создать offline-runtime hotfix и обязательный CI-контракт
      owner: Codex
      due: 2026-08-22
      evidence_required: PR diff, green secret-scan and test
      status: in_progress
    - action: Собрать image exact application SHA с runtime infrastructure SHA и проверить без egress
      owner: Codex
      due: 2026-08-22
      evidence_required: offline_runtime_check=passed, image labels, checksums, transport commit
      status: open
    - action: Повторно активировать только исправленный runtime и получить health
      owner: Codex и Виталий Озолин
      due: 2026-08-22
      evidence_required: ARTHELLO_HEALTH=OK, compose ps
      status: open

```

## Дополнение 2026-09-02 — настраиваемая Главная, роли, карточки и Точка

- статус: `approved-for-release`; владелец явно поручил изменения и production-развёртывание, фактическое завершение подтверждается только successful run production workflow;
- release PR/branch: `#310`, `codex/owner-dashboard-tochka-20260902`; одноразовый trigger проверяет именно этот PR и первый attempt точной Verify-проверки;
- решение: D-043 в `DECISIONS.md`;
- область: ролевые и персональные раскладки Главной; единая fail-closed карта навигации и API; ручное происхождение единых карточек без самопроверки; owner-only ввод и AES-GCM хранение JWT Точки на уровне юридического лица/customerCode; построчная классификация смешанных поступлений;
- совместимость: School SSO остаётся отдельным одноразовым PKCE-контуром; медицинские данные требуют отдельного активного допуска;
- данные и секреты: cutover сохраняет существующий D1 volume, выполняет clone-preflight, инвентаризацию и rollback snapshot; readiness до остановки live-контейнера расшифровывает каждый сохранённый банковский credential выбранным runtime master key;
- supply chain: базовый Node image и runtime lock зафиксированы; production скачивает артефакт точного hosted Verify run, сверяет SHA-256 архива, repository/run/head/tree/Dockerfile/lock/evidence и Docker image ID, затем делает `docker load` без повторной сборки;
- доказательство: exact Docker assembly, сборка, lint без ошибок, полный test suite 317/317, runtime owner/employee/RBAC/SSO acceptance, successful hosted Verify и Quality gates, Environment `production-ru`, публичные ArtHello и School health-checks;
- rollback: прежний контейнер и отдельный rollback volume сохраняются; при любой ошибке данные, маршрут Caddy и прежний контейнер восстанавливаются до выдачи success.


## Дополнение 2026-09-03 — чистая Главная без малых знаков вопроса

- статус: `approved-for-release`; владелец явно поручил немедленно убрать непонятные маркеры с Главной и применить исправление в production;
- release PR/branch: `#315`, `codex/clean-dashboard-help-20260903`; одноразовый trigger принимает только этот PR, первый attempt точной Verify-проверки и текущий merged main SHA;
- решение: D-048 в `DECISIONS.md`;
- область: только автоматические малые inline-help маркеры внутри корневой зоны Главной; глобальная кнопка «Помощь», guided tour и формы остальных разделов сохраняются;
- данные и совместимость: миграций и записей в D1 нет; ролевые раскладки, разрешения, интеграции, финансы и School не изменяются;
- приёмка: ноль малых `.ah-field-icon` на Главной в обычном и редактируемом виде; доступна `.ah-launch`; сохранены `data-help-block`-якоря; тестовая политика не подавляет помощь вне явной зоны;
- доказательство до merge: production build, lint без ошибок и полный test suite 319/319 локально; hosted Quality, Proof Gates и Verify на точном head PR;
- rollout: неизменяемый образ точного merged SHA, Environment `production-ru`, clone-preflight, backup-first cutover и публичные health-checks;
- rollback: при любой ошибке workflow возвращает прежний контейнер, volume и маршрут; поскольку схема и данные не меняются, отдельного data rollback для D-048 не требуется.
