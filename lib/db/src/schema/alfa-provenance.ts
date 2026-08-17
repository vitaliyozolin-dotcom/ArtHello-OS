/**
 * Legacy Drizzle writers predate enforced AlfaCRM lineage. Runtime defaults
 * make their insert types backward-compatible while failing closed before SQL.
 * Dedicated importers must always provide explicit raw, batch, and scope values.
 */
export function requireExplicitAlfaProvenance(): never {
  throw new Error("ALFACRM_PROVENANCE_REQUIRED");
}
