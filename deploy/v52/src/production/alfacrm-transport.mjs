const MAX_REQUEST_BODY_BYTES = 128_000;
const MAX_RESPONSE_BODY_BYTES = 6_000_000;
const MAX_SECRET_LENGTH = 4_096;
const UPSTREAM_TIMEOUT_MS = 30_000;
const INDEX_PATH = /^\/v2api\/(?:branch\/index|[A-Za-z0-9._-]{1,80}\/(?:customer|teacher|group|lesson|pay|customer-tariff|study-status)\/index)$/;

/**
 * Runs the allowlisted AlfaCRM v2 reads in Node. Production exposes this
 * function to the worker as a Miniflare service binding, so DNS/TLS use the
 * same bounded Node trust path as the other protected integrations.
 */
export function createAlfaCrmTransport({ fetchImpl = globalThis.fetch, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > UPSTREAM_TIMEOUT_MS) {
    throw new TypeError("timeoutMs must be a positive integer within the production timeout");
  }

  return async function alfaCrmTransport(request) {
    if (!request
      || typeof request.url !== "string"
      || typeof request.method !== "string"
      || typeof request.headers?.get !== "function"
      || typeof request.text !== "function") {
      return errorResponse(400, "invalid_request");
    }

    const target = classifyTarget(request.url, request.method);
    if (!target) return errorResponse(403, "request_not_allowed");
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return errorResponse(415, "json_required");
    const body = await readBoundedRequestBody(request);
    if (body === null) return errorResponse(413, "request_too_large");
    if (!validBody(body, target.kind)) return errorResponse(400, "invalid_request_body");

    const appKey = request.headers.get("x-app-key")?.trim() ?? "";
    const token = request.headers.get("x-alfacrm-token")?.trim() ?? "";
    if (appKey.length > MAX_SECRET_LENGTH || token.length > MAX_SECRET_LENGTH) {
      return errorResponse(400, "invalid_request_headers");
    }
    if (target.kind === "login" ? Boolean(token) : token.length < 10) {
      return errorResponse(401, "token_state_invalid");
    }

    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      ...(appKey ? { "x-app-key": appKey } : {}),
      ...(token ? { "x-alfacrm-token": token } : {}),
    };
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abortFromCaller = () => controller.abort();
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      if (request.signal?.aborted) controller.abort();
      const upstream = await fetchImpl(target.url, {
        method: "POST",
        headers,
        body,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      const responseBody = await readBoundedResponseBody(upstream);
      if (responseBody === null) return errorResponse(502, "upstream_response_too_large", "unavailable");
      const responseHeaders = new Headers({ "cache-control": "no-store" });
      const responseType = upstream.headers.get("content-type");
      if (responseType) responseHeaders.set("content-type", responseType);
      return new Response(isNullBodyStatus(upstream.status) ? null : responseBody, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch {
      const timeoutFailure = timedOut || request.signal?.aborted;
      return errorResponse(timeoutFailure ? 504 : 502, timeoutFailure ? "upstream_timeout" : "upstream_unavailable", timeoutFailure ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  };
}

function classifyTarget(input, method) {
  let url;
  try { url = new URL(input); } catch { return null; }
  const hostname = url.hostname.toLowerCase();
  const allowedHost = hostname.endsWith(".alfacrm.pro") || /^[a-z0-9-]+\.s\d+\.online$/i.test(hostname);
  if (String(method).toUpperCase() !== "POST" || url.protocol !== "https:" || !allowedHost
    || url.port || url.username || url.password || url.hash) return null;
  if (url.pathname === "/v2api/auth/login" && !url.search) return { kind: "login", url: url.href };
  if (!INDEX_PATH.test(url.pathname)) return null;
  if (!url.search) return { kind: "index", url: url.href };
  if (!url.pathname.endsWith("/customer-tariff/index")) return null;
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== "customer_id" || !/^[A-Za-z0-9._:-]{1,120}$/.test(entries[0][1])) return null;
  return { kind: "index", url: url.href };
}

async function readBoundedRequestBody(request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) return null;
  try {
    const body = await request.text();
    return Buffer.byteLength(body, "utf8") <= MAX_REQUEST_BODY_BYTES ? body : null;
  } catch {
    return null;
  }
}

function validBody(body, kind) {
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    if (kind !== "login") return true;
    const keys = Object.keys(parsed).sort();
    return keys.length === 2 && keys[0] === "api_key" && keys[1] === "email"
      && typeof parsed.email === "string" && parsed.email.length > 2 && parsed.email.length <= 240
      && typeof parsed.api_key === "string" && parsed.api_key.length >= 8 && parsed.api_key.length <= 1_024;
  } catch {
    return false;
  }
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
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function isNullBodyStatus(status) { return status === 204 || status === 205 || status === 304; }

function errorResponse(status, code, classification = "") {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...(classification ? { "x-arthello-upstream-error": classification } : {}),
    },
  });
}
