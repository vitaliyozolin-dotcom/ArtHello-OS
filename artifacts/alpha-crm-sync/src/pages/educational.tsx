import { apiFetch } from "@workspace/api-client-react";
import { formatRubleNumber } from "@workspace/shared/money";
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GraduationCap, Plus, X, Users, BookOpen, Layers, ChevronRight, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const BASE = '/api';

const LEVELS: Record<string, string> = {
  beginner:     'Начинающий',
  elementary:   'Элементарный',
  intermediate: 'Средний',
  advanced:     'Продвинутый',
  professional: 'Профессиональный',
};

const DIRECTION_COLORS = [
  '#7c3aed','#2563eb','#059669','#dc2626','#d97706','#db2777','#0891b2','#65a30d',
];

type Tab = 'directions' | 'groups' | 'programs';

interface Direction { id: string; name: string; code: string | null; color: string | null; description: string | null; isActive: boolean; }
interface Program   { id: string; name: string; directionId: string | null; pricePerMonth: string | null; durationMonths: number | null; ageFrom: number | null; ageTo: number | null; }
interface ClassGroup { id: string; name: string; directionId: string | null; directionName: string | null; directionColor: string | null; teacherCrmId: string | null; level: string | null; maxStudents: number | null; currentStudents: number | null; scheduleInfo: string | null; monthlyRevenue: string | null; isActive: boolean; }
interface Stats { totalDirections: number; activeDirections: number; totalGroups: number; activeGroups: number; totalEnrollments: number; totalMonthlyRevenue: number; }

export default function EducationalPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('directions');

  // ── Directions ───────────────────────────────────────────────────────────
  const [showDirDialog, setShowDirDialog] = useState(false);
  const [dirForm, setDirForm] = useState({ name: '', code: '', color: DIRECTION_COLORS[0], description: '' });

  const { data: directions = [] } = useQuery<Direction[]>({
    queryKey: ['directions'],
    queryFn: () => apiFetch(`${BASE}/educational/directions`).then(r => r.json()),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ['educational-stats'],
    queryFn: () => apiFetch(`${BASE}/educational/stats`).then(r => r.json()),
  });

  const createDir = useMutation({
    mutationFn: (body: typeof dirForm) =>
      apiFetch(`${BASE}/educational/directions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['directions'] }); qc.invalidateQueries({ queryKey: ['educational-stats'] }); setShowDirDialog(false); setDirForm({ name: '', code: '', color: DIRECTION_COLORS[0], description: '' }); },
  });

  const deleteDir = useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/educational/directions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['directions'] }); qc.invalidateQueries({ queryKey: ['educational-stats'] }); },
  });

  // ── Groups ───────────────────────────────────────────────────────────────
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: '', directionId: '', teacherCrmId: '', level: 'beginner', maxStudents: '12', scheduleInfo: '', monthlyRevenue: '' });

  const { data: groups = [] } = useQuery<ClassGroup[]>({
    queryKey: ['class-groups'],
    queryFn: () => apiFetch(`${BASE}/educational/groups`).then(r => r.json()),
  });

  const createGroup = useMutation({
    mutationFn: (body: typeof groupForm) =>
      apiFetch(`${BASE}/educational/groups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, maxStudents: parseInt(body.maxStudents) || 12, directionId: body.directionId || undefined }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['class-groups'] }); qc.invalidateQueries({ queryKey: ['educational-stats'] }); setShowGroupDialog(false); },
  });

  const deleteGroup = useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/educational/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['class-groups'] }); qc.invalidateQueries({ queryKey: ['educational-stats'] }); },
  });

  // ── Programs ─────────────────────────────────────────────────────────────
  const [showProgDialog, setShowProgDialog] = useState(false);
  const [progForm, setProgForm] = useState({ name: '', directionId: '', pricePerMonth: '', durationMonths: '', ageFrom: '', ageTo: '' });

  const { data: programs = [] } = useQuery<Program[]>({
    queryKey: ['programs'],
    queryFn: () => apiFetch(`${BASE}/educational/programs`).then(r => r.json()),
  });

  const createProg = useMutation({
    mutationFn: (body: typeof progForm) =>
      apiFetch(`${BASE}/educational/programs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          directionId:    body.directionId || undefined,
          durationMonths: body.durationMonths ? parseInt(body.durationMonths) : undefined,
          ageFrom:        body.ageFrom ? parseInt(body.ageFrom) : undefined,
          ageTo:          body.ageTo   ? parseInt(body.ageTo)   : undefined,
        }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); setShowProgDialog(false); },
  });

  const deleteProg = useMutation({
    mutationFn: (id: string) => apiFetch(`${BASE}/educational/programs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs'] }),
  });

  const TABS: { key: Tab; label: string; Icon: React.FC<{ className?: string }> }[] = [
    { key: 'directions', label: 'Направления', Icon: Layers },
    { key: 'groups',     label: 'Группы',      Icon: Users },
    { key: 'programs',   label: 'Программы',   Icon: BookOpen },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[14px] bg-indigo-100 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Образовательная структура</h1>
            <p className="text-sm text-gray-500">Направления, программы, учебные группы</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Направлений', value: stats.activeDirections },
            { label: 'Активных групп', value: stats.activeGroups },
            { label: 'Зачислений', value: stats.totalEnrollments },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-[22px] p-4 shadow-sm border border-gray-100 text-center">
              <div className="text-3xl font-bold text-gray-900">{value}</div>
              <div className="text-sm text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-2xl w-fit">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* DIRECTIONS */}
      {tab === 'directions' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button className="rounded-xl gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setShowDirDialog(true)}>
              <Plus className="w-4 h-4" /> Направление
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {directions.map(d => (
              <div key={d.id} className="bg-white rounded-[22px] p-5 shadow-sm border border-gray-100 flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex-shrink-0" style={{ background: d.color ?? '#7c3aed' }} />
                  <div>
                    <div className="font-semibold text-gray-900">{d.name}</div>
                    {d.code && <div className="text-xs text-gray-400 mt-0.5">{d.code}</div>}
                    {d.description && <div className="text-sm text-gray-500 mt-1">{d.description}</div>}
                    {!d.isActive && <Badge variant="secondary" className="mt-1 text-xs">Неактивно</Badge>}
                  </div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500" onClick={() => deleteDir.mutate(d.id)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {directions.length === 0 && (
              <div className="col-span-3 text-center py-12 text-gray-400">
                <Layers className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Направлений нет</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* GROUPS */}
      {tab === 'groups' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button className="rounded-xl gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setShowGroupDialog(true)}>
              <Plus className="w-4 h-4" /> Группа
            </Button>
          </div>
          <div className="bg-white rounded-[22px] shadow-sm border border-gray-100 overflow-hidden">
            {groups.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Групп нет</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {groups.map(g => (
                  <div key={g.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50">
                    <div
                      className="w-2 h-10 rounded-full flex-shrink-0"
                      style={{ background: g.directionColor ?? '#e5e7eb' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{g.name}</span>
                        {!g.isActive && <Badge variant="secondary" className="text-xs">Неактивна</Badge>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 flex gap-3">
                        {g.directionName && <span>{g.directionName}</span>}
                        {g.scheduleInfo  && <span>{g.scheduleInfo}</span>}
                        {g.level         && <span>{LEVELS[g.level] ?? g.level}</span>}
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 text-center shrink-0">
                      <div className="font-semibold text-gray-900">{g.currentStudents ?? 0}<span className="font-normal text-gray-400">/{g.maxStudents ?? 12}</span></div>
                      <div className="text-xs">учеников</div>
                    </div>
                    {g.monthlyRevenue && (
                      <div className="text-right shrink-0">
                        <div className="font-semibold text-gray-900">{formatRubleNumber(parseFloat(g.monthlyRevenue))} ₽</div>
                        <div className="text-xs text-gray-400">в месяц</div>
                      </div>
                    )}
                    <button className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500" onClick={() => deleteGroup.mutate(g.id)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PROGRAMS */}
      {tab === 'programs' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button className="rounded-xl gap-2 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setShowProgDialog(true)}>
              <Plus className="w-4 h-4" /> Программа
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {programs.map(p => {
              const dir = directions.find(d => d.id === p.directionId);
              return (
                <div key={p.id} className="bg-white rounded-[22px] p-5 shadow-sm border border-gray-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{p.name}</div>
                      {dir && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="w-2 h-2 rounded-full" style={{ background: dir.color ?? '#7c3aed' }} />
                          <span className="text-xs text-gray-500">{dir.name}</span>
                        </div>
                      )}
                    </div>
                    <button className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500" onClick={() => deleteProg.mutate(p.id)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-4 mt-3 text-sm">
                    {p.pricePerMonth   && <div><span className="text-gray-400">Стоимость:</span> <span className="font-medium">{formatRubleNumber(parseFloat(p.pricePerMonth))} ₽/мес</span></div>}
                    {p.durationMonths  && <div><span className="text-gray-400">Длительность:</span> <span className="font-medium">{p.durationMonths} мес.</span></div>}
                    {(p.ageFrom || p.ageTo) && <div><span className="text-gray-400">Возраст:</span> <span className="font-medium">{p.ageFrom}–{p.ageTo} лет</span></div>}
                  </div>
                </div>
              );
            })}
            {programs.length === 0 && (
              <div className="col-span-2 text-center py-12 text-gray-400">
                <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Программ нет</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Dialogs ── */}
      <Dialog open={showDirDialog} onOpenChange={setShowDirDialog}>
        <DialogContent className="rounded-[22px]">
          <DialogHeader><DialogTitle>Новое направление</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label className="text-xs text-gray-500">Название *</Label>
              <Input className="mt-1 rounded-xl" placeholder="Изобразительное искусство" value={dirForm.name} onChange={e => setDirForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-gray-500">Код</Label>
                <Input className="mt-1 rounded-xl" placeholder="ART" value={dirForm.code} onChange={e => setDirForm(f => ({ ...f, code: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Описание</Label>
                <Input className="mt-1 rounded-xl" placeholder="Рисунок, живопись…" value={dirForm.description} onChange={e => setDirForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Цвет</Label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {DIRECTION_COLORS.map(c => (
                  <button key={c} onClick={() => setDirForm(f => ({ ...f, color: c }))}
                    className={`w-7 h-7 rounded-full transition-transform ${dirForm.color === c ? 'scale-110 ring-2 ring-offset-1 ring-gray-400' : ''}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowDirDialog(false)}>Отмена</Button>
              <Button className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white" onClick={() => createDir.mutate(dirForm)} disabled={!dirForm.name || createDir.isPending}>
                {createDir.isPending ? 'Сохранение…' : 'Создать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
        <DialogContent className="rounded-[22px]">
          <DialogHeader><DialogTitle>Новая учебная группа</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label className="text-xs text-gray-500">Название *</Label>
              <Input className="mt-1 rounded-xl" placeholder="Живопись — начинающие" value={groupForm.name} onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-gray-500">Направление</Label>
                <Select value={groupForm.directionId || 'none'} onValueChange={v => setGroupForm(f => ({ ...f, directionId: v === 'none' ? '' : v }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue placeholder="Выбрать" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— без направления —</SelectItem>
                    {directions.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs text-gray-500">Уровень</Label>
                <Select value={groupForm.level} onValueChange={v => setGroupForm(f => ({ ...f, level: v }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEVELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs text-gray-500">Макс. учеников</Label>
                <Input className="mt-1 rounded-xl" type="number" value={groupForm.maxStudents} onChange={e => setGroupForm(f => ({ ...f, maxStudents: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Выручка/мес (₽)</Label>
                <Input className="mt-1 rounded-xl" placeholder="30000" value={groupForm.monthlyRevenue} onChange={e => setGroupForm(f => ({ ...f, monthlyRevenue: e.target.value }))} />
              </div>
            </div>
            <div><Label className="text-xs text-gray-500">Расписание</Label>
              <Input className="mt-1 rounded-xl" placeholder="Вт/Чт 16:00-17:30" value={groupForm.scheduleInfo} onChange={e => setGroupForm(f => ({ ...f, scheduleInfo: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowGroupDialog(false)}>Отмена</Button>
              <Button className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white" onClick={() => createGroup.mutate(groupForm)} disabled={!groupForm.name || createGroup.isPending}>
                {createGroup.isPending ? 'Сохранение…' : 'Создать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showProgDialog} onOpenChange={setShowProgDialog}>
        <DialogContent className="rounded-[22px]">
          <DialogHeader><DialogTitle>Новая программа</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label className="text-xs text-gray-500">Название *</Label>
              <Input className="mt-1 rounded-xl" placeholder="Акварельная живопись" value={progForm.name} onChange={e => setProgForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div><Label className="text-xs text-gray-500">Направление</Label>
              <Select value={progForm.directionId || 'none'} onValueChange={v => setProgForm(f => ({ ...f, directionId: v === 'none' ? '' : v }))}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue placeholder="Выбрать" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— без направления —</SelectItem>
                  {directions.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs text-gray-500">Стоим./мес (₽)</Label>
                <Input className="mt-1 rounded-xl" placeholder="8000" value={progForm.pricePerMonth} onChange={e => setProgForm(f => ({ ...f, pricePerMonth: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Длит. (мес)</Label>
                <Input className="mt-1 rounded-xl" type="number" value={progForm.durationMonths} onChange={e => setProgForm(f => ({ ...f, durationMonths: e.target.value }))} />
              </div>
              <div><Label className="text-xs text-gray-500">Возраст</Label>
                <div className="flex gap-1 mt-1">
                  <Input className="rounded-xl" placeholder="6" value={progForm.ageFrom} onChange={e => setProgForm(f => ({ ...f, ageFrom: e.target.value }))} />
                  <Input className="rounded-xl" placeholder="18" value={progForm.ageTo} onChange={e => setProgForm(f => ({ ...f, ageTo: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowProgDialog(false)}>Отмена</Button>
              <Button className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 text-white" onClick={() => createProg.mutate(progForm)} disabled={!progForm.name || createProg.isPending}>
                {createProg.isPending ? 'Сохранение…' : 'Создать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
