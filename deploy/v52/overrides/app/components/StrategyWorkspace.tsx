"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CompactListCard, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./StrategyWorkspace.ds.css";

type StrategyData = {
  goals: Array<{ id: string; level: string; unitEntityId: string; title: string; period: string; ownerEntityId: string; status: string; successDefinition: string }>;
  kpis: Array<{ id: string; goalId: string; name: string; unit: string; targetValue: number; actualValue: number; forecastValue: number; varianceValue: number; status: string; sourceRef: string; updatedAt: string }>;
  initiatives: Array<{ id: string; goalId: string; kpiId: string; title: string; hypothesis: string; ownerEntityId: string; plannedStart: string; plannedEnd: string; status: string }>;
  projects: Array<{ id: string; initiativeId: string; goalId: string; title: string; ownerEntityId: string; budgetId: string; budgetPlanMinor: number; budgetActualMinor: number; startedAt: string; dueAt: string; status: string; outcome: string; budget: { remainingMinor: number; utilizationPercent: number; status: string } }>;
  events: Array<{ id: string; projectId: string; title: string; eventAt: string; location: string; responsibleEntityId: string; budgetMinor: number; actualMinor: number; status: string; result: string; feedbackScore: number }>;
  participants: Array<{ id: string; eventId: string; participantEntityId: string; participantRole: string; attendanceStatus: string; feedback: string }>;
  results: Array<{ id: string; projectId: string; eventId: string; resultType: string; metricName: string; metricValue: number; unit: string; evidence: string; recordedAt: string }>;
  deviations: Array<{ id: string; kpiId: string; projectId: string; deviationType: string; varianceValue: number; explanation: string; decision: string; status: string; relatedTaskId: number | null; detectedAt: string }>;
  summary: { goals: number; kpisOnTrack: number; kpisTotal: number; projects: number; projectsAtRisk: number; openDeviations: number; past: number; future: number; feedbackAverage: number };
  chain: Record<string, string>;
  boundary: string;
};

const roles: Record<string, string> = {
  "Проекты": "PROJECTS", "Бухгалтерия": "ACCOUNTING", "Медработник": "MEDICAL", "Собственник": "OWNER",
  "Директор": "DIRECTOR", "Представитель Виталия": "REPRESENTATIVE", "Безопасность": "SAFETY", "Финансы": "FINANCE",
  "Кухня": "KITCHEN", "Закупки": "PROCUREMENT", "Юрист": "LEGAL", "HR": "HR", "Продажи": "SALES",
  "Маркетинг": "MARKETING", "Педагог": "TEACHER", "Методист": "METHODIST", "Родитель": "PARENT",
};

const tabs = ["Календарь", "Проекты", "Цели и инициативы", "KPI и прогноз", "Отклонения и решения"] as const;
type StrategyTab = typeof tabs[number];
const rub = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value / 100);

export function StrategyWorkspace({ role, notify, onTasksChanged }: { role: string; notify: (value: string) => void; onTasksChanged: () => void }) {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<StrategyTab>("Календарь");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/strategy", { cache: "no-store", headers: { "x-arthello-role": roles[role] ?? "" } });
      const payload = await response.json() as StrategyData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Нет доступа");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/strategy-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Действие уже существует" : "Стратегическая запись сохранена");
      await load();
      onTasksChanged();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Ошибка");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <section className="ahStrategyStatus">Загружаем стратегию и проекты…</section>;
  if (error || !data) return <section className="ahStrategyStatus"><Card><EmptyState title="Стратегический контур недоступен" description={error || "Для просмотра требуется разрешённая роль."} density="compact" /></Card></section>;

  const hasData = Boolean(data.goals.length || data.kpis.length || data.initiatives.length || data.projects.length || data.events.length || data.deviations.length);
  const boundary = hasData ? data.boundary : "Система не создаёт цели, показатели или результаты автоматически. Каждая запись должна иметь владельца и проверяемый источник.";

  return <PageContainer className="ahStrategyPage">
    <PageHeader
      eyebrow="ЦЕЛИ · ПРОЕКТЫ · РЕШЕНИЯ"
      title="Проекты и стратегия"
      description="Цели, KPI, инициативы, бюджеты, события и результаты — в одной проверяемой управленческой цепочке."
      actions={<Button variant="primary" disabled={busy === "event" || !data.projects.length} onClick={() => void action({ action: "createEvent", projectId: data.projects[0]?.id, title: "Разбор результатов проекта с владельцами" }, "event")}>+ Событие</Button>}
    />

    <Card className="ahStrategyBoundary"><strong>{hasData ? "Рабочая стратегия" : "Рабочая структура"}</strong><span>{boundary}</span></Card>

    <div className="ahStrategyKpis">
      <KpiCard label="Цели" value={data.summary.goals} note="компания + подразделения" onClick={() => setTab("Цели и инициативы")} />
      <KpiCard label="Проекты" value={data.summary.projects} note={`${data.summary.projectsAtRisk} под риском`} onClick={() => setTab("Проекты")} />
      <KpiCard className={data.summary.kpisOnTrack < data.summary.kpisTotal ? "ahStrategyKpiWarning" : undefined} label="KPI в норме" value={`${data.summary.kpisOnTrack}/${data.summary.kpisTotal}`} note="прогноз отделён от факта" onClick={() => setTab("KPI и прогноз")} />
      <KpiCard label="События" value={data.summary.past + data.summary.future} note={`отзыв ${data.summary.feedbackAverage}%`} onClick={() => setTab("Календарь")} />
    </div>

    <div className="ahStrategyTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы стратегии" /></div>

    {tab === "Календарь" ? <StrategyCalendar data={data} busy={busy} record={(eventId) => void action({ action: "recordEventResult", eventId, result: "Событие проведено, результат и обратная связь проверены владельцем", feedbackScore: 84 }, eventId)} /> : null}
    {tab === "Проекты" ? <StrategyProjects data={data} /> : null}
    {tab === "Цели и инициативы" ? <StrategyGoals data={data} /> : null}
    {tab === "KPI и прогноз" ? <StrategyKpis data={data} busy={busy} update={(kpi) => void action({ action: "updateKpiActual", kpiId: kpi.id, actualValue: kpi.actualValue + 1, forecastValue: kpi.forecastValue + 1 }, kpi.id)} /> : null}
    {tab === "Отклонения и решения" ? <StrategyDeviations data={data} busy={busy} createTask={(id) => void action({ action: "createCorrectiveTask", deviationId: id }, id)} close={(id) => void action({ action: "closeDeviation", deviationId: id, evidence: "Результат повторной проверки подтверждён владельцем", decision: "Решение принято после проверки целевого порога" }, `${id}-close`)} /> : null}
  </PageContainer>;
}

function StrategyCalendar({ data, busy, record }: { data: StrategyData; busy: string; record: (eventId: string) => void }) {
  if (!data.events.length) return <Card className="ahStrategyPanel"><EmptyState title="Событий пока нет" description="После создания проекта здесь появятся план, бюджет, участники, факт и обратная связь." density="compact" /></Card>;
  return <div className="ahStrategyCardGrid">{data.events.map((event) => <Card key={event.id} className="ahStrategyPanel">
    <PanelHead eyebrow={`${event.eventAt.slice(5, 10)} · ${event.eventAt.slice(11, 16)}`} title={event.title} note={event.status} />
    <p className="ahStrategyLead">{event.location} · {event.responsibleEntityId}</p>
    <div className="ahStrategyFacts"><span>Бюджет<strong>{rub(event.budgetMinor)}</strong></span><span>Факт<strong>{rub(event.actualMinor)}</strong></span><span>Участники<strong>{data.participants.filter((item) => item.eventId === event.id).length}</strong></span><span>Обратная связь<strong>{event.feedbackScore ? `${event.feedbackScore}%` : "—"}</strong></span></div>
    <footer className="ahStrategyActions">{event.status === "Проведено" ? <span>{event.result}</span> : <Button variant="secondary" disabled={busy === event.id} onClick={() => record(event.id)}>Записать результат</Button>}</footer>
  </Card>)}</div>;
}

function StrategyProjects({ data }: { data: StrategyData }) {
  if (!data.projects.length) return <Card className="ahStrategyPanel"><EmptyState title="Проекты пока не созданы" description="Проект связывается с целью, инициативой, владельцем, бюджетом, сроком и измеримым результатом." density="compact" /></Card>;
  return <div className="ahStrategyProjectGrid">{data.projects.map((project) => <Card key={project.id} className="ahStrategyPanel">
    <PanelHead eyebrow={`${project.id} · ${project.status}`} title={project.title} note={project.dueAt} />
    <p className="ahStrategyLead">{project.outcome || "Результат появится после контрольного события"}</p>
    <div className="ahStrategyProgress"><header><span>Использование бюджета</span><strong>{project.budget.utilizationPercent}%</strong></header><i><b style={{ width: `${Math.min(100, project.budget.utilizationPercent)}%` }} /></i><footer><span>{rub(project.budgetActualMinor)} факт</span><span>{rub(project.budget.remainingMinor)} остаток</span></footer></div>
    <div className="ahStrategyCompactList">{[["Инициатива", project.initiativeId], ["Бюджетная строка", project.budgetId], ["Владелец", project.ownerEntityId], ["Период", `${project.startedAt}—${project.dueAt}`]].map(([title, description], index) => <CompactListCard key={title} index={String(index + 1).padStart(2, "0")} title={title} description={description || "не задано"} />)}</div>
  </Card>)}</div>;
}

function StrategyGoals({ data }: { data: StrategyData }) {
  if (!data.goals.length) return <Card className="ahStrategyPanel"><EmptyState title="Целей и инициатив пока нет" description="Начните с результата, периода, владельца и измеримого критерия успеха." density="compact" /></Card>;
  return <div className="ahStrategyCardGrid">{data.goals.map((goal) => <Card key={goal.id} className="ahStrategyPanel">
    <PanelHead eyebrow={`${goal.level} · ${goal.period}`} title={goal.title} note={goal.status} />
    <p className="ahStrategyLead">{goal.successDefinition}</p>
    <div className="ahStrategyCompactList">{data.initiatives.filter((item) => item.goalId === goal.id).map((initiative, index) => <CompactListCard key={initiative.id} index={String(index + 1).padStart(2, "0")} title={initiative.title} description={`${initiative.hypothesis} · ${initiative.ownerEntityId} · ${initiative.plannedStart}—${initiative.plannedEnd}`} />)}</div>
  </Card>)}</div>;
}

function StrategyKpis({ data, busy, update }: { data: StrategyData; busy: string; update: (kpi: StrategyData["kpis"][number]) => void }) {
  if (!data.kpis.length) return <Card className="ahStrategyPanel"><EmptyState title="KPI пока не определены" description="Цель, факт, прогноз и отклонение должны иметь формулу и рабочий источник." density="compact" /></Card>;
  return <div className="ahStrategyCardGrid">{data.kpis.map((kpi) => <Card key={kpi.id} className="ahStrategyPanel">
    <PanelHead eyebrow={kpi.id} title={kpi.name} note={kpi.status} />
    <div className="ahStrategyFacts"><span>Цель<strong>{kpi.targetValue}{kpi.unit}</strong></span><span>Факт<strong>{kpi.actualValue}{kpi.unit}</strong></span><span>Прогноз<strong>{kpi.forecastValue}{kpi.unit}</strong></span><span className={kpi.varianceValue < 0 ? "negative" : "positive"}>Отклонение<strong>{kpi.varianceValue}{kpi.unit}</strong></span></div>
    <p className="ahStrategySource">Источник: {kpi.sourceRef || "не задан"}</p>
    <Button variant="secondary" disabled={busy === kpi.id} onClick={() => update(kpi)}>+1 к факту после проверки</Button>
  </Card>)}</div>;
}

function StrategyDeviations({ data, busy, createTask, close }: { data: StrategyData; busy: string; createTask: (id: string) => void; close: (id: string) => void }) {
  if (!data.deviations.length) return <Card className="ahStrategyPanel"><EmptyState title="Отклонений и решений пока нет" description="Корректирующее действие появляется только после фактического отклонения и объяснения." density="compact" /></Card>;
  return <div className="ahStrategyCardGrid">{data.deviations.map((deviation) => <Card key={deviation.id} className="ahStrategyPanel">
    <PanelHead eyebrow={`${deviation.kpiId} · ${deviation.deviationType}`} title={`${deviation.varianceValue} п.п.`} note={deviation.status} />
    <p className="ahStrategyLead">{deviation.explanation}</p>
    <CompactListCard title="Решение" description={deviation.decision || "не принято"} />
    <footer className="ahStrategyActions">{deviation.relatedTaskId ? <span>TSK-{deviation.relatedTaskId}</span> : <Button variant="secondary" disabled={busy === deviation.id} onClick={() => createTask(deviation.id)}>Создать действие</Button>}<Button variant="secondary" disabled={busy === `${deviation.id}-close` || deviation.status === "Закрыто"} onClick={() => close(deviation.id)}>Закрыть решением</Button></footer>
  </Card>)}</div>;
}

function PanelHead({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return <header className="ahStrategyPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{note}</span></header>;
}
