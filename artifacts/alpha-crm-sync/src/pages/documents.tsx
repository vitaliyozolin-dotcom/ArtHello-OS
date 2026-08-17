import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Plus, Search, Loader2, CheckCircle2, AlertCircle,
  Clock, X, Bot, ChevronDown, Trash2, ExternalLink, Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocRecord {
  id: string;
  docType: string;
  docNumber: string | null;
  docDate: string | null;
  amount: string | null;
  fileName: string | null;
  fileUrl: string | null;
  status: string | null;
  linkedPeriod: string | null;
  counterpartyName: string | null;
  description: string | null;
  aiStatus: string | null;
  aiNotes: string | null;
  createdAt: string;
}

interface DocSummary {
  total: number;
  expected: number;
  unlinked: number;
  byType: { docType: string; count: number }[];
  byStatus: { status: string; count: number }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Счёт",
  contract: "Договор",
  act: "Акт",
  upd: "УПД",
  reconciliation: "Сверка",
  payroll: "Зарплата",
  tax: "Налог",
  other: "Прочее",
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  expected:  { label: "Ожидается", color: "text-amber-600 bg-amber-50 border-amber-200" },
  received:  { label: "Получен",   color: "text-blue-600 bg-blue-50 border-blue-200" },
  signed:    { label: "Подписан",  color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  archived:  { label: "Архив",     color: "text-gray-500 bg-gray-100 border-gray-200" },
};

const AI_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  pending:      { icon: <Clock className="w-3 h-3" />,        color: "text-gray-400" },
  ok:           { icon: <CheckCircle2 className="w-3 h-3" />, color: "text-emerald-500" },
  issues_found: { icon: <AlertCircle className="w-3 h-3" />,  color: "text-red-400" },
};

function fmt(amount: string | null) {
  if (!amount) return "—";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(parseFloat(amount));
}

function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString("ru-RU", { month: "long", year: "numeric" });
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, sub, alert }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; alert?: boolean;
}) {
  return (
    <div className={`bg-white rounded-[22px] border shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5 ${alert ? "border-amber-200" : "border-black/[0.06]"}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs font-medium text-gray-400">{label}</span></div>
      <p className={`text-2xl font-bold ${alert ? "text-amber-600" : "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Add Document Modal ───────────────────────────────────────────────────────

function AddDocModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [docType, setDocType] = useState("invoice");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState("");
  const [amount, setAmount] = useState("");
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("received");
  const [linkedPeriod, setLinkedPeriod] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType, docNumber: docNumber || undefined, docDate: docDate || undefined,
          amount: amount || undefined, fileName: fileName || undefined,
          status, linkedPeriod: linkedPeriod || undefined,
          counterpartyName: counterpartyName || undefined, description: description || undefined,
        }),
      });
      onSaved();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  const field = "w-full bg-[#F7F8FB] border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300";
  const label = "block text-xs font-medium text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[22px] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-black/[0.04]">
          <h2 className="text-lg font-bold text-gray-900">Добавить документ</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Тип документа</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className={field}>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Статус</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
                <option value="expected">Ожидается</option>
                <option value="received">Получен</option>
                <option value="signed">Подписан</option>
                <option value="archived">Архив</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Номер документа</label>
              <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="№ 001" className={field} />
            </div>
            <div>
              <label className={label}>Дата документа</label>
              <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>Сумма (₽)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={field} />
            </div>
            <div>
              <label className={label}>Период</label>
              <input value={linkedPeriod} onChange={(e) => setLinkedPeriod(e.target.value)} placeholder="2024-11" className={field} />
            </div>
          </div>
          <div>
            <label className={label}>Контрагент</label>
            <input value={counterpartyName} onChange={(e) => setCounterpartyName(e.target.value)} placeholder="ООО «Поставщик»" className={field} />
          </div>
          <div>
            <label className={label}>Имя файла (или ссылка)</label>
            <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="contract_2024.pdf" className={field} />
          </div>
          <div>
            <label className={label}>Примечание</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={field} />
          </div>
        </div>
        <div className="flex gap-3 p-6 border-t border-black/[0.04]">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">Отмена</button>
          <button onClick={save} disabled={loading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Document Row ─────────────────────────────────────────────────────────────

function DocRow({ doc, onAiCheck, onDelete }: {
  doc: DocRecord;
  onAiCheck: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const status = STATUS_CONFIG[doc.status ?? "received"] ?? STATUS_CONFIG.received;
  const ai = AI_CONFIG[doc.aiStatus ?? "pending"] ?? AI_CONFIG.pending;

  return (
    <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
      <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4 text-violet-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
            {doc.docNumber ? ` № ${doc.docNumber}` : ""}
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${status.color}`}>
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {doc.counterpartyName && <span className="truncate">{doc.counterpartyName}</span>}
          {doc.docDate && <span>{doc.docDate}</span>}
          {doc.linkedPeriod && <span>{monthLabel(doc.linkedPeriod)}</span>}
          {doc.fileName && (
            <span className="flex items-center gap-1 text-violet-400">
              <ExternalLink className="w-3 h-3" />{doc.fileName}
            </span>
          )}
        </div>
        {doc.aiNotes && doc.aiStatus === "issues_found" && (
          <p className="text-xs text-red-400 mt-1">{doc.aiNotes}</p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {doc.amount && <span className="text-sm font-bold text-gray-800">{fmt(doc.amount)}</span>}
        <button
          onClick={() => onAiCheck(doc.id)}
          title="AI-проверка"
          className={`${ai.color} hover:opacity-80 transition-opacity`}
        >
          {ai.icon}
        </button>
        <button
          onClick={() => onDelete(doc.id)}
          className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const qc = useQueryClient();
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const [showAdd, setShowAdd] = useState(false);
  const [period, setPeriod] = useState("");
  const [docType, setDocType] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [aiCheckingAll, setAiCheckingAll] = useState(false);

  const { data: summary, isLoading: summaryLoading } = useQuery<DocSummary>({
    queryKey: ["docs-summary"],
    queryFn: () => fetch("/api/documents/summary").then((r) => r.json()),
  });

  const { data: docs = [], isLoading } = useQuery<DocRecord[]>({
    queryKey: ["documents", period, docType, status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (docType) params.set("docType", docType);
      if (status) params.set("status", status);
      return fetch(`/api/documents?${params}`).then((r) => r.json());
    },
  });

  const aiCheckMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/documents/${id}/ai-check`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["docs-summary"] });
    },
  });

  async function aiCheckAll() {
    setAiCheckingAll(true);
    try {
      await fetch("/api/documents/ai-check-all", { method: "POST" });
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["docs-summary"] });
    } finally {
      setAiCheckingAll(false);
    }
  }

  const filtered = search
    ? docs.filter((d) =>
        d.counterpartyName?.toLowerCase().includes(search.toLowerCase()) ||
        d.docNumber?.toLowerCase().includes(search.toLowerCase()) ||
        d.description?.toLowerCase().includes(search.toLowerCase())
      )
    : docs;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1440px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Документы</h1>
          <p className="text-sm text-gray-400 mt-0.5">Реестр договоров, актов, счетов и УПД</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={aiCheckAll}
            disabled={aiCheckingAll}
            className="flex items-center gap-2 px-4 py-2.5 border border-violet-200 text-violet-600 text-sm font-medium rounded-xl hover:bg-violet-50 disabled:opacity-50 transition-colors"
          >
            {aiCheckingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
            AI-проверка всех
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Добавить
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<FileText className="w-5 h-5 text-violet-500" />}
          label="Всего документов"
          value={summaryLoading ? "…" : String(summary?.total ?? 0)}
        />
        <SummaryCard
          icon={<Clock className="w-5 h-5 text-amber-500" />}
          label="Ожидается"
          value={summaryLoading ? "…" : String(summary?.expected ?? 0)}
          alert={(summary?.expected ?? 0) > 0}
          sub="не получены"
        />
        <SummaryCard
          icon={<AlertCircle className="w-5 h-5 text-red-400" />}
          label="Не привязано"
          value={summaryLoading ? "…" : String(summary?.unlinked ?? 0)}
          alert={(summary?.unlinked ?? 0) > 0}
          sub="к операции или контрагенту"
        />
        <SummaryCard
          icon={<Zap className="w-5 h-5 text-emerald-500" />}
          label="Типов документов"
          value={summaryLoading ? "…" : String(summary?.byType?.length ?? 0)}
        />
      </div>

      {/* Drag-drop hint */}
      <div className="border-2 border-dashed border-violet-200 rounded-[22px] py-8 flex flex-col items-center justify-center gap-2 bg-violet-50/50">
        <FileText className="w-8 h-8 text-violet-300" />
        <p className="text-sm font-medium text-violet-500">Перетащите файлы сюда или</p>
        <button
          onClick={() => setShowAdd(true)}
          className="text-sm text-violet-600 font-semibold hover:underline"
        >
          добавьте документ вручную
        </button>
      </div>

      {/* Filters + list */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
        {/* Filter bar */}
        <div className="p-4 border-b border-black/[0.04] flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск…"
              className="w-full bg-[#F7F8FB] border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div className="relative">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="appearance-none bg-[#F7F8FB] border border-gray-200 rounded-xl pl-4 pr-8 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 cursor-pointer">
              <option value="">Все периоды</option>
              {Array.from({ length: 12 }, (_, i) => {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                return <option key={m} value={m}>{monthLabel(m)}</option>;
              })}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="bg-[#F7F8FB] border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300">
            <option value="">Все типы</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-[#F7F8FB] border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300">
            <option value="">Все статусы</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* Document list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin text-violet-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="w-12 h-12 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-600">Документов нет</p>
            <p className="text-xs text-gray-400 mt-1">Добавьте первый документ нажав кнопку выше</p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {filtered.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                onAiCheck={(id) => aiCheckMutation.mutate(id)}
                onDelete={(id) => { if (confirm("Удалить документ?")) deleteMutation.mutate(id); }}
              />
            ))}
          </div>
        )}

        {/* Footer count */}
        {filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-black/[0.04] text-xs text-gray-400">
            Показано {filtered.length} из {docs.length} документов
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <AddDocModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["documents"] });
            qc.invalidateQueries({ queryKey: ["docs-summary"] });
          }}
        />
      )}
    </div>
  );
}
