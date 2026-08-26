import { asc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { entities, legalChecks, legalContracts, legalDocumentItems, legalResponsibilityZones, tasks } from "../../../db/schema";
import { contractUtilization, missingRequired } from "../../../lib/legal";
import { getRequestUser } from "../../../lib/request-user";

const roles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "LEGAL", "FINANCE"]);

export async function GET(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!roles.has(role)) return Response.json({ error: "Нет доступа к юридическому контуру" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const [contracts, documents, zones, checks, entityRows, allTasks] = await Promise.all([
      db.select().from(legalContracts).orderBy(asc(legalContracts.validUntil)),
      db.select().from(legalDocumentItems).orderBy(asc(legalDocumentItems.stableId)),
      db.select().from(legalResponsibilityZones),
      db.select().from(legalChecks).orderBy(asc(legalChecks.detectedAt)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      db.select().from(tasks),
    ]);
    const entityNames = Object.fromEntries(entityRows.map((item) => [item.id, item.displayName]));
    const contract = contracts[0];
    const contractDocuments = contract ? documents.filter((item) => item.contractId === contract.id) : [];
    const document = contractDocuments.find((item) => item.id === contract?.referenceDocumentId) ?? contractDocuments[0];
    const appendix = contractDocuments.find((item) => item.itemType.toLocaleLowerCase("ru-RU").includes("прилож"));
    const act = contractDocuments.find((item) => item.itemType.toLocaleLowerCase("ru-RU").includes("акт"));
    const zone = contract ? zones.find((item) => item.contractId === contract.id) : undefined;
    const signal = contract ? checks.find((item) => item.contractId === contract.id) : undefined;

    return Response.json({
      contracts: contracts.map((item) => ({ ...item, utilization: contractUtilization(item.limitMinor, item.spentMinor) })),
      documents,
      zones,
      checks,
      entityNames,
      tasks: allTasks.filter((item) => item.sourceType === "Юридический сигнал"),
      summary: {
        contracts: contracts.length,
        unsigned: contracts.filter((item) => item.signedStatus !== "Подписан").length,
        expiring: contracts.filter((item) => item.status === "Истекает").length,
        openSignals: checks.filter((item) => item.status !== "Закрыт").length,
        missingRequired: missingRequired(documents),
      },
      chain: {
        partyId: contract?.partyEntityId ?? "",
        contractId: contract?.id ?? "",
        documentId: document?.id ?? "",
        appendixId: appendix?.id ?? "",
        actId: act?.id ?? "",
        zoneId: zone?.id ?? "",
        signalId: signal?.id ?? "",
      },
      boundary: "Электронная подпись и ЭДО пока не подключены. Показываются только сохранённые договоры, документы и результаты проверок.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "Юридическая база ещё не подключена" : "Не удалось загрузить договоры" }, { status: 503 });
  }
}
