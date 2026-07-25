const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /(?:^|_)(?:authorization|cookie|set_cookie|password|secret|token|masked|last4|credential|api_key|client_secret|oauth_state|state|raw|body|payload|request|response|customer|customers|taxpayer_number|inn|phone|email|account_number|counterparty|full_name|short_name|authorize_url|consent_id|sub|error)(?:$|_)/i;

const MAX_DEPTH = 12;

function normalizeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-.\s]+/g, "_");
}

function sanitizeString(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /([?&](?:code|state|token|access_token|refresh_token|client_secret)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[REDACTED_EMAIL]",
    )
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[REDACTED_NUMBER]");
}

function serializeError(error: Error): Record<string, unknown> {
  const candidate = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  return {
    type: error.name || "Error",
    ...(typeof candidate.code === "string" ||
    typeof candidate.code === "number"
      ? { code: candidate.code }
      : {}),
    ...(typeof candidate.status === "number"
      ? { status: candidate.status }
      : typeof candidate.statusCode === "number"
        ? { status: candidate.statusCode }
        : {}),
  };
}

export function sanitizeLogValue(
  value: unknown,
  key = "",
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (key && SENSITIVE_KEY.test(normalizeKey(key))) {
    return REDACTED;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeLogValue(item, "", depth + 1, seen),
    );
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }
    seen.add(value);

    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitizeLogValue(
        entryValue,
        entryKey,
        depth + 1,
        seen,
      );
    }
    return sanitized;
  }

  return String(value);
}

export function sanitizeLogRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeLogValue(record) as Record<string, unknown>;
}
