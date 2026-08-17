import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  FileClock,
  Inbox,
  ListChecks,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  addInternalMessage,
  createInternalLead,
  loadInternalAlphaWorkspace,
  seedInternalAlpha,
  updateInternalLead,
  updateInternalTask,
  type CreateInternalLeadInput,
  type FactStatus,
  type InternalAlphaConversation,
  type InternalAlphaLead,
  type InternalAlphaTask,
  type LeadStage,
  type UpdateInternalLeadInput,
} from "./internal-alpha-client";

const STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "Новый",
  QUALIFIED: "Квалифицирован",
  PROGRAM_MATCHED: "Программа подобрана",
  TRIAL_REQUESTED: "Пробное запрошено",
  TRIAL_CONFIRMED: "Пробное подтверждено",
  WON: "Договор",
  LOST: "Потерян",
};

const STAGE_STYLES: Record<LeadStage, string> = {
  NEW: "bg-blue-50 text-blue-700 ring-blue-200",
  QUALIFIED: "bg-violet-50 text-violet-700 ring-violet-200",
  PROGRAM_MATCHED: "bg-amber-50 text-amber-700 ring-amber-200",
  TRIAL_REQUESTED: "bg-orange-50 text-orange-700 ring-orange-200",
  TRIAL_CONFIRMED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  WON: "bg-slate-100 text-slate-700 ring-slate-200",
  LOST: "bg-rose-50 text-rose-700 ring-rose-200",
};

const NEXT_STAGES: Record<LeadStage, LeadStage[]> = {
  NEW: ["NEW", "QUALIFIED", "LOST"],
  QUALIFIED: ["QUALIFIED", "PROGRAM_MATCHED", "LOST"],
  PROGRAM_MATCHED: ["PROGRAM_MATCHED", "TRIAL_REQUESTED", "LOST"],
  TRIAL_REQUESTED: ["TRIAL_REQUESTED", "TRIAL_CONFIRMED", "LOST"],
  TRIAL_CONFIRMED: ["TRIAL_CONFIRMED", "WON", "LOST"],
  WON: ["WON"],
  LOST: ["LOST"],
};

const WORKSPACE_QUERY_KEY = ["front-office", "internal-alpha"];

function dateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoOrNull(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function formatDate(value: string | null): string {
  if (!value) return "Не задано";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isOverdue(value: string | null): boolean {
  return Boolean(value && new Date(value).getTime() < Date.now());
}

function MetricCard({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  tone: "violet" | "blue" | "emerald" | "rose";
}) {
  const toneClasses = {
    violet: "bg-violet-50 text-violet-600",
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-xl ${toneClasses[tone]}`}
        >
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight text-gray-950">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-gray-400">{note}</p>
    </div>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-950">
            Рабочее ядро пока недоступно
          </h3>
          <p className="mt-1 text-xs leading-5 text-amber-800">{message}</p>
          <p className="mt-2 text-[11px] leading-4 text-amber-700">
            Внешние каналы и отправки по-прежнему отключены. Статические экраны
            в соседних вкладках можно использовать для проверки интерфейса.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Проверить снова
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyWorkspace({
  loading,
  onSeed,
}: {
  loading: boolean;
  onSeed: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/60 px-6 py-12 text-center">
      <Database className="mx-auto h-10 w-10 text-violet-400" />
      <h3 className="mt-4 text-base font-semibold text-violet-950">
        Внутренняя база готова, но пока пуста
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-violet-700">
        Создадим шесть обезличенных сценариев и прогоним полный путь лида.
        Реальные семьи, каналы, AlfaCRM и отправки не используются.
      </p>
      <button
        type="button"
        onClick={onSeed}
        disabled={loading}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Database className="h-4 w-4" />
        )}
        Создать тестовый контур
      </button>
    </div>
  );
}

function LeadListItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: InternalAlphaConversation;
  active: boolean;
  onSelect: () => void;
}) {
  const lead = conversation.lead;
  if (!lead) return null;
  const overdue = isOverdue(lead.nextActionAt);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 ${
        active ? "bg-violet-50/70" : "bg-white hover:bg-gray-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
            active ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500"
          }`}
        >
          <UserRound className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-xs font-semibold text-gray-900">
              {conversation.contactDisplayName}
            </p>
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 ${
                active ? "text-violet-500" : "text-gray-300"
              }`}
            />
          </div>
          <p className="mt-0.5 truncate text-[10px] text-gray-400">
            {conversation.intent ?? "Задача не определена"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${STAGE_STYLES[lead.stage]}`}
            >
              {STAGE_LABELS[lead.stage]}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-[9px] font-medium ${
                overdue ? "text-rose-600" : "text-gray-400"
              }`}
            >
              <Clock3 className="h-3 w-3" />
              {formatDate(lead.nextActionAt)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function LeadEditor({
  lead,
  saving,
  onSave,
}: {
  lead: InternalAlphaLead;
  saving: boolean;
  onSave: (input: UpdateInternalLeadInput) => void;
}) {
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [owner, setOwner] = useState(lead.ownerDisplayName ?? "");
  const [nextAction, setNextAction] = useState(lead.nextAction ?? "");
  const [nextActionAt, setNextActionAt] = useState(
    dateTimeInput(lead.nextActionAt),
  );
  const [branch, setBranch] = useState(lead.branchPreference ?? "");
  const [program, setProgram] = useState(lead.programInterest ?? "");
  const [lossReason, setLossReason] = useState(lead.lossReason ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      version: lead.version,
      stage,
      ownerDisplayName: owner,
      nextAction:
        stage === "WON" || stage === "LOST" ? null : nextAction || null,
      nextActionAt:
        stage === "WON" || stage === "LOST" ? null : isoOrNull(nextActionAt),
      branchPreference: branch || null,
      programInterest: program || null,
      lossReason: stage === "LOST" ? lossReason || null : null,
      trialStatus:
        stage === "TRIAL_REQUESTED"
          ? "requested"
          : stage === "TRIAL_CONFIRMED" || stage === "WON"
            ? "confirmed"
            : lead.trialStatus,
    });
  }

  const terminal = stage === "WON" || stage === "LOST";

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Этап
          </span>
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value as LeadStage)}
            className="h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-800 outline-none focus:border-violet-400"
          >
            {NEXT_STAGES[lead.stage].map((item) => (
              <option key={item} value={item}>
                {STAGE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Ответственный
          </span>
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            required={!terminal}
            className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Филиал
          </span>
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="Пока не выбран"
            className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Интерес
          </span>
          <input
            value={program}
            onChange={(event) => setProgram(event.target.value)}
            placeholder="Программа не определена"
            className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
          />
        </label>
      </div>

      {!terminal && (
        <div className="grid gap-3 sm:grid-cols-[1fr_190px]">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Следующий шаг
            </span>
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              required
              className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Срок
            </span>
            <input
              type="datetime-local"
              value={nextActionAt}
              onChange={(event) => setNextActionAt(event.target.value)}
              required
              className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
            />
          </label>
        </div>
      )}

      {stage === "LOST" && (
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Причина потери
          </span>
          <input
            value={lossReason}
            onChange={(event) => setLossReason(event.target.value)}
            required
            placeholder="Без причины закрыть лид нельзя"
            className="h-9 w-full rounded-xl border border-rose-200 px-3 text-xs outline-none focus:border-rose-400"
          />
        </label>
      )}

      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <p className="text-[10px] text-gray-400">
          Версия {lead.version} · защита от параллельной перезаписи
        </p>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Сохранить
        </button>
      </div>
    </form>
  );
}

function ConversationThread({
  conversation,
  saving,
  onAdd,
}: {
  conversation: InternalAlphaConversation;
  saving: boolean;
  onAdd: (input: {
    messageType: "internal_note" | "ai_draft";
    body: string;
    factStatus: FactStatus;
    sourceRefs: string[];
  }) => Promise<void>;
}) {
  const [messageType, setMessageType] = useState<"internal_note" | "ai_draft">(
    "internal_note",
  );
  const [factStatus, setFactStatus] = useState<FactStatus>("UNVERIFIED");
  const [body, setBody] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    try {
      await onAdd({
        messageType,
        body: body.trim(),
        factStatus,
        sourceRefs: [],
      });
      setBody("");
    } catch {
      // The parent mutation keeps the draft visible and shows the API error.
    }
  }

  return (
    <div>
      <div className="max-h-[330px] space-y-2 overflow-y-auto rounded-xl bg-gray-50 p-3">
        {conversation.messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">
            История пока пуста
          </p>
        ) : (
          conversation.messages.map((message) => {
            const incoming = message.messageType === "incoming";
            return (
              <div
                key={message.id}
                className={`rounded-xl border p-3 ${
                  incoming
                    ? "border-blue-100 bg-white"
                    : message.messageType === "ai_draft"
                      ? "border-violet-100 bg-violet-50"
                      : "border-amber-100 bg-amber-50"
                }`}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold text-gray-700">
                    {incoming
                      ? conversation.contactDisplayName
                      : message.messageType === "ai_draft"
                        ? "AI-черновик"
                        : (message.authorDisplayName ?? "Внутренняя заметка")}
                  </span>
                  <span className="text-[9px] text-gray-400">
                    {formatDate(message.createdAt)}
                  </span>
                  <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 text-[8px] font-semibold text-gray-500 ring-1 ring-gray-200">
                    {message.factStatus}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-5 text-gray-700">
                  {message.body}
                </p>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={submit}
        className="mt-3 rounded-xl border border-gray-200 p-3"
      >
        <div className="mb-2 flex flex-wrap gap-2">
          <select
            value={messageType}
            onChange={(event) =>
              setMessageType(event.target.value as "internal_note" | "ai_draft")
            }
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[10px]"
          >
            <option value="internal_note">Внутренняя заметка</option>
            <option value="ai_draft">AI-черновик</option>
          </select>
          <select
            value={factStatus}
            onChange={(event) =>
              setFactStatus(event.target.value as FactStatus)
            }
            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-[10px]"
          >
            <option value="UNVERIFIED">UNVERIFIED</option>
            <option value="PARTIAL">PARTIAL</option>
            <option value="VERIFIED">VERIFIED</option>
            <option value="CONFLICT">CONFLICT</option>
            <option value="STALE">STALE</option>
          </select>
        </div>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          placeholder="Это останется внутри ArtHello OS и не будет отправлено клиенту"
          className="w-full resize-none rounded-lg border border-gray-200 p-2.5 text-xs leading-5 outline-none focus:border-violet-400"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[9px] leading-4 text-gray-400">
            Исходящей кнопки нет. Сохраняется только внутренняя запись.
          </p>
          <button
            type="submit"
            disabled={saving || !body.trim()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : messageType === "ai_draft" ? (
              <Bot className="h-3 w-3" />
            ) : (
              <MessageSquareText className="h-3 w-3" />
            )}
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

function TaskList({
  tasks,
  savingId,
  onComplete,
}: {
  tasks: InternalAlphaTask[];
  savingId: string | null;
  onComplete: (task: InternalAlphaTask) => void;
}) {
  const open = tasks.filter((task) => task.status === "open");
  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Ближайшие задачи
          </h3>
          <p className="mt-0.5 text-[10px] text-gray-400">
            Задача считается закрытой только после действия сотрудника
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600">
          {open.length}
        </span>
      </div>
      <div className="space-y-2">
        {open.length === 0 ? (
          <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">
            Открытых задач нет
          </div>
        ) : (
          open.slice(0, 8).map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-3 rounded-xl border border-gray-100 p-3"
            >
              <button
                type="button"
                onClick={() => onComplete(task)}
                disabled={savingId === task.id}
                aria-label={`Завершить задачу: ${task.title}`}
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-wait"
              >
                {savingId === task.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800">
                  {task.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px]">
                  <span className="text-gray-400">
                    {task.ownerDisplayName ?? task.ownerRole}
                  </span>
                  <span
                    className={
                      isOverdue(task.dueAt)
                        ? "font-semibold text-rose-600"
                        : "text-gray-400"
                    }
                  >
                    {formatDate(task.dueAt)}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function CreateLeadDialog({
  open,
  saving,
  error,
  clientRequestId,
  onClose,
  onCreate,
}: {
  open: boolean;
  saving: boolean;
  error: string | null;
  clientRequestId: string;
  onClose: () => void;
  onCreate: (input: CreateInternalLeadInput) => void;
}) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const [name, setName] = useState("Новый лид · демо");
  const [intent, setIntent] = useState("Подобрать программу");
  const [owner, setOwner] = useState("Ответственный · демо");
  const [nextAction, setNextAction] = useState("Уточнить возраст и район");
  const [nextActionAt, setNextActionAt] = useState(
    dateTimeInput(tomorrow.toISOString()),
  );
  const [initialMessage, setInitialMessage] = useState(
    "Синтетическое входящее сообщение для проверки рабочего процесса.",
  );
  if (!open) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      clientRequestId,
      contactDisplayName: name,
      channel: "internal",
      source: "Ручной тест",
      intent,
      ownerDisplayName: owner,
      nextAction,
      nextActionAt: new Date(nextActionAt).toISOString(),
      initialMessage,
    });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-950">
              Новый тестовый лид
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Запись сохранится в базе, но не попадёт во внешние системы.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Отображаемое имя
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Запрос
            </span>
            <input
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              required
              className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Ответственный
              </span>
              <input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                required
                className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Срок
              </span>
              <input
                type="datetime-local"
                value={nextActionAt}
                onChange={(event) => setNextActionAt(event.target.value)}
                required
                className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Следующий шаг
            </span>
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              required
              className="h-9 w-full rounded-xl border border-gray-200 px-3 text-xs outline-none focus:border-violet-400"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Тестовое входящее
            </span>
            <textarea
              value={initialMessage}
              onChange={(event) => setInitialMessage(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 p-3 text-xs leading-5 outline-none focus:border-violet-400"
            />
          </label>
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-gray-200 px-3 text-xs font-semibold text-gray-600"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function InternalAlphaWorkspace() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<LeadStage | "ALL">("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [createRequestId, setCreateRequestId] = useState(() =>
    crypto.randomUUID(),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const workspace = useQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: loadInternalAlphaWorkspace,
    retry: false,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });

  const seedMutation = useMutation({
    mutationFn: seedInternalAlpha,
    onSuccess: refresh,
    onError: (error: Error) => setActionError(error.message),
  });

  const createMutation = useMutation({
    mutationFn: createInternalLead,
    onSuccess: async (result) => {
      setCreateOpen(false);
      setActionError(null);
      await refresh();
      setSelectedId(result.conversation.id);
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const updateLeadMutation = useMutation({
    mutationFn: ({
      leadId,
      input,
    }: {
      leadId: string;
      input: UpdateInternalLeadInput;
    }) => updateInternalLead(leadId, input),
    onSuccess: () => {
      setActionError(null);
      void refresh();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const addMessageMutation = useMutation({
    mutationFn: ({
      conversationId,
      input,
    }: {
      conversationId: string;
      input: Parameters<typeof addInternalMessage>[1];
    }) => addInternalMessage(conversationId, input),
    onSuccess: () => {
      setActionError(null);
      void refresh();
    },
    onError: (error: Error) => setActionError(error.message),
  });

  const updateTaskMutation = useMutation({
    mutationFn: (task: InternalAlphaTask) =>
      updateInternalTask(task.id, {
        version: task.version,
        status: "done",
      }),
    onMutate: (task) => setSavingTaskId(task.id),
    onSuccess: () => {
      setActionError(null);
      void refresh();
    },
    onError: (error: Error) => setActionError(error.message),
    onSettled: () => setSavingTaskId(null),
  });

  const conversations = workspace.data?.conversations ?? [];
  const filtered = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          conversation.lead &&
          (stageFilter === "ALL" || conversation.lead.stage === stageFilter),
      ),
    [conversations, stageFilter],
  );
  const selected =
    filtered.find((conversation) => conversation.id === selectedId) ??
    filtered[0] ??
    null;

  if (workspace.isPending) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-gray-100 bg-white">
        <div className="text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-violet-500" />
          <p className="mt-3 text-xs text-gray-400">
            Загружаем внутренний Front Office
          </p>
        </div>
      </div>
    );
  }

  if (workspace.isError) {
    return (
      <ErrorPanel
        message={
          workspace.error instanceof Error
            ? workspace.error.message
            : "Неизвестная ошибка"
        }
        onRetry={() => void workspace.refetch()}
      />
    );
  }

  if (!workspace.data || conversations.length === 0) {
    return (
      <EmptyWorkspace
        loading={seedMutation.isPending}
        onSeed={() => {
          setActionError(null);
          seedMutation.mutate();
        }}
      />
    );
  }

  const stats = workspace.data.stats;
  const selectedTasks = selected
    ? workspace.data.tasks.filter(
        (task) =>
          task.conversationId === selected.id ||
          task.leadId === selected.lead?.id,
      )
    : workspace.data.tasks;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-emerald-950">
                Рабочая внутренняя альфа
              </p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                ARTHELLO
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                DRAFT_ONLY
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-emerald-800">
              Тестовые записи сохраняются в PostgreSQL. Каналы, отправки,
              AlfaCRM и финансовые действия отключены.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setActionError(null);
            setCreateRequestId(crypto.randomUUID());
            setCreateOpen(true);
          }}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
        >
          <Plus className="h-3.5 w-3.5" />
          Новый тестовый лид
        </button>
      </div>

      {actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-400 hover:text-rose-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Активные лиды"
          value={String(stats.activeLeads)}
          note={`${stats.totalLeads} всего в тестовом контуре`}
          icon={<Inbox className="h-4 w-4" />}
          tone="blue"
        />
        <MetricCard
          label="Договор"
          value={String(stats.wonLeads)}
          note="Только результат синтетических сценариев"
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
        />
        <MetricCard
          label="Просроченные задачи"
          value={String(stats.overdueTasks)}
          note="Требуют действия сотрудника"
          icon={<CalendarClock className="h-4 w-4" />}
          tone="rose"
        />
        <MetricCard
          label="Без ответственного"
          value={String(stats.unassignedLeads)}
          note="Целевое значение — ноль"
          icon={<UserRound className="h-4 w-4" />}
          tone="violet"
        />
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex min-w-max gap-1 rounded-xl border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setStageFilter("ALL")}
            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${
              stageFilter === "ALL"
                ? "bg-gray-900 text-white"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            Все · {stats.totalLeads}
          </button>
          {(Object.keys(STAGE_LABELS) as LeadStage[]).map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => setStageFilter(stage)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${
                stageFilter === stage
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {STAGE_LABELS[stage]} · {stats.stageCounts[stage] ?? 0}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)] lg:grid-cols-[310px_1fr]">
        <aside className="border-b border-gray-100 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Лиды</h2>
              <p className="text-[10px] text-gray-400">
                {filtered.length} в выбранном этапе
              </p>
            </div>
            <CircleDot className="h-4 w-4 text-violet-500" />
          </div>
          <div className="max-h-[570px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-gray-400">
                В этом этапе лидов нет
              </p>
            ) : (
              filtered.map((conversation) => (
                <LeadListItem
                  key={conversation.id}
                  conversation={conversation}
                  active={selected?.id === conversation.id}
                  onSelect={() => setSelectedId(conversation.id)}
                />
              ))
            )}
          </div>
        </aside>

        <main className="min-w-0">
          {!selected || !selected.lead ? (
            <div className="flex min-h-[500px] items-center justify-center text-xs text-gray-400">
              Выберите лид
            </div>
          ) : (
            <>
              <header className="border-b border-gray-100 px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-gray-950">
                        {selected.contactDisplayName}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1 ${STAGE_STYLES[selected.lead.stage]}`}
                      >
                        {STAGE_LABELS[selected.lead.stage]}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold text-gray-500">
                        {selected.priority}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {selected.intent ?? "Запрос не определён"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400">
                      <span>
                        {selected.contactPointMasked ?? "Контакт скрыт"}
                      </span>
                      <span>Канал: {selected.channel}</span>
                      <span>
                        Источник: {selected.lead.source ?? "не указан"}
                      </span>
                      <span>ID: {selected.externalKey}</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 text-right">
                    <p className="text-[9px] uppercase tracking-wide text-gray-400">
                      Следующий шаг
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-gray-800">
                      {selected.lead.nextAction ?? "Завершено"}
                    </p>
                    <p
                      className={`mt-0.5 text-[10px] ${
                        isOverdue(selected.lead.nextActionAt)
                          ? "font-semibold text-rose-600"
                          : "text-gray-400"
                      }`}
                    >
                      {formatDate(selected.lead.nextActionAt)}
                    </p>
                  </div>
                </div>
              </header>

              <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[1fr_0.95fr]">
                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <ArrowRight className="h-4 w-4 text-violet-500" />
                    <h3 className="text-sm font-semibold text-gray-900">
                      Управление лидом
                    </h3>
                  </div>
                  <LeadEditor
                    key={`${selected.lead.id}:${selected.lead.version}`}
                    lead={selected.lead}
                    saving={updateLeadMutation.isPending}
                    onSave={(input) =>
                      updateLeadMutation.mutate({
                        leadId: selected.lead!.id,
                        input,
                      })
                    }
                  />

                  <div className="mt-5 border-t border-gray-100 pt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-violet-500" />
                      <h3 className="text-sm font-semibold text-gray-900">
                        Аудит
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {workspace.data.auditEvents
                        .filter(
                          (event) =>
                            event.entityId === selected.lead?.id ||
                            event.entityId === selected.id,
                        )
                        .slice(0, 6)
                        .map((event) => (
                          <div
                            key={event.id}
                            className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2"
                          >
                            <FileClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-medium text-gray-700">
                                {event.action}
                              </p>
                              <p className="mt-0.5 text-[9px] text-gray-400">
                                {event.actorDisplayName ?? event.actorRole} ·{" "}
                                {formatDate(event.createdAt)}
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-violet-500" />
                    <h3 className="text-sm font-semibold text-gray-900">
                      История
                    </h3>
                  </div>
                  <ConversationThread
                    key={`${selected.id}:${selected.messages.length}`}
                    conversation={selected}
                    saving={addMessageMutation.isPending}
                    onAdd={async (input) => {
                      await addMessageMutation.mutateAsync({
                        conversationId: selected.id,
                        input,
                      });
                    }}
                  />
                </section>
              </div>
            </>
          )}
        </main>
      </div>

      <TaskList
        tasks={selectedTasks}
        savingId={savingTaskId}
        onComplete={(task) => updateTaskMutation.mutate(task)}
      />

      <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-3">
        <div className="flex gap-3">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <div>
            <p className="text-xs font-semibold text-gray-900">
              Состояние сохраняется
            </p>
            <p className="mt-1 text-[10px] leading-4 text-gray-500">
              Лиды, задачи, история и версии находятся в PostgreSQL.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <div>
            <p className="text-xs font-semibold text-gray-900">
              AI не отправляет
            </p>
            <p className="mt-1 text-[10px] leading-4 text-gray-500">
              Черновик можно сохранить, но исходящего endpoint нет.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <div>
            <p className="text-xs font-semibold text-gray-900">
              Действия проверяемы
            </p>
            <p className="mt-1 text-[10px] leading-4 text-gray-500">
              Изменения версионируются и записываются в append-only аудит.
            </p>
          </div>
        </div>
      </div>

      <CreateLeadDialog
        open={createOpen}
        saving={createMutation.isPending}
        error={createMutation.isError ? actionError : null}
        clientRequestId={createRequestId}
        onClose={() => setCreateOpen(false)}
        onCreate={(input) => createMutation.mutate(input)}
      />
    </div>
  );
}
