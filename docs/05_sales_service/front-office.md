---
project_id: ARTHELLO
document_type: product_spec
status: review
lifecycle_state: active
owner_role: FRONT_OFFICE_OWNER
approver_role: OWNER
version: 1.0.0
effective_at:
review_at: 2026-08-26
source: front_office_agent_review
---

# ArtHello Front Office

## Решение

`REVISE → GO` для внутреннего офлайн-MVP. `HOLD` для каналов, автоответов и внешних действий.

Нужен встроенный раздел `Продажи и сервис`, а не универсальная копия Bitrix24 или amoCRM.

## Воронка

`NEW → QUALIFIED → PROGRAM_MATCHED → TRIAL_OFFERED → TRIAL_BOOKED → TRIAL_ATTENDED → CONTRACT_OFFERED → WON / LOST`

`PAYMENT_RECEIVED` — отдельное подтверждённое событие банка.

## Обязательные поля активной возможности

- ответственный;
- следующий шаг;
- срок;
- программа или интерес;
- филиал или район, если известен;
- дата последнего содержательного касания;
- неизменяемая история переходов.

## Сервисный тикет

`NEW → WORKING → WAITING_CUSTOMER / WAITING_INTERNAL → RESOLVED → CLOSED`

Повторное обращение по нерешённой теме переоткрывает тикет.

## AI в MVP

Разрешено:

- классифицировать;
- предложить недостающие вопросы;
- подобрать до двух программ;
- подготовить черновик;
- создать внутреннюю задачу;
- создать knowledge gap.

Запрещено:

- отправить сообщение;
- изменить AlfaCRM;
- записать ребёнка;
- объединить семью;
- изменить договор или деньги;
- выдать скидку;
- опубликовать знание;
- обработать P0/P1 без человека.

Полная исходная проверка: [ARTHELLO_FRONT_OFFICE_AGENT_REVIEW_2026-07-26.md](sources/ARTHELLO_FRONT_OFFICE_AGENT_REVIEW_2026-07-26.md).

