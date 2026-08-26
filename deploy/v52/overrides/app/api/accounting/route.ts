import { desc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { accountingCompletenessChecks, accountingDocumentLinks, accountingDocuments, accountingExports, accountingIntegrations, entities, financialOperations, tasks } from "../../../db/schema";
import { filterAccountingCounterparties } from "../../../lib/accounting";
import { getRequestUser } from "../../../lib/request-user";

const roles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "ACCOUNTING", "FINANCE", "LEGAL"]);

export async function GET(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!roles.has(role)) return Response.json({ error: "Нет доступа к бухгалтерскому контуру" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const [documents, links, checks, exportsList, integrations, entityRows, operations, allTasks] = await Promise.all([
      db.select().from(accountingDocuments).orderBy(desc(accountingDocuments.documentDate)),
      db.select().from(accountingDocumentLinks),
      db.select().from(accountingCompletenessChecks),
      db.select().from(accountingExports).orderBy(desc(accountingExports.createdAt)),
      db.select().from(accountingIntegrations),
      db.select({ id: entities.id, displayName: entities.displayName, entityType: entities.entityType }).from(entities),
      db.select().from(financialOperations),
      db.select().from(tasks),
    ]);
    const anchor = documents.find((item) => item.paymentOperationId) ?? documents[0];
    const related = anchor?.contractId ? documents.filter((item) => item.contractId === anchor.contractId) : anchor ? [anchor] : [];
    const invoice = related.find((item) => item.documentType.toLocaleLowerCase("ru-RU").includes("сч"));
    const act = related.find((item) => item.documentType.toLocaleLowerCase("ru-RU").includes("акт"));
    const payment = anchor?.paymentOperationId ? operations.find((item) => item.id === anchor.paymentOperationId) : undefined;

    return Response.json({
      documents,
      links,
      checks: checks.map((item) => ({ ...item, requiredTypes: parseArray(item.requiredTypes), missingTypes: parseArray(item.missingTypes) })),
      exports: exportsList,
      integrations,
      entityNames: Object.fromEntries(entityRows.map((item) => [item.id, item.displayName])),
      counterparties: filterAccountingCounterparties(entityRows),
      operations: Object.fromEntries(operations.map((item) => [item.id, { amountMinor: item.amountMinor, counterpartyEntityId: item.counterpartyEntityId, operationDate: item.operationDate, sourceSystem: item.sourceSystem }])),
      tasks: allTasks.filter((item) => item.sourceType === "Комплектность первички"),
      summary: {
        documents: documents.length,
        linked: documents.filter((item) => item.paymentOperationId).length,
        unsigned: documents.filter((item) => item.signatureStatus === "На проверке").length,
        incomplete: checks.filter((item) => item.status !== "Комплектно").length,
        totalMinor: documents.reduce((sum, item) => sum + item.amountMinor, 0),
      },
      chain: {
        invoiceId: invoice?.id ?? "",
        actId: act?.id ?? "",
        contractId: anchor?.contractId ?? "",
        paymentId: payment?.id ?? "",
        exportId: exportsList[0]?.id ?? "",
      },
      boundary: "ЭДО и 1С пока не подключены. Показываются только сохранённые первичные документы, проверки и связанные финансовые операции.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "База первички ещё не подключена" : "Не удалось загрузить первичные документы" }, { status: 503 });
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
