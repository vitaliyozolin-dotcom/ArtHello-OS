export interface ChannelInboxMessage {
  id: string;
  conversation_id: string;
  message_type: "incoming" | "internal_note" | "ai_draft" | "system";
  direction: "incoming" | "internal";
  body: string;
  author_role: string | null;
  author_display_name: string | null;
  fact_status: "VERIFIED" | "PARTIAL" | "UNVERIFIED" | "CONFLICT" | "STALE";
  source_refs: string[];
  created_at: string;
}

export interface ChannelInboxConversation {
  id: string;
  external_key: string;
  kind: "lead" | "support" | "incident";
  channel: string;
  status: "open" | "waiting_customer" | "waiting_internal" | "resolved" | "closed";
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  contact_display_name: string;
  contact_point_masked: string | null;
  identity_status: "not_required" | "verified" | "partial" | "failed";
  intent: string | null;
  owner_role: string | null;
  owner_display_name: string | null;
  last_message_at: string;
  due_at: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
  messages: ChannelInboxMessage[];
}

export interface SmsVizitkaStatus {
  provider: "smsvizitka";
  mode: "SHADOW";
  configured: boolean;
  shadowEnabled: boolean;
  outboundEnabled: false;
  channels: string[];
  webhookPath: string;
}

export interface ChannelInboxData {
  contract: {
    provider: "smsvizitka";
    mode: "SHADOW";
    configured: boolean;
    shadowEnabled: boolean;
    outboundEnabled: false;
  };
  conversations: ChannelInboxConversation[];
  stats: {
    conversations: number;
    unread: number;
    eventsLast7Days: number;
  };
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Не удалось загрузить каналы";
    throw new Error(message);
  }
  return data as T;
}

export function loadSmsVizitkaStatus(): Promise<SmsVizitkaStatus> {
  return request("/api/integrations/smsvizitka/status");
}

export function loadChannelInbox(): Promise<ChannelInboxData> {
  return request("/api/front-office/channel-inbox");
}
