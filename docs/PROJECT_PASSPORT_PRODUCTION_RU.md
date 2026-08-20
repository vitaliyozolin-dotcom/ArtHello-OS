# Паспорт: ArtHello OS Production RU

- `project_id`: `ARTHELLO-OS-PRODUCTION-RU`
- владелец: Виталий Озолин
- состояние: `approved` → `active`
- актуально на: 2026-08-20
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

1. `RU-01` — ветка, production-инфраструктура, персональная аутентификация.
2. `RU-02` — сервер, deploy-user, секреты, закрытый запуск по IP. Зависит от `RU-01`.
3. `RU-03` — первый владелец, смена пароля, роли, аудит, recovery. Зависит от `RU-02`.
4. `RU-04` — backup/restore и security acceptance. Зависит от `RU-03`.
5. `RU-05` — DNS и TLS. Зависит от `RU-04`.
6. `RU-06` — восстановление AlfaCRM/Точки и файловый импорт в `SHADOW + DATA_AUDIT`. Зависит от `RU-05`.

## Метрики и ворота

- ноль API бизнес-данных без действующей персональной сессии;
- ноль общих паролей ролей в runtime;
- ноль секретов в Git и CI-артефактах;
- RPO 24 часа, целевой RTO 4 часа до фактического замера;
- health-check и login/logout/lockout/password-change проходят на опубликованном кандидате;
- никакого DNS cutover при провале хотя бы одного обязательного ворота.

## Риски и блокеры

- IP нового российского сервера ещё не предоставлен;
- GitHub Environment и SSH-secrets ещё не настроены;
- фактический backup restore ещё не выполнен;
- старое защищённое окружение AlfaCRM/Точки ещё не инвентаризировано;
- baseline PR остаётся draft, поэтому production PR является stacked и не разрешает merge или запуск автоматически.

## Текущий шаг

- исполнитель: Codex;
- действие: создать `codex/arthello-production-ru`, commit, push и draft PR;
- доказательство: ссылка на draft PR, точный commit SHA, зелёные quality gates;
- следующий переход: Виталий создаёт московский сервер и передаёт только публичный IP; root-пароль и приватный SSH-ключ в чат не отправляются.

## Утверждённое решение

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
      status: open
    - action: Создать московский VPS и передать публичный IP
      owner: Виталий Озолин
      due: null
      evidence_required: Timeweb server card without secrets
      status: open
```
