import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ENVELOPE_KIND = "arthello.bank-config";
const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const ACTIVE_KEY_ID_ENV = "BANK_CONFIG_ACTIVE_KEY_ID";
const KEYRING_ENV = "BANK_CONFIG_ENCRYPTION_KEYS";

const SECRET_FIELD_PATTERN =
  /(?:secret|token|api[_-]?key|password|private[_-]?key|oauth[_-]?state)/i;

export interface BankConfigEnvelope {
  kind: typeof ENVELOPE_KIND;
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class BankConfigVaultError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BankConfigVaultError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isBankConfigEnvelope(
  value: unknown,
): value is BankConfigEnvelope {
  if (!isPlainObject(value)) return false;
  return (
    value["kind"] === ENVELOPE_KIND &&
    value["version"] === ENVELOPE_VERSION &&
    value["algorithm"] === ALGORITHM &&
    typeof value["keyId"] === "string" &&
    typeof value["iv"] === "string" &&
    typeof value["authTag"] === "string" &&
    typeof value["ciphertext"] === "string"
  );
}

function decodeKey(raw: string, keyId: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new BankConfigVaultError(
      `Bank config encryption key ${keyId} must be exactly 32 bytes encoded as base64`,
    );
  }
  return key;
}

function readKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): Map<string, Buffer> {
  const raw = environment[KEYRING_ENV];
  if (!raw) {
    throw new BankConfigVaultError(
      `${KEYRING_ENV} is required before bank connector credentials can be stored or used`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new BankConfigVaultError(
      `${KEYRING_ENV} must be a JSON object of keyId to base64 key`,
      { cause },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new BankConfigVaultError(
      `${KEYRING_ENV} must be a JSON object of keyId to base64 key`,
    );
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new BankConfigVaultError(
      `${KEYRING_ENV} must contain at least one encryption key`,
    );
  }

  return new Map(
    entries.map(([keyId, value]) => {
      if (!keyId || typeof value !== "string") {
        throw new BankConfigVaultError(
          `${KEYRING_ENV} contains an invalid key entry`,
        );
      }
      return [keyId, decodeKey(value, keyId)];
    }),
  );
}

function aad(connectorId: string, keyId: string): Buffer {
  return Buffer.from(
    `${ENVELOPE_KIND}:${ENVELOPE_VERSION}:${connectorId}:${keyId}`,
    "utf8",
  );
}

function containsSecretField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretField(item));
  }
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      SECRET_FIELD_PATTERN.test(key) || containsSecretField(child),
  );
}

export function encryptBankConnectorConfig(
  connectorId: string,
  config: Record<string, unknown>,
  environment: NodeJS.ProcessEnv = process.env,
): BankConfigEnvelope {
  const keyring = readKeyring(environment);
  const keyId = environment[ACTIVE_KEY_ID_ENV];
  if (!keyId) {
    throw new BankConfigVaultError(
      `${ACTIVE_KEY_ID_ENV} is required before bank connector credentials can be stored`,
    );
  }
  const key = keyring.get(keyId);
  if (!key) {
    throw new BankConfigVaultError(
      `Active bank config key ${keyId} is not present in ${KEYRING_ENV}`,
    );
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(connectorId, keyId));
  const plaintext = Buffer.from(JSON.stringify(config), "utf8");
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  return {
    kind: ENVELOPE_KIND,
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyId,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptBankConnectorConfig(
  connectorId: string,
  stored: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  if (!stored) return {};
  if (!isBankConfigEnvelope(stored)) {
    if (containsSecretField(stored)) {
      throw new BankConfigVaultError(
        "Plaintext bank connector credentials are blocked; migrate this connector into the encrypted config vault",
      );
    }
    return isPlainObject(stored) ? stored : {};
  }

  const keyring = readKeyring(environment);
  const key = keyring.get(stored.keyId);
  if (!key) {
    throw new BankConfigVaultError(
      `Bank config key ${stored.keyId} is unavailable`,
    );
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(stored.iv, "base64"),
    );
    decipher.setAAD(aad(connectorId, stored.keyId));
    decipher.setAuthTag(Buffer.from(stored.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(stored.ciphertext, "base64")),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (!isPlainObject(parsed)) {
      throw new Error("decrypted config is not an object");
    }
    return parsed;
  } catch (cause) {
    throw new BankConfigVaultError(
      "Bank connector config could not be authenticated and decrypted",
      { cause },
    );
  }
}

export function sealBankConnectorConfig(
  connectorId: string,
  config: Record<string, unknown>,
  environment: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  if (Object.keys(config).length === 0) return {};
  return encryptBankConnectorConfig(
    connectorId,
    config,
    environment,
  ) as unknown as Record<string, unknown>;
}
