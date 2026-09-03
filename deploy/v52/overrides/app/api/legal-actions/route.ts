import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, entities, legalChecks, legalContracts, legalDocumentItems, tasks } from "../../../db/schema";
import { nextLegalVersion } from "../../../lib/legal";
import { LEGAL_CONTRACT_OCR_POLICY, legalScanSubjectHash } from "../../../lib/legal-scan";
import { getAuthenticatedRequestContext, verifyAuthenticatedRequestCsrf } from "../../../lib/production-auth";
import { isTaskManager, resolveTaskAssignment, type TaskAccessContext } from "../../../lib/task-access";
import { findScopedAutomationTask, scopedAutomationTaskResponse } from "../../../lib/task-access-query";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown[]>;
};

type ScanDraftStatus = "recognized" | "manual";
type ClaimedScanDraft = {
  status: ScanDraftStatus;
  modelVersion: string;
  policyVersion: string;
};

const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "LEGAL"]);
const electronicVersionApprovers = new Set<string>(LEGAL_CONTRACT_OCR_POLICY.approverRoles);

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const actor = context.actor;
  const role = context.apiRole;
  if (!editors.has(role)) return Response.json({ error: "Нет прав на юридическое действие" }, { status: 403 });
  try {
    verifyAuthenticatedRequestCsrf(request, context);
  } catch {
    return Response.json({ error: "Защитная сессия устарела. Войдите заново." }, { status: 403 });
  }
  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 50);
    if (action === "createContract") return createContract(actor, context.appUserId, role, body);
    if (action === "createDocumentVersion") return version(actor, body);
    if (action === "addDocument") return addDocument(actor, body);
    if (action === "createSignalTask") return signalTask(context, body);
    if (action === "resolveSignal") return resolve(actor, body);
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    console.error("Legal action failed", { type: error instanceof Error ? error.name : "UnknownFailure" });
    return Response.json({ error: "Юридическое действие временно не выполнено" }, { status: 500 });
  }
}

async function createContract(actor: string, appUserId: string, role: string, body: Record<string, unknown>) {
  const scanDraftId = clean(body.scanDraftId, 80);
  const submittedFullText = typeof body.fullText === "string" ? body.fullText : "";
  if (submittedFullText.length > LEGAL_CONTRACT_OCR_POLICY.maxFullTextChars) {
    return Response.json({ error: "Электронная версия договора должна быть не больше 50 000 символов" }, { status: 400 });
  }
  const fullText = normalizeContractText(submittedFullText);
  const hasElectronicVersion = Boolean(scanDraftId || fullText);
  if (hasElectronicVersion && !electronicVersionApprovers.has(role)) {
    return Response.json({ error: "Электронную версию договора может подтвердить только собственник или юрист" }, { status: 403 });
  }
  if (hasElectronicVersion && LEGAL_CONTRACT_OCR_POLICY.humanApprovalRequired
    && body.humanConfirmed !== "on" && body.humanConfirmed !== true) {
    return Response.json({ error: "Подтвердите, что реквизиты и полный текст проверены человеком" }, { status: 400 });
  }
  if (hasElectronicVersion && fullText.length < 20) {
    return Response.json({ error: "Проверьте и заполните полный текст электронной версии договора" }, { status: 400 });
  }
  const partyName = clean(body.partyName, 180);
  const partyType = clean(body.partyType, 60) || "Контрагент";
  const contractType = clean(body.contractType, 80) || "Договор";
  const number = clean(body.number, 80);
  const validFrom = clean(body.validFrom, 10);
  const validUntil = clean(body.validUntil, 10);
  const signedStatus = clean(body.signedStatus, 40) || "Не подписан";
  const limitRubles = Number(body.limitRubles ?? 0);
  const closingRequired = body.closingRequired === true || body.closingRequired === "on";
  if (partyName.length < 3 || number.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || validUntil < validFrom) {
    return Response.json({ error: "Заполните сторону, номер и корректный срок договора" }, { status: 400 });
  }
  if (!Number.isFinite(limitRubles) || limitRubles < 0) return Response.json({ error: "Проверьте сумму или лимит договора" }, { status: 400 });

  let claimedDraft: ClaimedScanDraft | null = null;
  let scanOwnerKey = "";
  if (scanDraftId) {
    scanOwnerKey = await legalScanSubjectHash(appUserId);
    const claim = await claimScanDraft(scanDraftId, scanOwnerKey);
    if (claim instanceof Response) return claim;
    claimedDraft = claim;
  }

  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const partyId = `ENT-${suffix}`;
  const contractId = `LCON-${suffix}`;
  const referenceDocumentId = `DOG-${suffix}`;
  const stableId = `LGLDOC-${suffix}`;
  const documentItemId = `${stableId}-V1`;
  const createdAt = new Date().toISOString();
  const limitMinor = Math.round(limitRubles * 100);
  const database = rawDatabase();
  try {
    const statements = [
      database.prepare(`INSERT INTO entities
        (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(partyId, partyType, partyName, "Активна", "MANUAL", `LEGAL:${partyId}`, "Проверено", "Юридический контур", "{}", actor, createdAt, createdAt),
      database.prepare(`INSERT INTO legal_contracts
        (id,reference_document_id,contract_type,party_type,party_entity_id,number,signed_status,valid_from,valid_until,
         limit_minor,spent_minor,status,electronic_signature_status,requisite_status,owner_entity_id,closing_required,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(contractId, referenceDocumentId, contractType, partyType, partyId, number, signedStatus, validFrom, validUntil,
          limitMinor, 0, "На проверке", "ЭП не подключена", "Требуют проверки", "", closingRequired ? 1 : 0, createdAt, createdAt),
      database.prepare(`INSERT INTO legal_document_items
        (id,stable_id,contract_id,item_type,title,version,required,signed_status,status,due_date,reference,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(documentItemId, stableId, contractId, "Договор", `${contractType} № ${number}`, 1, 1, signedStatus,
          "На проверке", validUntil, scanDraftId ? "Подтверждённый электронный черновик" : "Ручной ввод", createdAt),
    ];
    if (fullText) {
      const modelVersion = claimedDraft?.status === "recognized"
        ? claimedDraft.modelVersion
        : "Не применялась";
      const sourceMode = claimedDraft?.status === "recognized"
        ? "Распознавание, проверенное человеком"
        : scanDraftId ? "Ручная расшифровка скана" : "Ручной ввод";
      statements.push(database.prepare(`INSERT INTO legal_contract_text_versions
        (id,stable_id,contract_id,document_item_id,version,body_text,source_mode,model_version,policy_version,
         protection_class,confirmed_by,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(`${stableId}-TEXT-V1`, stableId, contractId, documentItemId, 1, fullText, sourceMode, modelVersion,
          claimedDraft?.policyVersion || LEGAL_CONTRACT_OCR_POLICY.version,
          "Юридический документ · ограниченный доступ", actor, createdAt));
    }
    statements.push(database.prepare(`INSERT INTO audit_events
      (actor,action,entity_type,entity_id,payload,created_at) VALUES (?,'legal.contract_created','legal_contract',?,?,?)`)
      .bind(actor, contractId, JSON.stringify({ creationMode: scanDraftId ? "confirmed_draft" : "manual" }), createdAt));
    if (scanDraftId) {
      statements.push(database.prepare(`UPDATE legal_scan_drafts SET status='confirmed'
        WHERE id=? AND owner_user_id=? AND status='consuming'`).bind(scanDraftId, scanOwnerKey));
    }
    await database.batch(statements);
  } catch (error) {
    if (scanDraftId && claimedDraft) {
      try {
        await releaseScanDraft(scanDraftId, scanOwnerKey, claimedDraft.status);
      } catch {
        // The claim expires automatically; never attempt a compensating business delete.
      }
    }
    throw error;
  }
  return Response.json({
    contract: {
      id: contractId,
      referenceDocumentId,
      contractType,
      partyType,
      partyEntityId: partyId,
      number,
      signedStatus,
      validFrom,
      validUntil,
      limitMinor,
      spentMinor: 0,
      status: "На проверке",
      electronicSignatureStatus: "ЭП не подключена",
      requisiteStatus: "Требуют проверки",
      ownerEntityId: "",
      closingRequired,
      createdAt,
      updatedAt: createdAt,
    },
  }, { status: 201 });
}

async function claimScanDraft(draftId: string, ownerKey: string): Promise<ClaimedScanDraft | Response> {
  if (!/^SCAN-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)) {
    return Response.json({ error: "Некорректный временный черновик" }, { status: 400 });
  }
  const database = rawDatabase();
  const now = Math.floor(Date.now() / 1000);
  await database.prepare("DELETE FROM legal_scan_drafts WHERE expires_at <= ?").bind(now).run();
  const draft = await database.prepare(`SELECT id,status,model_version,policy_version FROM legal_scan_drafts
    WHERE id=? AND owner_user_id=? AND expires_at>?`).bind(draftId, ownerKey, now)
    .first<{ id: string; status: string; model_version: string; policy_version: string }>();
  if (!draft || !new Set(["recognized", "manual"]).has(draft.status)) {
    return Response.json({ error: "Черновик уже использован или истёк. Загрузите скан ещё раз или продолжите ручной ввод" }, { status: 409 });
  }
  const status = draft.status as ScanDraftStatus;
  const claimed = await database.prepare(`UPDATE legal_scan_drafts SET status='consuming'
    WHERE id=? AND owner_user_id=? AND expires_at>? AND status=? RETURNING id`)
    .bind(draftId, ownerKey, now, status).first<{ id: string }>();
  if (!claimed) {
    return Response.json({ error: "Черновик уже подтверждается в другом окне" }, { status: 409 });
  }
  return {
    status,
    modelVersion: draft.model_version || "Не применялась",
    policyVersion: draft.policy_version || LEGAL_CONTRACT_OCR_POLICY.version,
  };
}

async function releaseScanDraft(draftId: string, ownerKey: string, previousStatus: ScanDraftStatus) {
  const now = Math.floor(Date.now() / 1000);
  await rawDatabase().prepare(`UPDATE legal_scan_drafts SET status=?
    WHERE id=? AND owner_user_id=? AND expires_at>? AND status='consuming'`)
    .bind(previousStatus, draftId, ownerKey, now).run();
}

function rawDatabase() {
  return (env as unknown as { DB: D1Database }).DB;
}

function normalizeContractText(value: string) {
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
}

async function version(actor: string, body: Record<string, unknown>) {
  const stableId = clean(body.stableId, 80);
  const reference = clean(body.reference, 300);
  const db = getDb();
  if (reference.length < 5) return Response.json({ error: "Укажите основание или ссылку новой версии" }, { status: 400 });
  const [latest] = await db.select().from(legalDocumentItems).where(eq(legalDocumentItems.stableId, stableId)).orderBy(desc(legalDocumentItems.version)).limit(1);
  if (!latest) return Response.json({ error: "Документ не найден" }, { status: 404 });
  const nextVersion = nextLegalVersion(latest.version);
  const id = `${stableId}-V${nextVersion}`;
  const [row] = await db.insert(legalDocumentItems).values({ ...latest, id, version: nextVersion, reference, status: "На проверке", createdAt: new Date().toISOString() }).returning();
  await audit(actor, "legal.document_version_added", "legal_document", stableId, { from: latest.version, to: nextVersion, reference });
  return Response.json({ document: row }, { status: 201 });
}

async function addDocument(actor: string, body: Record<string, unknown>) {
  const contractId = clean(body.contractId, 80);
  const itemType = clean(body.itemType, 40);
  const title = clean(body.title, 200);
  const reference = clean(body.reference, 300);
  const db = getDb();
  if (!contractId || isDemoReference(contractId) || !itemType || title.length < 4) return Response.json({ error: "Укажите рабочий договор, тип и название" }, { status: 400 });
  const [contract] = await db.select().from(legalContracts).where(eq(legalContracts.id, contractId)).limit(1);
  if (!contract) return Response.json({ error: "Договор не найден" }, { status: 404 });
  const stableId = `LGLDOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const id = `${stableId}-V1`;
  const [row] = await db.insert(legalDocumentItems).values({ id, stableId, contractId, itemType, title, version: 1, required: false, signedStatus: "Не подписано", status: reference ? "На проверке" : "Метаданные", reference }).returning();
  await audit(actor, "legal.document_added", "legal_document", stableId, { contractId, itemType });
  return Response.json({ document: row }, { status: 201 });
}

async function signalTask(context: TaskAccessContext, body: Record<string, unknown>) {
  const actor = context.actor;
  const id = clean(body.signalId, 80);
  const assigneeEntityId = clean(body.assigneeEntityId, 80);
  const db = getDb();
  const key = `LEGAL_SIGNAL:${id}`;
  const [signal] = await db.select().from(legalChecks).where(eq(legalChecks.id, id)).limit(1);
  if (!signal) return Response.json({ error: "Сигнал не найден" }, { status: 404 });
  const assignment = resolveTaskAssignment(context, assigneeEntityId, actor);
  if (!assignment.ok) return Response.json({ error: assignment.error }, { status: assignment.status });
  if (isTaskManager(context) && assignment.assigneeEntityId) {
    if (isDemoReference(assignment.assigneeEntityId)) return Response.json({ error: "Выберите исполнителя из рабочего справочника" }, { status: 400 });
    const [assignee] = await db.select({ id: entities.id }).from(entities).where(eq(entities.id, assignment.assigneeEntityId)).limit(1);
    if (!assignee) return Response.json({ error: "Исполнитель не найден" }, { status: 404 });
  }
  const existing = await findScopedAutomationTask(db, context, key);
  const existingResponse = scopedAutomationTaskResponse(existing);
  if (existingResponse) return existingResponse;
  const [task] = await db.insert(tasks).values({ title: signal.recommendation, owner: assignment.owner, dueDate: dateAfterDays(signal.severity === "Критичный" ? 1 : 5), priority: signal.severity === "Критичный" ? "Критичный" : "Высокий", status: "Входящие", sourceType: "Юридический сигнал", sourceId: id, description: `${signal.evidence}. Проверить документы и зафиксировать решение без обвинений.`, assigneeEntityId: assignment.assigneeEntityId, kind: "Автозадача", automationKey: key, requiresApproval: true, createdByUserId: context.appUserId, createdBy: actor }).returning();
  await db.update(legalChecks).set({ relatedTaskId: task.id, status: "В работе" }).where(eq(legalChecks.id, id));
  await audit(actor, "legal.signal_task_created", "legal_check", id, { taskId: task.id, assigneeEntityId: assignment.assigneeEntityId });
  return Response.json({ task }, { status: 201 });
}

async function resolve(actor: string, body: Record<string, unknown>) {
  const id = clean(body.signalId, 80);
  const resolution = clean(body.resolution, 600);
  if (resolution.length < 12) return Response.json({ error: "Нужно проверяемое основание закрытия" }, { status: 400 });
  const db = getDb();
  const [signal] = await db.select().from(legalChecks).where(eq(legalChecks.id, id)).limit(1);
  if (!signal) return Response.json({ error: "Сигнал не найден" }, { status: 404 });
  if (signal.status === "Закрыт") return Response.json({ signal, reused: true });
  const [row] = await db.update(legalChecks).set({ status: "Закрыт", resolution, resolvedAt: new Date().toISOString() }).where(eq(legalChecks.id, id)).returning();
  await audit(actor, "legal.signal_resolved", "legal_check", id, { resolution });
  return Response.json({ signal: row });
}

function isDemoReference(value: string) { return /(^|[-_])(T|TEST)([-_]|$)|SYNTHETIC/i.test(value); }
function dateAfterDays(days: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
async function audit(actor: string, action: string, entityType: string, entityId: string, payload: unknown) { await getDb().insert(auditEvents).values({ actor, action, entityType, entityId, payload: JSON.stringify(payload) }); }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
