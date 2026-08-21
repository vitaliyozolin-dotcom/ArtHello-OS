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
3. `RU-03` — разрешённый merge, GitHub Environment `production-ru`, закрытый deploy по IP, первый владелец, обязательная смена пароля, login/logout/lockout/session revocation. Зависит от зелёного `RU-01` и отдельного разрешения Виталия на merge/deploy.
4. `RU-04` — backup/restore и security acceptance. Зависит от `RU-03`.
5. `RU-05` — DNS и TLS. Зависит от `RU-04`.
6. `RU-06` — восстановление AlfaCRM/Точки и файловый импорт в `SHADOW + DATA_AUDIT`. Зависит от `RU-05`.

## Метрики и ворота

- ноль API бизнес-данных без действующей персональной сессии;
- ноль общих паролей ролей в runtime;
- ноль секретов в Git и CI-артефактах;
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
- candidate branch: `codex/arthello-production-ru`;
- PR: `#27`; целевая база по утверждённому решению — `main`;
- merge и deploy не разрешены.

## Риски и блокеры

- GitHub Environment `production-ru` и его SSH-secrets ещё не настроены;
- закрытый deployment по IP ещё не выполнялся;
- первый owner и опубликованный auth flow ещё не проверены end-to-end;
- фактический backup restore ещё не выполнен;
- старое защищённое окружение AlfaCRM/Точки ещё не инвентаризировано;
- PR #7 имеет красный CI на своём head и не должен сливаться отдельно;
- зелёный exact-head CI должен сохраняться для текущего candidate до отдельного решения о merge.

## Текущий шаг

- исполнитель: Виталий Озолин (решение) и Codex (исполнение после разрешения);
- действие: получить отдельное разрешение на merge PR #27 и закрытый deploy по IP;
- ограничения: без DNS; без реальных данных и интеграций; нидерландский сервер не изменять;
- доказательство готовности: base=`main`, mergeable draft PR, зелёный workflow `Quality gates`, подготовленный RU-сервер;
- следующий переход: после разрешения — merge, настройка GitHub Environment `production-ru` и закрытый deploy по IP.

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
```
