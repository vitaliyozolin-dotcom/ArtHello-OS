import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { pool } from "@workspace/db";
import { sha256Hex } from "@workspace/shared/sha256";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import {
  decidePaymentIssue,
  resolvePaymentRoute,
  type PaymentEvidenceStatus,
  type PaymentRouteCandidate,
} from "../lib/payments/payment-policy.js";
import type {
  AuthRole,
  BusinessScope,
} from "../lib/security/access-policy.js";
import { PostgresAuthStore } from "../lib/security/auth-store.js";
import {
  hashPassword,
  validatePasswordPolicy,
} from "../lib/security/password.js";

export const paymentsRouter = Router();
const authStore = new PostgresAuthStore();
const ACTIVE_REQUEST_STATUSES = ["ready", "link_creating", "waiting", "authorized"];

type PaymentAuth = {
  session: {
    userId: string;
    role: AuthRole;
    name: string;
    scope: BusinessScope;
  };
};

type ObligationRow = {
  id: string;
  branch_crm_id: string;
  legal_entity_id: string;
  family_id: string | null;
  payer_person_id: string | null;
  student_person_id: string | null;
  student_crm_id: string | null;
  contract_id: string | null;
  invoice_external_id: string | null;
  billing_period: string | null;
  purpose: string;
  amount_kopecks: string | number;
  confirmed_paid_kopecks: string | number;
  currency: string;
  status: string;
  evidence_status: string;
  due_date: string | null;
  payer_email: string | null;
  payer_phone: string | null;
  source: string;
  source_ref: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RouteRow = {
  id: string;
  branch_crm_id: string;
  legal_entity_id: string;
  provider: string;
  provider_customer_code: string;
  merchant_id: string;
  recipient_label: string;
  fiscal_profile: Record<string, unknown> | null;
  fiscal_profile_status: string;
  is_active: boolean;
};

type RequestRow = {
  id: string;
  obligation_id: string;
  route_id: string;
  amount_kopecks: string | number;
  currency: string;
  payment_link_id: string;
  status: string;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  branch_crm_id?: string;
  legal_entity_id?: string;
  purpose?: string;
  recipient_label?: string;
  receipt_status?: string | null;
};

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
  if (auth.session.role === "owner" || auth.session.scope.unrestricted) return true;
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

function safeKopecks(value: string | number, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} is outside safe kopeck range`);
  }
  return parsed;
}

function evidenceStatus(value: string): PaymentEvidenceStatus {
  if (value === "ambiguous") return "AMBIGUOUS";
  if (value === "confirmed") return "CONFIRMED";
  return "UNAVAILABLE";
}

function publicObligation(row: ObligationRow) {
  return {
    id: row.id,
    branchCrmId: row.branch_crm_id,
    legalEntityId: row.legal_entity_id,
    familyId: row.family_id,
    payerPersonId: row.payer_person_id,
    studentPersonId: row.student_person_id,
    studentCrmId: row.student_crm_id,
    contractId: row.contract_id,
    invoiceExternalId: row.invoice_external_id,
    billingPeriod: row.billing_period,
    purpose: row.purpose,
    amountKopecks: safeKopecks(row.amount_kopecks, "amountKopecks"),
    confirmedPaidKopecks: safeKopecks(
      row.confirmed_paid_kopecks,
      "confirmedPaidKopecks",
    ),
    currency: row.currency,
    status: row.status,
    evidenceStatus: row.evidence_status,
    dueDate: row.due_date,
    source: row.source,
    sourceRef: row.source_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicRequest(row: RequestRow) {
  return {
    id: row.id,
    obligationId: row.obligation_id,
    amountKopecks: safeKopecks(row.amount_kopecks, "amountKopecks"),
    currency: row.currency,
    paymentLinkId: row.payment_link_id,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    branchCrmId: row.branch_crm_id,
    legalEntityId: row.legal_entity_id,
    purpose: row.purpose,
    recipientLabel: row.recipient_label,
    receiptStatus: row.receipt_status ?? null,
  };
}

async function loadObligation(id: string): Promise<ObligationRow | null> {
  const result = await pool.query<ObligationRow>(
    `SELECT id, branch_crm_id, legal_entity_id::text, family_id::text,
            payer_person_id::text, student_person_id::text, student_crm_id,
            contract_id, invoice_external_id, billing_period::text, purpose,
            amount_kopecks, confirmed_paid_kopecks, currency, status,
            evidence_status, due_date::text, payer_email, payer_phone, source,
            source_ref, created_at, updated_at
       FROM payment_obligations
      WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function branchLegalEntityConfirmed(
  branchCrmId: string,
  legalEntityId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM branch_legal_entity_assignments a
       JOIN legal_entities l ON l.id = a.legal_entity_id
      WHERE a.branch_crm_id = $1
        AND a.legal_entity_id = $2::uuid
        AND a.mapping_status = 'owner_confirmed'
        AND l.is_active = TRUE
      LIMIT 1`,
    [branchCrmId, legalEntityId],
  );
  return (result.rowCount ?? 0) === 1;
}

async function loadActiveRequestAmount(
  obligationId: string,
): Promise<number | null> {
  const result = await pool.query<{ amount_kopecks: string | number }>(
    `SELECT amount_kopecks
       FROM payment_requests
      WHERE obligation_id = $1
        AND status = ANY($2::text[])
      ORDER BY created_at DESC
      LIMIT 1`,
    [obligationId, ACTIVE_REQUEST_STATUSES],
  );
  const row = result.rows[0];
  return row ? safeKopecks(row.amount_kopecks, "activeRequestKopecks") : null;
}

async function loadRouteCandidates(
  branchCrmId: string,
  legalEntityId: string,
): Promise<{ candidate: PaymentRouteCandidate; row: RouteRow }[]> {
  const result = await pool.query<RouteRow>(
    `SELECT id, branch_crm_id, legal_entity_id::text, provider,
            provider_customer_code, merchant_id, recipient_label,
            fiscal_profile, fiscal_profile_status, is_active
       FROM payment_routes
      WHERE branch_crm_id = $1
        AND legal_entity_id = $2::uuid
        AND is_active = TRUE`,
    [branchCrmId, legalEntityId],
  );
  return result.rows.map((row) => ({
    row,
    candidate: {
      id: row.id,
      branchId: row.branch_crm_id,
      legalEntityId: row.legal_entity_id,
      active: row.is_active,
      provider: "tochka",
      providerCustomerCode: row.provider_customer_code,
      merchantId: row.merchant_id,
      fiscalProfileStatus:
        row.fiscal_profile_status === "approved"
          ? "APPROVED"
          : row.fiscal_profile_status === "disabled"
            ? "DISABLED"
            : "DRAFT",
    },
  }));
}

async function previewIssue(obligation: ObligationRow) {
  const activeRequestKopecks = await loadActiveRequestAmount(obligation.id);
  const decision = decidePaymentIssue({
    obligationKopecks: safeKopecks(obligation.amount_kopecks, "obligationKopecks"),
    confirmedPaidKopecks: safeKopecks(
      obligation.confirmed_paid_kopecks,
      "confirmedPaidKopecks",
    ),
    evidenceStatus: evidenceStatus(obligation.evidence_status),
    activeRequestKopecks,
  });
  const routes = await loadRouteCandidates(
    obligation.branch_crm_id,
    obligation.legal_entity_id,
  );
  const routeResolution = resolvePaymentRoute(
    routes.map(({ candidate }) => candidate),
    obligation.branch_crm_id,
    obligation.legal_entity_id,
  );
  return { decision, routes, routeResolution };
}

const routeSchema = z.object({
  branchCrmId: z.string().trim().min(1).max(128),
  legalEntityId: z.string().uuid(),
  providerCustomerCode: z.string().trim().min(1).max(64),
  merchantId: z.string().trim().min(1).max(64),
  recipientLabel: z.string().trim().min(2).max(160),
  fiscalProfileStatus: z.enum(["draft", "approved", "disabled"]).default("draft"),
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
    const result = await pool.query<RouteRow>(
      `SELECT id, branch_crm_id, legal_entity_id::text, provider,
              provider_customer_code, merchant_id, recipient_label,
              fiscal_profile, fiscal_profile_status, is_active
         FROM payment_routes
        ORDER BY branch_crm_id, recipient_label`,
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        branchCrmId: row.branch_crm_id,
        legalEntityId: row.legal_entity_id,
        provider: row.provider,
        providerCustomerCode: row.provider_customer_code,
        merchantId: row.merchant_id,
        recipientLabel: row.recipient_label,
        fiscalProfile: row.fiscal_profile ?? {},
        fiscalProfileStatus: row.fiscal_profile_status,
        active: row.is_active,
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
    const result = await pool.query<{ id: string }>(
      `INSERT INTO payment_routes (
         branch_crm_id, legal_entity_id, provider, provider_customer_code,
         merchant_id, recipient_label, fiscal_profile, fiscal_profile_status,
         is_active, created_by_user_id, created_at, updated_at
       ) VALUES ($1,$2::uuid,'tochka',$3,$4,$5,$6::jsonb,$7,TRUE,$8::uuid,NOW(),NOW())
       RETURNING id`,
      [
        parsed.data.branchCrmId,
        parsed.data.legalEntityId,
        parsed.data.providerCustomerCode,
        parsed.data.merchantId,
        parsed.data.recipientLabel,
        JSON.stringify(parsed.data.fiscalProfile),
        parsed.data.fiscalProfileStatus,
        auth.session.userId,
      ],
    );
    res.status(201).json({ id: result.rows[0]?.id, active: true });
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
    const mapping = await pool.query<{
      branch_crm_id: string;
      legal_entity_id: string;
    }>(
      `SELECT branch_crm_id, legal_entity_id::text
         FROM branch_legal_entity_assignments
        WHERE branch_crm_id = ANY($1::text[])
          AND mapping_status = 'owner_confirmed'`,
      [parsed.data.branchIds],
    );
    const legalSet = new Set(parsed.data.legalEntityIds);
    const mappedBranches = new Set(
      mapping.rows
        .filter((row) => legalSet.has(row.legal_entity_id))
        .map((row) => row.branch_crm_id),
    );
    if (parsed.data.branchIds.some((branchId) => !mappedBranches.has(branchId))) {
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
    const result = await pool.query<ObligationRow>(
      `INSERT INTO payment_obligations (
         branch_crm_id, legal_entity_id, family_id, payer_person_id,
         student_person_id, student_crm_id, contract_id, invoice_external_id,
         billing_period, purpose, amount_kopecks, confirmed_paid_kopecks,
         currency, status, evidence_status, due_date, payer_email, payer_phone,
         source, source_ref, created_by_user_id, created_at, updated_at
       ) VALUES (
         $1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::date,$10,$11,0,
         'RUB','open','unavailable',$12::date,$13,$14,'manual',$15,$16::uuid,NOW(),NOW()
       )
       RETURNING id, branch_crm_id, legal_entity_id::text, family_id::text,
                 payer_person_id::text, student_person_id::text, student_crm_id,
                 contract_id, invoice_external_id, billing_period::text, purpose,
                 amount_kopecks, confirmed_paid_kopecks, currency, status,
                 evidence_status, due_date::text, payer_email, payer_phone,
                 source, source_ref, created_at, updated_at`,
      [
        parsed.data.branchCrmId,
        parsed.data.legalEntityId,
        parsed.data.familyId ?? null,
        parsed.data.payerPersonId ?? null,
        parsed.data.studentPersonId ?? null,
        parsed.data.studentCrmId ?? null,
        parsed.data.contractId ?? null,
        parsed.data.invoiceExternalId ?? null,
        parsed.data.billingPeriod ?? null,
        parsed.data.purpose,
        parsed.data.amountKopecks,
        parsed.data.dueDate ?? null,
        parsed.data.payerEmail ?? null,
        parsed.data.payerPhone ?? null,
        parsed.data.sourceRef ?? null,
        auth.session.userId,
      ],
    );
    res.status(201).json(publicObligation(result.rows[0]!));
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
    const owner = auth.session.role === "owner" || auth.session.scope.unrestricted;
    const result = owner
      ? await pool.query<ObligationRow>(
          `SELECT id, branch_crm_id, legal_entity_id::text, family_id::text,
                  payer_person_id::text, student_person_id::text, student_crm_id,
                  contract_id, invoice_external_id, billing_period::text, purpose,
                  amount_kopecks, confirmed_paid_kopecks, currency, status,
                  evidence_status, due_date::text, payer_email, payer_phone,
                  source, source_ref, created_at, updated_at
             FROM payment_obligations
            ORDER BY created_at DESC
            LIMIT 200`,
        )
      : await pool.query<ObligationRow>(
          `SELECT id, branch_crm_id, legal_entity_id::text, family_id::text,
                  payer_person_id::text, student_person_id::text, student_crm_id,
                  contract_id, invoice_external_id, billing_period::text, purpose,
                  amount_kopecks, confirmed_paid_kopecks, currency, status,
                  evidence_status, due_date::text, payer_email, payer_phone,
                  source, source_ref, created_at, updated_at
             FROM payment_obligations
            WHERE branch_crm_id = ANY($1::text[])
              AND legal_entity_id::text = ANY($2::text[])
            ORDER BY created_at DESC
            LIMIT 200`,
          [auth.session.scope.branchIds, auth.session.scope.legalEntityIds],
        );
    res.json(result.rows.map(publicObligation));
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
        obligation.branch_crm_id,
        obligation.legal_entity_id,
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
          obligation.branch_crm_id,
          obligation.legal_entity_id,
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
                  ({ candidate }) =>
                    candidate.id === preview.routeResolution.route.id,
                )?.row.recipient_label ?? null,
            }
          : { ready: false, reason: preview.routeResolution.reason },
      });
    } catch (err) {
      logger.error({ err }, "Payment request preview failed");
      res.status(503).json({ error: "Не удалось проверить возможность оплаты" });
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
    const existing = await pool.query<RequestRow & {
      branch_crm_id: string;
      legal_entity_id: string;
    }>(
      `SELECT r.id, r.obligation_id, r.route_id, r.amount_kopecks, r.currency,
              r.payment_link_id, r.status, r.expires_at, r.created_at, r.updated_at,
              o.branch_crm_id, o.legal_entity_id::text
         FROM payment_requests r
         JOIN payment_obligations o ON o.id = r.obligation_id
        WHERE r.idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (!requirePaymentScope(res, auth, row.branch_crm_id, row.legal_entity_id)) {
        return;
      }
      res.json({ ...publicRequest(row), idempotentReplay: true });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<ObligationRow>(
        `SELECT id, branch_crm_id, legal_entity_id::text, family_id::text,
                payer_person_id::text, student_person_id::text, student_crm_id,
                contract_id, invoice_external_id, billing_period::text, purpose,
                amount_kopecks, confirmed_paid_kopecks, currency, status,
                evidence_status, due_date::text, payer_email, payer_phone,
                source, source_ref, created_at, updated_at
           FROM payment_obligations
          WHERE id = $1
          FOR UPDATE`,
        [req.params.obligationId],
      );
      const obligation = locked.rows[0];
      if (!obligation) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Начисление не найдено" });
        return;
      }
      if (
        !requirePaymentScope(
          res,
          auth,
          obligation.branch_crm_id,
          obligation.legal_entity_id,
        )
      ) {
        await client.query("ROLLBACK");
        return;
      }

      const activeResult = await client.query<{
        amount_kopecks: string | number;
      }>(
        `SELECT amount_kopecks
           FROM payment_requests
          WHERE obligation_id = $1
            AND status = ANY($2::text[])
          ORDER BY created_at DESC
          LIMIT 1`,
        [obligation.id, ACTIVE_REQUEST_STATUSES],
      );
      const decision = decidePaymentIssue({
        obligationKopecks: safeKopecks(
          obligation.amount_kopecks,
          "obligationKopecks",
        ),
        confirmedPaidKopecks: safeKopecks(
          obligation.confirmed_paid_kopecks,
          "confirmedPaidKopecks",
        ),
        evidenceStatus: evidenceStatus(obligation.evidence_status),
        activeRequestKopecks: activeResult.rows[0]
          ? safeKopecks(
              activeResult.rows[0].amount_kopecks,
              "activeRequestKopecks",
            )
          : null,
      });
      if (decision.action !== "ISSUE") {
        await client.query("ROLLBACK");
        res.status(decision.action === "SKIP" ? 409 : 422).json({ decision });
        return;
      }

      const routeResult = await client.query<RouteRow>(
        `SELECT id, branch_crm_id, legal_entity_id::text, provider,
                provider_customer_code, merchant_id, recipient_label,
                fiscal_profile, fiscal_profile_status, is_active
           FROM payment_routes
          WHERE branch_crm_id = $1
            AND legal_entity_id = $2::uuid
            AND is_active = TRUE`,
        [obligation.branch_crm_id, obligation.legal_entity_id],
      );
      const routePairs = routeResult.rows.map((row) => ({
        row,
        candidate: {
          id: row.id,
          branchId: row.branch_crm_id,
          legalEntityId: row.legal_entity_id,
          active: row.is_active,
          provider: "tochka" as const,
          providerCustomerCode: row.provider_customer_code,
          merchantId: row.merchant_id,
          fiscalProfileStatus:
            row.fiscal_profile_status === "approved"
              ? ("APPROVED" as const)
              : row.fiscal_profile_status === "disabled"
                ? ("DISABLED" as const)
                : ("DRAFT" as const),
        },
      }));
      const routeResolution = resolvePaymentRoute(
        routePairs.map(({ candidate }) => candidate),
        obligation.branch_crm_id,
        obligation.legal_entity_id,
      );
      if (!routeResolution.ok) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "Маршрут оплаты не готов",
          reason: routeResolution.reason,
        });
        return;
      }
      const route = routePairs.find(
        ({ candidate }) => candidate.id === routeResolution.route.id,
      )?.row;
      if (!route) throw new Error("Resolved payment route disappeared");

      const paymentLinkId = `AH-${randomUUID()}`;
      const requestResult = await client.query<RequestRow>(
        `INSERT INTO payment_requests (
           obligation_id, route_id, amount_kopecks, currency, idempotency_key,
           payment_link_id, status, payer_contact_snapshot, fiscal_snapshot,
           created_by_user_id, created_at, updated_at
         ) VALUES ($1,$2,$3,'RUB',$4,$5,'ready',$6::jsonb,$7::jsonb,$8::uuid,NOW(),NOW())
         RETURNING id, obligation_id, route_id, amount_kopecks, currency,
                   payment_link_id, status, expires_at, created_at, updated_at`,
        [
          obligation.id,
          route.id,
          decision.outstandingKopecks,
          idempotencyKey,
          paymentLinkId,
          JSON.stringify({
            email: obligation.payer_email,
            phone: obligation.payer_phone,
          }),
          JSON.stringify(route.fiscal_profile ?? {}),
          auth.session.userId,
        ],
      );
      const created = requestResult.rows[0]!;
      await client.query(
        `INSERT INTO fiscal_receipts (
           request_id, kind, status, fiscal_profile_snapshot, created_at, updated_at
         ) VALUES ($1,'sale','expected',$2::jsonb,NOW(),NOW())`,
        [created.id, JSON.stringify(route.fiscal_profile ?? {})],
      );
      const safeEvent = {
        action: "REQUEST_PREPARED",
        amountKopecks: decision.outstandingKopecks,
        paymentLinkId,
      };
      await client.query(
        `INSERT INTO payment_events (
           request_id, provider, event_identity, event_type, payload_digest,
           safe_payload, actor_user_id, occurred_at, processed_at, created_at
         ) VALUES ($1,'internal',$2,'REQUEST_PREPARED',$3,$4::jsonb,$5::uuid,NOW(),NOW(),NOW())`,
        [
          created.id,
          `request-prepared:${created.id}`,
          sha256Hex(JSON.stringify(safeEvent)),
          JSON.stringify(safeEvent),
          auth.session.userId,
        ],
      );
      await client.query("COMMIT");
      res.status(201).json({
        ...publicRequest(created),
        recipientLabel: route.recipient_label,
        issueDecision: decision,
        providerActivation: "PENDING_TOCHKA_ADAPTER",
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((err as { code?: string }).code === "23505") {
        const replay = await pool.query<RequestRow>(
          `SELECT id, obligation_id, route_id, amount_kopecks, currency,
                  payment_link_id, status, expires_at, created_at, updated_at
             FROM payment_requests
            WHERE idempotency_key = $1`,
          [idempotencyKey],
        );
        if (replay.rows[0]) {
          res.json({ ...publicRequest(replay.rows[0]), idempotentReplay: true });
          return;
        }
      }
      logger.error({ err }, "Payment request preparation failed");
      res.status(503).json({ error: "Не удалось подготовить ссылку на оплату" });
    } finally {
      client.release();
    }
  },
);

paymentsRouter.get("/payments/requests", async (_req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  try {
    const owner = auth.session.role === "owner" || auth.session.scope.unrestricted;
    const base = `SELECT r.id, r.obligation_id, r.route_id, r.amount_kopecks,
                         r.currency, r.payment_link_id, r.status, r.expires_at,
                         r.created_at, r.updated_at, o.branch_crm_id,
                         o.legal_entity_id::text, o.purpose, pr.recipient_label,
                         fr.status AS receipt_status
                    FROM payment_requests r
                    JOIN payment_obligations o ON o.id = r.obligation_id
                    JOIN payment_routes pr ON pr.id = r.route_id
               LEFT JOIN fiscal_receipts fr
                      ON fr.request_id = r.id AND fr.kind = 'sale'`;
    const result = owner
      ? await pool.query<RequestRow>(`${base} ORDER BY r.created_at DESC LIMIT 200`)
      : await pool.query<RequestRow>(
          `${base}
            WHERE o.branch_crm_id = ANY($1::text[])
              AND o.legal_entity_id::text = ANY($2::text[])
            ORDER BY r.created_at DESC
            LIMIT 200`,
          [auth.session.scope.branchIds, auth.session.scope.legalEntityIds],
        );
    res.json(result.rows.map(publicRequest));
  } catch (err) {
    logger.error({ err }, "Payment requests list failed");
    res.status(503).json({ error: "Платёжные запросы временно недоступны" });
  }
});

paymentsRouter.post("/payments/requests/:requestId/cancel", async (req, res) => {
  const auth = requestAuth(res);
  if (!auth) return;
  if (!z.string().uuid().safeParse(req.params.requestId).success) {
    res.status(400).json({ error: "Некорректный идентификатор" });
    return;
  }
  try {
    const current = await pool.query<{
      id: string;
      status: string;
      branch_crm_id: string;
      legal_entity_id: string;
    }>(
      `SELECT r.id, r.status, o.branch_crm_id, o.legal_entity_id::text
         FROM payment_requests r
         JOIN payment_obligations o ON o.id = r.obligation_id
        WHERE r.id = $1`,
      [req.params.requestId],
    );
    const row = current.rows[0];
    if (!row) {
      res.status(404).json({ error: "Платёжный запрос не найден" });
      return;
    }
    if (!requirePaymentScope(res, auth, row.branch_crm_id, row.legal_entity_id)) {
      return;
    }
    if (row.status !== "ready") {
      res.status(409).json({
        error: "После передачи запроса провайдеру отмена выполняется отдельной операцией",
      });
      return;
    }
    const result = await pool.query<RequestRow>(
      `UPDATE payment_requests
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND status = 'ready'
        RETURNING id, obligation_id, route_id, amount_kopecks, currency,
                  payment_link_id, status, expires_at, created_at, updated_at`,
      [req.params.requestId],
    );
    const cancelled = result.rows[0];
    if (!cancelled) {
      res.status(409).json({ error: "Статус платежа уже изменился" });
      return;
    }
    const safeEvent = { action: "REQUEST_CANCELLED" };
    await pool.query(
      `INSERT INTO payment_events (
         request_id, provider, event_identity, event_type, payload_digest,
         safe_payload, actor_user_id, occurred_at, processed_at, created_at
       ) VALUES ($1,'internal',$2,'REQUEST_CANCELLED',$3,$4::jsonb,$5::uuid,NOW(),NOW(),NOW())`,
      [
        cancelled.id,
        `request-cancelled:${cancelled.id}:${randomUUID()}`,
        sha256Hex(JSON.stringify(safeEvent)),
        JSON.stringify(safeEvent),
        auth.session.userId,
      ],
    );
    res.json(publicRequest(cancelled));
  } catch (err) {
    logger.error({ err }, "Payment request cancellation failed");
    res.status(503).json({ error: "Не удалось отменить платёжный запрос" });
  }
});
