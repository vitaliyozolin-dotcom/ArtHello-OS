import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  GraduationCap,
  Headphones,
  ListChecks,
  Megaphone,
  MessageSquareText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  UserRoundPlus,
} from "lucide-react";
import { FRONT_OFFICE_PREVIEW_CONTRACT } from "@/features/front-office/preview-contract";
import { LeadPreviewDrawer } from "@/features/front-office/lead-preview-drawer";
import {
  PREVIEW_LEADS,
  PREVIEW_LEAD_DETAILS,
  PREVIEW_SERVICE_TICKETS,
  type PreviewLead,
} from "@/features/front-office/preview-data";

type View =
  | "overview"
  | "pipeline"
  | "service"
  | "tasks"
  | "knowledge"
  | "marketing";
type Tone = "violet" | "blue" | "emerald" | "amber" | "rose" | "slate";

const TONE_CLASSES: Record<
  Tone,
  { icon: string; panel: string; text: string; dot: string }
> = {
  violet: {
    icon: "bg-violet-100 text-violet-600",
    panel: "bg-violet-50 border-violet-100",
    text: "text-violet-700",
    dot: "bg-violet-500",
  },
  blue: {
    icon: "bg-blue-100 text-blue-600",
    panel: "bg-blue-50 border-blue-100",
    text: "text-blue-700",
    dot: "bg-blue-500",
  },
  emerald: {
    icon: "bg-emerald-100 text-emerald-600",
    panel: "bg-emerald-50 border-emerald-100",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  amber: {
    icon: "bg-amber-100 text-amber-600",
    panel: "bg-amber-50 border-amber-100",
    text: "text-amber-700",
    dot: "bg-amber-500",
  },
  rose: {
    icon: "bg-rose-100 text-rose-600",
    panel: "bg-rose-50 border-rose-100",
    text: "text-rose-700",
    dot: "bg-rose-500",
  },
  slate: {
    icon: "bg-slate-100 text-slate-600",
    panel: "bg-slate-50 border-slate-100",
    text: "text-slate-700",
    dot: "bg-slate-500",
  },
};

const PIPELINE = [
  { key: "NEW", label: "Новые", count: 8, tone: "blue" as Tone },
  {
    key: "QUALIFIED",
    label: "Квалифицированы",
    count: 5,
    tone: "violet" as Tone,
  },
  {
    key: "PROGRAM_MATCHED",
    label: "Программа подобрана",
    count: 4,
    tone: "amber" as Tone,
  },
  {
    key: "TRIAL_BOOKED",
    label: "Пробное назначено",
    count: 3,
    tone: "emerald" as Tone,
  },
  { key: "WON", label: "Договор", count: 2, tone: "slate" as Tone },
];

const TASKS = [
  {
    title: "Назначить ответственного для AH-DEMO-0044",
    context: "Новый лид без владельца и следующего подтверждённого контакта",
    due: "Сейчас",
    tone: "rose" as Tone,
  },
  {
    title: "Проверить статью о пробном занятии",
    context: "Через 6 дней наступит дата планового пересмотра знания",
    due: "До 01.08",
    tone: "amber" as Tone,
  },
  {
    title: "Разобрать причину потери двух лидов",
    context: "Причина «не удалось связаться» требует проверки follow-up",
    due: "Сегодня",
    tone: "violet" as Tone,
  },
  {
    title: "Подтвердить результат пробного",
    context: "Синтетический сценарий: внешняя запись не создаётся",
    due: "Завтра",
    tone: "blue" as Tone,
  },
];

const KNOWLEDGE = [
  {
    label: "Программы",
    ready: 12,
    total: 12,
    status: "Готово",
    tone: "emerald" as Tone,
  },
  {
    label: "Публичные цены",
    ready: 0,
    total: 8,
    status: "Нужен источник",
    tone: "rose" as Tone,
  },
  {
    label: "Пробные занятия",
    ready: 3,
    total: 4,
    status: "На проверке",
    tone: "amber" as Tone,
  },
  {
    label: "Документы",
    ready: 5,
    total: 5,
    status: "Готово",
    tone: "emerald" as Tone,
  },
  {
    label: "Пропуски и отработки",
    ready: 0,
    total: 6,
    status: "Нет политики",
    tone: "rose" as Tone,
  },
];

const CHANNELS = [
  { label: "Сайт", leads: 9, trials: 4, won: 2 },
  { label: "Рекомендации", leads: 6, trials: 4, won: 2 },
  { label: "Карты", leads: 4, trials: 1, won: 0 },
  { label: "Источник не указан", leads: 3, trials: 0, won: 0 },
];

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
  tone: Tone;
}) {
  const colors = TONE_CLASSES[tone];
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-xl ${colors.icon}`}
        >
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight text-gray-950">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-gray-400">{note}</p>
    </div>
  );
}

function SafetyBanner() {
  return (
    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-emerald-950">
                Безопасный внутренний прототип
              </p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                DRAFT_ONLY
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                SYNTHETIC
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-emerald-800">
              Нет доступа к AlfaCRM, банку и клиентским каналам. Ничего не
              отправляется и не записывается.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] font-semibold text-emerald-800">
          <span className="rounded-lg bg-white/80 px-2 py-1.5">API: 0</span>
          <span className="rounded-lg bg-white/80 px-2 py-1.5">Записи: 0</span>
          <span className="rounded-lg bg-white/80 px-2 py-1.5">
            Отправки: 0
          </span>
        </div>
      </div>
    </div>
  );
}

function LeadsPanel({ onOpen }: { onOpen: (lead: PreviewLead) => void }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Лиды, требующие внимания
          </h2>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Только синтетические карточки для проверки процесса
          </p>
        </div>
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-600">
          1 просрочен
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {PREVIEW_LEADS.map((lead) => (
          <div
            key={lead.id}
            className="grid gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50/70 lg:grid-cols-[1.2fr_1fr_1.3fr_auto] lg:items-center"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-violet-600">
                  {lead.id}
                </span>
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">
                  {lead.stage}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {lead.need}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-400">{lead.area}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Ответственный
              </p>
              <p
                className={`mt-1 text-xs font-medium ${lead.owner === "Не назначен" ? "text-rose-600" : "text-gray-700"}`}
              >
                {lead.owner}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Следующий шаг
              </p>
              <p className="mt-1 text-xs font-medium text-gray-700">
                {lead.next}
              </p>
              <p
                className={`mt-0.5 text-[10px] ${lead.risk === "overdue" ? "font-semibold text-rose-600" : "text-gray-400"}`}
              >
                {lead.due}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen(lead)}
              title="Открыть локальную синтетическую карточку"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100"
            >
              Карточка
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ServicePanel() {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-gray-900">
              Клиентский сервис
            </h2>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Продажная возможность и сервисный тикет остаются разными объектами
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">
            P2: 2
          </span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
            Waiting internal: 2
          </span>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {PREVIEW_SERVICE_TICKETS.map((ticket) => (
          <article
            key={ticket.id}
            className="grid gap-3 px-4 py-3.5 lg:grid-cols-[1.3fr_0.8fr_0.9fr_auto] lg:items-center"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-violet-600">
                  {ticket.id}
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${
                    ticket.priority === "P2"
                      ? "bg-rose-50 text-rose-700"
                      : ticket.priority === "P3"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {ticket.priority}
                </span>
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">
                  {ticket.status}
                </span>
              </div>
              <p className="mt-1.5 text-xs font-semibold text-gray-900">
                {ticket.subject}
              </p>
              <p className="mt-1 text-[10px] font-medium text-gray-400">
                {ticket.intent}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Проверка личности
              </p>
              <p
                className={`mt-1 text-xs font-medium ${
                  ticket.identity === "verified"
                    ? "text-emerald-700"
                    : ticket.identity === "partial"
                      ? "text-amber-700"
                      : "text-gray-600"
                }`}
              >
                {ticket.identity}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Владелец и срок
              </p>
              <p className="mt-1 text-xs font-medium text-gray-700">
                {ticket.owner}
              </p>
              <p className="mt-0.5 text-[10px] text-gray-400">{ticket.due}</p>
            </div>

            <div className="flex flex-col items-start gap-1.5 lg:items-end">
              <span className="text-[10px] font-medium text-emerald-700">
                VERIFIED: {ticket.verifiedFacts}
              </span>
              <span
                className={`text-[10px] font-medium ${
                  ticket.unverifiedClaims > 0
                    ? "text-amber-700"
                    : "text-gray-400"
                }`}
              >
                UNVERIFIED: {ticket.unverifiedClaims}
              </span>
              {ticket.escalation && (
                <span className="mt-1 inline-flex max-w-48 items-start gap-1 rounded-lg bg-rose-50 px-2 py-1 text-right text-[9px] font-semibold leading-3 text-rose-700">
                  <ShieldAlert className="mt-px h-3 w-3 shrink-0" />
                  {ticket.escalation}
                </span>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-[10px] leading-4 text-gray-500">
        Статус <strong>RESOLVED</strong> не означает автоматическое закрытие:
        сначала проверяется результат, открытый риск и обещанный follow-up.
      </div>
    </section>
  );
}

function FunnelPanel() {
  const max = Math.max(...PIPELINE.map((stage) => stage.count));
  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Воронка</h2>
          <p className="mt-0.5 text-[11px] text-gray-400">
            События стадий, а не ручное перетаскивание без истории
          </p>
        </div>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-600">
          Демо-период
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {PIPELINE.map((stage, index) => {
          const colors = TONE_CLASSES[stage.tone];
          return (
            <div
              key={stage.key}
              className={`relative overflow-hidden rounded-xl border p-3 ${colors.panel}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] font-bold tracking-wide ${colors.text}`}
                >
                  {stage.key}
                </span>
                {index < PIPELINE.length - 1 && (
                  <ArrowRight className="hidden h-3.5 w-3.5 text-gray-300 xl:block" />
                )}
              </div>
              <p className="mt-3 text-2xl font-bold text-gray-950">
                {stage.count}
              </p>
              <p className="mt-0.5 min-h-8 text-[11px] leading-4 text-gray-600">
                {stage.label}
              </p>
              <div className="mt-3 h-1.5 rounded-full bg-white/80">
                <div
                  className={`h-1.5 rounded-full ${colors.dot}`}
                  style={{
                    width: `${Math.max(12, (stage.count / max) * 100)}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            NEW → QUALIFIED
          </p>
          <p className="mt-1 text-lg font-bold text-gray-900">62%</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Пробное → посещение
          </p>
          <p className="mt-1 text-lg font-bold text-gray-900">67%</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Без следующего шага
          </p>
          <p className="mt-1 text-lg font-bold text-rose-600">1</p>
        </div>
      </div>
    </section>
  );
}

function TasksPanel() {
  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Очередь действий
        </h2>
        <p className="mt-0.5 text-[11px] text-gray-400">
          Каждая задача имеет причину, владельца и срок
        </p>
      </div>
      <div className="space-y-2">
        {TASKS.map((task) => {
          const colors = TONE_CLASSES[task.tone];
          return (
            <div
              key={task.title}
              className="flex gap-3 rounded-xl border border-gray-100 p-3"
            >
              <div
                className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${colors.dot}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-800">
                  {task.title}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-gray-400">
                  {task.context}
                </p>
              </div>
              <span
                className={`shrink-0 text-[10px] font-semibold ${colors.text}`}
              >
                {task.due}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function KnowledgePanel() {
  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Готовность базы знаний
        </h2>
        <p className="mt-0.5 text-[11px] text-gray-400">
          AI не отвечает фактами без утверждённой версии и источника
        </p>
      </div>
      <div className="space-y-3">
        {KNOWLEDGE.map((item) => {
          const colors = TONE_CLASSES[item.tone];
          const progress =
            item.total === 0 ? 0 : Math.round((item.ready / item.total) * 100);
          return (
            <div key={item.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-gray-700">
                  {item.label}
                </span>
                <span className={`text-[10px] font-semibold ${colors.text}`}>
                  {item.status}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                  <div
                    className={`h-1.5 rounded-full ${colors.dot}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="w-10 text-right text-[10px] font-medium text-gray-400">
                  {item.ready}/{item.total}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MarketingPanel() {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="border-b border-gray-100 px-4 py-3.5">
        <h2 className="text-sm font-semibold text-gray-900">
          Источники и результат
        </h2>
        <p className="mt-0.5 text-[11px] text-gray-400">
          Сначала прозрачная атрибуция, потом рекламная автоматизация
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-2.5">Источник</th>
              <th className="px-4 py-2.5 text-right">Лиды</th>
              <th className="px-4 py-2.5 text-right">Пробные</th>
              <th className="px-4 py-2.5 text-right">Договоры</th>
              <th className="px-4 py-2.5 text-right">Конверсия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {CHANNELS.map((channel) => (
              <tr key={channel.label} className="text-xs text-gray-700">
                <td className="px-4 py-3 font-medium">{channel.label}</td>
                <td className="px-4 py-3 text-right">{channel.leads}</td>
                <td className="px-4 py-3 text-right">{channel.trials}</td>
                <td className="px-4 py-3 text-right">{channel.won}</td>
                <td className="px-4 py-3 text-right font-semibold text-violet-600">
                  {channel.leads
                    ? Math.round((channel.won / channel.leads) * 100)
                    : 0}
                  %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function FrontOfficePage() {
  const [view, setView] = useState<View>("overview");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const selectedLead =
    PREVIEW_LEADS.find((lead) => lead.id === selectedLeadId) ?? null;
  const selectedLeadDetail = selectedLead
    ? PREVIEW_LEAD_DETAILS[selectedLead.id]
    : null;

  const views: { key: View; label: string; icon: ReactNode }[] = [
    {
      key: "overview",
      label: "Рабочий стол",
      icon: <BarChart3 className="h-3.5 w-3.5" />,
    },
    {
      key: "pipeline",
      label: "Воронка",
      icon: <Target className="h-3.5 w-3.5" />,
    },
    {
      key: "service",
      label: "Сервис",
      icon: <Headphones className="h-3.5 w-3.5" />,
    },
    {
      key: "tasks",
      label: "Задачи",
      icon: <ListChecks className="h-3.5 w-3.5" />,
    },
    {
      key: "knowledge",
      label: "Знания",
      icon: <BookOpenCheck className="h-3.5 w-3.5" />,
    },
    {
      key: "marketing",
      label: "Маркетинг",
      icon: <Megaphone className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700">
              Preview
            </span>
            <span className="text-[11px] text-gray-400">
              Только для владельца
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">
            Продажи и клиентский сервис
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-500">
            Путь от нового обращения до пробного и договора — с ответственным,
            следующим шагом, сроком и доказуемым источником фактов.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Создание данных отключено в безопасном прототипе"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gray-200 px-4 text-sm font-semibold text-gray-500 disabled:cursor-not-allowed"
        >
          <UserRoundPlus className="h-4 w-4" />
          Новый лид
        </button>
      </div>

      <SafetyBanner />

      <div className="mb-5 overflow-x-auto">
        <div className="inline-flex min-w-max gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {views.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                view === item.key
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {view === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Новые обращения"
              value="8"
              note="3 ещё не квалифицированы"
              icon={<MessageSquareText className="h-4 w-4" />}
              tone="blue"
            />
            <MetricCard
              label="Пробные назначены"
              value="3"
              note="2 требуют подтверждения сотрудником"
              icon={<GraduationCap className="h-4 w-4" />}
              tone="emerald"
            />
            <MetricCard
              label="Просроченные действия"
              value="1"
              note="Лид без назначенного владельца"
              icon={<CalendarClock className="h-4 w-4" />}
              tone="rose"
            />
            <MetricCard
              label="Знания готовы"
              value="20 / 35"
              note="Цены и отработки пока блокируют AI-факты"
              icon={<BookOpenCheck className="h-4 w-4" />}
              tone="amber"
            />
          </div>

          <LeadsPanel onOpen={(lead) => setSelectedLeadId(lead.id)} />

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <FunnelPanel />
            <TasksPanel />
          </div>

          <ServicePanel />

          <div className="grid gap-4 lg:grid-cols-2">
            <KnowledgePanel />
            <MarketingPanel />
          </div>
        </div>
      )}

      {view === "pipeline" && <FunnelPanel />}
      {view === "service" && <ServicePanel />}
      {view === "tasks" && <TasksPanel />}
      {view === "knowledge" && <KnowledgePanel />}
      {view === "marketing" && <MarketingPanel />}

      <div className="mt-5 grid gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-4 sm:grid-cols-3">
        <div className="flex gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <div>
            <p className="text-xs font-semibold text-violet-950">
              AI только предлагает
            </p>
            <p className="mt-1 text-[11px] leading-4 text-violet-700">
              Классификация, вопросы и черновик без отправки.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <div>
            <p className="text-xs font-semibold text-violet-950">
              Факты требуют источника
            </p>
            <p className="mt-1 text-[11px] leading-4 text-violet-700">
              Цена, наличие и расписание не берутся из памяти.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          <div>
            <p className="text-xs font-semibold text-violet-950">
              Человек принимает решение
            </p>
            <p className="mt-1 text-[11px] leading-4 text-violet-700">
              Деньги, договор, ребёнок и безопасность не автоматизируются.
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[10px] text-gray-400">
        <CircleAlert className="h-3 w-3" />
        Контракт: {FRONT_OFFICE_PREVIEW_CONTRACT.projectId} ·{" "}
        {FRONT_OFFICE_PREVIEW_CONTRACT.autonomyMode} ·{" "}
        {FRONT_OFFICE_PREVIEW_CONTRACT.dataMode}
        <Clock3 className="ml-1 h-3 w-3" />
        Данные не сохраняются
      </p>

      {selectedLead && selectedLeadDetail && (
        <LeadPreviewDrawer
          lead={selectedLead}
          detail={selectedLeadDetail}
          onClose={() => setSelectedLeadId(null)}
        />
      )}
    </div>
  );
}
