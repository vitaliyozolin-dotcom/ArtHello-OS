import { Router, type Response } from "express";
import {
  branchLegalEntityAssignmentsTable,
  crmBranchesTable,
  crmStudentsTable,
  db,
  familiesTable,
  fiscalReceiptsTable,
  legalEntitiesTable,
  paymentObligationsTable,
  paymentRequestsTable,
  paymentRoutesTable,
  personsTable,
  studentProfilesTable,
} from "@workspace/db";
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import type { AuthRole, BusinessScope } from "../lib/security/access-policy.js";

export const paymentsWebRouter = Router();

type PaymentWebAuth = {
  session: {
    userId: string;
    role: AuthRole;
    name: string;
    scope: BusinessScope;
  };
};

function requestAuth(res: Response): PaymentWebAuth | null {
  const auth = res.locals.auth as PaymentWebAuth | undefined;
  if (!auth?.session) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return auth;
}

function isOwner(auth: PaymentWebAuth): boolean {
  return auth.session.role === "owner" || auth.session.scope.unrestricted;
}

function canReadBranch(auth: PaymentWebAuth, branchCrmId: string): boolean {
  return (
    isOwner(auth) ||
    (auth.session.role === "payment_operator" &&
      auth.session.scope.branchIds.includes(branchCrmId))
  );
}

function safeKopecks(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Payment amount is outside safe kopeck range");
  }
  return parsed;
}

paymentsWebRouter.get("/payments/catalog", async (_req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  try {
    const conditions = [
      eq(branchLegalEntityAssignmentsTable.mappingStatus, "owner_confirmed"),
      eq(legalEntitiesTable.isActive, true),
    ];
    if (!isOwner(auth)) {
      conditions.push(
        inArray(
          branchLegalEntityAssignmentsTable.branchCrmId,
          [...auth.session.scope.branchIds],
        ),
        inArray(
          branchLegalEntityAssignmentsTable.legalEntityId,
          [...auth.session.scope.legalEntityIds],
        ),
      );
    }
    const rows = await db
      .select({
        branchCrmId: branchLegalEntityAssignmentsTable.branchCrmId,
        branchNameFromCrm: crmBranchesTable.name,
        branchNameFromAssignment: branchLegalEntityAssignmentsTable.branchName,
        operatingUnitCode: branchLegalEntityAssignmentsTable.operatingUnitCode,
        legalEntityId: legalEntitiesTable.id,
        legalEntityName: legalEntitiesTable.displayName,
        legalName: legalEntitiesTable.legalName,
      })
      .from(branchLegalEntityAssignmentsTable)
      .innerJoin(
        legalEntitiesTable,
        eq(
          legalEntitiesTable.id,
          branchLegalEntityAssignmentsTable.legalEntityId,
        ),
      )
      .leftJoin(
        crmBranchesTable,
        eq(
          crmBranchesTable.crmId,
          branchLegalEntityAssignmentsTable.branchCrmId,
        ),
      )
      .where(and(...conditions))
      .orderBy(
        asc(crmBranchesTable.name),
        asc(legalEntitiesTable.displayName),
      );
    res.json(
      rows.map((row) => ({
        branchCrmId: row.branchCrmId,
        branchName:
          row.branchNameFromCrm?.trim() ||
          row.branchNameFromAssignment?.trim() ||
          row.operatingUnitCode,
        legalEntityId: row.legalEntityId,
        legalEntityName: row.legalEntityName || row.legalName,
        legalName: row.legalName,
      })),
    );
  } catch (err) {
    logger.error({ err }, "ArtHello Pay catalog failed");
    res
      .status(503)
      .json({ error: "Справочник ArtHello Pay временно недоступен" });
  }
});

const customerQuerySchema = z.object({
  branchCrmId: z.string().trim().min(1).max(128),
  q: z.string().trim().max(120).optional().default(""),
});

paymentsWebRouter.get("/payments/customers", async (req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  const parsed = customerQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректный поиск клиента" });
    return;
  }
  if (!canReadBranch(auth, parsed.data.branchCrmId)) {
    res.status(403).json({ error: "Недостаточно прав для этого филиала" });
    return;
  }
  try {
    const [scopeRow] = await db
      .select({ legalEntityId: branchLegalEntityAssignmentsTable.legalEntityId })
      .from(branchLegalEntityAssignmentsTable)
      .where(
        and(
          eq(
            branchLegalEntityAssignmentsTable.branchCrmId,
            parsed.data.branchCrmId,
          ),
          eq(
            branchLegalEntityAssignmentsTable.mappingStatus,
            "owner_confirmed",
          ),
        ),
      )
      .limit(1);
    const legalEntityId = scopeRow?.legalEntityId;
    if (!legalEntityId) {
      res
        .status(409)
        .json({ error: "Для филиала не подтверждено юридическое лицо" });
      return;
    }
    if (
      !isOwner(auth) &&
      !auth.session.scope.legalEntityIds.includes(legalEntityId)
    ) {
      res
        .status(403)
        .json({ error: "Недостаточно прав для юридического лица" });
      return;
    }

    const query = parsed.data.q.trim();
    const filters = [
      eq(crmStudentsTable.branchCrmId, parsed.data.branchCrmId),
      eq(crmStudentsTable.recordState, "current"),
    ];
    if (query) {
      const pattern = `%${query}%`;
      filters.push(
        or(
          ilike(studentProfilesTable.fullName, pattern),
          ilike(crmStudentsTable.fullName, pattern),
          ilike(familiesTable.familyName, pattern),
          ilike(personsTable.fullName, pattern),
          ilike(personsTable.primaryPhone, pattern),
          ilike(familiesTable.primaryPhone, pattern),
          ilike(crmStudentsTable.phone, pattern),
        )!,
      );
    }

    const rows = await db
      .select({
        studentCrmId: crmStudentsTable.crmId,
        studentPersonId: studentProfilesTable.studentPersonId,
        familyId: studentProfilesTable.familyId,
        studentNameFromProfile: studentProfilesTable.fullName,
        studentNameFromCrm: crmStudentsTable.fullName,
        studentStatusFromProfile: studentProfilesTable.status,
        studentStatusFromCrm: crmStudentsTable.status,
        familyName: familiesTable.familyName,
        payerPersonId: familiesTable.primaryGuardianPersonId,
        payerName: personsTable.fullName,
        guardianPhone: personsTable.primaryPhone,
        familyPhone: familiesTable.primaryPhone,
        studentPhone: crmStudentsTable.phone,
        guardianEmail: personsTable.primaryEmail,
        studentEmail: crmStudentsTable.email,
      })
      .from(crmStudentsTable)
      .leftJoin(
        studentProfilesTable,
        and(
          eq(studentProfilesTable.studentCrmId, crmStudentsTable.crmId),
          eq(studentProfilesTable.recordState, "current"),
        ),
      )
      .leftJoin(
        familiesTable,
        eq(familiesTable.id, studentProfilesTable.familyId),
      )
      .leftJoin(
        personsTable,
        eq(personsTable.id, familiesTable.primaryGuardianPersonId),
      )
      .where(and(...filters))
      .orderBy(asc(studentProfilesTable.fullName), asc(crmStudentsTable.fullName))
      .limit(60);

    res.json(
      rows.map((row) => ({
        branchCrmId: parsed.data.branchCrmId,
        legalEntityId,
        studentCrmId: row.studentCrmId,
        studentPersonId: row.studentPersonId,
        familyId: row.familyId,
        studentName:
          row.studentNameFromProfile?.trim() ||
          row.studentNameFromCrm?.trim() ||
          `Ученик ${row.studentCrmId}`,
        status:
          row.studentStatusFromProfile?.trim() ||
          row.studentStatusFromCrm?.trim() ||
          null,
        payerPersonId: row.payerPersonId,
        payerName: row.payerName?.trim() || row.familyName?.trim() || null,
        payerPhone:
          row.guardianPhone?.trim() ||
          row.familyPhone?.trim() ||
          row.studentPhone?.trim() ||
          null,
        payerEmail:
          row.guardianEmail?.trim() || row.studentEmail?.trim() || null,
      })),
    );
  } catch (err) {
    logger.error({ err }, "ArtHello Pay customer search failed");
    res.status(503).json({ error: "Клиенты временно недоступны" });
  }
});

paymentsWebRouter.get("/payments/public/:paymentLinkId", async (req, res) => {
  const paymentLinkId = req.params.paymentLinkId?.trim() ?? "";
  if (
    !/^AH-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      paymentLinkId,
    )
  ) {
    res.status(404).json({ error: "Платёжная ссылка не найдена" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const [row] = await db
      .select({
        paymentLinkId: paymentRequestsTable.paymentLinkId,
        requestStatus: paymentRequestsTable.status,
        amountKopecks: paymentRequestsTable.amountKopecks,
        currency: paymentRequestsTable.currency,
        providerPaymentUrl: paymentRequestsTable.providerPaymentUrl,
        purpose: paymentObligationsTable.purpose,
        billingPeriod: paymentObligationsTable.billingPeriod,
        dueDate: paymentObligationsTable.dueDate,
        studentNameFromProfile: studentProfilesTable.fullName,
        studentNameFromCrm: crmStudentsTable.fullName,
        recipientLabel: paymentRoutesTable.recipientLabel,
        receiptStatus: fiscalReceiptsTable.status,
        receiptUrl: fiscalReceiptsTable.receiptUrl,
      })
      .from(paymentRequestsTable)
      .innerJoin(
        paymentObligationsTable,
        eq(paymentObligationsTable.id, paymentRequestsTable.obligationId),
      )
      .innerJoin(
        paymentRoutesTable,
        eq(paymentRoutesTable.id, paymentRequestsTable.routeId),
      )
      .leftJoin(
        studentProfilesTable,
        eq(
          studentProfilesTable.studentCrmId,
          paymentObligationsTable.studentCrmId,
        ),
      )
      .leftJoin(
        crmStudentsTable,
        eq(crmStudentsTable.crmId, paymentObligationsTable.studentCrmId),
      )
      .leftJoin(
        fiscalReceiptsTable,
        and(
          eq(fiscalReceiptsTable.requestId, paymentRequestsTable.id),
          eq(fiscalReceiptsTable.kind, "sale"),
        ),
      )
      .where(eq(paymentRequestsTable.paymentLinkId, paymentLinkId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Платёжная ссылка не найдена" });
      return;
    }
    const terminalStatuses = new Set([
      "paid",
      "fiscalized",
      "posted",
      "cancelled",
      "expired",
      "refunded",
    ]);
    const canPay =
      Boolean(row.providerPaymentUrl) &&
      !terminalStatuses.has(row.requestStatus);
    res.json({
      paymentLinkId: row.paymentLinkId,
      status: row.requestStatus,
      amountKopecks: safeKopecks(row.amountKopecks),
      currency: row.currency,
      purpose: row.purpose,
      billingPeriod: row.billingPeriod,
      dueDate: row.dueDate,
      studentName:
        row.studentNameFromProfile?.trim() ||
        row.studentNameFromCrm?.trim() ||
        null,
      recipientLabel: row.recipientLabel,
      receiptStatus: row.receiptStatus,
      receiptUrl: row.receiptUrl,
      canPay,
      paymentUrl: canPay ? row.providerPaymentUrl : null,
    });
  } catch (err) {
    logger.error({ err }, "Public ArtHello Pay request failed");
    res.status(503).json({ error: "Платёж временно недоступен" });
  }
});
