# AlfaCRM: сохранённый выбор и совместимость с workerd

## Установленные факты

Старая v52 `IntegrationWorkspace.ConnectionWizard` сохраняла для AlfaCRM адрес,
номер удалённого филиала (`accountScope`), локальный `branchId`, `startDate` и
`dataScopes` в `integration_setup:INT-T-ALFACRM`. Поле секретного значения было
только у банков; `integration-actions.saveSetup` отвергал непустой credential
для AlfaCRM. `prepareIntegrationSetup` присваивал такому подключению
`secretStatus=external_required`. Этот выбор не подтверждал авторизацию.

Отдельный старый Express backend использовал переменные `ALFACRM_DOMAIN`,
`ALFACRM_EMAIL`, `ALFACRM_API_KEY` (`artifacts/api-server/src/lib/alphaCrmClient.ts`
в immutable main `9e4c49161e643997fe821a91b84c60c6e38ede33`). Текущий v52 runtime
их в worker не передаёт. Значения переменных и credentials при этой работе не
читались. Их возможное наличие не подтверждает ни действительность, ни ротацию.

Новый connector использует `alfacrm_connector:v1` и отдельный encrypted credential:

```
integration_credential:v2:INT-T-ALFACRM:ARTHELLO:ALFACRM-V2
```

Plaintext внутри AES-GCM envelope имеет формат JSON `{email,apiKey,appKey}`.
Расшифровку выполняет существующая серверная `readIntegrationCredential` с AAD,
включающим connection/scope/kind. Перенос ciphertext в другой scope несовместим
с этой привязкой; неизвестный старый формат автоматически не принимается.

Требование перевыпуска имеет фактическое основание: `DECISIONS.md` D-026 фиксирует
раскрытие AlfaCRM API/X-APP keys в переписке/скриншотах. D-010 сохраняет production
gate, D-021 описывает временные auth/metadata probes, D-031 — отдельную sandbox
для чтения. D-068 задаёт выборочный inbound-import. Этот delta не отменяет решений.

## Исправления

- При отсутствии staged-state старые параметры читаются как неподключённый
  черновик; ключ не расшифровывается, внешних запросов нет, старая запись не меняется.
  Предыдущие дата и список выбранных данных видны в новом мастере.
- После настоящего v2api login и получения активных удалённых филиалов старая
  пара восстанавливается только для того же tenant, точного remote ID и
  существующего активного local ID. Другой tenant не наследует филиал и даты.
  Явно неактивные remote branches исключаются. Уже существующий staged-state
  имеет приоритет перед старыми параметрами.
- Реальный workerd отвергает `redirect:error` до сетевого запроса. Transport
  теперь использует `manual`, явно отклоняет любой HTTP 3xx и не отправляет
  credential/token на адрес из Location. Список разрешённых хостов и API paths
  не расширен.
- GET сообщает `importEnabled` и понятную причину закрытого импорта. Мастер
  сохраняет подключение/предпросмотр, но отключает кнопку импорта до server gate.
  POST независимо возвращает 409 при закрытом gate. Английское сообщение о
  coverage/integrity убрано из ответа пользователю.

- Raw override содержит ровно один INSERT кандидата объединения семей. Staged
  build-hook вставляет его только при отсутствии actual `env.DB.prepare` INSERT.
  Повторное выполнение hook не добавляет повторных D1-записей; raw UI не содержит
  комментариев, которые добавляются только при сборке.

## Безопасная проверка наличия на сервере

Следующий read-only SQL возвращает только признаки наличия и число envelopes.
Он не читает/возвращает `state_value`, ciphertext, e-mail, ключи или списки людей.
Выполнять только в уже известной рабочей БД ArtHello OS, не искать чужие контейнеры.

```sql
SELECT
  EXISTS(SELECT 1 FROM system_runtime_state
    WHERE state_key='integration_setup:INT-T-ALFACRM') AS legacy_setup_present,
  EXISTS(SELECT 1 FROM system_runtime_state
    WHERE state_key='alfacrm_connector:v1') AS staged_state_present,
  EXISTS(SELECT 1 FROM system_runtime_state
    WHERE state_key='integration_credential:v2:INT-T-ALFACRM:ARTHELLO:ALFACRM-V2')
    AS staged_credential_present,
  (SELECT COUNT(*) FROM system_runtime_state
    WHERE state_key LIKE 'integration_credential:v2:INT-T-ALFACRM:%')
    AS alfa_credential_envelope_count;

SELECT EXISTS(SELECT 1 FROM sqlite_master
  WHERE type='table' AND name='alfacrm_import_records') AS legacy_raw_table_present;
```

Только если последний признак равен 1:

```sql
SELECT COUNT(*) AS legacy_raw_record_count FROM alfacrm_import_records;
```

Непустая старая raw-таблица имеет самостоятельный import gate: необходима
проверенная миграция без придумывания lineage. Этот delta raw/projections не меняет.

Проверка env допускает только три boolean: `ALFACRM_DOMAIN`, `ALFACRM_EMAIL`,
`ALFACRM_API_KEY` установлены/не установлены — внутри известного runtime и, если
он существует, известного legacy backend. Не выводить `env`, `docker inspect`
или содержимое конфигурационных файлов целиком. Env/envelope presence и
`updatedAt` сами по себе не являются evidence перевыпуска ключа.

## Путь до выборочной синхронизации

1. После публикации проверить owner GET: старый выбор сохранён, неподтверждённый
   доступ не назван подключённым, состояние import gate отображается честно.
2. Подтвердить наличие нового защищённого credential и evidence его перевыпуска.
   Если есть только старая форма, e-mail/API key в ней никогда не сохранялись.
   Подключить новый credential через owner-only форму, которая сначала проверяет
   login и branches и лишь затем шифрует значение. Наличие неизвестного envelope
   или старых env не подменяет этот шаг.
3. Сверить восстановленную пару филиалов и дату перехода. Снять preview выбранных
   модулей, проверить полноту, отсутствие чужих филиалов и связи. Соблюдать
   зависимости сотрудников/групп/занятий и семей/абонементов/оплат; полный цикл
   проверить в отдельной контролируемой копии БД до рабочего импорта.
4. После evidence ротации и проверки данных, backup и проверки отсутствия legacy
   raw-блокера включить существующий `ALFACRM_IMPORT_ENABLED` в runtime. Импорт
   по одному модулю требует свежего preview с теми же параметрами. Сверить counts,
   lineage и повторный импорт; CRM-оплаты не должны появиться в банковском ДДС.

Автосинхронизация AlfaCRM этим delta не реализуется и не объявляется действующей.
Проверка на реальном tenant и production import этой работой не выполнялись.

## Проверки

- Existing lifecycle + staged suite: 39/39 PASS.
- Новый legacy rollout suite: 13/13 PASS, включая реальные GET/POST с SQLite,
  отказ при неверном tenant/филиале/auth, сохранность legacy и закрытого gate.
- Настоящий Miniflare/workerd вызывает исходную `alfaFetch`: HTTP 200 проходит,
  HTTP 302 отклоняется, upstream вызван ровно один раз, Location не запрашивается.
- Repeat-assembly regression: 2/2 PASS. Старый hook: 2/2 FAIL (RED); исправленный
  hook: 2/2 PASS. Для current и legacy missing-insert fixtures настоящий hook
  запускается трижды, output route/wizard/shell после первого запуска неизменен.
  Выполненная canonicalizeFamilies отправляет ровно один candidate write и три
  lineage writes; UPSERT не маскирует повторную отправку.
- Всего 54/54 targeted tests PASS на повторно собранном candidate.
- Targeted ESLint: PASS. Production Vinext build: PASS.

Ни один credential или production record не извлекался. Публикация, изменение
gate и production migrations не выполнялись этим агентом.
