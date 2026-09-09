import { asc, desc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import {
  clientAccruals,
  clientBonuses,
  clientLifecycles,
  entities,
  financialOperations,
  salesLeads,
  salesStageEvents,
  salesTouchpoints,
} from "../../../db/schema";
import { buildFunnel, buildLtvPlan, riskExplanation, scoreCampaigns } from "../../../lib/sales";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const [leads, touchpoints, stageEvents, lifecycles, accruals, bonuses, entityRows, operations] = await Promise.all([
      db.select().from(salesLeads).orderBy(desc(salesLeads.createdAt), asc(salesLeads.id)),
      db.select().from(salesTouchpoints).orderBy(asc(salesTouchpoints.occurredAt)),
      db.select().from(salesStageEvents).orderBy(asc(salesStageEvents.occurredAt)),
      db.select().from(clientLifecycles).orderBy(desc(clientLifecycles.churnRiskScore)),
      db.select().from(clientAccruals).orderBy(desc(clientAccruals.period)),
      db.select().from(clientBonuses).orderBy(desc(clientBonuses.occurredAt)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate)),
    ]);
    const entityNames = Object.fromEntries(entityRows.map((entity) => [entity.id, entity.displayName]));
    const revenueByLead = Object.fromEntries(lifecycles.map((row) => [row.leadId, row.paymentOperationId
      ? operations.find((operation) => operation.id === row.paymentOperationId)?.amountMinor ?? 0
      : 0]));
    const campaigns = scoreCampaigns(leads, revenueByLead, (lead) => lead.id);
    const activeLeads = leads.filter((lead) => lead.status === "Активен");
    const paidLeads = leads.filter((lead) => lead.stage === "Платёж").length;
    const highRisk = lifecycles.filter((row) => row.churnRiskBand === "Высокий").length;
    const nextPaymentsMinor = lifecycles.reduce((sum, row) => sum + row.nextPaymentMinor, 0);
    const revenueMinor = Object.values(revenueByLead).reduce((sum, value) => sum + Number(value), 0);
    const ltvPlan = buildLtvPlan(lifecycles);

    return Response.json({
      leads: leads.map((lead) => ({ ...lead, tags: parseArray(lead.tags) })),
      touchpoints,
      stageEvents,
      lifecycles: lifecycles.map((row) => ({ ...row, risk: riskExplanation(row.churnRiskScore, parseArray(row.churnRiskFactors)) })),
      accruals,
      bonuses,
      operations: operations.filter((operation) => lifecycles.some((row) => row.paymentOperationId === operation.id)),
      entityNames,
      funnel: buildFunnel(leads),
      campaigns,
      ltvPlan,
      summary: {
        leads: leads.length,
        activeLeads: activeLeads.length,
        paidLeads,
        leadToPaymentPercent: leads.length ? Math.round((paidLeads / leads.length) * 100) : 0,
        revenueMinor,
        nextPaymentsMinor,
        highRisk,
        families: lifecycles.length,
      },
      sourcePolicy: {
        mode: leads.length ? "STORED" : "EMPTY",
        note: leads.length ? "Показаны сохранённые лиды и их подтверждённые связи." : "CRM, телефония, формы и рекламные кабинеты ещё не подключены.",
        financeLink: lifecycles.some((row) => row.paymentOperationId) ? "Платёж взят из связанной финансовой операции." : "Связанной финансовой операции пока нет.",
      },
      acceptanceChainLeadId: lifecycles.find((row) => row.paymentOperationId)?.leadId ?? leads[0]?.id ?? "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка контура продаж";
    return Response.json({ error: message.includes("D1 binding") ? "База продаж ещё не подключена" : "Не удалось загрузить продажи и клиентов" }, { status: 503 });
  }
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
