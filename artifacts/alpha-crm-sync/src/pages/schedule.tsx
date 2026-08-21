import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Plus, X, BarChart3, Users, Clock, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const BASE = '/api';

const LESSON_TYPES: Record<string, string> = {
  regular:    'Обычное',
  trial:      'Пробное',
  makeup:     'Отработка',
  individual: 'Индивидуальное',
  cancelled:  'Отменено',
};
const RATE_TYPES: Record<string, string> = {
  per_lesson: 'За занятие',
  per_hour:   'За час',
  fixed:      'Фиксировано',
};
const STATUS_COLORS: Record<string, string> = {
  scheduled:  'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  cancelled:  'bg-gray-100 text-gray-500',
  no_show:    'bg-red-100 text-red-600',
};

type ViewTab = 'assignments' | 'pl-by-direction' | 'teacher-workload';

interface Assignment {
  id: string; teacherCrmId: string; lessonDate: string;
  startTime: string | null; durationHours: string | null; lessonType: string | null;
  rateType: string | null; rateAmount: string | null; totalAmount: string | null;
  directionId: string | null; periodMonth: string | null; studentsCount: number | null;
  status: string | null; notes: string | null;
}
interface PLByDirection {
  directionId: string | null; directionName: string; color: string;
  totalAmount: number; lessonsCount: number; teachersCount: number;
}
interface PLByDirectionRes { periodMonth: string; totalAmount: number; totalLessons: number; byDirection: PLByDirection[]; }
interface TeacherWorkload {
  teacherCrmId: string; totalAmount: number; lessonsCount: number; hoursTotal: number;
  directions: number; statusCounts: Record<string, number>;
}
interface Direction { id: string; name: string; color: string | null; }

function fmt(n: number | string | null | undefined) {
  if (!n) return '—';
  return new Intl.NumberFormat('ru-RU').format(parseFloat(String(n))) + ' ₽';
}

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

export default function SchedulePage() {
  const qc = useQueryClient();
  const [viewTab, setViewTab]         = useState<ViewTab>('assignments');
  const [filterMonth, setFilterMonth] = useState(CURRENT_MONTH);
  const [filterTeacher, setFilterTeacher] = useState('');
  const [showDialog, setShowDialog]   = useState(false);
  const [form, setForm] = useState({
    teacherCrmId: '', classGroupId: '', lessonDate: '', startTime: '',
    durationHours: '1', lessonType: 'regular', rateType: 'per_lesson',
    rateAmount: '', totalAmount: '', directionId: '', studentsCount: '0',
    status: 'scheduled', notes: '',
  });

  const { data: assignments = [], isLoading } = useQuery<Assignment[]>({
    queryKey: ['schedule-assignments', filterMonth, filterTeacher],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterMonth)   p.set('periodMonth', filterMonth);
      if (filterTeacher) p.set('teacherCrmId', filterTeacher);
      return fetch(`${BASE}/schedule/assignments?${p}`).then(r => r.json());
    },
  });

  const { data: plByDir } = useQuery<PLByDirectionRes>({
    queryKey: ['schedule-pl-by-direction', filterMonth],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterMonth) p.set('periodMonth', filterMonth);
      return fetch(`${BASE}/schedule/pl-by-direction?${p}`).then(r => r.json());
    },
    enabled: viewTab === 'pl-by-direction',
  });

  const { data: workload = [] } = useQuery<TeacherWorkload[]>({
    queryKey: ['schedule-teacher-workload', filterMonth],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterMonth) p.set('periodMonth', filterMonth);
      return fetch(`${BASE}/schedule/teacher-workload?${p}`).then(r => r.json());
    },
    enabled: viewTab === 'teacher-workload',
  });

  const { data: directions = [] } = useQuery<Direction[]>({
    queryKey: ['directions'],
    queryFn: () => fetch(`${BASE}/educational/directions`).then(r => r.json()),
  });

  const create = useMutation({
    mutationFn: (body: typeof form) =>
      fetch(`${BASE}/schedule/assignments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          studentsCount: parseInt(body.studentsCount) || 0,
          durationHours: body.durationHours || '1',
          classGroupId: body.classGroupId || undefined,
          directionId: body.directionId || undefined,
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-assignments'] });
      qc.invalidateQueries({ queryKey: ['schedule-pl-by-direction'] });
      qc.invalidateQueries({ queryKey: ['schedule-teacher-workload'] });
      setShowDialog(false);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => fetch(`${BASE}/schedule/assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-assignments'] });
      qc.invalidateQueries({ queryKey: ['schedule-pl-by-direction'] });
      qc.invalidateQueries({ queryKey: ['schedule-teacher-workload'] });
    },
  });

  const TABS = [
    { key: 'assignments'      as ViewTab, label: 'Занятия',          Icon: Calendar },
    { key: 'pl-by-direction'  as ViewTab, label: 'P&L по направл.',  Icon: BarChart3 },
    { key: 'teacher-workload' as ViewTab, label: 'Нагрузка педагогов', Icon: Users },
  ];

  const totalAssignments = assignments.reduce((s, a) => s + parseFloat(a.totalAmount ?? '0'), 0);
  const completedCount   = assignments.filter(a => a.status === 'completed').length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-blue-100 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Расписание занятий</h1>
            <p className="text-sm text-gray-500">Начисления педагогам, P&L по направлениям</p>
          </div>
        </div>
        <Button className="rounded-xl gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setShowDialog(true)}>
          <Plus className="w-4 h-4" /> Занятие
        </Button>
      </div>

      {/* Month filter + stats */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          type="month"
          className="w-44 rounded-xl"
          value={filterMonth}
          onChange={e => setFilterMonth(e.target.value)}
        />
        <Input
          className="w-48 rounded-xl"
          placeholder="ID педагога…"
          value={filterTeacher}
          onChange={e => setFilterTeacher(e.target.value)}
        />
        {viewTab === 'assignments' && (
          <>
            <div className="ml-auto text-sm text-gray-500">
              <span className="font-semibold text-gray-900">{assignments.length}</span> занятий
              · <span className="font-semibold text-green-600">{completedCount}</span> проведено
              · <span className="font-semibold text-gray-900">{fmt(totalAssignments)}</span> начислено
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl w-fit">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setViewTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              viewTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* ── ASSIGNMENTS ── */}
      {viewTab === 'assignments' && (
        <div className="bg-white rounded-[22px] shadow-sm border border-gray-100 overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-gray-400">Загрузка…</div>
          ) : assignments.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Занятий нет</p>
              <Button variant="outline" className="mt-4 rounded-xl" onClick={() => setShowDialog(true)}>Добавить</Button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {assignments.map(a => {
                const statusCls = STATUS_COLORS[a.status ?? 'scheduled'] ?? STATUS_COLORS.scheduled;
                return (
                  <div key={a.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50/50">
                    <div className="text-sm text-gray-500 shrink-0 w-20">
                      <div className="font-medium text-gray-900">{a.lessonDate}</div>
                      {a.startTime && <div className="text-xs">{a.startTime}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">Педагог: {a.teacherCrmId}</div>
                      <div className="text-xs text-gray-400 flex gap-2 mt-0.5">
                        {a.lessonType && <span>{LESSON_TYPES[a.lessonType] ?? a.lessonType}</span>}
                        {a.durationHours && <span>{a.durationHours} ч</span>}
                        {a.studentsCount != null && <span>{a.studentsCount} уч.</span>}
                      </div>
                    </div>
                    <div className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${statusCls}`}>
                      {a.status ?? 'scheduled'}
                    </div>
                    <div className="text-right shrink-0">
                      {a.totalAmount && <div className="font-semibold text-gray-900">{fmt(a.totalAmount)}</div>}
                      {a.rateAmount  && <div className="text-xs text-gray-400">{fmt(a.rateAmount)} / {RATE_TYPES[a.rateType ?? 'per_lesson']?.toLowerCase()}</div>}
                    </div>
                    <button className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 shrink-0" onClick={() => del.mutate(a.id)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── P&L BY DIRECTION ── */}
      {viewTab === 'pl-by-direction' && (
        <div className="space-y-4">
          {plByDir ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-[22px] p-4 shadow-sm border border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">Итого начислено</div>
                  <div className="text-2xl font-bold text-gray-900">{fmt(plByDir.totalAmount)}</div>
                </div>
                <div className="bg-white rounded-[22px] p-4 shadow-sm border border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">Занятий за период</div>
                  <div className="text-2xl font-bold text-gray-900">{plByDir.totalLessons}</div>
                </div>
              </div>
              <div className="bg-white rounded-[22px] shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-5 border-b border-gray-50">
                  <h3 className="font-semibold text-gray-900">Расходы по направлениям</h3>
                  <p className="text-xs text-gray-400 mt-0.5">ФОТ педагогов, привязан к направлению</p>
                </div>
                <div className="divide-y divide-gray-50">
                  {plByDir.byDirection.map(d => {
                    const pct = plByDir.totalAmount > 0 ? d.totalAmount / plByDir.totalAmount : 0;
                    return (
                      <div key={d.directionId ?? 'none'} className="px-6 py-4">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color }} />
                          <span className="font-medium text-gray-900 flex-1">{d.directionName}</span>
                          <span className="text-sm text-gray-500">{d.lessonsCount} занятий</span>
                          <span className="font-semibold text-gray-900">{fmt(d.totalAmount)}</span>
                          <span className="text-xs text-gray-400 w-10 text-right">{Math.round(pct * 100)}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: d.color }} />
                        </div>
                      </div>
                    );
                  })}
                  {plByDir.byDirection.length === 0 && (
                    <div className="p-12 text-center text-gray-400">Нет данных за период</div>
                  )}
                </div>
              </div>
            </>
          ) : <div className="text-center py-12 text-gray-400">Загрузка…</div>}
        </div>
      )}

      {/* ── TEACHER WORKLOAD ── */}
      {viewTab === 'teacher-workload' && (
        <div className="bg-white rounded-[22px] shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-50">
            <h3 className="font-semibold text-gray-900">Нагрузка педагогов</h3>
            <p className="text-xs text-gray-400 mt-0.5">По количеству занятий, часов и начислений</p>
          </div>
          {workload.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Нет данных за период</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {workload.map((w, i) => (
                <div key={w.teacherCrmId} className="flex items-center gap-4 px-6 py-4">
                  <div className="text-lg font-bold text-gray-300 w-6 shrink-0">{i + 1}</div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">Педагог #{w.teacherCrmId}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {w.hoursTotal.toFixed(1)} ч · {w.directions} направл.
                    </div>
                  </div>
                  <div className="text-center shrink-0">
                    <div className="font-semibold text-gray-900">{w.lessonsCount}</div>
                    <div className="text-xs text-gray-400">занятий</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-gray-900">{fmt(w.totalAmount)}</div>
                    <div className="text-xs text-gray-400">начислено</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="rounded-[22px] max-w-lg">
          <DialogHeader><DialogTitle>Добавить занятие</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-gray-500">ID педагога *</Label>
                <Input className="mt-1 rounded-xl" placeholder="CRM teacher id" value={form.teacherCrmId} onChange={e => setForm(f => ({ ...f, teacherCrmId: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Дата *</Label>
                <Input type="date" className="mt-1 rounded-xl" value={form.lessonDate} onChange={e => setForm(f => ({ ...f, lessonDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs text-gray-500">Время</Label>
                <Input type="time" className="mt-1 rounded-xl" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Длит. (ч)</Label>
                <Input className="mt-1 rounded-xl" value={form.durationHours} onChange={e => setForm(f => ({ ...f, durationHours: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Уч-ков</Label>
                <Input type="number" className="mt-1 rounded-xl" value={form.studentsCount} onChange={e => setForm(f => ({ ...f, studentsCount: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-gray-500">Тип занятия</Label>
                <Select value={form.lessonType} onValueChange={v => setForm(f => ({ ...f, lessonType: v }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(LESSON_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs text-gray-500">Направление</Label>
                <Select value={form.directionId || 'none'} onValueChange={v => setForm(f => ({ ...f, directionId: v === 'none' ? '' : v }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue placeholder="Выбрать" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— без —</SelectItem>
                    {directions.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs text-gray-500">Ставка</Label>
                <Select value={form.rateType} onValueChange={v => setForm(f => ({ ...f, rateType: v }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(RATE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs text-gray-500">Ставка (₽)</Label>
                <Input className="mt-1 rounded-xl" placeholder="1500" value={form.rateAmount} onChange={e => setForm(f => ({ ...f, rateAmount: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Итого (₽)</Label>
                <Input className="mt-1 rounded-xl" placeholder="авто" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowDialog(false)}>Отмена</Button>
              <Button className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => create.mutate(form)}
                disabled={!form.teacherCrmId || !form.lessonDate || create.isPending}>
                {create.isPending ? 'Сохранение…' : 'Добавить'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
