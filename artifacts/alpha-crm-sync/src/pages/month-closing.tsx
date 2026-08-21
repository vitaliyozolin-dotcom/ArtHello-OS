import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Lock, LockOpen, CheckCircle2, XCircle, ChevronDown,
  Loader2, Calendar, AlertTriangle, ClipboardCheck,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Checklist {
  allOpsVerified: { ok: boolean; count: number; issues: number };
  articlesCovered: { ok: boolean; count: number; issues: number };
  taxesAccrued: { ok: boolean; count: number };
  payrollPaid: { ok: boolean; count: number };
}

interface MonthStatus {
  month: string;
  status: "open" | "closed" | "locked";
  closing: {
    snapshotRevenue: string;
    snapshotExpenses: string;
    snapshotGrossProfit: string;
    snapshotMargin: string;
    snapshotTrustScore: number;
    closedBy: string;
    closedAt: string;
    notes: string | null;
  } | null;
  checklist: Checklist;
  canClose: boolean;
  operationsCount: number;
}

interface MonthClosingRecord {
  id: string;
  periodMonth: string;
  status: string;
  snapshotRevenue: string | null;
  snapshotGrossProfit: string | null;
  snapshotTrustScore: number | null;
  closedAt: string | null;
  closedBy: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | string) {
  const num = typeof n === "string" ? parseFloat(n) : n;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(num);
}

function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("ru-RU", { month: "long", year: "numeric" });
}

function monthsRange(): string[] {
  const months: string[] = [];
  const today = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

const STATUS_STYLES: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  open: { label: "Открыт", cls: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: <LockOpen className="w-3.5 h-3.5" /> },
  closed: { label: "Закрыт", cls: "text-amber-600 bg-amber-50 border-amber-200", icon: <Lock className="w-3.5 h-3.5" /> },
  locked: { label: "Заблокирован", cls: "text-red-600 bg-red-50 border-red-200", icon: <Lock className="w-3.5 h-3.5" /> },
};

// ─── Checklist item ───────────────────────────────────────────────────────────

function CheckItem({ ok, label, sub }: { ok: boolean; label: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      {ok
        ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
        : <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
      <div>
        <p className={`text-sm font-medium ${ok ? "text-gray-700" : "text-red-600"}`}>{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MonthClosingPage() {
  const today = new Date();
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const defaultMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [closeNotes, setCloseNotes] = useState("");
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery<MonthStatus>({
    queryKey: ["month-status", month],
    queryFn: () => fetch(`/api/months/${month}/status`).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const { data: allClosings = [] } = useQuery<MonthClosingRecord[]>({
    queryKey: ["month-closings"],
    queryFn: () => fetch("/api/months").then((r) => r.json()),
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/months/${month}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closedBy: "owner", notes: closeNotes }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["month-status"] });
      qc.invalidateQueries({ queryKey: ["month-closings"] });
      setShowCloseDialog(false);
      setCloseNotes("");
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/months/${month}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reopenedBy: "owner" }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["month-status"] });
      qc.invalidateQueries({ queryKey: ["month-closings"] });
    },
  });

  const isClosed = status?.status === "closed" || status?.status === "locked";
  const st = STATUS_STYLES[status?.status ?? "open"] ?? STATUS_STYLES["open"];
  const closedMonths = new Set(allClosings.filter((c) => c.status !== "open").map((c) => c.periodMonth));

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[900px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Закрытие месяца</h1>
          <p className="text-sm text-gray-400 mt-0.5">Контроль качества данных перед закрытием периода</p>
        </div>
        <div className="relative">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="appearance-none bg-white border border-gray-200 rounded-xl pl-4 pr-8 py-2.5 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            {monthsRange().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)} {closedMonths.has(m) ? "🔒" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
      ) : (
        <>
          {/* Status + action */}
          <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{monthLabel(month)}</h2>
                <p className="text-sm text-gray-400 mt-0.5">{status?.operationsCount ?? 0} операций в периоде</p>
              </div>
              <span className={`flex items-center gap-2 px-3 py-1.5 rounded-full border font-semibold text-sm ${st.cls}`}>
                {st.icon}{st.label}
              </span>
            </div>

            {/* Checklist */}
            {status?.checklist && (
              <div className="space-y-3 mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Чеклист закрытия</p>
                <CheckItem
                  ok={status.checklist.allOpsVerified.ok}
                  label="Все операции верифицированы"
                  sub={status.checklist.allOpsVerified.issues > 0 ? `${status.checklist.allOpsVerified.issues} операций требуют проверки` : `${status.checklist.allOpsVerified.count} операций — ОК`}
                />
                <CheckItem
                  ok={status.checklist.articlesCovered.ok}
                  label="Все операции имеют статью"
                  sub={status.checklist.articlesCovered.issues > 0 ? `${status.checklist.articlesCovered.issues} операций без статьи` : "Все статьи проставлены — ОК"}
                />
                <CheckItem
                  ok={status.checklist.taxesAccrued.ok}
                  label="Налоги начислены"
                  sub={`${status.checklist.taxesAccrued.count} налоговых обязательств`}
                />
                <CheckItem
                  ok={status.checklist.payrollPaid.ok}
                  label="Выплаты сотрудникам рассчитаны"
                  sub={`${status.checklist.payrollPaid.count} ведомостей`}
                />
              </div>
            )}

            {/* Snapshot if closed */}
            {isClosed && status?.closing && (
              <div className="mb-6 p-4 bg-gray-50 rounded-2xl border border-black/[0.04] space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Снимок на дату закрытия</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                  {[
                    { label: "Выручка", value: fmt(status.closing.snapshotRevenue) },
                    { label: "Расходы", value: fmt(status.closing.snapshotExpenses) },
                    { label: "Вал. прибыль", value: fmt(status.closing.snapshotGrossProfit) },
                    { label: "Trust Score", value: `${status.closing.snapshotTrustScore ?? "—"}%` },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] text-gray-400">{item.label}</p>
                      <p className="text-sm font-bold text-gray-800">{item.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Закрыл: {status.closing.closedBy} · {new Date(status.closing.closedAt).toLocaleString("ru-RU")}
                </p>
                {status.closing.notes && <p className="text-xs text-gray-500 italic">{status.closing.notes}</p>}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              {!isClosed && (
                <button
                  onClick={() => setShowCloseDialog(true)}
                  disabled={!status?.canClose}
                  className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-sm transition-colors ${
                    status?.canClose
                      ? "bg-violet-600 text-white hover:bg-violet-700 shadow-[0_2px_8px_rgba(124,58,237,0.25)]"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  Закрыть месяц
                </button>
              )}
              {isClosed && status?.status !== "locked" && (
                <button
                  onClick={() => reopenMutation.mutate()}
                  disabled={reopenMutation.isPending}
                  className="flex items-center gap-2 px-5 py-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl font-semibold text-sm hover:bg-amber-100 transition-colors"
                >
                  {reopenMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}
                  Переоткрыть
                </button>
              )}
              {!status?.canClose && !isClosed && (
                <p className="flex items-center gap-2 text-xs text-amber-600 self-center">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Исправьте пункты чеклиста перед закрытием
                </p>
              )}
            </div>
          </div>

          {/* Close dialog */}
          {showCloseDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowCloseDialog(false)} />
              <div className="relative bg-white rounded-[22px] shadow-2xl p-6 w-full max-w-md space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center">
                    <Lock className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-gray-900">Закрыть {monthLabel(month)}?</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Период станет read-only. Можно переоткрыть.</p>
                  </div>
                </div>
                <textarea
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Комментарий (необязательно)…"
                  rows={3}
                  className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                />
                <div className="flex gap-3">
                  <button onClick={() => setShowCloseDialog(false)} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">
                    Отмена
                  </button>
                  <button
                    onClick={() => closeMutation.mutate()}
                    disabled={closeMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 font-semibold"
                  >
                    {closeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    Закрыть месяц
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* History */}
          {allClosings.length > 0 && (
            <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-5 py-4 border-b border-black/[0.04]">
                <h2 className="text-sm font-semibold text-gray-700">История закрытий</h2>
              </div>
              <div className="divide-y divide-black/[0.04]">
                {allClosings.sort((a, b) => b.periodMonth.localeCompare(a.periodMonth)).map((c) => {
                  const s = STATUS_STYLES[c.status] ?? STATUS_STYLES["open"];
                  return (
                    <div key={c.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="w-8 h-8 rounded-xl bg-[#F7F8FB] flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-gray-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{monthLabel(c.periodMonth)}</p>
                        {c.closedAt && <p className="text-xs text-gray-400">{c.closedBy} · {new Date(c.closedAt).toLocaleDateString("ru-RU")}</p>}
                      </div>
                      {c.snapshotRevenue && <p className="text-sm text-gray-600 tabular-nums">{fmt(c.snapshotRevenue)}</p>}
                      {c.snapshotTrustScore != null && (
                        <p className="text-xs text-gray-400">Trust: {c.snapshotTrustScore}%</p>
                      )}
                      <span className={`text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${s.cls}`}>
                        {s.icon}{s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
