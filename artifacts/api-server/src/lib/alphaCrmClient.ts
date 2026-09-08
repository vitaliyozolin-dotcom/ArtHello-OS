import { logger } from "./logger.js";
import { SerializedRequestQueue } from "./serialized-request-queue.js";

export function createAlphaCrmConfig(env: NodeJS.ProcessEnv = process.env) {
  const domain = env.ALFACRM_DOMAIN?.trim();
  if (!domain) {
    throw new Error("ALFACRM_DOMAIN is required; AlphaCRM must fail closed without an explicit tenant");
  }
  return {
    domain,
    email: env.ALFACRM_EMAIL ?? "",
    apiKey: env.ALFACRM_API_KEY ?? "",
    baseUrl: `https://${domain}/v2api`,
  };
}

let authToken: string | null = null;
let authTokenExpiry: number = 0;
let authInFlight: Promise<string> | null = null;

// 260 ms keeps request starts below four per second even under concurrency.
const alphaRequestQueue = new SerializedRequestQueue({
  minIntervalMs: 260,
});

function queuedFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return alphaRequestQueue.run(() => fetch(input, init));
}

export async function authenticate(): Promise<string> {
  const config = createAlphaCrmConfig();
  if (authToken && Date.now() < authTokenExpiry) {
    return authToken;
  }
  if (authInFlight) return authInFlight;

  authInFlight = (async () => {
    logger.info({ domain: config.domain }, "Authenticating with AlphaCRM");

    const resp = await queuedFetch(`${config.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: config.email, api_key: config.apiKey }),
    });

    if (!resp.ok) {
      await resp.arrayBuffer();
      throw new Error(`AlphaCRM authentication failed with HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as { token?: string };
    if (!data.token) {
      throw new Error("AlphaCRM authentication response is invalid");
    }

    authToken = data.token;
    authTokenExpiry = Date.now() + 50 * 60 * 1000;
    logger.info("AlphaCRM authentication successful");
    return authToken;
  })();

  try {
    return await authInFlight;
  } finally {
    authInFlight = null;
  }
}

export interface ProbeResult {
  url: string;
  method: string;
  status: number | null;
  statusText: string | null;
  responseSize: number | null;
  headers: Record<string, string> | null;
  sampleJson: unknown;
  /** Full parsed JSON before any truncation — use this for compatibility checks */
  parsedJson: unknown;
  rawText: string | null;
  error: string | null;
  durationMs: number;
}

/**
 * Raw probe — never throws, always returns full debug info.
 */
export async function crmProbe(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  token?: string,
): Promise<ProbeResult> {
  const url = path.startsWith("http") ? path : `${createAlphaCrmConfig().baseUrl}/${path}`;
  const t = token ?? authToken ?? "";
  const start = Date.now();

  try {
    const resp = await queuedFetch(url, {
      method,
      headers: {
        "X-ALFACRM-TOKEN": t,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });

    const rawText = await resp.text();
    const durationMs = Date.now() - start;
    const headers: Record<string, string> = {};
    resp.headers.forEach((val, key) => { headers[key] = val; });

    let parsedJson: unknown = null;
    let sampleJson: unknown = null;
    try {
      parsedJson = JSON.parse(rawText);
      if (Array.isArray(parsedJson)) {
        sampleJson = parsedJson.slice(0, 3);
      } else if (parsedJson && typeof parsedJson === "object") {
        const obj = parsedJson as Record<string, unknown>;
        const preview: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          preview[k] = Array.isArray(v) ? (v as unknown[]).slice(0, 3) : v;
        }
        sampleJson = preview;
      }
    } catch {
      // not JSON
    }

    logger.info(
      { url, method, status: resp.status, size: rawText.length, durationMs },
      "CRM probe completed",
    );

    return {
      url,
      method,
      status: resp.status,
      statusText: resp.statusText,
      responseSize: rawText.length,
      headers,
      sampleJson,
      parsedJson,
      rawText: rawText.slice(0, 2000),
      error: null,
      durationMs,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ url, method, error }, "CRM probe failed");
    return {
      url,
      method,
      status: null,
      statusText: null,
      responseSize: null,
      headers: null,
      sampleJson: null,
      parsedJson: null,
      rawText: null,
      error,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Endpoint candidates ─────────────────────────────────────────────────────

export function getBranchCandidates(): Array<{ path: string; method: "GET" | "POST"; body?: Record<string, unknown> }> {
  return [
    { path: "0/branch/index",  method: "POST", body: { page: 0, count: 100 } },
    { path: "1/branch/index",  method: "POST", body: { page: 0, count: 100 } },
    { path: "0/filial/index",  method: "POST", body: { page: 0, count: 100 } },
    { path: "1/filial/index",  method: "POST", body: { page: 0, count: 100 } },
    { path: "0/branch/index",  method: "GET" },
    { path: "1/branch/index",  method: "GET" },
    { path: "branch/index",    method: "POST", body: { page: 0, count: 100 } },
    { path: "filial/index",    method: "POST", body: { page: 0, count: 100 } },
    { path: "0/company/index", method: "POST", body: { page: 0, count: 100 } },
    { path: "1/company/index", method: "POST", body: { page: 0, count: 100 } },
    { path: "0/customer/index", method: "POST", body: { page: 0, count: 1 } },
  ];
}

export function getLeadsCandidates(): Array<{ path: string; method: "GET" | "POST"; body?: Record<string, unknown> }> {
  return [
    { path: "0/lead/index",      method: "POST", body: { page: 0, count: 5 } },
    { path: "1/lead/index",      method: "POST", body: { page: 0, count: 5 } },
    { path: "0/lead/list",       method: "POST", body: { page: 0, count: 5 } },
    { path: "1/lead/list",       method: "POST", body: { page: 0, count: 5 } },
    { path: "0/customer/index",  method: "POST", body: { page: 0, count: 5 } },
    { path: "1/customer/index",  method: "POST", body: { page: 0, count: 5 } },
    { path: "0/customer/list",   method: "POST", body: { page: 0, count: 5 } },
    { path: "0/student/index",   method: "POST", body: { page: 0, count: 5 } },
    { path: "1/student/index",   method: "POST", body: { page: 0, count: 5 } },
    { path: "0/payments/index",  method: "POST", body: { page: 0, count: 5 } },
    { path: "0/transactions/index", method: "POST", body: { page: 0, count: 5 } },
  ];
}

export function getLessonsCandidates(): Array<{ path: string; method: "GET" | "POST"; body?: Record<string, unknown> }> {
  return [
    { path: "0/lesson/index",    method: "POST", body: { page: 0, count: 5 } },
    { path: "1/lesson/index",    method: "POST", body: { page: 0, count: 5 } },
    { path: "0/lessons/index",   method: "POST", body: { page: 0, count: 5 } },
    { path: "1/lessons/index",   method: "POST", body: { page: 0, count: 5 } },
    { path: "0/visit/index",     method: "POST", body: { page: 0, count: 5 } },
    { path: "1/visit/index",     method: "POST", body: { page: 0, count: 5 } },
    { path: "0/attendance/index", method: "POST", body: { page: 0, count: 5 } },
    { path: "1/attendance/index", method: "POST", body: { page: 0, count: 5 } },
    { path: "0/schedule/index",  method: "POST", body: { page: 0, count: 5 } },
    { path: "1/schedule/index",  method: "POST", body: { page: 0, count: 5 } },
    { path: "0/log/index",       method: "POST", body: { page: 0, count: 5 } },
    { path: "1/log/index",       method: "POST", body: { page: 0, count: 5 } },
    { path: "0/clog/index",      method: "POST", body: { page: 0, count: 5 } },
    { path: "1/clog/index",      method: "POST", body: { page: 0, count: 5 } },
  ];
}

// ─── Compatibility checkers ──────────────────────────────────────────────────

function extractFirstItem(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  if (Array.isArray(json)) return (json[0] as Record<string, unknown>) ?? null;
  const obj = json as Record<string, unknown>;
  for (const key of ["items", "data", "result", "records"]) {
    const arr = obj[key];
    if (Array.isArray(arr) && arr.length > 0) {
      return arr[0] as Record<string, unknown>;
    }
  }
  return obj;
}

function countFieldMatches(item: Record<string, unknown>, fields: string[]): number {
  const keys = Object.keys(item);
  return fields.filter((f) => keys.includes(f)).length;
}

/** Returns true if the response looks like a leads/customer endpoint */
export function isLeadsCompatible(json: unknown): boolean {
  const item = extractFirstItem(json);
  if (!item) return false;
  const leadsFields = ["source", "status", "created_at", "date_add", "customer_id", "phone", "name", "is_study"];
  return countFieldMatches(item, leadsFields) >= 2;
}

/** Returns true if the response looks like a lessons endpoint */
export function isLessonsCompatible(json: unknown): boolean {
  const item = extractFirstItem(json);
  if (!item) return false;
  const lessonsFields = ["lesson_date", "date", "teacher_id", "teacher", "attendance", "visit", "group_id", "subject_id", "duration", "room_id"];
  return countFieldMatches(item, lessonsFields) >= 2;
}

// ─── Auto-detect ─────────────────────────────────────────────────────────────

export interface DetectResult {
  found: boolean;
  path: string | null;
  fullUrl: string | null;
  sampleJson: unknown;
  recordsTotal: number | null;
  probes: ProbeResult[];
}

/**
 * Iterates candidates, probes each, picks first one where isCompatible returns true.
 */
export async function detectEndpoint(
  candidates: Array<{ path: string; method: "GET" | "POST"; body?: Record<string, unknown> }>,
  isCompatible: (json: unknown) => boolean,
  token: string,
  extraBody?: Record<string, unknown>,
): Promise<DetectResult> {
  const probes: ProbeResult[] = [];

  for (const candidate of candidates) {
    const body = { ...(candidate.body ?? {}), ...(extraBody ?? {}) };
    const probe = await crmProbe(candidate.path, candidate.method, body, token);
    probes.push(probe);

    if (probe.status !== null && probe.status >= 200 && probe.status < 300 && probe.parsedJson !== null) {
      if (isCompatible(probe.parsedJson)) {
        let total: number | null = null;
        const parsed = probe.parsedJson;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          if (typeof obj["total"] === "number") total = obj["total"];
          else if (typeof obj["count"] === "number") total = obj["count"];
        } else if (Array.isArray(parsed)) {
          total = (parsed as unknown[]).length;
        }

        logger.info({ path: candidate.path, total }, "Endpoint detected via compatibility check");

        return {
          found: true,
          path: candidate.path,
          fullUrl: probe.url,
          sampleJson: probe.sampleJson,
          recordsTotal: total,
          probes,
        };
      }
    }
  }

  return {
    found: false,
    path: null,
    fullUrl: null,
    sampleJson: null,
    recordsTotal: null,
    probes,
  };
}

// ─── Standard CRM client methods ─────────────────────────────────────────────

export async function crmPost<T = unknown>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const token = await authenticate();
  const url = `${createAlphaCrmConfig().baseUrl}/${path}`;
  logger.info({ url }, "CRM POST request");

  const resp = await queuedFetch(url, {
    method: "POST",
    headers: {
      "X-ALFACRM-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 401) {
    authToken = null;
    const freshToken = await authenticate();
    const retryResp = await queuedFetch(url, {
      method: "POST",
      headers: {
        "X-ALFACRM-TOKEN": freshToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!retryResp.ok) {
      await retryResp.arrayBuffer();
      throw new Error(
        `AlphaCRM request failed after token refresh with HTTP ${retryResp.status}`,
      );
    }
    return retryResp.json() as Promise<T>;
  }

  if (!resp.ok) {
    await resp.arrayBuffer();
    throw new Error(
      `AlphaCRM request failed with HTTP ${resp.status}`,
    );
  }

  return resp.json() as Promise<T>;
}

export interface CrmPagedResponse<T> {
  total: number;
  count: number;
  items: T[];
}

export async function crmGetAllPages<T = unknown>(
  path: string,
  extraBody: Record<string, unknown> = {},
): Promise<T[]> {
  const PAGE_SIZE = 50;
  let page = 0;
  const results: T[] = [];

  while (true) {
    const resp = await crmPost<CrmPagedResponse<T>>(path, {
      ...extraBody,
      page,
      count: PAGE_SIZE,
    });

    const items = resp?.items ?? [];
    const total = resp?.total ?? 0;
    results.push(...items);

    logger.info(
      { path, page, fetched: items.length, total, accumulated: results.length },
      "CRM page fetched",
    );

    if (items.length === 0) break;
    if (total > 0 && results.length >= total) break;
    if (items.length < PAGE_SIZE) break;
    page++;
  }

  return results;
}

export async function testCrmConnection(): Promise<{ ok: boolean; message: string; rawResponse?: unknown }> {
  try {
    const token = await authenticate();
    if (!token) {
      return { ok: false, message: "Authentication failed: no token returned" };
    }
    const probe = await crmProbe("0/branch/index", "POST", { page: 0, count: 1 }, token);
    const ok = probe.status !== null && probe.status < 400;
    return {
      ok,
      message: ok
        ? `Connected. Branch probe → HTTP ${probe.status}, ${probe.responseSize} bytes`
        : `Connected but branch probe failed: HTTP ${probe.status ?? "ERR"} — ${probe.error ?? probe.rawText?.slice(0, 200)}`,
      rawResponse: probe.sampleJson,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}
