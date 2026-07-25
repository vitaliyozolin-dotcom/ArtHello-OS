const moduleContent = {
  families: {
    title: "Семьи",
    icon: "⌂",
    summary:
      "Единая карточка семьи должна связывать родителей, учеников, договоры, платежи и историю контактов.",
    stateTitle: "Модель есть, реальные семьи ещё не сформированы",
    stateCopy:
      "AlfaCRM не предоставляет надёжную family entity. Импортёр создаёт только кандидатов по контактам и никогда не подтверждает семью автоматически; свежая выгрузка заблокирована сетью.",
    found: [
      "Сущности людей и семей",
      "Профили учеников и связи с представителями",
      "Очередь кандидатов с ручным подтверждением",
    ],
    gates: [
      "Не объединять семьи по одному слабому признаку",
      "Загрузить учеников из доступной CRM-сети",
      "Проверить каждый кандидат вручную",
    ],
  },
  students: {
    title: "Ученики",
    icon: "◉",
    summary:
      "Профиль ученика, статус обучения, семья, группы, посещения и финансовая история.",
    stateTitle: "Read-only importer готов, свежих строк пока нет",
    stateCopy:
      "Код загружает клиентов-учеников отдельно от лидов, включая архив, а абонементы хранит отдельным слоем. Последний запуск остановился на network timeout до branch inventory.",
    found: [
      "Raw-слой AlfaCRM",
      "Раздельные normalized students и leads",
      "Абонементы и профили жизненного цикла",
    ],
    gates: [
      "Запустить importer на backend с доступом к CRM",
      "Проверить актуальность статусов и архив",
      "Сверить связи ученик ↔ семья",
    ],
  },
  groups: {
    title: "Группы и классы",
    icon: "▦",
    summary:
      "Группы, классы, программы, расписание, зачисления и фактические посещения.",
    stateTitle: "Импорт групп и занятий реализован",
    stateCopy:
      "Группы, состав, занятия трёх статусов, расписание и посещаемость сохраняются raw + normalized. Реальные данные ещё не получены из-за сетевого блокера.",
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
    stateTitle: "Roster загружен в изолированную БД",
    stateCopy:
      "114 уникальных внешних идентичностей получены из реальной зарплатной таблицы. Они ещё не считаются подтверждёнными employee records и не публикуются в Sites.",
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
  payroll: {
    title: "Зарплата",
    icon: "₽",
    summary:
      "Проверяемый расчёт зарплаты с источником каждого начисления и контролем перед выплатой.",
    stateTitle: "Реальный источник импортирован, правила ещё не утверждены",
    stateCopy:
      "3 689 raw-строк сохранены с formula snapshot; 1 881 выплат и 1 328 результатов начислений совпали с источником. Ни одна формула не активирована как правило системы.",
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
    stateTitle: "Новый credential ждёт protected backend и OAuth",
    stateCopy:
      "Предыдущий auth-probe получил service token; новый временный credential не хранится в Sites. Consent, счета и операции в систему не загружались.",
    found: [
      "Коннекторы банков",
      "Счета, остатки и операции",
      "Raw-слой выписок",
    ],
    gates: [
      "Заменить Sites root на точный backend callback",
      "Пройти пользовательский consent без payment scopes",
      "После backup сохранить credentials только в encrypted vault",
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
    stateTitle: "Sites безопасен; публичный Replit отстаёт от исходников",
    stateCopy:
      "Owner-only Sites не содержит секретов и персональных данных. Проверка live Replit выявила старую сборку без noindex/X-Robots; выпуск заблокирован до backup и protected env.",
    found: [
      "Sites project с owner-only доступом",
      "API, sync-сервис и PostgreSQL-схема",
      "Аудит интеграций и безопасности",
    ],
    gates: [
      "Выпустить noindex/auth/OAuth fixes после backup",
      "Проверить guarded bank-config migration в restored sandbox",
      "Дать backend сетевой доступ к AlfaCRM",
    ],
  },
};

const viewFor = (section) =>
  ["pulse", "quality", "sources"].includes(section) ? section : "module";

function openSection(section, updateHash = true) {
  if (
    !["pulse", "quality", "sources", ...Object.keys(moduleContent)].includes(
      section,
    )
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

window.addEventListener("hashchange", () =>
  openSection(location.hash.slice(1), false),
);
openSection(location.hash.slice(1) || "pulse", false);
syncDrawerAccessibility();
