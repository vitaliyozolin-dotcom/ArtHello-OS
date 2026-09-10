"use client";

import { useMemo, useState } from "react";
import type { ModuleId } from "../../data/test-snapshot";
import { AppIcon } from "./AppIcon";

type SystemModule = Extract<ModuleId, "events" | "contractors" | "access" | "assets" | "quality">;

type RecordItem = {
  id: string;
  title: string;
  context: string;
  status: string;
  owner: string;
  next: string;
  source: string;
  relation: { label: string; module: ModuleId };
};

type ModuleConfig = {
  eyebrow: string;
  title: string;
  subtitle: string;
  tabs: string[];
  kpis: Array<{ label: string; value: string; note: string; tone?: string }>;
  records: RecordItem[];
};

const configs: Record<SystemModule, ModuleConfig> = {
  events: {
    eyebrow: "Операционный календарь",
    title: "События",
    subtitle: "Будущие и прошедшие события, участники, бюджет, задачи и измеримый результат.",
    tabs: ["Календарь", "Список", "Будущие", "Прошедшие", "Проекты"],
    kpis: [
      { label: "Ближайшие 30 дней", value: "12", note: "4 объекта" },
      { label: "Требуют решения", value: "3", note: "бюджет или ответственный", tone: "warning" },
      { label: "Участников", value: "286", note: "тестовый план" },
      { label: "С итоговым отчётом", value: "8 из 9", note: "за прошедший месяц", tone: "positive" },
    ],
    records: [
      { id: "EVENT-T-071", title: "День открытых дверей", context: "Корпус 1 · 29 августа · 78 участников", status: "Подготовка", owner: "Директор по развитию", next: "Подтвердить план коммуникаций", source: "strategy_events · SYNTHETIC", relation: { label: "Проект набора", module: "projects" } },
      { id: "EVENT-T-084", title: "Педагогический совет", context: "Школа · 26 августа · 34 участника", status: "По плану", owner: "Директор школы", next: "Собрать материалы", source: "strategy_events · SYNTHETIC", relation: { label: "Методики", module: "methods" } },
      { id: "EVENT-T-092", title: "Семейный фестиваль", context: "Все корпуса · 12 сентября", status: "Риск бюджета", owner: "Руководитель проектов", next: "Согласовать 120 000 ₽", source: "strategy_events · SYNTHETIC", relation: { label: "Бюджет проекта", module: "finance" } },
    ],
  },
  contractors: {
    eyebrow: "Поставщики и качество",
    title: "Подрядчики",
    subtitle: "Договоры, работы, сроки, качество, оплаты, документы и проверяемые альтернативы.",
    tabs: ["Реестр", "Категории", "Договоры", "Оплаты", "Качество", "Альтернативы"],
    kpis: [
      { label: "Активные", value: "24", note: "синтетический реестр" },
      { label: "Документы отсутствуют", value: "4", note: "созданы задачи", tone: "warning" },
      { label: "Под риском", value: "3", note: "срок или качество", tone: "warning" },
      { label: "Средняя оценка", value: "4,4", note: "из 5 по закрытым работам", tone: "positive" },
    ],
    records: [
      { id: "SUP-T-SAFE-001", title: "ООО «Сервис Контур»", context: "Инженерные системы · 3 объекта", status: "Нужен акт", owner: "Служба эксплуатации", next: "Получить закрывающий документ", source: "procurement_suppliers · SYNTHETIC", relation: { label: "Ремонт СКУД", module: "safety" } },
      { id: "SUP-T-FOOD-002", title: "ИП «Свежая ферма»", context: "Продукты · 8 поставок", status: "Работает", owner: "Шеф-повар", next: "Сверить следующую поставку", source: "procurement_suppliers · SYNTHETIC", relation: { label: "Поставки кухни", module: "food" } },
      { id: "SUP-T-IT-011", title: "ООО «ТехШкола»", context: "Оборудование · гарантия", status: "Проверка цены", owner: "Снабжение", next: "Сравнить 3 предложения", source: "procurement_suppliers · SYNTHETIC", relation: { label: "Закупка оборудования", module: "procurement" } },
    ],
  },
  access: {
    eyebrow: "Least privilege",
    title: "Доступы",
    subtitle: "Пользователи, роли, эффективные права, временные допуски, активные сессии и неизменяемый журнал.",
    tabs: ["Пользователи", "Роли", "Эффективные права", "Объекты", "Временные", "Журнал входов"],
    kpis: [
      { label: "Активные пользователи", value: "84", note: "тестовый контур" },
      { label: "На пересмотре", value: "6", note: "изменение роли или увольнение", tone: "warning" },
      { label: "Временные доступы", value: "3", note: "2 истекают за 7 дней" },
      { label: "Критичные нарушения", value: "0", note: "в тестовом журнале", tone: "positive" },
    ],
    records: [
      { id: "ACCESS-T-032", title: "Сотрудник T-032", context: "Педагог · Школа 1–11", status: "Эффективен", owner: "HR + IT", next: "Проверка 30 сентября", source: "hr_accesses · SYNTHETIC", relation: { label: "Карточка сотрудника", module: "hr" } },
      { id: "ACCESS-T-052", title: "Сотрудник T-052", context: "Уволен · историческая запись", status: "Отозван", owner: "HR", next: "Действий не требуется", source: "hr_accesses · SYNTHETIC", relation: { label: "История сотрудника", module: "hr" } },
      { id: "ACCESS-T-MED-01", title: "Роль Медработник", context: "Отдельный synthetic grant", status: "Ограничен", owner: "Директор + безопасность", next: "Контроль журнала просмотров", source: "medical_access_grants · SYNTHETIC", relation: { label: "Медицинский контур", module: "medical" } },
    ],
  },
  assets: {
    eyebrow: "Объекты и оборудование",
    title: "Имущество",
    subtitle: "Инвентарные карточки, места, ответственные, гарантии, обслуживание, ремонты и перемещения.",
    tabs: ["Объекты", "Помещения", "Имущество", "Оборудование", "Гарантии", "Ремонты", "Перемещения"],
    kpis: [
      { label: "Единиц имущества", value: "417", note: "синтетический реестр" },
      { label: "Без ответственного", value: "5", note: "нужно назначение", tone: "warning" },
      { label: "Гарантия истекает", value: "6", note: "на горизонте 45 дней" },
      { label: "В ремонте", value: "3", note: "2 с актами" },
    ],
    records: [
      { id: "EQ-T-117", title: "Проектор Epson · кабинет 12", context: "INV-00117 · Корпус 1", status: "Проверка", owner: "Заведующий хозяйством", next: "Провести ТО 26 августа", source: "procurement_assets · SYNTHETIC", relation: { label: "Заявка на обслуживание", module: "procurement" } },
      { id: "SAFE-EQ-T-001", title: "Контроллер СКУД · главный вход", context: "SN-T-SAFE-001 · Корпус 1", status: "После ремонта", owner: "Служба эксплуатации", next: "Следующая проверка 21 сентября", source: "safety_equipment · SYNTHETIC", relation: { label: "Проверки безопасности", module: "safety" } },
      { id: "EQ-T-288", title: "Камера · вход детского сада", context: "INV-00288 · Корпус 2", status: "Нужен акт", owner: "Безопасность", next: "Закрыть ремонт документом", source: "safety_equipment · SYNTHETIC", relation: { label: "Подрядчик ремонта", module: "contractors" } },
    ],
  },
  quality: {
    eyebrow: "Обратная связь и улучшения",
    title: "Качество и обращения",
    subtitle: "Жалобы, предложения, сроки реакции, причины, решения и корректирующие действия без тупиков.",
    tabs: ["Обращения", "Жалобы", "Предложения", "Инциденты", "Просроченные", "Причины", "Корректирующие действия"],
    kpis: [
      { label: "Открытые обращения", value: "14", note: "синтетический месяц" },
      { label: "Просрочены", value: "2", note: "назначены владельцы", tone: "warning" },
      { label: "Повторные", value: "3", note: "нужна причина процесса", tone: "warning" },
      { label: "Удовлетворённость", value: "4,6", note: "по 28 закрытым обращениям", tone: "positive" },
    ],
    records: [
      { id: "Q-T-014", title: "Изменение времени обратной связи", context: "Семья T-014 · школа", status: "В работе", owner: "Директор школы", next: "Подтвердить новый SLA", source: "SYNTHETIC_QUALITY_TEST", relation: { label: "Карточка семьи", module: "clients" } },
      { id: "Q-T-021", title: "Питание: повторное обращение", context: "Семья T-021 · детский сад", status: "Причина найдена", owner: "Руководитель кухни", next: "Проверить корректирующее действие", source: "SYNTHETIC_QUALITY_TEST", relation: { label: "Рабочий день кухни", module: "food" } },
      { id: "Q-T-033", title: "Предложение по домашним заданиям", context: "Группа 3А · методика", status: "Оценка эффекта", owner: "Методист", next: "Сравнить результаты версии", source: "SYNTHETIC_QUALITY_TEST", relation: { label: "Версия программы", module: "methods" } },
    ],
  },
};

const accessRoles = new Set(["Собственник", "Директор", "Представитель Виталия", "HR", "Интеграции"]);

export function SystemWorkspace({
  module,
  role,
  notify,
  createTask,
  navigate,
}: {
  module: SystemModule;
  role: string;
  notify: (value: string) => void;
  createTask: () => void;
  navigate: (module: ModuleId) => void;
}) {
  const config = configs[module];
  const [tab, setTab] = useState(config.tabs[0]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(config.records[0].id);
  const selected = config.records.find((item) => item.id === selectedId) ?? config.records[0];
  const visible = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ru-RU");
    if (!clean) return config.records;
    return config.records.filter((item) => [item.id, item.title, item.context, item.owner, item.status].join(" ").toLocaleLowerCase("ru-RU").includes(clean));
  }, [config.records, query]);

  if (module === "access" && !accessRoles.has(role)) {
    return (
      <section className="page system-workspace">
        <div className="system-state" role="status">
          <AppIcon name="access" />
          <p className="eyebrow">Доступ ограничен</p>
          <h1>Матрица прав скрыта для роли «{role}»</h1>
          <p>Запросите временный допуск у владельца системы. Отказ зафиксирован без раскрытия пользователей и прав.</p>
          <button className="secondary-action" onClick={() => navigate("home")}>Вернуться на дашборд</button>
        </div>
      </section>
    );
  }

  return (
    <section className="page system-workspace">
      <header className="system-heading">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h1>{config.title}</h1>
          <p>{config.subtitle}</p>
        </div>
        <button className="primary-action" onClick={createTask}><AppIcon name="plus" />Создать связанную задачу</button>
      </header>

      <div className="system-kpis" aria-label={`Ключевые показатели раздела ${config.title}`}>
        {config.kpis.map((kpi, index) => (
          <button key={kpi.label} className={kpi.tone ?? ""} onClick={() => { setSelectedId(config.records[index % config.records.length].id); notify(`Открыта детализация: ${kpi.label}`); }}>
            <span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.note}</small><em>К источнику</em>
          </button>
        ))}
      </div>

      <div className="system-tabs" role="tablist" aria-label={`Представления раздела ${config.title}`}>
        {config.tabs.map((item) => <button role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}
      </div>

      <div className="system-layout">
        <section className="system-list-panel">
          <header>
            <div><p>{tab}</p><h2>Рабочий реестр</h2></div>
            <label className="system-search"><AppIcon name="search" /><span className="sr-only">Поиск</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, объект, статус или ответственный" /></label>
          </header>
          <div className="system-list" role="list">
            {visible.map((item) => (
              <button role="listitem" className={selected.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className="system-record-icon"><AppIcon name={module} /></span>
                <span><small>{item.id}</small><strong>{item.title}</strong><em>{item.context}</em></span>
                <span><b>{item.status}</b><small>{item.owner}</small></span>
                <AppIcon name="chevron" />
              </button>
            ))}
            {visible.length === 0 ? <div className="system-empty"><strong>Ничего не найдено</strong><p>Измените запрос. Фильтр «{tab}» сохранён в текущем разделе.</p><button onClick={() => setQuery("")}>Сбросить поиск</button></div> : null}
          </div>
        </section>

        <aside className="system-detail" aria-label={`Карточка ${selected.title}`}>
          <header><div><p>{selected.id}</p><h2>{selected.title}</h2><span>{selected.context}</span></div><b>{selected.status}</b></header>
          <dl>
            <div><dt>Ответственный</dt><dd>{selected.owner}</dd></div>
            <div><dt>Следующий шаг</dt><dd>{selected.next}</dd></div>
            <div><dt>Источник</dt><dd>{selected.source}</dd></div>
            <div><dt>Качество данных</dt><dd>Тестовые данные · не использовать как бизнес-факт</dd></div>
          </dl>
          <section className="system-lineage"><p>Связи</p><button onClick={() => navigate(selected.relation.module)}><span>{selected.relation.label}</span><AppIcon name="chevron" /></button><button onClick={() => navigate("tasks")}><span>Связанные задачи</span><AppIcon name="chevron" /></button></section>
          <footer><button className="primary-action" onClick={createTask}>Создать задачу</button><button className="secondary-action" onClick={() => notify(`История ${selected.id}: изменений после публикации тестового набора нет`)}>История изменений</button></footer>
        </aside>
      </div>
    </section>
  );
}
