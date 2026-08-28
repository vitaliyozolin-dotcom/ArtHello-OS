# Паспорт: дизайн-система «Школа 1–11»

- `project_id`: `SCHOOL-1-11-DESIGN-SYSTEM`
- владелец продукта и решений: Виталий Озолин
- исполнитель технических изменений: Codex
- состояние: `approved` → `active`
- актуально на: 2026-08-28
- область: электронный дневник и авторизованные кабинеты администратора, учителя, родителя и ученика
- канонический дизайн-код: [`DESIGN_CODE.md`](../../design/school-1-11/DESIGN_CODE.md), версия `1.0.0`

## Проблема, цель и конечный результат

Проблема — визуальные правила дневника были распределены между утверждённым текстом, токенами, legacy CSS и глобальным ArtHello OS Design Code. Из-за этого разные правки могли обоснованно ссылаться на разные «истины» и снова менять геометрию интерфейса.

Цель — один утверждённый нормативный документ для всей «Школы 1–11», один производный набор токенов и автоматические ворота, которые не позволяют экрану или legacy CSS переопределить системные правила.

Конечный результат: любой участник и любой автоматический аудит однозначно определяет действующую версию, область, владельца, приоритет и доказательство соответствия; production получает только кандидат, прошедший функциональную и визуальную приёмку.

## Критерии завершения проекта

1. Канонический текст хранится только в `docs/design/school-1-11/DESIGN_CODE.md` на `main`.
2. Глобальный `DESIGN_CODE.md` явно исключает из своих конфликтующих правил область «Школы 1–11» и ссылается на школьный документ.
3. Школьная ветка содержит только указатель на канонический текст; `app/design-tokens.css` имеет ту же версию и проверяется контрактным тестом.
4. Новый candidate SHA автоматически проходит функциональную проверку четырёх ролей и визуальный аудит утверждённых ширин и граничных breakpoint-состояний.
5. Перед production: `P0 = 0`, нет функциональной регрессии, зафиксированы снимки, image digest и rollback.
6. Любое изменение визуального языка получает новую версию и отдельное решение владельца; устное изменение дизайн-код не меняет.

## Подтверждённое состояние

- Виталий утвердил School 1–11 Design Code `1.0.0` 27 августа 2026 года.
- 28 августа 2026 года Виталий поручил зафиксировать единый источник.
- Указатель и контракт версии в школьной ветке закреплены PR #200, merge SHA `3b31be97809856c163369d5bed307379dd9e0bed`.
- Авторизованный аудит candidate `e0d2c55db2bf4214aa8feff0c49b5c88c63d74e4` проверил 4 роли × 7 ширин: 28/28 снимков, 279 повторных отклонений, из них 15 `P0` и 264 `P1`.
- DS-02 candidate `796fdd7af23de11f03460672fb4d82a5d66ce4a5` собран в image `sha256:bee90a14e40b39c278876a63dbe468fc9a92d362b3268ea093f502abda8d640e`; staging run [33152127917](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33152127917) прошёл.
- Граничный audit run [33152762563](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33152762563) проверил 4 роли × 6 ширин 767/768/800/801/1199/1200: 24/24 снимка, `DS-02 shell violations = 0`; artifact `9678390875`, digest `sha256:88ee92eecd691e0fdc40865132babb6b9c779fba1dcfe58cfd02274f97009bba`.
- Four-role regression run [33152565608](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33152565608) прошёл для директора, учителя, родителя и ученика на ephemeral clone; staging data не менялись.
- Реализация DS-02 принята PR [#202](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/202), merge SHA `f509debad93ec2fa3668aa60a8f90fc5deeb7321`.
- Первая приёмка DS-03 по PR [#209](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/209), merge SHA `fe2a46ba288eebb553e073e6fff29ceed9af2e91`, использовала матрицу 45 снимков и не покрывала два интерактивных состояния `Школа → Мероприятия` и `Школа → Доп. занятия`. Поздний review обнаружил белые legacy-поверхности с белым текстом; прежнее доказательство DS-03 признано неполным и заменено.
- Финальный DS-03 candidate `0947e866afb0bcbbe1a33a3303e9168351f5e9f1` собран в immutable image `sha256:94bcaa9dfe45d1bbfc1042c397a4556cbacb258e810b7e56b581d7a2b44570ea`; isolated staging run [33165949446](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33165949446) прошёл 14/14 проверок.
- Финальный audit run [33169850196](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33169850196) проверил 51/51 снимок: 24 граничных снимка четырёх ролей и 27 student route-state снимков, включая все три School tabs на 390/768/1440. `DS-02 violations = 0`, `DS-03 violations = 0`, route-load CLS = 0 и state-change CLS = 0 для всех девяти School-состояний.
- Artifact финального аудита: `9685180814`, digest `sha256:51773f8fd1d31b89bb616750cdd3cf57a37d9c58731600f45aa7851004600aa6`; manifest SHA-256 `149f1c3b6f99612b42d981c8181a5ada7ce050a4b23b4eb269eb7d55a5d864d5`; matrix digest `7e684826dd4b7cb21add01a31c3dacf1840c39364fb59e954f6074af9a1867d8`.
- Four-role regression run [33169850223](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33169850223) прошёл для директора, учителя, родителя и ученика на том же image: auth, scope, permissions и logout подтверждены; сеть изолирована; run-scoped container и volume удалены.
- Исправление пропущенных School-состояний принято PR [#225](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/225), squash merge SHA `48bdac0a95bf0560f9dbd9b4c4af7d9b2175edd4` в `school/staging-foundation-20260827`; старое замечание PR #209 закрыто ссылкой на это доказательство.
- Fail-closed контуры 51-capture audit и four-role regression закреплены на `main` PR [#229](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/229), merge SHA `a91046cf271a3435054cb0ed9c6f8545caeaf56f`.
- Финальный manifest содержит 227 raw `P1` будущего DS-04 и поэтому честно имеет `compliant = false`; обязательные ворота завершённых DS-02/DS-03 при этом равны нулю. Состав измеренного долга: H1/H2 size и line-height, размеры mobile logo, HelpButton, touch targets, primary control font/height/radius и случайные радиусы.
- Отдельно в контракте зарегистрирован долг DS-04, не входящий в эти 227 измерений: status raw pairs, capacity track, featured shadow и warning state.
- Staging не изменялся во время финальных regression/audit; production не менялся и не перезапускался, production health = OK.
- Глобальный ArtHello OS Design Code сохраняется для основной ArtHello OS, но не переопределяет специальные правила «Школы 1–11».

## Этапы и зависимости

1. `DS-01` — устранить конфликт источников, закрепить канонический документ, иерархию и указатель в школьной ветке. Статус: `completed`.
2. `DS-02` — исправить каркас 768–1199 px и добавить граничные проверки 767/768/800/801/1199/1200. Статус: `completed`; зависит от `DS-01`.
3. `DS-03` — перевести student-тему на утверждённые токены и Onest без изменения геометрии. Статус: `completed`; зависит от `DS-02`.
4. `DS-04` — унифицировать Typography, Button, Tabs, Card, Table и HelpButton. Статус: `next`; зависит от `DS-03`.
5. `DS-05` — переносить маршруты по одному: родитель, ученик, директор, последним журнал учителя. Статус: `pending`; зависит от `DS-03` и `DS-04`.
6. `DS-06` — полный visual/functional acceptance и production cutover точного image digest. Статус: `pending`; зависит от `DS-05` и отдельного разрешения владельца.

## Метрики и ворота

- `P0 = 0` на всех обязательных и граничных ширинах;
- `CLS <= 0.02` на основных маршрутах;
- ноль горизонтального переполнения страницы;
- ноль raw colors, radii и системных spacing вне разрешённого слоя токенов;
- 100% общих компонентов проверены для четырёх ролей;
- loading, empty, error, disabled и long-content входят в приёмку;
- функциональный regression ролей проходит до визуального решения;
- production не меняется без точного candidate SHA/image digest, доказательства и rollback.

## Ресурсы, сроки и ограничения

- используются действующий private GitHub repository, GitHub Actions и существующий staging-контур;
- новый платный сервис для этого этапа не требуется;
- срок production cutover отдельно не утверждён;
- запрещены массовый CSS append, новые последовательные mobile-слои, массовый `!important`, изменение данных/схемы и прямые visual-правки production;
- каждое изменение выполняется отдельным обратимым PR и проверяется на staging.

## Риски и неизвестные

- legacy `globals.css` и `mobile-polish.css` могут поздним cascade переопределять токены;
- audit workflow намеренно закреплён на точном candidate SHA/image; каждый следующий UI-кандидат требует отдельного control PR на `main`, иначе статус нового SHA не считается доказательством;
- состояния loading, empty, error, disabled и long-content пока не прошли полную визуальную приёмку;
- 227 raw `P1` и отдельно зарегистрированные status/capacity/featured/warning отклонения DS-04 ещё требуют последовательного устранения;
- срок полного переноса экранов не утверждён.

## Текущий шаг

- этап: `DS-04`;
- исполнитель: Codex; владелец решения: Виталий Озолин;
- действие: отдельным feature-flagged PR унифицировать Typography, Button, Tabs, Card, Table и HelpButton; последовательно закрыть 227 измеренных `P1` и зарегистрированный DS-04 debt без изменения бизнес-логики, данных, ролевой навигации и принятой геометрии shell;
- доказательство: exact candidate SHA/image digest, четыре роли на контрольных и граничных ширинах, `P0 = 0`, сохранённые `DS-02 violations = 0` и `DS-03 violations = 0`, `CLS <= 0.02`, снижение целевых `P1`, функциональный regression, изолированные staging-данные и неизменный production;
- следующий переход: после принятия общих компонентов переносить маршруты в DS-05 по одному — родитель, ученик, директор, последним журнал учителя.

## Контракт AI-процесса: хранитель School Design Code

- входные данные: канонический дизайн-код, производные токены, candidate SHA, четыре роли, маршруты, состояния и контрольные ширины;
- ожидаемый результат: доказуемый отчёт соответствия и блокировка кандидата при нарушении обязательного правила;
- разрешённые действия: читать код и артефакты, создавать синтетический fixture, снимать скриншоты, считать метрики, готовить обратимые PR в пределах активного этапа;
- запрещённые действия: менять production или реальные данные, подменять дизайн-код выводом модели, принимать визуальное решение вместо Виталия, скрывать отклонения, хранить тестовые credentials;
- ответственный человек: Виталий Озолин; исполнитель проверки — Codex;
- стоимость выполнения: существующие GitHub Actions/runner и staging, без нового сервиса;
- метрика пользы: отсутствие новых P0 и снижение повторных P1 без функциональных регрессий;
- автоматическое отключение: остановиться при несовпадении версии/хеша дизайн-кода, candidate SHA/image digest, невозможности изоляции данных или необходимости расширить полномочия;
- отказ пользователя: Виталий может остановить автоматическую проверку; production не меняется, артефакты остаются, кандидат не получает статус принятого до ручной проверки.

## Утверждённые решения

```yaml
decision:
  decision_id: D-SCHOOL-DESIGN-001
  project_id: SCHOOL-1-11-DESIGN-SYSTEM
  status: active
  question: Какой документ управляет визуальной системой «Школы 1–11» и что делать при конфликте с общим ArtHello OS Design Code?
  statement: Единственным нормативным источником для электронного дневника и кабинетов четырёх ролей является docs/design/school-1-11/DESIGN_CODE.md версии 1.0.0. В этой области он имеет приоритет над конфликтующими правилами общего ArtHello OS Design Code. app/design-tokens.css является производным машинным слоем той же версии, а CSS страниц, компоненты, рендеры и устные договорённости не являются источником дизайн-правил.
  context: Утверждённый School Design Code использует фирменный алый #E04512 и геометрию школы, тогда как глобальный стандарт ArtHello OS использует фиолетовую палитру и другую геометрию.
  rationale: Явно разрешить конфликт областей, сохранить отдельную идентичность школы и исключить визуальный дрейф при последующих изменениях.
  evidence:
    - Явное утверждение School 1–11 Design Code Виталием 2026-08-27
    - Поручение Виталия «Фиксируй единый источник» 2026-08-28
    - "Authorized visual audit run 33146238926: 28 captures, 279 violations, production/staging unchanged"
    - "Final DS-03 audit run 33169850196: 51 captures, DS-02 = 0, DS-03 = 0"
    - "Four-role regression run 33169850223: four roles passed, production unchanged"
  assumptions:
    - «Школа 1–11» сохраняет отдельную фирменную идентичность внутри экосистемы ArtHello
  approved_by: Виталий Озолин
  approved_at: 2026-08-28
  owner: Виталий Озолин
  deadline: null
  review_at: 2026-11-27
  affected_stages: [DS-01, DS-02, DS-03, DS-04, DS-05, DS-06]
  dependencies: [canonical_document, candidate_pointer, design_contract_test, authorized_visual_audit]
  supersedes:
    - D-037 only where its visual rules conflict inside the School 1-11 scope
  superseded_by: null
  source_links:
    - ../../design/school-1-11/DESIGN_CODE.md
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/200
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33146238926
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/202
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/209
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/225
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/pull/229
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33165949446
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33169850196
    - https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33169850223
  raw_deliberation_ref: ChatGPT project conversation 2026-08-27..2026-08-28
  rejected_alternatives:
    - option: Применить фиолетовый ArtHello OS Design Code ко всем школьным кабинетам
      reason: Противоречит явно утверждённой фирменной системе School 1–11.
      reopen_condition: Только новая версия дизайн-кода после отдельного решения Виталия.
    - option: Считать текст, токены, CSS экранов и рендеры равноправными источниками
      reason: При конфликте невозможно определить обязательное правило; визуальный дрейф неизбежен.
      reopen_condition: Не применяется.
  actions:
    - action: Сохранить утверждённый документ в каноническом пути main
      owner: Codex
      due: 2026-08-28
      evidence_required: merged PR and content SHA-256 cebdc3f3ae76cb50103734c0e6144cef713108b4c6fd9b39de93cf3f8828dd48
      status: completed
    - action: Добавить в школьную ветку указатель и контрактную проверку версии/хеша
      owner: Codex
      due: 2026-08-28
      evidence_required: PR #200 merged as 3b31be97809856c163369d5bed307379dd9e0bed into school/staging-foundation-20260827
      status: completed
    - action: Зафиксировать исключение в глобальном ArtHello OS Design Code
      owner: Codex
      due: 2026-08-28
      evidence_required: merged PR to main with relative canonical link
      status: completed
    - action: Завершить DS-03 — student-тема на токенах и локальном Onest без изменения геометрии
      owner: Codex
      due: 2026-08-28
      evidence_required: "PR #209 merged as fe2a46ba288eebb553e073e6fff29ceed9af2e91 and corrective PR #225 merged as 48bdac0a95bf0560f9dbd9b4c4af7d9b2175edd4; staging 33165949446; audit 33169850196; four-role 33169850223; immutable image sha256:94bcaa9dfe45d1bbfc1042c397a4556cbacb258e810b7e56b581d7a2b44570ea"
      status: completed
    - action: Выполнить DS-04 — унифицировать Typography, Button, Tabs, Card, Table и HelpButton
      owner: Codex
      due: null
      evidence_required: "exact candidate/image; P0 = 0; DS-02 = 0; DS-03 = 0; CLS <= 0.02; four-role regression; снижение 227 измеренных P1 и закрытие зарегистрированного DS-04 debt; production unchanged"
      status: pending
```
