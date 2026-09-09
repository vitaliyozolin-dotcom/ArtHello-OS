import { Router } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import crypto from "node:crypto";

export const evotorRouter = Router();

// ── Encryption helpers ────────────────────────────────────────────────────────
// AES-256-GCM with key derived from SESSION_SECRET.
// Tokens are NEVER logged and NEVER returned in API responses.

function getEncryptionKey(): Buffer {
  const rawKey = process.env.SESSION_SECRET;
  if (!rawKey || rawKey.length < 32) {
    throw new Error(
      "SESSION_SECRET must be configured with at least 32 characters",
    );
  }
  return crypto.createHash("sha256").update(rawKey).digest();
}

function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decryptToken(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format");
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = decipher.update(Buffer.from(encHex, "hex"));
  return Buffer.concat([dec, decipher.final()]).toString("utf8");
}

const CALLBACK_URL =
  "https://alpha-crm-sync.replit.app/api/integrations/evotor/user-token";
const EVOTOR_API = "https://api.evotor.ru/api/v1";

type EvotorReadiness =
  | "NOT_CONNECTED"
  | "TOKEN_SAVED"
  | "USER_TOKEN_RECEIVED"
  | "DISCOVERY_READY"
  | "ERROR";

type ConnectorRow = Record<string, unknown>;

async function getConnector(): Promise<ConnectorRow | null> {
  const res = await pool.query(
    "SELECT * FROM evotor_connectors ORDER BY created_at DESC LIMIT 1",
  );
  return (res.rows[0] as ConnectorRow) ?? null;
}

function computeReadiness(row: ConnectorRow | null): EvotorReadiness {
  if (!row || !row.publisher_token_enc) return "NOT_CONNECTED";
  if (Number(row.stores_count ?? 0) > 0) return "DISCOVERY_READY";
  if (row.user_token_enc) return "USER_TOKEN_RECEIVED";
  return "TOKEN_SAVED";
}

// ── POST /api/integrations/evotor/publisher-token ────────────────────────────
evotorRouter.post(
  "/integrations/evotor/publisher-token",
  async (req, res): Promise<void> => {
    const { token } = req.body as { token?: string };
    if (!token || typeof token !== "string" || !token.trim()) {
      return void res
        .status(400)
        .json({ success: false, message: "token is required" });
    }
    const trimmed = token.trim();
    let enc: string;
    try {
      enc = encryptToken(trimmed);
    } catch (err) {
      logger.error({ err }, "Evotor token encryption is not configured");
      return void res.status(503).json({
        success: false,
        message: "Token encryption is not configured",
      });
    }
    const last4 = trimmed.slice(-4);

    const existing = await getConnector();
    if (existing) {
      await pool.query(
        `UPDATE evotor_connectors
         SET publisher_token_enc      = $1,
             publisher_token_last4    = $2,
             publisher_token_saved_at = NOW(),
             readiness                = 'TOKEN_SAVED',
             updated_at               = NOW()
         WHERE id = $3`,
        [enc, last4, existing.id],
      );
    } else {
      await pool.query(
        `INSERT INTO evotor_connectors
         (publisher_token_enc, publisher_token_last4, publisher_token_saved_at, readiness)
         VALUES ($1, $2, NOW(), 'TOKEN_SAVED')`,
        [enc, last4],
      );
    }

    req.log.info("Evotor publisher token saved");
    res.json({
      success: true,
      maskedLast4: `****${last4}`,
      tokenPresent: true,
      readiness: "TOKEN_SAVED",
    });
  },
);

// ── GET /api/integrations/evotor/status ──────────────────────────────────────
evotorRouter.get(
  "/integrations/evotor/status",
  async (req, res): Promise<void> => {
    const row = await getConnector();
    const readiness = computeReadiness(row);
    res.json({
      publisherTokenPresent: Boolean(row?.publisher_token_enc),
      publisherTokenLast4: row?.publisher_token_last4 ?? null,
      publisherTokenSavedAt: row?.publisher_token_saved_at ?? null,
      userTokenPresent: Boolean(row?.user_token_enc),
      userTokenLast4: row?.user_token_last4 ?? null,
      userTokenReceivedAt: row?.user_token_received_at ?? null,
      storesCount: Number(row?.stores_count ?? 0),
      devicesCount: Number(row?.devices_count ?? 0),
      employeesCount: Number(row?.employees_count ?? 0),
      documentsCount: Number(row?.documents_count ?? 0),
      lastDiscoveryAt: row?.last_discovery_at ?? null,
      readiness,
      callbackUrl: CALLBACK_URL,
    });
  },
);

// ── POST /api/integrations/evotor/user-token ─────────────────────────────────
// Evotor OAuth callback — receives the user token after the merchant installs the app
evotorRouter.post(
  "/integrations/evotor/user-token",
  async (req, res): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const rawToken =
      body.token ??
      body.userToken ??
      body.access_token ??
      body.jwt ??
      body.user_token;
    if (!rawToken) {
      req.log.warn(
        { bodyKeys: Object.keys(body) },
        "Evotor user-token callback: no token field found",
      );
      return void res.status(400).json({
        success: false,
        message: "No token found in callback body. Expected field: token",
      });
    }
    const tokenStr = String(rawToken).trim();
    let enc: string;
    try {
      enc = encryptToken(tokenStr);
    } catch (err) {
      logger.error({ err }, "Evotor token encryption is not configured");
      return void res.status(503).json({
        success: false,
        message: "Token encryption is not configured",
      });
    }
    const last4 = tokenStr.slice(-4);

    const existing = await getConnector();
    if (existing) {
      await pool.query(
        `UPDATE evotor_connectors
         SET user_token_enc          = $1,
             user_token_last4        = $2,
             user_token_received_at  = NOW(),
             readiness               = 'USER_TOKEN_RECEIVED',
             updated_at              = NOW()
         WHERE id = $3`,
        [enc, last4, existing.id],
      );
    } else {
      await pool.query(
        `INSERT INTO evotor_connectors (user_token_enc, user_token_last4, user_token_received_at, readiness)
         VALUES ($1, $2, NOW(), 'USER_TOKEN_RECEIVED')`,
        [enc, last4],
      );
    }

    req.log.info("Evotor user token received via callback");
    res.json({
      success: true,
      message: "User token received and saved",
      readiness: "USER_TOKEN_RECEIVED",
    });
  },
);

// ── POST /api/integrations/evotor/discover ───────────────────────────────────
evotorRouter.post(
  "/integrations/evotor/discover",
  async (req, res): Promise<void> => {
    const row = await getConnector();
    if (!row?.publisher_token_enc) {
      return void res.status(400).json({
        success: false,
        message:
          "Publisher token not configured. Save it first via the Evotor tab.",
      });
    }

    let publisherToken: string;
    try {
      publisherToken = decryptToken(row.publisher_token_enc as string);
    } catch (e) {
      logger.error({ err: e }, "Evotor: failed to decrypt publisher token");
      return void res
        .status(500)
        .json({ success: false, message: "Failed to decrypt publisher token" });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${publisherToken}`,
      "Content-Type": "application/json",
    };
    const errors: string[] = [];
    let storesCount = 0;
    let devicesCount = 0;
    let employeesCount = 0;
    const discoveryRaw: Record<string, unknown> = {};

    async function fetchEvotor(path: string): Promise<unknown[] | null> {
      try {
        const r = await fetch(`${EVOTOR_API}${path}`, { headers });
        if (!r.ok) {
          errors.push(`${path}: HTTP ${r.status}`);
          return null;
        }
        const data = (await r.json()) as unknown;
        return Array.isArray(data)
          ? data
          : (((data as Record<string, unknown>).items as
              unknown[] | undefined) ?? []);
      } catch (e) {
        errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }

    const stores = await fetchEvotor("/inventories/stores/search");
    const devices = await fetchEvotor("/inventories/devices/search");
    const employees = await fetchEvotor("/inventories/employees/stores/search");

    if (stores) {
      storesCount = stores.length;
      discoveryRaw.stores = stores;
    }
    if (devices) {
      devicesCount = devices.length;
      discoveryRaw.devices = devices;
    }
    if (employees) {
      employeesCount = employees.length;
      discoveryRaw.employees = employees;
    }

    const readiness: EvotorReadiness =
      errors.length >= 3
        ? "ERROR"
        : storesCount > 0
          ? "DISCOVERY_READY"
          : row.user_token_enc
            ? "USER_TOKEN_RECEIVED"
            : "TOKEN_SAVED";

    await pool.query(
      `UPDATE evotor_connectors
       SET stores_count      = $1,
           devices_count     = $2,
           employees_count   = $3,
           last_discovery_at = NOW(),
           discovery_raw     = $4,
           readiness         = $5,
           updated_at        = NOW()
       WHERE id = $6`,
      [
        storesCount,
        devicesCount,
        employeesCount,
        JSON.stringify(discoveryRaw),
        readiness,
        row.id,
      ],
    );

    const totalItems = storesCount + devicesCount + employeesCount;
    if (totalItems > 0) {
      const batchRes = await pool.query<{ id: string }>(
        `INSERT INTO evotor_sync_batches (entity_type, status, records_raw, records_saved, finished_at)
         VALUES ('discovery', 'completed', $1, $1, NOW()) RETURNING id`,
        [totalItems],
      );
      const batchId = batchRes.rows[0]?.id;
      if (batchId) {
        const allItems: Array<{ type: string; item: unknown }> = [
          ...(stores ?? []).map((i) => ({ type: "store", item: i })),
          ...(devices ?? []).map((i) => ({ type: "device", item: i })),
          ...(employees ?? []).map((i) => ({ type: "employee", item: i })),
        ];
        for (const { type, item } of allItems) {
          const extId =
            (item as Record<string, unknown>).id ??
            (item as Record<string, unknown>).uuid ??
            null;
          try {
            await pool.query(
              `INSERT INTO evotor_raw_records (entity_type, external_id, batch_id, raw)
               VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [type, extId, batchId, JSON.stringify(item)],
            );
          } catch {
            /* ignore individual insert errors */
          }
        }
      }
    }

    req.log.info(
      { storesCount, devicesCount, employeesCount, readiness, errors },
      "Evotor discover complete",
    );
    res.json({
      success: errors.length < 3,
      storesCount,
      devicesCount,
      employeesCount,
      readiness,
      message: `Discovery: stores=${storesCount}, devices=${devicesCount}, employees=${employeesCount}`,
      errors,
    });
  },
);

// ── GET /api/coverage/evotor-coverage-audit ──────────────────────────────────
evotorRouter.get(
  "/coverage/evotor-coverage-audit",
  async (req, res): Promise<void> => {
    const row = await getConnector();
    const readiness = computeReadiness(row);

    const readinessReason: Record<EvotorReadiness, string> = {
      NOT_CONNECTED:
        "Publisher token not saved. Enter it in Technical Mode → Evotor / POS tab.",
      TOKEN_SAVED:
        "Publisher token saved. Register callback URL in Evotor Marketplace, or run Discovery.",
      USER_TOKEN_RECEIVED:
        "User token received via OAuth callback. Run Discovery to fetch stores/devices.",
      DISCOVERY_READY: `Discovery complete: ${Number(row?.stores_count ?? 0)} stores, ${Number(row?.devices_count ?? 0)} devices, ${Number(row?.employees_count ?? 0)} employees.`,
      ERROR:
        "Discovery failed — check token validity and Evotor API availability.",
    };

    res.json({
      auditType: "evotor-coverage-audit-p85a",
      generatedAt: new Date().toISOString(),
      publisherTokenPresent: Boolean(row?.publisher_token_enc),
      publisherTokenLast4: row?.publisher_token_last4 ?? null,
      publisherTokenSavedAt: row?.publisher_token_saved_at ?? null,
      userTokenPresent: Boolean(row?.user_token_enc),
      userTokenLast4: row?.user_token_last4 ?? null,
      userTokenReceivedAt: row?.user_token_received_at ?? null,
      callbackUrl: CALLBACK_URL,
      storesCount: Number(row?.stores_count ?? 0),
      devicesCount: Number(row?.devices_count ?? 0),
      employeesCount: Number(row?.employees_count ?? 0),
      documentsCount: Number(row?.documents_count ?? 0),
      lastDiscoveryAt: row?.last_discovery_at ?? null,
      readiness,
      readinessReason: readinessReason[readiness],
      discoveryRaw: row?.discovery_raw ?? null,
    });
  },
);
