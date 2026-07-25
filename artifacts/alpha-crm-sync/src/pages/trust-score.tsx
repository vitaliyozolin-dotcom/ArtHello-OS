import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Shield, ShieldAlert, ShieldCheck, ChevronDown,
  AlertTriangle, FileWarning, DollarSign, Loader2,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthScore {
  month: string;
  score: number;
  totalOps: number;
  issues: { noArticle: number; unverified: number; highAmount: number };
}

interface Issue {
  id: string;
  description: string | null;
  amount: string;
  direction: string;
  cashflowDate: string;
  plMonth: string;
  issue: string;
}

interface IssuesData { month: string | null; total: number; issues: Issue[] }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

function monthLabel(m: string) {
  if (!m) return m;
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("ru-RU", { month: "short", year: "2-digit" });
}

function scoreColor(s: number) {
  if (s >= 90) return "text-emerald-600";
  if (s >= 70) return "text-amber-600";
  return "text-red-500";
}

function scoreBg(s: number) {
  if (s >= 90) return "bg-emerald-50 border-emerald-200";
  if (s >= 70) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 90 ? "#10b981" : score >= 70 ? "#f59e0b" : "#ef4444";
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#f3f4f6" strokeWidth="10" />
      <circle
        cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={c} strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text x="60" y="56" textAnchor="middle" fontSize="24" fontWeight="bold" fill={color}>{score}</text>
      <text x="60" y="72" textAnchor="middle" fontSize="10" fill="#9ca3af">/ 100</text>
    </svg>
  );
}

const ISSUE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  no_article: { label: "Нет статьи", icon: <FileWarning className="w-3.5 h-3.5" />, color: "text-amber-600 bg-amber-50 border-amber-200" },
  unverified: { label: "Не верифицирована", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-red-500 bg-red-50 border-red-200" },
  high_amount: { label: "Крупная сумма", icon: <DollarSign className="w-3.5 h-3.5" />, color: "text-purple-600 bg-purple-50 border-purple-200" },
};

// ─── Custom chart tooltip ─────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.[0]) return null;
  const score = payload[0].value;
  return (
    <div className="bg-white border border-black/[0.08] rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-600 mb-1">{label}</p>
      <p className={`font-bold text-base ${scoreColor(score)}`}>Trust Score: {score}%</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TrustScorePage() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  const { data: monthly = [], isLoading: monthlyLoading } = useQuery<MonthScore[]>({
    queryKey: ["trust-monthly"],
    queryFn: () => fetch("/api/trust-score/monthly?months=12").then((r) => r.json()),
  });

  const { data: issuesData, isLoading: issuesLoading } = useQuery<IssuesData>({
    queryKey: ["trust-issues", selectedMonth],
    queryFn: () => fetch(`/api/trust-score/issues?month=${selectedMonth}`).then((r) => r.json()),
  });

  const currentMonth = monthly.find((m) => m.month === selectedMonth);
  const chartData = monthly.map((m) => ({ month: monthLabel(m.month), score: m.score, fullMonth: m.month }));
  const avgScore = monthly.length > 0 ? Math.round(monthly.reduce((s, m) => s + m.score, 0) / monthly.length) : 0;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trust Score</h1>
          <p className="text-sm text-gray-400 mt-0.5">Достоверность и качество финансовых данных</p>
        </div>
        <div className="relative">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="appearance-none bg-white border border-gray-200 rounded-xl pl-4 pr-8 py-2.5 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            {monthly.map((m) => (
              <option key={m.month} value={m.month}>
                {new Date(m.month + "-01").toLocaleString("ru-RU", { month: "long", year: "numeric" })}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {monthlyLoading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
      ) : (
        <>
          {/* Score + issues summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Gauge */}
            <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6 flex flex-col items-center justify-center gap-2">
              <p className="text-xs text-gray-400 font-medium">Trust Score · {selectedMonth}</p>
              <ScoreGauge score={currentMonth?.score ?? 0} />
              <p className={`text-sm font-semibold ${scoreColor(currentMonth?.score ?? 0)}`}>
                {(currentMonth?.score ?? 0) >= 90 ? "Отличное качество" : (currentMonth?.score ?? 0) >= 70 ? "Требует внимания" : "Критически низкое"}
              </p>
              <p className="text-xs text-gray-400">{currentMonth?.totalOps ?? 0} операций · среднее {avgScore}%</p>
            </div>

            {/* Issues breakdown */}
            <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6 space-y-4">
              <p className="text-sm font-semibold text-gray-700">Проблемы за период</p>
              {[
                { key: "noArticle", label: "Без статьи", count: currentMonth?.issues.noArticle ?? 0, icon: <FileWarning className="w-4 h-4 text-amber-500" />, penalty: "−40 баллов макс." },
                { key: "unverified", label: "Не верифицированы", count: currentMonth?.issues.unverified ?? 0, icon: <AlertTriangle className="w-4 h-4 text-red-400" />, penalty: "−40 баллов макс." },
                { key: "highAmount", label: "Крупные суммы (>500к)", count: currentMonth?.issues.highAmount ?? 0, icon: <DollarSign className="w-4 h-4 text-purple-500" />, penalty: "−5 за каждую" },
              ].map((item) => (
                <div key={item.key} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#F7F8FB] flex items-center justify-center shrink-0">{item.icon}</div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-700">{item.label}</p>
                    <p className="text-[10px] text-gray-400">{item.penalty}</p>
                  </div>
                  <span className={`text-sm font-bold ${item.count > 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {item.count > 0 ? item.count : "✓"}
                  </span>
                </div>
              ))}
            </div>

            {/* Monthly scores */}
            <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6">
              <p className="text-sm font-semibold text-gray-700 mb-3">История по месяцам</p>
              <div className="space-y-1.5">
                {monthly.slice(-6).reverse().map((m) => (
                  <button
                    key={m.month}
                    onClick={() => setSelectedMonth(m.month)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors ${m.month === selectedMonth ? "bg-violet-50 border border-violet-200" : "hover:bg-gray-50"}`}
                  >
                    <span className="text-gray-600">{new Date(m.month + "-01").toLocaleString("ru-RU", { month: "short", year: "numeric" })}</span>
                    <div className="flex items-center gap-2">
                      <div className={`w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden`}>
                        <div className={`h-full rounded-full ${m.score >= 90 ? "bg-emerald-400" : m.score >= 70 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${m.score}%` }} />
                      </div>
                      <span className={`font-bold w-8 text-right ${scoreColor(m.score)}`}>{m.score}%</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chart */}
          {monthly.length > 2 && (
            <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6">
              <p className="text-sm font-semibold text-gray-700 mb-4">Динамика Trust Score за 12 месяцев</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "70%", fontSize: 10, fill: "#f59e0b" }} />
                  <ReferenceLine y={90} stroke="#10b981" strokeDasharray="4 4" label={{ value: "90%", fontSize: 10, fill: "#10b981" }} />
                  <Line
                    type="monotone" dataKey="score" stroke="#8b5cf6" strokeWidth={2.5}
                    dot={{ fill: "#8b5cf6", r: 4 }} activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Issues list */}
          <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="px-5 py-4 border-b border-black/[0.04]">
              <h2 className="text-sm font-semibold text-gray-700">
                Проблемные операции · {selectedMonth}
                {issuesData && <span className="ml-2 text-gray-400 font-normal">({issuesData.total} найдено)</span>}
              </h2>
            </div>
            {issuesLoading ? (
              <div className="flex items-center justify-center h-24"><Loader2 className="w-5 h-5 animate-spin text-violet-400" /></div>
            ) : (issuesData?.issues ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <ShieldCheck className="w-10 h-10 text-emerald-300" />
                <p className="text-sm text-gray-500 font-medium">Проблем не найдено</p>
                <p className="text-xs text-gray-400">Все операции верифицированы и имеют статьи</p>
              </div>
            ) : (
              <div className="divide-y divide-black/[0.04]">
                {(issuesData?.issues ?? []).map((issue) => {
                  const meta = ISSUE_LABELS[issue.issue] ?? { label: issue.issue, icon: null, color: "text-gray-500 bg-gray-50 border-gray-200" };
                  return (
                    <div key={issue.id + issue.issue} className="flex items-center gap-4 px-5 py-3">
                      <span className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border font-medium shrink-0 ${meta.color}`}>
                        {meta.icon}{meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{issue.description ?? "Без описания"}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{issue.plMonth}</p>
                      </div>
                      <p className={`text-sm font-bold shrink-0 ${issue.direction === "in" ? "text-emerald-600" : "text-red-500"}`}>
                        {issue.direction === "in" ? "+" : "−"}{fmt(parseFloat(issue.amount))}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
