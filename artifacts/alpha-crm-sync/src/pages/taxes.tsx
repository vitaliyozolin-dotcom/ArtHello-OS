import { formatRubles } from "@workspace/shared/money";
import { apiFetch } from "@workspace/api-client-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt, AlertTriangle, CheckCircle2, Clock,
  ChevronDown, Loader2, PiggyBank, Calendar, Bot,
  AlertOctagon, Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaxObligation {
  id: string;
  taxType: string;
  taxName: string | null;
  periodMonth: string;
  dueDate: string | null;
  taxBase: string | null;
  taxRate: string | null;
  accruedAmount: string;
  paidAmount: string;
  status: string;
  notes: string | null;
}

interface TaxSummary {
  totalAccrued: number;
  totalPaid: number;
  remaining: number;
  overdueCount: number;
  overdueAmount: number;
  upcoming: TaxObligation[];
  reserveBalance: number;
  currentReserveMonth: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return formatRubles(n);
}

function monthLabel(m: string) {
  if (!m) return m;
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("ru-RU", { month: "long", year: "numeric" });
}

const TAX_TYPE_COLORS: Record<string, string> = {
  usn: "bg-violet-100 text-violet-700",
  ndfl: "bg-blue-100 text-blue-700",
  nds: "bg-cyan-100 text-cyan-700",
  pfr: "bg-amber-100 text-amber-700",
  fss: "bg-orange-100 text-orange-700",
  other: "bg-gray-100 text-gray-600",
};

const STATUS_STYLES: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  accrued: { label: "Начислен", cls: "text-amber-600 bg-amber-50 border-amber-200", icon: <Clock className="w-3 h-3" /> },
  partial: { label: "Частично", cls: "text-blue-600 bg-blue-50 border-blue-200", icon: <Clock className="w-3 h-3" /> },
  paid: { label: "Уплачен", cls: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  overdue: { label: "Просрочен", cls: "text-red-600 bg-red-50 border-red-200", icon: <AlertTriangle className="w-3 h-3" /> },
  cancelled: { label: "Отменён", cls: "text-gray-400 bg-gray-50 border-gray-200", icon: null },
};

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, alert }: { label: string; value: string; sub?: string; icon: React.ReactNode; alert?: boolean }) {
  return (
    <div className={`bg-white rounded-[22px] border shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5 flex items-start gap-4 ${alert ? "border-red-200" : "border-black/[0.06]"}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${alert ? "bg-red-50" : "bg-[#F7F8FB]"}`}>{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className={`text-2xl font-bold leading-none mt-0.5 ${alert ? "text-red-500" : "text-gray-900"}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Tax row ──────────────────────────────────────────────────────────────────

function TaxRow({ tax, onPay }: { tax: TaxObligation; onPay: (id: string, amount: number) => void }) {
  const accrued = parseFloat(tax.accruedAmount);
  const paid = parseFloat(tax.paidAmount);
  const remaining = accrued - paid;
  const paidPct = accrued > 0 ? Math.min(100, Math.round((paid / accrued) * 100)) : 0;
  const st = STATUS_STYLES[tax.status] ?? STATUS_STYLES["accrued"];
  const isOverdue = tax.dueDate && new Date(tax.dueDate) < new Date() && tax.status !== "paid";

  return (
    <div className={`p-4 flex items-center gap-4 ${isOverdue ? "bg-red-50/50" : ""}`}>
      {/* Tax type badge */}
      <span className={`text-[10px] px-2 py-1 rounded-lg font-bold shrink-0 ${TAX_TYPE_COLORS[tax.taxType] ?? TAX_TYPE_COLORS["other"]}`}>
        {tax.taxType.toUpperCase()}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-800 truncate">{tax.taxName ?? tax.taxType}</p>
          {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-xs text-gray-400">{monthLabel(tax.periodMonth)}</p>
          {tax.dueDate && <p className="text-xs text-gray-400">срок: {tax.dueDate}</p>}
        </div>
        {/* Progress bar */}
        {tax.status !== "paid" && accrued > 0 && (
          <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
          </div>
        )}
      </div>

      {/* Amounts */}
      <div className="text-right shrink-0 space-y-0.5">
        <p className="text-sm font-bold text-gray-900">{fmt(accrued)}</p>
        {remaining > 0.01 && <p className="text-xs text-red-500">остаток: {fmt(remaining)}</p>}
      </div>

      {/* Status */}
      <span className={`text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 shrink-0 ${st.cls}`}>
        {st.icon}{st.label}
      </span>

      {/* Pay button */}
      {tax.status !== "paid" && tax.status !== "cancelled" && (
        <button
          onClick={() => onPay(tax.id, accrued)}
          className="shrink-0 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 font-medium"
        >
          Уплатить
        </button>
      )}
    </div>
  );
}

// ─── Tax Calendar View ────────────────────────────────────────────────────────

interface CalendarMonth {
  month: string;
  taxes: Array<{ taxType: string; taxName: string | null; status: string | null; accrued: string | null; paid: string | null; dueDate: string | null }>;
  totalAccrued: number;
  totalPaid: number;
  hasOverdue: boolean;
  allPaid: boolean;
}

function TaxCalendarView() {
  const { data: months = [], isLoading } = useQuery<CalendarMonth[]>({
    queryKey: ["taxes-calendar"],
    queryFn: () => apiFetch("/api/taxes/calendar").then((r) => r.json()),
  });

  const fmtShort = (n: number) => new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 0 }).format(n);
  const fmtFull = (n: number) => formatRubles(n);

  function mlabel(m: string) {
    const [y, mo] = m.split("-");
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("ru-RU", { month: "long", year: "2-digit" });
  }

  const statusColor: Record<string, string> = {
    paid:      "bg-emerald-100 text-emerald-700",
    partial:   "bg-blue-100 text-blue-700",
    accrued:   "bg-gray-100 text-gray-600",
    overdue:   "bg-red-100 text-red-600",
    cancelled: "bg-gray-50 text-gray-400",
  };

  const statusLabel: Record<string, string> = {
    paid: "Уплачен", partial: "Частично", accrued: "Начислен", overdue: "Просрочен", cancelled: "Отменён",
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-violet-400" /></div>;
  }

  if (months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Calendar className="w-12 h-12 text-gray-200 mb-3" />
        <p className="text-sm font-semibold text-gray-600">Нет налоговых данных</p>
        <p className="text-xs text-gray-400 mt-1">Загрузите тестовые данные или добавьте налог</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {months.map((m) => (
        <div key={m.month} className={`bg-white rounded-[22px] border shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden ${m.hasOverdue ? "border-red-200" : m.allPaid ? "border-emerald-100" : "border-black/[0.06]"}`}>
          {/* Month header */}
          <div className={`flex items-center justify-between px-5 py-3.5 ${m.hasOverdue ? "bg-red-50" : m.allPaid ? "bg-emerald-50" : "bg-gray-50"}`}>
            <div className="flex items-center gap-2">
              <Calendar className={`w-4 h-4 ${m.hasOverdue ? "text-red-500" : m.allPaid ? "text-emerald-500" : "text-gray-400"}`} />
              <span className="text-sm font-bold text-gray-900 capitalize">{mlabel(m.month)}</span>
              {m.hasOverdue && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Просрочено</span>}
              {m.allPaid && !m.hasOverdue && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">✓ Всё уплачено</span>}
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Начислено: <span className="font-bold text-gray-800">{fmtShort(m.totalAccrued)}</span></p>
              <p className="text-xs text-gray-400">Уплачено: {fmtShort(m.totalPaid)}</p>
            </div>
          </div>

          {/* Tax rows */}
          <div className="divide-y divide-black/[0.04]">
            {m.taxes.map((t, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3 group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{t.taxName ?? t.taxType}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor[t.status ?? "accrued"] ?? statusColor.accrued}`}>
                      {statusLabel[t.status ?? "accrued"] ?? t.status}
                    </span>
                  </div>
                  {t.dueDate && <p className="text-xs text-gray-400 mt-0.5">Срок: {t.dueDate}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-800">{t.accrued ? fmtFull(parseFloat(t.accrued)) : "—"}</p>
                  {t.paid && parseFloat(t.paid) > 0 && (
                    <p className="text-xs text-emerald-500">уплачено: {fmtShort(parseFloat(t.paid))}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tax Advisor View ─────────────────────────────────────────────────────────

interface AdvisorRec {
  type: "danger" | "warning" | "info" | "ok";
  title: string;
  body: string;
  action?: string;
}

interface AdvisorData {
  recommendations: AdvisorRec[];
  stats: { total: number; paid: number; overdue: number; upcoming: number; compliance: number; totalReserve: number };
}

function TaxAdvisorView() {
  const { data, isLoading } = useQuery<AdvisorData>({
    queryKey: ["taxes-advisor"],
    queryFn: () => apiFetch("/api/taxes/advisor").then((r) => r.json()),
  });

  const recConfig: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
    danger:  { bg: "bg-red-50",    border: "border-red-200",    icon: <AlertOctagon className="w-5 h-5 text-red-500 shrink-0 mt-0.5" /> },
    warning: { bg: "bg-amber-50",  border: "border-amber-200",  icon: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" /> },
    info:    { bg: "bg-blue-50",   border: "border-blue-200",   icon: <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" /> },
    ok:      { bg: "bg-emerald-50", border: "border-emerald-200", icon: <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" /> },
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-violet-400" /></div>;
  }

  const s = data?.stats;

  return (
    <div className="space-y-5">
      {/* Stats */}
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Соответствие", value: `${s.compliance}%`, color: s.compliance >= 80 ? "text-emerald-600" : "text-amber-500" },
            { label: "Уплачено", value: `${s.paid} из ${s.total}`, color: "text-gray-800" },
            { label: "Просрочено", value: s.overdue, color: s.overdue > 0 ? "text-red-500" : "text-gray-800" },
            { label: "На этой неделе", value: s.upcoming, color: s.upcoming > 0 ? "text-amber-600" : "text-gray-800" },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5">
              <p className="text-xs font-medium text-gray-400 mb-2">{c.label}</p>
              <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      <div className="space-y-3">
        {(data?.recommendations ?? []).map((rec, i) => {
          const cfg = recConfig[rec.type] ?? recConfig.info;
          return (
            <div key={i} className={`flex items-start gap-3 ${cfg.bg} border ${cfg.border} rounded-[18px] p-4`}>
              {cfg.icon}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{rec.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{rec.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI badge */}
      <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
        <Bot className="w-3.5 h-3.5" />
        <span>Рекомендации сформированы на основе данных в системе</span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TaxesPage() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [activeTab, setActiveTab] = useState<"obligations" | "calendar" | "advisor">("obligations");
  const [month, setMonth] = useState(defaultMonth);
  const [statusFilter, setStatusFilter] = useState("");
  const qc = useQueryClient();

  const { data: months = [] } = useQuery<string[]>({
    queryKey: ["taxes-months"],
    queryFn: () => apiFetch("/api/taxes/months").then((r) => r.json()),
  });

  const { data: summary } = useQuery<TaxSummary>({
    queryKey: ["taxes-summary"],
    queryFn: () => apiFetch("/api/taxes/summary").then((r) => r.json()),
  });

  const { data: obligations = [], isLoading } = useQuery<TaxObligation[]>({
    queryKey: ["taxes-obligations", month, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (month) p.set("month", month);
      if (statusFilter) p.set("status", statusFilter);
      return apiFetch(`/api/taxes/obligations?${p}`).then((r) => r.json());
    },
  });

  const payMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const res = await apiFetch(`/api/taxes/obligations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidAmount: amount, status: "paid" }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taxes-obligations"] });
      qc.invalidateQueries({ queryKey: ["taxes-summary"] });
    },
  });

  const allMonths = [...new Set([defaultMonth, ...months])].sort((a, b) => b.localeCompare(a));

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Налоги</h1>
          <p className="text-sm text-gray-400 mt-0.5">Налоговый календарь и резерв</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-black/[0.06] -mb-2">
        {[
          { key: "obligations" as const, label: "📋 Обязательства" },
          { key: "calendar" as const, label: "📅 Календарь" },
          { key: "advisor" as const, label: "🤖 AI-советник" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === t.key ? "text-violet-600 border-violet-500" : "text-gray-400 border-transparent hover:text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Calendar tab */}
      {activeTab === "calendar" && <TaxCalendarView />}

      {/* Advisor tab */}
      {activeTab === "advisor" && <TaxAdvisorView />}

      {/* Obligations tab content */}
      {activeTab !== "calendar" && activeTab !== "advisor" && <>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Начислено всего"
          value={fmt(summary?.totalAccrued ?? 0)}
          icon={<Receipt className="w-5 h-5 text-violet-500" />}
        />
        <StatCard
          label="Уплачено"
          value={fmt(summary?.totalPaid ?? 0)}
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
          sub={`осталось: ${fmt(summary?.remaining ?? 0)}`}
        />
        <StatCard
          label="Просрочено"
          value={fmt(summary?.overdueAmount ?? 0)}
          sub={`${summary?.overdueCount ?? 0} обязательств`}
          icon={<AlertTriangle className="w-5 h-5 text-red-400" />}
          alert={(summary?.overdueCount ?? 0) > 0}
        />
        <StatCard
          label="Налоговый резерв"
          value={fmt(summary?.reserveBalance ?? 0)}
          icon={<PiggyBank className="w-5 h-5 text-amber-500" />}
          sub={summary?.currentReserveMonth ? `за ${monthLabel(summary.currentReserveMonth)}` : undefined}
        />
      </div>

      {/* Upcoming payments */}
      {(summary?.upcoming ?? []).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-[22px] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-800">Предстоящие платежи</h2>
          </div>
          <div className="space-y-2">
            {(summary?.upcoming ?? []).map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <span className="text-amber-700">{t.taxName ?? t.taxType} · {t.dueDate}</span>
                <span className="font-bold text-amber-900">{fmt(parseFloat(t.accruedAmount))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + table */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="p-4 border-b border-black/[0.04] flex items-center gap-3">
          <div className="relative">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="appearance-none bg-[#F7F8FB] border border-gray-200 rounded-xl pl-4 pr-8 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 cursor-pointer"
            >
              <option value="">Все месяцы</option>
              {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 text-gray-600"
          >
            <option value="">Все статусы</option>
            <option value="accrued">Начислен</option>
            <option value="partial">Частично</option>
            <option value="paid">Уплачен</option>
            <option value="overdue">Просрочен</option>
          </select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
        ) : obligations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Receipt className="w-12 h-12 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-600">Налоги не найдены</p>
            <p className="text-xs text-gray-400 mt-1">Загрузите тестовые данные или добавьте налог</p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {obligations.map((t) => (
              <TaxRow
                key={t.id}
                tax={t}
                onPay={(id, amount) => payMutation.mutate({ id, amount })}
              />
            ))}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
