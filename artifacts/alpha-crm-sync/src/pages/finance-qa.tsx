import { formatRubles } from "@workspace/shared/money";
import { apiFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid, Legend,
} from "recharts";
import { ShieldCheck, AlertTriangle, FileQuestion, ArrowLeftRight, Eye, CheckCircle2, XCircle } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface QaSummary {
  totalOperations: number;
  monthsWithData: string[];
  issues: {
    noArticle: number;
    noDocuments: number;
    splitPeriod: number;
    unverified: number;
  };
  trustByMonth: { month: string; avgTrust: number; count: number; issues: number }[];
  byType: { type: string; count: number; total: number }[];
  cashflowByMonth: Record<string, { in: number; out: number }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  formatRubles(n);

const fmtK = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} М`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)} К`;
  return String(n);
};

function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1)
    .toLocaleString("ru-RU", { month: "short", year: "2-digit" });
}

function trustColor(score: number) {
  if (score >= 85) return "#10b981";
  if (score >= 65) return "#f59e0b";
  return "#ef4444";
}

const TYPE_LABELS: Record<string, string> = {
  income: "Доходы",
  expense: "Расходы",
  payroll: "ФОТ",
  tax: "Налоги",
  transfer: "Переводы",
  refund: "Возвраты",
  adjustment: "Корректировки",
  accrual: "Начисления",
};

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon: Icon, color = "violet", warn = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.FC<{ className?: string }>;
  color?: string;
  warn?: boolean;
}) {
  const bg = warn ? "bg-red-50 border-red-200" : "bg-white border-black/[0.06]";
  const iconBg = warn ? "bg-red-100" : `bg-${color}-50`;
  const iconCol = warn ? "text-red-500" : `text-${color}-600`;

  return (
    <div className={`rounded-[18px] border shadow-[0_1px_6px_rgba(0,0,0,0.05)] p-4 ${bg}`}>
      <div className="flex items-start justify-between mb-2">
        <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${iconCol}`} />
        </div>
        {warn && <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wide">Проблема</span>}
      </div>
      <p className={`text-2xl font-bold ${warn ? "text-red-600" : "text-gray-900"}`}>{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5 font-medium">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Custom Trust Bar ─────────────────────────────────────────────────────────

function TrustBar({ score }: { score: number }) {
  const col = trustColor(score);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: col }} />
      </div>
      <span className="text-xs font-semibold w-8 text-right" style={{ color: col }}>{score}%</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceQaPage() {
  const { data, isLoading } = useQuery<QaSummary>({
    queryKey: ["qa-summary"],
    queryFn: () => apiFetch("/api/qa/summary").then((r) => r.json()),
    refetchInterval: 30000,
  });

  const totalIssues = data
    ? data.issues.noArticle + data.issues.noDocuments + data.issues.unverified
    : 0;

  const overallTrust = data?.trustByMonth.length
    ? Math.round(data.trustByMonth.reduce((s, r) => s + r.avgTrust, 0) / data.trustByMonth.length)
    : null;

  const cashflowChartData = data
    ? Object.entries(data.cashflowByMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({
          month: monthLabel(month),
          Доходы: Math.round(v.in / 1000),
          Расходы: Math.round(v.out / 1000),
        }))
    : [];

  const trustChartData = data?.trustByMonth.map((r) => ({
    month: monthLabel(r.month),
    trust: r.avgTrust,
    issues: r.issues,
  })) ?? [];

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance QA Center</h1>
          <p className="text-sm text-gray-400 mt-0.5">Качество финансовых данных · все периоды</p>
        </div>
        {overallTrust !== null && (
          <div className="flex items-center gap-2 bg-white rounded-2xl border border-black/[0.06] shadow-sm px-4 py-3">
            <ShieldCheck className={`w-5 h-5 ${trustColor(overallTrust) === "#10b981" ? "text-emerald-500" : overallTrust >= 65 ? "text-amber-500" : "text-red-500"}`} />
            <div>
              <p className="text-xs text-gray-400 font-medium">Общий Trust Score</p>
              <p className="text-xl font-bold" style={{ color: trustColor(overallTrust) }}>{overallTrust}%</p>
            </div>
          </div>
        )}
      </div>

      {/* KPI row */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-[18px] border border-black/[0.06] animate-pulse" />
          ))}
        </div>
      ) : data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Всего операций"
            value={data.totalOperations.toLocaleString("ru-RU")}
            sub={`${data.monthsWithData.length} месяцев с данными`}
            icon={CheckCircle2}
            color="violet"
          />
          <MetricCard
            label="Без статьи"
            value={data.issues.noArticle}
            sub="Нет привязки к плану счетов"
            icon={FileQuestion}
            warn={data.issues.noArticle > 0}
            color="amber"
          />
          <MetricCard
            label="Без документов"
            value={data.issues.noDocuments}
            sub="Нет закрывающих документов"
            icon={AlertTriangle}
            warn={data.issues.noDocuments > 10}
            color="orange"
          />
          <MetricCard
            label="Разные периоды"
            value={data.issues.splitPeriod}
            sub="cashflowMonth ≠ plMonth"
            icon={ArrowLeftRight}
            color="blue"
          />
        </div>
      )}

      {/* Issues summary + type breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Issues checklist */}
        <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5">
          <h3 className="font-semibold text-gray-900 mb-4 text-sm">Проверки качества</h3>
          {isLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : data && (
            <div className="space-y-2.5">
              {[
                { label: "Без статьи ДДС/ОПиУ", count: data.issues.noArticle },
                { label: "Без документов", count: data.issues.noDocuments },
                { label: "Не подтверждены", count: data.issues.unverified },
                { label: "Split-period (разные месяцы ДДС/ОПиУ)", count: data.issues.splitPeriod, info: true },
              ].map((issue) => (
                <div key={issue.label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    {issue.info ? (
                      <ArrowLeftRight className="w-3.5 h-3.5 text-blue-400" />
                    ) : issue.count === 0 ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span className="text-[12px] text-gray-600">{issue.label}</span>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    issue.info
                      ? "bg-blue-50 text-blue-600"
                      : issue.count === 0
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-red-50 text-red-600"
                  }`}>
                    {issue.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* By type */}
        <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 mb-4 text-sm">Операции по типам</h3>
          {isLoading ? (
            <div className="h-40 bg-gray-50 rounded-xl animate-pulse" />
          ) : data && (
            <div className="space-y-2">
              {data.byType
                .sort((a, b) => b.count - a.count)
                .map((t) => (
                  <div key={t.type} className="flex items-center gap-3">
                    <span className="text-[11px] text-gray-500 w-24 shrink-0">{TYPE_LABELS[t.type] ?? t.type}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full"
                        style={{ width: `${Math.min(100, (t.count / (data.totalOperations || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-gray-700 w-8 text-right">{t.count}</span>
                    <span className="text-[11px] text-gray-400 w-28 text-right hidden sm:block">{fmtK(t.total)} ₽</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Trust by month + cashflow chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trust Score by month */}
        <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5">
          <h3 className="font-semibold text-gray-900 mb-4 text-sm">Trust Score по месяцам</h3>
          {isLoading ? (
            <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trustChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(v: number, name: string) => [
                    name === "trust" ? `${v}%` : v,
                    name === "trust" ? "Trust Score" : "Проблем",
                  ]}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                <Line type="monotone" dataKey="trust" stroke="#7c3aed" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cashflow in/out by month */}
        <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5">
          <h3 className="font-semibold text-gray-900 mb-1 text-sm">Доходы vs Расходы по месяцам</h3>
          <p className="text-[10px] text-gray-400 mb-3">тыс. руб.</p>
          {isLoading ? (
            <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cashflowChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [`${v} К ₽`]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Доходы" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Расходы" fill="#f43f5e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Trust by month detail table */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5">
        <h3 className="font-semibold text-gray-900 mb-4 text-sm">Детали по месяцам</h3>
        {isLoading ? (
          <div className="h-40 bg-gray-50 rounded-xl animate-pulse" />
        ) : data && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 text-gray-400 font-medium">Месяц</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Операций</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Trust Score</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Проблем</th>
                  <th className="py-2 pl-4 text-gray-400 font-medium">Оценка</th>
                </tr>
              </thead>
              <tbody>
                {data.trustByMonth.map((row) => (
                  <tr key={row.month} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-2 font-medium text-gray-800">{monthLabel(row.month)}</td>
                    <td className="py-2 text-right text-gray-600">{Number(row.count).toLocaleString("ru-RU")}</td>
                    <td className="py-2 text-right w-32">
                      <TrustBar score={Number(row.avgTrust)} />
                    </td>
                    <td className="py-2 text-right">
                      {Number(row.issues) > 0 ? (
                        <span className="text-red-500 font-semibold">{row.issues}</span>
                      ) : (
                        <span className="text-emerald-500 font-semibold">0</span>
                      )}
                    </td>
                    <td className="py-2 pl-4">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        Number(row.avgTrust) >= 85
                          ? "bg-emerald-50 text-emerald-600"
                          : Number(row.avgTrust) >= 65
                          ? "bg-amber-50 text-amber-600"
                          : "bg-red-50 text-red-600"
                      }`}>
                        {Number(row.avgTrust) >= 85 ? "Хорошо" : Number(row.avgTrust) >= 65 ? "Допустимо" : "Требует проверки"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.trustByMonth.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-8">Данных нет — загрузите тестовые данные</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
