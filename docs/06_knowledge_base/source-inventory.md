---
project_id: ARTHELLO
document_type: source_inventory
status: review
lifecycle_state: active
owner_role: KNOWLEDGE_OWNER
approver_role: OWNER
version: 1.0.0
effective_at:
review_at: 2026-08-26
source: library_and_repository_inventory
---

# Реестр найденных источников

## Перенесены как исходные материалы

| Источник | Категория | Статус |
|---|---|---|
| `ArtHello_OS_Master_Plan_and_Agent_Prompts_v0.1.md` | Мастер-план | historical_source |
| `ArtHello_Education_Market_Intelligence_Agents_v1.md` | Исследовательские AI-процессы | historical_source |
| `ArtHello_market_strategy_2026_2030.xlsx` | Рыночная стратегия | research_source |
| `ARTHELLO_FRONT_OFFICE_AGENT_REVIEW_2026-07-26.md` | Продажи и сервис | review |
| Эксплуатационные документы ветки PR №1 | Код, аудит, runbook | snapshot |

## Найдены, но не переносятся целиком

| Тип источника | Причина | Действие |
|---|---|---|
| Смешанные межпроектные support-пакеты | Нарушение проектной изоляции | Созданы ArtHello-only выжимки |
| Старые ZIP-архивы исходного кода | Дублирование Git-истории | Зафиксированы в инвентаре, код ведётся в репозитории |
| Необезличенные выгрузки AlfaCRM | Персональные данные | Только защищённое хранилище |
| Зарплатные таблицы | Персональные и финансовые данные | Только защищённый источник и нормализованные записи |
| Банковские выписки | Финансовые данные | Только защищённое хранилище |
| Секреты интеграций | Критический риск | Secret manager, ротация |
| Исторические договоры и политики без версии | Возможная устарелость | Триаж и подтверждение владельцем |

## Известные отсутствующие канонические источники

- действующий каталог филиалов;
- действующий каталог программ;
- текущие цены;
- пропуски, отработки и заморозки;
- возвраты и скидки;
- получение ребёнка;
- права нескольких представителей;
- SLA и графики;
- identity verification policy;
- data retention policy;
- emergency playbook;
- compensation matrix.

