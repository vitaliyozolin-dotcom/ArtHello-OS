# ArtHello Front Office — benchmark входящего ящика

Дата проверки: 26 июля 2026 года.

## Задача сравнения

Проверить, закрывает ли проектируемый входящий ящик рабочие задачи сильных
клиентских платформ, не копируя их историческую сложность и не ослабляя
ограничения ArtHello по детям, семье, деньгам и безопасности.

Сравнение выполнено только по официальным материалам Intercom, Zendesk, Front,
HubSpot и Salesforce. Оно не является сравнением тарифов или выбором внешнего
поставщика.

## Что считается эталонным классом функций

Ведущие системы сходятся в следующих принципах:

1. обращения из разных каналов попадают в одно рабочее место;
2. оператор видит историю разговора и клиентский контекст;
3. очередь учитывает приоритет, SLA, доступность, загрузку и навыки;
4. сотрудники могут обсуждать обращение внутри, не раскрывая комментарии
   клиенту;
5. система предотвращает одновременные конфликтующие ответы;
6. шаблоны, знания и AI помогают подготовить ответ внутри рабочего места;
7. ожидание клиента или коллеги оформляется как snooze/follow-up, а не
   теряется;
8. назначения, изменения статуса, правила и сообщения остаются в истории;
9. руководитель видит нагрузку, просрочки, качество и результат;
10. автоматизация управляется правилами и правами.

## Официальные ориентиры

### Intercom

- [AI features available in the Inbox](https://www.intercom.com/help/en/articles/6955446-ai-features-available-in-the-inbox)
  описывает Copilot, AI Compose и AI Summarize внутри inbox с использованием
  истории и базы знаний.
- [Set SLAs for conversations and tickets](https://www.intercom.com/help/en/articles/6546152-set-slas-for-conversations-and-tickets)
  описывает first/next response, close/resolution timers, office hours,
  pause-состояния, сортировку и отчётность.
- [Skill-based routing](https://www.intercom.com/help/en/articles/15858833-skill-based-routing)
  связывает распределение с навыками и balanced assignment.
- [Snooze a conversation](https://www.intercom.com/help/en/articles/6564538-snooze-a-conversation)
  возвращает разговор в работу по времени или новому ответу.
- [Get context fast with user and company profiles](https://www.intercom.com/help/en/articles/6988783-get-context-fast-with-user-and-company-profiles)
  показывает профиль и предыдущие взаимодействия рядом с разговором.

### Zendesk

- [About the Zendesk Agent Workspace](https://support.zendesk.com/hc/en-us/articles/4408821259930-About-the-Zendesk-Agent-Workspace/)
  объединяет каналы, клиентский контекст, knowledge и side conversations.
- [Understanding how omnichannel routing uses queues](https://support.zendesk.com/hc/en-us/articles/6712096584090-Understanding-how-omnichannel-routing-uses-queues-to-route-work-to-agents)
  описывает очереди по доступности, загрузке, SLA, приоритету и навыкам.
- [Setting up contextual workspaces](https://support.zendesk.com/hc/en-us/articles/4408833498906-Setting-up-contextual-workspaces)
  позволяет показывать оператору формы, приложения и релевантные macros по
  условиям обращения.

### Front

- [Front's real-time collision detection](https://help.front.com/en/articles/2403)
  показывает, когда другой сотрудник уже отвечает, и синхронизирует общий
  черновик.
- [Understanding comments](https://help.front.com/en/articles/2256)
  отделяет внутреннее обсуждение и поддерживает @mentions.
- [Understanding activity history](https://help.front.com/en/articles/2414)
  сохраняет назначения, snooze, tags, rules, merge/split и другие изменения.
- [Understanding message templates and folders](https://help.front.com/en/articles/2230)
  даёт общие сохранённые ответы для единого тона и меньшей рутины.
- [Time goal rules](https://help.front.com/en/articles/3038464)
  поднимает обращения до и после нарушения времени ответа.
- [Shared inboxes merge duplicates by default](https://help.front.com/en/articles/2265)
  уменьшает двойную обработку одинаковых входящих.

### HubSpot

- [Set up help desk](https://knowledge.hubspot.com/help-desk/overview-of-the-help-desk-workspace)
  объединяет chat, email, forms, calls, WhatsApp и Messenger; поддерживает
  views, routing, capacity, SLA, merge, reporting и reply recommendations.
- [Snooze tickets in help desk](https://knowledge.hubspot.com/help-desk/snooze-tickets-in-help-desk)
  отделяет временное ожидание от закрытого обращения.

### Salesforce

- [Service Cloud](https://www.salesforce.com/eu/service/cloud/) описывает единый
  Service Console, omnichannel routing, knowledge, AI-рекомендации и
  операционную аналитику.
- [Supported Editions for Service Features](https://help.salesforce.com/s/articleView?id=service.service_editions_reference.htm&language=en_US&type=5)
  подтверждает наличие queues, assignment/escalation rules, Omni-Channel,
  skills-based routing и swarming.

## Матрица соответствия

Статусы:

- `MATCH` — смысловая функция представлена в preview;
- `PARTIAL` — модель есть, но рабочее подключение или часть UX отсутствует;
- `MISSING` — функции пока нет;
- `DEFERRED` — функция намеренно не включается на безопасном этапе.

| Возможность                              | ArtHello после первой версии                                            | Оценка     |
| ---------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| Единое рабочее место продаж и сервиса    | Есть общая очередь; Lead, Ticket и Incident не смешаны                  | `MATCH`    |
| Непрерывная история Conversation/Message | Есть единый идентификатор и неизменяемые сообщения                      | `MATCH`    |
| Реальные многоканальные входящие         | Каналы только смоделированы                                             | `DEFERRED` |
| Связанный CRM-контекст                   | Есть связанный объект, факты и источники; реальный профиль закрыт       | `PARTIAL`  |
| Очереди и сохранённые фильтры            | Есть базовые очереди и локальный поиск                                  | `PARTIAL`  |
| Назначение по загрузке и навыкам         | Роли и capacity ещё не утверждены                                       | `DEFERRED` |
| SLA, рабочие часы и timers               | Есть приоритет и состояние; точные сроки не активированы                | `PARTIAL`  |
| Внутренние заметки                       | Визуально отделены от ответа клиенту                                    | `MATCH`    |
| @mentions и совместный черновик          | Нет                                                                     | `MISSING`  |
| Collision detection                      | Нет                                                                     | `MISSING`  |
| Шаблоны/macros                           | Управляемые статьи есть, быстрых snippets в composer нет                | `MISSING`  |
| Snooze и follow-up                       | Follow-up имеет владельца, срок и канал; snooze-действия нет            | `PARTIAL`  |
| Knowledge в рабочем месте                | Версии, источники, approval, review date и AI eligibility               | `MATCH`    |
| AI-помощь                                | Черновик и claim-level evidence есть; отправка заблокирована            | `MATCH`    |
| Handoff человеку                         | Содержит цель, факты, риск, решение, владельца, срок и черновик         | `MATCH`    |
| Activity/audit history                   | Audit-события есть в данных, но не полностью показаны оператору         | `PARTIAL`  |
| Merge/dedup                              | Автоматического поиска дублей нет                                       | `MISSING`  |
| Privacy и identity gate                  | Раскрытие семейных данных блокируется; реальные права ещё не подключены | `PARTIAL`  |
| Операционный dashboard                   | Есть обзор в модуле, но нет live workload и SLA analytics               | `PARTIAL`  |
| Автоматические правила и действия        | Allowlist пуст, внешние действия запрещены                              | `DEFERRED` |

## Вывод

Первая версия уже соответствует сильным системам по правильному каркасу:

- одна история обращения;
- отдельные продажи, сервис и incident;
- внутренние заметки;
- проверяемые факты;
- knowledge и AI-черновик рядом с диалогом;
- содержательный handoff;
- обязательный follow-up;
- усиленная безопасность.

Она пока не равна production-возможностям зрелых платформ. Главные разрывы —
реальные каналы, маршрутизация по capacity/skills, настоящий SLA-clock,
совместная работа в реальном времени, snippets, dedup и операционная аналитика.

Сильная сторона ArtHello — более строгая, чем у типового shared inbox,
смысловая граница для детских, семейных, финансовых и критических случаев. Её
нельзя обменивать на быстрый рост автоматизации.

## Что безопасно закрыть сейчас

Без реальных каналов и БД можно добавить в synthetic preview:

1. индикатор присутствия и collision-состояния;
2. явную проверку связности каналов и возможного дубля без автоматического
   merge;
3. read-only список утверждённых snippets с заблокированной вставкой;
4. activity/audit timeline;
5. отдельную очередь follow-up.

## Что не нужно имитировать сейчас

- enterprise-сложность Salesforce;
- автоматическую маршрутизацию до назначения ролей и capacity;
- SLA-таймеры до утверждения часов, часового пояса и матрицы;
- автоматический merge по телефону, фамилии или адресу отправителя;
- массовые macros без владельца и версии;
- AI-автоответ до QA `EXPAND`;
- live-dashboard на synthetic-данных как доказательство операционного
  результата.

Следующий полезный gate — сначала закрыть пять безопасных UX-разрывов, затем
утвердить модель данных и только после этого проектировать read-only
подключение одного тестового канала.

## Результат безопасного закрытия разрывов

После benchmark в synthetic preview добавлены:

- отдельная очередь `follow_up`;
- присутствие другого сотрудника и collision-состояние без real-time
  подключения;
- единый `threadKey`, история каналов и `POSSIBLE_RELATED`;
- жёсткий запрет автоматического merge;
- read-only snippets только со статусами `APPROVED + VERIFIED`;
- запрет snippets для травмы, спорного начисления и жалобы на сотрудника;
- полная видимая synthetic activity/audit history;
- запрет совместной записи черновика и вставки snippet.

Это переводит collision, snippets, dedup и activity history из `MISSING` в
`PARTIAL`: рабочая логика и безопасный UX уже определены, но реальное
присутствие, хранение, права и действия по-прежнему не подключены.
