---
project_id: ARTHELLO
document_type: library_index
status: review
lifecycle_state: active
owner_role: SUPPORT_OWNER_ROLE
approver_role: OWNER
version: 1.0.0
effective_at:
review_at: 2026-08-26
source: consolidated_project_sources
---

# ArtHello OS — библиотека проекта

Это единая навигационная точка по утверждаемым знаниям, решениям, архитектуре и эксплуатационным материалам проекта `ARTHELLO`.

## Статус

- Библиотека создана 26 июля 2026 года.
- Реальные клиентские каналы не подключены.
- Автоматические внешние действия запрещены.
- Production-gate закрыт.
- «Школа 1–11» не входит в этот контур.

## Разделы

| Раздел | Содержание |
|---|---|
| [00_governance](00_governance/) | Границы проекта, управление документами, AI-контракты |
| [01_vision_strategy](01_vision_strategy/) | Мастер-план, стратегия и исследования |
| [02_product](02_product/) | Продуктовые границы и дорожная карта |
| [03_architecture](03_architecture/) | Company OS Entity Model и расширения ArtHello |
| [04_data_integrations](04_data_integrations/) | Источники истины и интеграционные правила |
| [05_sales_service](05_sales_service/) | Front Office, продажи и клиентский сервис |
| [06_knowledge_base](06_knowledge_base/) | Управление знаниями, фактами и источниками |
| [07_decisions](07_decisions/) | Принятые и открытые решения |
| [08_qa_tests](08_qa_tests/) | QA, тестовые ворота и известные блокеры |
| [09_operations](09_operations/) | Эксплуатационные документы и импорт из рабочей ветки |
| [99_archive](99_archive/) | Устаревшие, заменённые и только исторические материалы |
| [templates](templates/) | Шаблоны новых документов и записей |

## Канонические документы

1. [Граница проекта](00_governance/project-boundary.md)
2. [Правила библиотеки](00_governance/document-governance.md)
3. [Стандарт AI Process Contract](00_governance/ai-process-contract-standard.md)
4. [Продуктовый контур](02_product/product-scope.md)
5. [Универсальная модель сущностей](03_architecture/company-os-entity-model-v1.md)
6. [Расширения ArtHello](03_architecture/arthello-domain-extensions.md)
7. [Машинный реестр сущностей](03_architecture/entity-registry.yaml)
8. [Снимок реализованной схемы PR №1](03_architecture/implemented-schema-inventory-pr1.md)
9. [Карта источников истины](04_data_integrations/source-of-truth-map.md)
10. [Снимок покрытия данных](04_data_integrations/data-coverage-snapshot-2026-07-26.md)
11. [Правила интеграций](04_data_integrations/integration-rules.md)
12. [ArtHello Front Office](05_sales_service/front-office.md)
13. [Таксономия обращений](05_sales_service/intent-taxonomy.md)
14. [Маркетинг и воронка](05_sales_service/marketing-funnel.md)
15. [Карточка и handoff](05_sales_service/ticket-card-and-handoff.md)
16. [Проект SLA и эскалаций](05_sales_service/sla-escalation-draft.md)
17. [Управление базой знаний](06_knowledge_base/knowledge-governance.md)
18. [Реестр источников](06_knowledge_base/source-inventory.md)
19. [Принятые решения](07_decisions/accepted-decisions.md)
20. [Открытые решения](07_decisions/open-decisions.md)
21. [Ворота качества](08_qa_tests/quality-gates.md)
22. [Тестовый каталог ArtHello — 100 сценариев](08_qa_tests/arthello-scenario-catalog-100.md)
23. [Известные блокеры](08_qa_tests/known-blockers.md)
24. [Состояние репозитория](09_operations/repository-state.md)

## Иерархия статусов

- `approved` — утверждённый документ.
- `review` — готов к проверке, но ещё не является политикой.
- `draft` — рабочий материал.
- `partial` — подтверждена только часть содержания.
- `blocked` — применение запрещено до устранения блокера.
- `superseded` — заменён новой версией.
- `archived` — исторический источник.

Документ со статусом `draft`, `review`, `partial` или `blocked` нельзя использовать как основание для внешнего обещания клиенту.

## Что не хранится в Git

- реальные клиентские сообщения и вложения;
- персональные данные детей и семей;
- полные банковские операции;
- зарплатные ведомости и платёжные реквизиты;
- API-ключи, токены и OAuth-секреты;
- необезличенные выгрузки AlfaCRM;
- материалы других проектов.

Для таких источников в Git хранится только безопасная запись в реестре.
