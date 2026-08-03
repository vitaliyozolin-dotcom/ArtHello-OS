import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";

export const smsVizitkaShadowRouter = Router();

const webhookSchema = z.object({
  action: z.coerce.number().int(),
  message_id: z.coerce.string().trim().min(1).max(240),
  name: z.coerce.string().trim().max(160).optional().default(""),
  number: z.coerce.string().trim().min(6).max(40),
  text_message: z.coerce.string().max(8_000).optional().default(""),
  text_status: z.coerce.string().trim().max(240).optional().default(""),
  pack_code: z.coerce.number().int().optional().default(-1),
  send_source: z.coerce.number().int().optional().default(-1),
  date: z.union([z.string(), z.number()]).optional(),
  push_id: z.coerce.string().trim().max(240).optional().default(""),
}).passthrough();

type WebhookPayload = z.infer<typeof webhookSchema>;

const CHANNEL_BY_PACK_CODE: Record<number, string> = {
  0: "sms",
  1: "whatsapp",
  2: "whatsapp_business",
  3: "viber",
  10: "telegram_bot",
  14: "max",
  15: "vk",
  16: "vk_messenger",
};

function isShadowEnabled(): boolean {
  return process.env.SMSVIZITKA_SHADOW_ENABLED === "true";
}

function configured(): boolean {
  return Boolean(
    process.env.SMSVIZITKA_WEBHOOK_TOKEN &&
    process.env.FRONT_OFFICE_PHONE_MATCH_SECRET,
  );
}

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return "+7" + digits;
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length >= 10 && digits.length <= 15) return "+" + digits;
  return null;
}

function maskPhone(value: string): string {
  if (value.length < 8) return "***";
  return value.slice(0, 2) + " *** *** " + value.slice(-4);
}

function phoneHash(value: string): string {
  const secret = process.env.FRONT_OFFICE_PHONE_MATCH_SECRET;
  if (!secret) throw new Error("FRONT_OFFICE_PHONE_MATCH_SECRET is not configured");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function suppliedWebhookToken(req: Request): string {
  const authorization = String(req.header("authorization") ?? "").trim();
  if (authorization) {
    return authorization.replace(/^(Bearer|Token)\s+/i, "").trim();
  }
  return String(
    req.header("x-webhook-key") ??
    req.header("x-api-key") ??
    req.query?.key ??
    "",
  ).trim();
}

function tokenMatches(candidate: string): boolean {
  const expected = process.env.SMSVIZITKA_WEBHOOK_TOKEN ?? "";
  if (!candidate || !expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function eventDate(value: string | number | undefined): Date {
  if (value === undefined) return new Date();
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== "") return eventDate(numeric);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function fingerprint(payload: WebhookPayload, normalizedPhone: string): string {
  return createHash("sha256")
    .update([
      "smsvizitka",
      payload.message_id,
      payload.action,
      payload.text_status,
      payload.pack_code,
      payload.push_id,
      payload.date ?? "",
      normalizedPhone,
    ].join("|"))
    .digest("hex");
}

function safeRaw(payload: WebhookPayload, maskedPhone: string): Record<string, unknown> {
  const raw = { ...payload } as Record<string, unknown>;
  delete raw.number;
  delete raw.api_key;
  delete raw.authorization;
  raw.phone_masked = maskedPhone;
  return raw;
}

smsVizitkaShadowRouter.get("/integrations/smsvizitka/status", (_req, res) => {
  res.json({
    provider: "smsvizitka",
    mode: "SHADOW",
    configured: configured(),
    shadowEnabled: isShadowEnabled(),
    outboundEnabled: false,
    channels: ["whatsapp", "max", "telegram_bot", "sms"],
    webhookPath: "/api/webhooks/smsvizitka",
  });
});

smsVizitkaShadowRouter.post("/webhooks/smsvizitka", async (req, res): Promise<void> => {
  if (!isShadowEnabled()) {
    res.status(423).json({ status: "error", error: "SHADOW mode is disabled" });
    return;
  }
  if (!configured()) {
    res.status(503).json({ status: "error", error: "Integration is not configured" });
    return;
  }
  if (!tokenMatches(suppliedWebhookToken(req))) {
    res.status(401).json({ status: "error", error: "Invalid webhook token" });
    return;
  }

  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", error: "Invalid webhook payload" });
    return;
  }

  const payload = parsed.data;
  const normalized = normalizePhone(payload.number);
  if (!normalized) {
    res.status(400).json({ status: "error", error: "Invalid phone number" });
    return;
  }

  const masked = maskPhone(normalized);
  const contactHash = phoneHash(normalized);
  const hash = fingerprint(payload, normalized);
  const channel = CHANNEL_BY_PACK_CODE[payload.pack_code] ?? "unknown";
  const occurredAt = eventDate(payload.date);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const rawInsert = await client.query<{ id: string }>(
      `INSERT INTO raw_events
        (source_system, external_id, event_type, event_time, raw, hash, processed)
       VALUES ('smsvizitka', $1, $2, $3, $4::jsonb, $5, false)
       ON CONFLICT (hash) DO NOTHING
       RETURNING id`,
      [
        payload.message_id,
        payload.action === 4 ? "message_incoming" : "message_status",
        occurredAt,
        JSON.stringify(safeRaw(payload, masked)),
        hash,
      ],
    );

    const rawEventId = rawInsert.rows[0]?.id;
    if (!rawEventId) {
      await client.query("COMMIT");
      res.json({ status: "ok", accepted: true, duplicate: true });
      return;
    }

    if (payload.action === 4) {
      const conversationInsert = await client.query<{ id: string }>(
        `INSERT INTO front_office_conversations
          (project_id, external_key, kind, channel, status, priority,
           contact_display_name, contact_point_masked, identity_status,
           intent, owner_role, last_message_at, is_synthetic)
         VALUES
          ('ARTHELLO', $1, 'lead', $2, 'open', 'P3',
           $3, $4, 'partial', 'incoming_message', 'CLIENT_SERVICE',
           $5, false)
         ON CONFLICT (project_id, external_key)
         DO UPDATE SET
           channel = EXCLUDED.channel,
           contact_display_name = CASE
             WHEN EXCLUDED.contact_display_name = 'Неизвестный клиент'
             THEN front_office_conversations.contact_display_name
             ELSE EXCLUDED.contact_display_name
           END,
           contact_point_masked = EXCLUDED.contact_point_masked,
           last_message_at = GREATEST(
             front_office_conversations.last_message_at,
             EXCLUDED.last_message_at
           ),
           status = CASE
             WHEN front_office_conversations.status IN ('resolved', 'closed')
             THEN 'open'
             ELSE front_office_conversations.status
           END,
           updated_at = NOW(),
           version = front_office_conversations.version + 1
         RETURNING id`,
        [
          "smsvizitka:" + contactHash,
          channel,
          payload.name || "Неизвестный клиент",
          masked,
          occurredAt,
        ],
      );
      const conversationId = conversationInsert.rows[0]?.id;
      if (!conversationId) throw new Error("Conversation was not created");

      await client.query(
        `INSERT INTO front_office_messages
          (conversation_id, message_type, direction, body, author_role,
           author_display_name, fact_status, source_refs, is_synthetic, created_at)
         VALUES
          ($1, 'incoming', 'incoming', $2, 'customer', $3,
           'UNVERIFIED', $4::jsonb, false, $5)`,
        [
          conversationId,
          payload.text_message || "[Сообщение без текста]",
          payload.name || null,
          JSON.stringify([
            "smsvizitka:" + payload.message_id,
            "raw_event:" + rawEventId,
            "channel:" + channel,
          ]),
          occurredAt,
        ],
      );
    }

    await client.query("UPDATE raw_events SET processed = true WHERE id = $1", [
      rawEventId,
    ]);
    await client.query("COMMIT");

    req.log.info(
      {
        provider: "smsvizitka",
        action: payload.action,
        channel,
        messageId: payload.message_id,
      },
      "SMS-Vizitka webhook accepted in SHADOW mode",
    );
    res.json({ status: "ok", accepted: true, duplicate: false });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "SMS-Vizitka SHADOW webhook failed");
    res.status(500).json({ status: "error", error: "Webhook processing failed" });
  } finally {
    client.release();
  }
});

smsVizitkaShadowRouter.get("/front-office/channel-inbox", async (req, res): Promise<void> => {
  if (!isShadowEnabled()) {
    res.json({
      contract: {
        provider: "smsvizitka",
        mode: "SHADOW",
        configured: configured(),
        shadowEnabled: false,
        outboundEnabled: false,
      },
      conversations: [],
      stats: { conversations: 0, unread: 0, eventsLast7Days: 0 },
    });
    return;
  }

  try {
    const requestedLimit = Number(req.query.limit ?? 100);
    const limit = Math.min(200, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 100));
    const conversations = await pool.query(
      `SELECT id, external_key, kind, channel, status, priority,
              contact_display_name, contact_point_masked, identity_status,
              intent, owner_role, owner_display_name, last_message_at,
              due_at, next_action_at, created_at, updated_at
         FROM front_office_conversations
        WHERE project_id = 'ARTHELLO' AND is_synthetic = false
        ORDER BY last_message_at DESC
        LIMIT $1`,
      [limit],
    );

    const ids = conversations.rows.map((row) => String(row.id));
    const messages = ids.length
      ? await pool.query(
          `SELECT id, conversation_id, message_type, direction, body,
                  author_role, author_display_name, fact_status,
                  source_refs, created_at
             FROM front_office_messages
            WHERE is_synthetic = false
              AND conversation_id = ANY($1::uuid[])
            ORDER BY created_at ASC`,
          [ids],
        )
      : { rows: [] as Record<string, unknown>[] };

    const eventCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM raw_events
        WHERE source_system = 'smsvizitka'
          AND created_at >= NOW() - INTERVAL '7 days'`,
    );

    const byConversation = new Map<string, Record<string, unknown>[]>();
    for (const message of messages.rows as Record<string, unknown>[]) {
      const key = String(message.conversation_id);
      const list = byConversation.get(key) ?? [];
      list.push(message);
      byConversation.set(key, list);
    }

    res.json({
      contract: {
        provider: "smsvizitka",
        mode: "SHADOW",
        configured: configured(),
        shadowEnabled: true,
        outboundEnabled: false,
      },
      conversations: (conversations.rows as Record<string, unknown>[]).map((row) => ({
        ...row,
        messages: byConversation.get(String(row.id)) ?? [],
      })),
      stats: {
        conversations: conversations.rows.length,
        unread: 0,
        eventsLast7Days: Number(eventCount.rows[0]?.count ?? 0),
      },
    });
  } catch (error) {
    req.log.error({ error }, "SMS-Vizitka SHADOW inbox failed");
    res.status(500).json({ error: "Не удалось загрузить входящие каналы" });
  }
});
