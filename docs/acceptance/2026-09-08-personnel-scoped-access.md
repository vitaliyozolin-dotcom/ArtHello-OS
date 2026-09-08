# ArtHello v52: ручные разрешения и область чтения, 2026-09-08

Статус: заморожен локальный scoped-кандидат. Production deploy и production-приёмка этим агентом не выполнялись. Полную сборку и весь набор тестов объединённой версии выполняет интегратор.

Основа: локальный arthello-build, main 9e4c49161e643997fe821a91b84c60c6e38ede33 плюс PR348/351/352. Shared source/build не изменялись; push/merge/deploy не выполнялись.

## Существенные дефекты и исправления

1. P1: галочка показывала раздел, однако 10 GET повторно отклоняли чтение по устаревшему набору ролей. Политика canAccessApi уже разрешала явно назначенное чтение по D-050. Обработчики теперь проверяют общую политику до чтения данных; mutation-права и специальные допуски не расширяются.
2. P1, найден при дополнительном review: простого удаления read-role guard недостаточно. HR читал все филиалы, произвольные entity metadata и связанные финансовые операции. Первоначальная версия кандидата с одним изменением guard отозвана и заменена этим scoped payload. Пустые handler fixtures не доказывали безопасность содержимого ответа.
3. P2: открытая вкладка сохраняла старую навигацию после отзыва сессии. ProductionAuthGate обновляет сессию раз в 60 секунд в активной вкладке, при фокусе/возвращении из скрытого состояния; 401/403 закрывает интерфейс. Shell использует текущие allowedModules из auth context. Дедупликация запросов и dispose предотвращают восстановление старой сессии поздним ответом; сетевая ошибка не выдаёт новые права.

## Область нового чтения

| Контур | Применённая граница |
| --- | --- |
| HR | Для всех пользователей кроме канонического владельца: только действующие филиалы из актуальных userBranchAccess; administrative получает все действующие. Сотрудник с branchIds виден только при доступе ко всем его указанным филиалам. Неизвестные/неактивные/пустые/неправильные назначения скрываются. При отсутствии branchIds допускается точный ID либо уникальное название действующего филиала в unit. Вакансии → кандидаты → интервью и связанные записи сотрудников фильтруются до агрегатов. Метаданные ограничены строковыми contact/position/employmentType и подтверждёнными филиалами. Документы и payroll non-owner скрыты: связь с сотрудником не доказывает отдельную финансовую/юридическую область. |
| Strategy | Для новых явно назначенных ролей goal.unitEntityId должен точно совпасть с разрешённым действующим branchId; связанные KPI/инициатива/проект/event/result/deviation проверяются по согласованному графу. budgetId скрыт. Показатели и цепочка считаются после фильтрации. |
| Legal | Новым явно назначенным ролям видны только responsibility zones с доказуемым scope филиала и имена связанных ответственных. zone.contractId очищен. Зона не доказывает право на договор, его текст или юридическое лицо: такие записи скрыты. |
| Accounting | Для новых ролей нет доказанного независимого сопоставления документов/проводок с разрешённой областью филиала и юридического лица. Необоснованные записи исключены, раздел возвращает честное объяснение границы. |
| Analytics | Новым ролям общие межконтурные записи не раскрываются без row scope; агрегаты строятся из пустого разрешённого набора, отключён синтетический стартовый остаток и demo bootstrap. |
| Readiness / Acceptance | Новым ролям общие owner decisions и неподтверждённые проверки не раскрываются. Разделы открываются с объяснением; productionReady=false. Checkbox не даёт право принять релиз. |

Во всех контурах кроме HR уже действовавшие native-role модели чтения сохранены. requiresAssignedReadScope определяет дополнительное чтение относительно той же общей политики без ручных allowedModules. Общий helper разрешает имена только при единственном действующем каталожном совпадении; известный запрещённый ID нельзя переинтерпретировать как название другого филиала.

Procurement/Food scoped-графы реализованы alfa_finish, Safety — tochka_auto_finish. Их старые маршруты удалены из этого payload, чтобы не затереть новые scoped версии. Integrations — в кандидате alfa_finish. Этот агент их финальный код не сертифицирует.

## Проверки замороженной версии

- node --test tests/scoped-section-handler.test.mjs tests/section-assignment-contract.test.mjs tests/session-refresh.test.mjs: **103/103 PASS**, лог scoped-targeted.log.
- Матрица: 21 роль × 24 раздела, выключенные галочки, прямой hash, GET и POST endpoints, медицинский и canonical-owner допуски. Реальные GET выполняются с детерминированными session/DB adapters; отказ происходит до чтения БД.
- Наполненные fixtures проверяют EMPLOYEE/HR/DIRECTOR, owner, administrative, отсутствие grants, чужой userBranchAccess, закрытые и неизвестные филиалы, частичный multibranch, повреждённые назначения, приватные metadata/nested поля, чужое юрлицо, несогласованные Strategy links, скрытые Legal contracts и отсутствие утечек в именах/цепочках/агрегатах.
- ESLint 16 изменённых/новых файлов: **PASS**, лог scoped-eslint.log.
- tsc --noEmit: **не проходит целиком** из-за существующих cloudflare:workers declarations и readiness implicit-any, а также других baseline ошибок; новые session/scope helpers, HR/Legal/Strategy/Accounting/Analytics и UI не имеют диагностики. Лог scoped-typecheck.log. Это не заявляется как успешная общая проверка типов.
- Прежние Vinext build PASS и 596/596 full-suite PASS были получены до scoped-изменений. Они не являются доказательством сборки/приёмки этой финальной версии. Требуются fresh combined build/tests у интегратора.

## Интеграция

manifest.json содержит 16 paths/localPath/SHA-256/baseSHA-256. Замороженный код находится в payload/deploy/v52/overrides.

ArtHelloShell.tsx в payload собран с двумя строками DeveloperFeedback из PR352. В raw main override нужно применить только permission delta (удалить старый assignedModules state/setter, брать allowedModules из authenticatedUser); затем дать штатному PR352 patch добавить DeveloperFeedback. Все остальные исходные файлы основы были идентичны raw main до наших изменений. access-policy.ts и SettingsWorkspace здесь не меняются.

## Конкретные незакрытые ограничения

- В Accounting/Analytics/Readiness/Acceptance для новых ролей, а также в финансовой/договорной части HR/Legal нет полноценного подтверждённого контракта row scope. Выданная галочка открывает интерфейс, но не обещает доступ к ещё не привязанным записям. Для полезной работы с ними нужен отдельный явный договор области данных; скрытие не считается полной бизнес-приёмкой.
- Предсуществующие finance/entities/sales и весь cross-module row scope не входят в этот ограниченный review. Их безопасность не заявляется этим отчётом.
- quality-gates/permission-matrix.json относится к legacy Express owner/accountant/viewer, не к v52 21-ролевой модели; файл не переписывался. В v52 фактический контракт — canAccessModule/canAccessApi/resolveModuleRoute, функции isSectionAccessible нет.
- Нужны проверки опубликованного exact commit под владельцем и ограниченным сотрудником. Локальные fixtures не подтверждают production SSO, банковскую синхронизацию или фактический deploy.

## Независимый review Backup

Проверены owner/CSRF API guard, ограниченный JSON body, фиксированный Unix transport и systemctl args без shell, queued202 против подтверждённого restore-manifest, PR350 online SQLite backup/restore evidence. Конкретных обходов owner/CSRF или command injection не обнаружено в рассмотренном коде.

Найденные P1 stale runtime-directory socket после рестарта/reboot и P2 non-object manifest, ломающий весь status, переданы backup_ui_finish и исправлены им: постоянный StateDirectory /var/lib/arthello-v52-backup-control и dict-validation. Повторно проверено 11 Python bridge tests PASS. PR350 backup tests ранее 10 PASS. Реальная проверка container bind-mount/service restart в этой локальной среде не выполнена; это отдельный deployment gate. Сохранность School/offsite/ключей данным DB-backup не заявляется.
