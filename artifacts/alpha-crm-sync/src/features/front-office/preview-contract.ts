export const FRONT_OFFICE_PREVIEW_CONTRACT = Object.freeze({
  projectId: "ARTHELLO",
  autonomyMode: "DRAFT_ONLY",
  dataMode: "SYNTHETIC",
  audience: "OWNER_ONLY",
  externalReads: false,
  externalWrites: false,
  outboundMessages: false,
  sharedSchemaChanges: false,
  dataPersistence: false,
  ephemeralUiStateOnly: true,
  knowledgeWrites: false,
  aiCanPublishKnowledge: false,
  configurationWrites: false,
  policyWrites: false,
  roleAssignments: false,
  slaActivation: false,
  approvedActionsCount: 0,
  realChannelsEnabled: false,
  channelIngress: false,
  inboxPersistence: false,
  conversationWrites: false,
  assignmentWrites: false,
  resolutionWrites: false,
  outboundDelivery: false,
  automaticConversationMerge: false,
  sharedDraftWrites: false,
  snippetInsertion: false,
  killSwitchPreviewOnly: true,
  aiUseOptional: true,
  manualWorkflowAvailable: true,
  aiOptOutMode: "MANUAL_WORKFLOW_REMAINS",
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
