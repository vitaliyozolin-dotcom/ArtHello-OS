---
name: migration-check
description: Проверка целостности системы миграций drizzle — паритет journal/snapshots, rollback-companions, прогон migration-twin, конфликты с ручным migrate.ts. Использовать перед созданием/изменением миграций и при любых правках lib/db/schema.
---

# Проверка миграций

Контекст проекта: в репо **две** системы миграций (известная проблема MIGR/MIGR2 в REFACTORING_PLAN.md): drizzle-kit в `lib/db/drizzle/` (целевая, единственный будущий авторитет) и ручной `artifacts/api-server/src/lib/migrate.ts`, выполняющий raw SQL при старте сервера. До завершения Фазы 2 плана обе живы — любое изменение схемы обязано учитывать обе.

## Чек-лист

1. **Паритет journal/snapshots**: число записей в `lib/db/drizzle/meta/_journal.json` == число `NNNN_snapshot.json` в `lib/db/drizzle/meta/`. Известный дефект: journal 0000–0017, snapshots до 0015 — если не починено, любой `drizzle-kit generate` даст неверный diff. Проверить первым, при расхождении — **BLOCKED** для генерации новых миграций.
2. **Rollback-companions**: на каждую миграцию `lib/db/drizzle/NNNN_*.sql` начиная с 0009 существует `lib/db/rollbacks/NNNN_*.down.sql`. Перечислить отсутствующие.
3. **Barrel-полнота**: каждая схема из `lib/db/src/schema/*.ts` реэкспортируется в `lib/db/src/schema/index.ts` — иначе её таблицы не попадут в `drizzle-kit generate` (известные сироты: `messages.ts`, `conversations.ts`).
4. **Конфликт с migrate.ts**: если меняется таблица/индекс — grep её имя в `artifacts/api-server/src/lib/migrate.ts`. Пересечение = риск двойного/противоречивого DDL при старте сервера; зафиксировать в отчёте.
5. **migration-twin**: при наличии `DATABASE_URL` (или тестовой БД) прогнать
   ```bash
   node lib/db/scripts/migration-twin.mjs
   ```
   и приложить вывод. Без БД — явно отметить «twin не прогнан: нет TEST_DATABASE_URL» (не заявлять успех, которого не было — правило QA-A4-02).
6. **Append-only инварианты**: миграция не должна нарушать D-036 (`alpha_raw_records` append-only, триггеры против UPDATE/DELETE) и не должна содержать деструктивных операций без rollback-плана и бэкапа.
7. **CI-гейт**: `proof-gates.yml` триггерится на `lib/db/drizzle/**` — новая миграция обязана пройти его; ничего не мержить с красным twin.

## Вывод

Таблица: пункт → статус (OK / FAIL / SKIPPED-с-причиной) → доказательство (команда/файл). Вердикт в терминах Ревизора: PASS / CONDITIONAL PASS / FAIL / BLOCKED. Новые миграции при несходящемся паритете snapshots — всегда BLOCKED.
