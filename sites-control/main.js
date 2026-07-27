const moduleContent = {
  families: {
    title: "Семьи",
    icon: "⌂",
    summary:
      "Единая карточка семьи должна связывать родителей, учеников, договоры, платежи и историю контактов.",
    stateTitle: "Показываются только кандидаты на ручную проверку",
    stateCopy:
      "AlfaCRM не предоставляет надёжную family entity. Импортёр создаёт кандидатов по контактам, но никогда не подтверждает и не объединяет семью автоматически.",
    found: [
      "Сущности людей и семей",
      "Профили учеников и связи с представителями",
      "Очередь кандидатов с ручным подтверждением",
    ],
    gates: [
      "Не объединять семьи по одному слабому признаку",
      "Принять только завершённый snapshot учеников",
      "Проверить каждый кандидат вручную",
    ],
  },
  students: {
    title: "Ученики",
    icon: "◉",
    summary:
      "Профиль ученика, статус обучения, семья, группы, посещения и финансовая история.",
    stateTitle: "Карточки читаются из проверенного snapshot AlfaCRM",
    stateCopy:
      "Клиенты-ученики отделены от лидов; текущие и архивные статусы, группы, оплаты и посещения показываются только после завершённого scope.",
    found: [
      "Raw-слой AlfaCRM",
      "Раздельные normalized students и leads",
      "Абонементы и профили жизненного цикла",
    ],
    gates: [
      "Проверить terminal report и integrity audit",
      "Проверить актуальность статусов и архив",
      "Сверить связи ученик ↔ семья",
    ],
  },
  groups: {
    title: "Группы и классы",
    icon: "▦",
    summary:
      "Группы, классы, программы, расписание, зачисления и фактические посещения.",
    stateTitle: "Группы и занятия доступны из read-only источника",
    stateCopy:
      "Группы, состав, занятия трёх статусов и посещаемость сохраняются в неизменяемом raw-слое и проверяемой read-модели.",
    found: [
      "Группы и учебные единицы",
      "Состав групп с безопасным customer ID",
      "Занятия, расписание и посещаемость",
    ],
    gates: [
      "Получить полный CRM snapshot",
      "Проверить историю переходов и orphan-связи",
      "Сопоставить группы с внутренними классами",
    ],
  },
  employees: {
    title: "Сотрудники",
    icon: "♙",
    summary:
      "Подразделения, сотрудники, роли, занятость и основание для расчёта вознаграждения.",
    stateTitle: "Roster доступен владельцу в защищённой read-модели",
    stateCopy:
      "Карточки получены из реальной зарплатной таблицы. Они видны только в owner-only Sites и пока имеют статус кадровой проверки.",
    found: [
      "Подразделения и сотрудники",
      "114 payroll identities в sandbox",
      "Роли и ранние правила зарплаты",
    ],
    gates: [
      "Сопоставить identities с employee master вручную",
      "Подтвердить штат и юридические связи",
      "Не придумывать оклады, ставки и KPI",
    ],
  },
  teachers: {
    title: "Педагоги",
    icon: "◇",
    summary:
      "Педагоги AlfaCRM, проведённые занятия, рабочие часы и ставки из исходных правил.",
    stateTitle: "CRM-педагоги и зарплатный roster пока не объединены",
    stateCopy:
      "Точное совпадение ФИО создаёт только кандидата на связь. Ставки показываются как исходные правила AlfaCRM и не используются для автоматического начисления.",
    found: [
      "Педагоги и статусы AlfaCRM",
      "Количество занятий и правил рабочих часов",
      "Ставки с исходными условиями и периодами",
    ],
    gates: [
      "Подтвердить каждую связь педагог ↔ сотрудник",
      "Проверить периоды и условия ставок",
      "Не активировать расчёт до сверки с ведомостью",
    ],
  },
  payroll: {
    title: "Зарплата",
    icon: "₽",
    summary:
      "Проверяемый расчёт зарплаты с источником каждого начисления и контролем перед выплатой.",
    stateTitle: "Реальные начисления и выплаты доступны помесячно",
    stateCopy:
      "Суммы сверены с исходной таблицей и показываются владельцу. Ни одна формула, ставка или KPI не активированы как правило системы.",
    found: [
      "Raw-слой с формулами",
      "Периоды, выплаты и начисления",
      "Контроль дублей и сверка с источником",
    ],
    gates: [
      "Разобрать unresolved-связи вручную",
      "Утвердить каждую формулу, ставку и основание",
      "Запретить выпуск при денежной ошибке",
    ],
  },
  money: {
    title: "Деньги",
    icon: "◒",
    summary:
      "Счета, остатки и банковские операции с понятным происхождением и статусом сверки.",
    stateTitle: "Read-only OAuth проходит через защищённый сервер Sites",
    stateCopy:
      "Client secret хранится только в protected environment, state проверяется на callback, токены шифруются AES-GCM. Платёжные scopes и действия отсутствуют.",
    found: [
      "Коннекторы банков",
      "Счета, остатки и операции",
      "Raw-слой выписок",
    ],
    gates: [
      "Пройти server-side callback с проверкой state",
      "Пройти пользовательский consent без payment scopes",
      "Проверить все доступные юрлица, счета и остатки",
    ],
  },
  cashflow: {
    title: "ДДС",
    icon: "⇅",
    summary:
      "Движение денежных средств по проверенным банковским операциям и утверждённым статьям.",
    stateTitle: "Каркас ДДС присутствует",
    stateCopy:
      "Ledger и статьи найдены, но отчёт нельзя использовать до свежей сверки банков и классификации операций.",
    found: [
      "Финансовый ledger",
      "Статьи движения денег",
      "Ранние cashflow-экраны",
    ],
    gates: [
      "Подтвердить полноту банковских операций",
      "Утвердить статьи и правила классификации",
      "Закрыть несверенные операции",
    ],
  },
  pnl: {
    title: "ОПиУ",
    icon: "▥",
    summary: "Доходы, расходы и результат периода на единой учётной политике.",
    stateTitle: "Экран и расчётный фундамент найдены",
    stateCopy:
      "Текущие значения скрыты: без подтверждённых начислений, зарплаты и аллокаций ОПиУ не является истиной.",
    found: ["P&L route и экран", "Финансовые статьи", "Периоды и агрегаты"],
    gates: [
      "Согласовать метод признания дохода",
      "Проверить зарплату и распределения",
      "Провести закрытие месяца",
    ],
  },
  model: {
    title: "Финансовая модель",
    icon: "⌁",
    summary:
      "Сценарии, прогнозы и рекомендации только поверх сверенной операционной и финансовой базы.",
    stateTitle: "Раздел намеренно закрыт воротами качества",
    stateCopy:
      "AI CFO и рекомендации не запускаются до сверки источников и утверждения расчётных правил.",
    found: [
      "Ранняя версия AI CFO",
      "Прогнозные и аналитические заготовки",
      "Trust Score и закрытие месяца",
    ],
    gates: [
      "Достичь готовности финансовой правды",
      "Зафиксировать допущения модели",
      "Проверить рекомендации человеком",
    ],
  },
  system: {
    title: "Система",
    icon: "⚙",
    summary:
      "Интеграции, качество данных, безопасность, аудит, окружения и эксплуатационные процедуры.",
    stateTitle:
      "Sites — owner-only контрольная оболочка с серверной read-моделью",
    stateCopy:
      "Персональные строки выдаются только подтверждённому владельцу; секреты находятся в protected environment, сайт закрыт от индексации. Старый Replit остаётся отдельным legacy-риском.",
    found: [
      "Sites project с owner-only доступом",
      "API, sync-сервис и PostgreSQL-схема",
      "Аудит интеграций и безопасности",
    ],
    gates: [
      "Выпустить noindex/auth/OAuth fixes после backup",
      "Проверить guarded bank-config migration в restored sandbox",
      "Закрыть новый gate Ревизором и Координатором",
    ],
  },
};

const frontOfficeStageOrder = [
  "NEW",
  "QUALIFIED",
  "PROGRAM_MATCHED",
  "TRIAL_REQUESTED",
  "TRIAL_CONFIRMED",
  "WON",
  "LOST",
];

const frontOfficeStageLabels = {
  NEW: "Новый",
  QUALIFIED: "Квалифицирован",
  PROGRAM_MATCHED: "Программа подобрана",
  TRIAL_REQUESTED: "Пробное запрошено",
  TRIAL_CONFIRMED: "Пробное подтверждено",
  WON: "Договор",
  LOST: "Потерян",
};

const frontOfficeDemoLeads = [
  {
    id: "lead-demo-1",
    name: "Тестовый контакт 01",
    contact: "+7 ••• •••-14-28",
    channel: "Сайт",
    source: "Форма программы",
    intent: "Творческое направление · 7–9 лет",
    priority: "P3",
    stage: "NEW",
    owner: "",
    program: "",
    nextAction: "Уточнить район и удобное время",
    nextAt: "2026-07-26T19:30",
    overdue: true,
    messages: [
      {
        type: "incoming",
        label: "Входящее сообщение",
        body: "Подскажите, какие творческие программы подходят ребёнку 8 лет?",
        time: "Сегодня · 18:42",
      },
    ],
    tasks: [
      {
        id: "task-demo-1",
        title: "Квалифицировать запрос",
        due: "Сегодня · 19:30",
        done: false,
      },
    ],
    audit: [
      {
        title: "Лид создан",
        meta: "Системный сценарий · 18:42",
      },
    ],
  },
  {
    id: "lead-demo-2",
    name: "Тестовый контакт 02",
    contact: "telegram · @test••02",
    channel: "Telegram",
    source: "Рекомендация",
    intent: "Пробное занятие",
    priority: "P3",
    stage: "TRIAL_REQUESTED",
    owner: "Анна",
    program: "Керамика · Лиственная",
    nextAction: "Подтвердить свободное время",
    nextAt: "2026-07-27T11:00",
    overdue: false,
    messages: [
      {
        type: "incoming",
        label: "Входящее сообщение",
        body: "Хотим прийти на пробное по керамике в выходной.",
        time: "Сегодня · 16:20",
      },
      {
        type: "internal_note",
        label: "Внутренняя заметка",
        body: "Проверить субботнюю группу после обновления расписания.",
        time: "Анна · 16:31",
      },
    ],
    tasks: [
      {
        id: "task-demo-2",
        title: "Проверить место в группе",
        due: "Завтра · 11:00",
        done: false,
      },
    ],
    audit: [
      {
        title: "Назначена Анна",
        meta: "Внутреннее действие · 16:31",
      },
      {
        title: "Этап: пробное запрошено",
        meta: "Воронка · 16:28",
      },
    ],
  },
  {
    id: "lead-demo-3",
    name: "Тестовый контакт 03",
    contact: "email · t•••03@example.test",
    channel: "Email",
    source: "Повторное обращение",
    intent: "Подбор программы · 4–6 лет",
    priority: "P3",
    stage: "PROGRAM_MATCHED",
    owner: "Мария",
    program: "ИЗО или подготовка к школе",
    nextAction: "Отправить человеку на проверку два варианта",
    nextAt: "2026-07-27T13:00",
    overdue: false,
    messages: [
      {
        type: "incoming",
        label: "Входящее сообщение",
        body: "Нужны спокойные занятия после сада, желательно два раза в неделю.",
        time: "Вчера · 20:15",
      },
      {
        type: "ai_draft",
        label: "AI-черновик · не отправлен",
        body: "Подготовлены два варианта программы. Нужна проверка расписания и возраста.",
        time: "Система · 09:10",
      },
    ],
    tasks: [
      {
        id: "task-demo-3",
        title: "Проверить возрастные границы",
        due: "Завтра · 12:00",
        done: true,
      },
      {
        id: "task-demo-4",
        title: "Подтвердить расписание",
        due: "Завтра · 13:00",
        done: false,
      },
    ],
    audit: [
      {
        title: "AI-черновик создан",
        meta: "DRAFT_ONLY · 09:10",
      },
      {
        title: "Программа подобрана",
        meta: "Мария · вчера",
      },
    ],
  },
  {
    id: "lead-demo-4",
    name: "Тестовый контакт 04",
    contact: "+7 ••• •••-40-04",
    channel: "Телефон",
    source: "Входящий звонок",
    intent: "Детский сад",
    priority: "P2",
    stage: "TRIAL_CONFIRMED",
    owner: "Руководитель филиала",
    program: "Детский сад · тестовый филиал",
    nextAction: "Провести пробную встречу",
    nextAt: "2026-07-28T10:30",
    overdue: false,
    messages: [
      {
        type: "incoming",
        label: "Резюме звонка",
        body: "Запрос на знакомство с филиалом. Дата пока является тестовой.",
        time: "Сегодня · 12:05",
      },
    ],
    tasks: [
      {
        id: "task-demo-5",
        title: "Подготовить тестовую встречу",
        due: "28 июля · 10:00",
        done: false,
      },
    ],
    audit: [
      {
        title: "Пробное подтверждено",
        meta: "Тестовый сценарий · 12:18",
      },
    ],
  },
  {
    id: "lead-demo-5",
    name: "Тестовый контакт 05",
    contact: "telegram · @test••05",
    channel: "Telegram",
    source: "Пробное занятие",
    intent: "Продолжение обучения",
    priority: "P3",
    stage: "WON",
    owner: "Анна",
    program: "Творческая мастерская",
    nextAction: "",
    nextAt: "",
    overdue: false,
    messages: [
      {
        type: "incoming",
        label: "Тестовый результат",
        body: "Сценарий завершён договором без реального финансового действия.",
        time: "25 июля · 18:20",
      },
    ],
    tasks: [],
    audit: [
      {
        title: "Этап: договор",
        meta: "Только synthetic · 25 июля",
      },
    ],
  },
  {
    id: "lead-demo-6",
    name: "Тестовый контакт 06",
    contact: "email · t•••06@example.test",
    channel: "Email",
    source: "Публичный сайт",
    intent: "Запрос вне возрастной границы",
    priority: "P4",
    stage: "LOST",
    owner: "Мария",
    program: "",
    nextAction: "",
    nextAt: "",
    overdue: false,
    messages: [
      {
        type: "incoming",
        label: "Тестовое обращение",
        body: "Сценарий не соответствует действующим программам.",
        time: "24 июля · 11:40",
      },
    ],
    tasks: [],
    audit: [
      {
        title: "Причина потери зафиксирована",
        meta: "Не подходит продукт · 24 июля",
      },
    ],
  },
];

let frontOfficeLeads = [...frontOfficeDemoLeads];

const frontOfficeProfiles = {
  "lead-demo-1": {
    phone: "+7 ••• •••-14-28",
    email: "Не указан",
    messenger: "Не указан",
    preferredChannel: "Телефон",
    identityStatus: "Не требуется для первичного запроса",
    contactRole: "Представитель · права не проверялись",
    ageBand: "7–9 лет",
    branch: "Не выбран",
    goal: "Подобрать творческую программу",
    schedule: "Нужно уточнить",
    budget: "Не запрашивался",
    campaign: "Летние программы",
    utm: "site / program_form",
    firstTouch: "Сегодня · 18:42",
    lastTouch: "Сегодня · 18:42",
    factStatus: "UNVERIFIED",
  },
  "lead-demo-2": {
    phone: "Не указан",
    email: "Не указан",
    messenger: "Telegram · @test••02",
    preferredChannel: "Telegram",
    identityStatus: "Не требуется для первичного запроса",
    contactRole: "Представитель · права не проверялись",
    ageBand: "Нужно уточнить",
    branch: "Лиственная · тестовое значение",
    goal: "Записаться на пробное занятие",
    schedule: "Выходной день",
    budget: "Не запрашивался",
    campaign: "Рекомендация",
    utm: "referral / direct",
    firstTouch: "Сегодня · 16:20",
    lastTouch: "Сегодня · 16:31",
    factStatus: "PARTIAL",
  },
  "lead-demo-3": {
    phone: "Не указан",
    email: "t•••03@example.test",
    messenger: "Не указан",
    preferredChannel: "Email",
    identityStatus: "Не требуется для первичного запроса",
    contactRole: "Представитель · права не проверялись",
    ageBand: "4–6 лет",
    branch: "Нужно подобрать",
    goal: "Спокойные занятия после детского сада",
    schedule: "Будни · два раза в неделю",
    budget: "Не запрашивался",
    campaign: "Возврат на сайт",
    utm: "email / returning",
    firstTouch: "Вчера · 20:15",
    lastTouch: "Сегодня · 09:10",
    factStatus: "PARTIAL",
  },
  "lead-demo-4": {
    phone: "+7 ••• •••-40-04",
    email: "Не указан",
    messenger: "Не указан",
    preferredChannel: "Телефон",
    identityStatus: "Не требуется для первичной встречи",
    contactRole: "Представитель · права не проверялись",
    ageBand: "Нужно уточнить",
    branch: "Тестовый филиал",
    goal: "Познакомиться с детским садом",
    schedule: "28 июля · 10:30 · тест",
    budget: "Не запрашивался",
    campaign: "Входящий звонок",
    utm: "offline / call",
    firstTouch: "Сегодня · 12:05",
    lastTouch: "Сегодня · 12:18",
    factStatus: "PARTIAL",
  },
  "lead-demo-5": {
    phone: "Не указан",
    email: "Не указан",
    messenger: "Telegram · @test••05",
    preferredChannel: "Telegram",
    identityStatus: "Не подтверждено",
    contactRole: "Представитель · права не проверялись",
    ageBand: "Не зафиксирован",
    branch: "Не зафиксирован",
    goal: "Продолжить обучение после пробного",
    schedule: "Согласовано только в synthetic-сценарии",
    budget: "Не зафиксирован",
    campaign: "Пробное занятие",
    utm: "crm / trial_followup",
    firstTouch: "25 июля · 17:40",
    lastTouch: "25 июля · 18:20",
    factStatus: "UNVERIFIED",
  },
  "lead-demo-6": {
    phone: "Не указан",
    email: "t•••06@example.test",
    messenger: "Не указан",
    preferredChannel: "Email",
    identityStatus: "Не требуется",
    contactRole: "Контакт · роль не определена",
    ageBand: "Вне тестовой возрастной границы",
    branch: "Не применимо",
    goal: "Найти подходящую программу",
    schedule: "Не уточнялось",
    budget: "Не запрашивался",
    campaign: "Органический трафик",
    utm: "organic / public_site",
    firstTouch: "24 июля · 11:40",
    lastTouch: "24 июля · 11:47",
    factStatus: "UNVERIFIED",
  },
};

const frontOfficeState = {
  selectedId: frontOfficeLeads[0].id,
  filter: "all",
  composeType: "internal_note",
  profileOpen: false,
  profileTab: "overview",
  profileTrigger: null,
};

function frontOfficeSelectedLead() {
  return (
    frontOfficeLeads.find((lead) => lead.id === frontOfficeState.selectedId) ??
    frontOfficeLeads[0]
  );
}

function frontOfficeStageClass(stage) {
  return `stage-${stage.toLowerCase().replaceAll("_", "-")}`;
}

function frontOfficeVisibleLeads() {
  if (frontOfficeState.filter === "attention") {
    return frontOfficeLeads.filter(
      (lead) => lead.overdue || lead.priority === "P2",
    );
  }
  if (frontOfficeState.filter === "active") {
    return frontOfficeLeads.filter(
      (lead) => !["WON", "LOST"].includes(lead.stage),
    );
  }
  if (frontOfficeState.filter === "unassigned") {
    return frontOfficeLeads.filter((lead) => !lead.owner);
  }
  if (frontOfficeState.filter === "overdue") {
    return frontOfficeLeads.filter((lead) => lead.overdue);
  }
  if (frontOfficeState.filter === "won") {
    return frontOfficeLeads.filter((lead) => lead.stage === "WON");
  }
  if (frontOfficeState.filter.startsWith("stage:")) {
    const stage = frontOfficeState.filter.slice("stage:".length);
    return frontOfficeLeads.filter((lead) => lead.stage === stage);
  }
  return frontOfficeLeads;
}

function frontOfficeInitials(name) {
  return name.trim().slice(0, 1).toUpperCase();
}

function frontOfficeContactSummary(lead) {
  return lead.contact.toLowerCase().startsWith(lead.channel.toLowerCase())
    ? lead.contact
    : `${lead.contact} · ${lead.channel}`;
}

function frontOfficeProfileFor(lead) {
  return frontOfficeProfiles[lead.id];
}

function setFrontOfficeFilter(filter) {
  frontOfficeState.filter = filter;
  const visible = frontOfficeVisibleLeads();
  if (
    visible.length &&
    !visible.some((lead) => lead.id === frontOfficeState.selectedId)
  ) {
    frontOfficeState.selectedId = visible[0].id;
  }
  renderFrontOffice();
}

function syncFrontOfficeFilterControls() {
  document.querySelectorAll("[data-fo-filter]").forEach((item) => {
    const active = item.dataset.foFilter === frontOfficeState.filter;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.querySelectorAll("[data-fo-metric]").forEach((item) => {
    const active = item.dataset.foMetric === frontOfficeState.filter;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderFrontOfficeMetrics() {
  const active = frontOfficeLeads.filter(
    (lead) => !["WON", "LOST"].includes(lead.stage),
  );
  setText("#fo-metric-total", String(frontOfficeLeads.length));
  setText("#fo-metric-active", String(active.length));
  setText(
    "#fo-metric-unassigned",
    String(active.filter((lead) => !lead.owner).length),
  );
  setText(
    "#fo-metric-overdue",
    String(active.filter((lead) => lead.overdue).length),
  );
  setText(
    "#fo-metric-won",
    String(frontOfficeLeads.filter((lead) => lead.stage === "WON").length),
  );
  setText(
    "#fo-funnel-summary",
    `${active.length} активных лидов · ${frontOfficeLeads.filter((lead) => lead.stage === "WON").length} договор`,
  );

  const track = document.querySelector("#fo-funnel-track");
  const stages = frontOfficeStageOrder.filter((stage) => stage !== "LOST");
  track.replaceChildren(
    ...stages.map((stage) => {
      const count = frontOfficeLeads.filter(
        (lead) => lead.stage === stage,
      ).length;
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.foStage = stage;
      item.disabled = count === 0;
      item.className = `front-office-funnel-step ${frontOfficeStageClass(stage)}`;
      item.classList.toggle(
        "is-active",
        frontOfficeState.filter === `stage:${stage}`,
      );
      item.setAttribute(
        "aria-pressed",
        frontOfficeState.filter === `stage:${stage}` ? "true" : "false",
      );
      item.setAttribute(
        "aria-label",
        `${frontOfficeStageLabels[stage]}: ${count}. Показать лиды`,
      );
      item.addEventListener("click", () =>
        setFrontOfficeFilter(`stage:${stage}`),
      );
      const label = document.createElement("span");
      label.textContent = frontOfficeStageLabels[stage];
      const value = document.createElement("strong");
      value.textContent = String(count);
      item.append(label, value);
      return item;
    }),
  );
  syncFrontOfficeFilterControls();
}

function renderFrontOfficeList() {
  const list = document.querySelector("#fo-lead-list");
  const leads = frontOfficeVisibleLeads();
  setText("#fo-lead-count", String(leads.length));
  list.replaceChildren(
    ...leads.map((lead) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "front-office-lead";
      button.classList.toggle("is-real", !lead.isSynthetic);
      button.dataset.foLeadId = lead.id;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "fo-profile-layer");
      button.setAttribute(
        "aria-label",
        `Открыть карточку: ${lead.name}, ${frontOfficeStageLabels[lead.stage]}`,
      );
      button.classList.toggle(
        "is-active",
        lead.id === frontOfficeState.selectedId,
      );
      button.addEventListener("click", () => {
        openFrontOfficeProfile(lead.id, button);
      });

      const avatar = document.createElement("span");
      avatar.className = "front-office-list-avatar";
      avatar.textContent = frontOfficeInitials(lead.name);

      const body = document.createElement("span");
      body.className = "front-office-lead-body";
      const title = document.createElement("strong");
      title.textContent = lead.name;
      const meta = document.createElement("small");
      meta.textContent = `${lead.isSynthetic ? "Тест" : "Реальный входящий"} · ${lead.channel} · ${lead.intent}`;
      const footer = document.createElement("span");
      footer.className = "front-office-lead-footer";
      const stage = document.createElement("em");
      stage.className = frontOfficeStageClass(lead.stage);
      stage.textContent = frontOfficeStageLabels[lead.stage];
      const owner = document.createElement("small");
      owner.textContent = lead.owner || "Без владельца";
      footer.append(stage, owner);
      body.append(title, meta, footer);

      const indicator = document.createElement("span");
      indicator.className = `front-office-attention${lead.overdue ? " is-overdue" : ""}`;
      indicator.textContent = lead.overdue ? "!" : "›";
      button.append(avatar, body, indicator);
      return button;
    }),
  );
}

function toggleFrontOfficeTask(lead, task, checked, source) {
  task.done = checked;
  lead.audit.unshift({
    title: task.done ? "Задача выполнена" : "Задача возвращена",
    meta: "Внутренняя альфа · только локальный просмотр",
  });
  if (source !== "quick") renderFrontOfficeTasks(lead);
  renderFrontOfficeAudit(lead);
  if (frontOfficeState.profileOpen) {
    if (source !== "profile") renderFrontOfficeProfileTasks(lead);
    renderFrontOfficeProfileAudit(lead);
    setText("#fo-profile-audit-count", String(lead.audit.length));
  }
}

function renderFrontOfficeMessages(lead) {
  const container = document.querySelector("#fo-messages");
  container.replaceChildren(
    ...lead.messages.map((message) => {
      const item = document.createElement("article");
      item.className = `front-office-message is-${message.type}`;
      const head = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = message.label;
      const time = document.createElement("span");
      time.textContent = message.time;
      head.append(label, time);
      const body = document.createElement("p");
      body.textContent = message.body;
      item.append(head, body);
      return item;
    }),
  );
}

function renderFrontOfficeTasks(lead) {
  const container = document.querySelector("#fo-task-list");
  if (!lead.tasks.length) {
    const empty = document.createElement("p");
    empty.className = "front-office-empty";
    empty.textContent = "Открытых задач нет.";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(
    ...lead.tasks.map((task) => {
      const label = document.createElement("label");
      label.className = "front-office-task";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.setAttribute("aria-label", `${task.title}. Срок: ${task.due}`);
      checkbox.addEventListener("change", () => {
        toggleFrontOfficeTask(lead, task, checkbox.checked, "quick");
      });
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = task.title;
      const due = document.createElement("small");
      due.textContent = task.due;
      copy.append(title, due);
      label.append(checkbox, copy);
      return label;
    }),
  );
}

function renderFrontOfficeAudit(lead) {
  const container = document.querySelector("#fo-audit");
  container.replaceChildren(
    ...lead.audit.slice(0, 5).map((event) => {
      const item = document.createElement("div");
      const dot = document.createElement("span");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.title;
      const meta = document.createElement("small");
      meta.textContent = event.meta;
      copy.append(title, meta);
      item.append(dot, copy);
      return item;
    }),
  );
}

function renderFrontOfficeCard() {
  const lead = frontOfficeSelectedLead();
  setText("#fo-avatar", frontOfficeInitials(lead.name));
  setText("#fo-contact-name", lead.name);
  setText("#fo-contact-meta", frontOfficeContactSummary(lead));
  setText("#fo-priority", lead.priority);
  setText("#fo-source", lead.source);
  setText("#fo-intent", lead.intent);

  const stageSelect = document.querySelector("#fo-stage");
  stageSelect.replaceChildren(
    ...frontOfficeStageOrder.map((stage) => {
      const option = document.createElement("option");
      option.value = stage;
      option.textContent = frontOfficeStageLabels[stage];
      option.disabled =
        frontOfficeStageOrder.indexOf(stage) <
          frontOfficeStageOrder.indexOf(lead.stage) && stage !== "LOST";
      return option;
    }),
  );
  stageSelect.value = lead.stage;
  document.querySelector("#fo-owner").value = lead.owner;
  document.querySelector("#fo-next-action").value = lead.nextAction;
  document.querySelector("#fo-next-at").value = lead.nextAt;
  document.querySelector("#fo-program").value = lead.program;
  setText("#fo-save-status", "");

  renderFrontOfficeMessages(lead);
  renderFrontOfficeTasks(lead);
  renderFrontOfficeAudit(lead);
}

function appendFrontOfficeProfileFields(selector, fields) {
  const container = document.querySelector(selector);
  container.replaceChildren(
    ...fields.map(([label, value, note = "", href = ""]) => {
      const item = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      const strong = document.createElement("strong");
      if (href && value) {
        const link = document.createElement("a");
        link.className = "front-office-contact-link";
        link.href = href;
        link.textContent = value;
        strong.append(link);
      } else {
        strong.textContent = value || "Не заполнено";
      }
      definition.append(strong);
      if (note) {
        const small = document.createElement("small");
        small.textContent = note;
        definition.append(small);
      }
      item.append(term, definition);
      return item;
    }),
  );
}

function appendFrontOfficeProfileBadges(lead, profile) {
  const container = document.querySelector("#fo-profile-badges");
  const badges = [
    {
      label: frontOfficeStageLabels[lead.stage],
      className: frontOfficeStageClass(lead.stage),
    },
    { label: lead.priority, className: "is-priority" },
    { label: profile.factStatus, className: "is-fact" },
  ];
  container.replaceChildren(
    ...badges.map((badge) => {
      const item = document.createElement("span");
      item.className = badge.className;
      item.textContent = badge.label;
      return item;
    }),
  );
}

function renderFrontOfficeProfileHistory(lead) {
  const container = document.querySelector("#fo-profile-history");
  container.replaceChildren(
    ...lead.messages.map((message) => {
      const item = document.createElement("article");
      item.className = `front-office-profile-history-item is-${message.type}`;
      const rail = document.createElement("span");
      const copy = document.createElement("div");
      const head = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = message.label;
      const time = document.createElement("small");
      time.textContent = message.time;
      head.append(label, time);
      const body = document.createElement("p");
      body.textContent = message.body;
      copy.append(head, body);
      item.append(rail, copy);
      return item;
    }),
  );
}

function renderFrontOfficeProfileTasks(lead) {
  const container = document.querySelector("#fo-profile-tasks");
  if (!lead.tasks.length) {
    const empty = document.createElement("p");
    empty.className = "front-office-profile-empty";
    empty.textContent = "Для этого лида задач пока нет.";
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(
    ...lead.tasks.map((task) => {
      const label = document.createElement("label");
      label.className = "front-office-profile-task";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.setAttribute("aria-label", `${task.title}. Срок: ${task.due}`);
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = task.title;
      const due = document.createElement("small");
      due.textContent = task.due;
      copy.append(title, due);
      const action = document.createElement("em");
      action.textContent = task.done ? "Выполнено" : "Открыта";
      checkbox.addEventListener("change", () => {
        action.textContent = checkbox.checked ? "Выполнено" : "Открыта";
        toggleFrontOfficeTask(lead, task, checkbox.checked, "profile");
      });
      label.append(checkbox, copy, action);
      return label;
    }),
  );
}

function renderFrontOfficeProfileAudit(lead) {
  const container = document.querySelector("#fo-profile-audit");
  container.replaceChildren(
    ...lead.audit.map((event) => {
      const item = document.createElement("article");
      const marker = document.createElement("span");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.title;
      const meta = document.createElement("small");
      meta.textContent = event.meta;
      copy.append(title, meta);
      item.append(marker, copy);
      return item;
    }),
  );
}

function setFrontOfficeProfileTab(tab) {
  frontOfficeState.profileTab = tab;
  document.querySelectorAll("[data-fo-profile-tab]").forEach((button) => {
    const active = button.dataset.foProfileTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-fo-profile-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.foProfilePanel === tab);
  });
}

function renderFrontOfficeProfile() {
  const lead = frontOfficeSelectedLead();
  const profile = frontOfficeProfileFor(lead);
  setText("#fo-profile-avatar", frontOfficeInitials(lead.name));
  setText("#fo-profile-name", lead.name);
  setText(
    "#fo-profile-meta",
    `${frontOfficeContactSummary(lead)} · ${lead.source}`,
  );
  appendFrontOfficeProfileBadges(lead, profile);

  appendFrontOfficeProfileFields("#fo-profile-contact-fields", [
    [
      "Телефон",
      profile.phone,
      lead.isSynthetic
        ? "Маскирован в тестовых данных"
        : "Нажмите, чтобы позвонить",
      lead.links?.phone ?? "",
    ],
    ["Email", profile.email, "", lead.links?.email ?? ""],
    ["Мессенджер", profile.messenger, "", lead.links?.messenger ?? ""],
    ["Предпочтительный канал", profile.preferredChannel],
    ["Статус проверки", profile.identityStatus],
    ["Роль контакта", profile.contactRole],
  ]);
  appendFrontOfficeProfileFields("#fo-profile-request-fields", [
    ["Возрастная группа", profile.ageBand],
    ["Филиал", profile.branch],
    ["Цель", profile.goal],
    ["Удобное время", profile.schedule],
    ["Подобранная программа", lead.program || "Не подобрана"],
    ["Бюджет", profile.budget],
  ]);
  appendFrontOfficeProfileFields("#fo-profile-marketing-fields", [
    ["Источник", lead.source],
    ["Кампания", profile.campaign],
    ["Метка", profile.utm],
    ["Первое касание", profile.firstTouch],
    ["Последнее касание", profile.lastTouch],
    ["Канал", lead.channel],
  ]);
  appendFrontOfficeProfileFields("#fo-profile-sales-fields", [
    ["Этап", frontOfficeStageLabels[lead.stage]],
    ["Приоритет", lead.priority],
    ["Владелец", lead.owner || "Не назначен"],
    ["Статус фактов", profile.factStatus],
  ]);

  setText(
    "#fo-profile-next-action",
    lead.nextAction || "Следующий шаг не требуется",
  );
  setText(
    "#fo-profile-next-at",
    lead.nextAt
      ? `Срок · ${lead.nextAt.replace("T", " · ")}`
      : "Срок не установлен",
  );
  setText("#fo-profile-owner", lead.owner || "Не назначен");
  setText("#fo-profile-history-count", String(lead.messages.length));
  setText("#fo-profile-task-count", String(lead.tasks.length));
  setText("#fo-profile-audit-count", String(lead.audit.length));

  renderFrontOfficeProfileHistory(lead);
  renderFrontOfficeProfileTasks(lead);
  renderFrontOfficeProfileAudit(lead);
  setFrontOfficeProfileTab(frontOfficeState.profileTab);
}

function openFrontOfficeProfile(id, trigger) {
  frontOfficeState.selectedId = id;
  renderFrontOffice();
  frontOfficeState.profileOpen = true;
  frontOfficeState.profileTab = "overview";
  frontOfficeState.profileTrigger = trigger?.isConnected
    ? trigger
    : (document.querySelector(`[data-fo-lead-id="${id}"]`) ??
      document.querySelector("#fo-open-profile"));
  renderFrontOfficeProfile();
  const layer = document.querySelector("#fo-profile-layer");
  layer.hidden = false;
  document.body.classList.add("front-office-profile-open");
  layer
    .querySelector(
      "[data-fo-profile-close]:not(.front-office-profile-backdrop)",
    )
    ?.focus();
}

function closeFrontOfficeProfile() {
  if (!frontOfficeState.profileOpen) return;
  document.querySelector("#fo-profile-layer").hidden = true;
  document.body.classList.remove("front-office-profile-open");
  frontOfficeState.profileOpen = false;
  const fallback = document.querySelector(
    `[data-fo-lead-id="${frontOfficeState.selectedId}"]`,
  );
  (frontOfficeState.profileTrigger?.isConnected
    ? frontOfficeState.profileTrigger
    : fallback
  )?.focus();
}

function renderFrontOffice() {
  renderFrontOfficeMetrics();
  renderFrontOfficeList();
  renderFrontOfficeCard();
  if (frontOfficeState.profileOpen) renderFrontOfficeProfile();
}

async function saveFrontOfficeLead(event) {
  event.preventDefault();
  const lead = frontOfficeSelectedLead();
  const previousStage = lead.stage;
  const nextStage = document.querySelector("#fo-stage").value;
  if (
    frontOfficeStageOrder.indexOf(nextStage) <
      frontOfficeStageOrder.indexOf(previousStage) &&
    nextStage !== "LOST"
  ) {
    setText("#fo-save-status", "Назад по воронке нельзя");
    return;
  }
  const owner = document.querySelector("#fo-owner").value;
  const nextAction = document.querySelector("#fo-next-action").value.trim();
  const nextAt = document.querySelector("#fo-next-at").value;
  const program = document.querySelector("#fo-program").value.trim();
  if (!lead.isSynthetic) {
    setText("#fo-save-status", "Сохраняем…");
    try {
      const response = await fetch(`/api/front-office/leads/${lead.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-arthello-action": "owner-confirmed",
        },
        body: JSON.stringify({
          stage: nextStage,
          ownerDisplayName: owner || null,
          nextAction: nextAction || null,
          nextActionAt: nextAt ? `${nextAt}:00+03:00` : null,
          programInterest: program || null,
          expectedVersion: lead.version,
        }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          await loadFrontOfficeLeads();
          setText("#fo-save-status", "Карточка изменилась — данные обновлены");
          return;
        }
        throw new Error("save_failed");
      }
      const payload = await response.json();
      lead.version = payload.version;
    } catch {
      setText("#fo-save-status", "Не сохранено. Попробуйте ещё раз");
      return;
    }
  }
  lead.stage = nextStage;
  lead.owner = owner;
  lead.nextAction = nextAction;
  lead.nextAt = nextAt;
  lead.program = program;
  lead.overdue = false;
  lead.audit.unshift({
    title:
      previousStage === nextStage
        ? "Карточка обновлена"
        : `Этап: ${frontOfficeStageLabels[nextStage]}`,
    meta: lead.isSynthetic
      ? "Тестовые данные · сохранено в текущей сессии"
      : "ArtHello OS · сохранено",
  });
  renderFrontOffice();
  setText("#fo-save-status", "Сохранено внутри");
}

async function saveFrontOfficeNote() {
  const body = document.querySelector("#fo-compose-body");
  const value = body.value.trim();
  if (!value) {
    body.focus();
    return;
  }
  const lead = frontOfficeSelectedLead();
  const draft = frontOfficeState.composeType === "ai_draft";
  let createdAt = "Текущая сессия";
  if (!lead.isSynthetic) {
    setText("#fo-save-status", "Сохраняем заметку…");
    try {
      const response = await fetch(`/api/front-office/leads/${lead.id}/notes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-arthello-action": "owner-confirmed",
        },
        body: JSON.stringify({
          type: frontOfficeState.composeType,
          body: value,
        }),
      });
      if (!response.ok) throw new Error("note_failed");
      createdAt = frontOfficeDateTime((await response.json()).createdAt);
    } catch {
      setText("#fo-save-status", "Заметка не сохранена");
      return;
    }
  }
  lead.messages.push({
    type: frontOfficeState.composeType,
    label: draft ? "AI-черновик · не отправлен" : "Внутренняя заметка",
    body: value,
    time: createdAt,
  });
  lead.audit.unshift({
    title: draft ? "AI-черновик сохранён" : "Заметка сохранена",
    meta: "Внутреннее действие · без отправки",
  });
  body.value = "";
  renderFrontOfficeMessages(lead);
  renderFrontOfficeAudit(lead);
  if (frontOfficeState.profileOpen) renderFrontOfficeProfile();
  setText("#fo-save-status", "Сохранено внутри");
}

function frontOfficeDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(parsed);
}

function frontOfficeIdentityLabel(value) {
  const labels = {
    not_required: "Не требуется для первичной заявки",
    verified: "Проверен",
    partial: "Проверен частично",
    failed: "Проверка не пройдена",
  };
  return labels[value] ?? "Не проверен";
}

function mapRealFrontOfficeLead(row) {
  const phone = row.phone ?? "";
  const email = row.email ?? "";
  const contact = phone || email || row.contact || "Контакт не указан";
  const messages = (row.messages ?? []).map((message) => ({
    ...message,
    time: frontOfficeDateTime(message.time),
  }));
  const audit = (row.audit ?? []).map((event) => ({
    ...event,
    meta: event.meta
      .split(" · ")
      .map((part, index) => (index ? frontOfficeDateTime(part) : part))
      .join(" · "),
  }));
  const lead = {
    ...row,
    contact,
    messages,
    audit,
    tasks: row.tasks ?? [],
    nextAt: row.nextAt ? String(row.nextAt).slice(0, 16) : "",
    isSynthetic: false,
    links: {
      phone: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : "",
      email: email ? `mailto:${email}` : "",
      messenger: "",
    },
  };
  frontOfficeProfiles[lead.id] = {
    phone: phone || "Не указан",
    email: email || "Не указан",
    messenger: "Не указан",
    preferredChannel: lead.channel,
    identityStatus: frontOfficeIdentityLabel(lead.identityStatus),
    contactRole: "Контакт первичной заявки · права не проверялись",
    ageBand: lead.ageBand || "Нужно уточнить",
    branch:
      lead.route === "SCHOOL_1_11_QUEUE"
        ? "Отдельная очередь «Школа 1–11»"
        : lead.branch || "Нужно уточнить",
    goal: lead.intent,
    schedule: "Нужно уточнить",
    budget: "Не запрашивался",
    campaign: lead.campaign || "Не определена",
    utm: lead.campaign || "Не передана",
    firstTouch: frontOfficeDateTime(lead.firstTouchAt),
    lastTouch: frontOfficeDateTime(lead.lastMessageAt),
    factStatus: "UNVERIFIED",
  };
  return lead;
}

async function loadFrontOfficeLeads() {
  try {
    const response = await fetch("/api/front-office/leads", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("front_office_unavailable");
    const payload = await response.json();
    if (payload.projectId !== "ARTHELLO") {
      throw new Error("project_mismatch");
    }
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (rows.length) {
      frontOfficeLeads = rows.map(mapRealFrontOfficeLead);
      frontOfficeState.selectedId = frontOfficeLeads[0].id;
      setText("#fo-data-mode", "REAL_INBOUND");
      setText("#fo-data-title", "Реальные входящие подключены");
      setText("#fo-metric-mode", "реальные заявки");
    } else {
      frontOfficeLeads = [...frontOfficeDemoLeads];
      frontOfficeState.selectedId = frontOfficeLeads[0].id;
      setText("#fo-data-mode", "ЖДЁМ ПЕРВЫЙ ЛИД");
      setText("#fo-data-title", "Канал готовится к первому тесту");
      setText("#fo-metric-mode", "пока тестовые карточки");
    }
    renderFrontOffice();
  } catch {
    frontOfficeLeads = [...frontOfficeDemoLeads];
    frontOfficeState.selectedId = frontOfficeLeads[0].id;
    setText("#fo-data-mode", "ТЕСТОВЫЕ ДАННЫЕ");
    setText("#fo-data-title", "Реальный входящий ящик пока недоступен");
    setText("#fo-metric-mode", "тестовые карточки");
    renderFrontOffice();
  }
}

const integrationConnectors = [
  {
    id: "site",
    mark: "WEB",
    name: "Сайт и веб-чат",
    group: "channel",
    groupLabel: "Обращения",
    wave: 1,
    pilot: true,
    purpose: "Заявки с arthello.ru сразу появляются во входящем ящике.",
    inbound: "формы, веб-чат, согласия, страница входа",
    stores: "contact candidate, UTM, yclid, landing page, message_id",
    prerequisite: "утвердить формы, согласия и домены ArtHello",
    guide: {
      result:
        "Каждая отправленная форма arthello.ru создаёт лид во «Входящих». Менеджер открывает карточку, видит контакты и обрабатывает заявку вручную.",
      preparation: [
        "Доступ администратора или дизайнера к проекту arthello.ru в Webflow.",
        "Список форм, которые должны создавать лиды: обратный звонок, пробное занятие, заявка на программу и другие.",
        "Утверждённый срок хранения заявок пилота.",
      ],
      steps: [
        {
          title: "Получите защищённый адрес",
          text: "После подтверждения срока хранения нажмите кнопку «Получить адрес» внизу этой карточки. Адрес предназначен только для Webflow — не публикуйте его и не отправляйте в переписке.",
        },
        {
          title: "Откройте нужную форму в Webflow",
          text: "Откройте Designer проекта arthello.ru, перейдите на страницу с формой и выделите сам Form block на холсте или в Navigator.",
        },
        {
          title: "Добавьте Webhook",
          text: "В правой панели откройте Settings. В блоке Send to нажмите «+», выберите Webhook и вставьте адрес из ArtHello OS.",
        },
        {
          title: "Сохраните настройки",
          text: "Нажмите Save. Webflow можно оставить ещё одним получателем формы, чтобы привычные уведомления продолжили работать параллельно с ArtHello OS.",
        },
        {
          title: "Сохраните секрет Webflow",
          text: "Если Webflow покажет Secret key, сохраните его в менеджере паролей — сервис показывает ключ один раз. Не присылайте ключ в чат и не вставляйте в публичные документы.",
        },
        {
          title: "Опубликуйте сайт",
          text: "Опубликуйте изменения на домене arthello.ru. Без публикации настройка останется только в Designer и реальные формы продолжат работать по-старому.",
        },
        {
          title: "Отправьте тестовую заявку",
          text: "Заполните форму на опубликованном сайте своими тестовыми данными. В сообщении укажите «ТЕСТ ARTHELLO», чтобы менеджер не принял её за реального клиента.",
        },
      ],
      checks: [
        "Во «Входящих» появилась одна карточка с каналом «Сайт».",
        "В карточке видны имя, замаскированный контакт, текст формы и источник.",
        "Клиенту не ушёл автоматический ответ, а менеджер может взять лид в работу вручную.",
      ],
      caution:
        "Если тест не появился, не отправляйте десять одинаковых форм подряд. Сначала проверьте публикацию Webflow и статус подключения в этой карточке.",
      docs: {
        label: "Официальная инструкция Webflow по формам и Webhook",
        url: "https://help.webflow.com/hc/en-us/articles/33961347548563-How-do-I-add-forms-in-Webflow",
      },
    },
  },
  {
    id: "telegram",
    mark: "TG",
    name: "Telegram",
    group: "channel",
    groupLabel: "Обращения",
    wave: 1,
    pilot: true,
    purpose:
      "Подключим, когда менеджер сможет отвечать человеку вручную из рабочего контура.",
    inbound: "сообщения, вложения, delivery events",
    stores: "external chat_id, message_id, username mask, consent state",
    prerequisite: "создать официальный бот и определить рабочий аккаунт",
    guide: {
      result:
        "Новые сообщения официальному боту будут создавать диалог и лид в ArtHello OS. Подключение включим только вместе с ручной отправкой из OS, иначе менеджер увидит сообщение, но не сможет нормально ответить от имени бота.",
      preparation: [
        "Telegram-аккаунт владельца будущего бота.",
        "Название, username и короткое описание официального бота ArtHello.",
        "Назначенный менеджер и понятный режим ручных ответов из ArtHello OS.",
      ],
      steps: [
        {
          title: "Создайте официального бота",
          text: "Откройте проверенного @BotFather, отправьте /newbot, задайте название и свободный username, который заканчивается на bot.",
        },
        {
          title: "Сохраните токен безопасно",
          text: "BotFather выдаст токен управления ботом. Не пересылайте его в обычный чат. При подключении ArtHello OS покажет отдельное защищённое поле для токена.",
        },
        {
          title: "Оформите профиль",
          text: "Через BotFather добавьте фото, описание, приветствие и команды. Пользователь должен сразу понимать, что пишет в официальный канал ArtHello.",
        },
        {
          title: "Включите ручные ответы в OS",
          text: "До приёма реальных сообщений должен работать экран ответа менеджера. Исходящие остаются только ручными: никакого автоматического текста и рассылок.",
        },
        {
          title: "Зарегистрируйте Webhook",
          text: "ArtHello OS создаст HTTPS-адрес, сохранит токен на сервере и зарегистрирует Webhook Telegram с отдельным секретом проверки.",
        },
        {
          title: "Проведите тестовый диалог",
          text: "Напишите боту /start с обычного аккаунта, затем отправьте текст и изображение. Проверьте, что они попали в один диалог, а не в несколько лидов.",
        },
        {
          title: "Ответьте как менеджер",
          text: "Отправьте один ручной ответ из карточки лида и убедитесь, что он появился в том же Telegram-диалоге и сохранился в истории.",
        },
      ],
      checks: [
        "Текст и вложение пришли в один диалог.",
        "Имя пользователя не стало автоматически профилем семьи без проверки.",
        "Ручной ответ дошёл один раз и записался в аудит.",
      ],
      caution:
        "Пока ручная отправка из ArtHello OS не готова, Telegram оставляем на паузе. Подключить входящие без возможности ответить — быстрый способ потерять лид с технологичным выражением лица.",
      docs: {
        label: "Официальная справка Telegram о создании и подключении ботов",
        url: "https://core.telegram.org/bots/faq",
      },
    },
  },
  {
    id: "vk-messages",
    mark: "VK",
    name: "VK · сообщения",
    group: "channel",
    groupLabel: "Обращения",
    wave: 1,
    pilot: true,
    purpose:
      "Сообщения сообщества попадут в OS, а менеджер ответит в кабинете VK.",
    inbound: "сообщения сообщества, комментарии, вложения",
    stores: "community_id, peer_id, message_id, source post",
    prerequisite: "утвердить сообщество и минимальные права API",
    guide: {
      result:
        "Сообщения официального сообщества VK создают лиды в ArtHello OS. На первом этапе менеджер отвечает клиенту в привычном разделе сообщений сообщества VK.",
      preparation: [
        "Ссылка на официальное сообщество ArtHello и права администратора.",
        "Включённые сообщения сообщества.",
        "Доступ менеджера к разделу сообщений сообщества VK.",
      ],
      steps: [
        {
          title: "Проверьте сообщения сообщества",
          text: "Откройте сообщество → Управление → Сообщения и включите возможность писать сообществу. Проверьте приветствие и кнопку сообщения на странице.",
        },
        {
          title: "Откройте Callback API",
          text: "Перейдите в Управление → Работа с API → Callback API. Выберите актуальную версию API и создайте новый сервер для ArtHello OS.",
        },
        {
          title: "Получите адрес и секрет",
          text: "ArtHello OS покажет адрес Callback API и отдельную секретную строку. Вставьте их в настройки сервера VK; секрет не отправляйте в переписке.",
        },
        {
          title: "Подтвердите сервер",
          text: "VK отправит проверочный запрос. ArtHello OS автоматически вернёт строку подтверждения, после чего сервер должен получить статус «Подтверждён».",
        },
        {
          title: "Выберите события",
          text: "В типах событий включите новые входящие сообщения сообщества и необходимые вложения. Публикации, лайки и остальные события пока не подключайте.",
        },
        {
          title: "Создайте минимальный ключ",
          text: "В разделе ключей доступа создайте ключ сообщества только с правами, необходимыми для сообщений. Он будет введён в защищённое поле ArtHello OS, а не в браузерное хранилище.",
        },
        {
          title: "Отправьте тест с другого профиля",
          text: "Напишите сообществу с обычного пользовательского аккаунта. Менеджер должен увидеть сообщение и в VK, и как новый лид во «Входящих».",
        },
        {
          title: "Ответьте в VK",
          text: "На первом пилоте менеджер отвечает в кабинете VK. В карточке ArtHello OS он вручную фиксирует результат, следующий шаг и ответственного.",
        },
      ],
      checks: [
        "Одно сообщение создаёт один лид, повторная доставка не создаёт дубль.",
        "В карточке указан канал VK и сохранена ссылка на исходный диалог.",
        "Менеджер может продолжить разговор в VK без переключения клиента на другой канал.",
      ],
      caution:
        "Не выдавайте ключ с правами на стену, рекламу или управление сообществом, если для входящих сообщений они не нужны.",
      docs: {
        label: "Официальная документация VK Callback API",
        url: "https://dev.vk.com/ru/api/callback/getting-started",
      },
    },
  },
  {
    id: "whatsapp",
    mark: "WA",
    name: "WhatsApp Business",
    group: "channel",
    groupLabel: "Обращения",
    wave: 3,
    purpose: "Официальный WhatsApp Business без серых подключений.",
    inbound: "сообщения, статусы доставки, шаблонные события",
    stores: "business number id, conversation id, message_id, delivery state",
    prerequisite: "Meta Business, официальный номер и утверждённые шаблоны",
    guide: {
      result:
        "Входящие сообщения официального номера WhatsApp Business создают диалоги в ArtHello OS. Запускать канал будем только после проверки, где менеджер продолжит ручной разговор.",
      preparation: [
        "Доступ администратора к Meta Business Portfolio компании.",
        "Отдельный или заранее выбранный официальный номер ArtHello.",
        "Решение, будет ли номер переноситься в Cloud API и где менеджер станет отвечать.",
      ],
      steps: [
        {
          title: "Проверьте бизнес-аккаунт Meta",
          text: "Убедитесь, что компания и администратор доступны в Meta Business. Если Meta запросит подтверждение организации, сначала завершите его.",
        },
        {
          title: "Создайте приложение с WhatsApp",
          text: "В Meta for Developers создайте бизнес-приложение, добавьте продукт WhatsApp и выберите или создайте WhatsApp Business Account.",
        },
        {
          title: "Добавьте номер",
          text: "Подтвердите номер кодом, задайте отображаемое имя и дождитесь его проверки. До переноса отдельно проверьте, сохранится ли нужный вам режим работы приложения WhatsApp Business.",
        },
        {
          title: "Передайте идентификаторы безопасно",
          text: "ArtHello OS запросит Phone number ID, WhatsApp Business Account ID и серверный токен через защищённые поля. Пароль от Meta и код подтверждения системе не нужны.",
        },
        {
          title: "Настройте Webhook",
          text: "Вставьте Callback URL и Verify token, которые выдаст ArtHello OS, подтвердите Webhook и подпишитесь только на события messages.",
        },
        {
          title: "Настройте ручную работу",
          text: "Определите, где менеджер отвечает на первом этапе: в Meta Business Suite, у официального провайдера или позже внутри ArtHello OS.",
        },
        {
          title: "Проведите тест",
          text: "Напишите на номер с другого телефона, отправьте текст и изображение. Проверьте один диалог, корректный статус доставки и ручной ответ.",
        },
      ],
      checks: [
        "Сообщения одного номера объединяются в один диалог.",
        "Токен и полный номер не отображаются в интерфейсе и журнале.",
        "До отдельного разрешения ArtHello OS не начинает рассылки и не отправляет шаблоны.",
      ],
      caution:
        "Не подключайте к тесту основной номер, пока не проверен режим его совместной работы с текущим WhatsApp Business и выбран интерфейс менеджера.",
      docs: {
        label: "Официальный старт WhatsApp Cloud API",
        url: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
      },
    },
  },
  {
    id: "max",
    mark: "MAX",
    name: "MAX",
    group: "channel",
    groupLabel: "Обращения",
    wave: 4,
    purpose: "Официальный бот MAX после первого пилота.",
    inbound: "сообщения бота, вложения, callback-события",
    stores: "bot_id, chat_id, message_id, webhook status",
    prerequisite: "подтверждённая организация и публичный HTTPS webhook",
    guide: {
      result:
        "Сообщения официальному боту MAX попадут во «Входящие». Канал подключаем после сайта и VK, когда подтверждён реальный объём обращений.",
      preparation: [
        "Подтверждённая организация в бизнес-платформе MAX.",
        "Название, описание и ответственный владелец бота.",
        "Готовый процесс ручного ответа менеджера.",
      ],
      steps: [
        {
          title: "Подтвердите организацию",
          text: "Откройте бизнес-платформу MAX, создайте профиль организации и завершите предложенную сервисом проверку.",
        },
        {
          title: "Создайте чат-бота",
          text: "В разделе чат-ботов создайте официального бота ArtHello, заполните профиль и отправьте его на модерацию, если платформа это потребует.",
        },
        {
          title: "Получите токен",
          text: "После активации сохраните токен интеграции в защищённом хранилище. Не помещайте его в документ, задачу или обычный чат.",
        },
        {
          title: "Получите HTTPS-адрес OS",
          text: "ArtHello OS создаст отдельный Webhook для MAX и защищённое поле для токена.",
        },
        {
          title: "Создайте подписку",
          text: "Через API MAX зарегистрируйте HTTPS Webhook в subscriptions и подпишитесь только на события новых сообщений и нужных вложений.",
        },
        {
          title: "Проверьте подписку",
          text: "Убедитесь через список subscriptions, что активен один правильный адрес. Одновременно Webhook и Long Polling для рабочего подключения не используем.",
        },
        {
          title: "Проведите тест",
          text: "Отправьте боту сообщение с обычного аккаунта и проверьте появление одного лида, вложения и ручного следующего шага.",
        },
      ],
      checks: [
        "Webhook использует HTTPS и отображается активным.",
        "Тест создаёт один диалог и не запускает автоответ.",
        "Менеджер знает, где и как вручную продолжить разговор.",
      ],
      caution:
        "Модерация и требования платформы могут занять время, поэтому MAX не должен блокировать запуск более быстрых каналов.",
      docs: {
        label: "Официальная документация MAX Bot API",
        url: "https://dev.max.ru/docs-api",
      },
    },
  },
  {
    id: "instagram",
    mark: "IG",
    name: "Instagram · сообщения",
    group: "channel",
    groupLabel: "Обращения",
    wave: 4,
    purpose: "Сообщения профессионального аккаунта в одном входящем ящике.",
    inbound: "direct messages, conversation events",
    stores: "professional account id, conversation id, message_id",
    prerequisite: "профессиональный аккаунт, Meta access и правовая проверка",
    guide: {
      result:
        "Сообщения профессиональному аккаунту Instagram создают диалоги в ArtHello OS, а менеджер продолжает ручной ответ через разрешённый интерфейс Meta.",
      preparation: [
        "Профессиональный аккаунт Instagram ArtHello.",
        "Связанная Facebook Page и доступ администратора в Meta Business.",
        "Проверка доступности нужных функций для аккаунта и региона.",
      ],
      steps: [
        {
          title: "Проверьте тип и связи аккаунта",
          text: "Instagram должен быть профессиональным и связан с Facebook Page, которая находится в том же Meta Business Portfolio.",
        },
        {
          title: "Проверьте сообщения в Meta",
          text: "Откройте Meta Business Suite и убедитесь, что администратор видит входящие Instagram и может ответить на тестовое сообщение.",
        },
        {
          title: "Создайте приложение Meta",
          text: "В Meta for Developers создайте бизнес-приложение и добавьте продукт для Instagram Messaging.",
        },
        {
          title: "Запросите минимальные права",
          text: "Подключите только разрешения, необходимые для чтения и ручной обработки сообщений. Публикации, реклама и управление профилем в первый пилот не входят.",
        },
        {
          title: "Подключите Webhook",
          text: "Вставьте Callback URL и Verify token ArtHello OS, подпишитесь на события сообщений профессионального аккаунта.",
        },
        {
          title: "Авторизуйте страницу и аккаунт",
          text: "В защищённом процессе Meta выберите только официальную страницу и Instagram-аккаунт ArtHello. Токены не копируются в обычный чат.",
        },
        {
          title: "Проведите тест",
          text: "Отправьте Direct с аккаунта, который не является администратором. Проверьте диалог в Meta Business Suite и один лид в ArtHello OS.",
        },
      ],
      checks: [
        "Источник лида однозначно подписан как Instagram.",
        "Сообщения одного человека идут в один диалог без автоматического объединения с семьёй.",
        "Менеджер отвечает вручную, автоответы и массовые сообщения выключены.",
      ],
      caution:
        "Не обещаем подключение до проверки прав и доступности Instagram Messaging для конкретного бизнес-аккаунта.",
      docs: {
        label: "Официальный старт Instagram Messaging API",
        url: "https://developers.facebook.com/docs/messenger-platform/instagram/get-started",
      },
    },
  },
  {
    id: "yandex-metrika",
    mark: "M",
    name: "Яндекс Метрика",
    group: "marketing",
    groupLabel: "Маркетинг",
    wave: 2,
    purpose: "Покажет, какая реклама привела заявку и договор.",
    inbound: "визиты, цели, UTM, yclid, расходы и offline conversions",
    stores: "counter_id, client_id, goal, campaign attribution",
    prerequisite: "счётчики, цели, политика согласий и карта конверсий",
    guide: {
      result:
        "ArtHello OS показывает источник заявки, визиты и достижение целей рядом с лидом. Первый режим — только чтение статистики, без изменения счётчика.",
      preparation: [
        "Логин Яндекса с доступом к счётчику arthello.ru.",
        "Номер счётчика и список действующих целей.",
        "Согласованная карта: заявка → пробное → договор.",
      ],
      steps: [
        {
          title: "Проверьте счётчик",
          text: "Откройте Яндекс Метрику, выберите arthello.ru и убедитесь, что счётчик получает визиты с правильного домена.",
        },
        {
          title: "Проверьте цели",
          text: "Соберите названия и ID целей для отправки формы, звонка, пробного занятия и договора. Удалять или менять цели на этом этапе не нужно.",
        },
        {
          title: "Определите доступ",
          text: "Для ручной проверки можно выдать отдельному рабочему логину доступ «Только просмотр». Для серверного импорта ArtHello OS использует OAuth.",
        },
        {
          title: "Авторизуйте ArtHello OS",
          text: "Нажмите будущую кнопку подключения и подтвердите доступ на стороне Яндекса. Пароль не передаётся ArtHello OS, токен хранится только на сервере.",
        },
        {
          title: "Выберите счётчик",
          text: "После авторизации выберите только счётчик arthello.ru и режим чтения отчётов.",
        },
        {
          title: "Сопоставьте цели",
          text: "В ArtHello OS свяжите каждую цель с этапом воронки. Неизвестные и старые цели оставьте без автоматического назначения.",
        },
        {
          title: "Проверьте отчёт",
          text: "Сравните за один и тот же день визиты и цели в Метрике и ArtHello OS. Расхождения фиксируются, а не подгоняются вручную.",
        },
      ],
      checks: [
        "Выбран правильный счётчик arthello.ru.",
        "ArtHello OS читает статистику, но не меняет цели и настройки.",
        "UTM и yclid сохраняются рядом с лидом и не заменяют подтверждённый источник сделки.",
      ],
      caution:
        "Публичный доступ к статистике для интеграции не нужен. Используем отдельную авторизацию с минимальными правами.",
      docs: {
        label: "Официальная документация API Яндекс Метрики",
        url: "https://yandex.ru/dev/metrika/ru/",
      },
    },
  },
  {
    id: "yandex-direct",
    mark: "Я",
    name: "Яндекс Директ",
    group: "marketing",
    groupLabel: "Маркетинг",
    wave: 2,
    purpose: "Расходы поиска и РСЯ рядом с результатами продаж.",
    inbound: "кампании, группы, объявления, ключевые фразы, расходы",
    stores: "campaign_id, ad_id, criterion_id, cost, yclid",
    prerequisite: "OAuth-приложение и доступ только к чтению статистики",
    guide: {
      result:
        "Расходы поиска и РСЯ сопоставляются с лидами, пробными занятиями и договорами. На первом этапе ArtHello OS только читает статистику.",
      preparation: [
        "Логин владельца или представителя рекламного кабинета ArtHello.",
        "Хотя бы одна действующая или архивная кампания в Директе.",
        "Список кабинетов и агентских клиентов, если реклама ведётся через агентство.",
      ],
      steps: [
        {
          title: "Зарегистрируйте OAuth-приложение",
          text: "Под рабочим логином разработчика создайте приложение Яндекс OAuth и добавьте право использования API Директа.",
        },
        {
          title: "Подайте заявку на API",
          text: "В настройках API Директа откройте «Мои заявки», создайте заявку для приложения и укажите, что ArtHello OS собирает статистику для собственного управленческого учёта.",
        },
        {
          title: "Дождитесь одобрения",
          text: "До одобрения используйте только тестовый контур. Заявка на реальный API рассматривается Яндексом отдельно.",
        },
        {
          title: "Авторизуйте рекламный логин",
          text: "После одобрения войдите под логином Директа и подтвердите доступ приложению. Пароль остаётся у Яндекса; ArtHello OS получает OAuth-токен.",
        },
        {
          title: "Выберите кабинет",
          text: "Если логин агентский, явно выберите нужного клиента ArtHello. Автоматически собирать все кабинеты агентства нельзя.",
        },
        {
          title: "Ограничьте первый режим",
          text: "Включите импорт кампаний, объявлений, кликов и расходов. Изменение ставок, бюджетов, объявлений и запуск кампаний оставьте выключенными.",
        },
        {
          title: "Проверьте расходы",
          text: "Сравните один закрытый день в интерфейсе Директа и ArtHello OS по кабинету, кампании и валюте.",
        },
        {
          title: "Свяжите с лидами",
          text: "Проверьте, что yclid и UTM из формы связывают заявку с кампанией, но не объединяют клиентов по одному совпавшему параметру.",
        },
      ],
      checks: [
        "Импортируется только кабинет ArtHello.",
        "Сумма расходов за выбранный день совпадает после учёта часового пояса и НДС.",
        "Ни одна кампания, ставка или бюджет не изменились.",
      ],
      caution:
        "Доступ к API Директа требует отдельной заявки. Этот канал нельзя честно обещать «за пять минут», поэтому запускаем его параллельно, не задерживая сайт и VK.",
      docs: {
        label: "Официальный курс подключения API Яндекс Директа",
        url: "https://yandex.ru/dev/direct/doc/ru/start",
      },
    },
  },
  {
    id: "vk-ads",
    mark: "VK",
    name: "VK Ads",
    group: "marketing",
    groupLabel: "Маркетинг",
    wave: 2,
    purpose: "Расходы VK рядом с лидами, пробными и договорами.",
    inbound: "кампании, объявления, аудитории, показы, клики, расходы",
    stores: "account_id, campaign_id, ad_id, cost, click marker",
    prerequisite: "рекламный кабинет и read-only доступ к статистике",
    guide: {
      result:
        "Расходы VK Рекламы сопоставляются с лидами и этапами продаж. Первый режим — только чтение статистики без управления рекламой.",
      preparation: [
        "Доступ администратора или аналитика к рекламному кабинету ArtHello.",
        "ID нужного рекламного кабинета.",
        "Понимание, какие формы и лид-формы VK используются сейчас.",
      ],
      steps: [
        {
          title: "Проверьте рекламный кабинет",
          text: "Откройте VK Рекламу и убедитесь, что видите кампании, объявления, расходы и нужные лид-формы именно ArtHello.",
        },
        {
          title: "Зафиксируйте кабинет",
          text: "Запишите ID рекламного кабинета и владельца доступа. Если кабинетов несколько, выберите один для первого теста.",
        },
        {
          title: "Подготовьте API-доступ",
          text: "Создайте или выберите приложение для API VK Рекламы и запросите минимальный доступ к статистике. Права на изменение кампаний не включайте.",
        },
        {
          title: "Авторизуйте ArtHello OS",
          text: "Подтвердите доступ в официальном окне VK. Токен сохраняется на сервере и не показывается повторно в интерфейсе.",
        },
        {
          title: "Выберите данные импорта",
          text: "Для начала импортируем кампании, объявления, показы, клики и расходы. Аудитории и управление ставками не подключаем.",
        },
        {
          title: "Свяжите лид-формы",
          text: "Укажите, какие лид-формы VK создают заявку, пробное занятие или другой этап. Неизвестные формы отправляются на ручную проверку.",
        },
        {
          title: "Сверьте закрытый день",
          text: "Сравните итог по расходам и кликам в VK Рекламе и ArtHello OS за один завершённый день.",
        },
        {
          title: "Проверьте атрибуцию",
          text: "Отправьте тестовую лид-форму и убедитесь, что лид связан с формой и кампанией, но не объединён с существующей семьёй автоматически.",
        },
      ],
      checks: [
        "Подключён только рекламный кабинет ArtHello.",
        "Расходы и клики совпадают с интерфейсом VK за выбранный период.",
        "ArtHello OS не может запускать, останавливать или редактировать рекламу.",
      ],
      caution:
        "Структура кабинетов VK меняется чаще, чем хотелось бы. Перед реальным подключением сверим названия разделов и права в вашем конкретном аккаунте.",
      docs: {
        label: "Официальный кабинет и справка VK Рекламы",
        url: "https://ads.vk.com/",
      },
    },
  },
];

const integrationEvents = [
  {
    time: "18:42:11",
    source: "Сайт",
    event: "lead.created",
    result: "Принято",
    resultClass: "is-pass",
    next: "Создан synthetic-лид",
  },
  {
    time: "18:42:08",
    source: "Telegram",
    event: "message.received",
    result: "Дубль",
    resultClass: "is-neutral",
    next: "Повторное событие пропущено",
  },
  {
    time: "18:41:57",
    source: "Яндекс Директ",
    event: "campaign.touch",
    result: "Сохранено",
    resultClass: "is-pass",
    next: "UTM и yclid добавлены",
  },
  {
    time: "18:41:49",
    source: "VK · сообщения",
    event: "message.received",
    result: "Карантин",
    resultClass: "is-warn",
    next: "Не подтверждён project_id",
  },
];

const integrationState = {
  tab: "catalog",
  filter: "pilot",
  selectedId: null,
  drawerOpen: false,
  trigger: null,
  connectors: {},
  retentionDays: null,
  startBusy: false,
};

function integrationConnector(id) {
  return integrationConnectors.find((connector) => connector.id === id);
}

function integrationWaveLabel(wave) {
  if (wave === 1) return "Первая очередь";
  if (wave === 2) return "Вторая очередь";
  if (wave === 3) return "После настройки Meta";
  return "После проверки спроса";
}

function integrationVisibleConnectors() {
  if (integrationState.filter === "all") return integrationConnectors;
  return integrationConnectors.filter((connector) => connector.pilot);
}

function integrationRuntime(connector) {
  return integrationState.connectors[connector.id] ?? {};
}

function integrationStatus(connector) {
  const runtime = integrationRuntime(connector);
  if (connector.id === "site") {
    if (runtime.status === "active") return ["Подключено", "is-active"];
    if (runtime.status === "awaiting_test") return ["Ждём тест", "is-wait"];
    return ["Не подключено", ""];
  }
  if (connector.id === "vk-messages") return ["Следующим", "is-wait"];
  if (connector.id === "telegram") return ["Пока пауза", "is-neutral"];
  return ["Позже", "is-neutral"];
}

function integrationActionLabel(connector) {
  if (connector.id === "site") {
    return integrationRuntime(connector).status === "active"
      ? "Открыть"
      : "Подключить";
  }
  if (connector.id === "vk-messages") return "Что нужно";
  return "Подробнее";
}

function renderIntegrationCatalog() {
  const catalog = document.querySelector("#integration-catalog");
  if (!catalog) return;
  const cards = integrationVisibleConnectors().map((connector) => {
    const card = document.createElement("article");
    card.className = "integration-connector";
    card.dataset.integrationConnector = connector.id;

    const head = document.createElement("div");
    head.className = "integration-connector-head";
    const mark = document.createElement("span");
    mark.className = `integration-connector-mark is-${connector.id}`;
    mark.textContent = connector.mark;
    const identity = document.createElement("div");
    const kind = document.createElement("small");
    kind.textContent = connector.groupLabel;
    const name = document.createElement("h3");
    name.textContent = connector.name;
    identity.append(kind, name);
    const status = document.createElement("span");
    const [statusLabel, statusClass] = integrationStatus(connector);
    status.className = `integration-connector-status ${statusClass}`.trim();
    status.textContent = statusLabel;
    head.append(mark, identity, status);

    const purpose = document.createElement("p");
    purpose.textContent = connector.purpose;

    const footer = document.createElement("div");
    footer.className = "integration-connector-footer";
    const queueState = document.createElement("span");
    const eventCount = Number(integrationRuntime(connector).eventCount ?? 0);
    queueState.textContent =
      eventCount > 0
        ? `Реальных входящих: ${eventCount}`
        : connector.group === "marketing"
          ? "Только чтение статистики"
          : "Ответы вручную";
    queueState.classList.toggle("is-queued", eventCount > 0);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${integrationActionLabel(connector)} →`;
    button.addEventListener("click", () =>
      openIntegrationDrawer(connector.id, button),
    );
    footer.append(queueState, button);

    card.append(head, purpose, footer);
    return card;
  });
  catalog.replaceChildren(...cards);
}

function renderIntegrationEvents() {
  const list = document.querySelector("#integration-event-list");
  if (!list) return;
  list.replaceChildren(
    ...integrationEvents.map((event) => {
      const row = document.createElement("tr");
      const time = document.createElement("td");
      time.textContent = event.time;
      const source = document.createElement("td");
      const sourceValue = document.createElement("strong");
      sourceValue.textContent = event.source;
      source.append(sourceValue);
      const kind = document.createElement("td");
      const code = document.createElement("code");
      code.textContent = event.event;
      kind.append(code);
      const result = document.createElement("td");
      const resultValue = document.createElement("span");
      resultValue.className = `integration-event-result ${event.resultClass}`;
      resultValue.textContent = event.result;
      result.append(resultValue);
      const next = document.createElement("td");
      next.textContent = event.next;
      row.append(time, source, kind, result, next);
      return row;
    }),
  );
}

function syncIntegrationControls() {
  document.querySelectorAll("[data-integration-tab]").forEach((button) => {
    const active = button.dataset.integrationTab === integrationState.tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-integration-panel]").forEach((panel) => {
    const active = panel.dataset.integrationPanel === integrationState.tab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  document.querySelectorAll("[data-integration-filter]").forEach((button) => {
    const active = button.dataset.integrationFilter === integrationState.filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setIntegrationTab(tab) {
  integrationState.tab = tab;
  syncIntegrationControls();
}

function setIntegrationFilter(filter) {
  integrationState.filter = filter;
  syncIntegrationControls();
  renderIntegrationCatalog();
}

function appendIntegrationGuide(connector, container) {
  const guide = connector.guide;
  if (!guide) return;

  const result = document.createElement("section");
  result.className = "integration-guide-result";
  const resultLabel = document.createElement("span");
  resultLabel.textContent = "Что получится";
  const resultCopy = document.createElement("p");
  resultCopy.textContent = guide.result;
  result.append(resultLabel, resultCopy);

  const preparation = document.createElement("section");
  preparation.className = "integration-guide-section";
  const preparationTitle = document.createElement("h3");
  preparationTitle.textContent = "Что подготовить";
  const preparationList = document.createElement("ul");
  preparationList.className = "integration-guide-list";
  preparationList.replaceChildren(
    ...guide.preparation.map((item) => {
      const row = document.createElement("li");
      row.textContent = item;
      return row;
    }),
  );
  preparation.append(preparationTitle, preparationList);

  const process = document.createElement("section");
  process.className = "integration-guide-section";
  const processTitle = document.createElement("h3");
  processTitle.textContent = "Как подключить";
  const processList = document.createElement("ol");
  processList.className = "integration-guide-steps";
  processList.replaceChildren(
    ...guide.steps.map((step, index) => {
      const row = document.createElement("li");
      const number = document.createElement("span");
      number.textContent = String(index + 1);
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = step.title;
      const description = document.createElement("p");
      description.textContent = step.text;
      copy.append(title, description);
      row.append(number, copy);
      return row;
    }),
  );
  process.append(processTitle, processList);

  const verification = document.createElement("section");
  verification.className = "integration-guide-section";
  const verificationTitle = document.createElement("h3");
  verificationTitle.textContent = "Как понять, что всё работает";
  const verificationList = document.createElement("ul");
  verificationList.className =
    "integration-guide-list integration-guide-checks";
  verificationList.replaceChildren(
    ...guide.checks.map((item) => {
      const row = document.createElement("li");
      row.textContent = item;
      return row;
    }),
  );
  verification.append(verificationTitle, verificationList);

  const caution = document.createElement("p");
  caution.className = "integration-guide-caution";
  caution.textContent = guide.caution;

  const documentation = document.createElement("a");
  documentation.className = "integration-guide-docs";
  documentation.href = guide.docs.url;
  documentation.target = "_blank";
  documentation.rel = "noopener noreferrer";
  documentation.textContent = `${guide.docs.label} ↗`;

  container.append(
    result,
    preparation,
    process,
    verification,
    caution,
    documentation,
  );
}

function renderIntegrationSetup(connector) {
  const container = document.querySelector("#integration-simple-setup");
  const action = document.querySelector("#integration-add-queue");
  const runtime = integrationRuntime(connector);
  container.replaceChildren();
  action.hidden = false;
  action.disabled = integrationState.startBusy;

  if (connector.id === "site") {
    if (!integrationState.retentionDays) {
      const policy = document.createElement("p");
      policy.className = "integration-ready-note is-wait";
      policy.textContent =
        "До первого реального лида нужно один раз подтвердить срок хранения данных пилота.";
      container.append(policy);
      action.textContent = "Нужен срок хранения";
      action.disabled = true;
      setText("#integration-queue-status", "Ждём одно решение владельца");
      appendIntegrationGuide(connector, container);
      return;
    }
    if (runtime.webhookUrl) {
      const endpoint = document.createElement("div");
      endpoint.className = "integration-endpoint";
      const label = document.createElement("span");
      label.textContent = "Адрес для формы";
      const value = document.createElement("input");
      value.type = "text";
      value.readOnly = true;
      value.value = runtime.webhookUrl;
      value.setAttribute("aria-label", "Webhook-адрес для формы ArtHello");
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Копировать";
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(runtime.webhookUrl);
        copy.textContent = "Скопировано";
        setTimeout(() => {
          copy.textContent = "Копировать";
        }, 1600);
      });
      endpoint.append(label, value, copy);
      container.append(endpoint);
    }
    if (runtime.status === "active") {
      const ready = document.createElement("p");
      ready.className = "integration-ready-note";
      ready.textContent = `Подключено. Получено реальных заявок: ${Number(runtime.eventCount ?? 0)}.`;
      container.append(ready);
      action.textContent = "Обновить адрес";
      setText(
        "#integration-queue-status",
        "Входящие включены · ответы вручную",
      );
    } else if (runtime.status === "awaiting_test") {
      action.textContent = "Показать адрес";
      setText(
        "#integration-queue-status",
        "Осталось вставить адрес и отправить тест",
      );
    } else {
      action.textContent = "Получить адрес";
      setText("#integration-queue-status", "Клиенту ничего не отправляется");
    }
    appendIntegrationGuide(connector, container);
    return;
  }

  if (connector.id === "vk-messages") {
    const note = document.createElement("p");
    note.className = "integration-ready-note is-wait";
    note.textContent =
      "Канал готовим следующим: менеджер сможет отвечать клиенту вручную прямо в кабинете VK.";
    container.append(note);
    appendIntegrationGuide(connector, container);
    action.textContent = "После сайта";
    action.disabled = true;
    setText("#integration-queue-status", "Следующий безопасный канал пилота");
    return;
  }

  if (connector.id === "telegram") {
    const note = document.createElement("p");
    note.className = "integration-ready-note is-neutral";
    note.textContent =
      "Telegram-бот пока не запускаем: без ручной отправки из OS менеджер не сможет нормально продолжить диалог.";
    container.append(note);
    appendIntegrationGuide(connector, container);
    action.textContent = "Пока не подключать";
    action.disabled = true;
    setText("#integration-queue-status", "Вернёмся после ручного ответа из OS");
    return;
  }

  const note = document.createElement("p");
  note.className = "integration-ready-note is-neutral";
  note.textContent =
    "Этот канал не нужен для первого теста. Подключим после проверки сайта и VK.";
  container.append(note);
  appendIntegrationGuide(connector, container);
  action.textContent = "Позже";
  action.disabled = true;
  setText("#integration-queue-status", "Не входит в первый пилот");
}

function openIntegrationDrawer(id, trigger, { pushHistory = true } = {}) {
  const connector = integrationConnector(id);
  if (!connector) return;
  integrationState.selectedId = id;
  integrationState.drawerOpen = true;
  integrationState.trigger = trigger;
  setText("#integration-drawer-mark", connector.mark);
  document.querySelector("#integration-drawer-mark").className =
    `is-${connector.id}`;
  setText("#integration-drawer-kind", connector.groupLabel);
  setText("#integration-drawer-title", connector.name);
  setText("#integration-drawer-status", integrationStatus(connector)[0]);
  setText("#integration-drawer-purpose", connector.purpose);
  setText("#integration-drawer-inbound", connector.inbound);
  setText("#integration-drawer-stores", connector.stores);
  setText("#integration-drawer-prerequisite", connector.prerequisite);
  renderIntegrationSetup(connector);
  const layer = document.querySelector("#integration-drawer-layer");
  layer.hidden = false;
  document.body.classList.add("integration-drawer-open");
  if (pushHistory) {
    history.pushState({ integrationDrawer: id }, "", "#integrations");
  }
  requestAnimationFrame(() =>
    layer.querySelector(".integration-drawer").focus(),
  );
}

function closeIntegrationDrawer({ fromHistory = false } = {}) {
  if (!integrationState.drawerOpen) return;
  const restorePreviousHistory =
    !fromHistory && Boolean(history.state?.integrationDrawer);
  integrationState.drawerOpen = false;
  document.querySelector("#integration-drawer-layer").hidden = true;
  document.body.classList.remove("integration-drawer-open");
  integrationState.trigger?.focus();
  if (restorePreviousHistory) history.back();
}

async function startIntegrationConnector() {
  const connector = integrationConnector(integrationState.selectedId);
  if (!connector || connector.id !== "site" || integrationState.startBusy)
    return;
  integrationState.startBusy = true;
  const button = document.querySelector("#integration-add-queue");
  button.textContent = "Готовим адрес…";
  button.disabled = true;
  setText("#integration-queue-status", "Создаём защищённый входящий адрес");
  try {
    const response = await fetch("/api/integrations/site-webflow/start", {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-arthello-action": "owner-confirmed",
      },
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      if (errorPayload.error === "RETENTION_POLICY_REQUIRED") {
        throw new Error("retention_required");
      }
      throw new Error("start_failed");
    }
    const payload = await response.json();
    integrationState.connectors.site = {
      ...(integrationState.connectors.site ?? {}),
      status: payload.status,
      webhookUrl: payload.webhookUrl,
    };
    setText("#integration-drawer-status", "Ждём тест");
    renderIntegrationSetup(connector);
    renderIntegrationCatalog();
  } catch (error) {
    setText("#integration-drawer-status", "Не удалось");
    setText(
      "#integration-queue-status",
      error.message === "retention_required"
        ? "Сначала подтвердите срок хранения пилотных лидов"
        : "Адрес не создан. Обновите страницу и попробуйте ещё раз",
    );
    button.textContent = "Повторить";
    button.disabled = false;
  } finally {
    integrationState.startBusy = false;
  }
}

async function loadIntegrationStatus() {
  try {
    const response = await fetch("/api/integrations/status", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("status_failed");
    const payload = await response.json();
    if (payload.projectId !== "ARTHELLO" || payload.outboundEnabled !== false) {
      throw new Error("integration_boundary_failed");
    }
    integrationState.connectors = payload.connectors ?? {};
    integrationState.retentionDays = payload.retentionDays ?? null;
    renderIntegrationCatalog();
    if (integrationState.drawerOpen) {
      const connector = integrationConnector(integrationState.selectedId);
      if (connector) {
        setText("#integration-drawer-status", integrationStatus(connector)[0]);
        renderIntegrationSetup(connector);
      }
    }
  } catch {
    integrationState.connectors = {};
    renderIntegrationCatalog();
  }
}

function renderIntegrationCenter() {
  setText("#integration-total", String(integrationConnectors.length));
  setText(
    "#integration-connected",
    String(integrationConnectors.filter((item) => item.connected).length),
  );
  setText(
    "#integration-first-wave",
    String(integrationConnectors.filter((item) => item.wave === 1).length),
  );
  renderIntegrationCatalog();
  renderIntegrationEvents();
  syncIntegrationControls();
}

const viewFor = (section) =>
  ["pulse", "quality", "sources", "front-office", "integrations"].includes(
    section,
  )
    ? section
    : "module";

const numberFormat = new Intl.NumberFormat("ru-RU");

function formatMinorCurrency(value, currency = "RUB") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return "—";
  const minor = BigInt(parsed);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const major = absolute / 100n;
  const cents = String(absolute % 100n).padStart(2, "0");
  const unit = currency === "RUB" ? "₽" : currency;
  return `${negative ? "−" : ""}${numberFormat.format(
    Number(major),
  )},${cents} ${unit}`;
}
const liveState = {
  section: null,
  kind: null,
  offset: 0,
  limit: 50,
  total: 0,
  query: "",
  lessonCategory: null,
  selectedEmployee: null,
};

const liveSections = new Set([
  "families",
  "students",
  "groups",
  "employees",
  "teachers",
  "payroll",
  "money",
  "system",
]);

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function statusClass(status) {
  if (["active", "completed"].includes(status)) return "status-safe";
  if (["attention", "partial", "active_sync_attention"].includes(status))
    return "status-unverified";
  return "status-blocker";
}

function applyStatus(element, status, label) {
  if (!element) return;
  element.className = `status ${statusClass(status)}`;
  element.textContent = label;
}

async function fetchJson(path, options) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function sourceByName(summary, sourceName) {
  const sources = Array.isArray(summary?.sources) ? summary.sources : [];
  return sources.find((source) => source?.source === sourceName) ?? null;
}

async function loadOwnerSummary() {
  try {
    const [summary, tochka] = await Promise.all([
      fetchJson("/api/owner-summary"),
      fetchJson("/api/banking/tochka/status"),
    ]);
    const payroll = sourceByName(summary, "payroll");
    const alfa = sourceByName(summary, "alfacrm");
    const counts = summary.counts ?? {};
    const alfaCompleted = ["completed", "attention"].includes(alfa?.status);
    const alfaPartial = alfa?.status === "partial";
    const alfaLinkageIssues = Number(alfa?.details?.linkageIssues ?? 0);
    const alfaIncompleteScopes = Number(
      alfa?.details?.quality?.incompleteScopes ?? 0,
    );
    const alfaCounts = alfa?.counts ?? {};
    const alfaCount = (key) =>
      Number(
        alfaCompleted ? counts[key] : (alfaCounts[key] ?? counts[key] ?? 0),
      );
    const alphaBranches = alfaCount("branches");
    const alphaStudents = alfaCount("students");
    const alphaGroups = alfaCount("groups");
    const alphaTeachers = alfaCount("teachers");
    const alphaLessons = alfaCount("lessons");
    const alphaPayments = alfaCount("payments");
    const rejectedPayrollSourceRows = Number(
      payroll?.counts?.rejectedSourceRows ?? 0,
    );

    setText(
      "#payroll-signal-title",
      counts.employees
        ? `${numberFormat.format(counts.employees)} сотрудников загружено`
        : "Ведомость ещё не опубликована",
    );
    setText(
      "#payroll-signal-copy",
      counts.employees
        ? `${numberFormat.format(
            counts.payrollPeriods,
          )} строк сотрудник × месяц; ${numberFormat.format(
            counts.payrollUnresolved,
          )} связей требуют ручной проверки${
            rejectedPayrollSourceRows
              ? `; ${numberFormat.format(
                  rejectedPayrollSourceRows,
                )} строк источника отклонено из-за неполных обязательных данных`
              : ""
          }. Формулы не активированы как правила.`
        : "Закрытая read-модель пока не содержит зарплатную ведомость.",
    );
    applyStatus(
      document.querySelector("#payroll-source-status"),
      payroll?.status ?? "not_loaded",
      payroll?.status === "active" ? "Подключено" : "Есть расхождения",
    );
    setText(
      "#payroll-source-copy",
      counts.employees
        ? `реальный Google Sheet · ${numberFormat.format(
            counts.employees,
          )} сотрудников`
        : "реальный Google Sheet · данные ещё не опубликованы",
    );
    setText(
      "#payroll-card-employees",
      counts.employees
        ? `${numberFormat.format(counts.employees)} карточек`
        : "данные ещё не опубликованы",
    );
    applyStatus(
      document.querySelector("#payroll-card-status"),
      payroll?.status ?? "not_loaded",
      payroll?.status === "active"
        ? "Источник сверён"
        : counts.employees
          ? "Есть ручная проверка"
          : "Ожидает публикации",
    );

    setText(
      "#alfa-signal-title",
      alphaBranches
        ? `${numberFormat.format(alphaBranches)} филиалов в ${
            alfaPartial ? "частичном" : "завершённом"
          } срезе`
        : "Свежий срез ещё не завершён",
    );
    setText(
      "#alfa-signal-copy",
      alphaBranches
        ? `${numberFormat.format(alphaStudents)} учеников, ${numberFormat.format(
            alphaGroups,
          )} групп, ${numberFormat.format(
            alphaTeachers,
          )} педагогов, ${numberFormat.format(
            alphaLessons,
          )} занятий и ${numberFormat.format(
            alphaPayments,
          )} оплат в ${alfaPartial ? "неполном" : "завершённом"} read-only snapshot.${
            alfaPartial
              ? ` ${numberFormat.format(
                  alfaIncompleteScopes,
                )} scopes не завершены; операционные строки пока не опубликованы.`
              : ""
          }`
        : "Полный read-only импорт ещё не дал подтверждённого покрытия.",
    );
    applyStatus(
      document.querySelector("#alfa-source-status"),
      alfa?.status ?? "not_loaded",
      alfaCompleted
        ? alfaLinkageIssues
          ? "Подключено · есть расхождения"
          : "Подключено"
        : alfa?.status === "partial"
          ? "Частично"
          : "Не загружено",
    );
    setText(
      "#alfa-source-copy",
      alphaBranches
        ? `реальный read-only ${
            alfaPartial
              ? "частичный snapshot · строки закрыты gate"
              : "snapshot"
          } · ${numberFormat.format(alphaStudents)} учеников`
        : "реальный источник · нет завершённого snapshot",
    );
    applyStatus(
      document.querySelector("#alfa-card-status"),
      alfa?.status ?? "not_loaded",
      alfaCompleted
        ? alfaLinkageIssues
          ? `Snapshot завершён · ${numberFormat.format(
              alfaLinkageIssues,
            )} связей требуют проверки`
          : "Snapshot завершён"
        : alfa?.status === "partial"
          ? "Частичное покрытие"
          : "Ожидает snapshot",
    );
    setText(
      "#alfa-card-run",
      alfa?.last_synced_at
        ? new Date(alfa.last_synced_at).toLocaleString("ru-RU")
        : "нет завершённого запуска",
    );
    setText(
      "#alfa-card-rows",
      alphaBranches
        ? `${numberFormat.format(alphaStudents)} учеников · ${numberFormat.format(
            alphaGroups,
          )} групп · ${numberFormat.format(alphaLessons)} занятий`
        : "нет подтверждённого покрытия",
    );
    setText(
      "#alfa-card-copy",
      alphaBranches
        ? alfaPartial
          ? `Snapshot не завершён: ${numberFormat.format(
              alfaIncompleteScopes,
            )} scopes требуют повторного чтения. Показаны только агрегаты; строки учеников, семей, групп, занятий и оплат не опубликованы.`
          : alfaLinkageIssues
            ? `Завершённый read-only snapshot передан в owner-only read-модель, но ${numberFormat.format(
                alfaLinkageIssues,
              )} связей источника явно оставлены в центре качества данных.`
            : "Завершённый read-only snapshot передан в owner-only read-модель. Архивные строки сохранены отдельно, а частичные scopes не выдают за полное покрытие."
        : "Read-only importer сохраняет неизменяемый raw + observation + normalized слои. Фактическое покрытие появится здесь только после terminal report и integrity audit.",
    );
    const qualityAlfaMark = document.querySelector("#quality-alfa-mark");
    const qualityAlfaRow = document.querySelector("#quality-alfa-linkage-row");
    const qualityAlfaStatus = document.querySelector(
      "#quality-alfa-linkage-status",
    );
    if (alphaBranches) {
      if (alfaPartial) {
        qualityAlfaMark.textContent = "!";
        qualityAlfaMark.className = "summary-mark summary-blocker";
        setText("#quality-alfa-title", "AlfaCRM sandbox: snapshot не завершён");
        setText(
          "#quality-alfa-copy",
          `${numberFormat.format(
            alfaIncompleteScopes,
          )} scopes требуют повторного чтения; операционные строки закрыты terminal gate`,
        );
        qualityAlfaRow.dataset.kind = "blocker";
        setText(
          "#quality-alfa-linkage-title",
          "Покрытие AlfaCRM пока частичное",
        );
        setText(
          "#quality-alfa-linkage-copy",
          "Агрегаты сохранены для диагностики. Ученики, семьи, группы, занятия и оплаты появятся в реестрах только после завершённого batch и integrity audit.",
        );
        qualityAlfaStatus.className = "status status-blocker";
        qualityAlfaStatus.textContent = "PARTIAL";
        setText(
          "#quality-alfa-linkage-action",
          "Повторить защищённый read-only importer после восстановления маршрута",
        );
      } else {
        const hasLinkageIssues = alfaLinkageIssues > 0;
        qualityAlfaMark.textContent = hasLinkageIssues ? "!" : "✓";
        qualityAlfaMark.className = `summary-mark ${
          hasLinkageIssues ? "summary-blocker" : "summary-fixed"
        }`;
        setText(
          "#quality-alfa-title",
          hasLinkageIssues
            ? "AlfaCRM sandbox: snapshot завершён с расхождениями"
            : "AlfaCRM sandbox: integrity PASS",
        );
        setText(
          "#quality-alfa-copy",
          hasLinkageIssues
            ? `${numberFormat.format(
                alfaLinkageIssues,
              )} связей источника требуют разбора; данные не скрыты и не исправлены догадками`
            : "Все scopes завершены, составные межфилиальные ключи и связи прошли проверку",
        );
        qualityAlfaRow.dataset.kind = hasLinkageIssues ? "blocker" : "fixed";
        setText(
          "#quality-alfa-linkage-title",
          hasLinkageIssues
            ? "В AlfaCRM остались несвязанные исходные записи"
            : "Межфилиальные связи AlfaCRM целостны",
        );
        setText(
          "#quality-alfa-linkage-copy",
          hasLinkageIssues
            ? `${numberFormat.format(
                alfaLinkageIssues,
              )} связей перечислены в машинном audit; финансовые выводы по ним заблокированы.`
            : "Ученики, группы, педагоги, оплаты, занятия, посещения и кандидаты семей используют составную идентичность филиал + CRM-ID.",
        );
        qualityAlfaStatus.className = `status ${
          hasLinkageIssues ? "status-blocker" : "status-fixed"
        }`;
        qualityAlfaStatus.textContent = hasLinkageIssues
          ? "ATTENTION"
          : "INTEGRITY PASS";
        setText(
          "#quality-alfa-linkage-action",
          hasLinkageIssues
            ? "Разобрать source-level orphan-связи вручную"
            : "Сохранять gate в каждом следующем импорте",
        );
      }
    }
    setText(
      "#coverage-branches",
      alphaBranches
        ? `${numberFormat.format(alphaBranches)} филиалов в ${
            alfaPartial ? "частичном" : "текущем"
          } snapshot`
        : "Полная инвентаризация не завершена",
    );
    setText(
      "#coverage-branches-copy",
      alphaBranches
        ? `${numberFormat.format(alphaStudents)} учеников и ${numberFormat.format(
            alphaGroups,
          )} групп получены из реального read-only источника.${
            alfaPartial
              ? " Это диагностические агрегаты; реестры остаются закрыты до terminal gate."
              : ""
          }`
        : "Исторические количества не используются; результат появится после завершённого snapshot.",
    );

    const tochkaActive = ["active", "active_sync_attention"].includes(
      tochka.status,
    );
    setText(
      "#tochka-next-gate-title",
      tochkaActive
        ? "Проверить полноту read-only данных «Точки»"
        : "Пройти OAuth «Точки»",
    );
    setText(
      "#tochka-next-gate-copy",
      tochkaActive
        ? `${numberFormat.format(
            tochka.accountCount,
          )} счетов подключено; следующий gate — периоды выписок и покрытие юридических лиц. Платежи выключены.`
        : "Защищённый Sites backend принимает code, проверяет state и запрашивает только права чтения.",
    );
    setText(
      "#tochka-signal-title",
      tochkaActive
        ? `${numberFormat.format(tochka.accountCount)} счетов после OAuth`
        : tochka.configured
          ? "Готово к подтверждению в «Точке»"
          : "Защищённые параметры ещё не заданы",
    );
    setText(
      "#tochka-signal-copy",
      tochkaActive
        ? "Подключены только read-only scopes; создание и подписание платежей отсутствует."
        : "Нужно открыть ссылку банка и подтвердить доступ к счетам, остаткам, клиентам и выпискам.",
    );
    applyStatus(
      document.querySelector("#tochka-source-status"),
      tochka.status,
      tochkaActive ? "Подключено" : "OAuth требуется",
    );
    setText(
      "#tochka-source-copy",
      tochkaActive
        ? `read-only · ${numberFormat.format(tochka.accountCount)} счетов`
        : "read-only OAuth · платежные действия выключены",
    );
    applyStatus(
      document.querySelector("#tochka-card-status"),
      tochka.status,
      tochkaActive ? "Read-only подключён" : "Нужен OAuth consent",
    );
    setText(
      "#tochka-card-accounts",
      tochkaActive
        ? `${numberFormat.format(tochka.accountCount)} счетов`
        : "Нужен hybrid OAuth",
    );
    setText(
      "#coverage-bank",
      tochkaActive
        ? `${numberFormat.format(tochka.accountCount)} счетов подключено`
        : "OAuth не завершён",
    );
    setText(
      "#bank-issue-title",
      tochkaActive
        ? "Read-only OAuth «Точки» подключён"
        : "Read-only OAuth «Точки» требует подтверждения",
    );
    setText(
      "#bank-issue-copy",
      tochkaActive
        ? `${numberFormat.format(
            tochka.accountCount,
          )} счетов получено без платёжных scopes, маршрутов и действий. Остатки хранятся в целых копейках для точного отображения.`
        : "Защищённый Worker проверяет state, шифрует токены и не имеет платёжных scopes или маршрутов.",
    );
    applyStatus(
      document.querySelector("#bank-issue-status"),
      tochka.status,
      tochkaActive ? "ACTIVE · READ ONLY" : "CONSENT REQUIRED",
    );
    setText(
      "#bank-issue-action",
      tochkaActive
        ? "Сверить юридические лица, периоды выписок и полноту счетов"
        : "Владелец подтверждает только read-only доступ",
    );

    const operationalSources = Boolean(counts.employees && counts.branches);
    setText(
      "#truth-title",
      operationalSources
        ? "Операционные данные доступны, финансовая сверка ещё не закрыта"
        : "Загрузка проверенных данных продолжается",
    );
    setText(
      "#truth-copy",
      operationalSources
        ? "Сотрудники, зарплатная ведомость и AlfaCRM видны владельцу. ДДС, ОПиУ и рекомендации остаются закрыты до банковской сверки и разбора расхождений."
        : "Финансовые выводы не активируются до завершения AlfaCRM, зарплаты и банковского подключения.",
    );
    setText("#truth-state-label", operationalSources ? "ЧАСТИЧНО" : "ПРОВЕРКА");
    setText(
      "#truth-state-copy",
      operationalSources
        ? "данные есть, сверка не закрыта"
        : "идёт чтение источников",
    );
  } catch (error) {
    const accessMessage =
      error?.status === 403
        ? "Нет подтверждённого owner-доступа к серверной read-модели"
        : "Серверная read-модель временно недоступна";
    setText("#truth-title", accessMessage);
    setText(
      "#truth-copy",
      "Интерфейс не подменяет ошибку демонстрационными данными. Повторите вход через owner-only Sites.",
    );
    setText("#truth-state-label", "НЕТ ДАННЫХ");
    setText("#truth-state-copy", "проверка доступа");
  }
}

function cellContent(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "primary")) {
    const wrapper = document.createElement("div");
    const primary = document.createElement("strong");
    primary.textContent = value.primary ?? "—";
    wrapper.append(primary);
    if (value.secondary) {
      const secondary = document.createElement("small");
      secondary.textContent = value.secondary;
      wrapper.append(secondary);
    }
    return wrapper;
  }
  return document.createTextNode(value ?? "—");
}

function renderTable(columns, rows, options = {}) {
  const table = document.querySelector("#live-data-table");
  const head = table.querySelector("thead");
  const body = table.querySelector("tbody");
  const headerRow = document.createElement("tr");
  for (const column of columns) {
    const header = document.createElement("th");
    header.textContent = column.label;
    headerRow.append(header);
  }
  head.replaceChildren(headerRow);

  const renderedRows = rows.map((row) => {
    const tableRow = document.createElement("tr");
    if (options.onSelect) {
      tableRow.dataset.selectable = "true";
      tableRow.tabIndex = 0;
      const select = () => options.onSelect(row);
      tableRow.addEventListener("click", select);
      tableRow.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
    }
    for (const column of columns) {
      const cell = document.createElement("td");
      const value = column.value(row);
      cell.append(cellContent(value));
      if (column.className) cell.className = column.className(row);
      tableRow.append(cell);
    }
    return tableRow;
  });
  body.replaceChildren(...renderedRows);
  const empty = document.querySelector("#live-data-empty");
  empty.textContent =
    rows.length === 0 ? "В текущем источнике пока нет доступных строк." : "";
  empty.hidden = rows.length !== 0;
  document.querySelector("#live-data-table").hidden = rows.length === 0;
}

function setLiveHeader(title, summary, mode = "Реальный источник") {
  setText("#live-data-title", title);
  setText("#live-data-summary", summary);
  setText("#live-data-mode", mode);
  const chip = document.querySelector("#module-data-chip");
  chip.className = "checkpoint-chip";
  chip.innerHTML = "<span></span> Реальные данные";
}

function updatePagination() {
  const start = liveState.total === 0 ? 0 : liveState.offset + 1;
  const end = Math.min(liveState.offset + liveState.limit, liveState.total);
  setText(
    "#live-data-range",
    `${numberFormat.format(start)}–${numberFormat.format(
      end,
    )} из ${numberFormat.format(liveState.total)}`,
  );
  document.querySelector("#live-prev").disabled = liveState.offset === 0;
  document.querySelector("#live-next").disabled =
    liveState.offset + liveState.limit >= liveState.total;
}

function showLivePanel(show) {
  document.querySelector("#module-live-data").hidden = !show;
  document.querySelector("#module-static-grid").hidden = show;
  document.querySelector("#live-search-label").hidden = !show;
  if (!show) {
    const chip = document.querySelector("#module-data-chip");
    chip.className = "checkpoint-chip checkpoint-chip-muted";
    chip.innerHTML = "<span></span> Структура раздела";
  }
}

function liveEndpoint(kind) {
  const params = new URLSearchParams({
    limit: String(liveState.limit),
    offset: String(liveState.offset),
  });
  if (liveState.query) params.set("query", liveState.query);
  if (kind === "lessons" && liveState.lessonCategory) {
    params.set("lesson_category", liveState.lessonCategory);
  }
  return `/api/${kind}?${params}`;
}

async function loadEmployeeDirectory(forPayroll = false) {
  setLiveHeader(
    forPayroll ? "Сотрудники и зарплата" : "Справочник сотрудников",
    forPayroll
      ? "Выберите сотрудника, чтобы открыть помесячные начисления и выплаты."
      : "Карточки из реального roster; кадровый статус пока требует подтверждения.",
    "Реальный Google Sheet · owner-only",
  );
  const data = await fetchJson(liveEndpoint("employees"));
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  liveState.total = Number.isSafeInteger(data?.total)
    ? data.total
    : rows.length;
  renderTable(
    [
      {
        label: "Сотрудник",
        value: (row) => ({
          primary: row.full_name,
          secondary: row.primary_role || "Роль не указана",
        }),
      },
      {
        label: "Статус",
        value: (row) =>
          row.classification_status === "needs_review"
            ? "Нужна проверка"
            : row.classification_status,
      },
      {
        label: "Периоды",
        value: (row) => numberFormat.format(row.period_count),
      },
      {
        label: "Начислено",
        value: (row) => formatMinorCurrency(row.accrued_total_minor),
        className: () => "money-neutral",
      },
      {
        label: "Выплачено",
        value: (row) => formatMinorCurrency(row.paid_total_minor),
        className: () => "money-positive",
      },
      {
        label: "Последний период",
        value: (row) => row.latest_period?.slice(0, 7) ?? "—",
      },
    ],
    rows,
    {
      onSelect: forPayroll ? (row) => void loadPayrollForEmployee(row) : null,
    },
  );
  updatePagination();
}

async function loadPayrollForEmployee(employee) {
  liveState.selectedEmployee = employee;
  setLiveHeader(
    employee.full_name,
    `${employee.primary_role || "Роль не указана"} · помесячные результаты из ведомости`,
    "Реальная зарплатная ведомость · правила не активированы",
  );
  document.querySelector("#live-search-label").hidden = true;
  const actions = document.querySelector("#live-actions");
  actions.hidden = false;
  const back = document.createElement("button");
  back.type = "button";
  back.className = "filter";
  back.textContent = "← Все сотрудники";
  back.addEventListener("click", () => {
    actions.hidden = true;
    liveState.selectedEmployee = null;
    document.querySelector("#live-search-label").hidden = false;
    void loadEmployeeDirectory(true);
  });
  const note = document.createElement("p");
  note.textContent =
    "Суммы перенесены как вычисленные результаты исходной таблицы; формулы, ставки и налоговые правила не активированы.";
  const data = await fetchJson(
    `/api/payroll?employee_id=${encodeURIComponent(employee.id)}`,
  );
  const monthlyRows = Array.isArray(data?.rows) ? data.rows : [];
  const componentRows = Array.isArray(data?.components) ? data.components : [];
  const paymentRows = Array.isArray(data?.payments) ? data.payments : [];
  const taxNotice = document.createElement("span");
  taxNotice.className = "data-mode-pill";
  taxNotice.textContent =
    data?.taxCoverage?.status === "not_sourced"
      ? "Налоги: источник не предоставлен"
      : "Налоги: проверка";
  const monthlyButton = document.createElement("button");
  monthlyButton.type = "button";
  monthlyButton.className = "filter is-active";
  monthlyButton.textContent = "По месяцам";
  const componentsButton = document.createElement("button");
  componentsButton.type = "button";
  componentsButton.className = "filter";
  componentsButton.textContent = "Начисления";
  const paymentsButton = document.createElement("button");
  paymentsButton.type = "button";
  paymentsButton.className = "filter";
  paymentsButton.textContent = "Выплаты";
  const buttons = [monthlyButton, componentsButton, paymentsButton];
  const activate = (button) => {
    for (const item of buttons)
      item.classList.toggle("is-active", item === button);
  };
  const finish = (rows) => {
    liveState.total = rows.length;
    liveState.offset = 0;
    updatePagination();
    document.querySelector("#live-prev").disabled = true;
    document.querySelector("#live-next").disabled = true;
  };
  const showMonthly = () => {
    activate(monthlyButton);
    renderTable(
      [
        {
          label: "Период",
          value: (row) => row.period_month?.slice(0, 7) ?? "—",
        },
        {
          label: "Юрлицо",
          value: (row) => row.legal_entity_name ?? "Не определено",
        },
        {
          label: "Начислено",
          value: (row) => formatMinorCurrency(row.accrued_amount_minor),
          className: () => "money-neutral",
        },
        {
          label: "Выплачено",
          value: (row) => formatMinorCurrency(row.paid_amount_minor),
          className: () => "money-positive",
        },
        {
          label: "Основания",
          value: (row) =>
            `${numberFormat.format(row.accrual_rows)} начисл. · ${numberFormat.format(
              row.payment_rows,
            )} выплат`,
        },
        { label: "Проверка", value: () => "Не утверждено" },
      ],
      monthlyRows,
    );
    finish(monthlyRows);
  };
  const showComponents = () => {
    activate(componentsButton);
    renderTable(
      [
        {
          label: "Период",
          value: (row) => row.period_month?.slice(0, 7) ?? "—",
        },
        {
          label: "Основание из ведомости",
          value: (row) => ({
            primary: row.source_label || "Не указано",
            secondary: row.source_sheet || "Лист не указан",
          }),
        },
        {
          label: "Сумма",
          value: (row) => formatMinorCurrency(row.amount_minor),
          className: () => "money-neutral",
        },
        {
          label: "Количество",
          value: (row) =>
            row.quantity === null ? "—" : numberFormat.format(row.quantity),
        },
        {
          label: "Формула",
          value: (row) =>
            row.formula_present ? "Есть в источнике" : "Нет в источнике",
        },
        { label: "Правило", value: () => "Не активировано" },
      ],
      componentRows,
    );
    finish(componentRows);
  };
  const showPayments = () => {
    activate(paymentsButton);
    renderTable(
      [
        {
          label: "Дата",
          value: (row) => row.payment_date || "—",
        },
        {
          label: "Период",
          value: (row) => row.period_month?.slice(0, 7) ?? "—",
        },
        {
          label: "Вид выплаты",
          value: (row) => row.payment_kind || "Не указан",
        },
        {
          label: "Юрлицо",
          value: (row) => row.legal_entity_name || "Не определено",
        },
        {
          label: "Сумма",
          value: (row) => formatMinorCurrency(row.amount_minor),
          className: () => "money-positive",
        },
        { label: "Статус", value: (row) => row.evidence_status },
      ],
      paymentRows,
    );
    finish(paymentRows);
  };
  monthlyButton.addEventListener("click", showMonthly);
  componentsButton.addEventListener("click", showComponents);
  paymentsButton.addEventListener("click", showPayments);
  actions.replaceChildren(
    back,
    monthlyButton,
    componentsButton,
    paymentsButton,
    taxNotice,
    note,
  );
  showMonthly();
}

async function loadGeneric(kind) {
  const definitions = {
    students: {
      title: "Ученики AlfaCRM",
      summary:
        "Текущие и архивные карточки, связи с группами, оплатами и посещениями.",
      columns: [
        {
          label: "Ученик",
          value: (row) => ({
            primary: row.full_name || `ID ${row.id}`,
            secondary: row.branch_name || "Филиал не определён",
          }),
        },
        { label: "Статус", value: (row) => row.study_status || "—" },
        {
          label: "Группы",
          value: (row) => numberFormat.format(row.group_count),
        },
        {
          label: "Занятия",
          value: (row) => numberFormat.format(row.lesson_count),
        },
        {
          label: "Оплаты",
          value: (row) => numberFormat.format(row.payment_count),
        },
        { label: "Срез", value: (row) => row.record_state },
      ],
    },
    families: {
      title: "Кандидаты в семьи",
      summary:
        "Это очередь ручной проверки, а не автоматически созданные семьи.",
      columns: [
        {
          label: "Возможная семья",
          value: (row) => ({
            primary: row.left_student_name || row.left_student_id,
            secondary: row.right_student_name || row.right_student_id,
          }),
        },
        { label: "Филиал", value: (row) => row.branch_name || "Несколько" },
        {
          label: "Уверенность",
          value: (row) => `${Math.round(row.confidence * 100)}%`,
        },
        { label: "Статус", value: (row) => row.status },
        { label: "Действие", value: () => "Проверить вручную" },
      ],
    },
    groups: {
      title: "Группы и классы",
      summary: "Состав и количество занятий из текущего snapshot AlfaCRM.",
      columns: [
        {
          label: "Группа",
          value: (row) => ({
            primary: row.name || `ID ${row.id}`,
            secondary: row.branch_name || "Филиал не определён",
          }),
        },
        {
          label: "Ученики",
          value: (row) => numberFormat.format(row.student_count),
        },
        {
          label: "Занятия",
          value: (row) => numberFormat.format(row.lesson_count),
        },
        {
          label: "Тип",
          value: (row) =>
            row.unit_kind === "class_candidate"
              ? "Класс · по названию"
              : "Группа / не классифицировано",
        },
        { label: "Статус", value: (row) => row.lifecycle_status || "—" },
        { label: "Срез", value: (row) => row.record_state },
      ],
    },
    teachers: {
      title: "Педагоги AlfaCRM",
      summary:
        "Педагоги, занятия и наличие исходных правил ставок; связь с сотрудником требует подтверждения.",
      columns: [
        {
          label: "Педагог",
          value: (row) => ({
            primary: row.full_name || `ID ${row.id}`,
            secondary: row.branch_name || "Филиал не определён",
          }),
        },
        {
          label: "Занятия",
          value: (row) => numberFormat.format(row.lesson_count),
        },
        {
          label: "Ставки",
          value: (row) => numberFormat.format(row.rate_rule_count),
        },
        {
          label: "Рабочие часы",
          value: (row) => numberFormat.format(row.working_hour_rule_count),
        },
        {
          label: "Связь с roster",
          value: (row) =>
            row.payroll_match_status === "exact_name_candidate_requires_review"
              ? "Кандидат · подтвердить"
              : row.payroll_match_status === "ambiguous_name"
                ? "Неоднозначно"
                : "Не найдено",
        },
        { label: "Статус CRM", value: (row) => row.teacher_status || "—" },
      ],
    },
    teacher_rates: {
      title: "Ставки педагогов AlfaCRM",
      summary:
        "Исходные суммы, типы и периоды ставок. Они не активированы как правила расчёта ArtHello OS.",
      columns: [
        {
          label: "Педагог",
          value: (row) => ({
            primary: row.teacher_name || `ID ${row.teacher_id || "—"}`,
            secondary: row.branch_name || "Филиал не определён",
          }),
        },
        {
          label: "Ставка",
          value: (row) =>
            row.rate_amount_minor === null
              ? "Не указана"
              : formatMinorCurrency(row.rate_amount_minor),
          className: () => "money-neutral",
        },
        { label: "Тип", value: (row) => row.rate_type || "—" },
        {
          label: "Период",
          value: (row) =>
            `${row.valid_from || "—"} — ${row.valid_to || "без окончания"}`,
        },
        { label: "Проверка", value: () => "Источник · не утверждено" },
      ],
    },
    lessons: {
      title: "Занятия",
      summary: "Все загруженные занятия и фактическая посещаемость AlfaCRM.",
      columns: [
        {
          label: "Занятие",
          value: (row) => ({
            primary: row.title || row.group_name || `ID ${row.id}`,
            secondary: row.branch_name || "Филиал не определён",
          }),
        },
        {
          label: "Дата",
          value: (row) =>
            row.lesson_date
              ? new Date(row.lesson_date).toLocaleString("ru-RU")
              : "—",
        },
        { label: "Группа", value: (row) => row.group_name || "—" },
        { label: "Педагог", value: (row) => row.teacher_name || "—" },
        {
          label: "Тип / предмет",
          value: (row) => ({
            primary: row.lesson_type_name || "Тип не указан",
            secondary: row.subject_name || "Предмет не указан",
          }),
        },
        {
          label: "Посещения",
          value: (row) => numberFormat.format(row.attendance_count),
        },
      ],
    },
    payments: {
      title: "Оплаты AlfaCRM",
      summary: "Реальные оплаты из CRM; банковская сверка ещё не выполнена.",
      columns: [
        {
          label: "Ученик",
          value: (row) => ({
            primary: row.student_name || `ID ${row.student_id || "—"}`,
            secondary: row.branch_name || "Филиал не определён",
          }),
        },
        {
          label: "Дата",
          value: (row) => row.payment_date || "—",
        },
        {
          label: "Сумма",
          value: (row) =>
            row.amount_minor === null
              ? "—"
              : formatMinorCurrency(row.amount_minor),
          className: () => "money-positive",
        },
        { label: "Тип", value: (row) => row.payment_type || "—" },
        { label: "Срез", value: (row) => row.record_state },
      ],
    },
  };
  const definition = definitions[kind];
  liveState.kind = kind;
  setLiveHeader(
    definition.title,
    definition.summary,
    "Реальный AlfaCRM · read-only",
  );
  const data = await fetchJson(liveEndpoint(kind));
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  liveState.total = Number.isSafeInteger(data?.total)
    ? data.total
    : rows.length;
  renderTable(definition.columns, rows);
  updatePagination();
}

function addGroupActions() {
  const actions = document.querySelector("#live-actions");
  actions.hidden = false;
  const copy = document.createElement("p");
  copy.textContent =
    "Переключайтесь между учебными единицами и всеми загруженными занятиями.";
  const groups = document.createElement("button");
  groups.type = "button";
  groups.className = "filter is-active";
  groups.textContent = "Группы";
  const lessons = document.createElement("button");
  lessons.type = "button";
  lessons.className = "filter";
  lessons.textContent = "Занятия";
  const extraLessons = document.createElement("button");
  extraLessons.type = "button";
  extraLessons.className = "filter";
  extraLessons.textContent = "Доп. занятия · кандидаты";
  const buttons = [groups, lessons, extraLessons];
  const activate = (button) => {
    for (const item of buttons)
      item.classList.toggle("is-active", item === button);
  };
  groups.addEventListener("click", () => {
    activate(groups);
    liveState.lessonCategory = null;
    liveState.offset = 0;
    void loadGeneric("groups");
  });
  lessons.addEventListener("click", () => {
    activate(lessons);
    liveState.lessonCategory = null;
    liveState.offset = 0;
    void loadGeneric("lessons");
  });
  extraLessons.addEventListener("click", () => {
    activate(extraLessons);
    liveState.lessonCategory = "extra_candidate";
    liveState.offset = 0;
    void loadGeneric("lessons");
  });
  actions.replaceChildren(copy, groups, lessons, extraLessons);
}

function addTeacherActions() {
  const actions = document.querySelector("#live-actions");
  actions.hidden = false;
  const copy = document.createElement("p");
  copy.textContent =
    "Ставки показываются отдельно и не используются для автоматического начисления.";
  const teachers = document.createElement("button");
  teachers.type = "button";
  teachers.className = "filter is-active";
  teachers.textContent = "Педагоги";
  const rates = document.createElement("button");
  rates.type = "button";
  rates.className = "filter";
  rates.textContent = "Ставки AlfaCRM";
  teachers.addEventListener("click", () => {
    teachers.classList.add("is-active");
    rates.classList.remove("is-active");
    liveState.offset = 0;
    void loadGeneric("teachers");
  });
  rates.addEventListener("click", () => {
    rates.classList.add("is-active");
    teachers.classList.remove("is-active");
    liveState.offset = 0;
    void loadGeneric("teacher_rates");
  });
  actions.replaceChildren(copy, teachers, rates);
}

async function loadMoney() {
  setLiveHeader(
    "Счета и остатки",
    "Денежные данные из банка; оплаты AlfaCRM доступны отдельным списком и ещё не считаются сверенными с выпиской.",
    "Реальные источники · owner-only",
  );
  document.querySelector("#live-search-label").hidden = true;
  const actions = document.querySelector("#live-actions");
  actions.hidden = false;
  const copy = document.createElement("p");
  copy.textContent =
    "Техническое подключение банка вынесено в «Систему». Здесь остаются только счета, остатки и данные для будущей сверки.";
  const system = document.createElement("button");
  system.type = "button";
  system.className = "primary-button";
  system.textContent = "Открыть настройки источников";
  system.addEventListener("click", () => {
    openSection("system");
  });
  const payments = document.createElement("button");
  payments.type = "button";
  payments.className = "filter";
  payments.textContent = "Оплаты AlfaCRM";
  payments.addEventListener("click", () => {
    liveState.offset = 0;
    document.querySelector("#live-search-label").hidden = false;
    void loadGeneric("payments");
  });
  actions.replaceChildren(copy, system, payments);

  const accounts = await fetchJson("/api/banking/accounts");
  const rows = Array.isArray(accounts?.rows) ? accounts.rows : [];
  liveState.total = rows.length;
  renderTable(
    [
      {
        label: "Счёт",
        value: (row) => ({
          primary: row.display_name || "Расчётный счёт",
          secondary: row.masked_number,
        }),
      },
      { label: "Валюта", value: (row) => row.currency },
      {
        label: "Остаток",
        value: (row) =>
          row.current_balance_minor === null
            ? "Не загружен"
            : formatMinorCurrency(row.current_balance_minor, row.currency),
        className: () => "money-neutral",
      },
      { label: "Статус", value: (row) => row.balance_status },
      {
        label: "Обновлено",
        value: (row) =>
          row.last_synced_at
            ? new Date(row.last_synced_at).toLocaleString("ru-RU")
            : "—",
      },
    ],
    rows,
  );
  updatePagination();
  document.querySelector("#live-prev").disabled = true;
  document.querySelector("#live-next").disabled = true;
}

async function loadSystem() {
  setLiveHeader(
    "Система и подключения",
    "Технические статусы, read-only авторизация и свежесть источников. Платёжных действий здесь нет.",
    "Защищённый owner-only backend",
  );
  document.querySelector("#live-search-label").hidden = true;
  const actions = document.querySelector("#live-actions");
  actions.hidden = false;
  const [summary, tochka] = await Promise.all([
    fetchJson("/api/owner-summary"),
    fetchJson("/api/banking/tochka/status"),
  ]);
  const publication =
    summary?.publication &&
    typeof summary.publication === "object" &&
    !Array.isArray(summary.publication)
      ? summary.publication
      : {};
  const publicationAttested =
    publication.attestationStatus === "atomic_attested" &&
    publication.atomicSnapshot === true &&
    typeof publication.activeBatchId === "string";
  const active = ["active", "active_sync_attention"].includes(tochka.status);
  const copy = document.createElement("p");
  copy.textContent = active
    ? `«Точка» подключена в режиме чтения: ${numberFormat.format(
        tochka.accountCount,
      )} счетов.`
    : "Для «Точки» нужно однократно подтвердить доступ к счетам, остаткам, клиентам и выпискам.";
  const oauth = document.createElement("button");
  oauth.type = "button";
  oauth.className = "primary-button";
  oauth.textContent = active ? "Обновить остатки" : "Подключить «Точку»";
  oauth.addEventListener("click", async () => {
    oauth.disabled = true;
    try {
      if (active) {
        await fetchJson("/api/banking/tochka/sync", {
          method: "POST",
          headers: { "x-arthello-action": "owner-confirmed" },
        });
        await loadSystem();
      } else {
        const result = await fetchJson("/api/banking/tochka/oauth/start", {
          method: "POST",
          headers: { "x-arthello-action": "owner-confirmed" },
        });
        window.location.assign(result.authorizeUrl);
      }
    } catch (error) {
      copy.textContent =
        error?.status === 403
          ? "Подключение не началось: подтвердите owner-доступ и повторите."
          : "Подключение не началось. Обновите страницу и повторите.";
      oauth.disabled = false;
    }
  });
  const paymentWarning = document.createElement("span");
  paymentWarning.className = "data-mode-pill";
  paymentWarning.textContent = "Платежи выключены";
  const publicationNotice = document.createElement("span");
  publicationNotice.className = "data-mode-pill";
  publicationNotice.textContent = publicationAttested
    ? `Read-модель: atomic / attested · ${publication.activeBatchId.slice(0, 8)}`
    : "Read-модель: legacy / unattested";
  actions.replaceChildren(copy, oauth, paymentWarning, publicationNotice);

  const sourceRows = [
    ...(Array.isArray(summary?.sources) ? summary.sources : []).map(
      (source) => ({
        source: source.label,
        status: source.status,
        mode: source.data_mode,
        last_synced_at: source.last_synced_at,
      }),
    ),
    {
      source: "Банк «Точка»",
      status: tochka.status,
      mode: "real_read_only",
      last_synced_at: tochka.lastSyncedAt,
    },
    {
      source: "Публикация read-модели",
      status: publicationAttested ? "active" : "attention",
      mode: publicationAttested ? "atomic_attested" : "legacy_unattested",
      last_synced_at: publication.committedAt ?? null,
    },
  ];
  liveState.total = sourceRows.length;
  renderTable(
    [
      { label: "Источник", value: (row) => row.source },
      { label: "Статус", value: (row) => row.status },
      {
        label: "Режим",
        value: (row) =>
          row.mode === "real_read_only"
            ? "Реальный · только чтение"
            : row.mode === "real_owner_provided_source"
              ? "Реальный · предоставлен владельцем"
              : row.mode === "atomic_attested"
                ? "Atomic · проверено серверным SHA-256"
                : row.mode === "legacy_unattested"
                  ? "Legacy · snapshot ещё не аттестован"
                  : row.mode,
      },
      {
        label: "Последнее обновление",
        value: (row) =>
          row.last_synced_at
            ? new Date(row.last_synced_at).toLocaleString("ru-RU")
            : "Ещё не завершено",
      },
    ],
    sourceRows,
  );
  updatePagination();
  document.querySelector("#live-prev").disabled = true;
  document.querySelector("#live-next").disabled = true;
}

async function loadLiveSection(section) {
  liveState.section = section;
  liveState.kind = section;
  liveState.offset = 0;
  liveState.query = "";
  liveState.lessonCategory = null;
  liveState.selectedEmployee = null;
  document.querySelector("#live-search").value = "";
  document.querySelector("#live-actions").hidden = true;
  document.querySelector("#live-actions").replaceChildren();
  document.querySelector("#live-search-label").hidden = false;
  showLivePanel(liveSections.has(section));
  if (!liveSections.has(section)) return;
  setText("#live-data-title", "Загрузка данных…");
  setText("#live-data-summary", "Проверяем owner-only источник.");
  try {
    if (section === "employees") await loadEmployeeDirectory(false);
    else if (section === "payroll") await loadEmployeeDirectory(true);
    else if (section === "groups") {
      addGroupActions();
      await loadGeneric("groups");
    } else if (section === "teachers") {
      addTeacherActions();
      await loadGeneric("teachers");
    } else if (section === "money") await loadMoney();
    else if (section === "system") await loadSystem();
    else await loadGeneric(section);
  } catch (error) {
    renderTable([], []);
    setText(
      "#live-data-empty",
      error?.status === 403
        ? "Owner-доступ к данным не подтверждён."
        : "Данные временно не загружены. Обновите страницу и повторите.",
    );
    document.querySelector("#live-data-empty").hidden = false;
    liveState.total = 0;
    updatePagination();
  }
}

function openSection(section, updateHash = true) {
  if (
    ![
      "pulse",
      "quality",
      "sources",
      "front-office",
      "integrations",
      ...Object.keys(moduleContent),
    ].includes(section)
  ) {
    section = "pulse";
  }

  document.querySelectorAll("[data-view]").forEach((view) => {
    view.classList.toggle("is-active", view.dataset.view === viewFor(section));
  });

  document.querySelectorAll("[data-section]").forEach((button) => {
    const active = button.dataset.section === section;
    button.classList.toggle("is-active", active);
    if (button.closest(".sidebar")) {
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });

  if (moduleContent[section]) {
    const content = moduleContent[section];
    document.querySelector("#module-title").textContent = content.title;
    document.querySelector("#module-summary").textContent = content.summary;
    document.querySelector("#module-icon").textContent = content.icon;
    document.querySelector("#module-state-title").textContent =
      content.stateTitle;
    document.querySelector("#module-state-copy").textContent =
      content.stateCopy;
    document
      .querySelector("#module-found")
      .replaceChildren(...content.found.map(listItem));
    document
      .querySelector("#module-gates")
      .replaceChildren(...content.gates.map(listItem));
  }

  closeDrawer({ restoreFocus: false });
  if (updateHash) history.replaceState(null, "", `#${section}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  void loadLiveSection(section);
}

function listItem(text) {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

document.querySelectorAll("[data-section]").forEach((button) => {
  button.addEventListener("click", () => openSection(button.dataset.section));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => openSection(button.dataset.go));
});

document.querySelectorAll("[data-fo-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    setFrontOfficeFilter(button.dataset.foFilter);
  });
});

document.querySelectorAll("[data-fo-metric]").forEach((button) => {
  button.addEventListener("click", () => {
    setFrontOfficeFilter(button.dataset.foMetric);
  });
});

document.querySelectorAll("[data-fo-compose]").forEach((button) => {
  button.addEventListener("click", () => {
    frontOfficeState.composeType = button.dataset.foCompose;
    document.querySelectorAll("[data-fo-compose]").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    document.querySelector("#fo-compose-body").placeholder =
      frontOfficeState.composeType === "ai_draft"
        ? "Подготовьте черновик ответа для проверки человеком"
        : "Запишите следующий контекст для команды";
  });
});

document
  .querySelector("#fo-editor")
  .addEventListener("submit", saveFrontOfficeLead);
document
  .querySelector("#fo-save-note")
  .addEventListener("click", saveFrontOfficeNote);
document
  .querySelector("#fo-open-profile")
  .addEventListener("click", (event) => {
    openFrontOfficeProfile(frontOfficeState.selectedId, event.currentTarget);
  });
document.querySelectorAll("[data-fo-profile-close]").forEach((button) => {
  button.addEventListener("click", closeFrontOfficeProfile);
});
document.querySelectorAll("[data-fo-profile-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setFrontOfficeProfileTab(button.dataset.foProfileTab);
  });
});
const integrationDrawerPortal = document.querySelector(
  "#integration-drawer-layer",
);
if (integrationDrawerPortal?.parentElement !== document.body) {
  document.body.append(integrationDrawerPortal);
}
document.querySelectorAll("[data-integration-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setIntegrationTab(button.dataset.integrationTab);
  });
});
document.querySelectorAll("[data-integration-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    setIntegrationFilter(button.dataset.integrationFilter);
  });
});
document.querySelectorAll("[data-integration-close]").forEach((button) => {
  button.addEventListener("click", closeIntegrationDrawer);
});
document
  .querySelector("#integration-add-queue")
  .addEventListener("click", startIntegrationConnector);
document.addEventListener("keydown", (event) => {
  if (!frontOfficeState.profileOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeFrontOfficeProfile();
    return;
  }
  if (event.key !== "Tab") return;
  const layer = document.querySelector("#fo-profile-layer");
  const focusable = [
    ...layer.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((item) => !item.closest("[hidden]"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
document.addEventListener("keydown", (event) => {
  if (!integrationState.drawerOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeIntegrationDrawer();
    return;
  }
  if (event.key !== "Tab") return;
  const layer = document.querySelector("#integration-drawer-layer");
  const focusable = [
    ...layer.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

const sidebar = document.querySelector("#sidebar");
const drawerOpeners = [...document.querySelectorAll("[data-drawer-open]")];
const mobileQuery = matchMedia("(max-width: 820px)");
let lastDrawerOpener = null;

function syncDrawerAccessibility() {
  const open = document.body.classList.contains("drawer-open");
  const hiddenOnMobile = mobileQuery.matches && !open;
  if (hiddenOnMobile) sidebar.setAttribute("inert", "");
  else sidebar.removeAttribute("inert");
  sidebar.setAttribute("aria-hidden", hiddenOnMobile ? "true" : "false");
  drawerOpeners.forEach((item) =>
    item.setAttribute("aria-expanded", open ? "true" : "false"),
  );
}

function openDrawer(event) {
  lastDrawerOpener = event.currentTarget;
  document.body.classList.add("drawer-open");
  syncDrawerAccessibility();
  sidebar.querySelector("[data-drawer-close]")?.focus();
}

function closeDrawer({ restoreFocus = true } = {}) {
  document.body.classList.remove("drawer-open");
  syncDrawerAccessibility();
  if (restoreFocus) lastDrawerOpener?.focus();
}

drawerOpeners.forEach((button) => button.addEventListener("click", openDrawer));
document.querySelectorAll("[data-drawer-close]").forEach((button) => {
  button.addEventListener("click", () => closeDrawer());
});
mobileQuery.addEventListener("change", syncDrawerAccessibility);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("drawer-open"))
    closeDrawer();
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((item) => item.classList.toggle("is-active", item === button));
    let visible = 0;
    document.querySelectorAll(".issue-table tbody tr").forEach((row) => {
      const show = filter === "all" || row.dataset.kind === filter;
      row.hidden = !show;
      if (show) visible += 1;
    });
    document.querySelector(".empty-filter").hidden = visible !== 0;
  });
});

async function reloadCurrentLiveData() {
  if (liveState.section === "employees") return loadEmployeeDirectory(false);
  if (liveState.section === "payroll" && !liveState.selectedEmployee)
    return loadEmployeeDirectory(true);
  if (liveState.section === "money" && liveState.kind !== "payments")
    return loadMoney();
  if (liveState.section === "system") return loadSystem();
  return loadGeneric(liveState.kind);
}

let searchTimer = null;
document.querySelector("#live-search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    liveState.query = event.target.value.trim();
    liveState.offset = 0;
    void reloadCurrentLiveData();
  }, 220);
});

document.querySelector("#live-prev").addEventListener("click", () => {
  liveState.offset = Math.max(0, liveState.offset - liveState.limit);
  void reloadCurrentLiveData();
});

document.querySelector("#live-next").addEventListener("click", () => {
  if (liveState.offset + liveState.limit >= liveState.total) return;
  liveState.offset += liveState.limit;
  void reloadCurrentLiveData();
});

window.addEventListener("hashchange", () =>
  openSection(location.hash.slice(1), false),
);
window.addEventListener("popstate", () => {
  if (integrationState.drawerOpen && !history.state?.integrationDrawer) {
    closeIntegrationDrawer({ fromHistory: true });
  }
});
const oauthReturn = new URLSearchParams(location.search);
const returnedFromTochka =
  oauthReturn.has("tochka_oauth") || oauthReturn.has("tochka_error");
renderFrontOffice();
renderIntegrationCenter();
openSection(
  returnedFromTochka ? "system" : location.hash.slice(1) || "pulse",
  false,
);
if (returnedFromTochka) {
  history.replaceState(null, "", `${location.pathname}#system`);
}
void loadOwnerSummary();
void loadFrontOfficeLeads();
void loadIntegrationStatus();
syncDrawerAccessibility();
