const TOCHKA_ORIGIN = "https://enter.tochka.com";
const TOCHKA_CUSTOMERS_PATH = "/uapi/open-banking/v1.0/customers";
const TOCHKA_ACCOUNTS_PATH = "/uapi/open-banking/v1.0/accounts";
const TOCHKA_STATEMENTS_PATH = "/uapi/open-banking/v1.0/statements";
const TOCHKA_STATEMENT_RESULT_PATH = /^\/uapi\/open-banking\/v1\.0\/accounts\/\d{20}(?:\/\d{9})?\/statements\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_AUTHORIZATION_LENGTH = 16_391;
const MAX_STATEMENT_BODY_BYTES = 16_384;
const MAX_RESPONSE_BODY_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 45_000;

/**
 * Runs the allowlisted Tochka calls in Node, whose production trust store is
 * extended with the pinned Russian root CA. The worker receives this function
 * as a Miniflare service binding and cannot address any other upstream.
 */
export function createTochkaTransport({ fetchImpl = globalThis.fetch, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > UPSTREAM_TIMEOUT_MS) {
    throw new TypeError("timeoutMs must be a positive integer within the production timeout");
  }

  return async function tochkaTransport(request) {
    if (!request
      || typeof request.url !== "string"
      || typeof request.method !== "string"
      || typeof request.headers?.get !== "function"
      || typeof request.text !== "function") {
      return errorResponse(400, "invalid_request");
    }

    const target = classifyTarget(request.url, request.method);
    if (!target) return errorResponse(403, "request_not_allowed");

    const authorization = request.headers.get("authorization")?.trim() ?? "";
    if (!isBearerJwt(authorization)) return errorResponse(401, "authorization_required");

    let body;
    if (target === "statement-create") {
      const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "application/json") return errorResponse(415, "json_required");
      body = await readBoundedBody(request);
      if (body === null || !isValidStatementBody(body)) return errorResponse(400, "invalid_statement_request");
    }

    const headers = {
      accept: "application/json",
      authorization,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      if (request.signal?.aborted) controller.abort();
      const upstream = await fetchImpl(request.url, {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const responseBody = await readBoundedResponseBody(upstream);
      if (responseBody === null) return errorResponse(502, "upstream_response_too_large");
      const responseHeaders = new Headers();
      const contentType = upstream.headers.get("content-type");
      if (contentType) responseHeaders.set("content-type", contentType);
      responseHeaders.set("cache-control", "no-store");
      return new Response(responseBody, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      return errorResponse(502, "upstream_unavailable");
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  };
}

async function readBoundedResponseBody(response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BODY_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Stateless image preflight: proves this exact Node module can reach Tochka. */
export async function probeTochkaTlsEgress({ fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${TOCHKA_ORIGIN}${TOCHKA_CUSTOMERS_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (response.status < 400 || response.status >= 500) {
      throw new Error(`unexpected Tochka preflight status ${response.status}`);
    }
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

function classifyTarget(input, method) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return "";
  }
  if (url.origin !== TOCHKA_ORIGIN || url.username || url.password || url.search || url.hash) return "";
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod === "GET" && (url.pathname === TOCHKA_CUSTOMERS_PATH || url.pathname === TOCHKA_ACCOUNTS_PATH)) return "read";
  if (normalizedMethod === "POST" && url.pathname === TOCHKA_STATEMENTS_PATH) return "statement-create";
  if (normalizedMethod === "GET" && TOCHKA_STATEMENT_RESULT_PATH.test(url.pathname)) return "read";
  return "";
}

function isBearerJwt(value) {
  if (value.length < 47 || value.length > MAX_AUTHORIZATION_LENGTH) return false;
  return /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

async function readBoundedBody(request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STATEMENT_BODY_BYTES) return null;
  try {
    const body = await request.text();
    return Buffer.byteLength(body, "utf8") <= MAX_STATEMENT_BODY_BYTES ? body : null;
  } catch {
    return null;
  }
}

function isValidStatementBody(body) {
  try {
    const parsed = JSON.parse(body);
    const statement = parsed?.Data?.Statement;
    if (!statement || typeof statement !== "object" || Array.isArray(statement)) return false;
    const accountId = typeof statement.accountId === "string" ? statement.accountId : "";
    const startDate = typeof statement.startDateTime === "string" ? statement.startDateTime : "";
    const endDate = typeof statement.endDateTime === "string" ? statement.endDateTime : "";
    return /^\d{20}(?:\/\d{9})?$/.test(accountId)
      && isIsoDate(startDate)
      && isIsoDate(endDate)
      && startDate <= endDate;
  } catch {
    return false;
  }
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function errorResponse(status, code) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
