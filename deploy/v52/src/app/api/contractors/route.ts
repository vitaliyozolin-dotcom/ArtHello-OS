import { asc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { entities, financialOperations } from "../../../db/schema";
import { buildContractorRegister } from "../../../lib/contractors";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    const db = getDb();
    const [payments, entityRows] = await Promise.all([
      db.select({
        counterpartyEntityId: financialOperations.counterpartyEntityId,
        amountMinor: financialOperations.amountMinor,
        operationDate: financialOperations.operationDate,
        category: financialOperations.category,
        contractId: financialOperations.contractId,
        documentId: financialOperations.documentId,
        sourceSystem: financialOperations.sourceSystem,
      }).from(financialOperations)
        .where(eq(financialOperations.direction, "Списание"))
        .orderBy(asc(financialOperations.operationDate)),
      db.select({ id: entities.id, displayName: entities.displayName, dataQuality: entities.dataQuality })
        .from(entities),
    ]);
    const names = Object.fromEntries(entityRows.map((row) => [row.id, row]));
    const contractors = buildContractorRegister(payments.filter((row) => !row.sourceSystem.startsWith("SYNTHETIC")))
      .map((row) => ({
        ...row,
        displayName: names[row.id]?.displayName ?? row.id,
        dataQuality: names[row.id]?.dataQuality ?? "Требует разнесения",
      }));
    return Response.json({
      contractors,
      summary: {
        contractors: contractors.length,
        payments: contractors.reduce((sum, row) => sum + row.paymentCount, 0),
        totalMinor: contractors.reduce((sum, row) => sum + row.totalMinor, 0),
        withContract: contractors.filter((row) => row.contracts.length > 0).length,
      },
      boundary: "Реестр формируется только из подтверждённых списаний. CRM, закупки, ручные карточки и демонстрационные поставщики в него не добавляются.",
    });
  } catch {
    return Response.json({ error: "Не удалось построить реестр подрядчиков по оплатам" }, { status: 503 });
  }
}
