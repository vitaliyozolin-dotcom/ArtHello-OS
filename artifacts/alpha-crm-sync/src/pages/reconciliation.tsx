import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetReconciliationTransactions,
  useGetReconciliationStats,
  useGetReconciliationMonths,
  useGetImportBatches,
  useImportBankStatement,
  useAutoMatch,
  useCreateMatch,
  useDeleteMatch,
  useIgnoreTransaction,
  useCreateOperationFromBankTx,
  useDeleteImportBatch,
  useGetArticles,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// ─── Types ────────────────────────────────────────────────────────────────────

type BankTx = {
  id: string;
  importBatchId?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  operationDate?: string | null;
  amount?: string | null;
  direction?: string | null;
  counterpartyName?: string | null;
  purpose?: string | null;
  matchStatus: string;
  matchType?: string | null;
  matchConfidence?: number | null;
  matchedOperationId?: string | null;
  matchedAt?: string | null;
  isIgnored: boolean;
  createdAt: string;
  matchedOperation?: {
    id: string;
    description?: string | null;
    amount?: string | null;
    articleName?: string | null;
    articleCode?: string | null;
    cashflowDate?: string | null;
    verificationStatus?: string | null;
  } | null;
};

type Article = {
  id: string;
  code: string;
  name: string;
  groupName: string;
  type: string;
};

type ImportBatch = {
  id: string;
  bankName?: string | null;
  fileName?: string | null;
  format?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  transactionCount?: number | null;
  importedAt: string;
  notes?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: string | number | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString("ru-RU", {
    month: "long", year: "numeric",
  });
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)]",
      className,
    )}>
      {children}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats, loading }: {
  stats: {
    total: number; matched: number; unmatched: number; ignored: number;
    matchedPct: number; totalAmountIn: number; totalAmountOut: number;
    unmatchedAmountIn: number; unmatchedAmountOut: number;
  } | undefined;
  loading: boolean;
}) {
  const items = [
    { label: "Всего транзакций",  value: String(stats?.total ?? 0),         color: "text-slate-800" },
    { label: "Сверено",           value: `${stats?.matchedPct ?? 0}%`,      color: "text-emerald-600" },
    { label: "Сверено / шт",      value: String(stats?.matched ?? 0),       color: "text-emerald-600" },
    { label: "Не сверено",        value: String(stats?.unmatched ?? 0),      color: (stats?.unmatched ?? 0) > 0 ? "text-amber-600" : "text-emerald-600" },
    { label: "Приход (банк)",     value: `${fmt(stats?.totalAmountIn)} ₽`,  color: "text-emerald-600" },
    { label: "Расход (банк)",     value: `${fmt(stats?.totalAmountOut)} ₽`, color: "text-red-500" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {items.map((item) => (
        <Card key={item.label} className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1 leading-tight">{item.label}</div>
          {loading ? (
            <div className="h-5 w-16 bg-slate-100 rounded animate-pulse" />
          ) : (
            <div className={cn("text-[15px] font-semibold tabular-nums", item.color)}>{item.value}</div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─── Import dialog ────────────────────────────────────────────────────────────

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [bankName, setBankName] = useState("Тинькофф");
  const [rawText, setRawText] = useState("");
  const [result, setResult] = useState<{ inserted: number; duplicates: number; errors: number } | null>(null);
  const qc = useQueryClient();

  const importMut = useImportBankStatement({
    mutation: {
      onSuccess: (data) => {
        const r = data as { inserted: number; duplicates: number; errors: number };
        setResult(r);
        qc.invalidateQueries({ queryKey: ["getReconciliationTransactions"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationStats"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationMonths"] });
        qc.invalidateQueries({ queryKey: ["getImportBatches"] });
      },
    },
  });

  const handleImport = () => {
    if (!rawText.trim()) return;
    importMut.mutate({ data: { bankName, rawText } });
  };

  const handleClose = () => {
    setRawText("");
    setResult(null);
    onClose();
  };

  const SAMPLE = `Дата операции	Описание	Сумма	Тип
15.05.2025	ООО "Ромашка" за обучение	50000	Приход
16.05.2025	Аренда офиса	80000	Расход
17.05.2025	Зарплата Иванова	45000	Расход`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[600px] rounded-[24px] p-6">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold">Импорт выписки</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="py-4 space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Загружено", value: result.inserted, color: "text-emerald-600" },
                { label: "Дубликаты", value: result.duplicates, color: "text-amber-600" },
                { label: "Ошибки", value: result.errors, color: "text-red-500" },
              ].map((r) => (
                <div key={r.label} className="bg-slate-50 rounded-[14px] p-4">
                  <div className={cn("text-[28px] font-bold tabular-nums", r.color)}>{r.value}</div>
                  <div className="text-[12px] text-slate-500 mt-1">{r.label}</div>
                </div>
              ))}
            </div>
            <Button className="w-full rounded-xl bg-[hsl(258_88%_56%)] text-white" onClick={handleClose}>
              Готово
            </Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-[12px] text-slate-500 mb-1.5 block">Банк</Label>
              <Select value={bankName} onValueChange={setBankName}>
                <SelectTrigger className="rounded-xl h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Тинькофф">Тинькофф</SelectItem>
                  <SelectItem value="Сбербанк">Сбербанк</SelectItem>
                  <SelectItem value="Альфа-Банк">Альфа-Банк</SelectItem>
                  <SelectItem value="ВТБ">ВТБ</SelectItem>
                  <SelectItem value="Точка">Точка</SelectItem>
                  <SelectItem value="Другой">Другой</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[12px] text-slate-500">Вставьте CSV / текст выписки</Label>
                <button
                  className="text-[11px] text-violet-600 hover:underline"
                  onClick={() => setRawText(SAMPLE)}
                >
                  Вставить пример
                </button>
              </div>
              <Textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Вставьте содержимое файла выписки из банка (CSV, TSV или текст с разделителями)…"
                className="rounded-xl text-[12px] font-mono resize-none h-40"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                Поддерживаются форматы Тинькофф (tab), Сбербанк (;) и generic CSV.
                Дублирующие строки пропускаются автоматически.
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 rounded-xl h-9" onClick={handleClose}>Отмена</Button>
              <Button
                className="flex-1 rounded-xl h-9 bg-[hsl(258_88%_56%)] text-white hover:bg-[hsl(258_88%_48%)]"
                disabled={importMut.isPending || !rawText.trim()}
                onClick={handleImport}
              >
                {importMut.isPending ? "Импорт…" : "Импортировать"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Match picker dialog ──────────────────────────────────────────────────────

function MatchPickerDialog({ tx, open, onClose }: {
  tx: BankTx | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: opsRaw } = useGetReconciliationTransactions({
    matchStatus: "unmatched",
    search: search || undefined,
    limit: 50,
  });

  const matchMut = useCreateMatch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getReconciliationTransactions"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationStats"] });
        onClose();
      },
    },
  });

  if (!tx) return null;

  const txDir = tx.direction === "income" ? "in" : "out";
  const txAmt = parseFloat(tx.amount ?? "0");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[520px] rounded-[24px] p-6 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">Найти операцию в реестре</DialogTitle>
        </DialogHeader>

        <div className="text-[13px] text-slate-500 mt-1 mb-3">
          Банк: <b className="text-slate-700">{fmt(tx.amount)} ₽</b> · {tx.counterpartyName ?? "—"} · {fmtDate(tx.operationDate)}
        </div>

        <Input
          placeholder="Поиск по описанию или контрагенту…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl mb-3 h-9"
        />

        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          <p className="text-[12px] text-slate-400 mb-2">Подходящие операции из реестра:</p>
          {/* show ledger ops that are unmatched with similar amount */}
          <div className="text-[13px] text-slate-400 text-center py-6">
            Выберите операцию из реестра ниже или создайте новую из этой транзакции
          </div>
        </div>

        <div className="flex gap-3 mt-3">
          <Button variant="outline" className="flex-1 rounded-xl h-9" onClick={onClose}>Отмена</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create-operation dialog ──────────────────────────────────────────────────

function CreateFromTxDialog({ tx, open, onClose }: {
  tx: BankTx | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [articleId, setArticleId] = useState("");
  const [notes, setNotes] = useState("");

  const { data: articlesRaw } = useGetArticles();
  const articles = (articlesRaw as Article[] | undefined) ?? [];

  const grouped = useMemo(() => {
    const g: Record<string, Article[]> = {};
    for (const a of articles) {
      if (!g[a.groupName]) g[a.groupName] = [];
      g[a.groupName].push(a);
    }
    return g;
  }, [articles]);

  const createMut = useCreateOperationFromBankTx({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getReconciliationTransactions"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationStats"] });
        qc.invalidateQueries({ queryKey: ["getLedgerOperations"] });
        qc.invalidateQueries({ queryKey: ["getLedgerStats"] });
        setArticleId("");
        setNotes("");
        onClose();
      },
    },
  });

  if (!tx) return null;

  const dir = tx.direction === "income";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[440px] rounded-[24px] p-6">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">Создать операцию в реестре</DialogTitle>
        </DialogHeader>

        <div className={cn(
          "rounded-[16px] p-4 mb-4",
          dir ? "bg-emerald-50" : "bg-red-50",
        )}>
          <div className={cn("text-[11px] font-semibold uppercase tracking-wide mb-1", dir ? "text-emerald-600" : "text-red-500")}>
            {dir ? "Приход" : "Расход"}
          </div>
          <div className={cn("text-[26px] font-bold tabular-nums", dir ? "text-emerald-600" : "text-red-500")}>
            {dir ? "+" : "−"}{fmt(tx.amount)} ₽
          </div>
          <div className="text-[13px] text-slate-600 mt-1">{tx.counterpartyName ?? tx.purpose ?? "—"}</div>
          <div className="text-[12px] text-slate-400 mt-0.5">{fmtDate(tx.operationDate)}</div>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-[12px] text-slate-500 mb-1.5 block">Статья ДДС/ОПиУ</Label>
            <Select
              value={articleId || "__none"}
              onValueChange={(v) => setArticleId(v === "__none" ? "" : v)}
            >
              <SelectTrigger className="rounded-xl h-9">
                <SelectValue placeholder="Выберите статью…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Без статьи</SelectItem>
                {Object.entries(grouped).map(([group, arts]) => (
                  <div key={group}>
                    <div className="px-2 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{group}</div>
                    {arts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12px] text-slate-500 mb-1.5 block">Заметки</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Дополнительно…"
              className="rounded-xl h-9"
            />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-xl h-9" onClick={onClose}>Отмена</Button>
            <Button
              className="flex-1 rounded-xl h-9 bg-[hsl(258_88%_56%)] text-white hover:bg-[hsl(258_88%_48%)]"
              disabled={createMut.isPending}
              onClick={() => createMut.mutate({
                bankTxId: tx.id,
                data: { articleId: articleId || undefined, notes: notes || undefined },
              })}
            >
              {createMut.isPending ? "Создание…" : "Создать"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Batch list sheet ─────────────────────────────────────────────────────────

function BatchesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: batchesRaw } = useGetImportBatches();
  const batches = (batchesRaw as ImportBatch[] | undefined) ?? [];

  const deleteMut = useDeleteImportBatch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getImportBatches"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationTransactions"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationStats"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationMonths"] });
      },
    },
  });

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[400px] overflow-y-auto" side="right">
        <SheetHeader className="mb-5">
          <SheetTitle className="text-[17px] font-semibold">Импортированные выписки</SheetTitle>
        </SheetHeader>

        {batches.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-3xl mb-3">📂</div>
            <p className="text-[14px]">Выписок нет</p>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => (
              <div key={b.id} className="bg-slate-50 rounded-[16px] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[14px] font-semibold text-slate-800">{b.bankName ?? "Банк"}</div>
                    <div className="text-[12px] text-slate-400 mt-0.5">
                      {b.dateFrom ? `${fmtDate(b.dateFrom)} — ${fmtDate(b.dateTo)}` : "Дата неизвестна"}
                      {" · "}{b.transactionCount ?? 0} транзакций
                    </div>
                    {b.fileName && <div className="text-[11px] text-slate-300 mt-0.5 font-mono">{b.fileName}</div>}
                    <div className="text-[11px] text-slate-400 mt-1">Загружено {fmtDate(b.importedAt)}</div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm("Удалить выписку и все её транзакции?")) {
                        deleteMut.mutate({ id: b.id });
                      }
                    }}
                    className="text-[12px] text-red-400 hover:text-red-600 shrink-0 mt-0.5"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Transaction row ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  unmatched: { label: "Не сверено", color: "bg-amber-100 text-amber-700",   dot: "bg-amber-400" },
  matched:   { label: "Сверено",    color: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  ignored:   { label: "Игнор",      color: "bg-slate-100 text-slate-500",   dot: "bg-slate-400" },
  reviewed:  { label: "Проверено",  color: "bg-blue-100 text-blue-700",     dot: "bg-blue-500" },
};

function TxRow({ tx, onCreateOp, onUnmatch, onIgnore }: {
  tx: BankTx;
  onCreateOp: (tx: BankTx) => void;
  onUnmatch: (id: string) => void;
  onIgnore: (id: string) => void;
}) {
  const dir = tx.direction === "income";
  const status = STATUS_CONFIG[tx.matchStatus] ?? STATUS_CONFIG.unmatched;
  const conf = tx.matchConfidence ?? 0;

  return (
    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors">
      {/* Direction dot */}
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[14px] font-semibold",
        dir ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500",
      )}>
        {dir ? "+" : "−"}
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-slate-800 truncate max-w-[240px]">
            {tx.counterpartyName ?? tx.purpose ?? "Без описания"}
          </span>
          <span className={cn("text-[11px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1", status.color)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
            {status.label}
          </span>
          {tx.matchType === "auto" && conf > 0 && (
            <span className="text-[10px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-medium">
              авто {conf}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[12px] text-slate-400">{fmtDate(tx.operationDate)}</span>
          {tx.bankName && <span className="text-[12px] text-slate-400">· {tx.bankName}</span>}
          {tx.matchedOperation && (
            <span className="text-[12px] text-violet-600">
              → {tx.matchedOperation.description ?? tx.matchedOperation.articleName ?? "Реестр"}
            </span>
          )}
          {tx.purpose && tx.purpose !== tx.counterpartyName && (
            <span className="text-[11px] text-slate-300 truncate max-w-[200px]">{tx.purpose}</span>
          )}
        </div>
      </div>

      {/* Amount */}
      <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
        <span className={cn("text-[14px] font-semibold tabular-nums", dir ? "text-emerald-600" : "text-red-500")}>
          {dir ? "+" : "−"}{fmt(tx.amount)} ₽
        </span>

        {/* Actions */}
        {tx.matchStatus === "unmatched" && !tx.isIgnored ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onCreateOp(tx)}
              className="text-[11px] text-violet-600 hover:underline font-medium"
            >
              В реестр
            </button>
            <span className="text-slate-200">|</span>
            <button
              onClick={() => onIgnore(tx.id)}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              Игнор
            </button>
          </div>
        ) : tx.matchStatus === "matched" ? (
          <button
            onClick={() => onUnmatch(tx.id)}
            className="text-[11px] text-slate-400 hover:text-red-500"
          >
            Отвязать
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabT = "all" | "unmatched" | "matched" | "ignored";

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabT>("unmatched");
  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [batchesOpen, setBatchesOpen] = useState(false);
  const [createTx, setCreateTx] = useState<BankTx | null>(null);
  const [page, setPage] = useState(1);

  const matchStatus = tab === "all" ? undefined : tab;

  const { data: monthsRaw } = useGetReconciliationMonths();
  const months = (monthsRaw as string[] | undefined) ?? [];
  const allMonths = useMemo(() => {
    const cm = currentMonth();
    return months.includes(cm) ? months : [cm, ...months];
  }, [months]);

  const { data: statsRaw, isLoading: statsLoading } = useGetReconciliationStats({
    month: month || undefined,
  });
  const stats = statsRaw as {
    total: number; matched: number; unmatched: number; ignored: number;
    matchedPct: number; totalAmountIn: number; totalAmountOut: number;
    unmatchedAmountIn: number; unmatchedAmountOut: number;
  } | undefined;

  const { data: txListRaw, isLoading: txLoading } = useGetReconciliationTransactions({
    month: month || undefined,
    matchStatus: matchStatus || undefined,
    search: search || undefined,
    page,
    limit: 50,
  });
  const txList = txListRaw as {
    transactions: BankTx[]; total: number; pages: number;
  } | undefined;
  const txs = txList?.transactions ?? [];

  const autoMatchMut = useAutoMatch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getReconciliationTransactions"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationStats"] });
      },
    },
  });

  const unmatchMut = useDeleteMatch({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getReconciliationTransactions"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationStats"] });
      },
    },
  });

  const ignoreMut = useIgnoreTransaction({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getReconciliationTransactions"] });
        qc.invalidateQueries({ queryKey: ["getReconciliationStats"] });
      },
    },
  });

  const TABS: { key: TabT; label: string }[] = [
    { key: "unmatched", label: `Не сверено${stats ? ` (${stats.unmatched})` : ""}` },
    { key: "matched",   label: `Сверено${stats ? ` (${stats.matched})` : ""}` },
    { key: "ignored",   label: "Игнорируемые" },
    { key: "all",       label: "Все" },
  ];

  return (
    <div className="min-h-screen bg-[#F7F8FB]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">Сверка с банком</h1>
            <p className="text-[13px] text-slate-400 mt-0.5">
              Сопоставление банковских транзакций с реестром операций
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 rounded-xl text-[13px] border-black/[0.08]"
              onClick={() => setBatchesOpen(true)}
            >
              📋 Выписки
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 rounded-xl text-[13px] border-black/[0.08]"
              disabled={autoMatchMut.isPending}
              onClick={() => autoMatchMut.mutate({ data: { month: month || undefined } })}
            >
              {autoMatchMut.isPending ? "Сверяю…" : "⚡ Авто-сверка"}
            </Button>
            <Button
              size="sm"
              className="h-8 px-4 rounded-xl text-[13px] bg-[hsl(258_88%_56%)] text-white hover:bg-[hsl(258_88%_48%)]"
              onClick={() => setImportOpen(true)}
            >
              + Импорт выписки
            </Button>
          </div>
        </div>

        {/* Auto-match result toast */}
        {autoMatchMut.isSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-[14px] px-4 py-3 text-[13px] text-emerald-700">
            ✓ Авто-сверка: сопоставлено <b>{(autoMatchMut.data as { matched?: number })?.matched ?? 0}</b> транзакций
          </div>
        )}

        {/* Stats */}
        <StatsBar stats={stats} loading={statsLoading} />

        {/* Progress bar */}
        {(stats?.total ?? 0) > 0 && (
          <Card className="px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium text-slate-700">Покрытие сверки</span>
              <span className="text-[13px] font-semibold text-slate-800">{stats?.matchedPct ?? 0}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${stats?.matchedPct ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
              <span>Не сверено: {fmt(stats?.unmatchedAmountOut)} ₽ расход · {fmt(stats?.unmatchedAmountIn)} ₽ приход</span>
              <span>{stats?.total ?? 0} всего</span>
            </div>
          </Card>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Month */}
          <Select value={month} onValueChange={(v) => { setMonth(v); setPage(1); }}>
            <SelectTrigger className="h-8 text-[13px] w-[160px] rounded-xl border-black/[0.08]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allMonths.map((m) => (
                <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[12px]">🔍</span>
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Контрагент, назначение…"
              className="h-8 pl-8 text-[13px] rounded-xl border-black/[0.08]"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white border border-black/[0.06] rounded-[14px] p-1 w-fit flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPage(1); }}
              className={cn(
                "px-3 py-1.5 rounded-[11px] text-[12px] font-medium transition-all whitespace-nowrap",
                tab === t.key
                  ? "bg-[hsl(258_88%_56%)] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Transaction list */}
        {txLoading ? (
          <Card className="overflow-hidden">
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-8 h-8 bg-slate-100 rounded-full animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-48 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </Card>
        ) : txs.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-16 text-slate-400">
            <div className="text-4xl mb-3">
              {tab === "unmatched" ? "✅" : tab === "matched" ? "🔗" : "📋"}
            </div>
            <p className="text-[15px] font-medium text-slate-500">
              {tab === "unmatched" ? "Все транзакции сверены!" : "Нет транзакций"}
            </p>
            <p className="text-[13px] mt-1">
              {tab === "unmatched"
                ? "Импортируйте выписку для начала сверки"
                : "Измените фильтры или импортируйте выписку"}
            </p>
            {tab === "unmatched" && (
              <Button
                className="mt-4 h-8 px-4 rounded-xl text-[13px] bg-[hsl(258_88%_56%)] text-white"
                onClick={() => setImportOpen(true)}
              >
                Импорт выписки
              </Button>
            )}
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="divide-y divide-slate-100/80">
              {txs.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  onCreateOp={setCreateTx}
                  onUnmatch={(id) => unmatchMut.mutate({ bankTxId: id })}
                  onIgnore={(id) => ignoreMut.mutate({ bankTxId: id })}
                />
              ))}
            </div>

            {/* Pagination */}
            {(txList?.pages ?? 1) > 1 && (
              <div className="flex items-center justify-center gap-3 px-5 py-3 border-t border-slate-100">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="text-[13px] text-slate-500 hover:text-slate-800 disabled:opacity-30"
                >
                  ← Назад
                </button>
                <span className="text-[13px] text-slate-400">{page} / {txList?.pages}</span>
                <button
                  disabled={page >= (txList?.pages ?? 1)}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-[13px] text-slate-500 hover:text-slate-800 disabled:opacity-30"
                >
                  Вперёд →
                </button>
              </div>
            )}
          </Card>
        )}

        {txs.length > 0 && (
          <p className="text-[12px] text-slate-400 text-center">
            {txList?.total ?? 0} транзакций · {monthLabel(month)}
          </p>
        )}
      </div>

      {/* Dialogs */}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <BatchesSheet open={batchesOpen} onClose={() => setBatchesOpen(false)} />
      <CreateFromTxDialog
        tx={createTx}
        open={!!createTx}
        onClose={() => setCreateTx(null)}
      />
    </div>
  );
}
