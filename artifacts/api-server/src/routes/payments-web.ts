import { Router, type Response } from "express";
import { pool } from "@workspace/db";
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
  return isOwner(auth) ||
    (auth.session.role === "payment_operator" &&
      auth.session.scope.branchIds.includes(branchCrmId));
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
    const base = `
      SELECT a.branch_crm_id,
             COALESCE(NULLIF(b.name, ''), NULLIF(a.branch_name, ''), a.operating_unit_code) AS branch_name,
             a.legal_entity_id::text,
             l.display_name AS legal_entity_name,
             l.legal_name
        FROM branch_legal_entity_assignments a
        JOIN legal_entities l ON l.id = a.legal_entity_id AND l.is_active = TRUE
   LEFT JOIN crm_branches b ON b.crm_id = a.branch_crm_id
       WHERE a.mapping_status = 'owner_confirmed'`;
    const result = isOwner(auth)
      ? await pool.query(`${base} ORDER BY branch_name, legal_entity_name`)
      : await pool.query(
          `${base}
             AND a.branch_crm_id = ANY($1::text[])
             AND a.legal_entity_id::text = ANY($2::text[])
           ORDER BY branch_name, legal_entity_name`,
          [auth.session.scope.branchIds, auth.session.scope.legalEntityIds],
        );
    res.json(
      result.rows.map((row) => ({
        branchCrmId: String(row.branch_crm_id),
        branchName: String(row.branch_name ?? row.branch_crm_id),
        legalEntityId: String(row.legal_entity_id),
        legalEntityName: String(row.legal_entity_name ?? row.legal_name ?? "Юридическое лицо"),
        legalName: row.legal_name == null ? null : String(row.legal_name),
      })),
    );
  } catch (err) {
    logger.error({ err }, "ArtHello Pay catalog failed");
    res.status(503).json({ error: "Справочник ArtHello Pay временно недоступен" });
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
    const scopeCheck = await pool.query<{ legal_entity_id: string }>(
      `SELECT legal_entity_id::text
         FROM branch_legal_entity_assignments
        WHERE branch_crm_id = $1
          AND mapping_status = 'owner_confirmed'
        LIMIT 1`,
      [parsed.data.branchCrmId],
    );
    const legalEntityId = scopeCheck.rows[0]?.legal_entity_id;
    if (!legalEntityId) {
      res.status(409).json({ error: "Для филиала не подтверждено юридическое лицо" });
      return;
    }
    if (!isOwner(auth) && !auth.session.scope.legalEntityIds.includes(legalEntityId)) {
      res.status(403).json({ error: "Недостаточно прав для юридического лица" });
      return;
    }

    const query = parsed.data.q.toLowerCase();
    const result = await pool.query<{
      student_crm_id: string;
      student_person_id: string | null;
      family_id: string | null;
      student_name: string | null;
      student_status: string | null;
      family_name: string | null;
      payer_person_id: string | null;
      payer_name: string | null;
      payer_phone: string | null;
      payer_email: string | null;
    }>(
      `SELECT s.crm_id AS student_crm_id,
              sp.student_person_id::text,
              sp.family_id::text,
              COALESCE(NULLIF(sp.full_name, ''), NULLIF(s.full_name, '')) AS student_name,
              COALESCE(NULLIF(sp.status, ''), NULLIF(s.status, '')) AS student_status,
              f.family_name,
              f.primary_guardian_person_id::text AS payer_person_id,
              COALESCE(NULLIF(g.full_name, ''), NULLIF(f.family_name, '')) AS payer_name,
              COALESCE(NULLIF(g.primary_phone, ''), NULLIF(f.primary_phone, ''), NULLIF(s.phone, '')) AS payer_phone,
              COALESCE(NULLIF(g.primary_email, ''), NULLIF(s.email, '')) AS payer_email
         FROM crm_students s
    LEFT JOIN student_profiles sp
           ON sp.student_crm_id = s.crm_id AND sp.record_state = 'current'
    LEFT JOIN families f ON f.id = sp.family_id
    LEFT JOIN persons g ON g.id = f.primary_guardian_person_id
        WHERE s.branch_crm_id = $1
          AND s.record_state = 'current'
          AND (
            $2 = '' OR
            LOWER(COALESCE(sp.full_name, s.full_name, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(f.family_name, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(g.full_name, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(g.primary_phone, f.primary_phone, s.phone, '')) LIKE '%' || $2 || '%'
          )
        ORDER BY COALESCE(sp.full_name, s.full_name, s.crm_id)
        LIMIT 60`,
      [parsed.data.branchCrmId, query],
    );
    res.json(
      result.rows.map((row) => ({
        branchCrmId: parsed.data.branchCrmId,
        legalEntityId,
        studentCrmId: row.student_crm_id,
        studentPersonId: row.student_person_id,
        familyId: row.family_id,
        studentName: row.student_name ?? `Ученик ${row.student_crm_id}`,
        status: row.student_status,
        payerPersonId: row.payer_person_id,
        payerName: row.payer_name,
        payerPhone: row.payer_phone,
        payerEmail: row.payer_email,
      })),
    );
  } catch (err) {
    logger.error({ err }, "ArtHello Pay customer search failed");
    res.status(503).json({ error: "Клиенты временно недоступны" });
  }
});

paymentsWebRouter.get("/payments/public/:paymentLinkId", async (req, res) => {
  const paymentLinkId = req.params.paymentLinkId?.trim() ?? "";
  if (!/^AH-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentLinkId)) {
    res.status(404).json({ error: "Платёжная ссылка не найдена" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const result = await pool.query<{
      payment_link_id: string;
      request_status: string;
      amount_kopecks: string | number;
      currency: string;
      provider_payment_url: string | null;
      purpose: string;
      billing_period: string | null;
      due_date: string | null;
      student_name: string | null;
      recipient_label: string;
      receipt_status: string | null;
      receipt_url: string | null;
    }>(
      `SELECT r.payment_link_id,
              r.status AS request_status,
              r.amount_kopecks,
              r.currency,
              r.provider_payment_url,
              o.purpose,
              o.billing_period::text,
              o.due_date::text,
              COALESCE(NULLIF(sp.full_name, ''), NULLIF(s.full_name, '')) AS student_name,
              pr.recipient_label,
              fr.status AS receipt_status,
              fr.receipt_url
         FROM payment_requests r
         JOIN payment_obligations o ON o.id = r.obligation_id
         JOIN payment_routes pr ON pr.id = r.route_id
    LEFT JOIN student_profiles sp ON sp.student_crm_id = o.student_crm_id
    LEFT JOIN crm_students s ON s.crm_id = o.student_crm_id
    LEFT JOIN fiscal_receipts fr ON fr.request_id = r.id AND fr.kind = 'sale'
        WHERE r.payment_link_id = $1
        LIMIT 1`,
      [paymentLinkId],
    );
    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: "Платёжная ссылка не найдена" });
      return;
    }
    const terminalStatuses = new Set(["paid", "fiscalized", "posted", "cancelled", "expired", "refunded"]);
    const canPay = Boolean(row.provider_payment_url) && !terminalStatuses.has(row.request_status);
    res.json({
      paymentLinkId: row.payment_link_id,
      status: row.request_status,
      amountKopecks: safeKopecks(row.amount_kopecks),
      currency: row.currency,
      purpose: row.purpose,
      billingPeriod: row.billing_period,
      dueDate: row.due_date,
      studentName: row.student_name,
      recipientLabel: row.recipient_label,
      receiptStatus: row.receipt_status,
      receiptUrl: row.receipt_url,
      canPay,
      paymentUrl: canPay ? row.provider_payment_url : null,
    });
  } catch (err) {
    logger.error({ err }, "Public ArtHello Pay request failed");
    res.status(503).json({ error: "Платёж временно недоступен" });
  }
});
