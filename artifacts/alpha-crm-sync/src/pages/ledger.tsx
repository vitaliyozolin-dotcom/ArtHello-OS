import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetArticles,
  useGetLedgerOperations,
  useGetLedgerStats,
  useGetLedgerMonths,
  useGetOperationHistory,
  useCreateLedgerOperation,
  useDeleteLedgerOperation,
  useSeedArticles,
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

type Operation = {
  id: string;
  operationType: string;
  source: string;
  direction: string;
  amount: string;
  currency?: string | null;
  description?: string | null;
  cashflowDate: string;
  accrualDate?: string | null;
  cashflowMonth: string;
  plMonth: string;
  articleId?: string | null;
  articleName?: string | null;
  articleCode?: string | null;
  counterpartyName?: string | null;
  department?: string | null;
  paymentStatus?: string | null;
  verificationStatus?: string | null;
  trustScore?: number | null;
  bankTransactionId?: string | null;
  notes?: string | null;
  createdAt?: string;
  isDeleted?: boolean;
};

type Article = {
  id: string;
  code: string;
  name: string;
  groupName: string;
  type: string;
  affectsDds?: boolean;
  affectsPl?: boolean;
  isFixed?: boolean;
  isActive?: boolean;
};

type HistoryEntry = {
  id: string;
  operationId: string;
  fieldName: string;
  oldValue?: string | null;
  newValue?: string | null;
  changedAt: string;
  changedBy?: string | null;
  changeReason?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(v: string | number | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
}

// ─── Visual config ────────────────────────────────────────────────────────────

const DIR_CONFIG = {
  in:       { label: "Приход",  color: "text-emerald-600", bg: "bg-emerald-50", sign: "+" },
  out:      { label: "Расход",  color: "text-red-500",     bg: "bg-red-50",     sign: "−" },
  internal: { label: "Перевод", color: "text-blue-500",    bg: "bg-blue-50",    sign: "⇄" },
} as const;

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  manual:         { label: "Вручную",  color: "bg-slate-100 text-slate-600" },
  bank_import:    { label: "Банк",     color: "bg-violet-100 text-violet-700" },
  crm_sync:       { label: "CRM",      color: "bg-amber-100 text-amber-700" },
  payroll_import: { label: "Зарплата", color: "bg-blue-100 text-blue-700" },
  tax_import:     { label: "Налоги",   color: "bg-orange-100 text-orange-700" },
};

const VERIF_CONFIG: Record<string, { label: string; color: string }> = {
  unverified:     { label: "Не проверено", color: "bg-slate-100 text-slate-500" },
  pending_review: { label: "На проверке",  color: "bg-amber-100 text-amber-700" },
  verified:       { label: "Проверено",    color: "bg-emerald-100 text-emerald-700" },
  disputed:       { label: "Спорно",       color: "bg-red-100 text-red-600" },
};

const OPERATION_TYPES = [
  { value: "income",     label: "Доход" },
  { value: "expense",    label: "Расход" },
  { value: "transfer",   label: "Перевод" },
  { value: "payroll",    label: "Зарплата" },
  { value: "tax",        label: "Налог" },
  { value: "refund",     label: "Возврат" },
  { value: "adjustment", label: "Корректировка" },
];

// ─── Card shell ───────────────────────────────────────────────────────────────

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

// ─── Stats row ────────────────────────────────────────────────────────────────

function StatsRow({
  totalIn, totalOut, net, totalOperations, trustScore, unverifiedCount, loading,
}: {
  totalIn: number; totalOut: number; net: number;
  totalOperations: number; trustScore: number; unverifiedCount: number;
  loading: boolean;
}) {
  const items = [
    { label: "Приход",       value: formatMoney(totalIn) + " ₽",             color: "text-emerald-600" },
    { label: "Расход",       value: formatMoney(totalOut) + " ₽",            color: "text-red-500" },
    { label: "Нетто",        value: (net >= 0 ? "+" : "−") + formatMoney(Math.abs(net)) + " ₽", color: net >= 0 ? "text-emerald-600" : "text-red-500" },
    { label: "Операций",     value: String(totalOperations),                  color: "text-slate-800" },
    { label: "Trust Score",  value: `${trustScore}%`,                         color: trustScore >= 80 ? "text-emerald-600" : trustScore >= 60 ? "text-amber-500" : "text-red-500" },
    { label: "Не проверено", value: String(unverifiedCount),                  color: unverifiedCount === 0 ? "text-emerald-600" : "text-amber-600" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {items.map((item) => (
        <Card key={item.label} className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">{item.label}</div>
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

// ─── Filter bar ───────────────────────────────────────────────────────────────

type Filters = {
  month: string;
  mode: "dds" | "pl";
  direction: string;
  verificationStatus: string;
  search: string;
};

function FilterBar({
  filters, onChange, months,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  months: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* DDS / PL toggle */}
      <div className="flex rounded-xl overflow-hidden border border-black/[0.08] bg-white">
        {(["dds", "pl"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onChange({ ...filters, mode: m })}
            className={cn(
              "px-3 py-1.5 text-[13px] font-medium transition-colors",
              filters.mode === m
                ? "bg-[hsl(258_88%_56%)] text-white"
                : "text-slate-500 hover:bg-slate-50",
            )}
          >
            {m === "dds" ? "ДДС" : "ОПиУ"}
          </button>
        ))}
      </div>

      {/* Month */}
      <Select value={filters.month} onValueChange={(v) => onChange({ ...filters, month: v })}>
        <SelectTrigger className="h-8 text-[13px] w-[160px] rounded-xl border-black/[0.08]">
          <SelectValue placeholder="Месяц" />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Direction */}
      <Select
        value={filters.direction || "all"}
        onValueChange={(v) => onChange({ ...filters, direction: v === "all" ? "" : v })}
      >
        <SelectTrigger className="h-8 text-[13px] w-[120px] rounded-xl border-black/[0.08]">
          <SelectValue placeholder="Тип" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все</SelectItem>
          <SelectItem value="in">Приход</SelectItem>
          <SelectItem value="out">Расход</SelectItem>
          <SelectItem value="internal">Перевод</SelectItem>
        </SelectContent>
      </Select>

      {/* Verification */}
      <Select
        value={filters.verificationStatus || "all"}
        onValueChange={(v) => onChange({ ...filters, verificationStatus: v === "all" ? "" : v })}
      >
        <SelectTrigger className="h-8 text-[13px] w-[150px] rounded-xl border-black/[0.08]">
          <SelectValue placeholder="Статус" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Любой статус</SelectItem>
          <SelectItem value="unverified">Не проверено</SelectItem>
          <SelectItem value="pending_review">На проверке</SelectItem>
          <SelectItem value="verified">Проверено</SelectItem>
          <SelectItem value="disputed">Спорно</SelectItem>
        </SelectContent>
      </Select>

      {/* Search */}
      <div className="relative flex-1 min-w-[180px]">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[12px]">🔍</span>
        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Поиск по описанию…"
          className="h-8 pl-8 text-[13px] rounded-xl border-black/[0.08]"
        />
      </div>
    </div>
  );
}

// ─── Trust Score pill ─────────────────────────────────────────────────────────

function TrustPill({ score }: { score: number | null | undefined }) {
  const s = score ?? 50;
  const color =
    s >= 80 ? "bg-emerald-100 text-emerald-700"
    : s >= 60 ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-600";
  return (
    <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded-md", color)}>{s}%</span>
  );
}

// ─── Operations table ─────────────────────────────────────────────────────────

function OperationsTable({
  ops, onSelect, loading,
}: {
  ops: Operation[];
  onSelect: (op: Operation) => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="overflow-hidden">
        <div className="divide-y divide-slate-100">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
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
    );
  }

  if (ops.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center py-16 text-slate-400">
        <div className="text-4xl mb-3">📋</div>
        <p className="text-[15px] font-medium text-slate-500">Операций нет</p>
        <p className="text-[13px] mt-1">Добавьте операцию или измените фильтры</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-slate-100/80">
        {ops.map((op) => {
          const dir = DIR_CONFIG[op.direction as keyof typeof DIR_CONFIG] ?? DIR_CONFIG.out;
          const verif = VERIF_CONFIG[op.verificationStatus ?? "unverified"];
          const src = SOURCE_CONFIG[op.source] ?? SOURCE_CONFIG.manual;

          return (
            <button
              key={op.id}
              onClick={() => onSelect(op)}
              className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[#F7F8FB] transition-colors text-left"
            >
              {/* Direction dot */}
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[15px] font-semibold",
                dir.bg, dir.color,
              )}>
                {dir.sign}
              </div>

              {/* Main info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-medium text-slate-800 truncate max-w-[260px]">
                    {op.description || op.articleName || op.operationType}
                  </span>
                  {op.articleCode && (
                    <span className="text-[11px] text-slate-400 font-mono">{op.articleCode}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[12px] text-slate-400">{formatDate(op.cashflowDate)}</span>
                  {op.counterpartyName && (
                    <span className="text-[12px] text-slate-400">· {op.counterpartyName}</span>
                  )}
                  <span className={cn("text-[11px] px-1.5 py-0.5 rounded-md font-medium", src.color)}>
                    {src.label}
                  </span>
                  <span className={cn("text-[11px] px-1.5 py-0.5 rounded-md font-medium", verif.color)}>
                    {verif.label}
                  </span>
                  {op.cashflowMonth !== op.plMonth && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 font-medium">
                      ОПиУ: {op.plMonth}
                    </span>
                  )}
                </div>
              </div>

              {/* Amount */}
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={cn("text-[15px] font-semibold tabular-nums", dir.color)}>
                  {op.direction === "in" ? "+" : op.direction === "out" ? "−" : ""}
                  {formatMoney(op.amount)} ₽
                </span>
                <TrustPill score={op.trustScore} />
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─── History section (isolated so hook isn't called with empty id) ────────────

function HistorySection({ operationId }: { operationId: string }) {
  const { data: historyRaw } = useGetOperationHistory(operationId);
  const history = (historyRaw as HistoryEntry[] | undefined) ?? [];

  const FIELD_LABEL: Record<string, string> = {
    _created: "Создание", _deleted: "Удаление",
    description: "Описание", amount: "Сумма", direction: "Направление",
    article_id: "Статья", verification_status: "Статус проверки",
    cashflow_date: "Дата ДДС", accrual_date: "Дата ОПиУ",
    notes: "Заметки", payment_status: "Статус оплаты",
    counterparty_name: "Контрагент",
  };

  if (history.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
        История изменений
      </div>
      <div className="space-y-2">
        {history.map((h) => (
          <div key={h.id} className="bg-slate-50 rounded-[12px] px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-medium text-slate-600">
                {FIELD_LABEL[h.fieldName] ?? h.fieldName}
              </span>
              <span className="text-[11px] text-slate-400">{formatDate(h.changedAt)}</span>
            </div>
            {h.oldValue && <div className="text-[12px] text-slate-400 line-through">{h.oldValue}</div>}
            {h.newValue && <div className="text-[12px] text-slate-700">{h.newValue}</div>}
            {h.changeReason && (
              <div className="text-[11px] text-slate-400 mt-0.5">Причина: {h.changeReason}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Operation detail drawer ──────────────────────────────────────────────────

function OperationDrawer({
  op, open, onClose, onDelete,
}: {
  op: Operation | null;
  open: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {

  if (!op) return null;

  const dir = DIR_CONFIG[op.direction as keyof typeof DIR_CONFIG] ?? DIR_CONFIG.out;
  const verif = VERIF_CONFIG[op.verificationStatus ?? "unverified"];
  const src = SOURCE_CONFIG[op.source] ?? SOURCE_CONFIG.manual;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto" side="right">
        <SheetHeader className="mb-5">
          <SheetTitle className="text-[17px] font-semibold text-slate-800">Операция</SheetTitle>
        </SheetHeader>

        {/* Hero amount */}
        <div className={cn("rounded-[18px] p-4 mb-5", dir.bg)}>
          <div className={cn("text-[12px] font-semibold uppercase tracking-wide mb-1", dir.color)}>
            {dir.label}
          </div>
          <div className={cn("text-[30px] font-bold tabular-nums", dir.color)}>
            {op.direction === "in" ? "+" : op.direction === "out" ? "−" : ""}
            {formatMoney(op.amount)} ₽
          </div>
          {op.description && (
            <div className="text-[14px] text-slate-600 mt-1">{op.description}</div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-2.5 text-[13px] mb-4">
          {[
            { label: "Дата ДДС", value: new Date(op.cashflowDate).toLocaleDateString("ru-RU") },
            op.accrualDate ? { label: "Дата ОПиУ", value: new Date(op.accrualDate).toLocaleDateString("ru-RU") } : null,
            op.cashflowMonth !== op.plMonth ? { label: "⚠️ Разные периоды", value: `ДДС: ${op.cashflowMonth} · ОПиУ: ${op.plMonth}` } : null,
            op.articleCode ? { label: "Статья", value: `${op.articleCode} — ${op.articleName ?? ""}` } : null,
            op.counterpartyName ? { label: "Контрагент", value: op.counterpartyName } : null,
            op.bankTransactionId ? { label: "ID банка", value: op.bankTransactionId } : null,
            op.notes ? { label: "Заметки", value: op.notes } : null,
          ].filter(Boolean).map((item) => (
            <div key={item!.label} className="flex justify-between gap-3">
              <span className="text-slate-400 shrink-0">{item!.label}</span>
              <span className="text-slate-700 text-right">{item!.value}</span>
            </div>
          ))}
        </div>

        {/* Badges */}
        <div className="flex gap-2 flex-wrap">
          <span className={cn("text-[12px] px-2 py-1 rounded-lg font-medium", src.color)}>{src.label}</span>
          <span className={cn("text-[12px] px-2 py-1 rounded-lg font-medium", verif.color)}>{verif.label}</span>
          {op.trustScore != null && <TrustPill score={op.trustScore} />}
        </div>

        {/* Audit history */}
        <HistorySection operationId={op.id} />

        {/* Actions */}
        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 rounded-xl text-red-500 border-red-200 hover:bg-red-50"
            onClick={() => { onDelete(op.id); onClose(); }}
          >
            Удалить
          </Button>
          <Button variant="outline" size="sm" className="flex-1 rounded-xl" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Create operation modal ───────────────────────────────────────────────────

const EMPTY_FORM = {
  operationType: "expense",
  direction: "out" as "in" | "out" | "internal",
  amount: "",
  description: "",
  cashflowDate: new Date().toISOString().slice(0, 10),
  accrualDate: "",
  articleId: "",
  counterpartyName: "",
  notes: "",
  paymentStatus: "paid",
  verificationStatus: "unverified",
};

function CreateModal({
  open, onClose, articles, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  articles: Article[];
  onSuccess: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const qc = useQueryClient();

  const create = useCreateLedgerOperation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getLedgerOperations"] });
        qc.invalidateQueries({ queryKey: ["getLedgerStats"] });
        setForm(EMPTY_FORM);
        onSuccess();
      },
    },
  });

  const set = (k: keyof typeof EMPTY_FORM, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleTypeChange = (t: string) => {
    const dir = t === "income" || t === "refund" ? "in" : t === "transfer" ? "internal" : "out";
    setForm((prev) => ({ ...prev, operationType: t, direction: dir as "in" | "out" | "internal" }));
  };

  const handleSubmit = () => {
    if (!form.amount || !form.cashflowDate) return;
    create.mutate({
      data: {
        operationType: form.operationType,
        direction: form.direction,
        amount: parseFloat(form.amount),
        description: form.description || undefined,
        cashflowDate: new Date(form.cashflowDate).toISOString(),
        accrualDate: form.accrualDate ? new Date(form.accrualDate).toISOString() : undefined,
        articleId: form.articleId || undefined,
        counterpartyName: form.counterpartyName || undefined,
        notes: form.notes || undefined,
        paymentStatus: form.paymentStatus,
        verificationStatus: form.verificationStatus,
        source: "manual",
        createdBy: "owner",
      },
    });
  };

  const groupedArticles = useMemo(() => {
    const g: Record<string, Article[]> = {};
    for (const a of articles) {
      if (!g[a.groupName]) g[a.groupName] = [];
      g[a.groupName].push(a);
    }
    return g;
  }, [articles]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[520px] rounded-[24px] p-6">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold text-slate-800">
            Новая операция
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Type + Direction */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px] text-slate-500 mb-1.5 block">Тип операции</Label>
              <Select value={form.operationType} onValueChange={handleTypeChange}>
                <SelectTrigger className="rounded-xl h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px] text-slate-500 mb-1.5 block">Направление</Label>
              <Select value={form.direction} onValueChange={(v) => set("direction", v)}>
                <SelectTrigger className="rounded-xl h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">↑ Приход</SelectItem>
                  <SelectItem value="out">↓ Расход</SelectItem>
                  <SelectItem value="internal">⇄ Перевод</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Amount */}
          <div>
            <Label className="text-[12px] text-slate-500 mb-1.5 block">Сумма, ₽</Label>
            <Input
              type="number"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="0"
              className="rounded-xl h-9 text-[15px] font-semibold"
            />
          </div>

          {/* Description */}
          <div>
            <Label className="text-[12px] text-slate-500 mb-1.5 block">Описание</Label>
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Что за операция?"
              className="rounded-xl h-9"
            />
          </div>

          {/* Article */}
          <div>
            <Label className="text-[12px] text-slate-500 mb-1.5 block">Статья ДДС/ОПиУ</Label>
            <Select
              value={form.articleId || "__none"}
              onValueChange={(v) => set("articleId", v === "__none" ? "" : v)}
            >
              <SelectTrigger className="rounded-xl h-9">
                <SelectValue placeholder="Выберите статью…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Без статьи</SelectItem>
                {Object.entries(groupedArticles).map(([group, arts]) => (
                  <div key={group}>
                    <div className="px-2 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      {group}
                    </div>
                    {arts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px] text-slate-500 mb-1.5 block">Дата ДДС (факт)</Label>
              <Input
                type="date"
                value={form.cashflowDate}
                onChange={(e) => set("cashflowDate", e.target.value)}
                className="rounded-xl h-9"
              />
            </div>
            <div>
              <Label className="text-[12px] text-slate-500 mb-1.5 block">Дата ОПиУ (если отличается)</Label>
              <Input
                type="date"
                value={form.accrualDate}
                onChange={(e) => set("accrualDate", e.target.value)}
                className="rounded-xl h-9"
              />
            </div>
          </div>

          {/* Counterparty */}
          <div>
            <Label className="text-[12px] text-slate-500 mb-1.5 block">Контрагент</Label>
            <Input
              value={form.counterpartyName}
              onChange={(e) => set("counterpartyName", e.target.value)}
              placeholder="ООО «Пример»"
              className="rounded-xl h-9"
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-[12px] text-slate-500 mb-1.5 block">Заметки</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Дополнительная информация…"
              className="rounded-xl text-[13px] resize-none h-16"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button variant="outline" className="flex-1 rounded-xl h-9" onClick={onClose}>
              Отмена
            </Button>
            <Button
              className="flex-1 rounded-xl h-9 bg-[hsl(258_88%_56%)] hover:bg-[hsl(258_88%_48%)] text-white"
              onClick={handleSubmit}
              disabled={create.isPending || !form.amount}
            >
              {create.isPending ? "Сохранение…" : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Articles panel ───────────────────────────────────────────────────────────

function ArticlesPanel({
  articles, loading, onSeed, seeding,
}: {
  articles: Article[];
  loading: boolean;
  onSeed: () => void;
  seeding: boolean;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, Article[]> = {};
    for (const a of articles) {
      if (!g[a.groupName]) g[a.groupName] = [];
      g[a.groupName].push(a);
    }
    return g;
  }, [articles]);

  const typeArrow = (t: string) =>
    t === "income" ? "▲" : t === "expense" ? "▼" : "⇄";
  const typeColor = (t: string) =>
    t === "income" ? "text-emerald-600" : t === "expense" ? "text-red-500" : "text-blue-500";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800">Статьи ДДС/ОПиУ</h3>
          <p className="text-[12px] text-slate-400 mt-0.5">Классификация всех операций по категориям</p>
        </div>
        {articles.length === 0 && (
          <Button
            size="sm"
            disabled={seeding}
            onClick={onSeed}
            className="h-8 px-4 rounded-xl text-[13px] bg-[hsl(258_88%_56%)] text-white hover:bg-[hsl(258_88%_48%)]"
          >
            {seeding ? "Загрузка…" : "Загрузить 28 статей"}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <Card className="px-5 py-10 text-center">
          <div className="text-3xl mb-3">📂</div>
          <p className="text-[14px] font-medium text-slate-600 mb-1">Статьи не загружены</p>
          <p className="text-[13px] text-slate-400">
            Нажмите «Загрузить 28 статей» чтобы добавить стандартный план счетов для образовательного бизнеса.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([group, arts]) => (
            <Card key={group} className="overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-100">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  {group}
                </span>
              </div>
              <div className="divide-y divide-slate-100/80">
                {arts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-[12px] font-mono text-slate-400 w-8 shrink-0">{a.code}</span>
                    <span className="text-[13px] text-slate-700 flex-1">{a.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-[11px] font-bold", typeColor(a.type))}>
                        {typeArrow(a.type)}
                      </span>
                      {a.isFixed && (
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">
                          Фикс
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LedgerPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"operations" | "articles">("operations");
  const [selectedOp, setSelectedOp] = useState<Operation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    month: currentMonth(),
    mode: "dds",
    direction: "",
    verificationStatus: "",
    search: "",
  });

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: monthsRaw } = useGetLedgerMonths();
  const { data: articlesRaw, isLoading: articlesLoading } = useGetArticles();

  const { data: statsRaw, isLoading: statsLoading } = useGetLedgerStats({
    month: filters.month || undefined,
    mode: filters.mode,
  });

  const { data: opsRaw, isLoading: opsLoading } = useGetLedgerOperations({
    page: 1,
    limit: 100,
    month: filters.month || undefined,
    mode: filters.mode,
    direction: filters.direction || undefined,
    verificationStatus: filters.verificationStatus || undefined,
    search: filters.search || undefined,
  });

  const months = (monthsRaw as string[] | undefined) ?? [];
  const articles = (articlesRaw as Article[] | undefined) ?? [];
  const stats = statsRaw as {
    totalIn: number; totalOut: number; net: number;
    totalOperations: number; trustScore: number; unverifiedCount: number;
  } | undefined;
  const ops = ((opsRaw as { operations?: Operation[] } | undefined)?.operations ?? []) as Operation[];

  // Ensure current month always appears in filter
  const allMonths = useMemo(() => {
    const cm = currentMonth();
    return months.includes(cm) ? months : [cm, ...months];
  }, [months]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const seedMutation = useSeedArticles({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: ["getArticles"] }),
    },
  });

  const deleteMutation = useDeleteLedgerOperation({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getLedgerOperations"] });
        qc.invalidateQueries({ queryKey: ["getLedgerStats"] });
      },
    },
  });

  return (
    <div className="min-h-screen bg-[#F7F8FB]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">Реестр операций</h1>
            <p className="text-[13px] text-slate-400 mt-0.5">
              ДДС и ОПиУ — все движения денег в одном месте
            </p>
          </div>
          <Button
            className="h-9 px-4 rounded-xl bg-[hsl(258_88%_56%)] hover:bg-[hsl(258_88%_48%)] text-white text-[13px] font-medium shadow-sm shrink-0"
            onClick={() => setCreateOpen(true)}
          >
            + Добавить
          </Button>
        </div>

        {/* Stats */}
        <StatsRow
          totalIn={stats?.totalIn ?? 0}
          totalOut={stats?.totalOut ?? 0}
          net={stats?.net ?? 0}
          totalOperations={stats?.totalOperations ?? 0}
          trustScore={stats?.trustScore ?? 0}
          unverifiedCount={stats?.unverifiedCount ?? 0}
          loading={statsLoading}
        />

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-black/[0.06] rounded-[14px] p-1 w-fit">
          {(["operations", "articles"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-1.5 rounded-[11px] text-[13px] font-medium transition-all",
                tab === t
                  ? "bg-[hsl(258_88%_56%)] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {t === "operations" ? "Операции" : "Статьи ДДС/ОПиУ"}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "operations" ? (
          <>
            <FilterBar filters={filters} onChange={setFilters} months={allMonths} />
            <OperationsTable ops={ops} onSelect={setSelectedOp} loading={opsLoading} />
            {ops.length > 0 && (
              <p className="text-[12px] text-slate-400 text-center">
                {ops.length} операций · {monthLabel(filters.month)}
              </p>
            )}
          </>
        ) : (
          <ArticlesPanel
            articles={articles}
            loading={articlesLoading}
            onSeed={() => seedMutation.mutate()}
            seeding={seedMutation.isPending}
          />
        )}
      </div>

      {/* Drawers + modals */}
      <OperationDrawer
        op={selectedOp}
        open={!!selectedOp}
        onClose={() => setSelectedOp(null)}
        onDelete={(id) => deleteMutation.mutate({ id })}
      />

      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        articles={articles}
        onSuccess={() => setCreateOpen(false)}
      />
    </div>
  );
}
