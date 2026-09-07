# AlfaCRM PR #340 — независимое ревью перед выпуском

Дата проверки: 2026-09-07.

Репозиторий: `vitaliyozolin-dotcom/ArtHello-OS`.
PR: https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/340
Проверенный head: `041e037e0458426657dcf51385f0dd8dd0baa2c1`.
Base PR: `ff24a821c1ee34bd5fb87caa40b7d2ba424b0213`.

**Решение: BLOCKED — текущий PR нельзя считать готовым к рабочей синхронизации даже после восстановления GitHub CI.** Есть самостоятельные дефекты кода, не связанные со сбоем CI. Исправления, merge и production-записи в рамках этого ревью не выполнялись.

## Проверка

- Diff и обсуждение PR получены через GitHub; head подтверждён.
- Новые файлы PR наложены на отдельную копию затрагиваемых файлов актуального собранного v52-приложения. В отдельной копии применены `patch-alfacrm-staged-integration.mjs`, `patch-alfacrm-style-import.mjs`, `patch-css-budget-shell-split.mjs`.
- `lib/access-policy.ts` дополнительно получен непосредственно из проверенного head: blob `a19c80ff90c7c76d457482689476d53ec67c4a64`.
- Runtime непосредственно из head: `deploy/v52/overrides/production/runtime-server.mjs`, blob `5c34164dffc790ab6283ebb221d33a9e251e1a94`.
- Существующие source-тесты PR: **9/9 прошли**. Прежнее замечание о падении CSS source-теста в этом head исправлено.
- Независимые behavioral-тесты исполняют обработчик после реального build-patch и снятия TypeScript-типов, с настоящим SQLite in-memory через D1-адаптер и синтетическими ответами AlfaCRM: **4 контрольных сценария прошли, 5 регрессионных сценариев упали** на проверяемых дефектах.
- Полная production-сборка, внешний AlfaCRM tenant, реальные секреты и авторизованный браузер в это bounded review не входят.

Команды воспроизведения из каталога ревью:

```bash
node --test behavioral-review.test.mjs
```

Из `app-under-test`:

```bash
node --test tests/alfacrm-staged-integration.test.mjs tests/css-budget-shell-split.test.mjs
```

Логи: `behavioral-results.txt`, `source-test-results.txt`.

## Блокирующие замечания

### P1 — production import невозможно включить существующим runtime

Места: `deploy/v52/overrides/scripts/patch-alfacrm-staged-integration.mjs:96-104`; `deploy/v52/overrides/production/runtime-server.mjs:45-60`.

Build-patch добавляет проверку `env.ALFACRM_IMPORT_ENABLED`, но Miniflare получает явный список bindings, в котором этой переменной нет. Даже установленная переменная окружения контейнера не попадёт в worker; `importModule` останется с HTTP 409. Требуется явная передача release flag в worker с закрытым значением по умолчанию. Нельзя решать это удалением release gate.

### P1 — proxy запрещает все POST менеджерам, которым мастер обещает управление

Места: `deploy/v52/overrides/app/api/integrations/alfacrm/route.ts:89-102`; `deploy/v52/overrides/lib/access-policy.ts`, правило `/api/integrations`; `deploy/v52/overrides/proxy.ts:50-52`.

Маршрут и UI считают DIRECTOR/INTEGRATIONS редакторами, но POST `/api/integrations/alfacrm` наследует `write: []` родительского API. Поведенческий тест на настоящей policy head вернул `false` для DIRECTOR. Нужна согласованная отдельная mutation-policy с сохранением CSRF, модульных ограничений и подтверждённых прав на секреты/филиалы. Просто разрешить всем ручным читателям POST нельзя.

### P1 — повторный импорт уничтожает исходное наблюдение

Место: `deploy/v52/overrides/app/api/integrations/alfacrm/route.ts:587-601`.

`ON CONFLICT(remote_branch_id,module,record_id) DO UPDATE` перезаписывает payload/hash/imported_at. После импорта одного ID с `Before`, затем с `After`, SQLite содержит только одну запись. История источника и происхождение предыдущих проекций утрачиваются, что нарушает D-036 и инвариант append-only raw из AGENTS.md. Нужны неизменяемые наблюдения и отдельная текущая проекция с привязкой к import batch/observation.

### P1 — успешный refresh не убирает выбывших учеников из действующей базы

Места: `deploy/v52/overrides/app/api/integrations/alfacrm/route.ts:451-478,329-356,605-647,649-679,716-742`.

Загрузка выбирает только активные записи (`is_study: 1`, `removed: 0`) и делает исключительно upsert. Воспроизведение: импортировать ученика, затем выполнить полный успешный импорт families с пустым ответом. API возвращает успех, а ребёнок остаётся `Активна`. Аналогичная схема затрагивает сотрудников, группы и членство: отсутствующие в завершённом snapshot записи не помечаются выбывшими. Требуется reconciliation только после доказанно полного snapshot конкретного выбранного scope; отсутствие в неполном/упавшем чтении нельзя трактовать как удаление.

### P2 — завершённый импорт сохраняет preview token, обновление абонементов может ничего не прочитать

Места: `deploy/v52/overrides/app/api/integrations/alfacrm/route.ts:305-325,343-355`; `deploy/v52/overrides/app/components/AlfaCrmSetupWizard.tsx:330,355`.

`...storedModule` сохраняет preview token/signature после завершения. UI разрешает «Обновить выбранный блок» по наличию токена. Для subscriptions курсор уже стоит в конце списка, поэтому повторное обновление может завершиться успешно с нулём прочитанных клиентов. Поведенческий тест подтвердил сохранение токена после `complete: true`. Завершение должно потреблять preview; оставлять его можно только между незавершёнными пакетами одного подтверждённого импорта.

### P2 — разрешённый порядок staff → groups → families оставляет группы без учеников

Места: `deploy/v52/overrides/app/api/integrations/alfacrm/route.ts:339,938-942`.

Groups требуют только staff, а восстановление membership вызывается только после groups. Позднейший families создаёт карточки, но membership не пересчитывает. Тест зависимости подтвердил разрешение groups при отсутствующем families. Нужен либо обязательный families до groups, либо повторное безопасное согласование membership после завершения каждого относящегося к нему импорта.

## Проверенные защитные границы

- CRM-финансы пишутся в `alfacrm_finance_snapshots`; контрольная операция не создала банковскую `financial_operations`. Положительная сумма с refund `pay_type_id=5` осталась списанием.
- Импорт staff создал сотрудника с `Доступ не выдан` и не обращался к таблицам пользователей, системных доступов или credentials.
- Endpoint проверяет HTTPS и допустимые AlfaCRM hostname, запрещает userinfo, путь, query, hash, произвольные хосты. Контрольные отрицательные примеры прошли.
- Реальный транспорт задаёт `redirect: "error"`; контрольный тест это подтвердил. Ключи передаются существующему credential helper, в публичный state не включаются. Шифрование самого существующего helper отдельно не тестировалось.
- Сопоставление веток валидирует существующие remote ID и активные local ID в момент сохранения. Полный цикл смены tenant/повторного remap и конкурентные импорты этим ревью не покрыты.
- Пагинация прочитана: `page=0`, `pageSize=500`, предел 120 страниц; остановка при повторном fingerprint возвращает уже прочитанный массив без отдельного признака неполноты. Доказательства полноты живого snapshot нет. Это необходимо проверить при исправлении lifecycle, до включения live gate.

**GitHub CI, остановившийся до steps, является отдельным инфраструктурным препятствием. Он не объясняет и не устраняет перечисленные дефекты интеграции.**
