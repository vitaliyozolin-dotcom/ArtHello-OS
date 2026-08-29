"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CompactListCard,
  EmptyState,
  KpiCard,
  PageContainer,
  PageHeader,
  Tabs,
} from "./design-system";
import "./StrategyWorkspace.ds.css";

type Data = {
  goals: Array<{
    id: string;
    level: string;
    unitEntityId: string;
    title: string;
    period: string;
    ownerEntityId: string;
    status: string;
    successDefinition: string;
  }>;
  kpis: Array<{
    id: string;
    goalId: string;
    name: string;
    unit: string;
    targetValue: number;
    actualValue: number;
    forecastValue: number;
    varianceValue: number;
    status: string;
    sourceRef: string;
    updatedAt: string;
  }>;
  initiatives: Array<{
    id: string;
    goalId: string;
    kpiId: string;
    title: string;
    hypothesis: string;
    ownerEntityId: string;
    plannedStart: string;
    plannedEnd: string;
    status: string;
  }>;
  projects: Array<{
    id: string;
    initiativeId: string;
    goalId: string;
    title: string;
    ownerEntityId: string;
    budgetId: string;
    budgetPlanMinor: number;
    budgetActualMinor: number;
    startedAt: string;
    dueAt: string;
    status: string;
    outcome: string;
    budget: { remainingMinor: number; utilizationPercent: number; status: string };
  }>;
  events: Array<{
    id: string;
    projectId: string;
    title: string;
    eventAt: string;
    location: string;
    responsibleEntityId: string;
    budgetMinor: number;
    actualMinor: number;
    status: string;
    result: string;
    feedbackScore: number;
  }>;
  participants: Array<{
    id: string;
    eventId: string;
    participantEntityId: string;
    participantRole: string;
    attendanceStatus: string;
    feedback: string;
  }>;
  results: Array<{
    id: string;
    projectId: string;
    eventId: string;
    resultType: string;
    metricName: string;
    metricValue: number;
    unit: string;
    evidence: string;
    recordedAt: string;
  }>;
  deviations: Array<{
    id: string;
    kpiId: string;
    projectId: string;
    deviationType: string;
    varianceValue: number;
    explanation: string;
    decision: string;
    status: string;
    relatedTaskId: number | null;
    detectedAt: string;
  }>;
  summary: {
    goals: number;
    kpisOnTrack: number;
    kpisTotal: number;
    projects: number;
    projectsAtRisk: number;
    openDeviations: number;
    past: number;
    future: number;
    feedbackAverage: number;
  };
  chain: Record<string, string>;
  boundary: string;
};

const roles: Record<string, string> = {
  Проекты: "PROJECTS",
  Бухгалтерия: "ACCOUNTING",
  Медработник: "MEDICAL",
  Собственник: "OWNER",
  Директор: "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
  Безопасность: "SAFETY",
  Финансы: "FINANCE",
  Кухня: "KITCHEN",
  Закупки: "PROCUREMENT",
  Юрист: "LEGAL",
  HR: "HR",
  Продажи: "SALES",
  Маркетинг: "MARKETING",
  Педагог: "TEACHER",
  Методист: "METHODIST",
  Родитель: "PARENT",
};

const tabs = ["Календарь", "Проекты", "Цели и инициативы", "KPI и прогноз", "Отклонения и решения"] as const;
type Tab = (typeof tabs)[number];

const rub = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value / 100);

export function StrategyWorkspace({
  role,
  notify,
  onTasksChanged,
}: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Календарь");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/strategy", {
        cache: "no-store",
        headers: { "x-arthello-role": roles[role] ?? "" },
      });
      const payload = (await response.json()) as Data & { error?: string };
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
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/strategy-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string; reused?: boolean };
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
  if (error || !data) {
    return (
      <PageContainer className="ahStrategyDenied">
        <Card>
          <EmptyState
            title="Контур стратегии недоступен"
            description={error || "Доступ разрешён руководителям, Представителю, роли проектов и финансам."}
            density="compact"
          />
        </Card>
      </PageContainer>
    );
  }

  const firstProject = data.projects[0];
  const hasStrategyData = Boolean(
    data.goals.length ||
      data.kpis.length ||
      data.initiatives.length ||
      data.projects.length ||
      data.events.length ||
      data.deviations.length,
  );

  return (
    <PageContainer className="ahStrategyPage">
      <PageHeader
        eyebrow="СТРАТЕГИЯ · ПРОЕКТЫ · РЕШЕНИЯ"
        title="Проекты и стратегия"
        description="Цели, KPI, инициативы, задачи, бюджеты, события и результаты в одной управленческой цепочке."
        actions={
          <Button
            disabled={!firstProject || busy === "event"}
            onClick={() =>
              void action(
                {
                  action: "createEvent",
                  projectId: firstProject.id,
                  title: `Контрольная встреча: ${firstProject.title}`,
                  eventAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  location: "Не указано",
                  budgetMinor: 0,
                },
                "event",
              )
            }
          >
            + Событие
          </Button>
        }
      />

      <div className="ahStrategyBoundary">
        <strong>{hasStrategyData ? "РАБОЧАЯ СТРАТЕГИЯ" : "РАБОЧАЯ СТРУКТУРА"}</strong>
        <span>
          {hasStrategyData
            ? data.boundary
            : "Система не создаёт цели, показатели или результаты автоматически. Все значения должны иметь владельца и источник."}
        </span>
      </div>

      <div className="ahStrategyKpis">
        <KpiCard label="Цели" value={data.summary.goals} note="компания + подразделение" onClick={() => setTab("Цели и инициативы")} />
        <KpiCard label="Проекты" value={data.summary.projects} note={`${data.summary.projectsAtRisk} под риском`} onClick={() => setTab("Проекты")} />
        <KpiCard className="ahStrategyKpiWarning" label="KPI в норме" value={`${data.summary.kpisOnTrack}/${data.summary.kpisTotal}`} note="прогноз отделён от факта" onClick={() => setTab("KPI и прогноз")} />
        <KpiCard label="События" value={`${data.summary.past}+${data.summary.future}`} note={`отзыв ${data.summary.feedbackAverage}%`} onClick={() => setTab("Календарь")} />
      </div>

      <div className="ahStrategyTabs">
        <Tabs
          items={tabs.map((item) => ({ id: item, label: item }))}
          value={tab}
          onChange={setTab}
          ariaLabel="Разделы стратегии и проектов"
        />
      </div>

      {tab === "Календарь" ? <Calendar data={data} busy={busy} action={action} /> : null}
      {tab === "Проекты" ? <Projects data={data} /> : null}
      {tab === "Цели и инициативы" ? <Goals data={data} /> : null}
      {tab === "KPI и прогноз" ? <KpiBoard data={data} busy={busy} action={action} /> : null}
      {tab === "Отклонения и решения" ? <Deviations data={data} busy={busy} action={action} /> : null}
    </PageContainer>
  );
}

function Calendar({ data, busy, action }: { data: Data; busy: string; action: (body: Record<string, unknown>, key: string) => Promise<void> }) {
  if (!data.events.length) {
    return (
      <Card className="ahStrategyPanel">
        <EmptyState
          title="Событий пока нет"
          description="После создания проекта здесь появятся план, бюджет, участники, факт и обратная связь."
          density="compact"
        />
      </Card>
    );
  }
  return (
    <div className="ahStrategyEventGrid">
      {data.events.map((event) => (
        <Card key={event.id} className="ahStrategyEvent">
          <header>
            <time>
              {event.eventAt.slice(5, 10)}
              <small>{event.eventAt.slice(11, 16)}</small>
            </time>
            <span>{event.status}</span>
          </header>
          <h2>{event.title}</h2>
          <p>{event.location} · {event.responsibleEntityId}</p>
          <dl>
            <div><dt>Бюджет</dt><dd>{rub(event.budgetMinor)}</dd></div>
            <div><dt>Факт</dt><dd>{rub(event.actualMinor)}</dd></div>
            <div><dt>Участники</dt><dd>{data.participants.filter((participant) => participant.eventId === event.id).length}</dd></div>
            <div><dt>Обратная связь</dt><dd>{event.feedbackScore ? `${event.feedbackScore}%` : "—"}</dd></div>
          </dl>
          <footer>
            {event.status === "Проведено" ? (
              <span>{event.result}</span>
            ) : (
              <Button
                variant="secondary"
                disabled={busy === event.id}
                onClick={() =>
                  void action(
                    {
                      action: "recordEventResult",
                      eventId: event.id,
                      result: "Результат события зафиксирован ответственным",
                      feedbackScore: event.feedbackScore,
                    },
                    event.id,
                  )
                }
              >
                Записать результат
              </Button>
            )}
          </footer>
        </Card>
      ))}
    </div>
  );
}

function Projects({ data }: { data: Data }) {
  if (!data.projects.length) {
    return <Card className="ahStrategyPanel"><EmptyState title="Проекты пока не созданы" description="Проект связывается с целью, инициативой, владельцем, бюджетом, сроком и измеримым результатом." density="compact" /></Card>;
  }
  return (
    <div className="ahStrategyProjectGrid">
      {data.projects.map((project) => (
        <Card key={project.id} className="ahStrategyProject">
          <PanelHead eyebrow={`${project.id} · ${project.status}`} title={project.title} note={project.dueAt} />
          <p>{project.outcome || "Результат появится после контрольного события"}</p>
          <div className="ahStrategyBudget">
            <header><span>Бюджет</span><strong>{project.budget.utilizationPercent}%</strong></header>
            <i><b style={{ width: `${Math.min(100, project.budget.utilizationPercent)}%` }} /></i>
            <footer><span>{rub(project.budgetActualMinor)} факт</span><span>{rub(project.budget.remainingMinor)} остаток</span></footer>
          </div>
          <dl>
            <div><dt>Инициатива</dt><dd>{project.initiativeId}</dd></div>
            <div><dt>Бюджетная строка</dt><dd>{project.budgetId}</dd></div>
            <div><dt>Владелец</dt><dd>{project.ownerEntityId}</dd></div>
            <div><dt>Период</dt><dd>{project.startedAt}—{project.dueAt}</dd></div>
          </dl>
        </Card>
      ))}
    </div>
  );
}

function Goals({ data }: { data: Data }) {
  if (!data.goals.length) {
    return <Card className="ahStrategyPanel"><EmptyState title="Целей и инициатив пока нет" description="Начните с определения результата, периода, владельца и критерия успеха." density="compact" /></Card>;
  }
  return (
    <div className="ahStrategyGoalGrid">
      {data.goals.map((goal) => (
        <Card key={goal.id} className="ahStrategyGoal">
          <PanelHead eyebrow={`${goal.level} · ${goal.period}`} title={goal.title} note={goal.status} />
          <p>{goal.successDefinition}</p>
          <div className="ahStrategyInitiatives">
            {data.initiatives.filter((initiative) => initiative.goalId === goal.id).map((initiative, index) => (
              <CompactListCard
                key={initiative.id}
                index={String(index + 1).padStart(2, "0")}
                title={initiative.title}
                description={`${initiative.hypothesis} · ${initiative.ownerEntityId} · ${initiative.plannedStart}—${initiative.plannedEnd}`}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function KpiBoard({ data, busy, action }: { data: Data; busy: string; action: (body: Record<string, unknown>, key: string) => Promise<void> }) {
  if (!data.kpis.length) {
    return <Card className="ahStrategyPanel"><EmptyState title="KPI пока не определены" description="Цель, факт, прогноз и отклонение должны иметь формулу и рабочий источник." density="compact" /></Card>;
  }
  return (
    <div className="ahStrategyMetricGrid">
      {data.kpis.map((kpi) => (
        <Card key={kpi.id} className="ahStrategyMetric">
          <header><span>{kpi.id}</span><em>{kpi.status}</em></header>
          <h2>{kpi.name}</h2>
          <div className="ahStrategyMetricValues">
            <span><small>Цель</small><strong>{kpi.targetValue}{kpi.unit}</strong></span>
            <span><small>Факт</small><strong>{kpi.actualValue}{kpi.unit}</strong></span>
            <span><small>Прогноз</small><strong>{kpi.forecastValue}{kpi.unit}</strong></span>
            <span className={kpi.varianceValue < 0 ? "ahStrategyNegative" : "ahStrategyPositive"}><small>Отклонение</small><strong>{kpi.varianceValue}{kpi.unit}</strong></span>
          </div>
          <p>Источник: {kpi.sourceRef}</p>
          <Button variant="secondary" disabled={busy === kpi.id} onClick={() => void action({ action: "updateKpiActual", kpiId: kpi.id, actualValue: kpi.actualValue + 1, forecastValue: kpi.forecastValue + 1 }, kpi.id)}>
            +1 к факту после проверки
          </Button>
        </Card>
      ))}
    </div>
  );
}

function Deviations({ data, busy, action }: { data: Data; busy: string; action: (body: Record<string, unknown>, key: string) => Promise<void> }) {
  if (!data.deviations.length) {
    return <Card className="ahStrategyPanel"><EmptyState title="Отклонений и решений пока нет" description="Корректирующее действие появляется только после фактического отклонения и объяснения." density="compact" /></Card>;
  }
  return (
    <div className="ahStrategyDeviationGrid">
      {data.deviations.map((deviation) => (
        <Card key={deviation.id} className="ahStrategyDeviation">
          <PanelHead eyebrow={`${deviation.kpiId} · ${deviation.deviationType}`} title={`${deviation.varianceValue} п.п.`} note={deviation.status} />
          <p>{deviation.explanation}</p>
          <div className="ahStrategyDecision"><small>Решение</small><strong>{deviation.decision}</strong></div>
          <footer>
            {deviation.relatedTaskId ? (
              <span>TSK-{deviation.relatedTaskId}</span>
            ) : (
              <Button variant="secondary" disabled={busy === deviation.id} onClick={() => void action({ action: "createCorrectiveTask", deviationId: deviation.id }, deviation.id)}>
                Создать действие
              </Button>
            )}
            <Button
              disabled={busy === `${deviation.id}-close` || deviation.status === "Закрыто"}
              onClick={() =>
                void action(
                  {
                    action: "closeDeviation",
                    deviationId: deviation.id,
                    evidence: "Результат контрольного события проверен",
                    decision: deviation.decision || "Решение подтверждено владельцем показателя",
                  },
                  `${deviation.id}-close`,
                )
              }
            >
              Закрыть решением
            </Button>
          </footer>
        </Card>
      ))}
    </div>
  );
}

function PanelHead({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return (
    <header className="ahStrategyPanelHead">
      <div><p>{eyebrow}</p><h2>{title}</h2></div>
      <span>{note}</span>
    </header>
  );
}
