import { canAccessApi } from "../../../lib/access-policy";
import { asc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { entities, financialOperations, organizationBranches, userBranchAccess, safetyChecks, safetyEquipment, safetyFaults, safetyGuardShifts, safetyIncidents, safetyNextChecks, safetyRepairs, safetySystems } from "../../../db/schema";
import { canPaySafetyRepair, faultSla, safetyReadiness } from "../../../lib/safety";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";
import { redactHiddenTaskReferences, selectVisibleTasks } from "../../../lib/task-access-query";
import { assignedActiveBranchScope, requiresAssignedReadScope } from "../../../lib/section-read-scope";
import { filterAssignedSafetyRows } from "../../../lib/safety-read-scope";


export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!canAccessApi(context.auth.user, "/api/safety", "GET")) return Response.json({ error: "Нет доступа к контуру безопасности" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const assignedRead = requiresAssignedReadScope(context.auth.user, "/api/safety");
    const branchRows = assignedRead ? await db.select().from(organizationBranches) : [];
    const branchGrants = assignedRead ? await db.select({ branchId: userBranchAccess.branchId }).from(userBranchAccess)
      .where(eq(userBranchAccess.userId, context.appUserId)) : [];
    const scope = assignedRead ? assignedActiveBranchScope(context.auth.user, branchRows, branchGrants) : null;
    const [allSystems, allEquipment, allChecks, allFaults, allIncidents, allRepairs, allNextChecks, allGuardShifts, allEntityRows, allOperations, visibleTasks] = await Promise.all([
      db.select().from(safetySystems),
      db.select().from(safetyEquipment).orderBy(asc(safetyEquipment.nextCheckAt)),
      db.select().from(safetyChecks).orderBy(asc(safetyChecks.scheduledAt)),
      db.select().from(safetyFaults),
      db.select().from(safetyIncidents),
      db.select().from(safetyRepairs),
      db.select().from(safetyNextChecks).orderBy(asc(safetyNextChecks.scheduledAt)),
      db.select().from(safetyGuardShifts),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      assignedRead ? Promise.resolve([]) : db.select().from(financialOperations),
      selectVisibleTasks(db, context),
    ]);
    const { systems, equipment, checks, faults, incidents, repairs, nextChecks, guardShifts, entityRows, operations, allTasks } = filterAssignedSafetyRows(scope?.branchIds ?? null, {
      systems: allSystems, equipment: allEquipment, checks: allChecks, faults: allFaults, incidents: allIncidents,
      repairs: allRepairs, nextChecks: allNextChecks, guardShifts: allGuardShifts, entityRows: allEntityRows,
      operations: allOperations, allTasks: visibleTasks,
    });
    const now = new Date().toISOString();
    const repair = repairs[0];
    const fault = (repair ? faults.find((item) => item.id === repair.faultId) : undefined) ?? faults[0];
    const check = (fault ? checks.find((item) => item.id === fault.checkId) : undefined) ?? checks[0];
    const equipmentItem = (fault ? equipment.find((item) => item.id === fault.equipmentId) : undefined) ?? equipment[0];
    const system = (equipmentItem ? systems.find((item) => item.id === equipmentItem.systemId) : undefined) ?? systems[0];
    const nextCheck = repair ? nextChecks.find((item) => item.sourceRepairId === repair.id) : nextChecks[0];
    const payment = repair?.paymentOperationId ? operations.find((item) => item.id === repair.paymentOperationId) : undefined;
    const linkedPaymentIds = new Set(repairs.map((item) => item.paymentOperationId).filter(Boolean));

    return Response.json({
      systems,
      equipment,
      checks,
      faults: redactHiddenTaskReferences(faults, allTasks).map((item) => ({ ...item, sla: faultSla(item.severity, item.detectedAt, now, item.status) })),
      incidents,
      repairs: repairs.map((item) => ({ ...item, payable: canPaySafetyRepair(item) })),
      nextChecks,
      guardShifts,
      entityNames: Object.fromEntries(entityRows.map((item) => [item.id, item.displayName])),
      payments: operations.filter((item) => linkedPaymentIds.has(item.id)),
      tasks: allTasks.filter((item) => item.sourceType === "Неисправность безопасности"),
      summary: {
        ...safetyReadiness(checks, faults),
        systems: systems.length,
        equipment: equipment.length,
        criticalEquipment: equipment.filter((item) => item.criticality === "Высокая").length,
        actsMissing: repairs.filter((item) => item.status === "Завершён" && !item.actDocumentId).length,
      },
      chain: {
        equipmentId: equipmentItem?.id ?? "",
        objectId: check?.objectEntityId ?? system?.objectEntityId ?? "",
        checkId: check?.id ?? "",
        faultId: fault?.id ?? "",
        taskKey: fault ? `SAFETY_FAULT:${fault.id}` : "",
        contractorId: repair?.contractorId ?? equipmentItem?.contractorId ?? "",
        repairId: repair?.id ?? "",
        actId: repair?.actDocumentId ?? "",
        paymentId: payment?.id ?? "",
        nextCheckId: nextCheck?.id ?? "",
      },
      boundary: "СКУД, камеры и датчики подключаются отдельно. Раздел показывает только сохранённые системы, проверки, инциденты, ремонты и связанные операции.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "База безопасности ещё не подключена" : "Не удалось загрузить безопасность" }, { status: 503 });
  }
}
