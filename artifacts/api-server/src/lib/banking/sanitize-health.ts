function optionalString(
  value: unknown,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(
  value: unknown,
): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(
  value: unknown,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalStringList(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.length <= 80,
  );
  return result.length === value.length ? result : undefined;
}

export function sanitizeConnectorHealthResponse(
  health: unknown,
): Record<string, unknown> {
  const value = (
    health && typeof health === "object" ? health : {}
  ) as Record<string, unknown>;

  const safe: Record<string, unknown> = {
    status: optionalString(value["status"]) ?? "error",
    message:
      value["authOk"] === true
        ? "Connector check completed"
        : "Connector check failed",
    checkedAt: optionalString(value["checkedAt"]) ?? null,
    authOk: optionalBoolean(value["authOk"]) ?? false,
    scopesGranted:
      optionalStringList(value["scopesGranted"]) ?? [],
    hasAccountsScope:
      optionalBoolean(value["hasAccountsScope"]) ?? false,
    hasTransactionsScope:
      optionalBoolean(value["hasTransactionsScope"]) ?? false,
    accountsAccessOk:
      optionalBoolean(value["accountsAccessOk"]) ?? false,
    transactionsAccessOk:
      optionalBoolean(value["transactionsAccessOk"]) ?? false,
    diagnosticCode:
      optionalString(value["diagnosticCode"]) ?? "api_error",
    diagnosticMessage:
      optionalString(value["diagnosticCode"]) ?? "api_error",
    environment:
      optionalString(value["environment"]) ?? "unknown",
  };

  const optionalFields: Record<string, unknown> = {
    tokenExpired: optionalBoolean(value["tokenExpired"]),
    authStage: optionalString(value["authStage"]),
    consentStatus: optionalString(value["consentStatus"]),
    accountCount: optionalNumber(value["accountCount"]),
    apiBase: optionalString(value["apiBase"]),
    customersCount: optionalNumber(value["customersCount"]),
  };
  for (const [key, fieldValue] of Object.entries(optionalFields)) {
    if (fieldValue !== undefined) safe[key] = fieldValue;
  }

  return safe;
}
