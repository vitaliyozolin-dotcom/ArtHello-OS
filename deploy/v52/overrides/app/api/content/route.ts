import { asc, desc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { contentAttributions, contentPlanItems, contentPublications, contentRecommendations, entities, financialOperations, marketingAccounts, salesLeads } from "../../../db/schema";
import { contentSummary, evidenceBasedRanking, publicationRates } from "../../../lib/content";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  const actor = getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const [accounts, plan, publications, attributions, recommendations, entityRows, leads, operations] = await Promise.all([
      db.select().from(marketingAccounts).orderBy(asc(marketingAccounts.platform)),
      db.select().from(contentPlanItems).orderBy(asc(contentPlanItems.scheduledAt)),
      db.select().from(contentPublications).orderBy(desc(contentPublications.publishedAt)),
      db.select().from(contentAttributions).orderBy(desc(contentAttributions.createdAt)),
      db.select().from(contentRecommendations).orderBy(asc(contentRecommendations.status), asc(contentRecommendations.id)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      db.select().from(salesLeads),
      db.select().from(financialOperations),
    ]);
    const entityNames = Object.fromEntries(entityRows.map((row) => [row.id, row.displayName]));
    const enriched = publications.map((publication) => {
      const planItem = plan.find((item) => item.id === publication.planItemId);
      const account = accounts.find((item) => item.id === planItem?.accountId);
      return { ...publication, planItem, account, rates: publicationRates(publication) };
    });
    const ranked = evidenceBasedRanking(enriched);
    return Response.json({
      accounts, plan, publications: ranked, attributions, recommendations, entityNames,
      summary: contentSummary(publications),
      chain: attributions.map((row) => ({
        ...row,
        publication: publications.find((item) => item.id === row.publicationId),
        planItem: plan.find((item) => item.id === publications.find((publication) => publication.id === row.publicationId)?.planItemId),
        lead: leads.find((item) => item.id === row.leadId),
        payment: operations.find((item) => item.id === row.paymentOperationId),
      })),
      sourcePolicy: {
        status: accounts.length || plan.length || publications.length ? "STORED" : "EMPTY",
        note: accounts.length || plan.length || publications.length
          ? "Показаны сохранённые каналы, публикации и доступные подтверждённые метрики."
          : "API социальных сетей ещё не подключены. Добавьте канал или подключите источник данных.",
        ranking: "Контент ранжируется по выручке, договорам, заявкам и переходам — не только по охвату.",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка контент-модуля";
    return Response.json({ error: message.includes("D1 binding") ? "База контента ещё не подключена" : "Не удалось загрузить контент и маркетинг" }, { status: 503 });
  }
}
