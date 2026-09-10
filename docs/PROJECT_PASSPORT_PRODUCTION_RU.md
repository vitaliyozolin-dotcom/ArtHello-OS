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


## Дополнение 2026-09-03 — плотная компоновка Главной и ручной порядок

- статус: `approved-for-release`; владелец явно поручил собирать компактные блоки в одной горизонтали и разрешить ручное перетаскивание;
- этап: refinement персональной Главной; решение D-049 в `DECISIONS.md`;
- release PR/branch: `#316`, `codex/dashboard-clean-drag-layout-20260902`; одноразовый trigger принимает только этот PR, первый attempt точной Verify-проверки и текущий merged main SHA;
- текущий шаг: Codex доводит exact Docker candidate до зелёных Quality/Proof/Verify, затем выполняет защищённый rollout; критерий — успешный workflow и authenticated owner smoke-test «перетащить → сохранить → перезагрузить»;
- область: 12-колоночная dense-сетка, drag handle только в режиме настройки и детерминированная перестановка before/after; стрелки остаются keyboard/mobile fallback;
- данные и совместимость: формат layout v1, D1 schema, роли, разрешения, финансы, интеграции и School не меняются; порядок по-прежнему изолирован по immutable user id и точной роли;
- метрики приёмки: на широком экране до трёх compact-блоков в строке, на средней ширине до двух, на мобильной один; новый порядок переживает reload; ни одна перестановка не теряет visibility/size metadata;
- риски: native drag-and-drop предназначен для desktop, поэтому touch и клавиатура используют сохранённые стрелки; владелец риска и проверки — Codex;
- доказательство до merge: локальные build и lint без ошибок, полный test suite 320/320; далее обязательны hosted Quality, Proof Gates и Verify на точном head PR;
- AI-процессы: не добавляются; новые внешние действия, стоимость AI и автоматические решения отсутствуют;
- rollout/rollback: Environment `production-ru`, immutable image, clone-preflight, backup-first cutover и автоматический возврат прежнего контейнера/маршрута при ошибке;
- следующий переход: после health и owner smoke-test отметить D-049 выполненным и вернуться к следующему утверждённому этапу паспорта без создания новой внешней задачи.

## Дополнение 2026-09-03 — выписки и операции Точки с мобильным скроллом

- статус: `approved-for-release`; владелец потребовал не останавливаться до исправления и production-проверки;
- этап: рабочая интеграция банковского факта; решение D-053 в `DECISIONS.md`;
- release PR/branch: `#320`, `codex/tochka-readonly-sync-20260903`; одноразовый trigger принимает только этот PR, первый attempt точной Verify-проверки и текущий merged main SHA;
- область: независимая прокрутка содержимого окна интеграции; read-only загрузка счетов, остатков, выписок и проведённых операций Точки; отображение банковского снимка и перенос проведённых RUB-операций в финансовый реестр;
- защита: ключ остаётся зашифрованным и не возвращается в UI; разрешены только официальные read endpoints и создание отчёта-выписки; создание, подписание, отправка и отзыв платежей запрещены;
- данные: новые таблицы добавляются миграцией; повторный импорт идемпотентен; ручная классификация финансовой операции сохраняется;
- приёмка: 48/48 целевых тестов, lint и production build локально; далее обязательны hosted Quality/Verify, immutable image, clone-preflight, backup-first cutover и публичный health-check;
- следующий переход: после production health проверить на мобильном устройстве прокрутку до нижних действий, затем подключить ключ и получить реальные счета, выписки и проведённые операции.

## D-054 — собственный скролл вложенного окна Точки

- подтверждение владельца: нижний экран «Настройки» прокручивается, но вложенная форма «Банк Точка» на мобильном остаётся обрезанной; IMG_9985/IMG_9986;
- причина: legacy-правила `.setup-wizard` с `!important` заменяют заданную высоту вложенного окна на `auto`, снимают `max-height` и делают `overflow:visible`;
- решение: вложенное окно ограничено `100dvh`, построено как три grid-строки, центральная часть имеет собственный touch-scroll, заголовок и нижние действия не прокручиваются;
- release PR/branch: `#321`, `codex/d054-tochka-modal-scroll-20260903`; previous production SHA `1038a1960aaf62f57a161d8a16c804161a7f6c53`;
- приёмка: целевой тест 3/3, lint и production build локально; обязательны hosted Quality/Verify, immutable image, clone-preflight, backup-first cutover, rollback и публичный health-check;
- следующий переход: после production health повторно открыть Точку на телефоне и прокрутить именно белую вложенную форму до поля ключа и кнопки «Сохранить параметры».

## D-055 — защищённое TLS-соединение с API Точки

- подтверждение владельца: скролл D-054 работает, ввод ключа и запуск загрузки доступны; IMG_9987 показывает запуск, IMG_9988 — отдельную серверную ошибку «Не удалось связаться с Точкой»;
- причина: официальный `https://enter.tochka.com/uapi` использует российскую TLS-цепочку, а production Node image не содержит её корневой сертификат;
- решение: immutable runtime включает только закреплённый `Russian Trusted Root CA`; сборка и запуск сверяют CA-признак, самоподпись, срок, SHA-256 fingerprint `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31` и PEM SHA-256 `aa800ef345422d6158c6fafe1c06c429dbda21c3df4bb1ccb45a920ec1111399`;
- запрет: TLS verification не отключается; production preflight не получает ключ, Authorization или иные банковские секреты;
- release PR/branch: `#324`, `codex/d055-tochka-tls-20260903`; previous main SHA `c93a066dae1e3cb1cee83b17de6b2624a0f73baa`;
- приёмка: hosted Quality/Verify, активный `NODE_EXTRA_CA_CERTS` внутри точного image, безсекретный 4xx от официального read-only endpoint из production-сети до остановки live, backup-first cutover, rollback и публичный health-check;
- границы: импортируются счета, остатки, выписки и уже проведённые операции; создание, подписание, отправка и отзыв платежей остаются запрещёнными;
- следующий переход: после production health владелец повторно вводит ключ и подтверждает банковский снимок без раскрытия ключа и полных номеров счетов.

## D-056 — X.509-проверка без зависимости от Node на production-host

- факт: D-055 merge `66ca9490d7e765a1338ad0c4ce8cdc2c163c9d36` прошёл main Quality/Proof/Verify; production run `33749916676` fail-closed завершился в checkout-contract с exit code 127 до image import, SSH, Docker и live-мутаций;
- причина: минимальный self-hosted runner не содержит host-команду `node`, а новая ранняя проверка ошибочно зависела от неё;
- решение: host сверяет точный SHA-256 PEM и Dockerfile стандартными утилитами; X.509 и активный trust store проверяются при hosted build и внутри точного immutable container;
- защита от повтора: Verify workflow запрещает host-вызов Node в checkout-contract;
- release PR/branch: `#325`, `codex/d056-tochka-runner-preflight-20260903`; previous main SHA `66ca9490d7e765a1338ad0c4ce8cdc2c163c9d36`;
- данные и доступность: предыдущий run не скачал image и не остановил live; база, маршрут и действующий контейнер остались без изменений;
- приёмка: новый first-attempt Quality/Verify, container-based `ARTHELLO_TOCHKA_TLS_EGRESS=VERIFIED`, backup-first cutover, rollback и публичный health-check;
- следующий переход: после успешного D-056 повторить реальный read-only импорт Точки.

## D-057 — отдельная безсекретная TLS-проверка Точки

- факт: D-056 merge `a48eed30b3a0910c603ff7ad2285a42b3785a507` прошёл main Quality/Proof/Verify; production run `33750926328` подтвердил image evidence, School secret, live D1 и clone health/D1, затем Docker запретил подключать clone из private `none` ко второй сети;
- сохранность: workflow завершил `ARTHELLO_ROLLBACK=VERIFIED` до остановки live, backup и cutover; действующий контейнер, данные и маршрут не изменились;
- решение: stateful clone остаётся `--network none`; отдельный одноразовый контейнер того же immutable image выполняет TLS-проверку в production-сети без data volume, env-file, банковского ключа, Authorization и secret mounts;
- исполнение: контейнер запускается read-only, получает inline-скрипт только через явно подключённый stdin, проверяет закреплённый trust anchor и ожидаемый защищённый 4xx официального read-only endpoint, затем удаляется;
- release PR/branch: `#326`, `codex/d057-tochka-stateless-egress-20260903`; previous main SHA `a48eed30b3a0910c603ff7ad2285a42b3785a507`;
- приёмка: first-attempt hosted Quality/Proof/Verify, `ARTHELLO_TOCHKA_TLS_EGRESS=VERIFIED`, изолированный clone-preflight, backup-first cutover, rollback guards и публичный health-check;
- следующий переход: после production health владелец повторяет реальный read-only импорт счетов, остатков, выписок и проведённых операций Точки.

## D-058 — фактический Node‑транспорт Точки и запрет автозума iOS

- факт: D-057 production run `33752514068` успешно подтвердил TLS в Node‑контейнере, но повторный ввод реального ключа владельцем по-прежнему завершился общей транспортной ошибкой; `IMG_9991`/`IMG_9992` дополнительно фиксируют автоприближение формы после фокуса на 13 px поле ключа;
- причина: банковский `fetch` API-маршрута выполнялся внутри workerd, а `NODE_EXTRA_CA_CERTS` действует на Node; прежний preflight проверял соседний Node‑процесс, но не фактический сетевой путь worker;
- решение: Miniflare получает function-valued `TOCHKA_TRANSPORT`; Node-модуль разрешает только официальный origin и read-only методы клиентов, счетов и выписок, очищает заголовки, ограничивает тело и никогда не допускает API создания/подписания/отправки платежей;
- мобильная форма: поля мастера подключения имеют минимум 16 px на ширине до 720 px, поэтому Safari не включает автозум; pinch zoom и доступность страницы не ограничиваются;
- release PR/branch: `#327`, `codex/d058-tochka-node-bridge-ios-20260903`; previous production SHA `1cdca3fd9cb63f6dd7c8d8ce137e4126b4fc1123`;
- приёмка: зелёные transport/UI тесты, first-attempt exact-SHA Quality/Proof/Verify, production preflight через тот же модуль, изолированный clone, backup-first cutover, rollback guards и публичный health-check;
- следующий переход: владелец повторяет подключение; успешный импорт показывает реальные счета, остатки, выписки и проведённые операции, а банковский 401/403 должен отображаться как конкретная ошибка прав/ключа, не как сбой транспорта.

## D-059 — совместимый worker → Node hop Точки

- подтверждение владельца: D-058 активен, но `IMG_9996(2)`/`IMG_9997(2)` снова показывают загрузку и общую ошибку «Не удалось связаться с Точкой»;
- точная причина: Miniflare/workerd `4.20260515.0` отклоняет `redirect: "error"` до вызова function-valued service binding; Node upstream при этом не вызывается;
- решение: только внутренний hop получает поддерживаемый `redirect: "manual"`; Node-мост сохраняет внешний `redirect: "error"`, строгий origin/path/method allowlist и удаление лишних заголовков;
- надёжность: ответ банка полностью читается внутри 45-секундного abort-контроля и ограничивается 2 000 000 байт; stalled/oversized body возвращает безопасную ошибку без ключа;
- OAuth: не используется как обход, потому что token exchange и API-вызовы зависят от того же транспорта; пересмотр возможен для сторонних клиентов после регистрации приложения и получения `client_id/client_secret`;
- release PR/branch: `#328`, `codex/d059-tochka-binding-redirect-20260903`; previous production SHA `7e926f4c29aa7e3c3208a55451db035714861e28`;
- приёмка: 8/8 целевых transport/service-binding тестов, включая потоковый JSON и HTTP 204; first-attempt exact-SHA Quality/Proof/Verify, production Node TLS egress, изолированный clone, backup-first cutover, rollback guards и публичный health-check;
- следующий переход: владелец повторно сохраняет тот же JWT; результатом являются реальные компании/счета/выписки либо конкретная банковская ошибка ключа/прав, но не общий transport failure.



## D-074 — Серверная браузерная проверка: сначала подтверждение готовности окружения

- Дата: 2026-09-08. Статус решения: `approved`; текущая реализация: `active`, только prerequisite inventory.
- Подтверждение: Виталий ответил «Тогда действуй» после предложения серверной браузерной проверки через существующий self-hosted runner, изолированное окружение и отдельную тестовую учётную запись.
- Основание: cloud-browser возвращает 502 до формы входа; прежняя попытка R7 не прошла natural SSO gate. Это не доказательство отказа публичного приложения. Main перед работой: `76acc804467031dad6544c3bbfd8f0c16c930159`.
- Исполнитель: Codex; владелец решения и доступов: Виталий. Следующий шаг: получить фактический обезличенный inventory на `arthello-gateway`, затем подготовить недостающие строго выделенные ресурсы. Срок — текущая рабочая итерация; при недоступном доступе немедленно сообщить блокер.
- Область: `.github/workflows/check-arthello-server-e2e.yml`, `scripts/server-e2e-preflight.mjs`, независимые поведенческие тесты и инструкция `docs/acceptance/server-browser-prerequisites.md`. Никакой существующий consumer/replay guard не изменяется.
- Разрешено: read-only проверка фиксированных HTTPS origins без аутентификации/редиректов; наличие специально выделенных Environment inputs; inspect точного заранее загруженного browser image. Secrets не возвращаются и не копируются из production.
- Запрещено этим этапом: host npm/apt/build, запуск браузера рядом с production без изоляции, чтение паролей/ключей сотрудников или БД, создание учёток обходом управления доступами, изменение сети/прав/данных, TLS bypass, платежи, широкие импорты, запись ложного SSO evidence, автоматический деплой.
- Обязательная приёмка: негативные missing/invalid credentials, mutable image, root/foreign image, неправильный source, TLS bypass, сеть/ошибки и отсутствие утечек; проверенный main-only запуск, shared locks, нет PR execution на production runner. Оба возможных статуса inventory сохраняют `liveAcceptance=not_run`.
- Неизвестно до фактического запуска: наличие browser image и тестовой учётки; доступность origins с runner. Полный browser bundle, аккаунт, шесть сценариев и выпуск не считаются подготовленными или завершёнными.
- Зависимости: успешный exact-main Quality, защищённый `production-ru`, существующий runner/Docker read authority. Изменения других разработчиков сохраняются.
- Критерий завершения всего исходного поручения неизменён: настоящая навигация в дневник, проверенные Точка/ДДС, доступы сотрудников, обращения, выборочный AlfaCRM и ручные/автоматические бэкапы на опубликованном кандидате.
- `supersedes`: нет; D-073, fresh identity-bound browser receipt, backup/public-write gates сохраняются. Это новый разрешённый путь проверки, не ослабление приёмки.
- Контракт AI-процесса: вход — утверждённый scope, exact main и специально настроенные тестовые inputs; результат — минимальный отчёт prerequisite с доказательствами/блокерами; ответственный — Виталий; стоимость — минуты собственного сервера, без покупки VM и без Actions artifact upload; метрика пользы — конкретные устранённые блокеры без повторных неинформативных деплоев; остановка — нет нужных полномочий/доступов или противоречие защитам; отказ — «останови серверные проверки», дальнейшие проверки прекращаются, рабочая система и история сохраняются, новые данные не обрабатываются.
- Дата пересмотра: после первого фактического inventory или изменения main/доступов. После успешного inventory следующий этап ещё требует изолированного bundle и live proof, не автоматического PASS.
- Проверка исполнения D-074: начальный PR #363 Quality `34249055524` прошёл, но Proof `34249055516` поймал гонку фиксированного DOM-замера: desktop `ROOT_NOT_RENDERED`, при этом screenshot уже содержит форму входа и mobile проходит. Harness дополнен ожиданием complete document + rendered root с отказом по timeout; семь TDD-тестов включены в `test:full`. Канон и все визуальные критерии сохранены, новое продуктовое поведение не вводится. Эти локальные/CI доказательства не являются проверкой production SSO.

## D-075 — Разрешённое наблюдение production-данных

- Дата: 2026-09-08; approved_by: Виталий; status: active. Источник — ответ «Разрешаю» на отдельный запрос read-only проверки банковского реестра, прав, обращений, импорта и бэкапов через существующий служебный доступ, без изменения данных, извлечения паролей и выгрузки персональных записей.
- supersedes: нет. D-074 остаётся историей prerequisite-проверки; D-075 разрешает отдельный необходимый доступ к агрегатам D1. Ворота выпуска и отказ от root/новых полномочий не меняются.
- Цель текущего шага: получить датированные обезличенные наблюдения фактически работающей версии и отличить неустановленную схему от пустой или повреждённых связей. Исполнитель Codex, ответственный Виталий; срок текущая рабочая итерация, пересмотр после первого запуска или изменения источника.
- Вход: доверенный exact-main, успешный Quality, существующий protected production-ru runner/Docker, канонический data volume и подтверждённые live file descriptors. Автозапуск ограничен первым attempt Quality push-main с отдельным D075 commit prefix; обычные последующие изменения не запускают чтение данных. PR/fork-код на сервере не выполняется.
- Разрешено: inspect минимальных metadata, ограниченные SELECT/count и ссылочные проверки на сервере; временный UID1000 helper из уже работающего immutable image с network:none, RO rootfs, RO data volume, no-copy, cap-drop, no-new-privileges и лимитами. Удаляется только собственный временный helper, не volume или приложение.
- Запрещено: чтение credential/state values, паролей, ключей, контактов, тел обращений; полный снимок/экспорт; SQL writes, запуск импортов/синхронизации/платежей, создание/восстановление бэкапов, смена прав/сети/маршрутов, установки/сборки на VPS, ложный PASS или SSO receipt.
- Приёмка: тесты отсутствующей/пустой схемы, нарушенных связей, ограничения объёма, запрета SQL writes и невывода private fixtures; review trusted trigger/locks/CODEOWNERS; реальный job с source/image/time и безопасным результатом. Ошибка SQLite/прав/identity даёт блокер без сырых исключений. 10000 строк на таблицу — предел полной ссылочной проверки; превышение не считается успехом. Общий deadline60 секунд ограничивает чтение.
- Ограничения результата: агрегаты и связи не доказывают корректность прав API/UI, полноту выписок банка или работу выбора этапов AlfaCRM. Backup-control mount не доказывает историю/расписание/restore. Эти пункты остаются непроверенными до собственных доказательств. Owner Education→дневник в нескольких браузерах подтверждён сообщениями владельца, но не подменяет машинный release receipt.
- AI-контракт: результат — минимальный журнал наблюдений и конкретные блокеры; стоимость — короткий запуск существующего сервера, без покупки инфраструктуры; метрика — выявленные реальные причины без утечек/изменений; автоостановка — несовпадение identity, отсутствие доступа, deadline или конфликт с защитами. Отказ «останови проверку» прекращает новые чтения; рабочие функции и история сохраняются, новые данные не обрабатываются.
- Следующий переход: по фактическому probe выбрать точную дальнейшую проверку; при отсутствующей новой схеме не выдавать это за неисправность исправленного кандидата или завершённый деплой. Публикация приложения не является действием этого диагностического workflow.

## D-076 — Выделенный browser bundle и естественный вход сотрудника

- Дата: 2026-09-08; approved_by: Виталий; status: active; supersedes: нет. Источник: ранее «Тогда действуй», «Выполняй», «Разрешаю» и теперь «готово» в ответ на подготовку отдельной учётки с Education/School и двух защищённых секретов. Это разрешает техническую подготовку и реальный ограниченный вход, не получение чужих паролей.
- Цель и результат: datestamped natural login → Education click → diary с совпадением тестового сотрудника, фактами по разрешённой навигации и одному запрещённому API. Ответственный Виталий, исполнитель Codex; срок текущая рабочая итерация; пересмотр после первого запуска/смены candidate. Общая задача завершается после проверки остальных сценариев и защищённого production-выпуска, не после одного login test.
- Входы: exact source, успешный hosted Quality push-main с отдельным D076 prefix либо owner dispatch main; отдельно проверенный hosted browser image и fixture; production-ru; два явно предоставленных секрета. До выполнения repository code на gateway сверяется current-main; PR/fork получает только hosted builder без Environment/secrets. Shared gateway/School locks сохраняются.
- Образ: Playwright1.62.1, base image pinned digest, pnpm lock с registry integrity; сборка, установка пакета и Chromium smoke только на hosted runner. На VPS только import проверенного архива, проверка portable runtime fingerprint и запуск точного local image ID. UID1000, RO rootfs, private tmpfs, bounded CPU/RAM/PIDs, no-new-privileges, cap-drop, seccomp и включённый Chromium sandbox с реальной проверкой chrome://sandbox. Нет privileged/SYS_ADMIN, host IPC, bind mounts, Docker socket, production DB/secret volumes или host установок. Ошибка sandbox останавливает вход до передачи credentials браузеру.
- Разрешённые действия: одна попытка ввода выделенного login/password в UI, проверка non-owner/permanent password/explicit Education grant, UI Education→дневник, чтение обычных ответов страницы в памяти для сравнения identity и статусов; штатные auth/session/SSO writes разрешены самим входом. Запрещены изменение ролей/пароля, ручное создание session/callback, импорт/платёж, перенос production secrets, traces/screenshots/page dumps. Credentials передаются stdin, не в Docker env/argv или artifact. Логи только фиксированные stage/status/booleans; callbacks и body не публикуются.
- Приёмка: node:test негативные границы; реальный hosted Chromium sandbox+natural-flow fixture (включая отказ owner); защищённый live запуск. Synthetic fixture всегда liveAcceptance=not_run. Реальный pass не подменяет exact identity-bound schema3 release receipt: source/School repair freshness связываются отдельно в release controller. При смене источника/отказе входа/чужой identity/sandbox/deadline — fail closed; повторный подбор пароля запрещён.
- Цена и метрика: одна сборка CI и короткий ограниченный browser run на имеющейся инфраструктуре; без покупки нового сервера. Владелец может остановить дальнейшие запуски; уже принятые продуктовые функции и его сеанс сохраняются. Cleanup удаляет только invocation browser и его скачанный архив, без приложения и volumes. При успехе следующий шаг — свежая release provenance и существующие clone/backup/public-write проверки.

## D-078 — R8: браузер и выпуск одного кандидата

- Статус preparation; дата2026-09-08; владелец Виталий, исполнитель Codex. Техническое продолжение уже разрешённого выпуска. Параллельный D-077 о доступе к БД сохраняется без изменений.
- Контекст: R7 завершился до cutover. D076 доказал работу immutable full-Chromium bundle/namespace sandbox и настоящих HTTPS303 fixtures; protected login пока не состоялся. Второй D076 run34278442727 остановлен до checkout из-за продвижения main. Поэтому новый R8 выполняет browser build/import/настоящую приёмку внутри одного exact candidate workflow.
- Входы: PR370, codex/school-arthello-recovery-r8-20260908, новый merge SHA с текущим main-parent; успешные exact Quality/Proof/v52 Verify/provenance до production checkout; owner-only trusted Verify completion с D078 release prefix; production-ru и оба shared locks; проверенные R5 installation и pre-cutover R6/R7 aborts. Старые controllers неизменны.
- Браузер: тот же D076 hosted bundle и fixture, без production Environment у builder; archive checksum, measured sizes и portable fingerprint передаются outputs того же producing job. Protected job проверяет current source, реальное место в workspace/Docker storage и immutable identity. На VPS нет сборки/установок. Credentials идут только stdin в sandboxed UID1000 browser без application mounts; TLS/network/no-injection ограничения сохраняются.
- Приёмка: настоящий pre-browser до release-image import и cutover; настоящий post-browser после public activation. School diagnostic/verified repair receipt и live ArtHello labels связываются с фактическим browser result через прежний schema3 validator, включая freshness45 минут, время после repair, role/contact matching, exact steps и no injected session/constructed callback. После cutover live ArtHello SHA равен R8 candidate.
- Сохраняется весь R7 cutover step: canonical D1/FD proof; portable immutable runtime; clone preflight; проверенный ordinary-UID backup до live stop; отдельные backup/control volumes; isolated UID1002 activation writer; current-main/School-secret checks и durable public-write boundary. Нет host root/sudo, новых payments, изменений School routes/volumes или автоматического restore поверх принятых публичных записей.
- Отказ: неподтверждённый source/receipt/sandbox/login, нехватка места, активный или неоднозначный прежний cutover — fail closed. Post-browser failure сохраняет candidate/current DB/rollback volumes и записи пользователей для recovery, без snapshot rollback.
- Проверки: hosted сравнение полного cutover и всех сохранённых R7 шагов, точное сравнение с D076 builder/import, негативные replay/receipt tests, полный exact image build/application tests и Docker backup/restore fixtures, завершённое exact-head review, реальные pre/post browser и backup/activation evidence. Source tests и один login не означают завершённую сверку банка или всех пользовательских сценариев.
- AI-контракт: используются существующие CI/runner, без покупки инфраструктуры; метрика — опубликованный проверенный кандидат с сохранёнными данными и доказательствами сценариев. Стоп владельца прекращает новые запуски; после public activation сохраняется восстановимое состояние. Реальный resource blocker описывается измерениями и конкретным требуемым действием владельца.

### D-078 — Проверка полноты предыдущей попытки, продолжение 2026-09-09

- При продолжении выпуска PR370 обнаружено незакрытое замечание3962431559 на head ae47f9e5922cbd9b6cd9296253b6cf29fd2fe8fc: subset-проверка принимала пустой либо неполный набор заданий. Это дефект реализации существующего fail-closed решения, новых полномочий не требуется.
- Guard и его встроенная копия теперь требуют ровно два разных задания: bundle и deploy. Пустой ответ, только bundle и только deploy отклоняются. Существующие проверки попытки, hosted runner, завершённости и отсутствия начавшегося cutover сохранены.
- Локальные доказательства: три отрицательных случая воспроизвели дефект до исправления; после исправления6 replay-тестов и5 receipt-тестов проходят. Встроенный Python совпадает с исходником; YAML и синтаксис18 shell-шагов проверены. Ruby contract локально не запущен: runtime отсутствует; обязательный hosted v52 gate остаётся необходимым.
- Новый head требует свежих Quality/Proof/v52 и независимого ревью. Реальный вход и production cutover ещё не выполнены и не объявляются PASS. После зелёных ворот продолжается ранее разрешённый R8 с настоящей приёмкой до и после переключения.

### D-078 — Изоляция browser artifact при повторе задания

- GitHub review840a1d1 завершилось с замечанием3962528705: повтор всех jobs использовал прежнее имя immutable artifact и мог остановиться при upload.
- В canonical D076 и R8 имя теперь содержит source SHA, run ID и producing run attempt; оно передаётся download через output успешного bundle вместе с checksum/fingerprint. Повтор только failed deploy использует имя прежнего успешного producer, повтор всех jobs получает новое имя. Overwrite и переименование старых artifacts не используются.
- Локально выполнена фактическая shell-команда producer для двух попыток: имена различаются; оба workflow читаются как YAML, синтаксис shell проверен. Независимая проверка подхода подтвердила семантику полного и частичного повторов. Свежие hosted gates и точное ревью изменённого head обязательны; production ещё не переключалась.


### D-076 — Уточнение причины фактического отказа сотрудника

- R8 PR370 merged5385090d48f4dae29c314dff7ae974d854560940/tree26442edcc4db1300a4fffc65aa7d3d9c8f536dca прошёл exact main Quality34283145338/Proof34283145353/v52 Verify34283145339. Actual R8 run34283447507: hosted bundle102253627289 SUCCESS; protected job102254222317 остановился до release-image import, backup и cutover.
- Факт на2026-09-08T22:03:45.451Z: браузер запущен; namespaces, PID/network namespaces и seccomp подтверждены. Natural flow вернул blocked/employee_access/liveAcceptance:not_passed. Рабочая ArtHello версия6596f69390ad539577ec2640e8ef40c7e12c22dc не переключалась. Вывода о неверном пароле, сломанном SSO либо конкретных правах по этому общему этапу сделать нельзя.
- Независимое чтение exact live source подтвердило соответствие формата login response, сериализации признаков сотрудника, скрытия навигации и403 для неназначенного раздела. Повторная проверка доступного cloud browser вернула502/Connection refused до формы входа; она не используется как доказательство отказа сайта с gateway.
- Исправление диагностического отчёта: только фиксированные коды разрешённых причин и общий безопасный fallback. Сырые ошибки, stack, URL, credentials, содержимое ответа и личные данные не выводятся. Все existing acceptance assertions, sandbox, TLS/network constraints, protected secrets и current-main guards сохраняются. Изменения продукта, прав, пароля и БД этим шагом не разрешаются.
- Следующий переход: после целевых тестов, independent exact-head review и hosted gates один диагностический запуск существующего canonical D076 на новом exact-main с теми же выделенными секретами. Повторный подбор пароля запрещён. До точного результата новый guarded release не запускается; старый R8 не переобозначается и не ослабляется при продвижении main. Реальная приёмка исходных шести сценариев остаётся незавершённой.


## D-079 — Завершение жизненного цикла собственных browser images

- Статус preparation; supersedes: только прежнее общее исключение удаления browser images дополнено двумя ограниченными lifecycle targets: закреплённый старый образ и проверенный образ текущего canonical D076 invocation; D076 invocation cleanup, ограничения ёмкости, R8 и прочие release gates сохраняются. Владелец Виталий, исполнитель Codex; срок текущая рабочая итерация, пересмотр после результата. Основание — действующее поручение подготовить изолированный тест и продолжить выпуск; независимая проверка инструкций не обнаружила требования нового согласования удаления собственного воспроизводимого неиспользуемого тестового артефакта.
- Диагностическое исправление PR372 mergedb52a5326f650060036d7ccd66a87e8d2d6a5a292/tree0ceba43370fe7f3ae13dba88bc8e93bd2c7cdbc4. Exact PR Quality34284646805/Proof34284646784/browser34284646892 SUCCESS, independent review PASS,13/13 tests. Exact main Quality34284937475 SUCCESS.
- D076 actual run34285119759: hosted bundle102258868125 SUCCESS; protected job102259393169 на2026-09-08T22:19:37Z остановился до archive download и до login. Доступно6005696KiB, требуется7995036KiB, дефицит1989340KiB. Причина предыдущего employee_access пока не установлена; новая попытка не использовала пароль.
- Новый отдельный lifecycle step ограничен ID sha256:0763e7e6404c4ecf19b81bdcc236dd815a0210e9bb6b087adec279692cc7701c/source5385090d48f4dae29c314dff7ae974d854560940/fingerprint5970abba2518f5fc1f3bb27ef2624570e8050cbc606a3cb300f596031c26564e. Требуются единственный ожидаемый tag, e2e-browser, UID1000:1000, отсутствие consumers включая stopped, fresh current-main и повтор identity; единственная мутация docker image rm --no-prune exactID без force. Ошибки/чужая identity/используемый image дают fixed blocker без удаления.
- Восстановимость: R8 artifact10078598718, server-browser-5385090d48f4dae29c314dff7ae974d854560940-34283447507-1,640791883bytes,digestsha256:e7a77316e647ba17a8e232d1b060d2c02f73ef2cfbdfe769b99cc01e841fc140,expired:false,expires2026-09-10T22:00:54Z подтверждены API при подготовке. Перед удалением проверяются срок и закреплённые metadata. После удаления обычный gate вновь измеряет место; размер image не выдаётся за реально освобождённое место.
- Отдельный финальный always-step canonical D076 удаляет только проверенный образ текущего запуска: BROWSER_IMAGE_ID должен появиться после всех успешных import/identity assertions, source и fingerprint/archive name берутся из того же producing job, retained artifact не истёк; повторяются проверки tag/UID/role/consumers/current-main. Без verified output удаления и tag fallback нет. Ошибки cleanup не маскируются. Original archive cleanup неизменён; этот шаг не переносится между pre/post browser release-приёмками.
- Запрещены общий prune, иные images, application/backup/container/volume deletion, host sudo/privileges, уменьшение capacity/headroom, чужие credentials и подмена нового образа старым. Это явное исключение только для закреплённого старого и подтверждённого текущего собственного артефакта, не общее разрешение на обслуживание сервера.
- AI-контракт: вход exact reviewed source и минимальные metadata; результат один фиксированный lifecycle status и фактическая ёмкость, без личных данных; стоимость существующие CI/runner, без покупки инфраструктуры; метрика восстановленный ограниченный браузерный тест. При отказе владельца новые действия прекращаются; при неподтверждённых prerequisites — fail closed. Далее один D076 natural login, затем новый guarded release только после устранения фактического препятствия. Исходные шесть сценариев пока не приняты.


### D-074/D-079 — Наблюдение точной причины identity-отказа

- D079 PR373 merged0e377967dca2e377d1aace256aee6e0e589e4b3f/tree70f6b838ed32eb39ad21f89a72b3727a2485a768; независимое exact-head review PASS,19/19 tests. Exact PR Quality34286291872/Proof34286291776/v52 Verify34286291853/browser34286291842 и main Quality34286695842/Proof34286695820/v52 Verify34286695719 SUCCESS.
- Actual D076 run34286867814: bundle102264427340 SUCCESS; protected job102264928497 на2026-09-08T22:40:18.9579072Z остановился с retirement_image_identity_failed. Ни удаления image, ни нового скачивания/import, ни login этой попыткой не выполнено. Это подтверждённый блокер сопоставления metadata; его конкретное поле пока неизвестно.
- Следующий технический шаг в рамках read-only D074: дополнительная проекция только закреплённого R8 browser image в существующем server-e2e-preflight. Фиксированные признаки ID/source/role/UID/tag, представление и число RepoDigests, разрешённые digest refs собственного arthello-e2e, результат fingerprint. Никакого raw inspect/Env, исключений, контактов, секретов, содержимого приложения или private rows. Исполнение Docker ограничено чтением metadata одного target; без запуска/удаления образов и без входа.
- Исходный D074 prerequisite verdict/exit code/triggers/locks/protected Environment сохраняются; дополнительное наблюдение не объявляет готовую учётку, не ослабляет D079 и не выдаёт live acceptance. Workflow и browser bundle не меняются. Prefix D074 для этого наблюдения не активирует canonical D076, поэтому новая сборка Chromium и удаление не запускаются.
- Представление RepoDigests различается в официальных Docker backends, но это ещё не доказательство фактического значения на gateway. После наблюдения выбрать только исправление подтверждённого несовпадения с сохранением identity/ownership/no-consumer/current-main/capacity guards. Ответственный Виталий, исполнитель Codex; срок текущая итерация, пересмотр по фактическому результату.


### D-079 — Подтверждённая self-reference Docker

- PR374 merged5e10f93d94efaca906235da88ae9b34f6cb0ae64/treea7fcb9357128fdc458897432648efc31015827f3 после независимого exact-head review PASS и PR Quality34287685397/Proof34287685494 SUCCESS; main Quality34287857986 SUCCESS. Все workflows сохранены; canonical D076 был skipped, как предусмотрено prefix D074.
- Фактическое наблюдение run34288036300/job102268045952 на2026-09-08T22:52:49.703Z: ID/source/role/UID/OS/architecture/entrypoint, единственный ожидаемый tag, tag binding и portable fingerprint совпали. RepoDigests — массив из одной строки arthello-e2e@sha256:0763e7e6404c4ecf19b81bdcc236dd815a0210e9bb6b087adec279692cc7701c; чужих ссылок нет. Оба сайта ответили200. Login и production mutations не выполнялись.
- Исходный D074 verdict остаётся blocked из-за его исторических inventory/confirmation variables; это не отрицательный результат входа и не повод выдумывать значения. Supplemental metadata evidence получено независимо от этого verdict. Причина D079 identity-отказа теперь доказана: прежняя проверка требовала пустой RepoDigests.
- Исправление ограничено представлением одной служебной ссылки на тот же проверяемый ID: пустой массив либо ровно arthello-e2e@<полный target ID>. Null, другая repository/digest или несколько ссылок запрещены. Workflow, два класса targets D079, artifact recovery, повтор identity/current-main/no-consumer, non-force removal и capacity/headroom сохраняются. Далее один canonical D076 с актуальным source, фактической ёмкостью и безопасным reason результата входа. До успешного результата live acceptance и исходные шесть сценариев не приняты.

### D-076 — Постоянный пароль принят; диагностика этапа «Обучение»

- Актуально на2026-09-09. Владелец Виталий, исполнитель Codex; действующее поручение проверить все заявленные функции и выпустить в production сохраняется. Пользователь сообщил: «задал постоянный пароль и обновил его на гитхаб». Секреты не извлекались и в отчёт не передавались.
- PR375 merged6fb6f2f2d5542e547f815149e604a0caa3cb278d/tree7a6f521d083b65a45b65b48270845a15ed58ca1c. Exact PR Quality34288250248/Proof34288250344/v52 Verify34288250243/browser34288250261 SUCCESS, независимое exact-head review PASS; main Quality34288616959/v52 Verify34288616988 SUCCESS. Первый protected run34288771634/job102270907815 на2026-09-08T23:06:46.920Z прошёл retirement/capacity/import/sandbox, но потребовал permanent_password_required; старый и текущий тестовые образы штатно удалены.
- После сообщения пользователя повторён только failed job того же run34288771634, attempt2; current main и неистёкший artifact10080563781 проверены до retry. Producing archive server-browser-6fb6f2f2d5542e547f815149e604a0caa3cb278d-34288771634-1 использован повторно без новой сборки. Protected job102346026249 на2026-09-09T05:14:03.398Z прошёл login200, non-owner employee, permanent-password, education grant/nav и одну проверку скрытого неназначенного раздела с фактическим API403. Chromium namespaces/PID/network/seccomp подтверждены. Остановился на stage education с browser_check_failed; liveAcceptance:not_passed. Старый образ подтвердился absent, текущий verified image retired; cleanup успешен. Application cutover не начинался.
- Независимое чтение exact deployed source6596f69390ad539577ec2640e8ef40c7e12c22dc подтвердило правильность locator, текста «Открыть дневник» и GET /api/education при mount. Initial home и отсутствие prefetch не объясняют отказ. Обнаружено несоответствие в коде: outer policy допускает назначенный education read, но bundled educationScope не распознаёт EMPLOYEE/ADMIN/DEPUTY. HTTP status и apiRole фактического теста пока неизвестны; найденное несоответствие не объявляется доказанной причиной этого отказа.
- Следующий шаг: только фиксированные безопасные reason-коды для education, diary_navigation и school_identity, различающие отсутствие ответа/клика, HTTP-отказ, отсутствие кнопки, ошибку JSON/identity/цепочки/навигации. Сырые exception, URL, ответы, роли/контакты, секреты и содержимое дневника не выводятся. Все прежние locator, критерии API200/403, natural flow, network/TLS/sandbox, account и cleanup/capacity gates сохраняются. Новые права учётке и обход проверок не разрешаются.
- R9 подготовлен как неоперационный черновик в branch codex/school-arthello-recovery-r9-20260909, commitb6cd836a77f6f9328b66dc4a7efa970d4576d68d/tree619c00fe5b027ebafc57e5564403188a128874f0. PR0 намеренно блокирует activation; replay19/19 и receipts5/5 локально прошли, Ruby contract ещё не выполнялся. Черновик не слит, не запускается и не доказывает готовность выпуска. После диагностики нужны актуальная parent/PR identity, новый D-номер (D080 свободен на6fb6f2), independent review, full gates и собственная свежая pre/post приёмка.
- AI-контракт: вход exact source, существующий protected test и обезличенные статусы; выход подтверждённая причина следующего отказа либо PASS; разрешены подготовка/проверка кода и существующий ограниченный browser test; запрещены новые credentials, сброс password flag, session injection, ослабление прав/приёмки и production cutover без его ворот. Ресурс — настроенные CI и gateway, фактическая стоимость по тарифу аккаунта не известна; новые услуги не подключаются. Метрика — устранение проверенного блокера. Срок текущая итерация, пересмотр по live результату. При отказе Виталия новые запуски прекращаются; рабочий продукт сохраняется. Исходные бизнес-сценарии остаются непринятыми.

### D-081 — Подтверждённый Education403 и подготовка проверки кандидата

- Владелец Виталий; исполнитель Codex; status: preparation. Исходная цель и разрешение на проверку/выпуск сохраняются. Постоянный пароль исправен; новых паролей или смены роли не требуется.
- PR376 merged582edaf1a66a953edb2d61e03040d1a13e70a0ad/treeb89d892b0795f06956ffb6408d65b554fd92c711; main Quality34314636888 SUCCESS. D076 run34314770145: hosted job102348573223 SUCCESS; protected102348936617 на2026-09-09T05:29:05.827Z — blocked/education/education_forbidden, liveAcceptance:not_passed. Образ удалён штатно; application cutover не выполнялся. Конкретная роль не наблюдалась.
- Независимая проверка подтвердила: текущий main уже содержит исправление explicit-grant/branch-scoped Education, включённое через PR354 из PR348;29 профильных тестов прошли. Ограничения TEACHER/PARENT, отсутствие филиалов и фильтрация словаря имён сохранены. Исправлять это повторно или менять роль теста ради зелёного результата не требуется.
- Первоначальный R9 без изменения порядка не мог доставить это исправление: он требовал полного PASS старого приложения. D081 открыто меняет порядок, сохраняя FAIL baseline и требуя полного естественного прохода того же сотрудника на точном кандидате до открытия обычных запросов. Описание протокола и границ восстановления — DECISIONS D081. Окно обслуживания ещё не включалось.
- Первый подготовительный PR377/headac27f30653c5349c2239e9057abacd20204bbfb1/tree5110fac9e0144cb8085ea8bfbf81beb161f56b4d: Quality34316573308 и Proof34316573233 SUCCESS; browser34316573255/job102353942711 SUCCESS. Настоящий Chromium namespace sandbox на2026-09-09T05:52:24.046Z прошёл normal/maintenance HTTPS303-сценарии со штатными ArtHello/School cookies, отсутствием ключа на School и запретом повторного login/business POST. Это hosted fixture, liveAcceptance:not_run. v52 run34316573242 остановился на намеренно незаданной release PR identity0; полный выпуск не прошёл.
- State helper после независимых замечаний связывает receipt с maintenance/container/context, отвергает прежний receipt, защищает public state от конкурентной перезаписи, проверяет приватные файлы и полную неизменную School repair receipt.16 локальных тестов и независимый review PASS; дополнительно12 multiprocessing проверок. Browser27 тестов,6 stdin cases и независимый source review PASS; maintenance8 тестов PASS. Реальный Caddy fixture должен выполнить118 HTTP проверок, а затем проверяться также на установленном шлюзовом бинарнике.
- Независимое review продолжения обнаружило два блокера до активации: RUNNER_TEMP очищается GitHub между заданиями; исходная проверка candidate runtime допускала лишние mounts/сети. Исправление переносит recovery evidence в private durable каталог и требует точный runtime contract и полный сценарий verify после очистки временных файлов. До завершения этих работ и review PR остаётся подготовкой, а не готовым выпуском.
- AI-контракт: вход — exact GitHub source/CI, защищённая тестовая учётка, текущие обезличенные статусы; выход — проверенный опубликованный кандидат и реальные результаты исходных сценариев. Разрешены подготовка кода, CI, изолированные fixtures и ранее одобренный защищённый выпуск. Запрещены вывод credentials/SSO-кодов/дневника, session injection, смена ролей ради проверки, fake PASS, платежи, общий prune и snapshot restore после реальной авторизации/public boundary. Ответственный человек Виталий. Ресурс — существующие runner/CI, новые услуги не подключаются; фактическая стоимость по тарифу не известна. Метрика — проход того же сотрудника на кандидате и рабочие бизнес-сценарии. Автоостановка — несовпадение identity/state/данных/прав, провал gate или неизвестный исход. При отказе Виталия новые действия прекращаются; сохранённые данные не стираются, исходное приложение до cutover продолжает работу. Срок — текущая итерация, следующий пересмотр по результатам конкретных fixtures и независимого review.

- Уточнение подготовки после review: recovery work и копия исходной School repair receipt перенесены в private durable каталог release-state/candidate-work вне RUNNER_TEMP. Проверены сохранение после очистки temporary directory, exact mounts/networks/env, попытки2/3 с настоящим public audit, повтор полной проверки runtime до браузера и перед public boundary; route-only repair допускает только reload уже сохранённого точного maintenance config. Итоговый локальный набор89 тестов PASS, сохранён полный R8 cutover после явной D081-нормализации; Ruby contract требует hosted выполнения. Контроллер зафиксирован blob a7a691a9bb8f92a64cfee0b56ea05b9973c2b366, contract910ff64b319cc0a03505bbf450fa087417983e2c.
- Hosted Caddy на PR377/head9a7a7e5fbe4d178983e6a1f2cd7d98eeca35f0d6: run34317164701/job102355696447 SUCCESS,118 HTTP проверок и access-log redaction PASS. В окончательный fixture дополнительно включена проверка Cache-Control:no-store на каждом503; требуется новый exact-head hosted PASS. Эти результаты не объявляют приложение опубликованным.

Уточнение идентичности 2026-09-09: пока кандидат PR377 проходил проверки, main обновился с 582edaf1a66a953edb2d61e03040d1a13e70a0ad до 59372b139fb0b2345cf3e41fc23c8223099b187f (checked PostgreSQL migrations), заняв D-080. Решению этого выпуска присвоен следующий свободный номер D-081. Технические имена файлов d080-*, схемы и маркеры ARTHELLO_D080 сохранены как неизменённые идентификаторы проверенного протокола; они относятся к D-081 и не запускают миграции PostgreSQL. Префикс активации нового выпуска — D081: guarded R9. Все изменения другого участника сохранены; R9 собирает отдельный v52 runtime с D1 и не выполняет deploy/api-entrypoint.sh или SQL0018.


### D-083 — Фактический отказ маршрута до авторизации и диагностика

- D081/PR377 выпущен только в Git: main30f825d674cbf498be713c7b637e1dfd9f9c42cd/treebf1c67e32ea329546ce8870a4c3589f9b2c6a16d. Все main gates SUCCESS. R9 run34318973875/job102361578781 остановился в route render на2026-09-09T06:29:38Z до clone/auth/cutover; rollback VERIFIED. Caddy target fixture118 PASS. Application live остаётся6596f69390ad539577ec2640e8ef40c7e12c22dc. Успешного candidate/browser/business acceptance нет.
- Старое сообщение только blocked не различает условия. D083 добавляет отдельный read-only wrapper frozen validator с фиксированными reason codes и защищённое чтение двух Caddy-файлов. Оригинальный R9 и его candidate-only continuation не меняются. Повтор pre-auth failure через rerun запрещён прежним контрактом.
- По источнику общего шлюза воспроизводится отказ на APP_DOMAIN placeholder; живой файл ещё не наблюдался. Следующий результат должен подтвердить точный invariant. Нельзя объявлять локальный шаблон фактом production или ослаблять все расширения переменных.
- Полный scope, границы, AI-контракт, метрика и остановка: DECISIONS D083. Владелец и исходная авторизация неизменны; новые пароли, роли или общий допуск не запрашиваются. Исходная бизнес-приёмка остаётся незавершённой.

- Уточнение после external commit aaa0b2b0d31a936751076472736ee1ba07bcbbfd: принятое D082 относится к API-refactoring; наша read-only диагностика — D083 с прежними техническими d082 именами. Сохранены все55 изменений и общий runtime не изменён. Старый diagnostic head6a3d48a2 прошёл3 CI, новый объединённый источник требует своих gate. Production-диагностика ещё не выполнялась.


### D-084 — R10 после подтверждённого отказа главной конфигурации

- Actual D083 diagnosis: sourceedb7bfa1c666853be162c99295e0044820753ab0, run34320812445/job102366801535,2026-09-09T06:49:28.520Z: blocked/main_structure/main_environment_expansion. Только чтение; no login/reload/application mutation. Это подтверждение причины прежнего R9 pre-auth abort, а не приёмка приложения.
- Создан инертный draft PR379 из codex/school-arthello-recovery-r10-20260909; R10/D084 будет иметь собственные identity/replay checks. R9 и его candidate-only continuation не меняются. Подготовлены новые gateway evidence/domain helper, context binding и resume checks; одиночная exact R9 browser retirement ограничена целью и recovery artifact, указанными в DECISIONS D084.
- Новый runtime не меняет роли и не обходит Education/School. До public остаётся полный natural browser с выделенной учёткой; после public повторяются проверки. Предыдущие данные, секреты и источники не подменяются. Исходные банковские/AlfaCRM/доступы/обращения/контент/backups сценарии остаются непринятыми до фактической проверки.
- Статус preparation. Независимый helper review и20 локальных tests PASS; controller integration и134 actual Caddy checks должны получить собственные подтверждения. Полный scope, source/cleanup/AI-контракт и условия остановки: DECISIONS D084. Exact remote review, hosted gates и protected run ещё не объявлены успешными.


## D085 — R11 после ошибки очистки временного fixture (2026-09-09)

Цель прежняя: принятый выпуск и полная исходная бизнес-приёмка. R10 source2e57dd22/run34322039891 прошёл installed-Caddy134, но deploy102371510204 остановился при удалении вложенного mode0555 fixture; clone/auth/public не начинались. Рабочая версия6596f693 остаётся прежней. Новая граница — только принадлежащая заданию временная очистка плюс доказанное исключение повторного исполнения завершившегося R10.

R11 PR380 получает новый source/tree и сохраняет всю действующую матрицу authority, candidate browser, backup, gateway binding и public/bank запретов. Владелец — пользователь; исполнитель — AI в пределах ранее разрешённого выпуска. Следующий контроль: независимый exact-source review, hosted regressions без root, все exact CI и защищённая проверка. Полный контракт/stop conditions: DECISIONS D085. Банковская и остальная бизнес-приёмка остаются открытыми; новый секрет или повторный вход собственника не запрашивается.


## D086 — R12 после остановки R11 на ёмкости импорта (2026-09-09)

R11 e579a20a/tree d8830019 прошёл все main CI, но protected34324235442/deploy102378379405 остановился до download/import при5807140KiB свободно против7995084KiB необходимо. Старый R9 browser отсутствует. Clone/auth/public не начинались; live6596f693 остаётся прежним. Эти факты не доказывают выпуск или бизнес-приёмку.

R12 PR381 сохраняет цель, владельца, ранее выданное разрешение и весь frozen runtime/acceptance. Новое действие строго ограничено exact unused recoverable R10 browser44ef654e: полная immutable identity, отсутствие любых container consumers, fresh main и recovery artifact перед non-force/full-ID removal. Затем прежняя capacity с2GiB reserve. Изначально предложенное удаление двухтегового application image отклонено review из-за mutable-tag race и исключено. Контракт/targets/AI/stop conditions — DECISIONS D086.

Quality не изменяется; новый отдельный exact-source hosted R12 gate добавляется к protected provenance. Следующий контроль — независимый окончательный source/tree review, hosted gates и фактический защищённый запуск. При недостатке места/identity drift — остановка до импорта без расширения очистки. Банковская и остальная исходная бизнес-приёмка остаются открытыми; owner login и новые секреты не запрашиваются. Результат production не заменять локальными тестами.

## D087 — Счётчики Точки в фактически принятом runtime (2026-09-09)

- Статус: подготовка в пределах действующего поручения Виталия на выпуск и исходную бизнес-приёмку; approved_by: Виталий по D-075 и последующим «продолжай». Supersedes: нет. История D075/D086 сохраняется; новый общий запрос разрешения не нужен. Область — только разрешённые read-only агрегаты D1. Ответственный Виталий, исполнитель Codex; срок текущая итерация, пересмотр после фактического отчёта или смены accepted source.
- Цель проекта и критерии завершения прежние: опубликованное работающее приложение и доказанная исходная бизнес-приёмка. Цель этого шага — проверить сохранённые счётчики четырёх счетов Точки, банковского реестра и связей в точном принятом runtime, определить конкретные оставшиеся причины без раскрытия записей.
- Подтверждённая зависимость: accepted source `77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed`, tree `ac3fcaac06acf33bf9ee32e438d0c040adb38fd7`, image `sha256:5a39c36001cb79abe6d0bc8d691275b58cdec5456e7d13d95fc717eba6702284`; protected `34326582961` / attempt `1` / deploy `102386111240`; результат `success` на `2026-09-09T08:11:09Z`. Evidence: [R12 protected release](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34326582961); candidate и post-public browser: [R12 deploy: candidate SSO at 2026-09-09T08:10:46.386Z](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34326582961/job/102386111240), [R12 deploy: post-public SSO at 2026-09-09T08:11:02.888Z](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34326582961/job/102386111240); backup: [R12 deploy: backup state verified](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/34326582961/job/102386111240). До подтверждения accepted source pin пустой. Локальные/hosted проверки и release preparation не заполняют этот факт.
- Фактический browser scope R12: естественные candidate/post-public SSO PASS подтвердили employee, Education и School identity; отрицательная проверка выполнена для `medical`. `feedbackVisible` подтверждает видимость интерфейса, а не весь сценарий обращения. Backup state verified содержит одну history-запись и nextAt `2026-09-10T00:15:00+00:00`; будущий автоматический запуск и restore этим не доказаны. Полная банковская и прочая бизнес-приёмка остаётся открытой.
- Этап и маршрут: успешный защищённый выпуск R12 подтверждён → обновить PR371 от свежего main и сверить точный source/tree/CI → закрепить реально принятый live source → выполнить один разрешённый bounded probe → сохранить наблюдение и выбрать следующую доказательную бизнес-проверку. Main во время защищённого выпуска не менять. Номер D087 повторно сверяется на свежем main перед добавлением.
- Вход AI-процесса: доверенный exact-main diagnostic checkout, подтверждённый accepted source отдельно от него, существующий `production-ru` runner и обе gateway/School блокировки, приватный контекст runtime/backup/gateway, каноническая D1 с подтверждёнными живыми дескрипторами. Технический trigger остаётся первым attempt Quality push-main с merge-title `D075: read-only production data…` и owner/repository restrictions. Quality не меняется.
- Разрешённые действия: ограниченная metadata-проверка точного приложения, его штатного read-only R7 backup worker и public gateway; bounded SELECT/count в UID1000 helper без сети, secrets, RW mounts или копии БД. Результат — фиксированные статусы и счётчики фактически наблюдённых account keys и юридических лиц, окна с `2026-09-01` по дату наблюдения UTC, записанных выписок, проведённых RUB-операций, связей и duplicate/missing identity. Запрос считает все ключи подключения; ровно четыре корректных уникальных ключа и одно юридическое лицо являются условиями успешного завершения. Частные значения остаются внутри защищённого чтения.
- Критерий текущего шага: независимый review точного source/tree; целевые 26 aggregate + 27 metadata/consumer + 4 launcher проверки (57 ранее проверенных PASS, не новый production результат); exact-source hosted gates; реальный job с source/image/time, terminal outcome и безопасным отчётом. `bounded_checks_complete` принимается только как результат этого ограниченного scope. При `incomplete_or_issues` фиксируется фактическая причина и незакрытый критерий.
- Семантика окна: `accountsWithContainingStatementInLatestRun` — отдельное наблюдение о последней готовой выписке, включающей период. Успешное точное окно всё ещё требует `coveredInLatestRun=4` и `accountsWithMatchingTransactionCount=4`, а также остальных строгих условий. Более широкая выписка не превращается в точное совпадение. Production probe не задаёт freshness cutoff; `freshness=not_requested` не является доказательством нового resync.
- Ограничения и риски: отчёт не сравнивает деньги с банком, не подтверждает ДДС, upstream полноту, свежий resync, UI/RBAC, обращения, выборочный AlfaCRM или backup history/schedule/restore. Эти критерии исходного задания остаются открытыми до собственных evidence. Существование worker/activation state не заменяет backup history или browser acceptance. Платежи, SQL writes, ключи, экспорт, изменение production и расширение прав запрещены.
- Ресурс и стоимость: существующие runner/CI, короткий ограниченный запуск; новые услуги не подключаются, фактическая тарифная стоимость неизвестна. Метрика пользы — датированные проверяемые счётчики и конкретный оставшийся блокер без изменений/утечек. Автоостановка — непроверенный source, drift runtime/gateway/consumers, state/FD/access mismatch, deadline, отсутствующая/непроверенная схема или ограничения объёма; неизвестное не считается PASS. Отказ владельца прекращает новые чтения, сохраняя рабочие данные и историю.
- Текущее наблюдение: diagnostic run `not_run`, job `not_run`, attempt `not_run`, время `not_run`, outcome `not_run`, evidence not_run. Счётчики/блокер: not_run; фактические банковские счётчики и завершение bounded checks ещё не наблюдались. Следующий переход по этому evidence: После завершившегося R12 обновить current main, перенести и проверить PR371, закрепить подтверждённый accepted runtime и получить protected counts-only observation. Деньги/ДДС и остальные бизнес-сценарии сохраняют собственные критерии доказательств. Пока фактического отчёта нет, указывать `not_run` и сохранять бизнес-критерии открытыми.


## D088 — Наблюдение расписания и результата банка (2026-09-09)

Цель — определить фактическую причину отсутствия операций четырёх счетов и получить завершённый ограниченный read-only отчёт. Вход — acceptedR12 runtime77f и D087snapshot34328837388 от08:23:37Z:4счёта/12statementrecords/0операций/latestpending; finalconsumer recheck не исполнен после ожидаемогоexit2. Владелец — Виталий; AI продолжает ранее разрешённую проверку. Приложение, банк и конфигурация синхронизации этим шагом не меняются.

Маршрут: reviewed exact-source PR/CI → прежний D075 protected owner/main workflow → canonical D1 snapshot + fixed schedule/retained-job metadata → валидация boundedJSON → повторное сравнение consumers → точный complete/incomplete/blocked outcome. Сохранитьexit2 при замечаниях, не путать его с timeout. Метрика успеха этого этапа — проверяемый законченный отчёт; бизнес-метрика четырёх счетов/операций/реестра/ДДС требует дальнейших доказательств.

AI не читает/расшифровывает credentials, не выводит account/provider IDs, суммы или произвольныеJSON, не вызывает банк/resync/SQLwrites. Metadataunknown остаютсяunknown. Стоп — drift, невалидный или oversized output, timeout либо неполная итоговая сверка. Отсутствующие или неизвестные таблицы остаются замечаниями в валидном отчёте. Прежние masks, UID/read-only/none-network/locks и own-helpercleanup сохраняются. Source review, реальныетесты иactualprotectedreport обязательны. Детальныйscope/AI/stopcontract:DECISIONS D088. Визуальнаяприёмка D089 и оставшиесябизнес-пункты отдельны.


## D089 — Проверка интерфейса Content/Tasks (2026-09-09)

Цель исходного поручения — проверить дизайн контента и задач, включая видимый номер задачи. Вход: фактически принятый R12 source77f26ec9/treeac3fcaac, immutable producer artifact и прежние синтетические fixtures. Владелец — Виталий, исполнитель — AI по действующему поручению. Выход —14 реальных hosted PNG, manifest и ограниченное evidence по двум viewport, с отдельным статусом завершения.

Маршрут: owner-approved exact-source PR → source tests → первый owner/main push с D089 prefix → GitHub-hosted isolated runtime → sandboxed Chromium → проверка полного результата. Ручной owner/main dispatch сохраняется. Права только contents/actions read, новые собственные данные и ресурсы; в production не исполняется. Frozen runtime/harness/Quality/банковская диагностика сохраняются. Current main не менять до terminal D088.

AI проверяет provenance, границы fixture и результаты, не подменяет ошибки рабочими данными или иным образом. Стоп: drift, неподтверждённая пустота volume, sandbox/cleanup failure, неполные evidence. Критерий — actual14PNG иPASS ограниченного сценария;12adapter+4trigger tests подтверждают подготовку. Задачи/контент сохранять и доставлять этот сценарий не проверяет; исходные банковские, интеграционные, permission и backup пункты учитываются отдельно. Полные scope/AI/stop conditions — DECISIONS D089.


## D090 — Исправление CSRF в мастере AlfaCRM (2026-09-09)

Владелец — Виталий, исполнитель — Codex; подготовка по действующему поручению завершить выпуск и исходную бизнес-приёмку. Supersedes: нет. История D088/D089 сохранена. Цель шага — отправлять обычные действия мастера с CSRF cookie/header, которые уже требует действующий сервер; остальные критерии AlfaCRM остаются отдельными.

Вход — принятый R12 source77f26ec9/treeac3fcaac и его неизменённые auth dependencies. Локально воспроизведён отказ корректной сессии из-за legacy имён в клиенте: RED 1/5 failure, после одной строки исправления GREEN 5/5; независимый review подтвердил scope. Два code/test файла: `AlfaCrmSetupWizard.tsx` и `alfacrm-csrf-contract.test.mjs`. Серверный auth, роли, привязка интеграции/филиалов, import-enable и finance-direction ограничения не изменены.

Маршрут: перенос на свежий main после D089 с сохранением истории → exact-source hosted полный build/tests/CI → проверенный выпуск по действующим gates → обычный browser/API результат с настоящей сессией. Hosted aggregate и live behavior сейчас pending; локальный PASS не является release или импортом. Следующий критерий — прохождение полного приложения с новым regression test, затем фактическое поведение клиента без ручного обхода CSRF.

AI-контракт: подготовить только этот клиентский fix и доказательство, использовать синтетические локальные токены без DB/upstream; не ослаблять серверные проверки, не менять import-enable, финансовую трактовку, роли или credentials. Ответственный Виталий; ресурс существующие local/hosted CI, новых услуг нет, тарифная стоимость неизвестна. Метрика — корректная CSRF-пара при сохранённых отрицательных проверках; срок текущая итерация, пересмотр после hosted/live evidence. Стоп — drift исходников/зависимостей, неожиданная дельта или провал gate; отсутствие доказательства оставляет шаг незавершённым. Отказ владельца прекращает новые действия. Полный контракт и ограничения — DECISIONS D090.


## D091 — Уточнение ошибки банковского scheduler (2026-09-09)

Владелец — Виталий; Codex продолжает ранее разрешённую проверку. Цель — получить отсутствующий сохранённый код результата после завершённого D088 наблюдения. Вход: accepted R12, две ошибки autosync, четыре запроса текущего периода и ноль операций. Порядок: exact source review/CI → прежний D075 защищённый read-only probe → валидация трёх новых полей → финальная сверка consumers → вывод только установленного факта.

AI читает только фиксированные metadata поля; не читает credentials, произвольный JSON или exception text, не делает bank requests/resync/writes, не меняет роли, импорт или расписание. Метрика этапа — завершённый проверяемый отчёт; финансовый результат требует последующей сверки. Ограничения и stop conditions D088 сохраняются. Конкретная причина ошибки и результат D091 пока не установлены. Evidence index — PR этого решения; подробный контракт — DECISIONS D091.


## D092 — Исправить сборку вспомогательного браузера (2026-09-09)

Владелец — Виталий; Codex продолжает разрешённую проверку Content/Tasks. Текущая точка: D089 run `34331175805`, job `102399900660` остановился на browser smoke после успешных install/build; fixture не запускался, 0 artifacts/PNG. Accepted R12 source `77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed` / tree `ac3fcaac06acf33bf9ee32e438d0c040adb38fd7` и приложение сохраняются. Локальный реальный pnpm `11.7.0` подтвердил private modes `0700`/`0600` под `077` и возможность повторно взять `0600` из cache под `022`; escaping symlink не наблюдался.

Цель этапа — собрать неизменённый browser source в собственном public context, доступном UID1000 после Docker COPY, и продолжить scoped visual acceptance. Маршрут: isolated eight-input context → locked copy import с локальным `022` → проверка links/file types → ограниченная permission normalization → meaningful assembly regression → независимый review/exact-source CI → реальный hosted smoke → 14 PNG и полный scoped evidence. Технический trigger D089 сохраняется. Публикация ждёт terminal outcome активного protected банковского наблюдения.

Новая assembly regression: 4 теста PASS с реальным pnpm `11.7.0`, frozen inputs/lock и импортом `playwright-core` после relocation и удаления install context. Проверены private modes, unsafe links/shared hardlinks до chmod, возврат `077` и отказ переиспользовать существующий context. UID1000 проверка здесь заблокирована `OS EINVAL`, Docker недоступен; image и Chromium PASS не заявляются. Метрика завершения этого этапа — успешный фактический smoke и полный 14-PNG результат после просмотра; общая бизнес-приёмка по-прежнему требует отдельных доказательств persistence, генерации, прав, интеграций и финансов. Следующий шаг — завершить независимый review и exact-source CI, затем получить фактический hosted image/Chromium результат.

AI-контракт: вход — frozen public browser files, accepted runtime pin и датированные failure/reproduction evidence; выход — минимальный assembly fix и проверяемая цепочка результатов. Разрешено менять только подготовку собственного временного browser context и её доказательства. Запрещено менять original browser/harness/adapter/trigger, global `077`, секреты, production или нормализовать чужие пути/store. Ответственный человек — Виталий. Ресурс — существующие local/hosted CI; новых услуг нет, тарифная стоимость неизвестна. Срок — текущая итерация, пересмотр после нового hosted run. Стоп — source/runtime drift, unsafe link/type/path, провал smoke/cleanup либо неполный evidence. Отказ владельца прекращает новые действия, сохраняя рабочие данные и историю. Подробный контракт и ограничения — DECISIONS D092.


## D093 — Пользовательская проверка собственных обращений (2026-09-09)

Владелец — Виталий; Codex продолжает разрешённую приёмку сотрудника на accepted R12. Цель — подтвердить доступ к собственному списку обращений, скрытие управления всеми обращениями и HTTP 403 для backup API в настоящей сессии. Границы: открыть/закрыть диалог без Send; только status backup ответа; сохранить прежние SSO/Education/School и отрицательную навигацию. GET списка может лениво создать schema, поэтому это ordinary UI acceptance, не строгий D075 read-only probe. Полный permission matrix, положительный backup status, интеграции, выписки и DDS не объявляются принятыми.

Подготовлен отдельный D093 workflow, Dockerfile и employee-controls flow/smoke/test, fixed R12 retirement и четыре документа поверх D092 main `b4c39d5af8ab348882759c48c0f82dbe810a8065`. Канонические четыре D076 files восстановлены без изменения: первый PR387 browser fixture прошёл, но frozen R8/R9 equality заблокировал расширение общего bundle. Новая схема сохраняет старые recovery contracts. Локально 74 browser/retirement/canonical tests PASS; Ruby gates и новый hosted image требуют CI. Маршрут: точный source review → CI/real image smoke → отдельный D093 protected browser run → четыре фиксированных результата и финальный cleanup. Фактические employee flags pending. Метрика завершения — проверяемый terminal результат с настоящей сессией, а не наличие тестового fixture.

AI-контракт: не менять роли, сессии, network/mutation exceptions или application deployment, не выводить secrets и тела обращений. Единственная новая housekeeping mutation — точный unused R12 browser image, только после свежих identity/main/consumer и двух recovery-artifact проверок; отсутствие подтверждается успешным inventory. App, worker, containers, volumes и capacity guards сохраняются. Ресурс — существующие local/hosted CI и production runner; новых услуг нет, тарифная стоимость неизвестна. Срок — текущая итерация после D092; пересмотр после фактического run. Стоп — source/identity drift, истёкший recovery artifact для присутствующего image, consumer, нехватка capacity, ошибка smoke/login/flags/cleanup. Отказ владельца прекращает новые действия. Подробные ограничения — DECISIONS D093.


## D094 — Уточнить причину остановки банковской загрузки (2026-09-09)

Владелец — Виталий. Цель — получить безопасное фактическое название этапа сбоя, чтобы исправить загрузку по четырём настроенным счетам. Вход — accepted R12 и D091 report с нулём операций, тремя scheduler errors и callback500; точная причина пока неизвестна. Выход — ограниченный scheduler observer и fixed-schema diagnostic, затем следующий ordinary tick на новом release. Метрика завершения диагностики — actual accepted runtime/source и достоверный этап или явное missing; это не метрика финансовой полноты.

AI готовит восемь точечных application/diagnostic/test overlays, независимый source review и exact-source CI. Сохранить нормальную авторизацию, scope, даты, scheduler claim/lease/backoff, callback/finally semantics и существующие критерии банковской приёмки. Не читать/выводить exception payload, secrets или бизнес-записи; не создавать новый force endpoint, не делать ручные SQL writes и не заявлять провайдерскую ошибку по локальному HTTP500. Ресурс — текущие CI и release-процесс; новых услуг нет, тарифная стоимость неизвестна. Срок — текущая итерация; пересмотр после нового runtime и обычного запуска. Стоп — нарушение указанных границ, source drift или неподтверждённый результат. Отказ владельца прекращает новые действия с сохранением рабочих данных.


## D095 — Формат «Задача №0001…» (2026-09-09)

Владелец — Виталий; исполнитель — Codex. Цель — выполнить требование четырёх цифр во всех существующих taskRecordLabel callers. Вход — подтверждённый общий formatter без padding; выход — одна строка runtime и соответствующие formatter regressions. Четыре tests PASS, независимый review PASS; метрика завершения — новый verified release и одинаковые подписи при сохранении raw IDs/связей.

AI меняет только отображение и его тесты, не вводит новую ID-схему и не заменяет принятый visual runtime pin. Прежние ограничения modulo10000/уникальности подписей и поиска по raw ID остаются явно открытыми. Ресурс — текущие CI/release, новых услуг нет; стоимость неизвестна. Срок — ближайший выпуск; пересмотр после actual UI result. Стоп — изменение IDs, регрессия общего форматтера, source drift или отказ владельца.


### D092 — Дочитать результат scoped visual run (2026-09-09)

Владелец — Виталий; Codex продолжает разрешённую проверку интерфейса. Новый факт: Chromium smoke прошёл в run34333105787, empty fixture создан, scoped runner BLOCKED; artifact10096640452 существует, actual receipt/PNG пока не прочитаны из-за transfer failures. Цель этого этапа — получить фиксированный этап отказа из уже созданного artifact, без повторного запуска UI. Выход — проверенный read-only receipt summary; метрика завершения — реальные bounded stage/counters, а не visual PASS.

Маршрут: source tests/review → owner exact-main hosted GET после fixed metadata gates → digest/ZIP/receipt validation → выбрать конкретное дальнейшее исправление. Семь новых source/doc paths, три append-only updates; existing runtime/adapter неизменны. Локально 5+6+4 tests и независимый review PASS; actual execution pending. AI не обращается к production, secrets или browser, не извлекает PNG и не обходит access controls. Ресурс — текущий GitHub-hosted CI, новых услуг нет; стоимость неизвестна. Срок — текущая итерация, пересмотр после receipt. Стоп — identity/schema/digest/expiry/main drift или отказ владельца. Визуальный просмотр и остальные критерии остаются отдельной работой.


### D092 — Восстановить полноту workflow fixtures (2026-09-09)

Владелец — Виталий; исполнитель — Codex, продолжение разрешённой UI проверки. Вход — actual read-only receipt run34337932856 с остановкой tasks-empty-390x844; exact accepted component/API подтверждают отсутствие нужного permissions object в frozen overview и detail fixtures. Цель — привести только тестовые ответы к текущей схеме для existing synthetic OWNER. Выход — два scoped adapter/test изменения и один реальный hosted повтор после source gates; метрика завершения — полный проход с прежними assertions, не само наличие artifact.

AI не меняет продуктовые роли, endpoints, данные или frozen harness/runtime pin. Обоснование actual stage — подтверждённый source mismatch, а не наблюдённый raw runtime exception; screenshots пока не просмотрены. Ресурс — текущие GitHub-hosted проверки; новых услуг нет, стоимость неизвестна. Срок — текущая итерация, пересмотр после нового receipt. Стоп — source/fixture/identity drift, слабее assertions, неподтверждённый результат или отказ владельца. Полная visual и business приёмка остаётся открытой до фактических доказательств.


## D096 — R13 с сохранением принятого R12 и данных (2026-09-09)

Владелец — Виталий; исполнитель — Codex. Основание — продолжающееся разрешение исправлять и публиковать без участия владельца, настроенный постоянный пароль в protected secrets. Цель — доставить D090/D094/D095 в новый проверенный runtime, сохранив принятый R12, пользовательские данные и историю резервных копий. Вход — successful R12 run34326582961, production employee controls PASS в D093 run34335665105, проверенные source changes. Выход — отдельный R13 protected release и реальные candidate/after receipts; до них статус prepared.

Маршрут: bounded new history/live/backup adapters → независимый review → exact-source hosted gates → source/PR/main freeze → capacity/accepted baseline → fresh snapshot и adoption → natural candidate check → public boundary → natural after check → обычный bank tick/read-only stage. AI не расширяет банковские capability, не подменяет owner sessions, не меняет роли/платежи и не отправляет сообщения. Старые frozen contracts и оба shared locks сохраняются. После potential seal/auth/public boundary старые database restores и общая очистка запрещены.

Метрики — новый verified source/image, сохранённый healthy backup reader/history, same School identity, denied unassigned section, фиксированный runtime failureStage после настоящего scheduler attempt. Не включать в PASS ещё не выполненные bank coverage, Alfa selective import, Content creation, owner manual backup/restore и будущий daily run. Ресурс — текущие GitHub-hosted проверки и серверы; новых услуг нет, фактическая стоимость неизвестна. Срок — текущая итерация; пересмотр после protected result/ordinary bank observation. Стоп — несовпадение identity/provenance/capacity/consumer/durable boundaries, отсутствие достаточных доказательств или отказ владельца.


## D098 — Реальные операции Точки на новом R14 (2026-09-09)

Владелец — Виталий; исполнитель — Codex. Продолжается разрешение исправлять и публиковать без дополнительных подтверждений. Цель — завершить одну текущую задачу: четыре настроенных счёта Точки за период с 1 сентября 2026 года, операции одновременно в реестре и ДДС с согласованными суммами и без дублей. Вход — D097 из объединённого PR397, принятый R13 и actual D075 17:30Z (пока ноль операций). Выход — проверенный новый R14 и фактическая банковская приёмка; наличие CI или READY imports не является завершением.

AI готовит PR398 и exact-source gates, затем штатный protected выпуск, read-only наблюдение нового runtime и результат очередного обычного bank tick. Сохраняются банковская авторизация/scope/lease/backoff, R12 backup worker/history, свежий snapshot и durable publication boundaries. Новые owner sessions, force endpoints, ручные service-key вызовы, произвольные SQL writes, платежи и сообщения не разрешаются. Старые frozen выпуски не повторяются. Ресурс — текущие CI и серверы; новых услуг нет, тарифная стоимость неизвестна. Срок — текущая итерация; пересмотр после protected result и банковского наблюдения. Стоп — drift identity/source/capacity/consumers, риск возврата старых данных после seal/auth/publication, неподтверждённые результаты либо отказ владельца. Отдельные Excel/AlfaCRM/Content задачи не включаются в этот этап.



## D101 — Доставка исправления Точки через новый R15 (2026-09-10)

Владелец — Виталий; исполнитель — Codex. Цель и метрика остаются D098: реальные операции четырёх счетов с 1 сентября по текущую дату и равные суммы ДДС без дублей. Вход — принятый live R13, terminal failure R14 до cutover, проверенный материализованный source D100. Выход — новый guarded R15 с actual candidate/after receipts, затем bound read-only bank reconciliation. PR404 подготовлен; production и банк пока не приняты.

AI выполняет уже разрешённые source compatibility/release repairs, review/CI, merge и защищённый выпуск без нового согласования. Сохраняет D099 source, frozen R14 evidence, R12 backup/history, School, двойные locks, capacity/provenance/auth/snapshot gates. Исправляет проверяемую доставку package, но не выдумывает точный отсутствовавший gateway file. После seal/auth/public boundary старые database restores запрещены. Новых sessions/roles/service-key calls, платежей, сообщений, SQL writes, force/resync и raw exports нет.

Ресурс — текущие GitHub CI и сервер; новых платных услуг нет, стоимость запуска неизвестна. Срок — текущая итерация; пересмотр после actual release result/ordinary scheduler attempt. Не останавливаться лишь из-за failed CI либо технической несовместимости source: исправлять причину в отдельном проверяемом PR. Реальный access blocker или отказ владельца прекращает новые действия с сохранением данных. Критерии финансовой приёмки и подробные release pins — D101 acceptance report.


### D101 — Уточнение способа публикации (2026-09-10)

В первом R15 исполнитель выбрал обычный merge, несовместимый с существующим single-parent signed-commit guard. Отказ произошёл до установки, обе cleanup успешны. Исправление — PR405 с новым reviewed source и обязательным squash; guard и остальные production/data boundaries сохраняются. Дополнительное разрешение владельца не требуется. Метрика завершения прежняя: actual successful release, затем четыре счёта и равные bank/DDS суммы без дублей. Ни passing CI, ни исправление способа merge не закрывают банковскую задачу.


## D102 — Production-наблюдение Точки после принятого R15 (2026-09-10)

Уточнение владельца 10.09.2026: штатный ручной запуск через существующую кнопку Точки разрешён. Пользователь предоставил скриншот generic ошибки чтения готовой выписки после нажатия. Codex готовит только безопасное наблюдение текущих сохранённых итогов, с двумя фиксированными полями latestRun и прежними критериями сверки. Runtime приложения, ключи, роли, SQL state, leases и scheduler backoff этим изменением не меняются. Результат шага — actual D075 report; исправление диагностики само по себе не завершает банк.

Владелец — Виталий; исполнитель — Codex. Входы: successful protected R15 run `34445017241`, семь actual runtime pins, четыре настроенных счёта и существующий D075 read-only путь. Выход: ограниченный отчёт по периоду с 2026-09-01 с реальными операциями банка и связанными строками ДДС, равными доходами/расходами в копейках и нулём дублей, потерянных/общих связей и финансовых расхождений. Passing release/CI не заменяет этот результат.

Разрешены обновление/review PR399, hosted CI и один штатный protected D075 observer после exact-main Quality. Наблюдение читает canonical D1 через read-only/no-copy mount и не вызывает банк. Запрещены платежи, сообщения, raw bank/PII exports, новые sessions/roles/service-key calls, SQL writes, force/resync и обход lease/backoff. R12 backup/history, School и frozen R14/R15 evidence сохраняются. Ответственный — Виталий; новых услуг нет, стоимость запуска неизвестна. Метрика пользы — подтверждённые реальные операции и равенство ДДС. При отказе новые проверки прекращаются, приложение и данные сохраняются; при fixable CI/identity blocker работа продолжается по фактам.

## D103 — Восстановление сохранённого запроса Точки

Владелец Виталий; исполнитель Codex. Продолжение уже разрешённого исправления банка и обычной ручной синхронизации. Вход: принятый R15 и actual manual error после чтения старой выписки, retainedJobs3, ноль операций. Выход: не более одного безопасного повторного создания исчезнувшей сохранённой выписки на счёт в пределах обычного sync, затем новый guarded release и реальная сверка четырёх счетов. Метрика прежняя: реальные операции и равные доходы/расходы ДДС в копейках без дублей/потерь/shared/mismatch. HTTP/root cause пока не записан; 404/410 recovery проверяется как доказанный локальный сценарий, а не как выдуманный upstream диагноз.

AI пишет regression tests, минимальный runtime fix и hosted historical adapter без переопределения frozen R15. Production не изменяется до штатного проверенного выпуска. Данные, ключи, доступы, lease/backoff, snapshot/backup/history/School и запрет restore после public boundary сохраняются. Новые сервисы и платежи не подключаются; стоимость платформы неизвестна. Срок — текущая итерация, пересмотр после нового actual release/sync report. Исправимый CI/source blocker устраняется исполнителем; отказ владельца или реальная невозможность безопасного доступа прекращают новые действия с сохранением приложения и данных.
## D104 — Доставка исправления выписок через R16

Владелец Виталий; исполнитель Codex. Вход: accepted R15, actual manual failure и проверенное D103 восстановление исчезнувшего сохранённого запроса. Выход: новый защищённый R16 с фактическими candidate/after-public receipts, затем реальная сверка четырёх счетов за 01.09.2026–текущую дату. Срок — текущая итерация с пересмотром по actual release/sync. Метрика — реальные операции и равные суммы банка/ДДС в копейках без дублей, пропусков и нарушенных связей. Исходники, CI и successful deploy отдельно не закрывают метрику.

Разрешение на исправления, PR/merge, protected release и существующий owner manual sync уже получено. AI сохраняет D099 materialization, frozen R12–R15 evidence, R12 backup/history, School и все snapshot/identity/provenance/auth/capacity/dual-lock gates. Новый адаптер принимает actual R15 как baseline и доказывает точные остановленные предыдущие consumers. Нет платежей, сообщений, raw exports, новых ключей/сессий/ролей, service-key calls, SQL state changes и restore после public boundary. Ресурсы — существующий GitHub/сервер; новых платных услуг нет, стоимость запуска неизвестна. Исправимый blocker устраняется по доказательствам; отказ владельца или реальная невозможность безопасного доступа прекращает новые действия с сохранением данных.
## D105 — Подтверждение результата Точки на R16

Владелец Виталий; исполнитель Codex. Входы — actual successful R16 receipts и свежая обычная банковская попытка. Выход — bounded read-only отчёт с полным окном четырёх счетов, реальными банковскими операциями и связанными financial_operations, равными доходами/расходами в копейках без дублей и нарушенных связей. Разрешены ранее согласованные source/review/CI/merge и существующий D075 путь; новые подтверждения владельца не требуются. Исходники runtime, данные, платежи, сообщения, raw exports, секреты, роли, сервисные ключи, lease/backoff и восстановление старой БД вне этого шага. Backup/history и School сохраняются.

Ресурсы — существующие GitHub и сервер, новых платных услуг нет, стоимость запуска неизвестна. Срок — после actual release и свежего обычного bank attempt; отсутствие новой попытки само по себе не ошибка доступа. Метрика пользы — подтверждённые реальные операции и равенство ДДС. При полном доказанном результате повторная проверка отключается; при отказе владельца новые действия прекращаются с сохранением приложения и данных. Исправимые технические блокеры устраняются исполнителем по фактам.

## Приложение 10.09.2026 — D108, статьи и разнесение (в работе)

Виталий поручил перейти к статьям после банковского этапа. Пользовательский результат: управляемый справочник, явное разнесение операций, очередь без статьи и ДДС с раскрытием до платежа. Владелец — Виталий. Метрика — доля явно разнесённых операций при сохранении точных сумм и банковских связей. Вход: существующие финансовые проекции и банковские факты; выход: только управленческие назначения/аудит. Нет seeds или выдуманных реальных данных, платных внешних сервисов, автоначислений/AI. Отказ сохраняет импорт и историю, ручное назначение не выполняется.

Разрешение на разработку/PR и обычный защищённый выпуск уже дано; новый запрос технического разрешения не требуется. Названия предлагаемых статей утверждаются отдельно в продукте. Критерии: создание черновика → утверждение → назначение → повторное чтение → точные DDS суммы; права/CSRF, ошибки, устаревшая версия, параллельный редактор, архив, пустой справочник, узкий экран. Контракт `docs/acceptance/2026-09-10-finance-articles.md`. Этап не закрыт до actual protected release и пользовательской приёмки, прошлые production receipts/backup/School сохраняются.

## D110 — Проверка и production выпуск статей

Владелец Виталий; исполнитель Codex. Поручение «Проверяй и выпускай в прод» уже разрешает технические исправления, PR/review/merge и штатный защищённый выпуск. Вход — D108 source PR410 и accepted R16. Выход — рабочий справочник/ручное разнесение/DDS drilldown при сохранении банковских фактов. Метрики: actual browser/DB lifecycle, desktop/mobile, неизменность банковских строк, атомарный аудит, новый protected receipt и финансовые агрегаты без нарушений. Реальные названия статей утверждает владелец в интерфейсе; авторазнесение и начисления не включаются.

Существующие CI и сервер, новых платных услуг нет, стоимость запуска неизвестна. Срок — текущая итерация с пересмотром по actual gate. Сохраняются School/backup/history, snapshot/seal/auth/identity/capacity/двойные locks. Стоп при отказе владельца или невозможности безопасного пути; исправимые тестовые/source ошибки устраняет исполнитель. После public boundary старую БД не восстанавливать; данные и приложение сохраняются.

## D111 — Техническое устранение отказа history receipt

Владелец Виталий, исполнитель Codex; прежнее разрешение на проверку и production выпуск действует. Цель D110 сохраняется: статьи и ручное разнесение в рабочем приложении, банковские суммы/связи без изменений. D110 actual failure произошёл до checkout/snapshot/cutover; данные не затронуты. Исправляется exact acceptedRun R16 в inline consumer, защита не ослабляется; новый signed squash и новый protected run. Проверка helper→consumer сначала воспроизвела ошибку и затем прошла; прежние негативные границы сохранены. Нужны actual release receipts и bounded D075. Дополнительных платных услуг нет; стоимость запуска неизвестна.

## D114 — Проверка сохранности финансов после выпуска

Владелец Виталий, исполнитель Codex. Прежнее разрешение на выпуск включает эту штатную read-only сверку. Вход — actual accepted R17 и сохранённый backup/School; выход — реальные банковские агрегаты с точной сверкой ДДС без нарушений связей. Синтетические797tests/browser не заменяют данные production. Новых платных услуг, ролей, сессий и финансовых записей нет; стоимость запуска неизвестна.
## Приложение D123 — финансовая структура и безопасная классификация (2026-09-10)

Владелец: Виталий. Исполнитель: Codex. Статус решения: approved. Цель — разделить юридическое владение, операционный филиал и экономический смысл платежа, затем безопасно начать разнесение уже загруженных операций ООО «АртХелло». Входы: подтверждение владельца, утверждённый каталог статей, неизменяемые операции Точки и текущая карта четырёх счетов. Выходы: пять отдельных филиалов, четыре новые статьи доходов, агрегированный результат однозначного разнесения и очередь ручной проверки.

AI-контракт: разрешено читать управленческую проекцию и обезличенно проверять структуру, добавлять только утверждённые статьи и назначать только однозначные неразнесённые поступления школы/сада в закреплённом периоде. Запрещено менять банковские факты, угадывать общий «Атлас», разносить конфликтующие признаки, подключать неизвестные счета, раскрывать назначения/контрагентов/суммы или создавать персональные статьи. Ответственный за бизнес-правила и финальную ручную проверку — Виталий; исполнитель технических guardrails — Codex. Используются существующие GitHub и production runner, новые платные услуги не подключаются; дополнительная стоимость — ноль, стоимость штатных запусков платформы неизвестна.

Метрика: каталог содержит 148 активных утверждённых статей; каждая автоматически обработанная строка получает правильные ДДС, ОПиУ и филиал, при этом банковская строка и связь 1:1 сохраняются. Автостоп: изменение числа/юрлица счетов, ревизии каталога, периода, валюты/источника, конфликт признаков, частично заполненная строка, ошибка backup/concurrency/повторной проверки. При отказе исходные данные сохраняются, неоднозначные строки остаются без статьи, дальнейшее разнесение переносится в ручную проверку. Этап пересматривается после production-результата и подключения счетов остальных юрлиц.

## Приложение D130 — личная приёмка входа владельца в Atlas (2026-09-10)

Владелец — Виталий, исполнитель — Codex. Вход: успешная публикация D129 и предоставленный владельцем мобильный скриншот `central_denied`. Цель текущего шага — явно включить только личный owner grant `USR-OWNER` для `SYS-SCHOOL-ATLAS` с ролью директора и доказать полный SSO до авторизованного учебного API. Критерий — protected receipt с `ownerGrant=director` и `atlasSso=verified`; адрес и health отдельно этот критерий не закрывают.

AI разрешено использовать существующую защищённую owner-сессию/API, создать только отсутствующий grant, проверить redirects и завершить проверочные сессии. Запрещено перезаписывать конфликтующий grant, менять основную owner-роль, права сотрудников/семей, данные дневника, runtime, DNS, routes, секреты или отправлять сведения наружу. Ресурсы — существующие GitHub Actions и production runner, новых платных услуг нет; стоимость штатного запуска неизвестна. При конфликте прав, неверной runtime identity, отсутствии exact Quality либо неполном SSO запуск прекращается без расширения scope. Следующий переход после PASS — отдельное согласование ролей конкретных сотрудников и загрузки учебных данных.

Фактический переход выполнен: source `49984055f6baced5f3fe4b14f0023e1fec215ae0`, protected run `34532234336`, job `103055564917`, receipt artifact `10173964551`. Receipt показал уже активный owner director grant без повторной записи и успешный полный SSO до `/api/school`. Этап D130 принят. Текущий шаг — мобильный повтор владельца; после него маршрут переходит к отдельному назначению ролей сотрудников и загрузке классов, расписания и КТП. Эти действия автоматически не выполняются.

## Приложение D133 — согласованность двух школьных дневников (2026-09-10)

Мобильный повтор владельца закрыл проверку входа D130 и открыл точный UI-дефект: Atlas директор видел пустой родительский preview вместо первого управленческого экрана. Параллельный снимок School 1–11 доказал, что его живой source всё ещё не содержит уже принятого возврата в ArtHello OS.

Текущий шаг: выпустить два неизменяемых source pin единым защищённым controller без объединения баз и прав. Atlas меняет только приложение, сохраняет `atlas-school-diary-data` и проверенный backup; School применяет собственный принятый backup/rollback cutover. Критерий перехода: директор Atlas сразу видит ролевой дашборд, пустого parent preview нет, School показывает возврат сотруднику, оба public health и Atlas owner SSO проходят. До production receipt этап остаётся `candidate`.

## Приложение D134 — повтор после несовпадения School topology (2026-09-10)

D133 source и hosted gates приняты, но protected run `34536320576` остановился до Atlas: compose-oriented School controller потребовал отсутствующий `/srv/school-1-11/shared/.env`. D134 не меняет scope, sources, данные или права. Разрешён только guarded standalone School cutover для контейнера `school-1-11` с write gate, backup/integrity, preflight и rollback; затем выполняются неизменные Atlas backup/image/owner-SSO проверки. Успехом остаются receipts сохранения volumes, public health двух дневников и реальный owner Atlas SSO.

## Приложение D135 — identity-based School container discovery (2026-09-10)

D134 run `34537971479` остановился после проверки и сборки image, но до backup/cutover: hard-coded Docker name уже не существует. D135 разрешает read-only определить ровно один running container по label `school.system=school-1-11` и прежней revision, проверить безопасное имя и передать его неизменному standalone controller. При нуле/множественности/source drift — stop. Scope, sources, данные, права и критерии D134 не меняются.

## Приложение D136 — School network identity (2026-09-10)

D135 run `34539171120` остановился до мутаций из-за отсутствия legacy system label. D136 выбирает ровно один running container в `arthello-os_backend` с network alias `school-1-11` и требует old revision на его image label. Остальные границы и критерии неизменны.
