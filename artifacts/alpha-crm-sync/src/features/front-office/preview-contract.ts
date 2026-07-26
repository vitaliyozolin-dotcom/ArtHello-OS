export const FRONT_OFFICE_PREVIEW_CONTRACT = Object.freeze({
  projectId: "ARTHELLO",
  autonomyMode: "DRAFT_ONLY",
  dataMode: "SYNTHETIC",
  audience: "OWNER_ONLY",
  externalReads: false,
  externalWrites: false,
  outboundMessages: false,
  sharedSchemaChanges: false,
  alfaCrmAccess: false,
  bankAccess: false,
} as const);

export const FRONT_OFFICE_PREVIEW_ENABLED =
  import.meta.env.VITE_FRONT_OFFICE_PREVIEW === "true";

export function canViewFrontOfficePreview(
  role: string | null | undefined,
): boolean {
  return FRONT_OFFICE_PREVIEW_ENABLED && role === "owner";
}
