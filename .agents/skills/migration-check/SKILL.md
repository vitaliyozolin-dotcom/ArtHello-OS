---
name: migration-check
description: Проверка целостности Drizzle/PostgreSQL миграций ArtHello OS — journal/snapshot parity, rollback companions, barrel exports, конфликт migrate.ts, migration-twin и append-only инварианты. Использовать до и после правок lib/db/schema или lib/db/drizzle и при создании миграций.
---

# Проверка миграций

До завершения рефакторинга учитывать `lib/db/drizzle` и ручной `artifacts/api-server/src/lib/migrate.ts`.

1. Сопоставить `_journal.json` и `NNNN_snapshot.json`. Расхождение означает `BLOCKED` для генерации новой миграции.
2. Начиная с 0009 проверить `lib/db/rollbacks/NNNN_*.down.sql`; перечислить пропуски.
3. Сопоставить `lib/db/src/schema/*.ts` с реэкспортами `schema/index.ts`.
4. Через `rg` найти затронутые таблицы/индексы в `migrate.ts`; пересечение отметить как риск двойного DDL.
5. При тестовой PostgreSQL запустить `node lib/db/scripts/migration-twin.mjs`. Без `TEST_DATABASE_URL` пометить SKIPPED с причиной.
6. Проверить D-036, запрет UPDATE/DELETE raw-данных и отсутствие деструктивного DDL без rollback/backup.
7. Указать необходимость `proof-gates.yml`; удалённый CI проверять только когда он доступен и нужен запросу.

Выдать таблицу «пункт / OK, FAIL или SKIPPED / доказательство» и вердикт `PASS`, `CONDITIONAL PASS`, `FAIL` либо `BLOCKED`.
