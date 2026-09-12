import { env } from "cloudflare:workers";
import {
  getAuthenticatedRequestContext,
  isCanonicalOwnerContext,
  verifyAuthenticatedRequestCsrf,
  type AuthenticatedRequestContext,
} from "./production-auth";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown[]>;
};

type PayEnv = { DB: D1Database };

type PayRoute = {
  branchCrmId: string;
  legalEntityId: string;
  legalEntityName: string;
};

type ObligationRow = {
  id: string;
  branch_id: string;
  legal_entity_id: string;
  recipient_label: string;
  family_entity_id: string | null;
  payer_entity_id: string | null;
  student_entity_id: string | null;
  student_crm_id: string | null;
  student_name: string | null;
  payer_name: string | null;
  billing_period: string | null;
  purpose: string;
  amount_minor: number;
  confirmed_paid_minor: number;
  currency: string;
  status: string;
  evidence_status: string;
  due_date: string | null;
  payer_email: string | null;
  payer_phone: string | null;
  source: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
};

type RequestRow = {
  id: string;
  obligation_id: string;
  amount_minor: number;
  currency: string;
  payment_link_id: string;
  status: string;
  recipient_label: string;
  provider_url: string | null;
  receipt_status: string | null;
  receipt_url: string | null;
  created_at: string;
  updated_at: string;
  branch_id?: string;
  legal_entity_id?: string;
  purpose?: string;
};

const ROUTES: Record<string, PayRoute> = {
  "BR-LISTVENNAYA": {
    branchCrmId: "BR-LISTVENNAYA",
    legalEntityId: "LEGAL-IP-TYURIN-PO",
    legalEntityName: "ИП Тюрин П.О.",
  },
  "BR-KINDERGARTEN": {
    branchCrmId: "BR-KINDERGARTEN",
    legalEntityId: "ORG-277DF050B72E",
    legalEntityName: "ООО «АртХелло»",
  },
  "BR-ATLAS-SCHOOL": {
    branchCrmId: "BR-ATLAS-SCHOOL",
    legalEntityId: "ORG-277DF050B72E",
    legalEntityName: "ООО «АртХелло»",
  },
  "BR-SCHOOL": {
    branchCrmId: "BR-SCHOOL",
    legalEntityId: "LEGAL-UK-DETSKOE-OBRAZOVANIE",
    legalEntityName: "ООО «УК Детское образование»",
  },
  "BR-NEBO": {
    branchCrmId: "BR-NEBO",
    legalEntityId: "LEGAL-UK-DETSKOE-OBRAZOVANIE",
    legalEntityName: "ООО «УК Детское образование»",
  },
};

const ACTIVE_REQUEST_STATUSES = ["ready", "link_creating", "waiting", "authorized"];
let tablesPromise: Promise<void> | undefined;

export class ArtHelloPayError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ArtHelloPayError";
  }
}

function database(): D1Database {
  const db = (env as unknown as PayEnv).DB;
  if (!db) throw new ArtHelloPayError("База ArtHello Pay недоступна", 503);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function uuid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function cleanText(value: unknown, max = 512) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalText(value: unknown, max = 512) {
  const cleaned = cleanText(value, max);
  return cleaned || null;
}

function validDate(value: unknown) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function positiveMinor(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new ArtHelloPayError("Сумма должна быть положительной");
  }
  return number;
}

function publicObligation(row: ObligationRow) {
  return {
    id: row.id,
    branchCrmId: row.branch_id,
    legalEntityId: row.legal_entity_id,
    familyId: row.family_entity_id,
    payerPersonId: row.payer_entity_id,
    studentPersonId: row.student_entity_id,
    studentCrmId: row.student_crm_id,
    studentName: row.student_name,
    payerName: row.payer_name,
    billingPeriod: row.billing_period,
    purpose: row.purpose,
    amountKopecks: Number(row.amount_minor),
    confirmedPaidKopecks: Number(row.confirmed_paid_minor),
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
    amountKopecks: Number(row.amount_minor),
    currency: row.currency,
    paymentLinkId: row.payment_link_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    branchCrmId: row.branch_id,
    legalEntityId: row.legal_entity_id,
    purpose: row.purpose,
    recipientLabel: row.recipient_label,
    receiptStatus: row.receipt_status,
  };
}

export async function ensureArtHelloPayTables() {
  if (!tablesPromise) {
    tablesPromise = (async () => {
      const db = database();
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS arthello_pay_obligations (
          id TEXT PRIMARY KEY NOT NULL,
          branch_id TEXT NOT NULL,
          legal_entity_id TEXT NOT NULL,
          recipient_label TEXT NOT NULL,
          family_entity_id TEXT,
          payer_entity_id TEXT,
          student_entity_id TEXT,
          student_crm_id TEXT,
          student_name TEXT,
          payer_name TEXT,
          billing_period TEXT,
          purpose TEXT NOT NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          confirmed_paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_paid_minor >= 0),
          currency TEXT NOT NULL DEFAULT 'RUB',
          status TEXT NOT NULL DEFAULT 'open',
          evidence_status TEXT NOT NULL DEFAULT 'unavailable',
          due_date TEXT,
          payer_email TEXT,
          payer_phone TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          source_ref TEXT UNIQUE,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS arthello_pay_requests (
          id TEXT PRIMARY KEY NOT NULL,
          obligation_id TEXT NOT NULL,
          amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
          currency TEXT NOT NULL DEFAULT 'RUB',
          payment_link_id TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'ready',
          recipient_label TEXT NOT NULL,
          provider_url TEXT,
          receipt_status TEXT NOT NULL DEFAULT 'expected',
          receipt_url TEXT,
          idempotency_key TEXT UNIQUE,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (obligation_id) REFERENCES arthello_pay_obligations(id)
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS arthello_pay_obligations_scope_idx ON arthello_pay_obligations(branch_id,legal_entity_id,created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS arthello_pay_requests_obligation_idx ON arthello_pay_requests(obligation_id,created_at)"),
      ]);
    })().catch((error) => {
      tablesPromise = undefined;
      throw error;
    });
  }
  await tablesPromise;
}

function userHasPayModule(context: AuthenticatedRequestContext) {
  const modules = context.auth.user.allowedModules ?? [];
  return context.auth.user.isAdministrative && (modules.includes("ArtHello Pay") || modules.includes("Оплаты"));
}

export async function requireArtHelloPayContext(request: Request, write = false) {
  const context = await getAuthenticatedRequestContext(request);
  if (!context) throw new ArtHelloPayError("Требуется вход", 401);
  if (!isCanonicalOwnerContext(context) && !userHasPayModule(context)) {
    throw new ArtHelloPayError("Нет доступа к ArtHello Pay", 403);
  }
  if (write) verifyAuthenticatedRequestCsrf(request, context);
  await ensureArtHelloPayTables();
  return context;
}

async function allowedBranchIds(context: AuthenticatedRequestContext) {
  if (isCanonicalOwnerContext(context)) return null;
  const rows = await database()
    .prepare("SELECT branch_id FROM user_branch_access WHERE user_id=? AND access_level<>'Нет доступа'")
    .bind(context.appUserId)
    .all<{ branch_id: string }>();
  return new Set(rows.results.map((row) => row.branch_id));
}

async function assertBranchAccess(context: AuthenticatedRequestContext, branchId: string) {
  const allowed = await allowedBranchIds(context);
  if (allowed && !allowed.has(branchId)) throw new ArtHelloPayError("Нет доступа к этому филиалу", 403);
}

function routeFor(branchId: string, legalEntityId?: string | null) {
  const route = ROUTES[branchId];
  if (!route) throw new ArtHelloPayError("Для филиала не настроен получатель", 409);
  if (legalEntityId && route.legalEntityId !== legalEntityId) {
    throw new ArtHelloPayError("Юридическое лицо не соответствует филиалу", 409);
  }
  return route;
}

export async function listPayCatalog(context: AuthenticatedRequestContext) {
  const allowed = await allowedBranchIds(context);
  const branches = await database()
    .prepare("SELECT id,name,status FROM organization_branches WHERE status IN ('Active','Активен','Активна') ORDER BY sort_order,name")
    .all<{ id: string; name: string; status: string }>();
  return branches.results
    .filter((branch) => ROUTES[branch.id] && (!allowed || allowed.has(branch.id)))
    .map((branch) => {
      const route = ROUTES[branch.id]!;
      return {
        branchCrmId: branch.id,
        branchName: branch.name,
        legalEntityId: route.legalEntityId,
        legalEntityName: route.legalEntityName,
        routeReady: true,
        providerActivation: "PENDING_TOCHKA_ADAPTER",
      };
    });
}

export async function searchPayCustomers(
  context: AuthenticatedRequestContext,
  branchId: string,
  _query: string,
) {
  await assertBranchAccess(context, branchId);
  routeFor(branchId);
  // Live v52 currently has no normalized family rows. Keep this endpoint
  // fail-closed instead of guessing from unrelated entities; the UI offers an
  // explicit manual payer/student fallback until family synchronization fills it.
  return [] as Array<Record<string, unknown>>;
}

export async function listPayObligations(context: AuthenticatedRequestContext) {
  const allowed = await allowedBranchIds(context);
  const result = await database()
    .prepare(`SELECT * FROM arthello_pay_obligations ORDER BY created_at DESC LIMIT 300`)
    .all<ObligationRow>();
  return result.results.filter((row) => !allowed || allowed.has(row.branch_id)).map(publicObligation);
}

export async function createPayObligation(
  context: AuthenticatedRequestContext,
  body: Record<string, unknown>,
) {
  const branchId = cleanText(body.branchCrmId, 80);
  if (!branchId) throw new ArtHelloPayError("Не выбран филиал");
  await assertBranchAccess(context, branchId);
  const route = routeFor(branchId, cleanText(body.legalEntityId, 100));
  const purpose = cleanText(body.purpose, 512);
  if (purpose.length < 2) throw new ArtHelloPayError("Укажите назначение оплаты");
  const amountMinor = positiveMinor(body.amountKopecks);
  const payerEmail = optionalText(body.payerEmail, 320);
  const payerPhone = optionalText(body.payerPhone, 40);
  if (!payerEmail && !payerPhone) throw new ArtHelloPayError("Укажите email или телефон для электронного чека");
  const studentName = optionalText(body.studentName, 200);
  const studentCrmId = optionalText(body.studentCrmId, 160);
  if (!studentName && !studentCrmId) throw new ArtHelloPayError("Укажите ребёнка или выберите клиента из справочника");
  const sourceRef = optionalText(body.sourceRef, 240);
  const createdAt = nowIso();
  const id = uuid("PAYO");
  try {
    await database().prepare(`INSERT INTO arthello_pay_obligations (
      id,branch_id,legal_entity_id,recipient_label,family_entity_id,payer_entity_id,
      student_entity_id,student_crm_id,student_name,payer_name,billing_period,purpose,
      amount_minor,confirmed_paid_minor,currency,status,evidence_status,due_date,
      payer_email,payer_phone,source,source_ref,created_by,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,'RUB','open','unavailable',?,?,?,?,?,?,?)`)
      .bind(
        id,
        branchId,
        route.legalEntityId,
        route.legalEntityName,
        optionalText(body.familyId, 120),
        optionalText(body.payerPersonId, 120),
        optionalText(body.studentPersonId, 120),
        studentCrmId,
        studentName,
        optionalText(body.payerName, 200),
        validDate(body.billingPeriod),
        purpose,
        amountMinor,
        validDate(body.dueDate),
        payerEmail,
        payerPhone,
        "manual",
        sourceRef,
        context.appUserId,
        createdAt,
        createdAt,
      ).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      throw new ArtHelloPayError("Такое начисление уже существует", 409);
    }
    throw error;
  }
  const row = await database().prepare("SELECT * FROM arthello_pay_obligations WHERE id=?")
    .bind(id).first<ObligationRow>();
  if (!row) throw new ArtHelloPayError("Не удалось сохранить начисление", 503);
  return publicObligation(row);
}

async function obligationFor(context: AuthenticatedRequestContext, id: string) {
  const row = await database().prepare("SELECT * FROM arthello_pay_obligations WHERE id=?")
    .bind(id).first<ObligationRow>();
  if (!row) throw new ArtHelloPayError("Начисление не найдено", 404);
  await assertBranchAccess(context, row.branch_id);
  return row;
}

async function activeRequest(obligationId: string) {
  const placeholders = ACTIVE_REQUEST_STATUSES.map(() => "?").join(",");
  return database().prepare(`SELECT * FROM arthello_pay_requests WHERE obligation_id=? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`)
    .bind(obligationId, ...ACTIVE_REQUEST_STATUSES).first<RequestRow>();
}

function issueDecision(obligation: ObligationRow, active: RequestRow | null) {
  const outstanding = Number(obligation.amount_minor) - Number(obligation.confirmed_paid_minor);
  if (obligation.evidence_status === "ambiguous") {
    return { action: "REVIEW", reason: "Неоднозначные данные об оплате", outstandingKopecks: Math.max(0, outstanding) };
  }
  if (outstanding <= 0 || obligation.status === "paid") {
    return { action: "SKIP", reason: "Начисление уже оплачено", outstandingKopecks: 0 };
  }
  if (active) {
    const same = Number(active.amount_minor) === outstanding;
    return {
      action: same ? "SKIP" : "REVIEW",
      reason: same ? "Активная ссылка уже существует" : "Активная ссылка имеет другую сумму",
      outstandingKopecks: outstanding,
    };
  }
  return { action: "ISSUE", reason: "Можно создать платёжный запрос", outstandingKopecks: outstanding };
}

export async function previewPayRequest(context: AuthenticatedRequestContext, obligationId: string) {
  const obligation = await obligationFor(context, obligationId);
  const active = await activeRequest(obligation.id);
  const decision = issueDecision(obligation, active);
  const route = routeFor(obligation.branch_id, obligation.legal_entity_id);
  return {
    decision,
    route: {
      ready: true,
      recipientLabel: route.legalEntityName,
      providerActivation: "PENDING_TOCHKA_ADAPTER",
    },
  };
}

export async function createPayRequest(
  context: AuthenticatedRequestContext,
  obligationId: string,
  idempotencyKeyValue: string | null,
) {
  const clientKey = cleanText(idempotencyKeyValue, 128);
  if (clientKey.length < 16) throw new ArtHelloPayError("Требуется уникальный Idempotency-Key");
  const idempotencyKey = `${context.appUserId}:${clientKey}`;
  const replay = await database().prepare("SELECT * FROM arthello_pay_requests WHERE idempotency_key=?")
    .bind(idempotencyKey).first<RequestRow>();
  if (replay) return { ...publicRequest(replay), idempotentReplay: true };

  const obligation = await obligationFor(context, obligationId);
  const active = await activeRequest(obligation.id);
  const decision = issueDecision(obligation, active);
  if (decision.action !== "ISSUE") {
    throw new ArtHelloPayError(decision.reason, decision.action === "SKIP" ? 409 : 422);
  }
  const route = routeFor(obligation.branch_id, obligation.legal_entity_id);
  const id = uuid("PAYR");
  const paymentLinkId = `AH-${crypto.randomUUID()}`;
  const createdAt = nowIso();
  try {
    await database().prepare(`INSERT INTO arthello_pay_requests (
      id,obligation_id,amount_minor,currency,payment_link_id,status,recipient_label,
      provider_url,receipt_status,receipt_url,idempotency_key,created_by,created_at,updated_at
    ) VALUES (?,?,?,'RUB',?,'ready',?,NULL,'expected',NULL,?,?,?,?)`)
      .bind(
        id,
        obligation.id,
        decision.outstandingKopecks,
        paymentLinkId,
        route.legalEntityName,
        idempotencyKey,
        context.appUserId,
        createdAt,
        createdAt,
      ).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      const secondReplay = await database().prepare("SELECT * FROM arthello_pay_requests WHERE idempotency_key=?")
        .bind(idempotencyKey).first<RequestRow>();
      if (secondReplay) return { ...publicRequest(secondReplay), idempotentReplay: true };
    }
    throw error;
  }
  const row = await database().prepare("SELECT * FROM arthello_pay_requests WHERE id=?")
    .bind(id).first<RequestRow>();
  if (!row) throw new ArtHelloPayError("Не удалось создать платёжный запрос", 503);
  return {
    ...publicRequest(row),
    branchCrmId: obligation.branch_id,
    legalEntityId: obligation.legal_entity_id,
    purpose: obligation.purpose,
    issueDecision: decision,
    providerActivation: "PENDING_TOCHKA_ADAPTER",
  };
}

export async function listPayRequests(context: AuthenticatedRequestContext) {
  const allowed = await allowedBranchIds(context);
  const result = await database().prepare(`SELECT
      r.*,o.branch_id,o.legal_entity_id,o.purpose
    FROM arthello_pay_requests r
    JOIN arthello_pay_obligations o ON o.id=r.obligation_id
    ORDER BY r.created_at DESC LIMIT 300`)
    .all<RequestRow>();
  return result.results.filter((row) => !allowed || allowed.has(row.branch_id ?? "")).map(publicRequest);
}

export async function cancelPayRequest(context: AuthenticatedRequestContext, requestId: string) {
  const row = await database().prepare(`SELECT r.*,o.branch_id,o.legal_entity_id,o.purpose
    FROM arthello_pay_requests r JOIN arthello_pay_obligations o ON o.id=r.obligation_id WHERE r.id=?`)
    .bind(requestId).first<RequestRow>();
  if (!row) throw new ArtHelloPayError("Платёжный запрос не найден", 404);
  await assertBranchAccess(context, row.branch_id ?? "");
  if (row.status !== "ready") throw new ArtHelloPayError("Этот платёжный запрос уже нельзя отменить", 409);
  const updatedAt = nowIso();
  await database().prepare("UPDATE arthello_pay_requests SET status='cancelled',updated_at=? WHERE id=? AND status='ready'")
    .bind(updatedAt, requestId).run();
  const updated = await database().prepare("SELECT * FROM arthello_pay_requests WHERE id=?")
    .bind(requestId).first<RequestRow>();
  if (!updated) throw new ArtHelloPayError("Платёжный запрос не найден", 404);
  return publicRequest(updated);
}

export async function publicPayRequest(paymentLinkId: string) {
  if (!/^AH-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentLinkId)) {
    throw new ArtHelloPayError("Ссылка на оплату некорректна", 404);
  }
  const tables = await database().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='arthello_pay_requests'")
    .first<{ name: string }>();
  if (!tables) throw new ArtHelloPayError("Ссылка на оплату не найдена", 404);
  const row = await database().prepare(`SELECT
      r.*,o.branch_id,o.legal_entity_id,o.purpose,o.billing_period,o.due_date,
      o.student_name,o.student_crm_id
    FROM arthello_pay_requests r
    JOIN arthello_pay_obligations o ON o.id=r.obligation_id
    WHERE r.payment_link_id=?`)
    .bind(paymentLinkId).first<RequestRow & {
      billing_period: string | null;
      due_date: string | null;
      student_name: string | null;
      student_crm_id: string | null;
    }>();
  if (!row || row.status === "cancelled") throw new ArtHelloPayError("Ссылка на оплату недоступна", 404);
  return {
    paymentLinkId: row.payment_link_id,
    status: row.status,
    amountKopecks: Number(row.amount_minor),
    currency: row.currency,
    purpose: row.purpose,
    billingPeriod: row.billing_period,
    dueDate: row.due_date,
    branchCrmId: row.branch_id,
    legalEntityId: row.legal_entity_id,
    recipientLabel: row.recipient_label,
    studentName: row.student_name || (row.student_crm_id ? `Ученик ${row.student_crm_id}` : null),
    receiptStatus: row.receipt_status,
    receiptUrl: row.receipt_url,
    canPay: Boolean(row.provider_url),
    paymentUrl: row.provider_url,
    providerActivation: row.provider_url ? "ACTIVE" : "PENDING_TOCHKA_ADAPTER",
  };
}
