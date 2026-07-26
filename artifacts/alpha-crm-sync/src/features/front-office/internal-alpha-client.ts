export type LeadStage =
  | "NEW"
  | "QUALIFIED"
  | "PROGRAM_MATCHED"
  | "TRIAL_REQUESTED"
  | "TRIAL_CONFIRMED"
  | "WON"
  | "LOST";

export type FactStatus =
  "VERIFIED" | "PARTIAL" | "UNVERIFIED" | "CONFLICT" | "STALE";

export interface InternalAlphaLead {
  id: string;
  conversationId: string;
  stage: LeadStage;
  source: string | null;
  campaign: string | null;
  childAgeBand: string | null;
  branchPreference: string | null;
  programInterest: string | null;
  ownerDisplayName: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  trialStatus:
    "not_requested" | "requested" | "confirmed" | "completed" | "cancelled";
  trialAt: string | null;
  lossReason: string | null;
  wonAt: string | null;
  isSynthetic: true;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InternalAlphaMessage {
  id: string;
  conversationId: string;
  messageType: "incoming" | "internal_note" | "ai_draft" | "system";
  direction: "incoming" | "internal";
  body: string;
  authorRole: string | null;
  authorDisplayName: string | null;
  factStatus: FactStatus;
  sourceRefs: string[];
  isSynthetic: true;
  createdAt: string;
}

export interface InternalAlphaConversation {
  id: string;
  projectId: "ARTHELLO";
  externalKey: string;
  kind: "lead" | "support" | "incident";
  channel: string;
  status:
    "open" | "waiting_customer" | "waiting_internal" | "resolved" | "closed";
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  contactDisplayName: string;
  contactPointMasked: string | null;
  identityStatus: "not_required" | "verified" | "partial" | "failed";
  intent: string | null;
  service: string | null;
  branchOrObject: string | null;
  ownerRole: string | null;
  ownerDisplayName: string | null;
  lastMessageAt: string;
  dueAt: string | null;
  nextActionAt: string | null;
  isSynthetic: true;
  version: number;
  createdAt: string;
  updatedAt: string;
  lead: InternalAlphaLead | null;
  messages: InternalAlphaMessage[];
}

export interface InternalAlphaTask {
  id: string;
  conversationId: string | null;
  leadId: string | null;
  title: string;
  description: string | null;
  ownerRole: string;
  ownerDisplayName: string | null;
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  status: "open" | "done" | "cancelled";
  dueAt: string;
  completedAt: string | null;
  isSynthetic: true;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InternalAlphaAuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorRole: string;
  actorDisplayName: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}

export interface InternalAlphaWorkspaceData {
  contract: {
    projectId: "ARTHELLO";
    mode: "DRAFT_ONLY";
    dataClass: "SYNTHETIC_ONLY";
    persistence: "postgres";
    liveIngressEnabled: false;
    outboundEnabled: false;
    financialActionsEnabled: false;
  };
  stats: {
    totalLeads: number;
    activeLeads: number;
    wonLeads: number;
    unassignedLeads: number;
    overdueTasks: number;
    stageCounts: Record<LeadStage, number>;
  };
  conversations: InternalAlphaConversation[];
  tasks: InternalAlphaTask[];
  auditEvents: InternalAlphaAuditEvent[];
}

export interface CreateInternalLeadInput {
  clientRequestId: string;
  contactDisplayName: string;
  contactPointMasked?: string;
  channel: "internal" | "site" | "phone" | "email" | "messenger";
  source?: string;
  intent?: string;
  childAgeBand?: string;
  branchPreference?: string;
  programInterest?: string;
  ownerDisplayName: string;
  nextAction: string;
  nextActionAt: string;
  initialMessage?: string;
}

export interface UpdateInternalLeadInput {
  version: number;
  stage?: LeadStage;
  ownerDisplayName?: string;
  nextAction?: string | null;
  nextActionAt?: string | null;
  branchPreference?: string | null;
  programInterest?: string | null;
  trialStatus?: InternalAlphaLead["trialStatus"];
  trialAt?: string | null;
  lossReason?: string | null;
}

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const name of ["__Host-arthello_csrf", "arthello_csrf"]) {
    const prefix = `${name}=`;
    const match = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix));
    if (match) return decodeURIComponent(match.slice(prefix.length));
  }
  return null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCsrfCookie();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => null)) as
    T | { error?: string } | null;
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Ошибка Front Office: ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function loadInternalAlphaWorkspace(): Promise<InternalAlphaWorkspaceData> {
  return request("/api/front-office/workspace");
}

export function seedInternalAlpha(): Promise<{
  ok: true;
  created: number;
  existing: number;
}> {
  return request("/api/front-office/demo/seed", { method: "POST" });
}

export function createInternalLead(input: CreateInternalLeadInput): Promise<{
  conversation: InternalAlphaConversation;
  lead: InternalAlphaLead;
  created: boolean;
}> {
  return request("/api/front-office/leads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateInternalLead(
  leadId: string,
  input: UpdateInternalLeadInput,
): Promise<InternalAlphaLead> {
  return request(`/api/front-office/leads/${leadId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function addInternalMessage(
  conversationId: string,
  input: {
    messageType: "internal_note" | "ai_draft";
    body: string;
    factStatus: FactStatus;
    sourceRefs: string[];
  },
): Promise<InternalAlphaMessage> {
  return request(`/api/front-office/conversations/${conversationId}/notes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateInternalTask(
  taskId: string,
  input: { version: number; status: InternalAlphaTask["status"] },
): Promise<InternalAlphaTask> {
  return request(`/api/front-office/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
