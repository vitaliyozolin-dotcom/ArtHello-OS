# Проверка продолжения выпуска R6 — 2026-09-08

Статус: подготовка кандидата. Новая версия ArtHello не опубликована; шесть сценариев целиком не приняты.

Исходная версия main: c9e7da06f7d3637c0032af542085f28acb02816a. Предыдущий R5 ee8f3080d941a12be357eec0fd1d902acd01a2f9 успешно восстановил ограниченную связь School, но остановился до image/clone/cutover: run34208952716/job102005327418. Фактические receipt и диагностика сохранены в codex/recovery-evidence-20260907. Новая ветка обязана сохранить оба concurrent lazy configuration commits.

| Сценарий | Подготовленная реализация и доказательства | Что ещё требуется в проде |
| --- | --- | --- |
| Точка и ДДС | Внутренний scheduler, повтор незавершённых выписок, leases/поколение credentials, идемпотентность; запуск только после release-bound activation | Получить реальные счета/остатки/выписки; сверить количество и суммы операций с банком; повтор не создаёт дубликатов; проверить автоматический следующий запуск |
| Обучение → дневник | Actual School R5 relay verified; DNS/TLS200 из School; образ/исходник/StartedAt School сохранены | Настоящий авторизованный переход через Обучение до cutover и повтор после выпуска; health200 не заменяет вход |
| Доступы персонала | Модульные server gates, branch scopes, session refresh; existing permission tests | Реальные разрешённые/запрещённые разделы под ограниченным сотрудником; скрытие меню, прямой API403 и межфилиальная изоляция |
| Обращения разработчикам | Постоянная кнопка, сохранение формы, owner backlog, server author/CSRF/audit/idempotence | Сохранить обращение из UI, повторно открыть после reload, увидеть его в owner backlog и проверить изменение статуса |
| Выборочный AlfaCRM импорт | Последовательность выбранных этапов; unknown balance/incomplete success/TTL fixes; R6 исправляет денежный источник и семейный показ | Реальные сохранённые credentials/покрытие/филиалы; выбранные этапы без всей истории; повторяемость и карточки; payment type mapping не считается известным без источника |
| Ручные/ежедневные бэкапы | Online SQLite backup, отдельное восстановление и content/schema/count checks, owner UI, restricted Unix socket; actual hosted socket PASS | Проверить gateway install capability, установить, получить restoreVerified manifest, выполнить ручной запуск из UI, проверить timer/следующий запуск и фактическую автоматическую копию |

R6 не переустанавливает и не переписывает метки исправного R5 relay. Install SHA School и candidate SHA ArtHello остаются разными явно проверяемыми полями. Прежние controllers/guards сохраняются. Before-cutover clone, проверенный backup, durable public-write marker и запрет restore поверх новых записей остаются обязательными.

При подготовке browser повторно вернул502/Connection refused. Это ограничение фактически наблюдаемого браузера, а не доказательство отказа публичного сервера. Никаких session injection, искусственно собранных callback URL или выдуманного natural SSO PASS не выполнялось.

Финальная приёмка требует exact PR/main Quality/Proof/Verify и immutable image/provenance, read-only actual installed-R5/capability evidence, настоящего natural SSO, фактического guarded cutover и проверки пользовательских сценариев. Результаты будущих запусков сюда не подставляются как уже выполненные.
