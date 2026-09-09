import { normalizePhone } from "@workspace/shared/normalize-phone";
import { sha256Hex } from "@workspace/shared/sha256";
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

const pageSize = 50;
const minimumRequestIntervalMs = 260;
const requestTimeoutMs = 30_000;
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

const sha256 = sha256Hex;

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

class SerializedReadOnlyAlfaClient implements ReadOnlyAlfaClient {
  readonly #baseUrl: string;
  readonly #email: string;
  readonly #apiKey: string;
  #token: string | null = null;
  #tokenExpiresAt = 0;
  #queue: Promise<void> = Promise.resolve();
  #lastRequestStartedAt = 0;

  constructor() {
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
  }

  async #serializedFetch(url: string, init: RequestInit): Promise<Response> {
    let release: (() => void) | undefined;
    const previous = this.#queue;
    this.#queue = new Promise<void>((resolve) => {
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
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } finally {
      release?.();
    }
  }

  async #authenticate(): Promise<string> {
    if (this.#token && Date.now() < this.#tokenExpiresAt) return this.#token;
    const response = await this.#serializedFetch(
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
  }

  async postIndex(
    endpoint: string,
    body: JsonRecord,
    allowRefresh = true,
  ): Promise<unknown> {
    const token = await this.#authenticate();
    const response = await this.#serializedFetch(
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
      this.#token = null;
      return this.postIndex(endpoint, body, false);
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
  }
}

export interface EntityImportResult {
  pages: number;
  records: number;
  rawSaved: number;
  normalized: number;
  repeatedPageStopped: boolean;
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
}

interface NormalizationContext {
  batchId: string;
  rawId: string;
  scopeKey: string;
}

async function saveRawRecord(
  database: PGlite,
  batchId: string,
  options: ImportEntityOptions,
  item: JsonRecord,
  page: number,
): Promise<{ rawId: string; payloadHash: string; created: boolean }> {
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
  await database.query(
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
     ON CONFLICT (sync_batch_id, raw_record_id) DO NOTHING`,
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
  return { rawId, payloadHash, created: inserted.rows.length === 1 };
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
       stale_reason
     )
     VALUES ($1, $2, $3::jsonb, now(), $4, $5, $6, 'current', NULL, NULL)
     ON CONFLICT (crm_id) DO UPDATE SET
       name = EXCLUDED.name,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(),
       $9, $10, $11, 'current', NULL, NULL
     )
     ON CONFLICT (crm_id) DO UPDATE SET
       branch_crm_id = EXCLUDED.branch_crm_id,
       full_name = EXCLUDED.full_name,
       status = EXCLUDED.status,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       created_at_crm = EXCLUDED.created_at_crm,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6::jsonb,
       $7, $8, $9, 'current', NULL, NULL
     )
     ON CONFLICT (student_crm_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       dob = EXCLUDED.dob,
       branch_crm_id = EXCLUDED.branch_crm_id,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(),
       $10, $11, 'current', NULL, NULL
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       status = EXCLUDED.status,
       pipeline_crm_id = EXCLUDED.pipeline_crm_id,
       source_crm_id = EXCLUDED.source_crm_id,
       created_at_crm = EXCLUDED.created_at_crm,
       raw_record_id = EXCLUDED.raw_record_id,
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(),
       $11, $12, 'current', NULL, NULL
     )
     ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
       customer_crm_id = EXCLUDED.customer_crm_id,
       tariff_crm_id = EXCLUDED.tariff_crm_id,
       balance = EXCLUDED.balance,
       status = EXCLUDED.status,
       valid_from = EXCLUDED.valid_from,
       valid_to = EXCLUDED.valid_to,
       raw_record_id = EXCLUDED.raw_record_id,
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(),
       $9, $10, 'current', NULL, NULL
     )
     ON CONFLICT (branch_crm_id, reference_type, crm_id) DO UPDATE SET
       name = EXCLUDED.name,
       status = EXCLUDED.status,
       parent_crm_id = EXCLUDED.parent_crm_id,
       raw_record_id = EXCLUDED.raw_record_id,
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
       source_scope
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::jsonb, now(),
       $13, $14
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, now(),
       $8, $9, $10, 'current', NULL, NULL
     )
     ON CONFLICT (crm_id) DO UPDATE SET
       branch_crm_id = EXCLUDED.branch_crm_id,
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
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
  const teachers = Array.isArray(item["teachers"])
    ? (item["teachers"] as unknown[])
        .map((teacher) => stringValue(asRecord(teacher)?.["id"]))
        .filter((id): id is string => !!id)
    : [];
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now(),
       $10, $11, $12, 'current', NULL, NULL
     )
     ON CONFLICT (crm_id) DO UPDATE SET
       branch_crm_id = EXCLUDED.branch_crm_id,
       name = EXCLUDED.name,
       note = EXCLUDED.note,
       b_date = EXCLUDED.b_date,
       e_date = EXCLUDED.e_date,
       capacity = EXCLUDED.capacity,
       teacher_crm_ids = EXCLUDED.teacher_crm_ids,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(),
       $9, $10, $11, 'current', NULL, NULL
     )
     ON CONFLICT (crm_id) DO UPDATE SET
       branch_crm_id = EXCLUDED.branch_crm_id,
       student_crm_id = EXCLUDED.student_crm_id,
       amount = EXCLUDED.amount,
       payment_date = EXCLUDED.payment_date,
       type = EXCLUDED.type,
       comment = EXCLUDED.comment,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
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
    ],
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, now(),
       $8, $9, $10, 'current', NULL, NULL
     )
     ON CONFLICT (crm_id) DO UPDATE SET
       branch_crm_id = EXCLUDED.branch_crm_id,
       group_crm_id = EXCLUDED.group_crm_id,
       teacher_crm_id = EXCLUDED.teacher_crm_id,
       lesson_date = EXCLUDED.lesson_date,
       title = EXCLUDED.title,
       raw = EXCLUDED.raw,
       raw_record_id = EXCLUDED.raw_record_id,
       last_seen_batch_id = EXCLUDED.last_seen_batch_id,
       source_scope = EXCLUDED.source_scope,
       record_state = 'current',
       stale_at = NULL,
       stale_reason = NULL,
       synced_at = now()`,
    [
      crmId,
      branchId,
      stringValue(item["group_id"]),
      stringValue(item["teacher_id"]),
      lessonDate,
      stringValue(item["topic"] ?? item["name"] ?? item["title"]),
      stableJson(item),
      context.rawId,
      context.batchId,
      context.scopeKey,
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
         stale_reason
       ) VALUES (
         $1, $2, $3, $4::jsonb, now(),
         $5, $6, $7, 'current', NULL, NULL
       )
       ON CONFLICT (lesson_crm_id, student_crm_id) DO UPDATE SET
         status = EXCLUDED.status,
         raw = EXCLUDED.raw,
         raw_record_id = EXCLUDED.raw_record_id,
         last_seen_batch_id = EXCLUDED.last_seen_batch_id,
         source_scope = EXCLUDED.source_scope,
         record_state = 'current',
         stale_at = NULL,
         stale_reason = NULL,
         synced_at = now()`,
      [
        crmId,
        studentCrmId,
        stringValue(detail["status"] ?? detail["is_attend"] ?? detail["visit"]),
        stableJson(detail),
        context.rawId,
        context.batchId,
        context.scopeKey,
      ],
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
       stale_reason
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(),
       $10, $11, 'current', NULL, NULL
     )
     ON CONFLICT (branch_crm_id, group_crm_id, student_crm_id)
     DO UPDATE SET
       external_membership_id = EXCLUDED.external_membership_id,
       status = EXCLUDED.status,
       enrolled_at = EXCLUDED.enrolled_at,
       unenrolled_at = EXCLUDED.unenrolled_at,
       raw_record_id = EXCLUDED.raw_record_id,
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
    ],
  );
  return true;
}

async function normalizeEntity(
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
           WHERE lesson.crm_id = attendance.lesson_crm_id
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
  let page = 0;
  let records = 0;
  let rawSaved = 0;
  let normalized = 0;
  const observedPageHashes = new Set<string>();
  const maxPages =
    Number.isInteger(options.maxPages) && Number(options.maxPages) > 0
      ? Number(options.maxPages)
      : 100_000;

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
       pages_fetched = 0,
       records_fetched = 0,
       safe_error_code = NULL,
       started_at = now(),
       finished_at = NULL`,
    [batchId, options.scopeKey, options.branchId, options.recordType],
  );

  try {
    while (true) {
      if (page >= maxPages) throw new AlfaReadError("pagination_guard");
      const response = await client.postIndex(options.endpoint, {
        ...(options.body ?? {}),
        page,
        pageSize,
      });
      const items = listItems(response);
      const responseTotal = totalItems(response);
      const pageHash = sha256(stableJson(items));
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
              scopeKey: options.scopeKey,
            })
          ) {
            normalized += 1;
          }
        }
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
    branch_crm_id: string | null;
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
        const left = bucket[leftIndex]!;
        const right = bucket[rightIndex]!;
        const [leftId, rightId] = [left.crm_id, right.crm_id].sort();
        const leftGuardian = normalizeName(left.raw?.["legal_name"]);
        const rightGuardian = normalizeName(right.raw?.["legal_name"]);
        const guardianNameMatches =
          !!leftGuardian && !!rightGuardian && leftGuardian === rightGuardian;
        const reasonCodes = familyCandidateReasonCodes(guardianNameMatches);
        const confidence = guardianNameMatches ? "0.8000" : "0.6500";
        await database.query(
          `INSERT INTO family_merge_candidates (
             left_student_crm_id,
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
             'possible_shared_family',
             $4::jsonb,
             $5::jsonb,
             $6,
             'pending_review',
             now()
           )
           ON CONFLICT (
             left_student_crm_id,
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
            leftId,
            rightId,
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
    if (!batchId) throw new AlfaReadError("sandbox_batch_failed");

    const branches = await importEntity(client, database, batchId, {
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

        for (const entity of requiredEntities) {
          const reportKey = `branch_${branchId}.${entity.key}`;
          try {
            report.entities[reportKey] = await importEntity(
              client,
              database,
              batchId,
              {
                branchId,
                endpoint: entity.endpoint,
                recordType: entity.recordType,
                scopeKey: `${branchId}:${entity.recordType}`,
                body: entity.body,
              },
            );
          } catch (error) {
            recordImportError(report, branchId, entity.key, error);
          }
        }

        for (const status of [1, 2, 3]) {
          const reportKey = `branch_${branchId}.lessons_status_${status}`;
          try {
            report.entities[reportKey] = await importEntity(
              client,
              database,
              batchId,
              {
                branchId,
                endpoint: `${branchId}/lesson/index`,
                recordType: "lessons",
                scopeKey: `${branchId}:lessons:status:${status}`,
                body: { status },
              },
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

        for (const entity of referenceEntities) {
          const reportKey = `branch_${branchId}.${entity.key}`;
          try {
            report.entities[reportKey] = await importEntity(
              client,
              database,
              batchId,
              {
                branchId,
                endpoint: entity.endpoint,
                recordType: entity.recordType,
                scopeKey: `${branchId}:reference:${entity.recordType}`,
                body: entity.body,
              },
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
        for (const student of students.rows) {
          const reportKey = `branch_${branchId}.customer_tariffs`;
          try {
            const result = await importEntity(client, database, batchId, {
              branchId,
              endpoint: `${branchId}/customer-tariff/index?customer_id=${encodeURIComponent(student.crm_id)}`,
              recordType: "customer_tariffs",
              scopeKey: `${branchId}:customer_tariffs:${student.crm_id}`,
              forcedCustomerId: student.crm_id,
            });
            report.entities[reportKey] = accumulateEntityResult(
              report.entities[reportKey],
              result,
            );
          } catch (error) {
            recordImportError(report, branchId, "customer_tariffs", error);
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
        for (const group of groups.rows) {
          const reportKey = `branch_${branchId}.group_membership`;
          try {
            const result = await importEntity(client, database, batchId, {
              branchId,
              endpoint: `${branchId}/cgi/index?group_id=${encodeURIComponent(group.crm_id)}`,
              recordType: "group_memberships",
              scopeKey: `${branchId}:group_memberships:${group.crm_id}`,
              body: { group_id: group.crm_id },
              forcedGroupId: group.crm_id,
            });
            report.entities[reportKey] = accumulateEntityResult(
              report.entities[reportKey],
              result,
            );
          } catch (error) {
            recordImportError(report, branchId, "group_membership", error);
          }
        }
      }

      const changeLogKey = `branch_${branchId}.change_log`;
      try {
        report.entities[changeLogKey] = await importEntity(
          client,
          database,
          batchId,
          {
            branchId,
            endpoint: `${branchId}/log/index`,
            recordType: "change_log",
            scopeKey: `${branchId}:change_log:${
              incrementalWindow?.dateFrom ?? "full"
            }`,
            body: incrementalWindow
              ? { date_from: incrementalWindow.dateFrom }
              : undefined,
          },
        );
      } catch (error) {
        recordImportError(report, branchId, "change_log", error);
      }
    }

    if (
      syncMode === "full_sandbox_read_only" &&
      report.status === "completed"
    ) {
      report.familyCandidates = await buildFamilyCandidates(database);
    }
    const totals = Object.values(report.entities).reduce(
      (result, entity) => ({
        fetched: result.fetched + entity.records,
        saved: result.saved + entity.rawSaved,
        normalized: result.normalized + entity.normalized,
      }),
      { fetched: 0, saved: 0, normalized: 0 },
    );
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
        Object.keys(report.entities).length + report.errors.length,
        Object.keys(report.entities).length,
        report.errors.length,
        totals.fetched,
        totals.saved,
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
