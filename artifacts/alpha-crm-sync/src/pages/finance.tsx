import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetFinanceStats,
  useGetDdsReport,
  useGetOpiuReport,
  useGetBankTransactions,
  useGetUnclearTransactions,
  useGetCategorizationRules,
  useGetDdsCategories,
  useGetOpiuCategories,
  useCategorizeBankTransaction,
  useCreateCategorizationRule,
  useAutoCategorize,
  getGetFinanceStatsQueryKey,
  getGetBankTransactionsQueryKey,
  getGetUnclearTransactionsQueryKey,
  getGetCategorizationRulesQueryKey,
  getGetDdsReportQueryKey,
  getGetOpiuReportQueryKey,
  getGetDdsCategoriesQueryKey,
  getGetOpiuCategoriesQueryKey,
  type BankTransaction,
  type CategorizationRule,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Upload, RefreshCw, AlertCircle, CheckCircle, Loader2,
  TrendingUp, TrendingDown, Minus, Settings, Eye, Plus,
  ChevronDown, ChevronUp, Zap, CircleDollarSign, ArrowUpDown,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number | string | null | undefined, currency = true) => {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(num)) return '—';
  return currency
    ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(num)
    : num.toLocaleString('ru-RU');
};

const dirBadge = (dir: string | null | undefined) =>
  dir === 'income'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

// ─── Sub-tab ─────────────────────────────────────────────────────────────────

type SubTab = 'dds' | 'import' | 'unclear' | 'transactions' | 'rules' | 'opiu';

const SUBTABS: { key: SubTab; label: string }[] = [
  { key: 'dds',          label: 'ДДС' },
  { key: 'opiu',         label: 'ОПиУ' },
  { key: 'import',       label: 'Импорт банка' },
  { key: 'unclear',      label: 'Непонятные' },
  { key: 'transactions', label: 'Все операции' },
  { key: 'rules',        label: 'Правила' },
];

// ─── Bank Import Wizard ───────────────────────────────────────────────────────

interface PreviewResult {
  filename: string;
  sheetName: string;
  totalRows: number;
  headers: string[];
  detectedMapping: Record<string, string | undefined>;
  preview: Record<string, unknown>[];
}

interface MappingState {
  operationDate?: string;
  counterpartyName?: string;
  counterpartyInn?: string;
  purpose?: string;
  amountIncome?: string;
  amountExpense?: string;
  amount?: string;
  direction?: string;
  accountName?: string;
  accountNumber?: string;
}

function BankImport({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<MappingState>({});
  const [meta, setMeta] = useState({ bankName: '', accountName: '', accountNumber: '', branchName: '', branchCrmId: '' });
  const [importResult, setImportResult] = useState<{ imported: number; unclear: number; skipped: number; message: string } | null>(null);

  const handlePreview = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Выберите файл'); return; }
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`${BASE}/api/finance/bank/preview`, { method: 'POST', body: fd });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText); }
      const data: PreviewResult = await r.json();
      setPreview(data);
      setMapping(data.detectedMapping as MappingState);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !preview) return;
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('bankName', meta.bankName);
      fd.append('accountName', meta.accountName);
      fd.append('accountNumber', meta.accountNumber);
      fd.append('branchName', meta.branchName);
      fd.append('branchCrmId', meta.branchCrmId);
      fd.append('mapping', JSON.stringify(mapping));
      const r = await fetch(`${BASE}/api/finance/bank/import`, { method: 'POST', body: fd });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || r.statusText); }
      const data = await r.json();
      setImportResult(data);
      setStep(3);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  };

  const MAPPING_FIELDS: { key: keyof MappingState; label: string }[] = [
    { key: 'operationDate',    label: 'Дата операции' },
    { key: 'counterpartyName', label: 'Контрагент' },
    { key: 'counterpartyInn',  label: 'ИНН' },
    { key: 'purpose',          label: 'Назначение платежа' },
    { key: 'amountIncome',     label: 'Сумма (приход)' },
    { key: 'amountExpense',    label: 'Сумма (расход)' },
    { key: 'amount',           label: 'Сумма (общая)' },
    { key: 'direction',        label: 'Направление (доп.)' },
    { key: 'accountName',      label: 'Счёт (название)' },
    { key: 'accountNumber',    label: 'Счёт (номер)' },
  ];

  return (
    <div className="space-y-4">
      {/* Step indicators */}
      <div className="flex items-center gap-2 text-sm">
        {([1, 2, 3] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-border" />}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${step === s ? 'bg-primary text-primary-foreground border-primary' : step > s ? 'bg-muted text-muted-foreground border-muted' : 'border-border text-muted-foreground'}`}>
              {step > s ? <CheckCircle className="w-3 h-3" /> : <span>{s}</span>}
              {['Файл', 'Маппинг', 'Готово'][i]}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Step 1: File + metadata */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-xl p-8 text-center space-y-3 hover:border-primary/50 transition-colors">
            <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">CSV или XLSX выписка из банка</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={() => setError(null)}
              id="bank-file-input"
            />
            <label htmlFor="bank-file-input">
              <Button variant="outline" size="sm" asChild>
                <span className="cursor-pointer">Выбрать файл</span>
              </Button>
            </label>
            {fileRef.current?.files?.[0] && (
              <p className="text-xs text-primary font-medium">{fileRef.current.files[0].name}</p>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {([
              { key: 'bankName',      label: 'Банк', placeholder: 'Сбербанк' },
              { key: 'accountName',   label: 'Название счёта', placeholder: 'Расчётный счёт' },
              { key: 'accountNumber', label: 'Номер счёта', placeholder: '40702810...' },
              { key: 'branchName',    label: 'Филиал', placeholder: 'Атлас' },
              { key: 'branchCrmId',   label: 'Branch CRM ID', placeholder: '6' },
            ] as const).map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
                <Input
                  placeholder={placeholder}
                  value={meta[key]}
                  onChange={e => setMeta(m => ({ ...m, [key]: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
          <Button onClick={handlePreview} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Разобрать файл
          </Button>
        </div>
      )}

      {/* Step 2: Column mapping + preview */}
      {step === 2 && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{preview.filename}</span>
              {' · '}{preview.totalRows} строк · лист «{preview.sheetName}»
            </p>
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>← Назад</Button>
          </div>

          {/* Mapping */}
          <Card>
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-sm">Соответствие столбцов</CardTitle>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {MAPPING_FIELDS.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
                  <Select
                    value={mapping[key] ?? '__none__'}
                    onValueChange={v => setMapping(m => ({ ...m, [key]: v === '__none__' ? undefined : v }))}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— не используется —</SelectItem>
                      {preview.headers.map(h => (
                        <SelectItem key={h} value={h} className="text-xs font-mono">{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Data preview table */}
          <Card>
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-sm">Первые {preview.preview.length} строк</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    {preview.headers.slice(0, 8).map(h => (
                      <TableHead key={h} className="text-[10px] whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.preview.map((row, i) => (
                    <TableRow key={i} className="text-[10px] font-mono">
                      {preview.headers.slice(0, 8).map(h => (
                        <TableCell key={h} className="py-1 max-w-[120px] truncate">{String(row[h] ?? '')}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button onClick={handleImport} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Импортировать {preview.totalRows} строк
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Result */}
      {step === 3 && importResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">{importResult.message}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Импортировано', value: importResult.imported, color: 'text-green-700 dark:text-green-400' },
              { label: 'Непонятные',    value: importResult.unclear,  color: 'text-yellow-600 dark:text-yellow-400' },
              { label: 'Пропущено',     value: importResult.skipped,  color: 'text-muted-foreground' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-muted/40 rounded-xl p-4 text-center border">
                <div className={`text-3xl font-mono font-bold ${color}`}>{value}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
              </div>
            ))}
          </div>
          {importResult.unclear > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-700 dark:text-yellow-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {importResult.unclear} операций не распознаны. Перейдите на вкладку «Непонятные» чтобы назначить категории вручную и создать правила.
              </span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => { setStep(1); setImportResult(null); setPreview(null); if (fileRef.current) fileRef.current.value = ''; }}>
            Импортировать ещё один файл
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Unclear Transactions ─────────────────────────────────────────────────────

function UnclearTransactions({ ddsCategories, opiuCategories }: {
  ddsCategories: { id: string; category: string | null | undefined; groupName: string | null | undefined; direction: string | null | undefined }[];
  opiuCategories: { id: string; category: string | null | undefined; groupName: string | null | undefined; type: string | null | undefined }[];
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetUnclearTransactions({ limit: 100 });
  const categorize = useCategorizeBankTransaction();
  const createRule = useCreateCategorizationRule();
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [form, setForm] = useState({ ddsCategory: '', opiuCategory: '', isPayroll: false, isCapex: false, isDebtBody: false, isDebtInterest: false, isTax: false, isTransferBetweenOwnAccounts: false });
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [saving, setSaving] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetUnclearTransactionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFinanceStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBankTransactionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDdsReportQueryKey() });
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    categorize.mutate(
      { id: selected.id, data: { ...form } },
      {
        onSuccess: () => {
          if (showCreateRule) {
            createRule.mutate({
              data: {
                ruleName: `${selected.counterpartyName ?? selected.purpose ?? 'Rule'}`,
                direction: selected.direction ?? undefined,
                counterpartyContains: selected.counterpartyName ? [selected.counterpartyName] : [],
                purposeContains: [],
                ddsCategory: form.ddsCategory || undefined,
                opiuCategory: form.opiuCategory || undefined,
                flags: {
                  isPayroll: form.isPayroll,
                  isCapex: form.isCapex,
                  isDebtBody: form.isDebtBody,
                  isDebtInterest: form.isDebtInterest,
                  isTax: form.isTax,
                  isTransfer: form.isTransferBetweenOwnAccounts,
                },
              },
            }, { onSuccess: () => { invalidate(); setSelected(null); setSaving(false); } });
          } else {
            invalidate(); setSelected(null); setSaving(false);
          }
        },
      }
    );
  };

  if (isLoading) return <p className="text-center text-muted-foreground py-12 text-sm">Загрузка…</p>;
  const txns = data?.transactions ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* List */}
      <div className="lg:col-span-2">
        {txns.length === 0
          ? (
            <div className="text-center py-16 space-y-2">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">Нет непонятных операций</p>
              <p className="text-xs text-muted-foreground">Все транзакции категоризированы</p>
            </div>
          )
          : (
            <div className="overflow-auto border rounded-lg">
              <Table>
                <TableHeader className="bg-muted/30 sticky top-0">
                  <TableRow>
                    <TableHead className="text-xs w-24">Дата</TableHead>
                    <TableHead className="text-xs">Контрагент / Назначение</TableHead>
                    <TableHead className="text-xs text-right">Сумма</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txns.map(tx => (
                    <TableRow
                      key={tx.id}
                      className={`cursor-pointer text-xs hover:bg-muted/40 ${selected?.id === tx.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                      onClick={() => { setSelected(tx); setForm({ ddsCategory: '', opiuCategory: '', isPayroll: false, isCapex: false, isDebtBody: false, isDebtInterest: false, isTax: false, isTransferBetweenOwnAccounts: false }); setShowCreateRule(false); }}
                    >
                      <TableCell className="py-2 font-mono text-muted-foreground whitespace-nowrap">{tx.operationDate ?? '—'}</TableCell>
                      <TableCell className="py-2 max-w-[200px]">
                        <p className="truncate font-medium">{tx.counterpartyName ?? '—'}</p>
                        <p className="truncate text-muted-foreground text-[10px]">{tx.purpose ?? ''}</p>
                      </TableCell>
                      <TableCell className={`py-2 text-right font-mono font-semibold ${tx.direction === 'income' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {tx.direction === 'income' ? '+' : '−'}{fmt(tx.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </div>

      {/* Category form */}
      <div>
        {selected ? (
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm">Назначить категорию</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
                <p className="font-medium">{selected.counterpartyName ?? '—'}</p>
                <p className="text-muted-foreground line-clamp-2">{selected.purpose ?? '—'}</p>
                <p className={`font-mono font-bold text-sm ${selected.direction === 'income' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {selected.direction === 'income' ? '+' : '−'}{fmt(selected.amount)}
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">ДДС категория</label>
                <Select value={form.ddsCategory || '__none__'} onValueChange={v => setForm(f => ({ ...f, ddsCategory: v === '__none__' ? '' : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Выберите…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— не указано —</SelectItem>
                    {ddsCategories.filter(c => !c.direction || c.direction === selected.direction).map(c => (
                      <SelectItem key={c.id} value={c.category ?? c.id} className="text-xs">
                        {c.groupName ? `${c.groupName} → ` : ''}{c.category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">ОПиУ категория</label>
                <Select value={form.opiuCategory || '__none__'} onValueChange={v => setForm(f => ({ ...f, opiuCategory: v === '__none__' ? '' : v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Выберите…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— не указано —</SelectItem>
                    <SelectItem value="non_opiu" className="text-xs text-muted-foreground">— Не-ОПиУ —</SelectItem>
                    {opiuCategories.map(c => (
                      <SelectItem key={c.id} value={c.category ?? c.id} className="text-xs">
                        {c.type?.toUpperCase()}: {c.category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {([
                  { key: 'isPayroll', label: 'Зарплата' },
                  { key: 'isCapex', label: 'Капекс' },
                  { key: 'isDebtBody', label: 'Тело долга' },
                  { key: 'isDebtInterest', label: 'Проценты' },
                  { key: 'isTax', label: 'Налог' },
                  { key: 'isTransferBetweenOwnAccounts', label: 'Внутр. перевод' },
                ] as const).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                      className="w-3.5 h-3.5 accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>

              <label className="flex items-center gap-2 text-xs cursor-pointer select-none border rounded-lg px-3 py-2 hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={showCreateRule}
                  onChange={e => setShowCreateRule(e.target.checked)}
                  className="w-3.5 h-3.5 accent-primary"
                />
                <span className="flex-1">Создать правило для похожих операций</span>
              </label>

              <Button size="sm" className="w-full gap-1.5" onClick={handleSave} disabled={saving || (!form.ddsCategory && !form.opiuCategory)}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Сохранить{showCreateRule ? ' и создать правило' : ''}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
            Выберите операцию слева чтобы назначить категорию
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DDS Report ───────────────────────────────────────────────────────────────

function DdsSection() {
  const { data, isLoading } = useGetDdsReport(undefined, { query: { refetchInterval: 15000, queryKey: getGetDdsReportQueryKey() } });
  const [showAll, setShowAll] = useState(false);

  if (isLoading) return <p className="text-center text-muted-foreground py-12 text-sm">Загрузка ДДС…</p>;
  if (!data) return null;

  const { monthly, unclearCount, currentMonth } = data;
  const net = (currentMonth.income ?? 0) - (currentMonth.expense ?? 0);

  // Group monthly rows by month, then by direction+category
  const byMonth: Record<string, { income: Record<string, number>; expense: Record<string, number> }> = {};
  for (const row of (monthly as Record<string, unknown>[])) {
    const month = String(row['month'] ?? '');
    const dir   = String(row['direction'] ?? 'expense');
    const cat   = String(row['dds_category'] ?? 'Без категории');
    const total = Number(row['total'] ?? 0);
    if (!byMonth[month]) byMonth[month] = { income: {}, expense: {} };
    const bucket = dir === 'income' ? byMonth[month].income : byMonth[month].expense;
    bucket[cat] = (bucket[cat] ?? 0) + total;
  }

  const months = Object.keys(byMonth).sort().reverse();
  const shown = showAll ? months : months.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Current month header */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Поступления (месяц)</p>
          <p className="text-3xl font-mono text-green-700 dark:text-green-400">{fmt(currentMonth.income)}</p>
        </div>
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Расходы (месяц)</p>
          <p className="text-3xl font-mono text-red-600 dark:text-red-400">{fmt(currentMonth.expense)}</p>
        </div>
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Чистый поток</p>
          <p className={`text-3xl font-mono ${net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmt(net)}</p>
        </div>
      </div>

      {unclearCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-xl text-sm text-yellow-700 dark:text-yellow-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">{unclearCount} операций без категории</span>
          <span className="text-xs">— не учитываются в ДДС. Перейдите на вкладку «Непонятные».</span>
        </div>
      )}

      {months.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <CircleDollarSign className="w-10 h-10 mx-auto opacity-30" />
          <p className="text-sm">Нет данных. Импортируйте банковскую выписку.</p>
        </div>
      ) : (
        <>
          {shown.map(month => {
            const { income, expense } = byMonth[month];
            const totalIncome  = Object.values(income).reduce((s, v) => s + v, 0);
            const totalExpense = Object.values(expense).reduce((s, v) => s + v, 0);
            const netMonth = totalIncome - totalExpense;
            return (
              <Card key={month}>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{month}</span>
                    <div className="flex items-center gap-3 font-mono text-sm">
                      <span className="text-green-700 dark:text-green-400">+{fmt(totalIncome)}</span>
                      <span className="text-red-600 dark:text-red-400">−{fmt(totalExpense)}</span>
                      <span className={`font-bold ${netMonth >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{netMonth >= 0 ? '+' : '−'}{fmt(Math.abs(netMonth))}</span>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x">
                    {/* Income */}
                    <div>
                      <p className="text-[10px] font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider px-4 pt-3 pb-1">Поступления</p>
                      {Object.entries(income).map(([cat, amt]) => (
                        <div key={cat} className="flex items-center justify-between px-4 py-1.5 text-xs">
                          <span className="text-muted-foreground truncate max-w-[160px]">{cat}</span>
                          <span className="font-mono font-semibold text-green-700 dark:text-green-400">{fmt(amt)}</span>
                        </div>
                      ))}
                      {Object.keys(income).length === 0 && <p className="px-4 py-2 text-xs text-muted-foreground">—</p>}
                    </div>
                    {/* Expense */}
                    <div>
                      <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider px-4 pt-3 pb-1">Расходы</p>
                      {Object.entries(expense).sort(([, a], [, b]) => b - a).map(([cat, amt]) => (
                        <div key={cat} className="flex items-center justify-between px-4 py-1.5 text-xs">
                          <span className="text-muted-foreground truncate max-w-[160px]">{cat}</span>
                          <span className="font-mono font-semibold text-red-600 dark:text-red-400">{fmt(amt)}</span>
                        </div>
                      ))}
                      {Object.keys(expense).length === 0 && <p className="px-4 py-2 text-xs text-muted-foreground">—</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {months.length > 3 && (
            <Button variant="ghost" size="sm" className="w-full gap-1.5 text-muted-foreground" onClick={() => setShowAll(v => !v)}>
              {showAll ? <><ChevronUp className="w-4 h-4" />Свернуть</> : <><ChevronDown className="w-4 h-4" />Показать все {months.length} месяцев</>}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ─── P&L Report ──────────────────────────────────────────────────────────────

function OpiuSection() {
  const { data, isLoading } = useGetOpiuReport(undefined, { query: { refetchInterval: 30000, queryKey: getGetOpiuReportQueryKey() } });

  if (isLoading) return <p className="text-center text-muted-foreground py-12 text-sm">Загрузка ОПиУ…</p>;
  if (!data || data.rows.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground space-y-2">
        <TrendingUp className="w-10 h-10 mx-auto opacity-30" />
        <p className="text-sm">ОПиУ формируется автоматически из категоризированных транзакций.</p>
        <p className="text-xs">Импортируйте выписку и назначьте категории ОПиУ.</p>
      </div>
    );
  }

  const rows = data.rows as Record<string, unknown>[];

  if (data.source === 'opiu_monthly') {
    return (
      <div className="overflow-auto">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="text-xs">Месяц</TableHead>
              <TableHead className="text-xs text-right">Выручка (начисл.)</TableHead>
              <TableHead className="text-xs text-right">Выручка (оплач.)</TableHead>
              <TableHead className="text-xs text-right">ФОТ</TableHead>
              <TableHead className="text-xs text-right">Аренда</TableHead>
              <TableHead className="text-xs text-right">Маркетинг</TableHead>
              <TableHead className="text-xs text-right">EBITDA</TableHead>
              <TableHead className="text-xs text-right">Чистая прибыль</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i} className="text-xs font-mono">
                <TableCell className="font-sans font-medium">{String(row['month'] ?? '').slice(0, 7)}</TableCell>
                <TableCell className="text-right">{fmt(row['revenue_accrual'] as string)}</TableCell>
                <TableCell className="text-right">{fmt(row['revenue_cash'] as string)}</TableCell>
                <TableCell className="text-right text-red-600 dark:text-red-400">{fmt(row['payroll'] as string)}</TableCell>
                <TableCell className="text-right text-red-600 dark:text-red-400">{fmt(row['rent'] as string)}</TableCell>
                <TableCell className="text-right text-red-600 dark:text-red-400">{fmt(row['marketing'] as string)}</TableCell>
                <TableCell className={`text-right font-bold ${Number(row['ebitda'] ?? 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmt(row['ebitda'] as string)}</TableCell>
                <TableCell className={`text-right font-bold ${Number(row['net_profit'] ?? 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmt(row['net_profit'] as string)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Computed from transactions — group by month + opiu_category
  const byMonth: Record<string, Record<string, { income: number; expense: number }>> = {};
  for (const row of rows) {
    const month = String(row['month'] ?? '');
    const cat   = String(row['opiu_category'] ?? 'Прочие');
    const dir   = String(row['direction'] ?? 'expense');
    const total = Number(row['total'] ?? 0);
    if (!byMonth[month]) byMonth[month] = {};
    if (!byMonth[month][cat]) byMonth[month][cat] = { income: 0, expense: 0 };
    if (dir === 'income') byMonth[month][cat].income += total;
    else byMonth[month][cat].expense += total;
  }

  return (
    <div className="space-y-4">
      <Badge variant="outline" className="text-xs">Вычислено из банковских транзакций (приближение)</Badge>
      {Object.entries(byMonth).sort(([a], [b]) => b.localeCompare(a)).map(([month, cats]) => {
        const totalRev = Object.values(cats).reduce((s, v) => s + v.income, 0);
        const totalExp = Object.values(cats).reduce((s, v) => s + v.expense, 0);
        return (
          <Card key={month}>
            <CardHeader className="pb-2 border-b">
              <CardTitle className="text-sm flex justify-between">
                <span>{month}</span>
                <span className={`font-mono ${totalRev - totalExp >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {fmt(totalRev - totalExp)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y">
              {Object.entries(cats).map(([cat, { income, expense }]) => (
                <div key={cat} className="flex items-center justify-between px-4 py-2 text-xs">
                  <span className="text-muted-foreground">{cat}</span>
                  <div className="flex gap-4 font-mono">
                    {income > 0 && <span className="text-green-700 dark:text-green-400">+{fmt(income)}</span>}
                    {expense > 0 && <span className="text-red-600 dark:text-red-400">−{fmt(expense)}</span>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── All Transactions ─────────────────────────────────────────────────────────

function AllTransactions() {
  const [filters, setFilters] = useState({ direction: '', unclear: '', dateFrom: '', dateTo: '' });
  const params = {
    limit: 100,
    ...(filters.direction ? { direction: filters.direction as 'income' | 'expense' } : {}),
    ...(filters.unclear === 'true' ? { unclear: 'true' } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
  };
  const { data, isLoading } = useGetBankTransactions(params, { query: { refetchInterval: 15000, queryKey: getGetBankTransactionsQueryKey(params) } });

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <Select value={filters.direction || '__all__'} onValueChange={v => setFilters(f => ({ ...f, direction: v === '__all__' ? '' : v }))}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Направление" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Все</SelectItem>
            <SelectItem value="income">Поступления</SelectItem>
            <SelectItem value="expense">Расходы</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.unclear || '__all__'} onValueChange={v => setFilters(f => ({ ...f, unclear: v === '__all__' ? '' : v }))}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Категория" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Все операции</SelectItem>
            <SelectItem value="true">Только непонятные</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input type="date" className="h-8 text-xs w-36" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
          <span className="text-xs text-muted-foreground">—</span>
          <Input type="date" className="h-8 text-xs w-36" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
        </div>
        <span className="text-xs text-muted-foreground ml-auto">{isLoading ? '…' : `${data?.total ?? 0} операций`}</span>
      </div>

      <div className="overflow-auto border rounded-lg">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="text-xs w-24">Дата</TableHead>
              <TableHead className="text-xs">Контрагент</TableHead>
              <TableHead className="text-xs max-w-[200px]">Назначение</TableHead>
              <TableHead className="text-xs">ДДС</TableHead>
              <TableHead className="text-xs">ОПиУ</TableHead>
              <TableHead className="text-xs text-right">Сумма</TableHead>
              <TableHead className="text-xs">Флаги</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Загрузка…</TableCell></TableRow>
            )}
            {!isLoading && data?.transactions.map(tx => (
              <TableRow key={tx.id} className="text-xs">
                <TableCell className="font-mono text-muted-foreground py-2">{tx.operationDate ?? '—'}</TableCell>
                <TableCell className="max-w-[120px] truncate py-2">{tx.counterpartyName ?? '—'}</TableCell>
                <TableCell className="max-w-[180px] truncate py-2 text-muted-foreground">{tx.purpose ?? '—'}</TableCell>
                <TableCell className="py-2">
                  {tx.ddsCategory
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">{tx.ddsCategory}</span>
                    : <Badge variant="outline" className="text-[9px] border-yellow-400 text-yellow-700 dark:text-yellow-400">unclear</Badge>}
                </TableCell>
                <TableCell className="py-2">
                  {tx.opiuCategory
                    ? <span className="text-[10px] text-muted-foreground">{tx.opiuCategory}</span>
                    : null}
                </TableCell>
                <TableCell className={`py-2 text-right font-mono font-semibold ${tx.direction === 'income' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {tx.direction === 'income' ? '+' : '−'}{fmt(tx.amount)}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex gap-0.5 flex-wrap">
                    {tx.isPayroll && <span title="Зарплата" className="text-[9px] bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 px-1 rounded">ФОТ</span>}
                    {tx.isTax && <span title="Налог" className="text-[9px] bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800 px-1 rounded">Налог</span>}
                    {tx.isCapex && <span title="Капекс" className="text-[9px] bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 px-1 rounded">Капекс</span>}
                    {tx.isDebtBody && <span title="Тело долга" className="text-[9px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1 rounded">Долг</span>}
                    {tx.isDebtInterest && <span title="Проценты" className="text-[9px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1 rounded">%</span>}
                    {tx.isTransferBetweenOwnAccounts && <span title="Внутренний перевод" className="text-[9px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1 rounded">Внутр.</span>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && data?.transactions.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Нет операций</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Rules Manager ────────────────────────────────────────────────────────────

function RulesManager({ ddsCategories, opiuCategories }: {
  ddsCategories: { id: string; category: string | null | undefined }[];
  opiuCategories: { id: string; category: string | null | undefined; type: string | null | undefined }[];
}) {
  const { data: rulesResp, isLoading } = useGetCategorizationRules({ query: { queryKey: getGetCategorizationRulesQueryKey() } });
  const rules = rulesResp?.rules ?? [];
  const queryClient = useQueryClient();
  const createRule = useCreateCategorizationRule();
  const autoCat = useAutoCategorize();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ruleName: '', direction: '', counterpartyContains: '', purposeContains: '', ddsCategory: '', opiuCategory: '', priority: '100' });

  const handleCreate = () => {
    createRule.mutate({
      data: {
        ruleName: form.ruleName || undefined,
        priority: parseInt(form.priority, 10) || 100,
        direction: form.direction || undefined,
        counterpartyContains: form.counterpartyContains ? form.counterpartyContains.split(',').map(s => s.trim()).filter(Boolean) : [],
        purposeContains: form.purposeContains ? form.purposeContains.split(',').map(s => s.trim()).filter(Boolean) : [],
        ddsCategory: form.ddsCategory || undefined,
        opiuCategory: form.opiuCategory || undefined,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCategorizationRulesQueryKey() });
        setShowForm(false);
        setForm({ ruleName: '', direction: '', counterpartyContains: '', purposeContains: '', ddsCategory: '', opiuCategory: '', priority: '100' });
      },
    });
  };

  const handleAutocat = () => {
    autoCat.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetUnclearTransactionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFinanceStatsQueryKey() });
        alert(`Обработано: ${result.processed}, распознано: ${result.resolved}, осталось: ${result.stillUnclear}`);
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rules.length} правил категоризации</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAutocat} disabled={autoCat.isPending} className="gap-1.5 text-xs">
            {autoCat.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Автокатегоризация
          </Button>
          <Button size="sm" onClick={() => setShowForm(v => !v)} className="gap-1.5 text-xs">
            <Plus className="w-3 h-3" />Новое правило
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm">Создать правило</CardTitle>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Название правила</label>
              <Input placeholder="Зарплата учителей" className="h-8 text-sm" value={form.ruleName} onChange={e => setForm(f => ({ ...f, ruleName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Направление</label>
              <Select value={form.direction || '__all__'} onValueChange={v => setForm(f => ({ ...f, direction: v === '__all__' ? '' : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Оба" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Оба</SelectItem>
                  <SelectItem value="income">Поступления</SelectItem>
                  <SelectItem value="expense">Расходы</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Приоритет (меньше = выше)</label>
              <Input type="number" placeholder="100" className="h-8 text-sm" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Контрагент содержит (через запятую)</label>
              <Input placeholder="ООО Атлас, ИП Иванов" className="h-8 text-sm" value={form.counterpartyContains} onChange={e => setForm(f => ({ ...f, counterpartyContains: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Назначение содержит (через запятую)</label>
              <Input placeholder="зарплата, оплата труда" className="h-8 text-sm" value={form.purposeContains} onChange={e => setForm(f => ({ ...f, purposeContains: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">ДДС категория</label>
              <Select value={form.ddsCategory || '__none__'} onValueChange={v => setForm(f => ({ ...f, ddsCategory: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {ddsCategories.map(c => <SelectItem key={c.id} value={c.category ?? c.id} className="text-xs">{c.category}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">ОПиУ категория</label>
              <Select value={form.opiuCategory || '__none__'} onValueChange={v => setForm(f => ({ ...f, opiuCategory: v === '__none__' ? '' : v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {opiuCategories.map(c => <SelectItem key={c.id} value={c.category ?? c.id} className="text-xs">{c.type?.toUpperCase()}: {c.category}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={createRule.isPending} className="gap-1.5 text-xs">
                {createRule.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Создать
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)} className="text-xs">Отмена</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8 text-sm">Загрузка…</p>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <Settings className="w-8 h-8 mx-auto opacity-30" />
          <p className="text-sm">Нет правил. Создайте первое правило или категоризируйте непонятные операции.</p>
        </div>
      ) : (
        <div className="overflow-auto border rounded-lg">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="text-xs w-8">#</TableHead>
                <TableHead className="text-xs">Название</TableHead>
                <TableHead className="text-xs">Направление</TableHead>
                <TableHead className="text-xs">Контрагент / Назначение</TableHead>
                <TableHead className="text-xs">ДДС</TableHead>
                <TableHead className="text-xs">ОПиУ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules as CategorizationRule[]).map(rule => (
                <TableRow key={rule.id} className="text-xs">
                  <TableCell className="font-mono text-muted-foreground">{rule.priority}</TableCell>
                  <TableCell>{rule.ruleName ?? '—'}</TableCell>
                  <TableCell>
                    {rule.direction
                      ? <Badge variant="outline" className={`text-[9px] ${dirBadge(rule.direction)}`}>{rule.direction === 'income' ? 'доход' : 'расход'}</Badge>
                      : <span className="text-muted-foreground">оба</span>}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {rule.counterpartyContains && rule.counterpartyContains.length > 0 && (
                      <p className="truncate text-muted-foreground">{rule.counterpartyContains.join(', ')}</p>
                    )}
                    {rule.purposeContains && rule.purposeContains.length > 0 && (
                      <p className="truncate text-muted-foreground italic text-[10px]">{rule.purposeContains.join(', ')}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-[10px] text-muted-foreground">{rule.ddsCategory ?? '—'}</TableCell>
                  <TableCell className="text-[10px] text-muted-foreground">{rule.opiuCategory ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Main Finance Page ────────────────────────────────────────────────────────

export default function FinancePage() {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>('dds');

  const { data: finStats } = useGetFinanceStats({ query: { refetchInterval: 15000, queryKey: getGetFinanceStatsQueryKey() } });
  const { data: ddsCategories = [] } = useGetDdsCategories({ query: { staleTime: 60000, queryKey: getGetDdsCategoriesQueryKey() } });
  const { data: opiuCategories = [] } = useGetOpiuCategories({ query: { staleTime: 60000, queryKey: getGetOpiuCategoriesQueryKey() } });

  const invalidateFinance = () => {
    queryClient.invalidateQueries({ queryKey: getGetFinanceStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBankTransactionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetUnclearTransactionsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDdsReportQueryKey() });
  };

  const net = finStats ? finStats.currentMonthIncome - finStats.currentMonthExpense : 0;

  return (
    <div className="space-y-6">
      {/* Finance header stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">Транзакций</p>
          <p className="text-2xl font-mono">{finStats?.totalTransactions ?? 0}</p>
        </div>
        <div className={`bg-card border rounded-xl p-4 shadow-sm ${(finStats?.unclearTransactions ?? 0) > 0 ? 'border-yellow-300 dark:border-yellow-700' : ''}`}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">Непонятных</p>
          <p className={`text-2xl font-mono ${(finStats?.unclearTransactions ?? 0) > 0 ? 'text-yellow-600 dark:text-yellow-400' : ''}`}>{finStats?.unclearTransactions ?? 0}</p>
        </div>
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">Правил</p>
          <p className="text-2xl font-mono">{finStats?.categorizationRules ?? 0}</p>
        </div>
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3 text-green-500" />Приход MTD</p>
          <p className="text-lg font-mono text-green-700 dark:text-green-400">{fmt(finStats?.currentMonthIncome)}</p>
        </div>
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1"><TrendingDown className="w-3 h-3 text-red-500" />Расход MTD</p>
          <p className="text-lg font-mono text-red-600 dark:text-red-400">{fmt(finStats?.currentMonthExpense)}</p>
        </div>
        <div className="bg-card border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1"><Minus className="w-3 h-3" />Чистый MTD</p>
          <p className={`text-lg font-mono font-bold ${net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmt(net)}</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 flex-wrap border-b pb-0">
        {SUBTABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              subTab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {key === 'unclear' && (finStats?.unclearTransactions ?? 0) > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-yellow-400 dark:bg-yellow-600 text-white text-[9px] font-bold rounded-full">{finStats?.unclearTransactions}</span>
            )}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {subTab === 'dds' && <DdsSection />}
      {subTab === 'opiu' && <OpiuSection />}
      {subTab === 'import' && <BankImport onImported={() => { invalidateFinance(); setSubTab('unclear'); }} />}
      {subTab === 'unclear' && <UnclearTransactions ddsCategories={ddsCategories as Parameters<typeof UnclearTransactions>[0]['ddsCategories']} opiuCategories={opiuCategories as Parameters<typeof UnclearTransactions>[0]['opiuCategories']} />}
      {subTab === 'transactions' && <AllTransactions />}
      {subTab === 'rules' && <RulesManager ddsCategories={ddsCategories as Parameters<typeof RulesManager>[0]['ddsCategories']} opiuCategories={opiuCategories as Parameters<typeof RulesManager>[0]['opiuCategories']} />}
    </div>
  );
}
