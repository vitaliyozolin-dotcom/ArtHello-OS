import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const HEX_64 = /^[a-f0-9]{64}$/;
const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

interface WebsiteSignatureInput {
  secret: string;
  timestamp: string;
  eventId: string;
  rawBody: Uint8Array;
}

function signingPayload(input: WebsiteSignatureInput): string {
  const digest = createHash("sha256").update(input.rawBody).digest("hex");
  return `v1\n${input.timestamp}\n${input.eventId}\n${digest}`;
}

export function signWebsiteWebhook(input: WebsiteSignatureInput): string {
  if (
    !input.secret ||
    !/^\d{1,12}$/.test(input.timestamp) ||
    !EVENT_ID.test(input.eventId)
  ) {
    throw new Error("invalid_webhook_signing_input");
  }
  return `v1=${createHmac("sha256", input.secret).update(signingPayload(input)).digest("hex")}`;
}

export function verifyWebsiteWebhook(
  input: WebsiteSignatureInput & {
    signature: string;
    nowSeconds: number;
    toleranceSeconds: number;
  },
): { ok: true; keyVersion: "v1" } | { ok: false; reason: string } {
  if (
    !Number.isSafeInteger(input.nowSeconds) ||
    !Number.isSafeInteger(input.toleranceSeconds) ||
    input.toleranceSeconds <= 0
  ) {
    return { ok: false, reason: "invalid_policy" };
  }
  const timestamp = Number(input.timestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(input.nowSeconds - timestamp) > input.toleranceSeconds
  ) {
    return { ok: false, reason: "timestamp_invalid" };
  }
  if (!EVENT_ID.test(input.eventId) || !input.signature.startsWith("v1=")) {
    return { ok: false, reason: "authentication_invalid" };
  }
  const supplied = input.signature.slice(3);
  if (!HEX_64.test(supplied))
    return { ok: false, reason: "authentication_invalid" };
  let expected: string;
  try {
    expected = signWebsiteWebhook(input).slice(3);
  } catch {
    return { ok: false, reason: "authentication_invalid" };
  }
  const valid = timingSafeEqual(
    Buffer.from(supplied, "hex"),
    Buffer.from(expected, "hex"),
  );
  return valid
    ? { ok: true, keyVersion: "v1" }
    : { ok: false, reason: "authentication_invalid" };
}

export interface WebhookReplayClaim {
  provider: string;
  keyId: string;
  eventId: string;
  bodyDigest: string;
}

export interface WebhookReplayStore {
  claim(input: WebhookReplayClaim): Promise<string | undefined>;
}

export async function claimWebhookReplay(
  store: WebhookReplayStore,
  input: WebhookReplayClaim,
): Promise<{ status: "claimed" | "duplicate" | "conflict" }> {
  if (
    !EVENT_ID.test(input.provider) ||
    !EVENT_ID.test(input.keyId) ||
    !EVENT_ID.test(input.eventId) ||
    !HEX_64.test(input.bodyDigest)
  ) {
    throw new Error("invalid_webhook_claim");
  }
  const existingDigest = await store.claim(input);
  if (existingDigest === undefined) return { status: "claimed" };
  return {
    status: existingDigest === input.bodyDigest ? "duplicate" : "conflict",
  };
}

export function webhookBodyDigest(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export async function authenticateWebsiteWebhook(input: {
  secret: string | undefined;
  toleranceSeconds: number;
  signature: string | undefined;
  timestamp: string | undefined;
  eventId: string | undefined;
  rawBody: Uint8Array | undefined;
  nowSeconds: number;
  store: WebhookReplayStore;
}): Promise<
  | { status: "accepted"; duplicate: boolean }
  | { status: "unauthorized" | "conflict" | "unavailable" }
> {
  if (
    !input.secret ||
    !Number.isSafeInteger(input.toleranceSeconds) ||
    input.toleranceSeconds <= 0 ||
    !input.rawBody
  ) {
    return { status: "unavailable" };
  }
  if (!input.signature || !input.timestamp || !input.eventId) {
    return { status: "unauthorized" };
  }
  const verified = verifyWebsiteWebhook({
    secret: input.secret,
    toleranceSeconds: input.toleranceSeconds,
    signature: input.signature,
    timestamp: input.timestamp,
    eventId: input.eventId,
    rawBody: input.rawBody,
    nowSeconds: input.nowSeconds,
  });
  if (!verified.ok) return { status: "unauthorized" };

  try {
    const claim = await claimWebhookReplay(input.store, {
      provider: "website",
      keyId: verified.keyVersion,
      eventId: input.eventId,
      bodyDigest: webhookBodyDigest(input.rawBody),
    });
    if (claim.status === "conflict") return { status: "conflict" };
    return { status: "accepted", duplicate: claim.status === "duplicate" };
  } catch {
    return { status: "unavailable" };
  }
}
