# D102 — Проверка операций Точки и связанных сумм ДДС

Статус: R15 принят; первый D075 report получен. Банк пока не принят. После разрешённого владельцем ручного запуска подготовлен новый read-only report с фиксированной классификацией сохранённого результата; его окончательные review/CI и protected execution ещё необходимы.

## Фактическое первое наблюдение и ручной запуск

PR399 объединён squash-коммитом `bb28bc3644bdcff83d469bb621dafac74621ffee`, tree `2bfd9b4da7e6e51a9380f141564cf1057c594504`. D075 run `34449887309`, attempt1, job `102782982388` получил actual report в `2026-09-10T07:26:42.160Z`: четыре счёта, 12 READY imports, ноль bank/financial rows; retainedJobs4 с более ранним концом окна. Autosync сохранял ошибку от 04:02:22Z до установки R15, failures8 и nextAt10:02:22.834Z; lease released. Exit2 обозначает завершённое наблюдение incomplete_or_issues, не ошибку read-only SQL и не банковскую приёмку.

Владелец затем явно разрешил штатную ручную синхронизацию и предоставил скриншоты карточки и сообщения «Точка не подтвердила доступ к готовой выписке» (на экране 11:35). Это новое UI evidence, но не конкретный HTTP status и не доказанная причина. Accepted source показывает, что сообщение возникает при неуспешном statement GET вне веток 401/403/429; локальный transport также может вернуть 502. При 404/410 старая pending reference удаляется штатным fenced store, но факт такого ответа здесь пока не доказан.

Новый observer добавляет только latestRun.status/failureKind с точной SQL CASE классификацией существующих сообщений, не возвращая исходный текст. Tests: red2 (отсутствующие поля), green51 aggregate; отдельно проверяются неизвестные/private значения, scope последнего non-dry-run и отсутствие выдуманного HTTP status. Ни lease, ни scheduler/backoff, ни банковский runtime, ни frozen release/backup/School pins не меняются. Следующий запуск — прежний защищённый D075 с prefix, current-main/Quality/attempt1/environment и двойными locks. До terminal report main неизменен.

## Фактический выпуск

- source `4a0713b4a7d87f132e49836fe0ce9ca9258bc1ec`, tree `ac0ec2a2845eee6254ba7cf8c0e0b83d0e5848de`;
- protected run `34445017241`, resource attempt `1`, accepted attempt `1`, оба jobs success;
- image `sha256:0f15a32c9dff9cd7278a1449bd66f282abc514f0392edfd57262ed25ef247a6f`;
- runtime fingerprint `b64e4dcb206ded758f4c636c74bf42588961f2a88e044689207e9dda7939274e`;
- candidate container `3b81e98433e7d948d899fcfc1a9e94ee15faa3ef17cb1d1d4d1cb5c371ff67c7`;
- candidate context `9c4ef4d58a8a7d97835bc1f8f00cc4aad44849a8cd62b7bcd4869cce247d96ca`;
- candidate natural acceptance passed at `2026-09-10T06:29:36.391Z`; after-public passed at `2026-09-10T06:29:53.317Z`;
- live ArtHello source equals the intended source; School source `54242340f2d9b6a9887d69ecc03520ddf9f7982c` remained healthy;
- R12 backup worker `570d3fb2f96dfa7a08d0a98fbeda0d208f08c0805efcc444bc958fbabf515052`, history/control volumes and two verified backup-history entries were preserved; adoption reached sealed state.

These values come from the actual successful deploy log and state receipt, not fixtures. The browser artifact is separate from application identity and is not used as a substitute for these pins.

## Ограниченная сверка

The stable `production-data-consumers-r14.py` filename retains the R14 durable schema14 validators, but its accepted source/tree and all seven runtime pins are bound to R15. It verifies public-started state, the D063 activation, image and runtime fingerprint, live container, gateway, sealed backup adoption and canonical consumers both before and after the database probe. A refusal has no legacy fallback.

The D075 producer returns only bounded aggregates and fixed states. For Booked RUB rows in the requested window it reports integer minor-unit totals for bank income/expense and linked financial income/expense, linked-row count and mismatch count. It checks date, direction, legal entity, source and bank reference. Duplicate identity is scoped by connection, account and provider transaction. No raw transaction, counterparty, credential or exception is emitted.

## Условия принятия

The result is complete only when all four configured accounts cover `2026-09-01` through the observation date, real bank rows and separately linked financial rows exist, account-scoped duplicates/missing identities/dangling/shared links are zero, `financialMismatchRows` is zero, and bank/financial income and expense totals are exactly equal in kopecks. READY imports, a successful deploy or synthetic tests do not satisfy these conditions.

If the ordinary scheduler has not yet reached `nextAtUtc`, keep the saved lease/backoff. If it records a new error, expose only the fixed `failureStage` and, for `sync_commit`, the fixed `commitFailureKind`. Do not call the bank, reset the scheduler, resync, write SQL, restore old data or change auth/scope.

## До production-наблюдения

1. Verify the final PR head SHA/tree/diff and that no materialized application or frozen release file changed beyond current main.
2. Require exact-head Quality, Proof, V52, bounded diagnostic and R12/R13/R14/R15 continuation workflows.
3. Merge only after those checks with technical prefix `D075: read-only production data`; freeze main until the protected report and cleanup are terminal.
4. Record the actual report and decide by the fixed completeness criteria above.
