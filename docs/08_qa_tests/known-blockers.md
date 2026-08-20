---
project_id: ARTHELLO
document_type: blocker_register
status: blocked
lifecycle_state: active
owner_role: TECH_OWNER
approver_role: OWNER
version: 1.0.0
effective_at:
review_at: 2026-08-05
source: github_pr_1_and_readiness
---

# Известные блокеры

## PR №1 — независимый gate

- `A4-14-01 HIGH`: raw provenance может быть уничтожен через `TRUNCATE`; lineage normalized-наблюдения не обеспечен.
- `A4-14-02 HIGH`: rollback миграции 0014 оставляет шесть foreign keys; цикл `apply → rollback → reapply` падает.
- `A4-14-03 HIGH`: stale students не каскадируются к memberships, attendance и связанным payments; возможна resurrection.
- `A4-14-04 MEDIUM`: документация webhook противоречит реализованному auth/CSRF-контракту.

Результат: `FAIL` для Phase A и production; только `CONDITIONAL PASS` для приватной обезличенной Sites-оболочки.

## Данные

- полнота AlfaCRM не доказана;
- 52 области импорта ранее оставались неполными;
- memberships и семейные кандидаты не построены;
- права представителей не подтверждены;
- snapshot нельзя считать полным.

## Политики

- нет канонического каталога программ и цен;
- не утверждены identity, retention, SLA и emergency playbook;
- не назначены все владельцы;
- `APPROVED_ACTIONS` пуст.

## Секреты

Ранее раскрытые ключи AlfaCRM и «Точки» не должны использоваться в production и требуют ротации перед запуском.

