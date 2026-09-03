import { env } from "cloudflare:workers";
import { canAccessModule } from "../../../lib/access-policy";
import { hasTrustedMutationOrigin } from "../../../lib/request-security";
import {
  getAuthenticatedRequestContext,
  isCanonicalOwnerContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../lib/production-auth";

type RequestContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedRequestContext>>>;
type OpenAiImageResponse = { data?: Array<{ b64_json?: unknown }> };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type D1Database = { prepare: (query: string) => D1Statement };
type ContentGenerateEnv = {
  DB?: D1Database;
  ARTHELLO_PUBLIC_ORIGIN?: string;
  OPENAI_API_KEY?: string;
};
type GenerationLease = { subjectHash: string; nonce: string; activeUntil: number };

const editorRoles = new Set(["DIRECTOR", "MARKETING"]);
const allowedFields = new Set(["provider", "prompt", "size", "quality", "reference"]);
const allowedProviders = new Set(["openai", "google", "recraft"]);
const allowedSizes = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const allowedQualities = new Set(["low", "medium", "high"]);
const allowedReferenceTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = MAX_REFERENCE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
const MAX_PROVIDER_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_GENERATED_BASE64_CHARS = 20 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 90_000;
const QUOTA_WINDOW_SECONDS = 60 * 60;
const QUOTA_REQUESTS_PER_WINDOW = 10;
const QUOTA_LEASE_SECONDS = Math.ceil(PROVIDER_TIMEOUT_MS / 1_000) + 30;
const MODEL = "gpt-image-1";
let quotaStoragePromise: Promise<void> | undefined;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const runtime = env as unknown as ContentGenerateEnv;
  const publicOrigin = runtime.ARTHELLO_PUBLIC_ORIGIN?.trim() ?? "";
  if (!hasTrustedMutationOrigin(request, publicOrigin)) {
    return privateJson({ error: "Запрос отклонён: источник страницы не совпадает" }, 403);
  }

  let context: RequestContext | null;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return privateJson({ error: "Сервис авторизации временно недоступен" }, 503);
  }
  if (!context) return privateJson({ error: "Требуется вход" }, 401);

  const accessContext = {
    apiRole: context.apiRole,
    isSystemOwner: context.auth.user.isSystemOwner,
    canAccessMedical: context.auth.user.canAccessMedical,
    allowedModules: context.auth.user.allowedModules,
  };
  if (!canAccessModule(accessContext, "content")) {
    return privateJson({ error: "Раздел контента не назначен этому пользователю" }, 403);
  }
  if (context.apiRole === "OWNER"
    ? !isCanonicalOwnerContext(context)
    : !editorRoles.has(context.apiRole)) {
    return privateJson({ error: "Нет прав на генерацию контента" }, 403);
  }
  try {
    verifyAuthenticatedRequestCsrf(request, context);
  } catch {
    return privateJson({ error: "Защитная сессия устарела. Войдите заново." }, 403);
  }

  const envelopeIssue = multipartEnvelopeIssue(request.headers);
  if (envelopeIssue) return privateJson({ error: envelopeIssue.error }, envelopeIssue.status);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return privateJson({ error: "Не удалось прочитать форму генерации" }, 400);
  }

  const entries = Array.from(form.entries());
  if (entries.some(([name]) => !allowedFields.has(name))) {
    return privateJson({ error: "Форма содержит лишние поля" }, 400);
  }
  const provider = singleTextField(form, "provider");
  const promptValue = singleTextField(form, "prompt");
  const size = singleTextField(form, "size");
  const quality = singleTextField(form, "quality");
  const references = form.getAll("reference");
  if (provider === null || promptValue === null || size === null || quality === null
    || references.length > 1 || entries.length !== 4 + references.length) {
    return privateJson({ error: "Форма содержит пропущенные или повторяющиеся поля" }, 400);
  }
  if (!allowedProviders.has(provider)) {
    return privateJson({ error: "Неизвестный сервис генерации" }, 400);
  }
  if (!allowedSizes.has(size) || !allowedQualities.has(quality)) {
    return privateJson({ error: "Выберите поддерживаемые формат и качество" }, 400);
  }
  const prompt = promptValue.trim();
  if (prompt.length < 12) {
    return privateJson({ error: "Опишите изображение подробнее — минимум 12 символов" }, 400);
  }
  if (prompt.length > 4_000 || prompt.includes("\0")) {
    return privateJson({ error: "Описание изображения слишком длинное или содержит недопустимые символы" }, 400);
  }

  let reference: File | null = null;
  let referenceType = "";
  if (references.length === 1) {
    const candidate = references[0];
    if (!(candidate instanceof File) || candidate.size === 0) {
      return privateJson({ error: "Выберите непустой файл-референс" }, 400);
    }
    if (candidate.size > MAX_REFERENCE_BYTES) {
      return privateJson({ error: "Референс должен быть не больше 8 МБ" }, 413);
    }
    const claimedType = candidate.type.trim().toLowerCase();
    if (!allowedReferenceTypes.has(claimedType)) {
      return privateJson({ error: "Поддерживаются PNG, JPEG и WebP" }, 415);
    }
    const detectedType = detectReferenceType(new Uint8Array(await candidate.slice(0, 12).arrayBuffer()));
    if (!detectedType || detectedType !== claimedType) {
      return privateJson({ error: "Содержимое референса не соответствует PNG, JPEG или WebP" }, 415);
    }
    reference = candidate;
    referenceType = detectedType;
  }

  if (provider !== "openai") {
    const providerName = provider === "google" ? "Google Gemini" : "Recraft";
    return privateJson({
      error: `${providerName} ещё не подключён. Сначала добавьте его API-коннектор в разделе «Интеграции».`,
      needsCredential: true,
    }, 503);
  }

  const apiKey = runtime.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return privateJson({
      error: "OpenAI Images не подключён. Добавьте OPENAI_API_KEY в защищённые переменные рабочего контура.",
      needsCredential: true,
    }, 503);
  }

  if (!runtime.DB) {
    return privateJson({ error: "Защита лимита генерации временно недоступна" }, 503);
  }
  let lease: GenerationLease | null;
  try {
    const subjectHash = await contentGenerationSubjectHash(context.appUserId);
    await ensureQuotaStorage(runtime.DB);
    lease = await acquireGenerationLease(runtime.DB, subjectHash, Math.floor(Date.now() / 1_000));
  } catch {
    console.error("content.image_generation_quota_failed");
    return privateJson({ error: "Защита лимита генерации временно недоступна" }, 503);
  }
  if (!lease) {
    return privateJson({ error: "Лимит генерации исчерпан или другой запрос ещё выполняется. Повторите позже." }, 429);
  }

  const controller = new AbortController();
  const abortForDisconnectedClient = () => controller.abort();
  request.signal.addEventListener("abort", abortForDisconnectedClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    let response: Response;
    if (reference) {
      const body = new FormData();
      body.set("model", MODEL);
      body.set("prompt", prompt);
      body.set("size", size);
      body.set("quality", quality);
      body.set("image", reference, safeReferenceName(referenceType));
      response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } else {
      response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, prompt, size, quality, output_format: "png" }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      await discardResponse(response);
      return privateJson({ error: "Сервис генерации временно не смог создать изображение" }, response.status === 429 ? 503 : 502);
    }
    const payload = await readLimitedJson<OpenAiImageResponse>(response);
    const encodedImage = payload.data?.[0]?.b64_json;
    if (!isSafePngBase64(encodedImage)) {
      return privateJson({ error: "Сервис генерации вернул некорректное изображение" }, 502);
    }
    return privateJson({
      imageDataUrl: `data:image/png;base64,${encodedImage}`,
      model: MODEL,
      stored: false,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return privateJson({ error: "Сервис генерации не ответил вовремя" }, 504);
    }
    console.error("content.image_generation_failed");
    return privateJson({ error: "Не удалось создать изображение" }, 502);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortForDisconnectedClient);
    try {
      await releaseGenerationLease(runtime.DB, lease);
    } catch {
      console.error("content.image_generation_quota_release_failed");
    }
  }
}

async function contentGenerationSubjectHash(appUserId: string) {
  if (!appUserId.trim()) throw new Error("Authenticated subject is unavailable");
  const input = new TextEncoder().encode(`content-generation-quota:v1:${appUserId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureQuotaStorage(database: D1Database) {
  if (!quotaStoragePromise) {
    quotaStoragePromise = database.prepare(`CREATE TABLE IF NOT EXISTS content_generation_limits (
      subject_hash TEXT PRIMARY KEY NOT NULL,
      window_started_at INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      active_until INTEGER NOT NULL,
      lease_nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`).run().then(() => undefined).catch((error) => {
      quotaStoragePromise = undefined;
      throw error;
    });
  }
  return quotaStoragePromise;
}

async function acquireGenerationLease(database: D1Database, subjectHash: string, now: number): Promise<GenerationLease | null> {
  const windowCutoff = now - QUOTA_WINDOW_SECONDS;
  const activeUntil = now + QUOTA_LEASE_SECONDS;
  const nonce = crypto.randomUUID();
  await database.prepare(`DELETE FROM content_generation_limits
    WHERE expires_at<=? AND active_until<=?`).bind(now, now).run();
  const claimed = await database.prepare(`INSERT INTO content_generation_limits
      (subject_hash,window_started_at,request_count,active_until,lease_nonce,expires_at)
    VALUES (?,?,1,?,?,?)
    ON CONFLICT(subject_hash) DO UPDATE SET
      window_started_at=CASE
        WHEN content_generation_limits.window_started_at<=? THEN excluded.window_started_at
        ELSE content_generation_limits.window_started_at END,
      request_count=CASE
        WHEN content_generation_limits.window_started_at<=? THEN 1
        ELSE content_generation_limits.request_count+1 END,
      active_until=excluded.active_until,
      lease_nonce=excluded.lease_nonce,
      expires_at=CASE
        WHEN content_generation_limits.window_started_at<=? THEN excluded.expires_at
        ELSE content_generation_limits.expires_at END
    WHERE content_generation_limits.active_until<=?
      AND (content_generation_limits.window_started_at<=? OR content_generation_limits.request_count<?)
    RETURNING lease_nonce`)
    .bind(
      subjectHash,
      now,
      activeUntil,
      nonce,
      now + QUOTA_WINDOW_SECONDS,
      windowCutoff,
      windowCutoff,
      windowCutoff,
      now,
      windowCutoff,
      QUOTA_REQUESTS_PER_WINDOW,
    )
    .first<{ lease_nonce: string }>();
  return claimed?.lease_nonce === nonce ? { subjectHash, nonce, activeUntil } : null;
}

async function releaseGenerationLease(database: D1Database, lease: GenerationLease) {
  await database.prepare(`UPDATE content_generation_limits
    SET active_until=0,lease_nonce=''
    WHERE subject_hash=? AND lease_nonce=? AND active_until=?`)
    .bind(lease.subjectHash, lease.nonce, lease.activeUntil).run();
}

function singleTextField(form: FormData, name: string) {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

function multipartEnvelopeIssue(headers: Headers): { status: number; error: string } | null {
  const contentEncoding = headers.get("content-encoding")?.trim().toLowerCase() ?? "";
  if (contentEncoding && contentEncoding !== "identity") {
    return { status: 415, error: "Сжатые формы генерации не поддерживаются" };
  }
  const rawType = headers.get("content-type") ?? "";
  const parts = rawType.split(";");
  const boundaryMatch = parts.length === 2
    ? /^boundary=(?:"([^"]{1,70})"|([^"\s]{1,70}))$/i.exec(parts[1].trim())
    : null;
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? "";
  if (parts[0]?.trim().toLowerCase() !== "multipart/form-data"
    || !boundary
    || !/^[0-9A-Za-z'()+_,\-./:=?]+$/.test(boundary)) {
    return { status: 415, error: "Ожидается multipart-форма генерации" };
  }

  const rawLength = headers.get("content-length") ?? "";
  if (!rawLength) return { status: 411, error: "Не указан размер формы генерации" };
  if (!/^[1-9]\d*$/.test(rawLength)) {
    return { status: 400, error: "Некорректный размер формы генерации" };
  }
  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength)) {
    return { status: 400, error: "Некорректный размер формы генерации" };
  }
  if (contentLength > MAX_REQUEST_BYTES) {
    return { status: 413, error: "Форма генерации превышает допустимый размер" };
  }
  return null;
}

function detectReferenceType(bytes: Uint8Array) {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return "";
}

function safeReferenceName(mediaType: string) {
  if (mediaType === "image/jpeg") return "reference.jpg";
  if (mediaType === "image/webp") return "reference.webp";
  return "reference.png";
}

async function discardResponse(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Provider response content is intentionally ignored.
  }
}

async function readLimitedJson<T>(response: Response): Promise<T> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)
      || !Number.isSafeInteger(Number(declaredLength))
      || Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES) {
      await discardResponse(response);
      throw new Error("Provider response exceeded the configured limit");
    }
  }
  if (!response.body) throw new Error("Provider response body is unavailable");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Provider response exceeded the configured limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function isSafePngBase64(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 12
    && value.length <= MAX_GENERATED_BASE64_CHARS
    && value.length % 4 === 0
    && value.startsWith("iVBORw0KGgo")
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      expires: "0",
      "x-content-type-options": "nosniff",
    },
  });
}
