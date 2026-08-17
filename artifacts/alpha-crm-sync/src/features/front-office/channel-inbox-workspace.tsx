import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Inbox,
  Loader2,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import {
  loadChannelInbox,
  loadSmsVizitkaStatus,
  type ChannelInboxConversation,
} from "./channel-inbox-client";

const STATUS_QUERY_KEY = ["front-office", "smsvizitka", "status"];
const INBOX_QUERY_KEY = ["front-office", "smsvizitka", "inbox"];

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  whatsapp_business: "WhatsApp Business",
  max: "MAX",
  telegram_bot: "Telegram-бот",
  sms: "SMS",
  viber: "Viber",
  vk: "VK",
  vk_messenger: "VK Мессенджер",
  unknown: "Канал не определён",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function StatusCard({
  title,
  value,
  note,
  tone,
}: {
  title: string;
  value: string;
  note: string;
  tone: "violet" | "emerald" | "amber";
}) {
  const styles = {
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
  };
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-gray-950">{value}</p>
      <span className={"mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ring-1 " + styles[tone]}>
        {note}
      </span>
    </div>
  );
}

function SetupPanel({ webhookPath }: { webhookPath: string }) {
  const steps = [
    "Создать аккаунт в СМС-Визитке и подключить облачные WhatsApp, MAX или Telegram-бот.",
    "Добавить в секреты системы SMSVIZITKA_WEBHOOK_TOKEN и FRONT_OFFICE_PHONE_MATCH_SECRET.",
    "В кабинете СМС-Визитки выбрать CRM «Другое» и указать защищённый Webhook.",
    "Включить SMSVIZITKA_SHADOW_ENABLED=true только для тестового контура.",
  ];
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-amber-950">Канал подготовлен, подключение ещё не активировано</h2>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
              SHADOW
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Сообщения не принимаются и не отправляются, пока не заданы секреты и отдельный флаг включения.
          </p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-2 rounded-xl bg-white/80 p-3 text-[11px] leading-4 text-amber-900">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 break-all rounded-xl bg-amber-100/80 px-3 py-2 font-mono text-[10px] text-amber-900">
            {webhookPath}
          </p>
        </div>
      </div>
    </section>
  );
}

function ConversationListItem({
  conversation,
  active,
  onSelect,
}: {
  conversation: ChannelInboxConversation;
  active: boolean;
  onSelect: () => void;
}) {
  const last = conversation.messages.at(-1);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "w-full border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 " +
        (active ? "bg-violet-50" : "bg-white hover:bg-gray-50")
      }
    >
      <div className="flex items-start gap-3">
        <div className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " + (active ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500")}>
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-xs font-semibold text-gray-900">{conversation.contact_display_name}</p>
            <span className="shrink-0 text-[9px] text-gray-400">{formatDate(conversation.last_message_at)}</span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-gray-400">{conversation.contact_point_masked ?? "Телефон скрыт"}</p>
          <p className="mt-1 truncate text-[11px] text-gray-600">{last?.body ?? "Нет сообщений"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-semibold text-violet-700 ring-1 ring-violet-200">
              {CHANNEL_LABELS[conversation.channel] ?? conversation.channel}
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
              Проверка личности: {conversation.identity_status}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function ConversationThread({ conversation }: { conversation: ChannelInboxConversation }) {
  return (
    <section className="flex min-h-[480px] flex-col rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="border-b border-gray-100 px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{conversation.contact_display_name}</h2>
            <p className="mt-0.5 text-[11px] text-gray-400">
              {CHANNEL_LABELS[conversation.channel] ?? conversation.channel} · {conversation.contact_point_masked ?? "Телефон скрыт"}
            </p>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
            SHADOW · только чтение
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {conversation.messages.map((message) => (
          <article key={message.id} className="max-w-[86%] rounded-2xl rounded-tl-md bg-gray-100 px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold text-gray-600">
                {message.author_display_name ?? "Клиент"}
              </span>
              <span className="text-[9px] text-gray-400">{formatDate(message.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-800">{message.body}</p>
          </article>
        ))}
      </div>
      <div className="border-t border-gray-100 bg-gray-50 p-4">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-400">
          <Send className="h-4 w-4" />
          Ответ клиенту будет включён только после теста сопоставления и отдельного разрешения
        </div>
      </div>
    </section>
  );
}

export function ChannelInboxWorkspace() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: loadSmsVizitkaStatus,
    staleTime: 30_000,
  });
  const inboxQuery = useQuery({
    queryKey: INBOX_QUERY_KEY,
    queryFn: loadChannelInbox,
    enabled: statusQuery.data?.shadowEnabled === true,
    refetchInterval: statusQuery.data?.shadowEnabled ? 15_000 : false,
  });

  const selected = useMemo(() => {
    const conversations = inboxQuery.data?.conversations ?? [];
    return conversations.find((item) => item.id === selectedId) ?? conversations[0] ?? null;
  }, [inboxQuery.data?.conversations, selectedId]);

  if (statusQuery.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-2xl border border-gray-100 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
      </div>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />
          <div>
            <h2 className="text-sm font-semibold text-rose-950">Не удалось проверить канал</h2>
            <p className="mt-1 text-xs text-rose-800">{statusQuery.error instanceof Error ? statusQuery.error.message : "Неизвестная ошибка"}</p>
            <button type="button" onClick={() => statusQuery.refetch()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
              <RefreshCw className="h-3.5 w-3.5" /> Проверить снова
            </button>
          </div>
        </div>
      </div>
    );
  }

  const status = statusQuery.data;
  if (!status.configured || !status.shadowEnabled) {
    return <SetupPanel webhookPath={status.webhookPath} />;
  }

  const data = inboxQuery.data;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-emerald-950">Единый канал включён в безопасном режиме</p>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">SHADOW</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">OUTBOUND OFF</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-emerald-800">
                Входящие сохраняются в Front Office, полный номер не показывается, ответы клиентам заблокированы.
              </p>
            </div>
          </div>
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusCard title="Диалоги" value={String(data?.stats.conversations ?? 0)} note="реальные входящие" tone="violet" />
        <StatusCard title="События за 7 дней" value={String(data?.stats.eventsLast7Days ?? 0)} note="с дедупликацией" tone="emerald" />
        <StatusCard title="Исходящие" value="0" note="заблокированы" tone="amber" />
      </div>

      {inboxQuery.isLoading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-gray-100 bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
        </div>
      ) : (data?.conversations.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/60 px-6 py-12 text-center">
          <Inbox className="mx-auto h-10 w-10 text-violet-400" />
          <h2 className="mt-4 text-base font-semibold text-violet-950">Канал готов и ждёт первое тестовое сообщение</h2>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-violet-700">
            Отправьте сообщение на подключённый канал. Оно появится здесь автоматически; повторные webhook-события не создадут дублей.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3.5">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Все входящие</h2>
                <p className="mt-0.5 text-[11px] text-gray-400">WhatsApp, MAX, Telegram и SMS</p>
              </div>
              <Smartphone className="h-4 w-4 text-violet-600" />
            </div>
            <div className="max-h-[620px] overflow-y-auto">
              {data?.conversations.map((conversation) => (
                <ConversationListItem
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === selected?.id}
                  onSelect={() => setSelectedId(conversation.id)}
                />
              ))}
            </div>
          </section>
          {selected && <ConversationThread conversation={selected} />}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[10px] text-gray-400">
        <Clock3 className="h-3 w-3" />
        Обновление каждые 15 секунд ·
        <LockKeyhole className="h-3 w-3" />
        номер хранится как маска и криптографический отпечаток
      </p>
    </div>
  );
}
