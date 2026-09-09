import { formatRubles } from "@workspace/shared/money";
import { apiFetch } from "@workspace/api-client-react";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  TrendingUp, TrendingDown, ChevronDown, Minus,
  ChevronRight, Info, Loader2, Shield, BarChart3, Percent,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  month: string | null;
  revenue: number;
  expenses: number;
  grossProfit: number;
  ebitda: number;
  margin: number;
  trustScore: number;
  totalOps: number;
  withoutArticle: number;
}

interface ArticleRow { code: string; name: string; amount: number; count: number }
interface Group { groupName: string; total: number; articles: ArticleRow[] }
interface Breakdown { income: Group[]; expense: Group[] }

interface TrendRow { month: string; revenue: number; expenses: number; grossProfit: number; margin: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return formatRubles(n);
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function monthLabel(m: string) {
  if (!m) return m;
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("ru-RU", { month: "long", year: "numeric" });
}

function shortMonth(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("ru-RU", { month: "short" });
}

// ─── MetricRow — full-width row like Операции list item ───────────────────────

function MetricRow({
  Icon, label, value, sub, color = "gray",
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  color?: "green" | "red" | "violet" | "blue" | "gray";
}) {
  const bg: Record<string, string> = {
    green: "bg-emerald-50", red: "bg-red-50", violet: "bg-violet-50",
    blue: "bg-blue-50", gray: "bg-gray-100",
  };
  const ic: Record<string, string> = {
    green: "text-emerald-600", red: "text-red-500", violet: "text-violet-600",
    blue: "text-blue-600", gray: "text-gray-500",
  };
  const vc: Record<string, string> = {
    green: "text-emerald-600", red: "text-red-500", violet: "text-violet-600",
    blue: "text-blue-600", gray: "text-gray-900",
  };
  return (
    <div className="bg-white rounded-[16px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] flex items-center px-4 py-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mr-3 ${bg[color]}`}>
        <Icon className={`w-4 h-4 ${ic[color]}`} />
      </div>
      <span className="text-[14px] font-medium text-gray-700 flex-1">{label}</span>
      <div className="text-right">
        <div className={`text-[17px] font-bold tabular-nums leading-tight ${vc[color]}`}>{value}</div>
        {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Breakdown group ──────────────────────────────────────────────────────────

function BreakdownGroup({ group, direction }: { group: Group; direction: "in" | "out" }) {
  const [open, setOpen] = useState(false);
  const color = direction === "in" ? "text-emerald-600" : "text-red-500";

  return (
    <div className="border-b border-black/[0.04] last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2.5 px-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="text-[13px] font-medium text-gray-700">{group.groupName}</span>
        </div>
        <span className={`text-[13px] font-bold tabular-nums ${color}`}>{fmt(group.total)}</span>
      </button>
      {open && (
        <div className="pb-2 pl-8 pr-4 space-y-1">
          {group.articles.map((a) => (
            <div key={a.code || a.name} className="flex items-center justify-between text-xs py-1">
              <span className="text-gray-500 truncate pr-4">{a.name}</span>
              <span className="text-gray-700 font-medium tabular-nums shrink-0">{fmt(a.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-black/[0.08] rounded-xl shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-gray-600 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="text-gray-400">{p.name}</span>
          <span className="font-bold text-gray-800">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PnlPage({ embedded = false }: { embedded?: boolean } = {}) {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);

  const { data: months = [] } = useQuery<string[]>({
    queryKey: ["pnl-months"],
    queryFn: () => apiFetch("/api/pnl/months").then((r) => r.json()),
  });

  const { data: summary, isLoading: sumLoading } = useQuery<Summary>({
    queryKey: ["pnl-summary", month],
    queryFn: () => apiFetch(`/api/pnl/summary?month=${month}`).then((r) => r.json()),
  });

  const { data: breakdown, isLoading: bdLoading } = useQuery<Breakdown>({
    queryKey: ["pnl-breakdown", month],
    queryFn: () => apiFetch(`/api/pnl/breakdown?month=${month}`).then((r) => r.json()),
  });

  const { data: trend = [] } = useQuery<TrendRow[]>({
    queryKey: ["pnl-trend"],
    queryFn: () => apiFetch("/api/pnl/trend?months=12").then((r) => r.json()),
  });

  const monthOptions = useMemo(() => {
    const all = [...months];
    if (!all.includes(defaultMonth)) all.unshift(defaultMonth);
    return all;
  }, [months, defaultMonth]);

  const gp = summary?.grossProfit ?? 0;
  const gpColor = gp >= 0 ? "green" : "red";

  const chartData = trend.map((t) => ({
    month: shortMonth(t.month),
    Выручка: Math.round(t.revenue),
    Расходы: Math.round(t.expenses),
    "Вал. прибыль": Math.round(t.grossProfit),
  }));

  const outerCls = embedded
    ? "space-y-2"
    : "px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto space-y-2";

  return (
    <div className={outerCls}>
      {/* Header — standalone only */}
      {!embedded && (
        <div>
          <h2 className="text-[18px] font-bold text-gray-900 leading-tight">ОПиУ</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Отчёт о прибылях и убытках · по месяцу начисления</p>
        </div>
      )}

      {/* Trust Score + month selector — always, as white card */}
      <div className="bg-white rounded-[16px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] flex items-center gap-2 px-4 py-2.5">
        <Shield className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="text-[13px] font-semibold text-violet-700 flex-1 min-w-0 truncate">
          Trust Score {summary?.trustScore ?? '—'}%
          {(summary?.withoutArticle ?? 0) > 0 && (
            <span className="text-[11px] text-gray-400 font-normal"> · {summary?.withoutArticle} без статьи</span>
          )}
        </span>
        <div className="relative shrink-0">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="appearance-none bg-transparent border border-gray-200 rounded-lg pl-2 pr-6 py-1 text-[12px] font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 cursor-pointer"
          >
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* KPI metric rows */}
      {sumLoading ? (
        <div className="flex items-center justify-center h-20">
          <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
        </div>
      ) : (
        <div className="space-y-1.5">
          <MetricRow
            Icon={TrendingUp}
            label="Выручка"
            value={fmt(summary?.revenue ?? 0)}
            color="green"
          />
          <MetricRow
            Icon={TrendingDown}
            label="Расходы"
            value={fmt(summary?.expenses ?? 0)}
            color="red"
          />
          <MetricRow
            Icon={Minus}
            label="Валовая прибыль"
            value={fmt(gp)}
            color={gpColor}
          />
          <MetricRow
            Icon={BarChart3}
            label="EBITDA"
            value={fmt(summary?.ebitda ?? 0)}
            color={(summary?.ebitda ?? 0) >= 0 ? "violet" : "red"}
          />
          <MetricRow
            Icon={Percent}
            label="Маржинальность"
            value={pct(summary?.margin ?? 0)}
            sub={`${summary?.totalOps ?? 0} операций`}
            color={(summary?.margin ?? 0) >= 0.2 ? "green" : (summary?.margin ?? 0) >= 0 ? "blue" : "red"}
          />
        </div>
      )}

      {/* Trend chart */}
      {trend.length > 0 && (
        <div className="bg-white rounded-[16px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-4">
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[12px] font-semibold text-gray-600">Динамика за 12 месяцев</p>
            <div className="flex items-center gap-2.5 ml-auto">
              {[["#10b981","Выручка"],["#fca5a5","Расходы"],["#8b5cf6","Прибыль"]].map(([c, l]) => (
                <span key={l} className="flex items-center gap-1 text-[10px] text-gray-400">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}к`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="Выручка" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Расходы" fill="#fca5a5" radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Вал. прибыль" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Breakdown */}
      {bdLoading ? (
        <div className="flex items-center justify-center h-14">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <div className="bg-white rounded-[16px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-black/[0.04] flex items-center justify-between">
              <h3 className="text-[12px] font-semibold text-gray-700">Доходы</h3>
              <span className="text-[12px] font-bold text-emerald-600">{fmt(summary?.revenue ?? 0)}</span>
            </div>
            <div>
              {(breakdown?.income ?? []).length === 0
                ? <p className="text-[11px] text-gray-400 p-4 text-center">Нет доходов за период</p>
                : (breakdown?.income ?? []).map((g) => <BreakdownGroup key={g.groupName} group={g} direction="in" />)}
            </div>
          </div>

          <div className="bg-white rounded-[16px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-black/[0.04] flex items-center justify-between">
              <h3 className="text-[12px] font-semibold text-gray-700">Расходы</h3>
              <span className="text-[12px] font-bold text-red-500">{fmt(summary?.expenses ?? 0)}</span>
            </div>
            <div>
              {(breakdown?.expense ?? []).length === 0
                ? <p className="text-[11px] text-gray-400 p-4 text-center">Нет расходов за период</p>
                : (breakdown?.expense ?? []).map((g) => <BreakdownGroup key={g.groupName} group={g} direction="out" />)}
            </div>
          </div>
        </div>
      )}

      {/* Note */}
      <div className="flex items-start gap-2 text-[11px] text-gray-400 bg-gray-50 rounded-xl p-3">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          ОПиУ использует <strong className="text-gray-600">дату начисления</strong> (plMonth), а не дату движения денег.
        </span>
      </div>
    </div>
  );
}
