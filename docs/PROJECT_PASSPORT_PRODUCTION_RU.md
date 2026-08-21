# Паспорт: ArtHello OS Production RU

- `project_id`: `ARTHELLO-OS-PRODUCTION-RU`
- владелец: Виталий Озолин
- состояние: `approved` → `active`
- актуально на: 2026-08-21
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
3. `RU-03` — merge завершён; GitHub Environment `production-ru` настроен; закрытый deploy по IP выполняется через выделенный SSH-порт `2222`, после чего проверяются первый владелец, обязательная смена пароля, login/logout/lockout/session revocation. Статус: `active`; зависит от зелёного `RU-01` и подготовленного `RU-02`.
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
- приложение, данные, интеграции и DNS предыдущими неудачными попытками не изменены.

## Риски и блокеры

- доступность SSH `2222` с GitHub-hosted runner ещё не подтверждена; критерий закрытия — успешная загрузка immutable archive и запуск server activation;
- первый owner и опубликованный auth flow ещё не проверены end-to-end;
- фактический backup restore ещё не выполнен;
- старое защищённое окружение AlfaCRM/Точки ещё не инвентаризировано;
- PR #7 имеет красный CI на своём head и не должен сливаться отдельно;
- любые реальные данные, интеграции и DNS остаются заблокированы до отдельных ворот.

## Текущий шаг

- исполнитель: Codex; владелец решения — Виталий Озолин;
- действие: добавить в production-workflow обязательный `ARTHELLO_RU_DEPLOY_PORT=2222`, закрепить host key для `[188.225.47.207]:2222`, получить зелёный CI, squash-merge технический PR и повторно развернуть immutable SHA `f7bb971f362bb8fe3f76209eba01237c602d9946`;
- ограничения: без DNS, реальных данных, интеграций и первого owner; нидерландский сервер не изменять; SSH `22` не отключать;
- доказательство выполнения: successful workflow, checksum archive, успешный server activation, `GET /api/healthz` через временный host `:80`, активный release symlink;
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

- входные данные: immutable release SHA `f7bb971f362bb8fe3f76209eba01237c602d9946`, GitHub Environment `production-ru`, выделенный SSH-порт `2222`, подготовленный RU VPS;
- ожидаемый результат: воспроизводимый закрытый deploy с проверенным checksum, атомарным release-каталогом и успешным health-check;
- разрешённые действия: создать техническую ветку и PR, обновить workflow/паспорт, исправлять CI-дефекты, squash-merge после зелёного CI, обновить secret порта/known_hosts и запустить deployment указанного SHA;
- запрещённые действия: DNS cutover, создание первого owner, загрузка реальных данных, подключение AlfaCRM/Точки, изменение нидерландского сервера, отключение SSH `22`;
- ответственный человек: Виталий Озолин; исполнитель — Codex;
- стоимость выполнения: без новых платных ресурсов сверх действующих GitHub Actions и VPS;
- метрика пользы: successful deploy с нулём запрещённых побочных эффектов и health-check не позднее 5 минут после activation;
- автоматическое отключение: остановиться при недоступности `2222`, несовпадении host key/checksum, необходимости нового секрета или изменении production-данных;
- отказ пользователя: разрешён до server activation; код и PR сохраняются, production и данные не изменяются.

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
  status: active
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
  superseded_by: null
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
```
