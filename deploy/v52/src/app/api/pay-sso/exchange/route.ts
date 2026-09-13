import { appendAuthCookies, issueFederatedAuthSession } from "../../../../lib/production-auth";
import {
  acquirePaySsoExchangeRateLease,
  exchangePaySsoCode,
  payPublicOrigin,
  releasePaySsoExchangeRateLease,
  type PaySsoExchangeRateLease,
} from "../../../../lib/pay-sso";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4 * 1024;

export async function POST(request: Request) {
  const envelope = validateEnvelope(request);
  if (envelope) return envelope;
  let lease: PaySsoExchangeRateLease | null = null;
  try {
    lease = await acquirePaySsoExchangeRateLease(request);
    if (!lease) return json({ error: "Слишком много попыток входа. Повторите позже." }, 429);
    const parsed = await request.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Некорректный JSON запроса" }, 400);
    const keys = Object.keys(parsed);
    if (keys.length !== 2 || !keys.includes("code") || !keys.includes("codeVerifier")) {
      return json({ error: "Форма обмена кода содержит лишние или отсутствующие поля" }, 400);
    }
    const body = parsed as { code?: unknown; codeVerifier?: unknown };
    const exchanged = await exchangePaySsoCode(body.code, body.codeVerifier);
    const session = await issueFederatedAuthSession(exchanged.identity.centralUserId, exchanged.identity.accessVersion);
    if (!session.user.canAccessPay) throw new Error("Доступ к ArtHello Pay не выдан");
    const headers = privateHeaders();
    appendAuthCookies(headers, session.token, session.csrf);
    return Response.json({ ok: true, identity: exchanged.identity, user: session.user, returnTo: exchanged.returnTo }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Код входа недействителен";
    const expected = /^(Одноразовый|Учётная запись|Доступ к|Права доступа)/.test(message);
    if (!expected) console.error("pay_sso.exchange_failed");
    return json({ error: expected ? message : "Обмен кода временно недоступен" }, expected ? 401 : 503);
  } finally {
    if (lease) {
      try { await releasePaySsoExchangeRateLease(lease); } catch { console.error("pay_sso.exchange_rate_release_failed"); }
    }
  }
}

function validateEnvelope(request: Request) {
  if ((request.headers.get("content-encoding") ?? "identity").trim().toLowerCase() !== "identity") return json({ error: "Сжатое тело запроса не поддерживается" }, 415);
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ error: "Требуется Content-Type application/json" }, 415);
  const rawLength = request.headers.get("content-length")?.trim() ?? "";
  if (!/^\d+$/.test(rawLength)) return json({ error: "Требуется корректный Content-Length" }, 411);
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length <= 0) return json({ error: "Некорректный Content-Length" }, 400);
  if (length > MAX_BODY_BYTES) return json({ error: "Запрос слишком большой" }, 413);
  let expectedOrigin: string;
  try { expectedOrigin = payPublicOrigin(); } catch { return json({ error: "Вход в ArtHello Pay ещё не настроен" }, 503); }
  const supplied = request.headers.get("origin");
  try {
    if (!supplied || supplied !== new URL(supplied).origin || supplied !== expectedOrigin) return json({ error: "Источник запроса не разрешён" }, 403);
  } catch {
    return json({ error: "Источник запроса не разрешён" }, 403);
  }
  return null;
}

function privateHeaders() {
  return new Headers({ "cache-control": "private, no-store, max-age=0", pragma: "no-cache", expires: "0" });
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: privateHeaders() });
}
