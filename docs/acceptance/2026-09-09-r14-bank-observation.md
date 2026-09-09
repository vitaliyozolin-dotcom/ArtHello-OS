# D099 — Проверка сохранения операций Точки

Статус: DRAFT / BLOCKED для merge и production-наблюдения. R14 ещё не принят; production pins в новом consumer proof намеренно не заданы. CI и локальные fixtures не являются production evidence.

## Зачем

Последний фактический D075 отчёт от 2026-09-09T17:30:05.531Z видел четыре счёта, 12 READY imports и ноль банковских/финансовых операций. Сбой происходил на sync_commit; конкретное исключение неизвестно. PR397 исправил несогласованную account-scoped уникальность и добавил фиксированный commitFailureKind. Нужно проверить результат на принятом runtime и сопоставить деньги банка со связанными строками ДДС.

## Ограниченная проверка

- Новый R14 consumer helper проверяет actual public runtime и sealed adoption через закреплённые R14 adapters, сохраняет старый backup reader и полный consumer inventory. Все семь acceptance pins берутся только из будущего фактического успешного receipt. Пока они отсутствуют, helper отказывает до чтения данных.
- D075 producer возвращает только целые агрегаты, фиксированные состояния и уже разрешённые даты. Новые суммы — копейки, только Booked RUB за окно с 2026-09-01 по дату наблюдения. Ручные и кассовые операции, не связанные с выбранными банковскими строками, в эти суммы не входят.
- Приёмка требует прежнего полного покрытия четырёх счетов, свежего успешного sync, настоящих операций и отсутствия замечаний, плюс равенства income/expense totals банка и связанных financial rows. Проверяются сумма, направление, дата, юрлицо, банковская ссылка, источник и отдельная финансовая строка для каждой банковской.
- D097 duplicate key включает connection/account/provider transaction. Повтор provider ID на другом счёте допустим; повтор внутри счёта и отсутствующий account/transaction ID не допускаются.
- commitFailureKind выводится только как фиксированный enum при outcome=error и failureStage=sync_commit. Отсутствующие, произвольные и несовместимые значения не отражаются как ошибка банка.
- Launcher проверяет новую форму отчёта и запрещает complete при несогласованных суммах/связях. Before/after runtime proofs, read-only mount, D1 identity, owner/current-main/Quality/attempt1 gates и оба production locks сохраняются. Нет bank calls, SQL writes, resync или изменения auth/scope/lease/backoff.

## Выполненные проверки

Локально: 49 Node aggregate tests, 24 Python launcher tests, 33 R14 consumer tests — PASS. Новые регрессии перед исправлением были RED. Тесты используют синтетические данные; исторический D088 fixture не переписан. Реальное production наблюдение и exact-head hosted CI этого draft ещё не выполнены.

## Факты о доставке

R14 PR398 объединён в source d44137d8342b7eacec510f9f70ffeba6c3bf4f3a, tree 6f6a1c26d9a5b2c8a78eb2d942b6720c453484af. Protected run34391105865 attempt1 завершился failure 2026-09-09T19:15:01Z: скачанный браузерный архив не прошёл ожидаемый SHA256 (SERVER_BROWSER_BLOCKED=import_archive_identity). Docker import и cutover не начинались, обе cleanup steps завершены success. Actual job graph прошёл неизменённый pre-cutover retry validator; attempt2 запущен без изменения source/main. Это не успешная банковская приёмка.

## Осталось до merge

1. Дождаться terminal R14 и реальных candidate/after-public receipts; не менять main во время выпуска.
2. Закрепить actual run/resource attempt/accepted attempt, image/fingerprint, candidate container и context digest. Записать фактическое состояние backup и School. Если R14 не принят, этот draft остаётся заблокированным.
3. Проверить окончательный SHA/tree/diff и обязательные exact-head CI. Технический merge prefix — D075: read-only production data; сохранить main до terminal protected observation.
4. Прочитать фактический отчёт. При ожидании nextAtUtc сохранить обычный backoff; при incomplete_or_issues сохранить exit2 и продолжить по конкретному фиксированному сбою. Завершить банковскую задачу только по реальным операциям и равным суммам.
