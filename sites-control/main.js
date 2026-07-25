const moduleContent = {
  families: {
    title: "Семьи",
    icon: "⌂",
    summary: "Единая карточка семьи должна связывать родителей, учеников, договоры, платежи и историю контактов.",
    stateTitle: "Модель семей найдена",
    stateCopy: "В схеме есть persons, families, student profiles и guardian links. Текущая полнота связей не проверена.",
    found: ["Сущности людей и семей", "Профили учеников и связи с представителями", "Ранняя временная шкала семьи"],
    gates: ["Не объединять семьи по одному слабому признаку", "Проверить дубли телефонов и контактов", "Подтвердить охват филиалов"],
  },
  students: {
    title: "Ученики",
    icon: "◉",
    summary: "Профиль ученика, статус обучения, семья, группы, посещения и финансовая история.",
    stateTitle: "CRM- и профильные сущности найдены",
    stateCopy: "Код содержит raw и normalized уровни учеников. Свежесть и количество записей намеренно не показаны.",
    found: ["Raw-слой AlfaCRM", "Нормализованные CRM-ученики", "Профили и жизненный цикл"],
    gates: ["Завершить обезличенную инвентаризацию всех филиалов", "Проверить актуальность статусов", "Сверить связи ученик ↔ семья"],
  },
  groups: {
    title: "Группы и классы",
    icon: "▦",
    summary: "Группы, классы, программы, расписание, зачисления и фактические посещения.",
    stateTitle: "Образовательный фундамент найден",
    stateCopy: "В проекте есть educational units, class groups, enrollments и schedule. Бизнес-правила ещё не приняты.",
    found: ["Группы и учебные единицы", "Зачисления", "Расписание и посещаемость"],
    gates: ["Сопоставить CRM-группы с внутренними классами", "Проверить историю переходов", "Утвердить правила вместимости"],
  },
  employees: {
    title: "Сотрудники",
    icon: "♙",
    summary: "Подразделения, сотрудники, роли, занятость и основание для расчёта вознаграждения.",
    stateTitle: "Фундамент HR-модуля найден",
    stateCopy: "Схема и ранние экраны сотрудников присутствуют. Реальный состав команды и роли не проверены.",
    found: ["Подразделения и сотрудники", "Роли и назначения", "Ранние правила зарплаты"],
    gates: ["Подтвердить штат и юридические связи", "Не придумывать оклады, ставки и KPI", "Настроить разграничение доступа"],
  },
  payroll: {
    title: "Зарплата",
    icon: "₽",
    summary: "Проверяемый расчёт зарплаты с источником каждого начисления и контролем перед выплатой.",
    stateTitle: "Сущности расчёта есть, финансовая правда не готова",
    stateCopy: "Таблицы payroll и правила обнаружены, но ставки, KPI и формулы не подтверждены владельцем.",
    found: ["Правила и периоды зарплаты", "Начисления и статусы", "Связи с сотрудниками"],
    gates: ["Утвердить каждую формулу и ставку", "Проверить налоги и договорные основания", "Запретить выпуск при денежной ошибке"],
  },
  money: {
    title: "Деньги",
    icon: "◒",
    summary: "Счета, остатки и банковские операции с понятным происхождением и статусом сверки.",
    stateTitle: "Банковский слой найден, live-состояние неизвестно",
    stateCopy: "Реализованы коннекторы и таблицы банковских операций. В Sites банковских токенов и операций нет.",
    found: ["Коннекторы банков", "Счета, остатки и операции", "Raw-слой выписок"],
    gates: ["После backup выполнить guarded migration и ротацию ключей", "Хранить новые credentials только в protected backend env", "Подтвердить счета, юрлица, дубли и пропуски"],
  },
  cashflow: {
    title: "ДДС",
    icon: "⇅",
    summary: "Движение денежных средств по проверенным банковским операциям и утверждённым статьям.",
    stateTitle: "Каркас ДДС присутствует",
    stateCopy: "Ledger и статьи найдены, но отчёт нельзя использовать до свежей сверки банков и классификации операций.",
    found: ["Финансовый ledger", "Статьи движения денег", "Ранние cashflow-экраны"],
    gates: ["Подтвердить полноту банковских операций", "Утвердить статьи и правила классификации", "Закрыть несверенные операции"],
  },
  pnl: {
    title: "ОПиУ",
    icon: "▥",
    summary: "Доходы, расходы и результат периода на единой учётной политике.",
    stateTitle: "Экран и расчётный фундамент найдены",
    stateCopy: "Текущие значения скрыты: без подтверждённых начислений, зарплаты и аллокаций ОПиУ не является истиной.",
    found: ["P&L route и экран", "Финансовые статьи", "Периоды и агрегаты"],
    gates: ["Согласовать метод признания дохода", "Проверить зарплату и распределения", "Провести закрытие месяца"],
  },
  model: {
    title: "Финансовая модель",
    icon: "⌁",
    summary: "Сценарии, прогнозы и рекомендации только поверх сверенной операционной и финансовой базы.",
    stateTitle: "Раздел намеренно закрыт воротами качества",
    stateCopy: "AI CFO и рекомендации не запускаются до сверки источников и утверждения расчётных правил.",
    found: ["Ранняя версия AI CFO", "Прогнозные и аналитические заготовки", "Trust Score и закрытие месяца"],
    gates: ["Достичь готовности финансовой правды", "Зафиксировать допущения модели", "Проверить рекомендации человеком"],
  },
  system: {
    title: "Система",
    icon: "⚙",
    summary: "Интеграции, качество данных, безопасность, аудит, окружения и эксплуатационные процедуры.",
    stateTitle: "Контуры разделены на уровне checkpoint",
    stateCopy: "Sites остаётся приватной контрольной оболочкой без production-секретов. Replit и production требуют отдельного выпуска.",
    found: ["Sites project с owner-only доступом", "API, sync-сервис и PostgreSQL-схема", "Аудит интеграций и безопасности"],
    gates: ["Закрыть HIGH по scoped handlers, callbacks и оставшимся diagnostics", "Проверить guarded bank-config migration после backup в sandbox", "Только затем расширять live read-only проверку"],
  },
};

const viewFor = (section) => ["pulse", "quality", "sources"].includes(section) ? section : "module";

function openSection(section, updateHash = true) {
  if (!["pulse", "quality", "sources", ...Object.keys(moduleContent)].includes(section)) {
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
    document.querySelector("#module-state-title").textContent = content.stateTitle;
    document.querySelector("#module-state-copy").textContent = content.stateCopy;
    document.querySelector("#module-found").replaceChildren(...content.found.map(listItem));
    document.querySelector("#module-gates").replaceChildren(...content.gates.map(listItem));
  }

  closeDrawer({ restoreFocus: false });
  if (updateHash) history.replaceState(null, "", `#${section}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  drawerOpeners.forEach((item) => item.setAttribute("aria-expanded", open ? "true" : "false"));
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
  if (event.key === "Escape" && document.body.classList.contains("drawer-open")) closeDrawer();
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
    let visible = 0;
    document.querySelectorAll(".issue-table tbody tr").forEach((row) => {
      const show = filter === "all" || row.dataset.kind === filter;
      row.hidden = !show;
      if (show) visible += 1;
    });
    document.querySelector(".empty-filter").hidden = visible !== 0;
  });
});

window.addEventListener("hashchange", () => openSection(location.hash.slice(1), false));
openSection(location.hash.slice(1) || "pulse", false);
syncDrawerAccessibility();
