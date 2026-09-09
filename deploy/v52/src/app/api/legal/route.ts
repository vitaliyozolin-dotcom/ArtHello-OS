import { assignedActiveBranchScope, requiresAssignedReadScope } from "../../../lib/section-read-scope";
import { canAccessApi } from "../../../lib/access-policy";
import { asc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { organizationBranches, userBranchAccess, entities, legalChecks, legalContracts, legalContractTextVersions, legalDocumentItems, legalResponsibilityZones } from "../../../db/schema";
import { contractUtilization, missingRequired } from "../../../lib/legal";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";

const electronicVersionReaders = new Set(["OWNER", "LEGAL"]);
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return json({ error: "Сервис авторизации временно недоступен" }, 503);
  }
  if (!context) return json({ error: "Требуется вход" }, 401);
  if (!canAccessApi(context.auth.user, "/api/legal", "GET")) return json({ error: "Нет доступа к юридическому контуру" }, 403);
  try {
    await ensureCoreTables();
    const db = getDb();
    let [contracts, documents, electronicVersions, zones, checks, entityRows, allTasks] = await Promise.all([
      db.select().from(legalContracts).orderBy(asc(legalContracts.validUntil)),
      db.select().from(legalDocumentItems).orderBy(asc(legalDocumentItems.stableId)),
      electronicVersionReaders.has(context.apiRole)
        ? db.select({
            id: legalContractTextVersions.id,
            stableId: legalContractTextVersions.stableId,
            contractId: legalContractTextVersions.contractId,
            documentItemId: legalContractTextVersions.documentItemId,
            version: legalContractTextVersions.version,
            bodyText: legalContractTextVersions.bodyText,
            sourceMode: legalContractTextVersions.sourceMode,
            confirmedBy: legalContractTextVersions.confirmedBy,
            confirmedAt: legalContractTextVersions.confirmedAt,
          }).from(legalContractTextVersions).orderBy(asc(legalContractTextVersions.stableId))
        : Promise.resolve([]),
      db.select().from(legalResponsibilityZones),
      db.select().from(legalChecks).orderBy(asc(legalChecks.detectedAt)),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      selectVisibleTasks(db, context),
    ]);
    const scopedRead=requiresAssignedReadScope(context.auth.user,"/api/legal");
    if(scopedRead){
      const [branchRows,grants]=await Promise.all([
        db.select().from(organizationBranches),
        db.select({branchId:userBranchAccess.branchId}).from(userBranchAccess).where(eq(userBranchAccess.userId,context.appUserId)),
      ]);
      const scope=assignedActiveBranchScope(context.auth.user,branchRows,grants);
      // Contract ownership and legal-entity scope cannot be inferred from a responsibility zone.
      zones=zones.filter(row=>scope.allowsBranch(row.scope)).map(row=>({...row,contractId:""}));
      const responsibleIds=new Set(zones.map(row=>row.responsibleEntityId));
      entityRows=entityRows.filter(row=>responsibleIds.has(row.id));
      contracts=[];documents=[];electronicVersions=[];checks=[];allTasks=[];
    }
    const entityNames = Object.fromEntries(entityRows.map((item) => [item.id, item.displayName]));
    const contract = contracts[0];
    const contractDocuments = contract ? documents.filter((item) => item.contractId === contract.id) : [];
    const document = contractDocuments.find((item) => item.id === contract?.referenceDocumentId) ?? contractDocuments[0];
    const appendix = contractDocuments.find((item) => item.itemType.toLocaleLowerCase("ru-RU").includes("прилож"));
    const act = contractDocuments.find((item) => item.itemType.toLocaleLowerCase("ru-RU").includes("акт"));
    const zone = contract ? zones.find((item) => item.contractId === contract.id) : undefined;
    const signal = contract ? checks.find((item) => item.contractId === contract.id) : undefined;

    return json({
      scopeBoundary:scopedRead?"Показаны зоны ответственности разрешённых действующих филиалов. Договоры, тексты и финансовые сведения скрыты: их отдельная область доступа ещё не подтверждена.":"",
      contracts: contracts.map((item) => ({ ...item, utilization: contractUtilization(item.limitMinor, item.spentMinor) })),
      documents,
      electronicVersions,
      zones,
      checks: redactHiddenTaskReferences(checks, allTasks),
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
      boundary: scopedRead ? "Показаны зоны ответственности разрешённых действующих филиалов. Договоры и тексты скрыты до подтверждения их отдельной области доступа." : "Электронная подпись и ЭДО пока не подключены. Показываются только сохранённые договоры, документы и результаты проверок.",
    });
  } catch (error) {
    console.error("Legal data load failed", error);
    return json({ error: error instanceof Error && error.message.includes("D1 binding") ? "Юридическая база ещё не подключена" : "Не удалось загрузить договоры" }, 503);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}
