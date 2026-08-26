import { asc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { entities, financialOperations, safetyChecks, safetyEquipment, safetyFaults, safetyGuardShifts, safetyIncidents, safetyNextChecks, safetyRepairs, safetySystems, tasks } from "../../../db/schema";
import { canPaySafetyRepair, faultSla, safetyReadiness } from "../../../lib/safety";
import { getRequestUser } from "../../../lib/request-user";

const roles = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "SAFETY", "FINANCE"]);

export async function GET(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const role = request.headers.get("x-arthello-role") ?? "";
  if (!roles.has(role)) return Response.json({ error: "Нет доступа к контуру безопасности" }, { status: 403 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const [systems, equipment, checks, faults, incidents, repairs, nextChecks, guardShifts, entityRows, operations, allTasks] = await Promise.all([
      db.select().from(safetySystems),
      db.select().from(safetyEquipment).orderBy(asc(safetyEquipment.nextCheckAt)),
      db.select().from(safetyChecks).orderBy(asc(safetyChecks.scheduledAt)),
      db.select().from(safetyFaults),
      db.select().from(safetyIncidents),
      db.select().from(safetyRepairs),
      db.select().from(safetyNextChecks).orderBy(asc(safetyNextChecks.scheduledAt)),
      db.select().from(safetyGuardShifts),
      db.select({ id: entities.id, displayName: entities.displayName }).from(entities),
      db.select().from(financialOperations),
      db.select().from(tasks),
    ]);
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
      faults: faults.map((item) => ({ ...item, sla: faultSla(item.severity, item.detectedAt, now, item.status) })),
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
