import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import {
  branchLegalEntityAssignmentsTable,
  db,
  fiscalReceiptsTable,
  legalEntitiesTable,
  paymentEventsTable,
  paymentObligationsTable,
  paymentRequestsTable,
  paymentRoutesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sha256Hex } from "@workspace/shared/sha256";
import { z } from "zod/v4";
import { logger } from "../../lib/logger.js";
import {
  decidePaymentIssue,
  resolvePaymentRoute,
  type PaymentEvidenceStatus,
  type PaymentRouteCandidate,
} from "../../lib/payments/payment-policy.js";
import type { AuthRole, BusinessScope } from "../../lib/security/access-policy.js";
import { PostgresAuthStore } from "../../lib/security/auth-store.js";
import {
  hashPassword,
  validatePasswordPolicy,
} from "../../lib/security/password.js";

export const paymentsRouter = Router();
const authStore = new PostgresAuthStore();
const ACTIVE_REQUEST_STATUSES = [
  "ready",
  "link_creating",
  "waiting",
  "authorized",
] as const;

type PaymentAuth = {
  session: {
    userId: string;
    role: AuthRole;
    name: string;
    scope: BusinessScope;
  };
};

type ObligationRow = typeof paymentObligationsTable.$inferSelect;
type RouteRow = typeof paymentRoutesTable.$inferSelect;
type RequestRow = typeof paymentRequestsTable.$inferSelect;

type RequestPublicExtras = {
  branchCrmId?: string | null;
  legalEntityId?: string | null;
  purpose?: string | null;
  recipientLabel?: string | null;
  receiptStatus?: string | null;
};

class PaymentHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(
      typeof body.error === "string" ? body.error : "Payment request failed",
    );
  }
}

function requestAuth(res: Response): PaymentAuth | null {
  const auth = res.locals.auth as PaymentAuth | undefined;
  if (!auth?.session) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return auth;
}

function ownerAuth(res: Response): PaymentAuth | null {
  const auth = requestAuth(res);
  if (!auth) return null;
  if (auth.session.role !== "owner") {
    res.status(403).json({ error: "Недостаточно прав" });
    return null;
  }
  return auth;
}

function hasPaymentScope(
  auth: PaymentAuth,
  branchCrmId: string,
  legalEntityId: string,
): boolean {
  if (auth.session.role === "owner" || auth.session.scope.unrestricted)
    return true;
  return (
    auth.session.role === "payment_operator" &&
    auth.session.scope.branchIds.includes(branchCrmId) &&
    auth.session.scope.legalEntityIds.includes(legalEntityId)
  );
}

function requirePaymentScope(
  res: Response,
  auth: PaymentAuth,
  branchCrmId: string,
  legalEntityId: string,
): boolean {
  if (hasPaymentScope(auth, branchCrmId, legalEntityId)) return true;
  res.status(403).json({ error: "Недостаточно прав для этого филиала" });
  return false;
}

function safeKopecks(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} is outside safe kopeck range`);
  }
  return value;
}

function evidenceStatus(value: string): PaymentEvidenceStatus {
  if (value === "ambiguous") return "AMBIGUOUS";
  if (value === "confirmed") return "CONFIRMED";
  return "UNAVAILABLE";
}

function publicObligation(row: ObligationRow) {
  return {
    id: row.id,
    branchCrmId: row.branchCrmId,
    legalEntityId: row.legalEntityId,
    familyId: row.familyId,
    payerPersonId: row.payerPersonId,
    studentPersonId: row.studentPersonId,
    studentCrmId: row.studentCrmId,
    contractId: row.contractId,
    invoiceExternalId: row.invoiceExternalId,
    billingPeriod: row.billingPeriod,
    purpose: row.purpose,
    amountKopecks: safeKopecks(row.amountKopecks, "amountKopecks"),
    confirmedPaidKopecks: safeKopecks(
      row.confirmedPaidKopecks,
      "confirmedPaidKopecks",
    ),
    currency: row.currency,
    status: row.status,
    evidenceStatus: row.evidenceStatus,
    dueDate: row.dueDate,
    source: row.source,
    sourceRef: row.sourceRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicRequest(row: RequestRow, extras: RequestPublicExtras = {}) {
  return {
    id: row.id,
    obligationId: row.obligationId,
    amountKopecks: safeKopecks(row.amountKopecks, "amountKopecks"),
    currency: row.currency,
    paymentLinkId: row.paymentLinkId,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    branchCrmId: extras.branchCrmId,
    legalEntityId: extras.legalEntityId,
    purpose: extras.purpose,
    recipientLabel: extras.recipientLabel,
    receiptStatus: extras.receiptStatus ?? null,
  };
}

async function loadObligation(id: string): Promise<ObligationRow | null> {
  const [row] = await db
    .select()
    .from(paymentObligationsTable)
    .where(eq(paymentObligationsTable.id, id))
    .limit(1);
  return row ?? null;
}

async function branchLegalEntityConfirmed(
  branchCrmId: string,
  legalEntityId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: branchLegalEntityAssignmentsTable.id })
    .from(branchLegalEntityAssignmentsTable)
    .innerJoin(
      legalEntitiesTable,
      eq(
        legalEntitiesTable.id,
        branchLegalEntityAssignmentsTable.legalEntityId,
      ),
    )
    .where(
      and(
        eq(branchLegalEntityAssignmentsTable.branchCrmId, branchCrmId),
        eq(branchLegalEntityAssignmentsTable.legalEntityId, legalEntityId),
        eq(branchLegalEntityAssignmentsTable.mappingStatus, "owner_confirmed"),
        eq(legalEntitiesTable.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function loadActiveRequestAmount(
  obligationId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ amountKopecks: paymentRequestsTable.amountKopecks })
    .from(paymentRequestsTable)
    .where(
      and(
        eq(paymentRequestsTable.obligationId, obligationId),
        inArray(paymentRequestsTable.status, [...ACTIVE_REQUEST_STATUSES]),
      ),
    )
    .orderBy(desc(paymentRequestsTable.createdAt))
    .limit(1);
  return row ? safeKopecks(row.amountKopecks, "activeRequestKopecks") : null;
}

function routeCandidate(row: RouteRow): PaymentRouteCandidate {
  return {
    id: row.id,
    branchId: row.branchCrmId,
    legalEntityId: row.legalEntityId,
    active: row.isActive,
    provider: "tochka",
    providerCustomerCode: row.providerCustomerCode,
    merchantId: row.merchantId,
    fiscalProfileStatus:
      row.fiscalProfileStatus === "approved"
        ? "APPROVED"
        : row.fiscalProfileStatus === "disabled"
          ? "DISABLED"
          : "DRAFT",
  };
}

async function loadRouteCandidates(
  branchCrmId: string,
  legalEntityId: string,
): Promise<RouteRow[]> {
  return db
    .select()
    .from(paymentRoutesTable)
    .where(
      and(
        eq(paymentRoutesTable.branchCrmId, branchCrmId),
        eq(paymentRoutesTable.legalEntityId, legalEntityId),
        eq(paymentRoutesTable.isActive, true),
      ),
    );
}

async function previewIssue(obligation: ObligationRow) {
  const activeRequestKopecks = await loadActiveRequestAmount(obligation.id);
  const decision = decidePaymentIssue({
    obligationKopecks: safeKopecks(
      obligation.amountKopecks,
      "obligationKopecks",
    ),
    confirmedPaidKopecks: safeKopecks(
      obligation.confirmedPaidKopecks,
      "confirmedPaidKopecks",
    ),
    evidenceStatus: evidenceStatus(obligation.evidenceStatus),
    activeRequestKopecks,
  });
  const routes = await loadRouteCandidates(
    obligation.branchCrmId,
    obligation.legalEntityId,
  );
  const routeResolution = resolvePaymentRoute(
    routes.map(routeCandidate),
    obligation.branchCrmId,
    obligation.legalEntityId,
  );
  return { decision, routes, routeResolution };
}

const routeSchema = z.object({
  branchCrmId: z.string().trim().min(1).max(128),
  legalEntityId: z.string().uuid(),
  providerCustomerCode: z.string().trim().min(1).max(64),
  merchantId: z.string().trim().min(1).max(64),
  recipientLabel: z.string().trim().min(2).max(160),
  fiscalProfileStatus: z
    .enum(["draft", "approved", "disabled"])
    .default("draft"),
  fiscalProfile: z
    .object({
      taxSystemCode: z.string().trim().min(1).max(64).optional(),
      vatType: z.string().trim().min(1).max(64).optional(),
      paymentMethod: z.string().trim().min(1).max(64).optional(),
      paymentObject: z.string().trim().min(1).max(64).optional(),
      itemName: z.string().trim().min(1).max(160).optional(),
    })
    .passthrough()
    .default({}),
});

paymentsRouter.get("/payments/routes", async (_req, res) => {
  if (!ownerAuth(res)) return;
  try {
    const rows = await db
      .select()
      .from(paymentRoutesTable)
      .orderBy(
        paymentRoutesTable.branchCrmId,
        paymentRoutesTable.recipientLabel,
      );
    res.json(
      rows.map((row) => ({
        id: row.id,
        branchCrmId: row.branchCrmId,
        legalEntityId: row.legalEntityId,
        provider: row.provider,
        providerCustomerCode: row.providerCustomerCode,
        merchantId: row.merchantId,
        recipientLabel: row.recipientLabel,
        fiscalProfile: row.fiscalProfile ?? {},
        fiscalProfileStatus: row.fiscalProfileStatus,
        active: row.isActive,
      })),
    );
  } catch (err) {
    logger.error({ err }, "Payment route list failed");
    res.status(503).json({ error: "Маршруты оплаты временно недоступны" });
  }
});

paymentsRouter.post("/payments/routes", async (req, res) => {
  const auth = ownerAuth(res);
  if (!auth) return;
  const parsed = routeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректная настройка маршрута" });
    return;
  }
  if (
    parsed.data.fiscalProfileStatus === "approved" &&
    (!parsed.data.fiscalProfile.taxSystemCode ||
      !parsed.data.fiscalProfile.vatType ||
      !parsed.data.fiscalProfile.paymentMethod ||
      !parsed.data.fiscalProfile.paymentObject ||
      !parsed.data.fiscalProfile.itemName)
  ) {
    res.status(400).json({
      error: "Для утверждённого маршрута требуется полный фискальный профиль",
    });
    return;
  }
  try {
    if (
      !(await branchLegalEntityConfirmed(
        parsed.data.branchCrmId,
        parsed.data.legalEntityId,
      ))
    ) {
      res.status(409).json({
        error: "Филиал не подтверждён за выбранным юридическим лицом",
      });
      return;
    }
    const [created] = await db
      .insert(paymentRoutesTable)
      .values({
        branchCrmId: parsed.data.branchCrmId,
        legalEntityId: parsed.data.legalEntityId,
        provider: "tochka",
        providerCustomerCode: parsed.data.providerCustomerCode,
        merchantId: parsed.data.merchantId,
        recipientLabel: parsed.data.recipientLabel,
        fiscalProfile: parsed.data.fiscalProfile,
        fiscalProfileStatus: parsed.data.fiscalProfileStatus,
        isActive: true,
        createdByUserId: auth.session.userId,
      })
      .returning({ id: paymentRoutesTable.id });
    res.status(201).json({ id: created?.id, active: true });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Такой маршрут оплаты уже существует" });
      return;
    }
    logger.error({ err }, "Payment route creation failed");
    res.status(503).json({ error: "Не удалось сохранить маршрут оплаты" });
  }
});

const operatorSchema = z.object({
  login: z.string().trim().min(3).max(80),
  name: z.string().trim().min(2).max(120),
  temporaryPassword: z.string().min(1).max(1024),
  branchIds: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
  legalEntityIds: z.array(z.string().uuid()).min(1).max(100),
});

paymentsRouter.post("/payments/operators", async (req, res) => {
  const auth = ownerAuth(res);
  if (!auth) return;
  const parsed = operatorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректные параметры доступа" });
    return;
  }
  const passwordError = validatePasswordPolicy(parsed.data.temporaryPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }
  try {
    const mapping = await db
      .select({
        branchCrmId: branchLegalEntityAssignmentsTable.branchCrmId,
        legalEntityId: branchLegalEntityAssignmentsTable.legalEntityId,
      })
      .from(branchLegalEntityAssignmentsTable)
      .where(
        and(
          inArray(
            branchLegalEntityAssignmentsTable.branchCrmId,
            parsed.data.branchIds,
          ),
          eq(
            branchLegalEntityAssignmentsTable.mappingStatus,
            "owner_confirmed",
          ),
        ),
      );
    const legalSet = new Set(parsed.data.legalEntityIds);
    const mappedBranches = new Set(
      mapping
        .filter((row) => legalSet.has(row.legalEntityId))
        .map((row) => row.branchCrmId),
    );
    if (
      parsed.data.branchIds.some((branchId) => !mappedBranches.has(branchId))
    ) {
      res.status(409).json({
        error: "Не все филиалы подтверждены за выбранными юридическими лицами",
      });
      return;
    }
    const user = await authStore.createUser({
      login: parsed.data.login,
      loginNormalized: parsed.data.login.trim().toLowerCase(),
      passwordHash: await hashPassword(parsed.data.temporaryPassword),
      role: "payment_operator",
      name: parsed.data.name,
      scope: {
        unrestricted: false,
        branchIds: [...new Set(parsed.data.branchIds)],
        legalEntityIds: [...new Set(parsed.data.legalEntityIds)],
      },
      mustChangePassword: true,
      createdByUserId: auth.session.userId,
    });
    res.status(201).json({
      id: user.id,
      login: user.login,
      role: user.role,
      name: user.name,
      scope: user.scope,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Такой логин уже существует" });
      return;
    }
    logger.error({ err }, "Payment operator provisioning failed");
    res.status(503).json({ error: "Не удалось создать доступ к ArtHello Pay" });
  }
});

const obligationSchema = z.object({
  branchCrmId: z.string().trim().min(1).max(128),
  legalEntityId: z.string().uuid(),
  familyId: z.string().uuid().optional(),
  payerPersonId: z.string().uuid().optional(),
  studentPersonId: z.string().uuid().optional(),
  studentCrmId: z.string().trim().min(1).max(128).optional(),
  contractId: z.string().trim().min(1).max(160).optional(),
  invoiceExternalId: z.string().trim().min(1).max(160).optional(),
  billingPeriod: z.iso.date().optional(),
  purpose: z.string().trim().min(2).max(512),
  amountKopecks: z.number().int().positive().safe(),
  dueDate: z.iso.date().optional(),
  payerEmail: z.string().email().max(320).optional(),
  payerPhone: z.string().trim().min(7).max(32).optional(),
  sourceRef: z.string().trim().min(1).max(200).optional(),
});

paymentsRouter.post("/payments/obligations", async (req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  const parsed = obligationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректное начисление" });
    return;
  }
  if (
    !requirePaymentScope(
      res,
      auth,
      parsed.data.branchCrmId,
      parsed.data.legalEntityId,
    )
  ) {
    return;
  }
  try {
    if (
      !(await branchLegalEntityConfirmed(
        parsed.data.branchCrmId,
        parsed.data.legalEntityId,
      ))
    ) {
      res.status(409).json({
        error: "Филиал не подтверждён за выбранным юридическим лицом",
      });
      return;
    }
    const [created] = await db
      .insert(paymentObligationsTable)
      .values({
        branchCrmId: parsed.data.branchCrmId,
        legalEntityId: parsed.data.legalEntityId,
        familyId: parsed.data.familyId,
        payerPersonId: parsed.data.payerPersonId,
        studentPersonId: parsed.data.studentPersonId,
        studentCrmId: parsed.data.studentCrmId,
        contractId: parsed.data.contractId,
        invoiceExternalId: parsed.data.invoiceExternalId,
        billingPeriod: parsed.data.billingPeriod,
        purpose: parsed.data.purpose,
        amountKopecks: parsed.data.amountKopecks,
        confirmedPaidKopecks: 0,
        currency: "RUB",
        status: "open",
        evidenceStatus: "unavailable",
        dueDate: parsed.data.dueDate,
        payerEmail: parsed.data.payerEmail,
        payerPhone: parsed.data.payerPhone,
        source: "manual",
        sourceRef: parsed.data.sourceRef,
        createdByUserId: auth.session.userId,
      })
      .returning();
    if (!created) throw new Error("Payment obligation insert returned no row");
    res.status(201).json(publicObligation(created));
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Такое начисление уже существует" });
      return;
    }
    logger.error({ err }, "Payment obligation creation failed");
    res.status(503).json({ error: "Не удалось создать начисление" });
  }
});

paymentsRouter.get("/payments/obligations", async (_req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  try {
    const owner =
      auth.session.role === "owner" || auth.session.scope.unrestricted;
    const rows = await db
      .select()
      .from(paymentObligationsTable)
      .where(
        owner
          ? undefined
          : and(
              inArray(paymentObligationsTable.branchCrmId, [
                ...auth.session.scope.branchIds,
              ]),
              inArray(paymentObligationsTable.legalEntityId, [
                ...auth.session.scope.legalEntityIds,
              ]),
            ),
      )
      .orderBy(desc(paymentObligationsTable.createdAt))
      .limit(200);
    res.json(rows.map(publicObligation));
  } catch (err) {
    logger.error({ err }, "Payment obligations list failed");
    res.status(503).json({ error: "Начисления временно недоступны" });
  }
});

paymentsRouter.get("/payments/obligations/:obligationId", async (req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  if (!z.string().uuid().safeParse(req.params.obligationId).success) {
    res.status(400).json({ error: "Некорректный идентификатор" });
    return;
  }
  try {
    const obligation = await loadObligation(req.params.obligationId);
    if (!obligation) {
      res.status(404).json({ error: "Начисление не найдено" });
      return;
    }
    if (
      !requirePaymentScope(
        res,
        auth,
        obligation.branchCrmId,
        obligation.legalEntityId,
      )
    ) {
      return;
    }
    res.json(publicObligation(obligation));
  } catch (err) {
    logger.error({ err }, "Payment obligation read failed");
    res.status(503).json({ error: "Начисление временно недоступно" });
  }
});

paymentsRouter.post(
  "/payments/obligations/:obligationId/requests/preview",
  async (req, res) => {
    const auth = requestAuth(res);
    if (!auth) return;
    if (!z.string().uuid().safeParse(req.params.obligationId).success) {
      res.status(400).json({ error: "Некорректный идентификатор" });
      return;
    }
    try {
      const obligation = await loadObligation(req.params.obligationId);
      if (!obligation) {
        res.status(404).json({ error: "Начисление не найдено" });
        return;
      }
      if (
        !requirePaymentScope(
          res,
          auth,
          obligation.branchCrmId,
          obligation.legalEntityId,
        )
      ) {
        return;
      }
      const preview = await previewIssue(obligation);
      res.json({
        decision: preview.decision,
        route: preview.routeResolution.ok
          ? {
              ready: true,
              recipientLabel:
                preview.routes.find(
                  (route) =>
                    route.id ===
                    (preview.routeResolution.ok
                      ? preview.routeResolution.route.id
                      : ""),
                )?.recipientLabel ?? null,
            }
          : { ready: false, reason: preview.routeResolution.reason },
      });
    } catch (err) {
      logger.error({ err }, "Payment request preview failed");
      res
        .status(503)
        .json({ error: "Не удалось проверить возможность оплаты" });
    }
  },
);

paymentsRouter.post(
  "/payments/obligations/:obligationId/requests",
  async (req, res) => {
    const auth = requestAuth(res);
    if (!auth) return;
    if (!z.string().uuid().safeParse(req.params.obligationId).success) {
      res.status(400).json({ error: "Некорректный идентификатор" });
      return;
    }
    const clientKey = req.header("idempotency-key")?.trim();
    if (!clientKey || clientKey.length < 16 || clientKey.length > 128) {
      res.status(400).json({
        error: "Для создания запроса требуется уникальный Idempotency-Key",
      });
      return;
    }
    const idempotencyKey = `${auth.session.userId}:${clientKey}`;
    try {
      const [existing] = await db
        .select({
          request: paymentRequestsTable,
          branchCrmId: paymentObligationsTable.branchCrmId,
          legalEntityId: paymentObligationsTable.legalEntityId,
        })
        .from(paymentRequestsTable)
        .innerJoin(
          paymentObligationsTable,
          eq(paymentObligationsTable.id, paymentRequestsTable.obligationId),
        )
        .where(eq(paymentRequestsTable.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        if (
          !requirePaymentScope(
            res,
            auth,
            existing.branchCrmId,
            existing.legalEntityId,
          )
        ) {
          return;
        }
        res.json({
          ...publicRequest(existing.request, {
            branchCrmId: existing.branchCrmId,
            legalEntityId: existing.legalEntityId,
          }),
          idempotentReplay: true,
        });
        return;
      }

      const result = await db.transaction(async (tx) => {
        const [obligation] = await tx
          .select()
          .from(paymentObligationsTable)
          .where(eq(paymentObligationsTable.id, req.params.obligationId))
          .for("update")
          .limit(1);
        if (!obligation) {
          throw new PaymentHttpError(404, { error: "Начисление не найдено" });
        }
        if (
          !hasPaymentScope(
            auth,
            obligation.branchCrmId,
            obligation.legalEntityId,
          )
        ) {
          throw new PaymentHttpError(403, {
            error: "Недостаточно прав для этого филиала",
          });
        }

        const [active] = await tx
          .select({ amountKopecks: paymentRequestsTable.amountKopecks })
          .from(paymentRequestsTable)
          .where(
            and(
              eq(paymentRequestsTable.obligationId, obligation.id),
              inArray(paymentRequestsTable.status, [
                ...ACTIVE_REQUEST_STATUSES,
              ]),
            ),
          )
          .orderBy(desc(paymentRequestsTable.createdAt))
          .limit(1);
        const decision = decidePaymentIssue({
          obligationKopecks: safeKopecks(
            obligation.amountKopecks,
            "obligationKopecks",
          ),
          confirmedPaidKopecks: safeKopecks(
            obligation.confirmedPaidKopecks,
            "confirmedPaidKopecks",
          ),
          evidenceStatus: evidenceStatus(obligation.evidenceStatus),
          activeRequestKopecks: active
            ? safeKopecks(active.amountKopecks, "activeRequestKopecks")
            : null,
        });
        if (decision.action !== "ISSUE") {
          throw new PaymentHttpError(decision.action === "SKIP" ? 409 : 422, {
            decision,
          });
        }

        const routes = await tx
          .select()
          .from(paymentRoutesTable)
          .where(
            and(
              eq(paymentRoutesTable.branchCrmId, obligation.branchCrmId),
              eq(paymentRoutesTable.legalEntityId, obligation.legalEntityId),
              eq(paymentRoutesTable.isActive, true),
            ),
          );
        const routeResolution = resolvePaymentRoute(
          routes.map(routeCandidate),
          obligation.branchCrmId,
          obligation.legalEntityId,
        );
        if (!routeResolution.ok) {
          throw new PaymentHttpError(409, {
            error: "Маршрут оплаты не готов",
            reason: routeResolution.reason,
          });
        }
        const route = routes.find(
          (candidate) => candidate.id === routeResolution.route.id,
        );
        if (!route) throw new Error("Resolved payment route disappeared");

        const paymentLinkId = `AH-${randomUUID()}`;
        const [created] = await tx
          .insert(paymentRequestsTable)
          .values({
            obligationId: obligation.id,
            routeId: route.id,
            amountKopecks: decision.outstandingKopecks,
            currency: "RUB",
            idempotencyKey,
            paymentLinkId,
            status: "ready",
            payerContactSnapshot: {
              email: obligation.payerEmail,
              phone: obligation.payerPhone,
            },
            fiscalSnapshot: route.fiscalProfile ?? {},
            createdByUserId: auth.session.userId,
          })
          .returning();
        if (!created) throw new Error("Payment request insert returned no row");

        await tx.insert(fiscalReceiptsTable).values({
          requestId: created.id,
          kind: "sale",
          status: "expected",
          fiscalProfileSnapshot: route.fiscalProfile ?? {},
        });
        const safeEvent = {
          action: "REQUEST_PREPARED",
          amountKopecks: decision.outstandingKopecks,
          paymentLinkId,
        };
        await tx.insert(paymentEventsTable).values({
          requestId: created.id,
          provider: "internal",
          eventIdentity: `request-prepared:${created.id}`,
          eventType: "REQUEST_PREPARED",
          payloadDigest: sha256Hex(JSON.stringify(safeEvent)),
          safePayload: safeEvent,
          actorUserId: auth.session.userId,
          occurredAt: new Date(),
          processedAt: new Date(),
        });
        return { created, route, decision };
      });

      res.status(201).json({
        ...publicRequest(result.created),
        recipientLabel: result.route.recipientLabel,
        issueDecision: result.decision,
        providerActivation: "PENDING_TOCHKA_ADAPTER",
      });
    } catch (err) {
      if (err instanceof PaymentHttpError) {
        res.status(err.status).json(err.body);
        return;
      }
      if ((err as { code?: string }).code === "23505") {
        const [replay] = await db
          .select()
          .from(paymentRequestsTable)
          .where(eq(paymentRequestsTable.idempotencyKey, idempotencyKey))
          .limit(1);
        if (replay) {
          res.json({ ...publicRequest(replay), idempotentReplay: true });
          return;
        }
      }
      logger.error({ err }, "Payment request preparation failed");
      res
        .status(503)
        .json({ error: "Не удалось подготовить ссылку на оплату" });
    }
  },
);

paymentsRouter.get("/payments/requests", async (_req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  try {
    const owner =
      auth.session.role === "owner" || auth.session.scope.unrestricted;
    const rows = await db
      .select({
        request: paymentRequestsTable,
        branchCrmId: paymentObligationsTable.branchCrmId,
        legalEntityId: paymentObligationsTable.legalEntityId,
        purpose: paymentObligationsTable.purpose,
        recipientLabel: paymentRoutesTable.recipientLabel,
        receiptStatus: fiscalReceiptsTable.status,
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
        fiscalReceiptsTable,
        and(
          eq(fiscalReceiptsTable.requestId, paymentRequestsTable.id),
          eq(fiscalReceiptsTable.kind, "sale"),
        ),
      )
      .where(
        owner
          ? undefined
          : and(
              inArray(paymentObligationsTable.branchCrmId, [
                ...auth.session.scope.branchIds,
              ]),
              inArray(paymentObligationsTable.legalEntityId, [
                ...auth.session.scope.legalEntityIds,
              ]),
            ),
      )
      .orderBy(desc(paymentRequestsTable.createdAt))
      .limit(200);
    res.json(
      rows.map((row) =>
        publicRequest(row.request, {
          branchCrmId: row.branchCrmId,
          legalEntityId: row.legalEntityId,
          purpose: row.purpose,
          recipientLabel: row.recipientLabel,
          receiptStatus: row.receiptStatus,
        }),
      ),
    );
  } catch (err) {
    logger.error({ err }, "Payment requests list failed");
    res.status(503).json({ error: "Платёжные запросы временно недоступны" });
  }
});

paymentsRouter.post(
  "/payments/requests/:requestId/cancel",
  async (req, res) => {
    const auth = requestAuth(res);
    if (!auth) return;
    if (!z.string().uuid().safeParse(req.params.requestId).success) {
      res.status(400).json({ error: "Некорректный идентификатор" });
      return;
    }
    try {
      const [current] = await db
        .select({
          request: paymentRequestsTable,
          branchCrmId: paymentObligationsTable.branchCrmId,
          legalEntityId: paymentObligationsTable.legalEntityId,
        })
        .from(paymentRequestsTable)
        .innerJoin(
          paymentObligationsTable,
          eq(paymentObligationsTable.id, paymentRequestsTable.obligationId),
        )
        .where(eq(paymentRequestsTable.id, req.params.requestId))
        .limit(1);
      if (!current) {
        res.status(404).json({ error: "Платёжный запрос не найден" });
        return;
      }
      if (
        !requirePaymentScope(
          res,
          auth,
          current.branchCrmId,
          current.legalEntityId,
        )
      ) {
        return;
      }
      if (current.request.status !== "ready") {
        res.status(409).json({
          error:
            "После передачи запроса провайдеру отмена выполняется отдельной операцией",
        });
        return;
      }
      const [cancelled] = await db
        .update(paymentRequestsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(paymentRequestsTable.id, req.params.requestId),
            eq(paymentRequestsTable.status, "ready"),
          ),
        )
        .returning();
      if (!cancelled) {
        res.status(409).json({ error: "Статус платежа уже изменился" });
        return;
      }
      const safeEvent = { action: "REQUEST_CANCELLED" };
      await db.insert(paymentEventsTable).values({
        requestId: cancelled.id,
        provider: "internal",
        eventIdentity: `request-cancelled:${cancelled.id}:${randomUUID()}`,
        eventType: "REQUEST_CANCELLED",
        payloadDigest: sha256Hex(JSON.stringify(safeEvent)),
        safePayload: safeEvent,
        actorUserId: auth.session.userId,
        occurredAt: new Date(),
        processedAt: new Date(),
      });
      res.json(publicRequest(cancelled));
    } catch (err) {
      logger.error({ err }, "Payment request cancellation failed");
      res.status(503).json({ error: "Не удалось отменить платёжный запрос" });
    }
  },
);
