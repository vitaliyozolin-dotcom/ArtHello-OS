# D109 — защищённый выпуск статей и разнесения: подготовка

Поручение Виталия: «Проверяй и выпускай в прод». D108 PR410 уже принят в source fdb93556bf3cff27849a872c3f3bba1ae712364b/tree f37059d94d65211803e29ae9a04aaaa4920a8765. Это не production receipt. Последний принятый production — R16 cb990279e070fddbfa9a0adbd21b56de25b85588, run34461449594 attempt1.

## Изолированная проверка

Существующий hosted-only Verify v52 получает дополнительный обязательный шаг после сборки точного image. Тот же app image, настоящий D1/SQLite, Chromium с проверенным sandbox, новый пустой контейнер/volume с CI label и internal network. Ни production environment/secrets, ни новые live sessions/роли не используются. Fixture требует пустых таблиц до трёх явно синтетических банковских/финансовых строк и выделенной локальной CI credential. Вход выполняется формой; session/cookie injection и API mocks отсутствуют. Фиксированный HTTPS origin отображается только на localhost контейнера; все остальные назначения и лишние POST отказывают. Исходные server responses/CSRF/разрешения и запись приложения сохраняются.

Сценарий: пустой справочник → черновик → утверждение → предпросмотр ИНН AND назначение → ручное ДДС/ОПиУ → reload → точные копейки и переход из ДДС → тот же сценарий на 390 px → архив → сохранение исторического назначения. Независимое чтение fixture DB сравнивает hash всех bank rows, связи/суммы и точное число записей аудита. Все fixtures удаляются штатным cleanup; только синтетические PNG и bounded result остаются в CI artifact.

Локально проверены синтаксис scripts и отказ seeder без fixture context. Настоящий браузерный результат ещё не получен. Cloud Browser после одного reload показывает 502 до login; это не доказательство состояния production и не повод менять доступы.

## Выпуск

Новый R17 adapter ещё не связан и не опубликован. Старые R16/15/14 controllers/pins/history не переопределяются и успешные runs не повторяются. Перед merge нужны actual R16 graph/receipts, полный reviewed новый source contract, exact-head CI и отдельный защищённый release с прежними backup/snapshot/seal/auth/current-main/identity/capacity/dual locks. После публичной границы восстановление старой БД запрещено. Проверка новой функции не создаёт выдуманные рабочие статьи и не разносит реальные платежи без утверждённого назначения.

Критерий завершения: successful R17 receipt + candidate/after-public natural acceptance + сохранённый School/backup/history + подтверждённые финансовые инварианты на bounded read-only наблюдении. Стоимость отдельного запуска неизвестна, новые платные услуги не подключаются. Ответственный — Виталий.
