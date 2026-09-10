import { env } from "cloudflare:workers";
import {
  getAuthenticatedRequestContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../../lib/production-auth";
import {
  LEGAL_CONTRACT_OCR_POLICY,
  LEGAL_CONTRACT_OCR_PROMPT,
  legalScanEnvelopeIssue,
  legalScanSubjectHash,
  MAX_LEGAL_SCAN_BYTES,
} from "../../../../lib/legal-scan";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  run: () => Promise<unknown>;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
};

type LegalOcrEnv = {
  DB: {
    prepare: (query: string) => D1Statement;
    batch: (statements: D1Statement[]) => Promise<unknown[]>;
  };
  OPENAI_API_KEY?: string;
  OPENAI_OCR_MODEL?: string;
};

type ContractDraft = {
  partyName: string;
  partyType: string;
  contractType: string;
  number: string;
  validFrom: string;
  validUntil: string;
  limitRubles: string;
  signedStatus: string;
  closingRequired: boolean;
  fullText: string;
};

const DRAFT_TTL_SECONDS = 2 * 60 * 60;
const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_WINDOW_REQUESTS = 5;
const SCAN_LEASE_SECONDS = 2 * 60;
const allowedRoles = new Set<string>(LEGAL_CONTRACT_OCR_POLICY.approverRoles);
const allowedMediaTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const allowedMultipartFields = new Set(["document", "consent"]);
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};
let draftStoragePromise: Promise<void> | undefined;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const envelopeIssue = legalScanEnvelopeIssue(request.headers);
  if (envelopeIssue) return json({ error: envelopeIssue.error }, envelopeIssue.status);

  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return json({ error: "Сервис авторизации временно недоступен" }, 503);
  }
  if (!context) return json({ error: "Требуется вход" }, 401);
  if (!allowedRoles.has(context.apiRole)) {
    return json({ error: "Распознавание договора доступно собственнику и юристу" }, 403);
  }
  try {
    verifyAuthenticatedRequestCsrf(request, context);
  } catch {
    return json({ error: "Защитная сессия устарела. Войдите заново." }, 403);
  }

  const runtime = env as unknown as LegalOcrEnv;
  if (!runtime.DB) return json({ error: "База временных черновиков недоступна" }, 503);
  const now = Math.floor(Date.now() / 1000);
  let subjectHash = "";
  let leaseUntil = 0;
  try {
    subjectHash = await legalScanSubjectHash(context.appUserId);
    await ensureDraftStorage(runtime);
    leaseUntil = await acquireScanSlot(runtime, subjectHash, now);
  } catch (error) {
    console.error("Legal scan rate-limit storage failed", error);
    return json({ error: "База временных черновиков недоступна" }, 503);
  }
  if (!leaseUntil) {
    return json({ error: "Распознавание уже выполняется или лимит запросов исчерпан. Повторите позже." }, 429);
  }
  try {
    return await processScan(request, runtime, subjectHash, now);
  } catch (error) {
    console.error("Legal scan request failed", error);
    return json({ error: "Распознавание временно недоступно. Заполните договор вручную." }, 503);
  } finally {
    try {
      await releaseScanSlot(runtime, subjectHash, leaseUntil);
    } catch (error) {
      console.error("Legal scan concurrency lease release failed", error);
    }
  }
}

async function processScan(request: Request, runtime: LegalOcrEnv, subjectHash: string, now: number) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Не удалось прочитать загруженный файл" }, 400);
  }
  const entries = Array.from(form.entries());
  if (entries.length !== 2
    || entries.some(([name]) => !allowedMultipartFields.has(name))
    || form.getAll("document").length !== 1
    || form.getAll("consent").length !== 1) {
    return json({ error: "Форма содержит лишние или повторяющиеся поля" }, 400);
  }
  if (form.get("consent") !== "yes") {
    return json({ error: "Подтвердите передачу скана сервису распознавания" }, 400);
  }
  const file = form.get("document");
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Выберите скан договора" }, 400);
  }
  if (file.size > MAX_LEGAL_SCAN_BYTES) {
    return json({ error: "Скан договора должен быть не больше 8 МБ" }, 413);
  }
  const claimedMediaType = file.type.trim().toLowerCase();
  if (claimedMediaType && !allowedMediaTypes.has(claimedMediaType)) {
    return json({ error: "Поддерживаются PDF, JPG и PNG" }, 415);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedMediaType = detectMediaType(bytes);
  if (!detectedMediaType || (claimedMediaType && detectedMediaType !== claimedMediaType)) {
    return json({ error: "Содержимое файла не соответствует PDF, JPG или PNG" }, 415);
  }

  const draftId = `SCAN-${crypto.randomUUID()}`;
  const apiKey = runtime.OPENAI_API_KEY?.trim();
  const modelVersion = apiKey ? selectedOcrModel(runtime) : "Не применялась";
  try {
    await runtime.DB.batch([
      runtime.DB.prepare("DELETE FROM legal_scan_drafts WHERE expires_at <= ?").bind(now),
      runtime.DB.prepare(`INSERT INTO legal_scan_drafts
        (id,owner_user_id,media_type,size_bytes,status,model_version,policy_version,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(draftId, subjectHash, detectedMediaType, bytes.byteLength, "processing", modelVersion,
          LEGAL_CONTRACT_OCR_POLICY.version, now, now + DRAFT_TTL_SECONDS),
    ]);
  } catch (error) {
    console.error("Legal scan draft creation failed", error);
    return json({ error: "Не удалось создать безопасный временный черновик" }, 503);
  }

  if (!apiKey) {
    await setDraftStatus(runtime, draftId, "manual", "Не применялась");
    return json({
      draftId,
      draft: emptyDraft(),
      mode: "manual",
      stored: false,
      expiresInSeconds: DRAFT_TTL_SECONDS,
      message: "Распознавание пока не подключено. Заполните электронный черновик вручную.",
    });
  }

  try {
    const draft = await recognizeContract(bytes, detectedMediaType, apiKey, modelVersion);
    await setDraftStatus(runtime, draftId, "recognized", modelVersion);
    return json({
      draftId,
      draft,
      mode: "recognized",
      stored: false,
      expiresInSeconds: DRAFT_TTL_SECONDS,
      message: "Черновик распознан. Проверьте каждое поле перед созданием договора.",
    });
  } catch {
    await setDraftStatus(runtime, draftId, "manual", "Не применялась");
    return json({
      draftId,
      draft: emptyDraft(),
      mode: "manual",
      stored: false,
      expiresInSeconds: DRAFT_TTL_SECONDS,
      message: "Скан не удалось распознать. Можно продолжить с ручным черновиком.",
    });
  }
}

export function detectMediaType(bytes: Uint8Array) {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return "";
}

async function ensureDraftStorage(runtime: LegalOcrEnv) {
  if (!draftStoragePromise) {
    draftStoragePromise = initializeDraftStorage(runtime).catch((error) => {
      draftStoragePromise = undefined;
      throw error;
    });
  }
  return draftStoragePromise;
}

async function initializeDraftStorage(runtime: LegalOcrEnv) {
  await runtime.DB.batch([
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_scan_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      owner_user_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL,
      model_version TEXT NOT NULL DEFAULT 'Не применялась',
      policy_version TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_scan_rate_limits (
      subject_hash TEXT PRIMARY KEY NOT NULL,
      window_started_at INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      active_until INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`),
  ]);
  await ensureDraftMetadataColumn(runtime, "model_version", "TEXT NOT NULL DEFAULT 'Не применялась'");
  await ensureDraftMetadataColumn(runtime, "policy_version", "TEXT NOT NULL DEFAULT ''");
}

async function ensureDraftMetadataColumn(runtime: LegalOcrEnv, column: "model_version" | "policy_version", definition: string) {
  const columns = await runtime.DB.prepare("PRAGMA table_info(legal_scan_drafts)").all<{ name: string }>();
  if (columns.results?.some((item) => item.name === column)) return;
  try {
    await runtime.DB.prepare(`ALTER TABLE legal_scan_drafts ADD COLUMN ${column} ${definition}`).run();
  } catch (error) {
    const refreshed = await runtime.DB.prepare("PRAGMA table_info(legal_scan_drafts)").all<{ name: string }>();
    if (!refreshed.results?.some((item) => item.name === column)) throw error;
  }
}

async function acquireScanSlot(runtime: LegalOcrEnv, subjectHash: string, now: number) {
  const windowCutoff = now - RATE_WINDOW_SECONDS;
  const leaseUntil = now + SCAN_LEASE_SECONDS;
  await runtime.DB.prepare("DELETE FROM legal_scan_rate_limits WHERE expires_at <= ? AND active_until <= ?")
    .bind(now, now).run();
  const claimed = await runtime.DB.prepare(`INSERT INTO legal_scan_rate_limits
    (subject_hash,window_started_at,request_count,active_until,expires_at)
    VALUES (?,?,1,?,?)
    ON CONFLICT(subject_hash) DO UPDATE SET
      window_started_at=CASE WHEN legal_scan_rate_limits.window_started_at<=? THEN excluded.window_started_at ELSE legal_scan_rate_limits.window_started_at END,
      request_count=CASE WHEN legal_scan_rate_limits.window_started_at<=? THEN 1 ELSE legal_scan_rate_limits.request_count+1 END,
      active_until=excluded.active_until,
      expires_at=excluded.expires_at
    WHERE legal_scan_rate_limits.active_until<=?
      AND (legal_scan_rate_limits.window_started_at<=? OR legal_scan_rate_limits.request_count<?)
    RETURNING subject_hash`)
    .bind(
      subjectHash,
      now,
      leaseUntil,
      now + RATE_WINDOW_SECONDS,
      windowCutoff,
      windowCutoff,
      now,
      windowCutoff,
      RATE_WINDOW_REQUESTS,
    ).first<{ subject_hash: string }>();
  return claimed ? leaseUntil : 0;
}

async function releaseScanSlot(runtime: LegalOcrEnv, subjectHash: string, leaseUntil: number) {
  await runtime.DB.prepare(`UPDATE legal_scan_rate_limits SET active_until=0
    WHERE subject_hash=? AND active_until=?`).bind(subjectHash, leaseUntil).run();
}

async function setDraftStatus(runtime: LegalOcrEnv, draftId: string, status: "recognized" | "manual", modelVersion: string) {
  await runtime.DB.prepare("UPDATE legal_scan_drafts SET status=?,model_version=? WHERE id=?")
    .bind(status, modelVersion, draftId).run();
}

function selectedOcrModel(runtime: LegalOcrEnv) {
  return runtime.OPENAI_OCR_MODEL?.trim().slice(0, 100) || LEGAL_CONTRACT_OCR_POLICY.defaultModel;
}

async function recognizeContract(
  bytes: Uint8Array,
  mediaType: "application/pdf" | "image/jpeg" | "image/png",
  apiKey: string,
  modelVersion: string,
) {
  const encoded = encodeBase64(bytes);
  const fileContent = mediaType === "application/pdf"
    ? { type: "input_file", filename: "contract.pdf", file_data: `data:${mediaType};base64,${encoded}` }
    : { type: "input_image", image_url: `data:${mediaType};base64,${encoded}`, detail: "high" };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: modelVersion,
      store: false,
      max_output_tokens: LEGAL_CONTRACT_OCR_POLICY.maxOutputTokens,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: LEGAL_CONTRACT_OCR_PROMPT,
          },
          fileContent,
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "contract_draft",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["partyName", "partyType", "contractType", "number", "validFrom", "validUntil", "limitRubles", "signedStatus", "closingRequired", "fullText"],
            properties: {
              partyName: { type: "string" },
              partyType: { type: "string" },
              contractType: { type: "string" },
              number: { type: "string" },
              validFrom: { type: "string", description: "YYYY-MM-DD or empty" },
              validUntil: { type: "string", description: "YYYY-MM-DD or empty" },
              limitRubles: { type: "string" },
              signedStatus: { type: "string" },
              closingRequired: { type: "boolean" },
              fullText: { type: "string", description: "Дословный полный текст видимого договора с переносами строк, не более 50000 символов" },
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (!response.ok) throw new Error("OCR provider rejected the request");
  const outputText = payload.output_text
    ?? payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text
    ?? "";
  if (!outputText) throw new Error("OCR provider returned no structured draft");
  return sanitizeDraft(JSON.parse(outputText) as Record<string, unknown>);
}

function sanitizeDraft(value: Record<string, unknown>): ContractDraft {
  const partyTypes = new Set(["Контрагент", "Клиент", "Сотрудник", "Подрядчик", "Поставщик", "Арендодатель"]);
  const contractTypes = new Set(["Договор", "Клиентский договор", "Трудовой договор", "Договор поставки", "Договор подряда", "Договор аренды"]);
  const signedStatuses = new Set(["Не подписан", "Подписан", "На согласовании"]);
  const amount = clean(value.limitRubles, 40).replace(/\s/g, "").replace(",", ".");
  const numericAmount = Number(amount);
  return {
    partyName: clean(value.partyName, 180),
    partyType: allowedValue(value.partyType, partyTypes, "Контрагент"),
    contractType: allowedValue(value.contractType, contractTypes, "Договор"),
    number: clean(value.number, 80),
    validFrom: dateValue(value.validFrom),
    validUntil: dateValue(value.validUntil),
    limitRubles: Number.isFinite(numericAmount) && numericAmount >= 0 && numericAmount <= 1_000_000_000_000 ? String(numericAmount) : "0",
    signedStatus: allowedValue(value.signedStatus, signedStatuses, "Не подписан"),
    closingRequired: value.closingRequired === true,
    fullText: contractText(value.fullText),
  };
}

function emptyDraft(): ContractDraft {
  return {
    partyName: "",
    partyType: "Контрагент",
    contractType: "Договор",
    number: "",
    validFrom: "",
    validUntil: "",
    limitRubles: "0",
    signedStatus: "Не подписан",
    closingRequired: false,
    fullText: "",
  };
}

function dateValue(value: unknown) {
  const normalized = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function allowedValue(value: unknown, options: Set<string>, fallback: string) {
  const normalized = clean(value, 80);
  return options.has(normalized) ? normalized : fallback;
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function contractText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, LEGAL_CONTRACT_OCR_POLICY.maxFullTextChars);
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}
