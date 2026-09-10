export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function stringValue(value: unknown): string | null {
  if (
    value === null ||
    value === undefined ||
    typeof value === "object"
  ) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function nestedId(item: JsonRecord, key: string): string | null {
  return stringValue(asRecord(item[key])?.["id"]);
}

/**
 * AlfaCRM returns a customer link in several shapes. A row's own `id` may be
 * an attendance/membership id, so it must never be used as a customer id.
 */
export function relatedCustomerId(item: JsonRecord): string | null {
  return (
    stringValue(item["customer_id"]) ??
    stringValue(item["student_id"]) ??
    nestedId(item, "customer") ??
    nestedId(item, "student")
  );
}

export function normalizeName(value: unknown): string {
  return (stringValue(value) ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

export interface OperatingUnitRule {
  operatingUnitCode: string;
  mappingRule: string;
}

export function operatingUnitRule(
  branchName: string | null,
): OperatingUnitRule | null {
  const normalized = normalizeName(branchName);
  const school = normalized.includes("школ");
  const kindergarten = /(?:^|\s)(?:детский\s+сад|детсад|садик|дошкол)/.test(normalized);
  if (normalized.includes("атлас") && school !== kindergarten) {
    return {
      operatingUnitCode: school ? "atlas-school" : "atlas-kindergarten",
      mappingRule: school
        ? "branch_name_atlas_school"
        : "branch_name_atlas_kindergarten",
    };
  }
  if (normalized.includes("листвен")) {
    return {
      operatingUnitCode: "listvennaya",
      mappingRule: "branch_name_contains_listven",
    };
  }
  if (
    school &&
    /(?:^|\s)1\s*11(?:\s|$)/.test(normalized)
  ) {
    return {
      operatingUnitCode: "school-1-11",
      mappingRule: "branch_name_school_1_11",
    };
  }
  if (normalized.includes("небо") && kindergarten) {
    return {
      operatingUnitCode: "nebo-kindergarten",
      mappingRule: "branch_name_nebo_kindergarten",
    };
  }
  return null;
}

export function familyCandidateReasonCodes(
  guardianNameMatches: boolean,
): string[] {
  return guardianNameMatches
    ? ["shared_contact_phone", "shared_guardian_name"]
    : ["shared_contact_phone"];
}

export function safeAlfaErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "safeCode" in error &&
    typeof error.safeCode === "string"
  ) {
    return error.safeCode;
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return "request_timeout";
  }
  return "network_unavailable";
}
