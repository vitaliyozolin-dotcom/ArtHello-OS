import { asc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { businessEvents, eventParticipants, strategyDeviations, strategyGoals, strategyInitiatives, strategyKpis, strategyProjects, strategyResults } from "../../../db/schema";
import { eventPortfolio, projectBudget } from "../../../lib/strategy";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";

const roles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "PROJECTS", "FINANCE"]);

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!roles.has(context.apiRole)) return Response.json({ error: "Нет доступа к стратегии и проектам" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const [goals, kpis, initiatives, projects, events, participants, results, deviations, allTasks] = await Promise.all([
      db.select().from(strategyGoals),
      db.select().from(strategyKpis),
      db.select().from(strategyInitiatives),
      db.select().from(strategyProjects),
      db.select().from(businessEvents).orderBy(asc(businessEvents.eventAt)),
      db.select().from(eventParticipants),
      db.select().from(strategyResults),
      db.select().from(strategyDeviations),
      selectVisibleTasks(db, context),
    ]);
    const project = projects[0];
    const initiative = (project ? initiatives.find((item) => item.id === project.initiativeId) : undefined) ?? initiatives[0];
    const goal = (project ? goals.find((item) => item.id === project.goalId) : undefined) ?? (initiative ? goals.find((item) => item.id === initiative.goalId) : undefined) ?? goals[0];
    const kpi = (initiative ? kpis.find((item) => item.id === initiative.kpiId) : undefined) ?? (goal ? kpis.find((item) => item.goalId === goal.id) : undefined) ?? kpis[0];
    const result = (project ? results.find((item) => item.projectId === project.id) : undefined) ?? results[0];
    const deviation = (project ? deviations.find((item) => item.projectId === project.id) : undefined) ?? (kpi ? deviations.find((item) => item.kpiId === kpi.id) : undefined) ?? deviations[0];

    return Response.json({
      goals,
      kpis,
      initiatives,
      projects: projects.map((item) => ({ ...item, budget: projectBudget(item.budgetPlanMinor, item.budgetActualMinor) })),
      events,
      participants,
      results,
      deviations: redactHiddenTaskReferences(deviations, allTasks),
      tasks: allTasks.filter((item) => item.sourceType === "Проект" || item.sourceType === "Отклонение KPI"),
      summary: {
        goals: goals.length,
        kpisOnTrack: kpis.filter((item) => item.status === "В норме").length,
        kpisTotal: kpis.length,
        projects: projects.length,
        projectsAtRisk: projects.filter((item) => item.status === "Под риском").length,
        openDeviations: deviations.filter((item) => item.status !== "Закрыто").length,
        ...eventPortfolio(events),
      },
      chain: {
        goalId: goal?.id ?? "",
        kpiId: kpi?.id ?? "",
        initiativeId: initiative?.id ?? "",
        projectId: project?.id ?? "",
        taskKey: project ? `PROJECT:${project.id}:MILESTONE:1` : "",
        budgetId: project?.budgetId ?? "",
        resultId: result?.id ?? "",
        deviationId: deviation?.id ?? "",
        decision: deviation?.decision ?? "",
      },
      boundary: "Цели, KPI, инициативы, проекты, события и результаты показываются только после сохранения или подтверждённого импорта.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "База проектов ещё не подключена" : "Не удалось загрузить стратегию" }, { status: 503 });
  }
}
