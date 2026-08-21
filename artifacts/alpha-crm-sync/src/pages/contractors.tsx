import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, AlertTriangle, CheckCircle2, ChevronRight,
  X, Plus, FileText, CreditCard, Receipt, Scale,
  Loader2, Search, TrendingDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contractor {
  id: string;
  name: string;
  inn: string | null;
  type: string | null;
  taxStatus: string | null;
  riskLevel: string;
  trustScore: number;
  totalAccrued: number;
  totalPaid: number;
  balance: number;
  hasDebt: boolean;
  hasOverpay: boolean;
  isActive: boolean;
}

interface Accrual { id: string; amount: string; accrualDate: string; accrualMonth: string; description: string | null; status: string }
interface Payment { id: string; amount: string; paymentDate: string; method: string; notes: string | null }
interface Document { id: string; docType: string; docNumber: string | null; docDate: string | null; amount: string | null; status: string }

interface ContractorDetail {
  contractor: Contractor;
  accruals: Accrual[];
  payments: Payment[];
  documents: Document[];
  summary: { totalAccrued: number; totalPaid: number; balance: number; docsCoverage: number };
}

interface Stats {
  totalContractors: number;
  highRisk: number;
  totalAccrued: number;
  totalPaid: number;
  totalDebt: number;
  docsExpected: number;
  docsReceived: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} млн ₽`;
  if (abs >= 100_000)   return `${sign}${Math.round(abs / 1000)} тыс. ₽`;
  if (abs >= 1_000)     return `${sign}${(abs / 1000).toFixed(1).replace('.0', '')} тыс. ₽`;
  return `${sign}${Math.round(abs).toLocaleString('ru-RU')} ₽`;
}

const TYPE_LABELS: Record<string, string> = { ip: "ИП", ooo: "ООО", self_employed: "Самозанятый", individual: "Физлицо" };
const RISK_STYLES: Record<string, string> = {
  low: "text-emerald-600 bg-emerald-50 border-emerald-200",
  medium: "text-amber-600 bg-amber-50 border-amber-200",
  high: "text-red-600 bg-red-50 border-red-200",
};
const RISK_LABELS: Record<string, string> = { low: "Низкий", medium: "Средний", high: "Высокий" };
const DOC_TYPE_LABELS: Record<string, string> = { contract: "Договор", act: "Акт", invoice: "Счёт", upd: "УПД", reconciliation: "Сверка", other: "Прочее" };
const DOC_STATUS_STYLES: Record<string, string> = {
  expected: "text-amber-600 bg-amber-50",
  received: "text-blue-600 bg-blue-50",
  signed: "text-emerald-600 bg-emerald-50",
  overdue: "text-red-600 bg-red-50",
};

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-[#F7F8FB] flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-none mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Contractor row ───────────────────────────────────────────────────────────

function ContractorRow({ c, onSelect }: { c: Contractor; onSelect: () => void }) {
  const riskStyle = RISK_STYLES[c.riskLevel] ?? RISK_STYLES["medium"];
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors rounded-2xl text-left"
    >
      <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
        <Building2 className="w-5 h-5 text-violet-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {c.type && <span className="text-[10px] text-gray-400">{TYPE_LABELS[c.type] ?? c.type}</span>}
          {c.inn && <span className="text-[10px] text-gray-400">ИНН {c.inn}</span>}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-1">
        <p className={`text-sm font-bold ${c.hasDebt ? "text-red-500" : c.hasOverpay ? "text-amber-500" : "text-emerald-600"}`}>
          {c.hasDebt ? `-${fmt(c.balance)}` : c.hasOverpay ? `+${fmt(Math.abs(c.balance))}` : "✓"}
        </p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${riskStyle}`}>
          {RISK_LABELS[c.riskLevel]}
        </span>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
    </button>
  );
}

// ─── Detail sheet ─────────────────────────────────────────────────────────────

function DetailSheet({ contractorId, onClose }: { contractorId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"accruals" | "payments" | "documents">("accruals");

  const { data, isLoading } = useQuery<ContractorDetail>({
    queryKey: ["contractor-detail", contractorId],
    queryFn: () => fetch(`/api/contractors/${contractorId}`).then((r) => r.json()),
  });

  const c = data?.contractor;
  const s = data?.summary;

  const tabs = [
    { key: "accruals" as const, label: "Начисления", count: data?.accruals.length },
    { key: "payments" as const, label: "Оплаты", count: data?.payments.length },
    { key: "documents" as const, label: "Документы", count: data?.documents.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-lg bg-white h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/[0.06]">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{c?.name ?? "…"}</h2>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
              {c?.type && <span>{TYPE_LABELS[c.type] ?? c.type}</span>}
              {c?.inn && <span>· ИНН {c.inn}</span>}
              {c?.taxStatus && <span>· {c.taxStatus.toUpperCase()}</span>}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-0 border-b border-black/[0.06]">
              {[
                { label: "Начислено", value: fmt(s?.totalAccrued ?? 0), color: "text-gray-900" },
                { label: "Оплачено", value: fmt(s?.totalPaid ?? 0), color: "text-emerald-600" },
                { label: "Долг", value: fmt(Math.abs(s?.balance ?? 0)), color: (s?.balance ?? 0) > 0.01 ? "text-red-500" : "text-gray-400" },
              ].map((item) => (
                <div key={item.label} className="p-4 text-center border-r last:border-0 border-black/[0.06]">
                  <p className="text-xs text-gray-400">{item.label}</p>
                  <p className={`text-base font-bold mt-0.5 ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>

            {/* Risk + trust */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-black/[0.06]">
              <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${RISK_STYLES[c?.riskLevel ?? "medium"]}`}>
                Риск: {RISK_LABELS[c?.riskLevel ?? "medium"]}
              </span>
              <span className="text-xs text-gray-400">Trust Score: {c?.trustScore ?? 50}/100</span>
              {s && s.docsCoverage < 0.8 && (
                <span className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Нехватает документов
                </span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-black/[0.06]">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 py-3 text-xs font-medium transition-colors ${tab === t.key ? "text-violet-600 border-b-2 border-violet-500" : "text-gray-400 hover:text-gray-600"}`}
                >
                  {t.label} {t.count != null && <span className="ml-1 text-gray-400">({t.count})</span>}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {tab === "accruals" && (
                <div className="divide-y divide-black/[0.04]">
                  {(data?.accruals ?? []).length === 0
                    ? <p className="text-xs text-gray-400 p-6 text-center">Нет начислений</p>
                    : (data?.accruals ?? []).map((a) => (
                      <div key={a.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-800">{a.description ?? "Начисление"}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{a.accrualDate} · {a.accrualMonth}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-900">{fmt(parseFloat(a.amount))}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${a.status === "paid" ? "bg-emerald-50 text-emerald-600" : a.status === "approved" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"}`}>
                            {a.status === "paid" ? "Оплачено" : a.status === "approved" ? "Утверждено" : a.status === "pending" ? "Ожидает" : a.status}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {tab === "payments" && (
                <div className="divide-y divide-black/[0.04]">
                  {(data?.payments ?? []).length === 0
                    ? <p className="text-xs text-gray-400 p-6 text-center">Нет оплат</p>
                    : (data?.payments ?? []).map((p) => (
                      <div key={p.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-800">{p.notes ?? "Оплата"}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{p.paymentDate} · {p.method}</p>
                        </div>
                        <p className="text-sm font-bold text-emerald-600">{fmt(parseFloat(p.amount))}</p>
                      </div>
                    ))}
                </div>
              )}

              {tab === "documents" && (
                <div className="divide-y divide-black/[0.04]">
                  {(data?.documents ?? []).length === 0
                    ? <p className="text-xs text-gray-400 p-6 text-center">Нет документов</p>
                    : (data?.documents ?? []).map((d) => (
                      <div key={d.id} className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <div>
                            <p className="text-sm text-gray-800">{DOC_TYPE_LABELS[d.docType] ?? d.docType} {d.docNumber ? `№${d.docNumber}` : ""}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{d.docDate ?? "—"}{d.amount ? ` · ${fmt(parseFloat(d.amount))}` : ""}</p>
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${DOC_STATUS_STYLES[d.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {d.status === "received" ? "Получен" : d.status === "signed" ? "Подписан" : d.status === "expected" ? "Ожидается" : d.status === "overdue" ? "Просрочен" : d.status}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContractorsPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<string>("");

  const { data: stats } = useQuery<Stats>({
    queryKey: ["contractors-stats"],
    queryFn: () => fetch("/api/contractors/stats/summary").then((r) => r.json()),
  });

  const { data: contractors = [], isLoading } = useQuery<Contractor[]>({
    queryKey: ["contractors", search, riskFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (riskFilter) p.set("risk", riskFilter);
      return fetch(`/api/contractors?${p}`).then((r) => r.json());
    },
  });

  const docCoverage = stats && stats.docsExpected > 0
    ? Math.round((stats.docsReceived / stats.docsExpected) * 100)
    : 100;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Подрядчики</h1>
          <p className="text-sm text-gray-400 mt-0.5">Контрагенты, начисления, документы</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Всего подрядчиков" value={String(stats?.totalContractors ?? 0)} icon={<Building2 className="w-5 h-5 text-violet-500" />} sub={`высокий риск: ${stats?.highRisk ?? 0}`} />
        <StatCard label="Задолженность" value={fmtCompact(stats?.totalDebt ?? 0)} icon={<TrendingDown className="w-5 h-5 text-red-400" />} sub={fmt(stats?.totalDebt ?? 0)} />
        <StatCard label="Всего начислено" value={fmtCompact(stats?.totalAccrued ?? 0)} icon={<Receipt className="w-5 h-5 text-blue-500" />} sub={fmt(stats?.totalAccrued ?? 0)} />
        <StatCard label="Документы" value={`${docCoverage}%`} icon={<FileText className="w-5 h-5 text-amber-500" />} sub={`${stats?.docsReceived ?? 0} из ${stats?.docsExpected ?? 0}`} />
      </div>

      {/* Filters + list */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="p-4 border-b border-black/[0.04] flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию или ИНН…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 text-gray-600"
          >
            <option value="">Все риски</option>
            <option value="low">Низкий</option>
            <option value="medium">Средний</option>
            <option value="high">Высокий</option>
          </select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
        ) : contractors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Building2 className="w-12 h-12 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-600">Подрядчики не найдены</p>
            <p className="text-xs text-gray-400 mt-1">Загрузите тестовые данные или добавьте подрядчика</p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {contractors.map((c) => (
              <ContractorRow key={c.id} c={c} onSelect={() => setSelectedId(c.id)} />
            ))}
          </div>
        )}
      </div>

      {selectedId && <DetailSheet contractorId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
