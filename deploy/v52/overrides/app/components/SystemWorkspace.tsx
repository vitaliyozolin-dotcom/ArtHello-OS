"use client";

import { useMemo, useState } from "react";
import type { ModuleId } from "../../data/test-snapshot";
import { AppIcon } from "./AppIcon";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, SearchField, Tabs } from "./design-system";
import "./SystemWorkspace.ds.css";

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
    return <PageContainer className="ahSystemPage">
      <PageHeader eyebrow="ДОСТУП ОГРАНИЧЕН" title={`Матрица прав скрыта для роли «${role}»`} description="Отказ зафиксирован без раскрытия пользователей и прав." actions={<Button variant="secondary" onClick={() => navigate("home")}>Вернуться на дашборд</Button>} />
      <EmptyState className="ahSystemEmpty" density="compact" title="Нужен временный допуск" description="Запросите доступ у владельца системы. До подтверждения пользователи и эффективные права остаются скрыты." />
    </PageContainer>;
  }

  return (
    <PageContainer className="ahSystemPage">
      <PageHeader eyebrow={config.eyebrow.toUpperCase()} title={config.title} description={config.subtitle} actions={<Button variant="primary" onClick={createTask}><AppIcon name="plus" />Создать связанную задачу</Button>} />

      <div className="ahSystemKpis" aria-label={`Ключевые показатели раздела ${config.title}`}>
        {config.kpis.map((kpi) => <KpiCard key={kpi.label} className={kpi.tone ? `ahSystemKpi-${kpi.tone}` : undefined} label={kpi.label} value={kpi.value} note={kpi.note} onClick={config.records.length ? () => notify(`Открыта детализация: ${kpi.label}`) : undefined} />)}
      </div>

      <div className="ahSystemTabs"><Tabs items={config.tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel={`Представления раздела ${config.title}`} /></div>

      <div className="ahSystemLayout">
        <Card className="ahSystemListPanel">
          <header>
            <div><p>{tab}</p><h2>Рабочий реестр</h2></div>
            <SearchField value={query} onChange={setQuery} placeholder="ID, объект, статус или ответственный" label={`Поиск в разделе ${config.title}`} />
          </header>
          <div data-ah-compact-card="true" className="ahSystemList" role="list">
            {visible.map((item) => (
              <button role="listitem" className={selected?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className="system-record-icon"><AppIcon name={module} /></span>
                <span><small>{item.id}</small><strong>{item.title}</strong><em>{item.context}</em></span>
                <span><b>{item.status}</b><small>{item.owner}</small></span>
                <AppIcon name="chevron" />
              </button>
            ))}
            {visible.length === 0 ? <EmptyState className="ahSystemEmpty" density="compact" title={query ? "Ничего не найдено" : "Данных пока нет"} description={query ? `Измените запрос. Фильтр «${tab}» сохранён в текущем разделе.` : "Записи появятся после ручного добавления или подтверждённого импорта."} action={query ? <Button variant="ghost" onClick={() => setQuery("")}>Сбросить поиск</Button> : undefined} /> : null}
          </div>
        </Card>

        {selected ? <Card className="ahSystemDetail">
          <header><div><p>{selected.id}</p><h2>{selected.title}</h2><span>{selected.context}</span></div><b>{selected.status}</b></header>
          <dl>
            <div><dt>Ответственный</dt><dd>{selected.owner}</dd></div>
            <div><dt>Следующий шаг</dt><dd>{selected.next}</dd></div>
            <div><dt>Источник</dt><dd>{selected.source}</dd></div>
            <div><dt>Качество данных</dt><dd>Определяется источником записи</dd></div>
          </dl>
          <section className="system-lineage"><p>Связи</p><button onClick={() => navigate(selected.relation.module)}><span>{selected.relation.label}</span><AppIcon name="chevron" /></button><button onClick={() => navigate("tasks")}><span>Связанные задачи</span><AppIcon name="chevron" /></button></section>
          <footer><button className="primary-action" onClick={createTask}>Создать задачу</button><button className="secondary-action" onClick={() => notify(`История ${selected.id}: изменений пока нет`)}>История изменений</button></footer>
        </Card> : <Card className="ahSystemDetail"><EmptyState className="ahSystemEmpty" density="compact" title="Карточка не выбрана" description="В реестре пока нет записей. Структура раздела готова к работе." /></Card>}
      </div>
    </PageContainer>
  );
}
