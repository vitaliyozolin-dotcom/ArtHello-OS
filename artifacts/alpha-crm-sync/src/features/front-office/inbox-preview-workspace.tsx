import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  Headphones,
  Inbox,
  LockKeyhole,
  Mail,
  MessageCircle,
  MessagesSquare,
  Phone,
  Route,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Tag,
  TicketCheck,
  UserCheck,
  UserRoundCog,
  UserRoundX,
} from "lucide-react";
import inboxPreviewData from "@/features/front-office/inbox-preview-data.json";

type QueueKey =
  | "all"
  | "unread"
  | "unassigned"
  | "urgent"
  | "overdue"
  | "follow_up"
  | "sales"
  | "service";
type DetailView = "thread" | "context" | "handoff";
type Priority = "P0" | "P1" | "P2" | "P3" | "P4";
type IdentityStatus = "not_required" | "verified" | "partial" | "failed";
type ConversationKind = "SALES" | "SERVICE" | "INCIDENT" | "ROUTING";
type MessageType = "INCOMING" | "INTERNAL_NOTE" | "AI_DRAFT";

interface PreviewMessage {
  id: string;
  type: MessageType;
  at: string;
  actor: string;
  body: string;
  immutable: boolean;
  synthetic: boolean;
}

interface PreviewFact {
  statement: string;
  status: "VERIFIED";
  sourceRef: string;
}

interface PreviewClaim {
  statement: string;
  status: "UNVERIFIED";
}

interface PreviewHandoff {
  requester: string;
  goal: string;
  scope: string;
  dates: string;
  verifiedFacts: string[];
  unverifiedClaims: string[];
  emotion: string;
  risk: string;
  policy: string;
  actionsDone: string[];
  decisionRequired: string;
  ownerRole: string;
  due: string;
  recommendedReply: string;
}

interface PreviewCollaborationState {
  conversationId: string;
  viewers: string[];
  draftReviewState: "NONE" | "REVIEW_REQUESTED" | "HUMAN_ONLY";
  collisionState: "CLEAR" | "VIEWER_PRESENT";
  sharedDraftWrites: false;
}

interface PreviewContinuityCheck {
  conversationId: string;
  threadKey: string;
  channels: {
    channel: string;
    state: string;
  }[];
  duplicateState: "NO_MATCH" | "POSSIBLE_RELATED";
  candidateIds: string[];
  automaticMergeAllowed: false;
}

interface PreviewSnippet {
  id: string;
  title: string;
  appliesTo: string[];
  status: "APPROVED";
  sourceStatus: "VERIFIED";
  sourceRef: string;
  insertEnabled: false;
}

interface PreviewConversation {
  id: string;
  subject: string;
  preview: string;
  channel: string;
  kind: ConversationKind;
  status: string;
  priority: Priority;
  unread: boolean;
  identity: IdentityStatus;
  assignedTo: string;
  due: string;
  lastActivity: string;
  slaState: string;
  linkedObject: {
    type: "LEAD" | "TICKET" | "INCIDENT" | "ROUTING";
    id: string;
    label: string;
    previewOnly: boolean;
  };
  personalDataRisk: boolean;
  mayRevealPrivateData: boolean;
  intent: string;
  confidence: string;
  emotion: string;
  churnRisk: string;
  tags: string[];
  nextAction: string;
  followUp: {
    required: boolean;
    status: string;
    due: string;
    owner: string;
    promisedChannel: string;
  };
  messages: PreviewMessage[];
  facts: {
    verified: PreviewFact[];
    unverified: PreviewClaim[];
  };
  draft: {
    text: string;
    claims: {
      assertion: string;
      status: "VERIFIED";
      evidence: string;
    }[];
    sent: boolean;
    saved: boolean;
  };
  handoff?: PreviewHandoff;
  audit: {
    id: string;
    event: string;
    actor: string;
    at: string;
  }[];
}

interface InboxPreviewData {
  projectId: "ARTHELLO";
  dataMode: "SYNTHETIC";
  autonomyMode: "DRAFT_ONLY";
  realIngressEnabled: false;
  outboundDeliveryEnabled: false;
  persistenceEnabled: false;
  queues: {
    key: QueueKey;
    label: string;
  }[];
  collaborationStates: PreviewCollaborationState[];
  continuityChecks: PreviewContinuityCheck[];
  approvedSnippets: PreviewSnippet[];
  conversations: PreviewConversation[];
}

const preview = inboxPreviewData as InboxPreviewData;

const PRIORITY_STYLES: Record<Priority, string> = {
  P0: "bg-rose-600 text-white",
  P1: "bg-orange-100 text-orange-800 ring-1 ring-orange-200",
  P2: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
  P3: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  P4: "bg-gray-100 text-gray-600",
};

const MESSAGE_STYLES: Record<
  MessageType,
  { label: string; panel: string; icon: ReactNode }
> = {
  INCOMING: {
    label: "Входящее",
    panel: "border-gray-200 bg-white",
    icon: <MessageCircle className="h-3.5 w-3.5 text-gray-500" />,
  },
  INTERNAL_NOTE: {
    label: "Внутренняя заметка",
    panel: "border-amber-200 bg-amber-50",
    icon: <FileText className="h-3.5 w-3.5 text-amber-700" />,
  },
  AI_DRAFT: {
    label: "AI-черновик",
    panel: "border-violet-200 bg-violet-50",
    icon: <Bot className="h-3.5 w-3.5 text-violet-700" />,
  },
};

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    WEB_CHAT: "Чат сайта",
    SITE_CHAT: "Чат сайта",
    MESSENGER: "Мессенджер",
    EMAIL: "Email",
    PHONE_TRANSCRIPT: "Расшифровка звонка",
    MANUAL_ENTRY: "Ручной ввод",
  };
  return labels[channel] ?? channel;
}

function channelIcon(channel: string): ReactNode {
  if (channel === "EMAIL") return <Mail className="h-3.5 w-3.5" />;
  if (channel === "PHONE_TRANSCRIPT") return <Phone className="h-3.5 w-3.5" />;
  if (channel === "MANUAL_ENTRY") return <FileText className="h-3.5 w-3.5" />;
  return <MessageCircle className="h-3.5 w-3.5" />;
}

function kindLabel(kind: ConversationKind): string {
  const labels: Record<ConversationKind, string> = {
    SALES: "Продажа",
    SERVICE: "Сервис",
    INCIDENT: "Инцидент",
    ROUTING: "Маршрутизация",
  };
  return labels[kind];
}

function matchesQueue(
  conversation: PreviewConversation,
  queue: QueueKey,
): boolean {
  if (queue === "all") return true;
  if (queue === "unread") return conversation.unread;
  if (queue === "unassigned")
    return conversation.assignedTo.includes("UNASSIGNED");
  if (queue === "urgent")
    return conversation.priority === "P0" || conversation.priority === "P1";
  if (queue === "overdue")
    return [
      "ATTENTION_REQUIRED",
      "CRITICAL_HANDOFF",
      "URGENT_HANDOFF",
      "IDENTITY_BLOCKED",
    ].includes(conversation.slaState);
  if (queue === "follow_up")
    return conversation.followUp.required && conversation.status !== "CLOSED";
  if (queue === "sales") return conversation.kind === "SALES";
  return conversation.kind !== "SALES";
}

function queueIcon(key: QueueKey): ReactNode {
  const icons: Record<QueueKey, ReactNode> = {
    all: <Inbox className="h-3.5 w-3.5" />,
    unread: <Mail className="h-3.5 w-3.5" />,
    unassigned: <UserRoundX className="h-3.5 w-3.5" />,
    urgent: <ShieldAlert className="h-3.5 w-3.5" />,
    overdue: <Clock3 className="h-3.5 w-3.5" />,
    follow_up: <Route className="h-3.5 w-3.5" />,
    sales: <UserCheck className="h-3.5 w-3.5" />,
    service: <Headphones className="h-3.5 w-3.5" />,
  };
  return icons[key];
}

function IdentityBadge({
  status,
  blocked,
}: {
  status: IdentityStatus;
  blocked: boolean;
}) {
  const labels: Record<IdentityStatus, string> = {
    not_required: "Проверка не требуется",
    verified: "Личность подтверждена",
    partial: "Проверка не завершена",
    failed: "Проверка не пройдена",
  };
  const style =
    status === "verified"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "not_required"
        ? "bg-gray-50 text-gray-600 ring-gray-200"
        : "bg-amber-50 text-amber-800 ring-amber-200";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${style}`}
    >
      {blocked ? (
        <LockKeyhole className="h-3 w-3" />
      ) : (
        <ShieldCheck className="h-3 w-3" />
      )}
      {labels[status]}
    </span>
  );
}

function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: {
  conversation: PreviewConversation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-b border-gray-100 px-3 py-3 text-left transition-colors ${
        selected ? "bg-violet-50" : "bg-white hover:bg-gray-50"
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            conversation.unread ? "bg-violet-600" : "bg-gray-200"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${PRIORITY_STYLES[conversation.priority]}`}
            >
              {conversation.priority}
            </span>
            <span className="truncate text-[9px] text-gray-400">
              {conversation.lastActivity}
            </span>
          </div>
          <p
            className={`mt-1.5 line-clamp-2 text-xs leading-4 ${
              conversation.unread
                ? "font-semibold text-gray-950"
                : "font-medium text-gray-800"
            }`}
          >
            {conversation.subject}
          </p>
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-gray-500">
            {conversation.preview}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[9px] font-medium text-gray-400">
              {channelIcon(conversation.channel)}
              {channelLabel(conversation.channel)}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
              {kindLabel(conversation.kind)}
            </span>
          </div>
          {conversation.assignedTo.includes("UNASSIGNED") && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-semibold text-rose-600">
              <UserRoundX className="h-3 w-3" />
              Нет назначенного владельца
            </p>
          )}
        </div>
        <ChevronRight
          className={`mt-1 h-3.5 w-3.5 shrink-0 ${
            selected ? "text-violet-600" : "text-gray-300"
          }`}
        />
      </div>
    </button>
  );
}

function ThreadView({ conversation }: { conversation: PreviewConversation }) {
  const disclosureBlocked =
    conversation.personalDataRisk && !conversation.mayRevealPrivateData;

  return (
    <div className="space-y-3">
      {disclosureBlocked && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-[11px] font-semibold text-amber-950">
              Раскрытие семейных данных заблокировано
            </p>
            <p className="mt-0.5 text-[10px] leading-4 text-amber-800">
              Текущий статус личности не разрешает показывать непубличные
              сведения. В preview клиентские профили не открываются.
            </p>
          </div>
        </div>
      )}

      {conversation.messages.map((message) => {
        const style = MESSAGE_STYLES[message.type];
        return (
          <article
            key={message.id}
            className={`rounded-xl border p-3 ${style.panel}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-gray-700">
                {style.icon}
                {style.label}
                {message.type === "INTERNAL_NOTE" && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700">
                    Только внутри
                  </span>
                )}
              </span>
              <span className="text-[9px] text-gray-400">{message.at}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-800">
              {message.body}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] text-gray-400">
              <span>{message.actor}</span>
              <span className="inline-flex items-center gap-1">
                <FileCheck2 className="h-3 w-3" />
                Неизменяемая запись · SYNTHETIC
              </span>
            </div>
          </article>
        );
      })}

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-gray-800">
            Ответ клиенту
          </p>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold text-violet-700">
            DRAFT_ONLY
          </span>
        </div>
        <textarea
          disabled
          value={conversation.draft.text}
          readOnly
          aria-label="Неотправленный AI-черновик"
          className="min-h-28 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-600 disabled:cursor-not-allowed"
        />
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled
            title="Сохранение отключено в безопасном preview"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-[10px] font-semibold text-gray-400 disabled:cursor-not-allowed"
          >
            Сохранение отключено
          </button>
          <button
            type="button"
            disabled
            title="Отправка отключена в безопасном preview"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gray-200 px-3 text-[10px] font-semibold text-gray-500 disabled:cursor-not-allowed"
          >
            <Send className="h-3 w-3" />
            Отправка отключена
          </button>
        </div>
      </div>
    </div>
  );
}

function ContextView({
  conversation,
  collaboration,
  continuity,
  snippets,
}: {
  conversation: PreviewConversation;
  collaboration: PreviewCollaborationState | undefined;
  continuity: PreviewContinuityCheck | undefined;
  snippets: PreviewSnippet[];
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <TicketCheck className="h-4 w-4 text-violet-600" />
          <h3 className="text-xs font-semibold text-gray-900">Классификация</h3>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]">
          <div>
            <dt className="text-gray-400">Intent</dt>
            <dd className="mt-0.5 break-words font-semibold text-gray-700">
              {conversation.intent}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">Уверенность</dt>
            <dd className="mt-0.5 font-semibold text-gray-700">
              {conversation.confidence}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">Эмоция</dt>
            <dd className="mt-0.5 font-semibold text-gray-700">
              {conversation.emotion}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400">Риск ухода</dt>
            <dd className="mt-0.5 font-semibold text-gray-700">
              {conversation.churnRisk}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {conversation.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[9px] font-medium text-gray-600"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-blue-600" />
          <h3 className="text-xs font-semibold text-gray-900">
            Связанный объект
          </h3>
        </div>
        <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-blue-700">
          {conversation.linkedObject.type}
        </p>
        <p className="mt-1 text-xs font-semibold text-gray-900">
          {conversation.linkedObject.id}
        </p>
        <p className="mt-1 text-[10px] leading-4 text-gray-500">
          {conversation.linkedObject.label}
        </p>
        <button
          type="button"
          disabled
          title="Переход к рабочим данным отключён"
          className="mt-3 inline-flex h-7 items-center rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[9px] font-semibold text-gray-400 disabled:cursor-not-allowed"
        >
          Только preview · открытие отключено
        </button>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700" />
          <h3 className="text-xs font-semibold text-emerald-950">
            Подтверждённые факты
          </h3>
        </div>
        <div className="mt-3 space-y-2">
          {conversation.facts.verified.map((fact) => (
            <div key={fact.statement}>
              <p className="text-[10px] leading-4 text-emerald-900">
                {fact.statement}
              </p>
              <p className="mt-0.5 text-[9px] font-medium text-emerald-700">
                VERIFIED · {fact.sourceRef}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-center gap-2">
          <CircleAlert className="h-4 w-4 text-amber-700" />
          <h3 className="text-xs font-semibold text-amber-950">
            Требует проверки
          </h3>
        </div>
        <div className="mt-3 space-y-2">
          {conversation.facts.unverified.map((claim) => (
            <p
              key={claim.statement}
              className="text-[10px] leading-4 text-amber-900"
            >
              <strong>UNVERIFIED:</strong> {claim.statement}
            </p>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-violet-200 bg-violet-50 p-3 xl:col-span-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-violet-700" />
          <h3 className="text-xs font-semibold text-violet-950">
            Доказательства AI-черновика
          </h3>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {conversation.draft.claims.map((claim) => (
            <div
              key={claim.assertion}
              className="rounded-lg border border-violet-100 bg-white/80 p-2.5"
            >
              <p className="text-[10px] leading-4 text-violet-950">
                {claim.assertion}
              </p>
              <p className="mt-1 text-[9px] font-semibold text-violet-700">
                VERIFIED · {claim.evidence}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-3 xl:col-span-2">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-blue-700" />
          <h3 className="text-xs font-semibold text-blue-950">
            Следующий шаг и follow-up
          </h3>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-blue-950">
          {conversation.nextAction}
        </p>
        <dl className="mt-3 grid gap-2 text-[10px] sm:grid-cols-3">
          <div>
            <dt className="text-blue-600">Статус</dt>
            <dd className="mt-0.5 font-semibold text-blue-900">
              {conversation.followUp.status}
            </dd>
          </div>
          <div>
            <dt className="text-blue-600">Владелец</dt>
            <dd className="mt-0.5 font-semibold text-blue-900">
              {conversation.followUp.owner}
            </dd>
          </div>
          <div>
            <dt className="text-blue-600">Срок / канал</dt>
            <dd className="mt-0.5 font-semibold text-blue-900">
              {conversation.followUp.due} ·{" "}
              {conversation.followUp.promisedChannel}
            </dd>
          </div>
        </dl>
      </section>

      {continuity && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2">
            <MessagesSquare className="h-4 w-4 text-slate-700" />
            <h3 className="text-xs font-semibold text-slate-950">
              Связность и дубли
            </h3>
          </div>
          <dl className="mt-3 space-y-2 text-[10px]">
            <div>
              <dt className="text-slate-500">Единый thread key</dt>
              <dd className="mt-0.5 font-semibold text-slate-800">
                {continuity.threadKey}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Каналы в истории</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {continuity.channels.map((channel) => (
                  <span
                    key={`${channel.channel}-${channel.state}`}
                    className="rounded-full bg-white px-2 py-1 font-medium text-slate-700 ring-1 ring-slate-200"
                  >
                    {channelLabel(channel.channel)} · {channel.state}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Проверка дубля</dt>
              <dd
                className={`mt-0.5 font-semibold ${
                  continuity.duplicateState === "POSSIBLE_RELATED"
                    ? "text-amber-700"
                    : "text-emerald-700"
                }`}
              >
                {continuity.duplicateState}
              </dd>
            </div>
          </dl>
          {continuity.candidateIds.length > 0 && (
            <p className="mt-2 text-[9px] leading-4 text-amber-700">
              Возможная связь: {continuity.candidateIds.join(", ")}. Нужна
              ручная проверка.
            </p>
          )}
          <p className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-slate-600">
            <LockKeyhole className="h-3 w-3" />
            Автоматический merge запрещён
          </p>
        </section>
      )}

      {collaboration && (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
          <div className="flex items-center gap-2">
            <UserRoundCog className="h-4 w-4 text-cyan-700" />
            <h3 className="text-xs font-semibold text-cyan-950">
              Командная работа · synthetic
            </h3>
          </div>
          <dl className="mt-3 space-y-2 text-[10px]">
            <div>
              <dt className="text-cyan-600">Присутствие</dt>
              <dd className="mt-0.5 font-semibold text-cyan-900">
                {collaboration.viewers.length > 0
                  ? collaboration.viewers.join(", ")
                  : "Никто больше не просматривает"}
              </dd>
            </div>
            <div>
              <dt className="text-cyan-600">Collision-состояние</dt>
              <dd className="mt-0.5 font-semibold text-cyan-900">
                {collaboration.collisionState}
              </dd>
            </div>
            <div>
              <dt className="text-cyan-600">Проверка черновика</dt>
              <dd className="mt-0.5 font-semibold text-cyan-900">
                {collaboration.draftReviewState}
              </dd>
            </div>
          </dl>
          <p className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-cyan-700">
            <LockKeyhole className="h-3 w-3" />
            Совместное редактирование отключено
          </p>
        </section>
      )}

      <section className="rounded-xl border border-violet-200 bg-violet-50 p-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-violet-700" />
          <h3 className="text-xs font-semibold text-violet-950">
            Утверждённые snippets
          </h3>
        </div>
        {snippets.length > 0 ? (
          <div className="mt-3 space-y-2">
            {snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="rounded-lg border border-violet-100 bg-white/80 p-2.5"
              >
                <p className="text-[10px] font-semibold text-violet-950">
                  {snippet.title}
                </p>
                <p className="mt-1 text-[9px] text-violet-700">
                  APPROVED · VERIFIED · {snippet.sourceRef}
                </p>
                <button
                  type="button"
                  disabled
                  title="Вставка snippets отключена в preview"
                  className="mt-2 inline-flex h-7 items-center rounded-lg bg-gray-100 px-2.5 text-[9px] font-semibold text-gray-400 disabled:cursor-not-allowed"
                >
                  Вставка snippet отключена
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[10px] leading-4 text-violet-800">
            Для этого intent нет утверждённого snippet. Критические и спорные
            обращения не закрываются шаблоном.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-gray-600" />
          <h3 className="text-xs font-semibold text-gray-900">
            Activity / audit history
          </h3>
        </div>
        <div className="mt-3 space-y-2">
          {conversation.audit.map((event) => (
            <div
              key={event.id}
              className="border-l-2 border-gray-200 pl-2.5 text-[9px]"
            >
              <p className="font-semibold text-gray-800">{event.event}</p>
              <p className="mt-0.5 leading-4 text-gray-500">
                {event.at} · {event.actor}
              </p>
              <p className="text-gray-400">{event.id}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9px] font-medium text-gray-500">
          Preview показывает только synthetic audit; рабочая история не
          загружается.
        </p>
      </section>
    </div>
  );
}

function HandoffView({ conversation }: { conversation: PreviewConversation }) {
  const handoff = conversation.handoff;

  if (!handoff) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
          <div>
            <p className="text-xs font-semibold text-emerald-950">
              Передача человеку пока не требуется
            </p>
            <p className="mt-1 text-[10px] leading-4 text-emerald-800">
              Обращение остаётся в ручной рабочей очереди. Отправка и любое
              изменение данных в preview отключены.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const summaryRows = [
    ["Кто обращается", handoff.requester],
    ["Цель", handoff.goal],
    ["Контур", handoff.scope],
    ["Даты", handoff.dates],
    ["Эмоция и риск", `${handoff.emotion} · ${handoff.risk}`],
    ["Политика", handoff.policy],
    ["Требуется решение", handoff.decisionRequired],
    ["Ответственный", handoff.ownerRole],
    ["Крайний срок", handoff.due],
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-700" />
          <p className="text-xs font-semibold text-rose-950">
            Пакет передачи подготовлен, но не отправлен
          </p>
        </div>
        <p className="mt-1.5 text-[10px] leading-4 text-rose-800">
          Клиенту не придётся повторять уже полученную историю. Владелец и срок
          должны быть подтверждены человеком.
        </p>
      </div>

      <dl className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {summaryRows.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1 border-b border-gray-100 px-3 py-2.5 last:border-0 sm:grid-cols-[140px_1fr]"
          >
            <dt className="text-[10px] font-medium text-gray-400">{label}</dt>
            <dd className="text-[10px] font-semibold leading-4 text-gray-800">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <h3 className="text-[11px] font-semibold text-emerald-950">
            Подтверждённые факты
          </h3>
          <ul className="mt-2 space-y-1.5">
            {handoff.verifiedFacts.map((fact) => (
              <li
                key={fact}
                className="flex gap-1.5 text-[10px] leading-4 text-emerald-900"
              >
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                {fact}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-[11px] font-semibold text-amber-950">
            Слова, которые ещё не проверены
          </h3>
          <ul className="mt-2 space-y-1.5">
            {handoff.unverifiedClaims.map((claim) => (
              <li
                key={claim}
                className="flex gap-1.5 text-[10px] leading-4 text-amber-900"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {claim}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <h3 className="text-[11px] font-semibold text-gray-900">
          Что уже сделано
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {handoff.actionsDone.map((action) => (
            <span
              key={action}
              className="rounded-full bg-white px-2 py-1 text-[9px] font-medium text-gray-600 ring-1 ring-gray-200"
            >
              {action}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-violet-200 bg-violet-50 p-3">
        <h3 className="text-[11px] font-semibold text-violet-950">
          Рекомендуемый черновик человеку
        </h3>
        <p className="mt-2 text-[10px] leading-5 text-violet-900">
          {handoff.recommendedReply}
        </p>
      </section>

      <button
        type="button"
        disabled
        title="Передача отключена в безопасном preview"
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gray-200 px-3 text-[10px] font-semibold text-gray-500 disabled:cursor-not-allowed"
      >
        <UserRoundCog className="h-3.5 w-3.5" />
        Передача отключена · только preview
      </button>
    </div>
  );
}

export function InboxPreviewWorkspace() {
  const [queue, setQueue] = useState<QueueKey>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(
    preview.conversations[0]?.id ?? "",
  );
  const [detailView, setDetailView] = useState<DetailView>("thread");

  const queueCounts = useMemo(
    () =>
      Object.fromEntries(
        preview.queues.map((item) => [
          item.key,
          preview.conversations.filter((conversation) =>
            matchesQueue(conversation, item.key),
          ).length,
        ]),
      ) as Record<QueueKey, number>,
    [],
  );

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return preview.conversations.filter((conversation) => {
      const matchesSearch =
        normalized.length === 0 ||
        [
          conversation.subject,
          conversation.preview,
          conversation.id,
          conversation.intent,
          ...conversation.tags,
        ]
          .join(" ")
          .toLocaleLowerCase("ru")
          .includes(normalized);
      return matchesQueue(conversation, queue) && matchesSearch;
    });
  }, [query, queue]);

  const selectedConversation =
    filteredConversations.find(
      (conversation) => conversation.id === selectedId,
    ) ??
    filteredConversations[0] ??
    null;
  const selectedCollaboration = selectedConversation
    ? preview.collaborationStates.find(
        (state) => state.conversationId === selectedConversation.id,
      )
    : undefined;
  const selectedContinuity = selectedConversation
    ? preview.continuityChecks.find(
        (check) => check.conversationId === selectedConversation.id,
      )
    : undefined;
  const selectedSnippets = selectedConversation
    ? preview.approvedSnippets.filter((snippet) =>
        snippet.appliesTo.includes(selectedConversation.intent),
      )
    : [];

  function selectQueue(nextQueue: QueueKey) {
    setQueue(nextQueue);
    const first = preview.conversations.find((conversation) =>
      matchesQueue(conversation, nextQueue),
    );
    if (first) setSelectedId(first.id);
    setDetailView("thread");
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <header className="border-b border-gray-100 bg-gradient-to-r from-slate-50 via-white to-violet-50 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Inbox className="h-5 w-5 text-violet-600" />
              <h2 className="text-base font-semibold text-gray-950">
                Единый входящий ящик
              </h2>
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold text-violet-700">
                {preview.projectId}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-gray-500">
              Одна непрерывная история для продаж и сервиса — с отдельными Lead,
              Ticket и Incident.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[9px] font-bold">
            <span className="rounded-full bg-white px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200">
              Входящие каналы: OFF
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200">
              Отправка: OFF
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-emerald-700 ring-1 ring-emerald-200">
              Запись: OFF
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-violet-700 ring-1 ring-violet-200">
              SYNTHETIC · DRAFT_ONLY
            </span>
          </div>
        </div>
      </header>

      <div className="grid min-h-[720px] lg:grid-cols-[180px_300px_minmax(0,1fr)]">
        <aside className="border-b border-gray-100 bg-gray-50/70 p-3 lg:border-b-0 lg:border-r">
          <p className="px-2 text-[9px] font-bold uppercase tracking-[0.16em] text-gray-400">
            Очереди
          </p>
          <nav className="mt-2 space-y-1" aria-label="Очереди обращений">
            {preview.queues.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => selectQueue(item.key)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[10px] font-medium transition-colors ${
                  queue === item.key
                    ? "bg-violet-100 text-violet-800"
                    : "text-gray-600 hover:bg-white hover:text-gray-900"
                }`}
              >
                {queueIcon(item.key)}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    queue === item.key
                      ? "bg-white text-violet-700"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {queueCounts[item.key]}
                </span>
              </button>
            ))}
          </nav>

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-2.5">
            <div className="flex items-center gap-1.5">
              <CircleAlert className="h-3.5 w-3.5 text-amber-700" />
              <p className="text-[10px] font-semibold text-amber-950">
                SLA не активирован
              </p>
            </div>
            <p className="mt-1 text-[9px] leading-4 text-amber-800">
              Приоритеты работают как классификация. Точные сроки нельзя обещать
              до утверждения матрицы.
            </p>
          </div>
        </aside>

        <div className="border-b border-gray-100 lg:border-b-0 lg:border-r">
          <div className="border-b border-gray-100 p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск в synthetic-истории"
                className="h-8 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-3 text-[10px] text-gray-700 outline-none transition focus:border-violet-300 focus:bg-white"
              />
            </label>
            <p className="mt-2 text-[9px] text-gray-400">
              Найдено: {filteredConversations.length} · данные обезличены
            </p>
          </div>
          <div className="max-h-[640px] overflow-y-auto">
            {filteredConversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                selected={selectedConversation?.id === conversation.id}
                onSelect={() => {
                  setSelectedId(conversation.id);
                  setDetailView("thread");
                }}
              />
            ))}
            {filteredConversations.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Search className="mx-auto h-5 w-5 text-gray-300" />
                <p className="mt-2 text-[10px] text-gray-500">
                  В этой synthetic-очереди ничего не найдено.
                </p>
              </div>
            )}
          </div>
        </div>

        {selectedConversation ? (
          <div className="min-w-0 bg-gray-50/40">
            <div className="border-b border-gray-100 bg-white px-3 py-3 sm:px-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${PRIORITY_STYLES[selectedConversation.priority]}`}
                    >
                      {selectedConversation.priority}
                    </span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-600">
                      {selectedConversation.status}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">
                      {channelIcon(selectedConversation.channel)}
                      {channelLabel(selectedConversation.channel)}
                    </span>
                    <span className="text-[9px] text-gray-400">
                      {selectedConversation.id}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold leading-5 text-gray-950">
                    {selectedConversation.subject}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <IdentityBadge
                      status={selectedConversation.identity}
                      blocked={
                        selectedConversation.personalDataRisk &&
                        !selectedConversation.mayRevealPrivateData
                      }
                    />
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500">
                      <UserRoundCog className="h-3 w-3" />
                      {selectedConversation.assignedTo}
                    </span>
                    {selectedCollaboration &&
                      selectedCollaboration.viewers.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-[9px] font-semibold text-cyan-700 ring-1 ring-cyan-200">
                          <UserCheck className="h-3 w-3" />
                          Сейчас смотрит:{" "}
                          {selectedCollaboration.viewers.join(", ")}
                        </span>
                      )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled
                    title="Назначение отключено в preview"
                    className="inline-flex h-8 items-center rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[9px] font-semibold text-gray-400 disabled:cursor-not-allowed"
                  >
                    Назначение отключено
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Закрытие отключено в preview"
                    className="inline-flex h-8 items-center rounded-lg bg-gray-200 px-2.5 text-[9px] font-semibold text-gray-500 disabled:cursor-not-allowed"
                  >
                    Закрытие отключено
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-[9px] sm:grid-cols-3">
                <div>
                  <p className="text-gray-400">SLA-состояние</p>
                  <p className="mt-0.5 font-semibold text-gray-700">
                    {selectedConversation.slaState}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Следующий контроль</p>
                  <p className="mt-0.5 font-semibold text-gray-700">
                    {selectedConversation.due}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Связанный объект</p>
                  <p className="mt-0.5 font-semibold text-gray-700">
                    {selectedConversation.linkedObject.type} ·{" "}
                    {selectedConversation.linkedObject.id}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-b border-gray-100 bg-white px-3 pt-2 sm:px-4">
              <div className="flex gap-1">
                {(
                  [
                    [
                      "thread",
                      "Диалог",
                      <MessagesSquare className="h-3 w-3" />,
                    ],
                    ["context", "Контекст", <FileCheck2 className="h-3 w-3" />],
                    ["handoff", "Передача", <Route className="h-3 w-3" />],
                  ] as [DetailView, string, ReactNode][]
                ).map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDetailView(key)}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-2 py-2 text-[10px] font-semibold transition-colors ${
                      detailView === key
                        ? "border-violet-600 text-violet-700"
                        : "border-transparent text-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {icon}
                    {label}
                    {key === "handoff" && selectedConversation.handoff && (
                      <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[8px] font-bold text-rose-700">
                        нужен
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[540px] overflow-y-auto p-3 sm:p-4">
              {detailView === "thread" && (
                <ThreadView conversation={selectedConversation} />
              )}
              {detailView === "context" && (
                <ContextView
                  conversation={selectedConversation}
                  collaboration={selectedCollaboration}
                  continuity={selectedContinuity}
                  snippets={selectedSnippets}
                />
              )}
              {detailView === "handoff" && (
                <HandoffView conversation={selectedConversation} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-72 items-center justify-center p-6 text-center">
            <div>
              <Search className="mx-auto h-6 w-6 text-gray-300" />
              <p className="mt-2 text-xs font-medium text-gray-600">
                Выберите обращение
              </p>
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-gray-100 bg-white px-4 py-3 text-[9px] text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Одна история обращения; реальные профили и каналы не подключены.
        </span>
        <span>
          {preview.conversations.length} synthetic-разговоров ·{" "}
          {preview.conversations.reduce(
            (total, conversation) => total + conversation.messages.length,
            0,
          )}{" "}
          неизменяемых сообщений
        </span>
      </footer>
    </section>
  );
}
