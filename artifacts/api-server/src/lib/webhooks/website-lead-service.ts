import { createHash } from "node:crypto";

export const WEBSITE_LEAD_FIELDS = [
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
] as const;

export type WebsiteLeadPayload = Record<
  (typeof WEBSITE_LEAD_FIELDS)[number],
  string
>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalWebsiteLeadPayload(
  value: Record<string, unknown>,
): WebsiteLeadPayload {
  return Object.fromEntries(
    WEBSITE_LEAD_FIELDS.map((field) => [
      field,
      typeof value[field] === "string" ? value[field] : "",
    ]),
  ) as WebsiteLeadPayload;
}

export function websiteLeadPayloadHash(
  value: Record<string, unknown>,
): string {
  return sha256(
    JSON.stringify(canonicalWebsiteLeadPayload(value)),
  );
}

export function websiteLeadEventHash(
  idempotencyKey: string,
): string {
  return sha256(`website_webhook__${idempotencyKey}`);
}

export interface WebsiteLeadRawRecord {
  id: string;
  raw: unknown;
  processed: boolean | null;
}

export interface WebsiteLeadTransaction {
  lock(hash: string): Promise<void>;
  findRawByHash(
    hash: string,
  ): Promise<WebsiteLeadRawRecord | undefined>;
  insertRaw(input: {
    sourceSystem: "website_webhook";
    externalId: null;
    eventType: "lead";
    eventTime: Date;
    raw: Record<string, unknown>;
    hash: string;
    processed: false;
  }): Promise<WebsiteLeadRawRecord>;
  findLeadByRawEventId(
    rawEventId: string,
  ): Promise<{ rawEventId: string | null } | undefined>;
  insertLead(input: {
    sourceSystem: "website_webhook";
    externalId: string;
    eventTime: Date;
    branchName: string | null;
    branchCrmId: null;
    channel: string | null;
    source: string | null;
    campaign: string | null;
    clientName: string | null;
    phone: string | null;
    email: string | null;
    message: string | null;
    status: "new";
    manager: null;
    raw: Record<string, unknown>;
    rawEventId: string;
  }): Promise<void>;
  markRawProcessed(rawEventId: string): Promise<void>;
  touchWebsiteSource(checkedAt: Date): Promise<void>;
}

export interface WebsiteLeadStore {
  transaction<T>(
    callback: (tx: WebsiteLeadTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface WebsiteLeadResult {
  success: true;
  duplicate: boolean;
  recovered: boolean;
  id: string;
  channel: string;
}

export class IdempotencyPayloadConflict extends Error {
  constructor() {
    super("Idempotency key payload conflict");
    this.name = "IdempotencyPayloadConflict";
  }
}

export async function processWebsiteLead(
  store: WebsiteLeadStore,
  input: {
    idempotencyKey: string;
    payload: WebsiteLeadPayload;
    receivedAt: Date;
    ip: string | null;
  },
): Promise<WebsiteLeadResult> {
  const {
    idempotencyKey,
    payload,
    receivedAt,
    ip,
  } = input;
  const {
    name,
    phone,
    email,
    message,
    source,
    campaign,
    branch,
    utm_source,
    utm_medium,
    utm_campaign,
  } = payload;
  const payloadHash = websiteLeadPayloadHash(payload);
  const eventHash = websiteLeadEventHash(idempotencyKey);
  const channel =
    utm_medium ||
    (utm_source ? "cpc" : source ? "organic" : "direct");
  const rawPayload: Record<string, unknown> = {
    ...payload,
    received_at: receivedAt.toISOString(),
    ip,
    idempotency_payload_hash: payloadHash,
  };

  return store.transaction(async (tx) => {
    await tx.lock(eventHash);

    const existingRaw = await tx.findRawByHash(eventHash);
    let rawEvent = existingRaw;
    let existingLead:
      | { rawEventId: string | null }
      | undefined;

    if (existingRaw) {
      const storedRaw = (
        existingRaw.raw &&
        typeof existingRaw.raw === "object"
          ? existingRaw.raw
          : {}
      ) as Record<string, unknown>;
      const storedPayloadHash =
        typeof storedRaw["idempotency_payload_hash"] === "string"
          ? storedRaw["idempotency_payload_hash"]
          : websiteLeadPayloadHash(storedRaw);

      if (storedPayloadHash !== payloadHash) {
        throw new IdempotencyPayloadConflict();
      }

      existingLead = await tx.findLeadByRawEventId(
        existingRaw.id,
      );
      if (existingRaw.processed && existingLead) {
        return {
          success: true,
          duplicate: true,
          recovered: false,
          id: existingRaw.id,
          channel,
        };
      }
    } else {
      rawEvent = await tx.insertRaw({
        sourceSystem: "website_webhook",
        externalId: null,
        eventType: "lead",
        eventTime: receivedAt,
        raw: rawPayload,
        hash: eventHash,
        processed: false,
      });
    }

    if (!rawEvent) {
      throw new Error("Website raw event was not created");
    }

    if (!existingLead) {
      await tx.insertLead({
        sourceSystem: "website_webhook",
        externalId: rawEvent.id,
        eventTime: receivedAt,
        branchName: branch || null,
        branchCrmId: null,
        channel: channel || null,
        source: utm_source || source || null,
        campaign: utm_campaign || campaign || null,
        clientName: name || null,
        phone: phone || null,
        email: email || null,
        message: message || null,
        status: "new",
        manager: null,
        raw: rawPayload,
        rawEventId: rawEvent.id,
      });
    }

    await tx.markRawProcessed(rawEvent.id);
    await tx.touchWebsiteSource(receivedAt);

    return {
      success: true,
      duplicate: false,
      recovered: Boolean(existingRaw),
      id: rawEvent.id,
      channel,
    };
  });
}
