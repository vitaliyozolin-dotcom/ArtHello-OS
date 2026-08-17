import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { seedOwnerConfirmedMasterData } from "./arthello-master-data.js";
import {
  asRecord,
  familyCandidateReasonCodes,
  normalizeName,
  operatingUnitRule,
  relatedCustomerId,
  safeAlfaErrorCode,
  stringValue,
  type JsonRecord,
} from "./alfacrm-safe.js";
import { openSandboxDatabase, sandboxTableCount } from "./sandbox-db.js";
import {
  resolveAlfaSyncMode,
  resolveIncrementalWindow,
  type AlfaSyncMode,
  type IncrementalWindow,
} from "./alfacrm-sync-plan.js";

const defaultPageSize = 50;
const tariffPageSize = 500;
const minimumRequestIntervalMs = 260;

function boundedIntegerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`invalid_${name.toLowerCase()}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  return parsed;
}

const requestTimeoutMs = boundedIntegerEnvironment(
  "ALFACRM_REQUEST_TIMEOUT_MS",
  30_000,
  5_000,
  60_000,
);
const maximumRetryAttempts = boundedIntegerEnvironment(
  "ALFACRM_MAX_RETRY_ATTEMPTS",
  2,
  0,
  4,
);
const retryBaseDelayMs = 500;
const tariffPrefetchConcurrency = 16;
const tariffPrefetchWindowSize = 64;
const paginationPrefetchConcurrency = 16;
const normalizedReferenceTypes = new Set([
  "subjects",
  "lesson_types",
  "locations",
  "rooms",
  "tariffs",
  "regular_lessons",
  "users",
  "study_statuses",
  "lead_statuses",
  "lead_sources",
  "pipelines",
  "discounts",
  "teacher_rates",
  "teacher_working_hours",
  "pay_accounts",
  "pay_types",
  "pay_items",
  "pay_item_categories",
]);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableValue(record[key])]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const text = stringValue(candidate);
      if (text) return text;
    }
    return null;
  }
  return stringValue(value);
}

function numericValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const text = stringValue(value);
  if (!text) return null;
  const normalized = text
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.+-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? String(number) : null;
}

function isoDate(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(text);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  return null;
}

function isoTimestamp(dateValue: unknown, timeValue?: unknown): string | null {
  const date = isoDate(dateValue);
  if (!date) return null;
  const time = stringValue(timeValue);
  const candidate =
    time && /^\d{1,2}:\d{2}/.test(time)
      ? `${date}T${time.slice(0, 8).padEnd(8, ":00")}+03:00`
      : `${date}T00:00:00+03:00`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function providerTimestamp(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  const dmy =
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
      text,
    );
  if (dmy) {
    return isoTimestamp(
      `${dmy[1]}.${dmy[2]}.${dmy[3]}`,
      `${dmy[4] ?? "00"}:${dmy[5] ?? "00"}:${dmy[6] ?? "00"}`,
    );
  }
  const normalized = /[ T]\d{1,2}:\d{2}/.test(text)
    ? text.replace(" ", "T")
    : `${text}T00:00:00`;
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}+03:00`;
  const parsed = new Date(withTimezone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizePhone(value: unknown): string | null {
  const raw = firstString(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (
    digits.length === 11 &&
    (digits.startsWith("7") || digits.startsWith("8"))
  ) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+7${digits}`;
  return digits ? `+${digits}` : null;
}

function listItems(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is JsonRecord => asRecord(item) !== null);
  }
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["items", "data", "result", "records"]) {
    const items = record[key];
    if (Array.isArray(items)) {
      return items.filter(
        (item): item is JsonRecord => asRecord(item) !== null,
      );
    }
  }
  return [];
}

function totalItems(value: unknown): number | null {
  const record = asRecord(value);
  for (const key of ["total", "count"]) {
    const candidate = record?.[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
      return Number(candidate);
    }
  }
  return null;
}

export class AlfaReadError extends Error {
  readonly safeCode: string;

  constructor(safeCode: string) {
    super(safeCode);
    this.name = "AlfaReadError";
    this.safeCode = safeCode;
  }
}

export interface ReadOnlyAlfaClient {
  postIndex(endpoint: string, body: JsonRecord): Promise<unknown>;
}

export function isRetryableAlfaReadError(error: unknown): boolean {
  const code = safeAlfaErrorCode(error);
  return (
    code === "request_timeout" ||
    code === "network_unavailable" ||
    code === "invalid_json" ||
    /^(?:auth_)?http_(?:408|429|5\d\d)$/.test(code)
  );
}

export class SerializedReadOnlyAlfaClient implements ReadOnlyAlfaClient {
  readonly #baseUrl: string;
  readonly #email: string;
  readonly #apiKey: string;
  #token: string | null = null;
  #tokenExpiresAt = 0;
  #authentication: Promise<string> | null = null;
  #requestStartQueue: Promise<void> = Promise.resolve();
  #lastRequestStartedAt = 0;
  readonly #retryBaseDelayMs: number;

  constructor(options: { retryBaseDelayMs?: number } = {}) {
    const domain = process.env.ALFACRM_DOMAIN?.trim();
    const email = process.env.ALFACRM_EMAIL?.trim();
    const apiKey = process.env.ALFACRM_API_KEY?.trim();
    if (!domain || !email || !apiKey) {
      throw new AlfaReadError("missing_credentials");
    }
    if (!/^[a-z0-9.-]+$/i.test(domain)) {
      throw new AlfaReadError("invalid_domain");
    }
    this.#baseUrl = `https://${domain}/v2api`;
    this.#email = email;
    this.#apiKey = apiKey;
    this.#retryBaseDelayMs =
      options.retryBaseDelayMs ?? retryBaseDelayMs;
  }

  async #rateLimitedFetch(url: string, init: RequestInit): Promise<Response> {
    let release: (() => void) | undefined;
    const previous = this.#requestStartQueue;
    this.#requestStartQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const waitMs = Math.max(
        0,
        minimumRequestIntervalMs - (Date.now() - this.#lastRequestStartedAt),
      );
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.#lastRequestStartedAt = Date.now();
      return fetch(url, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } finally {
      release?.();
    }
  }

  async #authenticate(): Promise<string> {
    if (this.#token && Date.now() < this.#tokenExpiresAt) return this.#token;
    if (!this.#authentication) {
      this.#authentication = (async () => {
        const response = await this.#rateLimitedFetch(
          `${this.#baseUrl}/auth/login`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: this.#email,
              api_key: this.#apiKey,
            }),
          },
        );
        const body = await response.text();
        const parsed = (() => {
          try {
            return JSON.parse(body) as unknown;
          } catch {
            return null;
          }
        })();
        const token = asRecord(parsed)?.["token"];
        if (response.status !== 200 || typeof token !== "string" || !token) {
          throw new AlfaReadError(`auth_http_${response.status}`);
        }
        this.#token = token;
        this.#tokenExpiresAt = Date.now() + 50 * 60 * 1000;
        return token;
      })();
    }
    try {
      return await this.#authentication;
    } finally {
      this.#authentication = null;
    }
  }

  async postIndex(
    endpoint: string,
    body: JsonRecord,
    allowRefresh = true,
    retryAttempt = 0,
  ): Promise<unknown> {
    try {
      const token = await this.#authenticate();
      const response = await this.#rateLimitedFetch(
        `${this.#baseUrl}/${endpoint}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-ALFACRM-TOKEN": token,
          },
          body: JSON.stringify(body),
        },
      );
      if (response.status === 401 && allowRefresh) {
        await response.arrayBuffer();
        if (this.#token === token) this.#token = null;
        return this.postIndex(endpoint, body, false, retryAttempt);
      }
      const text = await response.text();
      if (!response.ok) {
        throw new AlfaReadError(`http_${response.status}`);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AlfaReadError("invalid_json");
      }
    } catch (error) {
      if (
        retryAttempt >= maximumRetryAttempts ||
        !isRetryableAlfaReadError(error)
      ) {
        throw error;
      }
      const backoffMs =
        this.#retryBaseDelayMs * 2 ** retryAttempt +
        Math.floor(Math.random() * Math.min(100, this.#retryBaseDelayMs));
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return this.postIndex(endpoint, body, allowRefresh, retryAttempt + 1);
    }
  }
}

type PrefetchedResult =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown };

function alfaRequestKey(endpoint: string, body: JsonRecord): string {
  return `${endpoint}\n${stableJson(body)}`;
}

class PrefetchedReadOnlyAlfaClient implements ReadOnlyAlfaClient {
  readonly #client: ReadOnlyAlfaClient;
  readonly #results: Map<string, PrefetchedResult>;

  constructor(
    client: ReadOnlyAlfaClient,
    results: Map<string, PrefetchedResult>,
  ) {
    this.#client = client;
    this.#results = results;
  }

  async postIndex(endpoint: string, body: JsonRecord): Promise<unknown> {
    const key = alfaRequestKey(endpoint, body);
    const prefetched = this.#results.get(key);
    if (!prefetched) return this.#client.postIndex(endpoint, body);
    this.#results.delete(key);
    if (!prefetched.ok) throw prefetched.error;
    return prefetched.value;
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        if (item !== undefined) await worker(item);
      }
    },
  );
  await Promise.all(workers);
}

async function prefetchFirstPages(
  client: ReadOnlyAlfaClient,
  requests: ReadonlyArray<{
    endpoint: string;
    body?: JsonRecord;
    page?: number;
    pageSize?: number;
  }>,
): Promise<ReadOnlyAlfaClient> {
  const results = new Map<string, PrefetchedResult>();
  await mapWithConcurrency(
    requests,
    tariffPrefetchConcurrency,
    async (request) => {
      const body = {
        ...(request.body ?? {}),
        page: request.page ?? 0,
        pageSize: request.pageSize ?? defaultPageSize,
      };
      const key = alfaRequestKey(request.endpoint, body);
      try {
        results.set(key, {
          ok: true,
          value: await client.postIndex(request.endpoint, body),
        });
      } catch (error) {
        results.set(key, { ok: false, error });
      }
    },
  );
  return new PrefetchedReadOnlyAlfaClient(client, results);
}

async function prefetchPages(
  client: ReadOnlyAlfaClient,
  request: {
    endpoint: string;
    body?: JsonRecord;
    pageSize: number;
    pages: number[];
  },
): Promise<Map<number, PrefetchedResult>> {
  const results = new Map<number, PrefetchedResult>();
  await mapWithConcurrency(
    request.pages,
    paginationPrefetchConcurrency,
    async (page) => {
      try {
        results.set(page, {
          ok: true,
          value: await client.postIndex(request.endpoint, {
            ...(request.body ?? {}),
            page,
            pageSize: request.pageSize,
          }),
        });
      } catch (error) {
        results.set(page, { ok: false, error });
      }
    },
  );
  return results;
}

export interface EntityImportResult {
  pages: number;
  records: number;
  rawSaved: number;
  normalized: number;
  repeatedPageStopped: boolean;
  resumed?: boolean;
}

export interface ImportEntityOptions {
  branchId: string;
  endpoint: string;
  recordType: string;
  scopeKey: string;
  body?: JsonRecord;
  forcedGroupId?: string;
  forcedCustomerId?: string;
  maxPages?: number;
  pageSize?: number;
}

async function prefetchResumePages(
  client: ReadOnlyAlfaClient,
  database: PGlite,
  batchId: string,
  options: readonly ImportEntityOptions[],
): Promise<ReadOnlyAlfaClient> {
  if (options.length === 0) return client;
  const scopeKeys = options.map((option) => option.scopeKey);
  const states = await database.query<{
    scope_key: string;
    status: string;
    pages_fetched: number;
  }>(
    `SELECT scope_key, status, pages_fetched
     FROM alpha_sync_scope_runs
     WHERE sync_batch_id = $1
       AND scope_key = ANY($2::text[])`,
    [batchId, scopeKeys],
  );
  const stateByScope = new Map(
    states.rows.map((row) => [row.scope_key, row]),
  );
  const pending = options.filter(
    (option) => stateByScope.get(option.scopeKey)?.status !== "completed",
  );
  if (pending.length === 0) return client;
  return prefetchFirstPages(
    client,
    pending.map((option) => ({
      endpoint: option.endpoint,
      body: option.body,
      page: Number(stateByScope.get(option.scopeKey)?.pages_fetched ?? 0),
      pageSize: option.pageSize,
    })),
  );
}

export interface NormalizationContext {
  batchId: string;
  rawId: string;
  observationId: string;
  scopeKey: string;
}

async function saveRawRecord(
  database: PGlite,
  batchId: string,
  options: ImportEntityOptions,
  item: JsonRecord,
  page: number,
): Promise<{
  rawId: string;
  observationId: string;
  payloadHash: string;
  created: boolean;
}> {
  const payload = stableJson(item);
  const payloadHash = sha256(payload);
  const alphaId =
    stringValue(item["id"]) ??
    stringValue(item["customer_id"]) ??
    stringValue(item["student_id"]) ??
    payloadHash;
  const inserted = await database.query<{ id: string }>(
    `INSERT INTO alpha_raw_records (
       alpha_id,
       entity_type,
       endpoint,
       branch_id,
       source_payload,
       payload_hash,
       sync_batch_id,
       page,
       synced_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now(), now())
     ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash)
     DO NOTHING
     RETURNING id`,
    [
      alphaId,
      options.recordType,
      options.endpoint,
      options.branchId,
      payload,
      payloadHash,
      batchId,
      page,
    ],
  );
  const existing =
    inserted.rows[0]?.id ??
    (
      await database.query<{ id: string }>(
        `SELECT id
         FROM alpha_raw_records
         WHERE alpha_id = $1
           AND entity_type = $2
           AND branch_id = $3
           AND payload_hash = $4
         LIMIT 1`,
        [alphaId, options.recordType, options.branchId, payloadHash],
      )
    ).rows[0]?.id;
  const rawId = existing;
  if (!rawId) throw new Error("Raw AlfaCRM record was not returned");
  const insertedObservation = await database.query<{ id: string }>(
    `INSERT INTO alpha_raw_observations (
       sync_batch_id,
       raw_record_id,
       endpoint,
       branch_id,
       entity_type,
       scope_key,
       page,
       observed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (
       sync_batch_id,
       raw_record_id,
       scope_key,
       page
     ) DO NOTHING
     RETURNING id`,
    [
      batchId,
      rawId,
      options.endpoint,
      options.branchId,
      options.recordType,
      options.scopeKey,
      page,
    ],
  );
  const observationId =
    insertedObservation.rows[0]?.id ??
    (
      await database.query<{ id: string }>(
        `SELECT id
         FROM alpha_raw_observations
         WHERE sync_batch_id = $1
           AND raw_record_id = $2
           AND scope_key = $3
           AND page = $4
         LIMIT 1`,
        [batchId, rawId, options.scopeKey, page],
      )
    ).rows[0]?.id;
  if (!observationId) {
    throw new Error("Raw AlfaCRM observation was not returned");
  }
  return {
    rawId,
    observationId,
    payloadHash,
    created: inserted.rows.length === 1,
  };
}

async function normalizeBranch(
  database: PGlite,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"] ?? item["branch_id"]);
  if (!crmId) return false;
  const name = stringValue(
    item["name"] ?? item["title"] ?? item["branch_name"],
  );
  await database.query(
    `INSERT INTO crm_branches (
       crm_id,
       name,
       raw,
       synced_at,
       raw_record_id,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     )
     VALUES (
       $1, $2, $3::jsonb, now(), $4, $5, $6,
       'current', NULL, NULL, $7
     )
     ON CONFLICT (crm_id) DO UPDATE SET
       name = EXCLUDED.name,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      crmId,
      name,
      stableJson(item),
      context.rawId,
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

async function normalizeStudent(
  database: PGlite,
  branchId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  const fullName = stringValue(item["name"] ?? item["full_name"]);
  const status = stringValue(item["is_study"] ?? item["status"]);
  const phone = normalizePhone(item["phone"]);
  const email = firstString(item["email"])?.toLocaleLowerCase("ru-RU") ?? null;
  const createdAt = isoTimestamp(item["created_at"]);
  const raw = stableJson(item);
  await database.query(
    `INSERT INTO crm_students (
       crm_id,
       branch_crm_id,
       full_name,
       status,
       phone,
       email,
       created_at_crm,
       raw,
       synced_at,
       raw_record_id,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(),
       $9, $10, $11, 'current', NULL, NULL, $12
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       status = EXCLUDED.status,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       created_at_crm = EXCLUDED.created_at_crm,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      crmId,
      branchId,
      fullName,
      status,
      phone,
      email,
      createdAt,
      raw,
      context.rawId,
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  await database.query(
    `INSERT INTO student_profiles (
       student_crm_id,
       full_name,
       dob,
       branch_crm_id,
       status,
       raw,
       raw_record_id,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6::jsonb,
       $7, $8, $9, 'current', NULL, NULL, $10
     )
     ON CONFLICT (branch_crm_id, student_crm_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       dob = EXCLUDED.dob,
       branch_crm_id = EXCLUDED.branch_crm_id,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL`,
    [
      crmId,
      fullName,
      isoDate(item["dob"]),
      branchId,
      status,
      raw,
      context.rawId,
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

export async function normalizeLead(
  database: PGlite,
  branchId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  await database.query(
    `INSERT INTO crm_leads (
       branch_crm_id,
       crm_id,
       full_name,
       status,
       pipeline_crm_id,
       source_crm_id,
       created_at_crm,
       raw_record_id,
       raw,
       synced_at,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(),
       $10, $11, 'current', NULL, NULL, $12
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       status = EXCLUDED.status,
       pipeline_crm_id = EXCLUDED.pipeline_crm_id,
       source_crm_id = EXCLUDED.source_crm_id,
       created_at_crm = EXCLUDED.created_at_crm,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       raw = EXCLUDED.raw,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      branchId,
      crmId,
      stringValue(item["name"] ?? item["full_name"]),
      stringValue(
        item["lead_status_id"] ?? item["status_id"] ?? item["status"],
      ),
      stringValue(item["pipeline_id"] ?? asRecord(item["pipeline"])?.["id"]),
      stringValue(
        item["lead_source_id"] ??
          item["source_id"] ??
          asRecord(item["source"])?.["id"],
      ),
      providerTimestamp(item["created_at"]),
      context.rawId,
      stableJson(item),
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

export async function normalizeCustomerTariff(
  database: PGlite,
  branchId: string,
  forcedCustomerId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  const customerCrmId =
    stringValue(item["customer_id"]) ??
    stringValue(asRecord(item["customer"])?.["id"]) ??
    forcedCustomerId;
  if (!crmId || !customerCrmId) return false;
  await database.query(
    `INSERT INTO crm_customer_tariffs (
       branch_crm_id,
       crm_id,
       customer_crm_id,
       tariff_crm_id,
       balance,
       status,
       valid_from,
       valid_to,
       raw_record_id,
       raw,
       synced_at,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(),
       $11, $12, 'current', NULL, NULL, $13
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       customer_crm_id = EXCLUDED.customer_crm_id,
       tariff_crm_id = EXCLUDED.tariff_crm_id,
       balance = EXCLUDED.balance,
       status = EXCLUDED.status,
       valid_from = EXCLUDED.valid_from,
       valid_to = EXCLUDED.valid_to,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       raw = EXCLUDED.raw,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      branchId,
      crmId,
      customerCrmId,
      stringValue(item["tariff_id"] ?? asRecord(item["tariff"])?.["id"]),
      numericValue(item["balance"]),
      stringValue(item["status"] ?? item["is_active"] ?? item["removed"]),
      isoDate(item["b_date"] ?? item["date_from"]),
      isoDate(item["e_date"] ?? item["date_to"]),
      context.rawId,
      stableJson(item),
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

export async function normalizeReferenceRecord(
  database: PGlite,
  branchId: string,
  referenceType: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  await database.query(
    `INSERT INTO crm_reference_records (
       branch_crm_id,
       reference_type,
       crm_id,
       name,
       status,
       parent_crm_id,
       raw_record_id,
       raw,
       synced_at,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(),
       $9, $10, 'current', NULL, NULL, $11
     )
     ON CONFLICT (branch_crm_id, reference_type, crm_id) DO UPDATE SET
       name = EXCLUDED.name,
       status = EXCLUDED.status,
       parent_crm_id = EXCLUDED.parent_crm_id,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       raw = EXCLUDED.raw,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      branchId,
      referenceType,
      crmId,
      stringValue(item["name"] ?? item["title"] ?? item["label"]),
      stringValue(
        item["status"] ??
          item["active"] ??
          item["is_active"] ??
          item["removed"],
      ),
      stringValue(
        item["parent_id"] ??
          item["category_id"] ??
          item["pay_item_category_id"],
      ),
      context.rawId,
      stableJson(item),
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

export async function normalizeChangeLog(
  database: PGlite,
  branchId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  const jsonField = (value: unknown): string | null =>
    value === undefined || value === null ? null : stableJson(value);
  await database.query(
    `INSERT INTO crm_change_log (
       branch_crm_id,
       crm_id,
       entity_type,
       entity_crm_id,
       user_crm_id,
       event,
       occurred_at,
       fields_old,
       fields_new,
       fields_related,
       raw_record_id,
       raw,
       synced_at,
       last_seen_batch_id,
       source_scope,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::jsonb, now(),
       $13, $14, $15
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       entity_type = EXCLUDED.entity_type,
       entity_crm_id = EXCLUDED.entity_crm_id,
       user_crm_id = EXCLUDED.user_crm_id,
       event = EXCLUDED.event,
       occurred_at = EXCLUDED.occurred_at,
       fields_old = EXCLUDED.fields_old,
       fields_new = EXCLUDED.fields_new,
       fields_related = EXCLUDED.fields_related,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       raw = EXCLUDED.raw,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       synced_at = now()`,
    [
      branchId,
      crmId,
      stringValue(item["entity"]),
      stringValue(item["entity_id"]),
      stringValue(item["user_id"]),
      stringValue(item["event"]),
      providerTimestamp(item["date_time"]),
      jsonField(item["fields_old"]),
      jsonField(item["fields_new"]),
      jsonField(item["fields_rel"]),
      context.rawId,
      stableJson(item),
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

async function normalizeTeacher(
  database: PGlite,
  branchId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  await database.query(
    `INSERT INTO crm_teachers (
       crm_id,
       branch_crm_id,
       full_name,
       phone,
       email,
       status,
       raw,
       synced_at,
       raw_record_id,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, now(),
       $8, $9, $10, 'current', NULL, NULL, $11
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      crmId,
      branchId,
      stringValue(item["name"] ?? item["full_name"]),
      normalizePhone(item["phone"]),
      firstString(item["email"])?.toLocaleLowerCase("ru-RU") ?? null,
      stringValue(item["status"] ?? item["is_active"] ?? item["e_date"]),
      stableJson(item),
      context.rawId,
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

async function normalizeGroup(
  database: PGlite,
  branchId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  const nestedTeachers = Array.isArray(item["teachers"])
    ? (item["teachers"] as unknown[])
        .map((teacher) => stringValue(asRecord(teacher)?.["id"]))
        .filter((id): id is string => !!id)
    : [];
  const teacherIds = Array.isArray(item["teacher_ids"])
    ? (item["teacher_ids"] as unknown[])
        .map((teacher) => stringValue(teacher))
        .filter((id): id is string => !!id)
    : [];
  const teachers = [...new Set([...nestedTeachers, ...teacherIds])];
  await database.query(
    `INSERT INTO crm_groups (
       crm_id,
       branch_crm_id,
       name,
       note,
       b_date,
       e_date,
       capacity,
       teacher_crm_ids,
       raw,
       synced_at,
       raw_record_id,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now(),
       $10, $11, $12, 'current', NULL, NULL, $13
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       name = EXCLUDED.name,
       note = EXCLUDED.note,
       b_date = EXCLUDED.b_date,
       e_date = EXCLUDED.e_date,
       capacity = EXCLUDED.capacity,
       teacher_crm_ids = EXCLUDED.teacher_crm_ids,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      crmId,
      branchId,
      stringValue(item["name"]),
      stringValue(item["note"]),
      stringValue(item["b_date"]),
      stringValue(item["e_date"]),
      numericValue(item["limit"] ?? item["capacity"]),
      JSON.stringify(teachers),
      stableJson(item),
      context.rawId,
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  return true;
}

async function normalizePayment(
  database: PGlite,
  branchId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  const income = numericValue(item["income"]);
  const outcome = numericValue(item["outcome"]);
  const amount =
    numericValue(item["amount"]) ??
    income ??
    (outcome ? String(-Number(outcome)) : null);
  await database.query(
    `INSERT INTO crm_payments (
       crm_id,
       branch_crm_id,
       student_crm_id,
       amount,
       payment_date,
       type,
       comment,
       raw,
       synced_at,
       raw_record_id,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(),
       $9, $10, $11, 'current', NULL, NULL, $12
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       student_crm_id = EXCLUDED.student_crm_id,
       amount = EXCLUDED.amount,
       payment_date = EXCLUDED.payment_date,
       type = EXCLUDED.type,
       comment = EXCLUDED.comment,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      crmId,
      branchId,
      stringValue(item["customer_id"] ?? item["student_id"]),
      amount,
      isoDate(item["document_date"] ?? item["date"]),
      stringValue(
        item["pay_type_name"] ??
          item["payment_type_name"] ??
          item["pay_type_id"] ??
          item["type"],
      ),
      stringValue(item["comment"] ?? item["note"]),
      stableJson(item),
      context.rawId,
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  await database.query(
    `UPDATE crm_payments AS payment
     SET
       record_state = 'stale',
       stale_at = now(),
       stale_reason = 'student_parent_not_current'
     WHERE payment.crm_id = $1
       AND payment.branch_crm_id = $2
       AND payment.student_crm_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM crm_students AS student
         WHERE student.branch_crm_id = payment.branch_crm_id
           AND student.crm_id = payment.student_crm_id
           AND student.record_state = 'current'
       )`,
    [crmId, branchId],
  );
  return true;
}

async function normalizeLesson(
  database: PGlite,
  branchId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const crmId = stringValue(item["id"]);
  if (!crmId) return false;
  const lessonDate = isoTimestamp(
    item["date"] ?? item["lesson_date"],
    item["time_from"] ?? item["start_time"],
  );
  await database.query(
    `INSERT INTO crm_lessons (
       crm_id,
       branch_crm_id,
       group_crm_id,
       teacher_crm_id,
       lesson_date,
       title,
       raw,
       synced_at,
       raw_record_id,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, now(),
       $8, $9, $10, 'current', NULL, NULL, $11
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       group_crm_id = EXCLUDED.group_crm_id,
       teacher_crm_id = EXCLUDED.teacher_crm_id,
       lesson_date = EXCLUDED.lesson_date,
       title = EXCLUDED.title,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      crmId,
      branchId,
      firstString(item["group_id"] ?? item["group_ids"]),
      firstString(item["teacher_id"] ?? item["teacher_ids"]),
      lessonDate,
      stringValue(item["topic"] ?? item["name"] ?? item["title"]),
      stableJson(item),
      context.rawId,
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );

  const details = [item["details"], item["visits"], item["attendance"]].find(
    Array.isArray,
  ) as unknown[] | undefined;
  for (const value of details ?? []) {
    const detail = asRecord(value);
    if (!detail) continue;
    const studentCrmId = relatedCustomerId(detail);
    if (!studentCrmId) continue;
    await database.query(
      `INSERT INTO crm_attendance (
         branch_crm_id,
         lesson_crm_id,
         student_crm_id,
         status,
         raw,
         synced_at,
         raw_record_id,
         last_seen_batch_id,
         source_scope,
         record_state,
         stale_at,
         stale_reason,
         raw_observation_id
       ) VALUES (
         $1, $2, $3, $4, $5::jsonb, now(),
         $6, $7, $8, 'current', NULL, NULL, $9
       )
       ON CONFLICT (branch_crm_id, lesson_crm_id, student_crm_id) DO UPDATE SET
         status = EXCLUDED.status,
         raw = EXCLUDED.raw,
         raw_record_id = EXCLUDED.raw_record_id,
         raw_observation_id = EXCLUDED.raw_observation_id,
         last_seen_batch_id = EXCLUDED.last_seen_batch_id,
         source_scope = EXCLUDED.source_scope,
         record_state = 'current',
         stale_at = NULL,
         stale_reason = NULL,
         synced_at = now()`,
      [
        branchId,
        crmId,
        studentCrmId,
        stringValue(detail["status"] ?? detail["is_attend"] ?? detail["visit"]),
        stableJson(detail),
        context.rawId,
        context.batchId,
        context.scopeKey,
        context.observationId,
      ],
    );
    await database.query(
      `UPDATE crm_attendance AS attendance
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'student_or_lesson_parent_not_current'
       WHERE attendance.lesson_crm_id = $1
         AND attendance.student_crm_id = $2
         AND attendance.branch_crm_id = $3
         AND NOT EXISTS (
           SELECT 1
           FROM crm_lessons AS lesson
           JOIN crm_students AS student
             ON student.branch_crm_id = lesson.branch_crm_id
            AND student.crm_id = attendance.student_crm_id
           WHERE lesson.branch_crm_id = attendance.branch_crm_id
             AND lesson.crm_id = attendance.lesson_crm_id
             AND lesson.record_state = 'current'
             AND student.record_state = 'current'
         )`,
      [crmId, studentCrmId, branchId],
    );
  }
  return true;
}

async function normalizeGroupMembership(
  database: PGlite,
  branchId: string,
  groupId: string,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  const studentCrmId = relatedCustomerId(item);
  const resolvedGroupId = stringValue(item["group_id"]) ?? groupId;
  if (!studentCrmId || !resolvedGroupId) return false;
  await database.query(
    `INSERT INTO crm_group_memberships (
       branch_crm_id,
       group_crm_id,
       student_crm_id,
       external_membership_id,
       status,
       enrolled_at,
       unenrolled_at,
       raw_record_id,
       raw,
       synced_at,
       last_seen_batch_id,
       source_scope,
       record_state,
       stale_at,
       stale_reason,
       raw_observation_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(),
       $10, $11, 'current', NULL, NULL, $12
     )
     ON CONFLICT (branch_crm_id, group_crm_id, student_crm_id)
     DO UPDATE SET
       external_membership_id = EXCLUDED.external_membership_id,
       status = EXCLUDED.status,
       enrolled_at = EXCLUDED.enrolled_at,
       unenrolled_at = EXCLUDED.unenrolled_at,
       raw_record_id = EXCLUDED.raw_record_id,
       raw_observation_id = EXCLUDED.raw_observation_id,
       raw = EXCLUDED.raw,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      branchId,
      resolvedGroupId,
      studentCrmId,
      stringValue(item["id"]),
      stringValue(item["status"] ?? item["is_active"]),
      isoDate(item["b_date"] ?? item["created_at"]),
      isoDate(item["e_date"] ?? item["deleted_at"]),
      context.rawId,
      stableJson(item),
      context.batchId,
      context.scopeKey,
      context.observationId,
    ],
  );
  await database.query(
    `UPDATE crm_group_memberships AS membership
     SET
       record_state = 'stale',
       stale_at = now(),
       stale_reason = 'student_or_group_parent_not_current'
     WHERE membership.branch_crm_id = $1
       AND membership.group_crm_id = $2
       AND membership.student_crm_id = $3
       AND (
         NOT EXISTS (
           SELECT 1
           FROM crm_students AS student
           WHERE student.branch_crm_id = membership.branch_crm_id
             AND student.crm_id = membership.student_crm_id
             AND student.record_state = 'current'
         )
         OR NOT EXISTS (
           SELECT 1
           FROM crm_groups AS crm_group
           WHERE crm_group.branch_crm_id = membership.branch_crm_id
             AND crm_group.crm_id = membership.group_crm_id
             AND crm_group.record_state = 'current'
         )
       )`,
    [branchId, resolvedGroupId, studentCrmId],
  );
  return true;
}

export async function normalizeEntity(
  database: PGlite,
  options: ImportEntityOptions,
  item: JsonRecord,
  context: NormalizationContext,
): Promise<boolean> {
  switch (options.recordType) {
    case "branches":
      return normalizeBranch(database, item, context);
    case "students":
      return normalizeStudent(database, options.branchId, item, context);
    case "leads":
      return normalizeLead(database, options.branchId, item, context);
    case "customer_tariffs":
      return normalizeCustomerTariff(
        database,
        options.branchId,
        options.forcedCustomerId ?? "",
        item,
        context,
      );
    case "teachers":
      return normalizeTeacher(database, options.branchId, item, context);
    case "groups":
      return normalizeGroup(database, options.branchId, item, context);
    case "payments":
      return normalizePayment(database, options.branchId, item, context);
    case "lessons":
      return normalizeLesson(database, options.branchId, item, context);
    case "change_log":
      return normalizeChangeLog(database, options.branchId, item, context);
    case "group_memberships":
      return normalizeGroupMembership(
        database,
        options.branchId,
        options.forcedGroupId ?? "",
        item,
        context,
      );
    default:
      return normalizedReferenceTypes.has(options.recordType)
        ? normalizeReferenceRecord(
            database,
            options.branchId,
            options.recordType,
            item,
            context,
          )
        : false;
  }
}

const lifecycleTableByRecordType: Readonly<Record<string, string>> = {
  branches: "crm_branches",
  students: "crm_students",
  leads: "crm_leads",
  teachers: "crm_teachers",
  groups: "crm_groups",
  payments: "crm_payments",
  lessons: "crm_lessons",
  customer_tariffs: "crm_customer_tariffs",
  group_memberships: "crm_group_memberships",
};

async function markMissingRowsStale(
  database: PGlite,
  table: string,
  batchId: string,
  scopeKey: string,
): Promise<void> {
  await database.query(
    `UPDATE ${table}
     SET
       record_state = 'stale',
       stale_at = now(),
       stale_reason = 'missing_from_completed_snapshot'
     WHERE source_scope = $1
       AND last_seen_batch_id <> $2
       AND record_state = 'current'`,
    [scopeKey, batchId],
  );
}

async function reconcileScope(
  database: PGlite,
  batchId: string,
  options: ImportEntityOptions,
): Promise<void> {
  const table = lifecycleTableByRecordType[options.recordType];
  if (table) {
    await markMissingRowsStale(database, table, batchId, options.scopeKey);
  } else if (normalizedReferenceTypes.has(options.recordType)) {
    await markMissingRowsStale(
      database,
      "crm_reference_records",
      batchId,
      options.scopeKey,
    );
  }

  if (options.recordType === "students") {
    await markMissingRowsStale(
      database,
      "student_profiles",
      batchId,
      options.scopeKey,
    );
    await database.query(
      `UPDATE crm_leads AS lead
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'converted_to_student'
       WHERE lead.branch_crm_id = $1
         AND lead.record_state = 'current'
         AND EXISTS (
           SELECT 1
           FROM crm_students AS student
           WHERE student.branch_crm_id = lead.branch_crm_id
             AND student.crm_id = lead.crm_id
             AND student.record_state = 'current'
         )`,
      [options.branchId],
    );
    await database.query(
      `UPDATE crm_customer_tariffs AS tariff
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'customer_missing_from_completed_snapshot'
       WHERE tariff.branch_crm_id = $1
         AND tariff.record_state = 'current'
         AND EXISTS (
           SELECT 1
           FROM crm_students AS student
           WHERE student.branch_crm_id = tariff.branch_crm_id
             AND student.crm_id = tariff.customer_crm_id
             AND student.record_state = 'stale'
         )`,
       [options.branchId],
    );
    await database.query(
      `UPDATE crm_group_memberships AS membership
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'student_missing_from_completed_snapshot'
       WHERE membership.branch_crm_id = $1
         AND membership.record_state = 'current'
         AND EXISTS (
           SELECT 1
           FROM crm_students AS student
           WHERE student.branch_crm_id = membership.branch_crm_id
             AND student.crm_id = membership.student_crm_id
             AND student.record_state = 'stale'
         )`,
      [options.branchId],
    );
    await database.query(
      `UPDATE crm_attendance AS attendance
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'student_missing_from_completed_snapshot'
       WHERE attendance.record_state = 'current'
         AND attendance.branch_crm_id = $1
         AND EXISTS (
           SELECT 1
           FROM crm_lessons AS lesson
           JOIN crm_students AS student
             ON student.branch_crm_id = lesson.branch_crm_id
            AND student.crm_id = attendance.student_crm_id
           WHERE lesson.branch_crm_id = attendance.branch_crm_id
             AND lesson.crm_id = attendance.lesson_crm_id
             AND student.record_state = 'stale'
         )`,
      [options.branchId],
    );
    await database.query(
      `UPDATE crm_payments AS payment
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'student_missing_from_completed_snapshot'
       WHERE payment.branch_crm_id = $1
         AND payment.student_crm_id IS NOT NULL
         AND payment.record_state = 'current'
         AND EXISTS (
           SELECT 1
           FROM crm_students AS student
           WHERE student.branch_crm_id = payment.branch_crm_id
             AND student.crm_id = payment.student_crm_id
             AND student.record_state = 'stale'
         )`,
      [options.branchId],
    );
  }

  if (options.recordType === "lessons") {
    await markMissingRowsStale(
      database,
      "crm_attendance",
      batchId,
      options.scopeKey,
    );
  }

  if (options.recordType === "groups") {
    await database.query(
      `UPDATE crm_group_memberships AS membership
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'group_missing_from_completed_snapshot'
       WHERE membership.branch_crm_id = $1
         AND membership.record_state = 'current'
         AND EXISTS (
           SELECT 1
           FROM crm_groups AS crm_group
           WHERE crm_group.branch_crm_id = membership.branch_crm_id
             AND crm_group.crm_id = membership.group_crm_id
             AND crm_group.record_state = 'stale'
         )`,
      [options.branchId],
    );
  }

  if (options.recordType === "branches") {
    for (const table of [
      "crm_students",
      "crm_leads",
      "crm_groups",
      "crm_teachers",
      "crm_payments",
      "crm_lessons",
      "crm_customer_tariffs",
      "crm_group_memberships",
      "crm_reference_records",
    ]) {
      await database.query(
        `UPDATE ${table} AS normalized
         SET
           record_state = 'stale',
           stale_at = now(),
           stale_reason = 'branch_missing_from_completed_snapshot'
         WHERE normalized.record_state = 'current'
           AND EXISTS (
             SELECT 1
             FROM crm_branches AS branch
             WHERE branch.crm_id = normalized.branch_crm_id
               AND branch.record_state = 'stale'
           )`,
      );
    }
    await database.query(
      `UPDATE student_profiles AS profile
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'branch_missing_from_completed_snapshot'
       WHERE profile.record_state = 'current'
         AND EXISTS (
           SELECT 1
           FROM crm_branches AS branch
           WHERE branch.crm_id = profile.branch_crm_id
             AND branch.record_state = 'stale'
         )`,
    );
    await database.query(
      `UPDATE crm_attendance AS attendance
       SET
         record_state = 'stale',
         stale_at = now(),
         stale_reason = 'branch_missing_from_completed_snapshot'
       WHERE attendance.record_state = 'current'
         AND EXISTS (
           SELECT 1
           FROM crm_lessons AS lesson
           WHERE lesson.branch_crm_id = attendance.branch_crm_id
             AND lesson.crm_id = attendance.lesson_crm_id
             AND lesson.record_state = 'stale'
         )`,
    );
  }
}

export async function importEntity(
  client: ReadOnlyAlfaClient,
  database: PGlite,
  batchId: string,
  options: ImportEntityOptions,
): Promise<EntityImportResult> {
  const existingScope = await database.query<{
    status: string;
    pages_fetched: number;
    records_fetched: number;
  }>(
    `SELECT status, pages_fetched, records_fetched
     FROM alpha_sync_scope_runs
     WHERE sync_batch_id = $1
       AND scope_key = $2
     LIMIT 1`,
    [batchId, options.scopeKey],
  );
  const existing = existingScope.rows[0];
  if (existing?.status === "completed") {
    return {
      pages: Number(existing.pages_fetched),
      records: Number(existing.records_fetched),
      rawSaved: 0,
      normalized: Number(existing.records_fetched),
      repeatedPageStopped: false,
      resumed: true,
    };
  }

  const previousObservations = await database.query<{
    page: number;
    payload_hash: string;
  }>(
    `SELECT observation.page, raw.payload_hash
     FROM alpha_raw_observations AS observation
     JOIN alpha_raw_records AS raw
       ON raw.id = observation.raw_record_id
     WHERE observation.sync_batch_id = $1
       AND observation.scope_key = $2
     ORDER BY observation.page, raw.payload_hash`,
    [batchId, options.scopeKey],
  );
  const payloadHashesByPage = new Map<number, string[]>();
  for (const row of previousObservations.rows) {
    const hashes = payloadHashesByPage.get(Number(row.page)) ?? [];
    hashes.push(row.payload_hash);
    payloadHashesByPage.set(Number(row.page), hashes);
  }
  let inferredPages = 0;
  while (payloadHashesByPage.has(inferredPages)) inferredPages += 1;

  let page = Math.max(Number(existing?.pages_fetched ?? 0), inferredPages);
  let records = Math.max(
    Number(existing?.records_fetched ?? 0),
    previousObservations.rows.length,
  );
  let rawSaved = 0;
  let normalized = 0;
  const observedPageHashes = new Set(
    [...payloadHashesByPage.values()].map((hashes) =>
      sha256(stableJson([...hashes].sort())),
    ),
  );
  const pageSize = options.pageSize ?? defaultPageSize;
  const maxPages =
    Number.isInteger(options.maxPages) && Number(options.maxPages) > 0
      ? Number(options.maxPages)
      : 100_000;
  let prefetchedPages = new Map<number, PrefetchedResult>();

  await database.query(
    `INSERT INTO alpha_sync_scope_runs (
       sync_batch_id,
       scope_key,
       branch_id,
       entity_type,
       status,
       pages_fetched,
       records_fetched,
       safe_error_code,
       started_at,
       finished_at
     ) VALUES ($1, $2, $3, $4, 'running', 0, 0, NULL, now(), NULL)
     ON CONFLICT (sync_batch_id, scope_key) DO UPDATE SET
       status = 'running',
       safe_error_code = NULL,
       finished_at = NULL`,
    [batchId, options.scopeKey, options.branchId, options.recordType],
  );

  try {
    while (true) {
      if (page >= maxPages) throw new AlfaReadError("pagination_guard");
      const prefetched = prefetchedPages.get(page);
      prefetchedPages.delete(page);
      const response = prefetched
        ? prefetched.ok
          ? prefetched.value
          : (() => {
              throw prefetched.error;
            })()
        : await client.postIndex(options.endpoint, {
            ...(options.body ?? {}),
            page,
            pageSize,
          });
      const items = listItems(response);
      const responseTotal = totalItems(response);
      const pageHash = sha256(
        stableJson(
          items.map((item) => sha256(stableJson(item))).sort(),
        ),
      );
      if (items.length > 0 && observedPageHashes.has(pageHash)) {
        throw new AlfaReadError("repeated_page");
      }
      if (items.length > 0) observedPageHashes.add(pageHash);

      await database.exec("BEGIN");
      try {
        for (const item of items) {
          const raw = await saveRawRecord(
            database,
            batchId,
            options,
            item,
            page,
          );
          if (raw.created) rawSaved += 1;
          if (
            await normalizeEntity(database, options, item, {
              batchId,
              rawId: raw.rawId,
              observationId: raw.observationId,
              scopeKey: options.scopeKey,
            })
          ) {
            normalized += 1;
          }
        }
        await database.query(
          `UPDATE alpha_sync_scope_runs
           SET
             pages_fetched = $3,
             records_fetched = $4
           WHERE sync_batch_id = $1
             AND scope_key = $2`,
          [
            batchId,
            options.scopeKey,
            page + 1,
            records + items.length,
          ],
        );
        await database.exec("COMMIT");
      } catch (error) {
        await database.exec("ROLLBACK");
        throw error;
      }

      records += items.length;
      page += 1;
      if (items.length === 0) break;
      if (responseTotal !== null && records >= responseTotal) break;
      if (items.length < pageSize) break;

      if (
        responseTotal !== null &&
        prefetchedPages.size === 0 &&
        page < maxPages
      ) {
        const remainingPages = Math.ceil(
          Math.max(0, responseTotal - records) / pageSize,
        );
        const pagesToPrefetch = Math.min(
          remainingPages,
          paginationPrefetchConcurrency,
          maxPages - page,
        );
        if (pagesToPrefetch > 0) {
          prefetchedPages = await prefetchPages(client, {
            endpoint: options.endpoint,
            body: options.body,
            pageSize,
            pages: Array.from(
              { length: pagesToPrefetch },
              (_value, index) => page + index,
            ),
          });
        }
      }
    }

    await database.exec("BEGIN");
    try {
      await reconcileScope(database, batchId, options);
      await database.query(
        `UPDATE alpha_sync_scope_runs
         SET
           status = 'completed',
           pages_fetched = $3,
           records_fetched = $4,
           safe_error_code = NULL,
           finished_at = now()
         WHERE sync_batch_id = $1 AND scope_key = $2`,
        [batchId, options.scopeKey, page, records],
      );
      await database.exec("COMMIT");
    } catch (error) {
      await database.exec("ROLLBACK");
      throw error;
    }

    return {
      pages: page,
      records,
      rawSaved,
      normalized,
      repeatedPageStopped: false,
    };
  } catch (error) {
    await database.query(
      `UPDATE alpha_sync_scope_runs
       SET
         status = 'incomplete',
         pages_fetched = $3,
         records_fetched = $4,
         safe_error_code = $5,
         finished_at = now()
       WHERE sync_batch_id = $1 AND scope_key = $2`,
      [
        batchId,
        options.scopeKey,
        page,
        records,
        safeAlfaErrorCode(error),
      ],
    );
    throw error;
  }
}

async function importEntityOrResume(
  client: ReadOnlyAlfaClient,
  database: PGlite,
  batchId: string,
  options: ImportEntityOptions,
): Promise<EntityImportResult> {
  const completed = await database.query<{
    pages_fetched: number;
    records_fetched: number;
  }>(
    `SELECT pages_fetched, records_fetched
     FROM alpha_sync_scope_runs
     WHERE sync_batch_id = $1
       AND scope_key = $2
       AND status = 'completed'
     LIMIT 1`,
    [batchId, options.scopeKey],
  );
  const row = completed.rows[0];
  if (row) {
    return {
      pages: Number(row.pages_fetched),
      records: Number(row.records_fetched),
      rawSaved: 0,
      normalized: Number(row.records_fetched),
      repeatedPageStopped: false,
      resumed: true,
    };
  }
  return importEntity(client, database, batchId, options);
}

async function mapBranchesToLegalEntities(database: PGlite): Promise<{
  matched: number;
  unmatched: number;
}> {
  const branches = await database.query<{
    crm_id: string;
    name: string | null;
  }>(
    `SELECT crm_id, name
     FROM crm_branches
     WHERE record_state = 'current'
     ORDER BY crm_id`,
  );
  let matched = 0;
  let unmatched = 0;
  for (const branch of branches.rows) {
    const rule = operatingUnitRule(branch.name);
    if (!rule) {
      unmatched += 1;
      continue;
    }
    await database.query(
      `INSERT INTO branch_legal_entity_assignments (
         branch_crm_id,
         branch_name,
         operating_unit_code,
         legal_entity_id,
         mapping_status,
         mapping_rule,
         confirmation_source
       )
       SELECT
         $1,
         $2,
         operating_unit_code,
         legal_entity_id,
         'owner_confirmed_name_match',
         $4,
         confirmation_source
       FROM operating_unit_legal_entity
       WHERE operating_unit_code = $3
       ON CONFLICT (branch_crm_id) DO UPDATE SET
         branch_name = EXCLUDED.branch_name,
         operating_unit_code = EXCLUDED.operating_unit_code,
         legal_entity_id = EXCLUDED.legal_entity_id,
         mapping_status = EXCLUDED.mapping_status,
         mapping_rule = EXCLUDED.mapping_rule,
         confirmation_source = EXCLUDED.confirmation_source,
         updated_at = now()`,
      [branch.crm_id, branch.name, rule.operatingUnitCode, rule.mappingRule],
    );
    matched += 1;
  }
  return { matched, unmatched };
}

export async function buildFamilyCandidates(database: PGlite): Promise<number> {
  await database.query(
    `UPDATE family_merge_candidates
     SET status = 'stale', updated_at = now()
     WHERE status = 'pending_review'`,
  );
  const students = await database.query<{
    crm_id: string;
    branch_crm_id: string;
    phone: string | null;
    raw: JsonRecord | null;
  }>(
    `SELECT crm_id, branch_crm_id, phone, raw
     FROM crm_students
     WHERE record_state = 'current'
       AND phone IS NOT NULL
       AND phone <> ''
     ORDER BY crm_id`,
  );
  const byPhone = new Map<string, typeof students.rows>();
  for (const student of students.rows) {
    const phone = normalizePhone(student.phone);
    if (!phone) continue;
    const bucket = byPhone.get(phone) ?? [];
    bucket.push(student);
    byPhone.set(phone, bucket);
  }

  let candidates = 0;
  for (const [phone, bucket] of byPhone) {
    if (bucket.length < 2) continue;
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < bucket.length;
        rightIndex += 1
      ) {
        const pair = [bucket[leftIndex]!, bucket[rightIndex]!].sort(
          (left, right) =>
            `${left.branch_crm_id}\u0000${left.crm_id}`.localeCompare(
              `${right.branch_crm_id}\u0000${right.crm_id}`,
            ),
        );
        const left = pair[0]!;
        const right = pair[1]!;
        if (
          left.branch_crm_id === right.branch_crm_id &&
          left.crm_id === right.crm_id
        ) {
          continue;
        }
        const leftGuardian = normalizeName(left.raw?.["legal_name"]);
        const rightGuardian = normalizeName(right.raw?.["legal_name"]);
        const guardianNameMatches =
          !!leftGuardian && !!rightGuardian && leftGuardian === rightGuardian;
        const reasonCodes = familyCandidateReasonCodes(guardianNameMatches);
        const confidence = guardianNameMatches ? "0.8000" : "0.6500";
        await database.query(
          `INSERT INTO family_merge_candidates (
             left_student_branch_crm_id,
             left_student_crm_id,
             right_student_branch_crm_id,
             right_student_crm_id,
             branch_crm_id,
             candidate_type,
             reason_codes,
             evidence,
             confidence,
             status,
             updated_at
           ) VALUES (
             $1,
             $2,
             $3,
             $4,
             $5,
             'possible_shared_family',
             $6::jsonb,
             $7::jsonb,
             $8,
             'pending_review',
             now()
           )
           ON CONFLICT (
             left_student_branch_crm_id,
             left_student_crm_id,
             right_student_branch_crm_id,
             right_student_crm_id,
             candidate_type
           ) DO UPDATE SET
             branch_crm_id = EXCLUDED.branch_crm_id,
             reason_codes = EXCLUDED.reason_codes,
             evidence = EXCLUDED.evidence,
             confidence = EXCLUDED.confidence,
             status = CASE
               WHEN family_merge_candidates.status IN ('pending_review', 'stale')
                 THEN 'pending_review'
               ELSE family_merge_candidates.status
             END,
             updated_at = now()`,
          [
            left.branch_crm_id,
            left.crm_id,
            right.branch_crm_id,
            right.crm_id,
            left.branch_crm_id === right.branch_crm_id
              ? left.branch_crm_id
              : null,
            JSON.stringify(reasonCodes),
            JSON.stringify({
              sharedContactHash: sha256(phone),
              guardianNameMatches,
              requiresManualConfirmation: true,
            }),
            confidence,
          ],
        );
        candidates += 1;
      }
    }
  }
  return candidates;
}

interface SanitizedImportReport {
  mode: AlfaSyncMode;
  status: "completed" | "partial";
  resumedBatch: boolean;
  checkedAt: string;
  incrementalWindow: Pick<
    IncrementalWindow,
    "overlapDays" | "dateFrom" | "dateTo"
  > | null;
  migrationsApplied: number;
  tableCount: number;
  branchCount: number;
  legalEntityMappings: { matched: number; unmatched: number };
  familyCandidates: number;
  confirmedFamiliesCreated: 0;
  entities: Record<string, EntityImportResult>;
  errors: Array<{
    branchId: string;
    entity: string;
    error: string;
  }>;
  secretsPersisted: false;
  personalDataPrinted: false;
}

function recordImportError(
  report: SanitizedImportReport,
  branchId: string,
  entity: string,
  error: unknown,
): void {
  report.status = "partial";
  report.errors.push({
    branchId,
    entity,
    error: safeAlfaErrorCode(error),
  });
}

function accumulateEntityResult(
  current: EntityImportResult | undefined,
  next: EntityImportResult,
): EntityImportResult {
  return current
    ? {
        pages: current.pages + next.pages,
        records: current.records + next.records,
        rawSaved: current.rawSaved + next.rawSaved,
        normalized: current.normalized + next.normalized,
        repeatedPageStopped:
          current.repeatedPageStopped || next.repeatedPageStopped,
      }
    : next;
}

async function main(): Promise<void> {
  const { database, migrationsApplied } = await openSandboxDatabase();
  let syncMode: AlfaSyncMode = "full_sandbox_read_only";
  let incrementalWindow: IncrementalWindow | null = null;
  const report: SanitizedImportReport = {
    mode: syncMode,
    status: "completed",
    resumedBatch: false,
    checkedAt: new Date().toISOString(),
    incrementalWindow: null,
    migrationsApplied,
    tableCount: await sandboxTableCount(database),
    branchCount: 0,
    legalEntityMappings: { matched: 0, unmatched: 0 },
    familyCandidates: 0,
    confirmedFamiliesCreated: 0,
    entities: {},
    errors: [],
    secretsPersisted: false,
    personalDataPrinted: false,
  };

  let batchId: string | null = null;
  try {
    await seedOwnerConfirmedMasterData(database);
    try {
      syncMode = resolveAlfaSyncMode(process.env.ALFACRM_SYNC_MODE);
      let storedWatermark: string | null = null;
      if (
        syncMode === "incremental_discovery_read_only" &&
        !process.env.ALFACRM_WATERMARK?.trim()
      ) {
        const latest = await database.query<{
          finished_at: string | Date | null;
        }>(
          `SELECT finished_at
           FROM alpha_sync_batches
           WHERE status = 'completed'
             AND finished_at IS NOT NULL
           ORDER BY finished_at DESC
           LIMIT 1`,
        );
        const value = latest.rows[0]?.finished_at;
        storedWatermark =
          value instanceof Date ? value.toISOString() : (value ?? null);
      }
      incrementalWindow = resolveIncrementalWindow(
        syncMode,
        process.env.ALFACRM_WATERMARK?.trim() || storedWatermark,
        process.env.ALFACRM_OVERLAP_DAYS,
      );
    } catch (error) {
      const safeCode =
        error instanceof Error &&
        [
          "invalid_sync_mode",
          "invalid_overlap_days",
          "missing_incremental_watermark",
          "invalid_incremental_watermark",
          "invalid_sync_clock",
        ].includes(error.message)
          ? error.message
          : "invalid_sync_plan";
      throw new AlfaReadError(safeCode);
    }
    report.mode = syncMode;
    report.incrementalWindow = incrementalWindow
      ? {
          overlapDays: incrementalWindow.overlapDays,
          dateFrom: incrementalWindow.dateFrom,
          dateTo: incrementalWindow.dateTo,
        }
      : null;
    const client = new SerializedReadOnlyAlfaClient();
    const resumeRequested =
      syncMode === "full_sandbox_read_only" &&
      process.env.ALFACRM_RESUME_RUNNING_BATCH === "1";
    const resumable = resumeRequested
      ? await database.query<{ id: string; status: string }>(
          `SELECT id
           FROM alpha_sync_batches
           WHERE status IN ('running', 'partial')
             AND mode = $1
           ORDER BY started_at DESC
           LIMIT 1`,
          [syncMode],
        )
      : { rows: [] as Array<{ id: string; status: string }> };
    batchId = resumable.rows[0]?.id ?? null;
    report.resumedBatch = Boolean(batchId);
    if (batchId) {
      await database.query(
        `UPDATE alpha_sync_batches
         SET status = 'running', finished_at = NULL
         WHERE id = $1`,
        [batchId],
      );
    }
    if (!batchId) {
      const batch = await database.query<{ id: string }>(
        `INSERT INTO alpha_sync_batches (
           status,
           mode,
           from_date,
           to_date,
           triggered_by
         ) VALUES ('running', $1, $2, $3, 'owner_authorized_cli')
         RETURNING id`,
        [
          syncMode,
          incrementalWindow?.dateFrom ?? null,
          incrementalWindow?.dateTo ?? null,
        ],
      );
      batchId = batch.rows[0]?.id ?? null;
    }
    if (!batchId) throw new AlfaReadError("sandbox_batch_failed");

    const branches = await importEntityOrResume(client, database, batchId, {
      branchId: "0",
      endpoint: "0/branch/index",
      recordType: "branches",
      scopeKey: "global:branches",
    });
    report.entities["branches"] = branches;

    const branchRows = await database.query<{ crm_id: string }>(
      `SELECT crm_id
       FROM crm_branches
       WHERE record_state = 'current'
       ORDER BY crm_id`,
    );
    report.branchCount = branchRows.rows.length;
    report.legalEntityMappings = await mapBranchesToLegalEntities(database);

    for (const branch of branchRows.rows) {
      const branchId = branch.crm_id;
      if (syncMode === "full_sandbox_read_only") {
        const requiredEntities: Array<{
          key: string;
          endpoint: string;
          recordType: string;
          body?: JsonRecord;
        }> = [
          {
            key: "leads",
            endpoint: `${branchId}/customer/index`,
            recordType: "leads",
            body: { is_study: 0, removed: 1 },
          },
          {
            key: "students",
            endpoint: `${branchId}/customer/index`,
            recordType: "students",
            body: { is_study: 1, removed: 1, withGroups: true },
          },
          {
            key: "groups",
            endpoint: `${branchId}/group/index`,
            recordType: "groups",
            body: { removed: 1 },
          },
          {
            key: "teachers",
            endpoint: `${branchId}/teacher/index`,
            recordType: "teachers",
            body: { removed: 1 },
          },
          {
            key: "payments",
            endpoint: `${branchId}/pay/index`,
            recordType: "payments",
          },
        ];
        const referenceEntities: Array<{
          key: string;
          endpoint: string;
          recordType: string;
          body?: JsonRecord;
        }> = [
          {
            key: "subjects",
            endpoint: `${branchId}/subject/index`,
            recordType: "subjects",
            body: { active: false },
          },
          {
            key: "lesson_types",
            endpoint: `${branchId}/lesson-type/index`,
            recordType: "lesson_types",
          },
          {
            key: "locations",
            endpoint: `${branchId}/location/index`,
            recordType: "locations",
          },
          {
            key: "rooms",
            endpoint: `${branchId}/room/index`,
            recordType: "rooms",
          },
          {
            key: "tariffs",
            endpoint: `${branchId}/tariff/index`,
            recordType: "tariffs",
          },
          {
            key: "regular_lessons",
            endpoint: `${branchId}/regular-lesson/index`,
            recordType: "regular_lessons",
          },
          {
            key: "users",
            endpoint: `${branchId}/user/index`,
            recordType: "users",
          },
          {
            key: "study_statuses",
            endpoint: `${branchId}/study-status/index`,
            recordType: "study_statuses",
          },
          {
            key: "lead_statuses",
            endpoint: `${branchId}/lead-status/index`,
            recordType: "lead_statuses",
          },
          {
            key: "lead_sources",
            endpoint: `${branchId}/lead-source/index`,
            recordType: "lead_sources",
          },
          {
            key: "pipelines",
            endpoint: `${branchId}/pipeline/index`,
            recordType: "pipelines",
          },
          {
            key: "discounts",
            endpoint: `${branchId}/discount/index`,
            recordType: "discounts",
          },
          {
            key: "teacher_rates",
            endpoint: `${branchId}/teacher/teacher-rate`,
            recordType: "teacher_rates",
          },
          {
            key: "teacher_working_hours",
            endpoint: `${branchId}/teacher/working-hour`,
            recordType: "teacher_working_hours",
          },
          {
            key: "pay_accounts",
            endpoint: `${branchId}/pay-account/index`,
            recordType: "pay_accounts",
          },
          {
            key: "pay_types",
            endpoint: `${branchId}/pay-type/index`,
            recordType: "pay_types",
          },
          {
            key: "pay_items",
            endpoint: `${branchId}/pay-item/index`,
            recordType: "pay_items",
          },
          {
            key: "pay_item_categories",
            endpoint: `${branchId}/pay-item-category/index`,
            recordType: "pay_item_categories",
          },
        ];

        const requiredOptions = requiredEntities.map<ImportEntityOptions>(
          (entity) => ({
            branchId,
            endpoint: entity.endpoint,
            recordType: entity.recordType,
            scopeKey: `${branchId}:${entity.recordType}`,
            body: entity.body,
          }),
        );
        const requiredClient = await prefetchResumePages(
          client,
          database,
          batchId,
          requiredOptions,
        );
        for (const [index, entity] of requiredEntities.entries()) {
          const options = requiredOptions[index]!;
          const reportKey = `branch_${branchId}.${entity.key}`;
          try {
            report.entities[reportKey] = await importEntityOrResume(
              requiredClient,
              database,
              batchId,
              options,
            );
          } catch (error) {
            recordImportError(report, branchId, entity.key, error);
          }
        }

        const lessonOptions = [1, 2, 3].map<ImportEntityOptions>(
          (status) => ({
            branchId,
            endpoint: `${branchId}/lesson/index`,
            recordType: "lessons",
            scopeKey: `${branchId}:lessons:status:${status}`,
            body: { status },
          }),
        );
        const lessonClient = await prefetchResumePages(
          client,
          database,
          batchId,
          lessonOptions,
        );
        for (const [index, status] of [1, 2, 3].entries()) {
          const options = lessonOptions[index]!;
          const reportKey = `branch_${branchId}.lessons_status_${status}`;
          try {
            report.entities[reportKey] = await importEntityOrResume(
              lessonClient,
              database,
              batchId,
              options,
            );
          } catch (error) {
            recordImportError(
              report,
              branchId,
              `lessons_status_${status}`,
              error,
            );
          }
        }

        const referenceOptions = referenceEntities.map<ImportEntityOptions>(
          (entity) => ({
            branchId,
            endpoint: entity.endpoint,
            recordType: entity.recordType,
            scopeKey: `${branchId}:reference:${entity.recordType}`,
            body: entity.body,
          }),
        );
        const referenceClient = await prefetchResumePages(
          client,
          database,
          batchId,
          referenceOptions,
        );
        for (const [index, entity] of referenceEntities.entries()) {
          const options = referenceOptions[index]!;
          const reportKey = `branch_${branchId}.${entity.key}`;
          try {
            report.entities[reportKey] = await importEntityOrResume(
              referenceClient,
              database,
              batchId,
              options,
            );
          } catch (error) {
            recordImportError(report, branchId, entity.key, error);
          }
        }

        const students = await database.query<{ crm_id: string }>(
          `SELECT crm_id
           FROM crm_students
           WHERE branch_crm_id = $1
             AND record_state = 'current'
           ORDER BY crm_id`,
          [branchId],
        );
        const completedTariffScopes = await database.query<{
          scope_key: string;
        }>(
          `SELECT scope_key
           FROM alpha_sync_scope_runs
           WHERE sync_batch_id = $1
             AND branch_id = $2
             AND entity_type = 'customer_tariffs'
             AND status = 'completed'`,
          [batchId, branchId],
        );
        const completedTariffScopeKeys = new Set(
          completedTariffScopes.rows.map((row) => row.scope_key),
        );
        const pendingStudents = students.rows.filter(
          (student) =>
            !completedTariffScopeKeys.has(
              `${branchId}:customer_tariffs:${student.crm_id}`,
            ),
        );
        for (
          let offset = 0;
          offset < pendingStudents.length;
          offset += tariffPrefetchWindowSize
        ) {
          const window = pendingStudents.slice(
            offset,
            offset + tariffPrefetchWindowSize,
          );
          const tariffOptions = window.map<ImportEntityOptions>(
            (student) => ({
              branchId,
              endpoint: `${branchId}/customer-tariff/index?customer_id=${encodeURIComponent(student.crm_id)}`,
              recordType: "customer_tariffs",
              scopeKey: `${branchId}:customer_tariffs:${student.crm_id}`,
              forcedCustomerId: student.crm_id,
              pageSize: tariffPageSize,
            }),
          );
          const prefetchedClient = await prefetchResumePages(
            client,
            database,
            batchId,
            tariffOptions,
          );
          for (const [index] of window.entries()) {
            const options = tariffOptions[index]!;
            const reportKey = `branch_${branchId}.customer_tariffs`;
            try {
              const result = await importEntityOrResume(
                prefetchedClient,
                database,
                batchId,
                options,
              );
              report.entities[reportKey] = accumulateEntityResult(
                report.entities[reportKey],
                result,
              );
            } catch (error) {
              recordImportError(report, branchId, "customer_tariffs", error);
            }
          }
        }

        const groups = await database.query<{ crm_id: string }>(
          `SELECT crm_id
           FROM crm_groups
           WHERE branch_crm_id = $1
             AND record_state = 'current'
           ORDER BY crm_id`,
          [branchId],
        );
        const membershipOptions = groups.rows.map<ImportEntityOptions>(
          (group) => ({
            branchId,
            endpoint: `${branchId}/cgi/index?group_id=${encodeURIComponent(group.crm_id)}`,
            recordType: "group_memberships",
            scopeKey: `${branchId}:group_memberships:${group.crm_id}`,
            body: { group_id: group.crm_id },
            forcedGroupId: group.crm_id,
          }),
        );
        const membershipClient = await prefetchResumePages(
          client,
          database,
          batchId,
          membershipOptions,
        );
        for (const [index] of groups.rows.entries()) {
          const options = membershipOptions[index]!;
          const reportKey = `branch_${branchId}.group_membership`;
          try {
            const result = await importEntityOrResume(
              membershipClient,
              database,
              batchId,
              options,
            );
            report.entities[reportKey] = accumulateEntityResult(
              report.entities[reportKey],
              result,
            );
          } catch (error) {
            recordImportError(report, branchId, "group_membership", error);
          }
        }
      }

    }

    const changeLogOptions = branchRows.rows.map<ImportEntityOptions>(
      (branch) => ({
        branchId: branch.crm_id,
        endpoint: `${branch.crm_id}/log/index`,
        recordType: "change_log",
        scopeKey: `${branch.crm_id}:change_log:${
          incrementalWindow?.dateFrom ?? "full"
        }`,
        body: incrementalWindow
          ? { date_from: incrementalWindow.dateFrom }
          : undefined,
      }),
    );
    const changeLogClient = await prefetchResumePages(
      client,
      database,
      batchId,
      changeLogOptions,
    );
    for (const [index, branch] of branchRows.rows.entries()) {
      const options = changeLogOptions[index]!;
      const changeLogKey = `branch_${branch.crm_id}.change_log`;
      try {
        report.entities[changeLogKey] = await importEntityOrResume(
          changeLogClient,
          database,
          batchId,
          options,
        );
      } catch (error) {
        recordImportError(report, branch.crm_id, "change_log", error);
      }
    }

    const incompleteScopes = await database.query<{
      branch_id: string;
      entity_type: string;
      safe_error_code: string | null;
    }>(
      `SELECT branch_id, entity_type, safe_error_code
       FROM alpha_sync_scope_runs
       WHERE sync_batch_id = $1
         AND status <> 'completed'
       ORDER BY branch_id, entity_type`,
      [batchId],
    );
    if (incompleteScopes.rows.length > 0) {
      report.status = "partial";
      for (const scope of incompleteScopes.rows) {
        report.errors.push({
          branchId: scope.branch_id,
          entity: scope.entity_type,
          error: scope.safe_error_code ?? "incomplete_scope",
        });
      }
    }
    if (syncMode === "full_sandbox_read_only" && report.status === "completed") {
      report.familyCandidates = await buildFamilyCandidates(database);
    }
    const scopeTotals = await database.query<{
      requested: number;
      succeeded: number;
      failed: number;
      fetched: number;
    }>(
      `SELECT
         COUNT(*)::int AS requested,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS succeeded,
         COUNT(*) FILTER (WHERE status <> 'completed')::int AS failed,
         COALESCE(SUM(records_fetched), 0)::int AS fetched
       FROM alpha_sync_scope_runs
       WHERE sync_batch_id = $1`,
      [batchId],
    );
    const observationTotals = await database.query<{ saved: number }>(
      `SELECT COUNT(*)::int AS saved
       FROM alpha_raw_observations
       WHERE sync_batch_id = $1`,
      [batchId],
    );
    const totals = scopeTotals.rows[0] ?? {
      requested: 0,
      succeeded: 0,
      failed: 0,
      fetched: 0,
    };
    await database.query(
      `UPDATE alpha_sync_batches
       SET
         status = $2,
         finished_at = now(),
         entities_requested = $3,
         entities_succeeded = $4,
         entities_failed = $5,
         total_fetched = $6,
         total_saved = $7,
         errors = $8::jsonb,
         duration_ms = GREATEST(
           0,
           EXTRACT(EPOCH FROM (now() - started_at)) * 1000
         )::int
       WHERE id = $1`,
      [
        batchId,
        report.status,
        totals.requested,
        totals.succeeded,
        totals.failed,
        totals.fetched,
        Number(observationTotals.rows[0]?.saved ?? 0),
        JSON.stringify(report.errors),
      ],
    );
  } catch (error) {
    recordImportError(report, "global", "sync", error);
    if (batchId) {
      try {
        await database.query(
          `UPDATE alpha_sync_batches
           SET
             status = 'partial',
             finished_at = now(),
             entities_requested = $2,
             entities_succeeded = $3,
             entities_failed = $4,
             errors = $5::jsonb,
             duration_ms = GREATEST(
               0,
               EXTRACT(EPOCH FROM (now() - started_at)) * 1000
             )::int
           WHERE id = $1`,
          [
            batchId,
            Object.keys(report.entities).length + report.errors.length,
            Object.keys(report.entities).length,
            report.errors.length,
            JSON.stringify(report.errors),
          ],
        );
      } catch {
        // The report remains safe and useful even if final batch bookkeeping
        // cannot be written because the sandbox itself is unavailable.
      }
    }
  } finally {
    await database.close();
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "completed") process.exitCode = 2;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await main();
}
