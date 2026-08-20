import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Plus, Search, X, ChevronDown, CheckCircle2, Clock, AlertTriangle, XCircle, Calendar, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const BASE = '/api';

const CONTRACT_TYPES: Record<string, { label: string; color: string }> = {
  family:           { label: 'С семьёй',         color: 'bg-blue-100 text-blue-700'   },
  employee:         { label: 'Сотрудник',         color: 'bg-green-100 text-green-700' },
  contractor:       { label: 'Подрядчик',         color: 'bg-orange-100 text-orange-700' },
  external_teacher: { label: 'Внешний педагог',   color: 'bg-violet-100 text-violet-700' },
  rental:           { label: 'Аренда',            color: 'bg-pink-100 text-pink-700'   },
  supply:           { label: 'Поставка',          color: 'bg-yellow-100 text-yellow-700' },
  service:          { label: 'Услуги',            color: 'bg-cyan-100 text-cyan-700'   },
};

const STATUS_META: Record<string, { label: string; Icon: React.FC<{ className?: string }>; color: string }> = {
  draft:       { label: 'Черновик',    Icon: Clock,         color: 'text-gray-500'  },
  active:      { label: 'Активен',     Icon: CheckCircle2,  color: 'text-green-600' },
  suspended:   { label: 'Приостановлен', Icon: AlertTriangle, color: 'text-yellow-600' },
  terminated:  { label: 'Расторгнут',  Icon: XCircle,       color: 'text-red-600'   },
  expired:     { label: 'Истёк',       Icon: XCircle,       color: 'text-gray-400'  },
};

function fmt(n: string | null | undefined) {
  if (!n) return '—';
  return new Intl.NumberFormat('ru-RU').format(parseFloat(n)) + ' ₽';
}
function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ru-RU');
}
function daysUntil(date: string | null | undefined) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

interface Contract {
  id: string;
  contractType: string;
  contractNumber: string | null;
  title: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyAmount: string | null;
  totalAmount: string | null;
  familyId: string | null;
  personId: string | null;
  counterpartyId: string | null;
  notes: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  active: number;
  expiringSoon: number;
  totalMonthlyAmount: number;
  byType: Record<string, number>;
}

const EMPTY_FORM = {
  contractType: 'family', contractNumber: '', title: '', status: 'active',
  startDate: '', endDate: '', monthlyAmount: '', totalAmount: '',
  paymentTerms: '', notes: '',
};

export default function ContractsPage() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]           = useState('');
  const [showDialog, setShowDialog]   = useState(false);
  const [form, setForm]               = useState<typeof EMPTY_FORM>(EMPTY_FORM);

  const { data: stats } = useQuery<Stats>({
    queryKey: ['contracts-stats'],
    queryFn: () => fetch(`${BASE}/contracts/stats`).then(r => r.json()),
  });

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ['contracts', typeFilter, statusFilter, search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (typeFilter)   p.set('type',   typeFilter);
      if (statusFilter) p.set('status', statusFilter);
      if (search)       p.set('search', search);
      return fetch(`${BASE}/contracts?${p}`).then(r => r.json());
    },
  });

  const create = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) =>
      fetch(`${BASE}/contracts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contracts'] }); qc.invalidateQueries({ queryKey: ['contracts-stats'] }); setShowDialog(false); setForm(EMPTY_FORM); },
  });

  const del = useMutation({
    mutationFn: (id: string) => fetch(`${BASE}/contracts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contracts'] }); qc.invalidateQueries({ queryKey: ['contracts-stats'] }); },
  });

  const setField = (k: keyof typeof EMPTY_FORM, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-violet-100 flex items-center justify-center">
            <FileSignature className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Договоры</h1>
            <p className="text-sm text-gray-500">Универсальный реестр договоров</p>
          </div>
        </div>
        <Button className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl gap-2" onClick={() => setShowDialog(true)}>
          <Plus className="w-4 h-4" /> Добавить
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Всего договоров', value: stats.total, icon: FileSignature, color: 'violet' },
            { label: 'Активных', value: stats.active, icon: CheckCircle2, color: 'green' },
            { label: 'Истекают (30 дней)', value: stats.expiringSoon, icon: Calendar, color: 'yellow' },
            { label: 'Ежемес. поступления', value: fmt(String(stats.totalMonthlyAmount)), icon: TrendingUp, color: 'blue', raw: true },
          ].map(({ label, value, icon: Icon, color, raw }) => (
            <div key={label} className="bg-white rounded-[22px] p-4 shadow-sm border border-gray-100">
              <div className={`w-8 h-8 rounded-xl bg-${color}-100 flex items-center justify-center mb-3`}>
                <Icon className={`w-4 h-4 text-${color}-600`} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{raw ? value : value}</div>
              <div className="text-xs text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="Поиск по названию, номеру…" className="pl-9 rounded-xl" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter || 'all'} onValueChange={v => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44 rounded-xl"><SelectValue placeholder="Тип" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {Object.entries(CONTRACT_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40 rounded-xl"><SelectValue placeholder="Статус" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {Object.entries(STATUS_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="bg-white rounded-[22px] shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-400">Загрузка…</div>
        ) : contracts.length === 0 ? (
          <div className="p-12 text-center">
            <FileSignature className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Договоров нет</p>
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => setShowDialog(true)}>Добавить первый</Button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {contracts.map(c => {
              const typeMeta   = CONTRACT_TYPES[c.contractType] ?? { label: c.contractType, color: 'bg-gray-100 text-gray-600' };
              const statusMeta = STATUS_META[c.status ?? 'draft'];
              const days       = daysUntil(c.endDate);
              const expiringSoon = days !== null && days >= 0 && days <= 30 && c.status === 'active';
              return (
                <div key={c.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeMeta.color}`}>{typeMeta.label}</span>
                      {c.contractNumber && <span className="text-xs text-gray-400">№{c.contractNumber}</span>}
                      {expiringSoon && <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">Истекает через {days} дн.</span>}
                    </div>
                    <div className="font-medium text-gray-900 mt-0.5">{c.title ?? '—'}</div>
                    <div className="text-xs text-gray-400 mt-0.5 flex gap-3">
                      {c.startDate && <span>с {fmtDate(c.startDate)}</span>}
                      {c.endDate   && <span>по {fmtDate(c.endDate)}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {c.monthlyAmount && <div className="font-semibold text-gray-900">{fmt(c.monthlyAmount)}/мес</div>}
                    {c.totalAmount   && !c.monthlyAmount && <div className="font-semibold text-gray-900">{fmt(c.totalAmount)}</div>}
                  </div>
                  {statusMeta && (
                    <div className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${statusMeta.color}`}>
                      <statusMeta.Icon className="w-3.5 h-3.5" />
                      {statusMeta.label}
                    </div>
                  )}
                  <button
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                    onClick={() => del.mutate(c.id)}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="rounded-[22px] max-w-lg">
          <DialogHeader>
            <DialogTitle>Новый договор</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Тип договора</Label>
                <Select value={form.contractType} onValueChange={v => setField('contractType', v)}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONTRACT_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-500">Статус</Label>
                <Select value={form.status} onValueChange={v => setField('status', v)}>
                  <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(STATUS_META).map(k => <SelectItem key={k} value={k}>{STATUS_META[k].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Номер</Label>
                <Input className="mt-1 rounded-xl" placeholder="ДОГ-2025-001" value={form.contractNumber} onChange={e => setField('contractNumber', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Название</Label>
                <Input className="mt-1 rounded-xl" placeholder="Договор на обучение" value={form.title} onChange={e => setField('title', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Дата начала</Label>
                <Input type="date" className="mt-1 rounded-xl" value={form.startDate} onChange={e => setField('startDate', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Дата окончания</Label>
                <Input type="date" className="mt-1 rounded-xl" value={form.endDate} onChange={e => setField('endDate', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500">Сумма в месяц (₽)</Label>
                <Input className="mt-1 rounded-xl" placeholder="15000" value={form.monthlyAmount} onChange={e => setField('monthlyAmount', e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Общая сумма (₽)</Label>
                <Input className="mt-1 rounded-xl" placeholder="180000" value={form.totalAmount} onChange={e => setField('totalAmount', e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Примечания</Label>
              <Textarea className="mt-1 rounded-xl" placeholder="Условия, особые пункты…" value={form.notes} onChange={e => setField('notes', e.target.value)} rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowDialog(false)}>Отмена</Button>
              <Button className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white" onClick={() => create.mutate(form)} disabled={create.isPending}>
                {create.isPending ? 'Сохранение…' : 'Создать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
