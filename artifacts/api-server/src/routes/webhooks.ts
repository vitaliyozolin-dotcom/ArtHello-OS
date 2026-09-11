import { Router } from "express";
import { db } from "@workspace/db";
import {
  rawEventsTable,
  leadEventsTable,
  sourceConnectorsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { sha256Hex } from "@workspace/shared/sha256";
import type { WebhookReplayStore } from "../lib/webhooks/webhook-auth.js";
import {
  canonicalWebsiteLeadPayload,
  IdempotencyPayloadConflict,
  processWebsiteLead,
  type WebsiteLeadStore,
} from "../lib/webhooks/website-lead-service.js";

export const webhooksRouter = Router();

export const websiteLeadStore: WebsiteLeadStore = {
  transaction(callback) {
    return db.transaction(async (tx) =>
      callback({
        async lock(hash) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${hash}))`,
          );
        },
        async findRawByHash(hash) {
          const [row] = await tx
            .select()
            .from(rawEventsTable)
            .where(eq(rawEventsTable.hash, hash))
            .limit(1);
          return row;
        },
        async insertRaw(input) {
          const [row] = await tx
            .insert(rawEventsTable)
            .values(input)
            .returning();
          if (!row) {
            throw new Error("Website raw event was not created");
          }
          return row;
        },
        async findLeadByRawEventId(rawEventId) {
          const [row] = await tx
            .select({
              rawEventId: leadEventsTable.rawEventId,
            })
            .from(leadEventsTable)
            .where(eq(leadEventsTable.rawEventId, rawEventId))
            .limit(1);
          return row;
        },
        async insertLead(input) {
          await tx.insert(leadEventsTable).values(input);
        },
        async markRawProcessed(rawEventId) {
          await tx
            .update(rawEventsTable)
            .set({ processed: true })
            .where(eq(rawEventsTable.id, rawEventId));
        },
        async touchWebsiteSource(checkedAt) {
          await tx
            .update(sourceConnectorsTable)
            .set({ lastSyncAt: checkedAt, status: "active" })
            .where(eq(sourceConnectorsTable.sourceType, "website"));
        },
      }),
    );
  },
};

export const webhookReplayStore: WebhookReplayStore = {
  claim(input) {
    const hash = sha256Hex(
      `webhook_replay__${input.provider}__${input.keyId}__${input.eventId}`,
    );
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${hash}))`);
      const [existing] = await tx
        .select({ raw: rawEventsTable.raw })
        .from(rawEventsTable)
        .where(eq(rawEventsTable.hash, hash))
        .limit(1);
      if (existing) {
        const raw =
          existing.raw && typeof existing.raw === "object"
            ? (existing.raw as Record<string, unknown>)
            : {};
        return typeof raw.body_digest === "string"
          ? raw.body_digest
          : "conflict";
      }
      await tx.insert(rawEventsTable).values({
        sourceSystem: `webhook_replay:${input.provider}`,
        externalId: input.eventId,
        eventType: "webhook_replay_claim",
        eventTime: new Date(),
        raw: { key_id: input.keyId, body_digest: input.bodyDigest },
        hash,
        processed: false,
      });
      return undefined;
    });
  },
};

// ─── POST /api/webhooks/website-lead ─────────────────────────────────────────
//
// Accepts a website form submission, stores in raw_events and lead_events.
// Fields: name, phone, email, message, source, campaign, branch, form_url,
//         utm_source, utm_medium, utm_campaign, utm_content, utm_term

webhooksRouter.post(
  "/webhooks/website-lead",
  async (req, res): Promise<void> => {
    const idempotencyKey = req.header("idempotency-key")?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
    ) {
      res.status(400).json({
        error: "A valid Idempotency-Key header is required",
      });
      return;
    }

    const canonicalPayload = canonicalWebsiteLeadPayload(
      req.body as Record<string, unknown>,
    );
    const { name, phone, email } = canonicalPayload;

    if (!phone && !email && !name) {
      res
        .status(400)
        .json({ error: "At least one of phone, email, or name is required" });
      return;
    }

    const now = new Date();

    try {
      const result = await processWebsiteLead(websiteLeadStore, {
        idempotencyKey,
        payload: canonicalPayload,
        receivedAt: now,
        ip: req.ip ?? null,
      });

      req.log.info(
        {
          channel: result.channel,
          duplicate: result.duplicate,
          recovered: result.recovered,
        },
        "Website lead received",
      );
      res.json(result);
    } catch (err) {
      if (err instanceof IdempotencyPayloadConflict) {
        res.status(409).json({
          error: "Idempotency-Key was already used for another payload",
        });
        return;
      }
      logger.error({ err }, "Website webhook failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── GET /api/webhooks/website-lead (test endpoint info) ─────────────────────

webhooksRouter.get("/webhooks/website-lead", (_req, res): void => {
  res.json({
    endpoint: "POST /api/webhooks/website-lead",
    description: "Website form lead intake webhook",
    fields: [
      "name",
      "phone",
      "email",
      "message",
      "source",
      "campaign",
      "branch",
      "form_url",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ],
  });
});
