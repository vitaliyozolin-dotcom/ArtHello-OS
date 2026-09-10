import {
  acquireAtlasSsoExchangeRateLease,
  exchangeAtlasSsoCode,
  releaseAtlasSsoExchangeRateLease,
  atlasPublicOrigin,
  type AtlasSsoExchangeRateLease,
} from "../../../../lib/atlas-sso";

export const dynamic = "force-dynamic";

const MAX_EXCHANGE_BODY_BYTES = 4 * 1024;
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: privateHeaders });
}

function envelopeIssue(request: Request) {
  const contentEncoding = (request.headers.get("content-encoding") ?? "identity")
    .trim()
    .toLowerCase();
  if (contentEncoding !== "identity") {
    return json({ error: "Сжатое тело запроса не поддерживается" }, 415);
  }
  const mediaType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return json({ error: "Требуется Content-Type application/json" }, 415);
  }
  const rawLength = request.headers.get("content-length")?.trim() ?? "";
  if (!rawLength) return json({ error: "Требуется Content-Length" }, 411);
  if (!/^\d+$/.test(rawLength)) {
    return json({ error: "Некорректный Content-Length" }, 400);
  }
  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return json({ error: "Некорректный Content-Length" }, 400);
  }
  if (contentLength > MAX_EXCHANGE_BODY_BYTES) {
    return json({ error: "Запрос слишком большой" }, 413);
  }
  let trustedOrigin: string;
  try {
    trustedOrigin = atlasPublicOrigin();
  } catch {
    return json({ error: "Вход через дневник ещё не настроен" }, 503);
  }
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin) {
    try {
      const parsedOrigin = new URL(suppliedOrigin);
      if (
        suppliedOrigin !== parsedOrigin.origin ||
        parsedOrigin.origin !== trustedOrigin
      ) {
        return json({ error: "Источник запроса не разрешён" }, 403);
      }
    } catch {
      return json({ error: "Источник запроса не разрешён" }, 403);
    }
  }
  return null;
}

const expectedExchangeErrors = new Set([
  "Одноразовый код входа недействителен",
  "Одноразовый код входа истёк или уже использован",
  "Учётная запись ArtHello OS не найдена",
  "Доступ к электронному дневнику не выдан",
  "Роль в электронном дневнике не настроена",
  "Права доступа изменились. Начните вход в дневник заново",
]);

export async function POST(request: Request) {
  const issue = envelopeIssue(request);
  if (issue) return issue;
  let lease: AtlasSsoExchangeRateLease | null = null;
  try {
    lease = await acquireAtlasSsoExchangeRateLease(request);
    if (!lease) {
      return json(
        { error: "Слишком много попыток входа. Повторите позже." },
        429,
      );
    }
    let body: { code?: unknown; codeVerifier?: unknown };
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Некорректный JSON запроса" }, 400);
      }
      const keys = Object.keys(parsed);
      if (
        keys.length !== 2 ||
        !keys.includes("code") ||
        !keys.includes("codeVerifier")
      ) {
        return json({ error: "Форма обмена кода содержит лишние или отсутствующие поля" }, 400);
      }
      body = parsed as { code?: unknown; codeVerifier?: unknown };
    } catch {
      return json({ error: "Некорректный JSON запроса" }, 400);
    }
    const exchanged = await exchangeAtlasSsoCode(
      body.code,
      body.codeVerifier,
    );
    return json(
      {
        ok: true,
        systemId: "SYS-SCHOOL-ATLAS",
        branchId: "BR-ATLAS-SCHOOL",
        identity: exchanged.identity,
        returnTo: exchanged.returnTo,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Код входа недействителен";
    if (expectedExchangeErrors.has(message)) return json({ error: message }, 401);
    console.error("atlas_sso.exchange_failed");
    return json({ error: "Обмен кода временно недоступен" }, 503);
  } finally {
    if (lease) {
      try {
        await releaseAtlasSsoExchangeRateLease(lease);
      } catch {
        console.error("atlas_sso.exchange_rate_release_failed");
      }
    }
  }
}
