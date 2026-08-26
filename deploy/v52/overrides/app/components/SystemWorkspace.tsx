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

function emptyConfig(
  eyebrow: string,
  title: string,
  subtitle: string,
  tabs: string[],
  kpiLabels: string[],
): ModuleConfig {
  return {
    eyebrow,
    title,
    subtitle,
    tabs,
    kpis: kpiLabels.map((label) => ({ label, value: "0", note: "Данных пока нет" })),
    records: [],
  };
}

const configs: Record<SystemModule, ModuleConfig> = {
  events: emptyConfig("Операционный календарь", "События", "Будущие и прошедшие события, участники, бюджет, задачи и измеримый результат.", ["Календарь", "Список", "Будущие", "Прошедшие", "Проекты"], ["Ближайшие 30 дней", "Требуют решения", "Участников", "С итоговым отчётом"]),
  contractors: emptyConfig("Поставщики и качество", "Подрядчики", "Договоры, работы, сроки, качество, оплаты, документы и проверяемые альтернативы.", ["Реестр", "Категории", "Договоры", "Оплаты", "Качество", "Альтернативы"], ["Активные", "Документы отсутствуют", "Под риском", "Средняя оценка"]),
  access: emptyConfig("Управление правами", "Доступы", "Пользователи, роли, эффективные права, временные допуски, активные сессии и неизменяемый журнал.", ["Пользователи", "Роли", "Эффективные права", "Объекты", "Временные", "Журнал входов"], ["Активные пользователи", "На пересмотре", "Временные доступы", "Критичные нарушения"]),
  assets: emptyConfig("Объекты и оборудование", "Имущество", "Инвентарные карточки, места, ответственные, гарантии, обслуживание, ремонты и перемещения.", ["Объекты", "Помещения", "Имущество", "Оборудование", "Гарантии", "Ремонты", "Перемещения"], ["Единиц имущества", "Без ответственного", "Гарантия истекает", "В ремонте"]),
  quality: emptyConfig("Обратная связь и улучшения", "Качество и обращения", "Жалобы, предложения, сроки реакции, причины, решения и корректирующие действия без тупиков.", ["Обращения", "Жалобы", "Предложения", "Инциденты", "Просроченные", "Причины", "Корректирующие действия"], ["Открытые обращения", "Просрочены", "Повторные", "Удовлетворённость"]),
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
  const [selectedId, setSelectedId] = useState(config.records[0]?.id ?? "");
  const selected = config.records.find((item) => item.id === selectedId) ?? config.records[0] ?? null;
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
        {config.kpis.map((kpi) => (
          <button key={kpi.label} className={kpi.tone ?? ""} disabled={config.records.length === 0} onClick={() => notify(`Открыта детализация: ${kpi.label}`)}>
            <span>{kpi.label}</span><strong>{kpi.value}</strong><small>{kpi.note}</small><em>{config.records.length ? "К источнику" : "Реестр пуст"}</em>
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
              <button role="listitem" className={selected?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className="system-record-icon"><AppIcon name={module} /></span>
                <span><small>{item.id}</small><strong>{item.title}</strong><em>{item.context}</em></span>
                <span><b>{item.status}</b><small>{item.owner}</small></span>
                <AppIcon name="chevron" />
              </button>
            ))}
            {visible.length === 0 ? <div className="system-empty"><strong>{query ? "Ничего не найдено" : "Данных пока нет"}</strong><p>{query ? `Измените запрос. Фильтр «${tab}» сохранён в текущем разделе.` : "Записи появятся после ручного добавления или подтверждённого импорта."}</p>{query ? <button onClick={() => setQuery("")}>Сбросить поиск</button> : null}</div> : null}
          </div>
        </section>

        {selected ? <aside className="system-detail" aria-label={`Карточка ${selected.title}`}>
          <header><div><p>{selected.id}</p><h2>{selected.title}</h2><span>{selected.context}</span></div><b>{selected.status}</b></header>
          <dl>
            <div><dt>Ответственный</dt><dd>{selected.owner}</dd></div>
            <div><dt>Следующий шаг</dt><dd>{selected.next}</dd></div>
            <div><dt>Источник</dt><dd>{selected.source}</dd></div>
            <div><dt>Качество данных</dt><dd>Определяется источником записи</dd></div>
          </dl>
          <section className="system-lineage"><p>Связи</p><button onClick={() => navigate(selected.relation.module)}><span>{selected.relation.label}</span><AppIcon name="chevron" /></button><button onClick={() => navigate("tasks")}><span>Связанные задачи</span><AppIcon name="chevron" /></button></section>
          <footer><button className="primary-action" onClick={createTask}>Создать задачу</button><button className="secondary-action" onClick={() => notify(`История ${selected.id}: изменений пока нет`)}>История изменений</button></footer>
        </aside> : <aside className="system-detail"><div className="system-empty"><AppIcon name={module} /><strong>Карточка не выбрана</strong><p>В реестре пока нет записей. Структура раздела готова к работе.</p></div></aside>}
      </div>
    </section>
  );
}
