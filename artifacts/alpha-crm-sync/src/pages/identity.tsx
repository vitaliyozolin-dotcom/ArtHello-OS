import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetIdentityStats,
  useRunIdentityMatching,
  useGetPersons,
  useGetIdentityQueue,
  useResolveQueueItem,
  useGetUnmatchedLeads,
  useGetOrphanStudents,
  useGetIdentityDuplicates,
  useBuildTimeline,
  useCalcHealth,
  getGetIdentityStatsQueryKey,
  getGetPersonsQueryKey,
  getGetIdentityQueueQueryKey,
  getGetUnmatchedLeadsQueryKey,
  getGetOrphanStudentsQueryKey,
  getGetIdentityDuplicatesQueryKey,
  getGetIdentityFamiliesQueryKey,
  getGetFamiliesAtRiskQueryKey,
} from '@workspace/api-client-react';
import { IdentityQualityTab, StudentRawPreviewTab } from './identity-quality';
import { FamiliesTab } from './identity-families';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, GitMerge, AlertTriangle, Search, CheckCircle2, XCircle, UserPlus, RefreshCw, Loader2, Phone, Mail, GraduationCap, Megaphone, Copy, Home, History, Activity } from 'lucide-react';

// ─── Sub-tab type ─────────────────────────────────────────────────────────────
type SubTab = 'persons' | 'queue' | 'unmatched' | 'duplicates' | 'families' | 'quality' | 'raw';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v: string | null | undefined) { return v ?? '—'; }
function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function confidencePct(v: string | null | undefined) {
  if (!v) return '—';
  return `${Math.round(parseFloat(v) * 100)}%`;
}
function confidenceBadge(v: string | null | undefined) {
  if (!v) return <Badge variant="secondary">—</Badge>;
  const n = parseFloat(v);
  if (n >= 0.9) return <Badge className="bg-green-100 text-green-800 border-green-200">{confidencePct(v)}</Badge>;
  if (n >= 0.6) return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">{confidencePct(v)}</Badge>;
  return <Badge variant="secondary">{confidencePct(v)}</Badge>;
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, variant = 'default' }: {
  label: string; value: number | string; icon: React.ReactNode;
  variant?: 'default' | 'warning' | 'success';
}) {
  const bg = variant === 'warning' ? 'border-yellow-200 bg-yellow-50' : variant === 'success' ? 'border-green-200 bg-green-50' : '';
  return (
    <Card className={bg}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">{icon}</div>
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Persons sub-tab ─────────────────────────────────────────────────────────
function PersonsTab() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { data, isLoading } = useGetPersons(
    debouncedSearch ? { search: debouncedSearch } : {},
    { query: { queryKey: getGetPersonsQueryKey(debouncedSearch ? { search: debouncedSearch } : {}), refetchInterval: 15000 } }
  );

  function onSearch(v: string) {
    setSearch(v);
    const t = setTimeout(() => setDebouncedSearch(v), 350);
    return () => clearTimeout(t);
  }

  const persons = data?.persons ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Поиск по имени, телефону, email…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-muted-foreground">{data?.total ?? 0} персон</span>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="text-xs">Имя</TableHead>
              <TableHead className="text-xs">Телефон</TableHead>
              <TableHead className="text-xs">Email</TableHead>
              <TableHead className="text-xs">Роли</TableHead>
              <TableHead className="text-xs">Первый контакт</TableHead>
              <TableHead className="text-xs">Последний</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Загрузка…</TableCell></TableRow>
            )}
            {!isLoading && persons.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Персоны не найдены. Нажмите «Запустить сопоставление».</TableCell></TableRow>
            )}
            {persons.map((p) => (
              <TableRow key={p.id} className="text-xs font-mono">
                <TableCell className="font-medium font-sans">{fmt(p.fullName)}</TableCell>
                <TableCell>{fmt(p.primaryPhone)}</TableCell>
                <TableCell>{fmt(p.primaryEmail)}</TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {p.isStudent && <Badge variant="outline" className="text-[10px] py-0 px-1"><GraduationCap className="w-3 h-3 mr-0.5" />ученик</Badge>}
                    {p.isLead && <Badge variant="outline" className="text-[10px] py-0 px-1"><Megaphone className="w-3 h-3 mr-0.5" />лид</Badge>}
                    {p.isParent && <Badge variant="outline" className="text-[10px] py-0 px-1">родитель</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(p.firstSeenAt)}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(p.lastSeenAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Queue sub-tab ────────────────────────────────────────────────────────────
function QueueTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useGetIdentityQueue(
    { status: 'manual_review' },
    { query: { queryKey: getGetIdentityQueueQueryKey({ status: 'manual_review' }), refetchInterval: 10000 } }
  );
  const { mutate: resolve, isPending } = useResolveQueueItem({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetIdentityQueueQueryKey({ status: 'manual_review' }) }),
    },
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {data?.total ?? 0} элементов ожидают проверки
      </div>
      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="text-xs">Лид</TableHead>
              <TableHead className="text-xs">Предложенная персона</TableHead>
              <TableHead className="text-xs">Причина</TableHead>
              <TableHead className="text-xs">Уверенность</TableHead>
              <TableHead className="text-xs">Действие</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Загрузка…</TableCell></TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Очередь пуста — всё сопоставлено!</TableCell></TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.id} className="text-xs align-top">
                <TableCell>
                  <div className="font-medium">{fmt(item.lead?.clientName)}</div>
                  <div className="text-muted-foreground">{fmt(item.lead?.phone)}</div>
                  <div className="text-muted-foreground">{fmt(item.lead?.sourceSystem)}</div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{fmt(item.suggestedPerson?.fullName)}</div>
                  <div className="text-muted-foreground">{fmt(item.suggestedPerson?.primaryPhone)}</div>
                </TableCell>
                <TableCell className="font-mono text-[11px] max-w-[140px] break-words">{fmt(item.matchReason)}</TableCell>
                <TableCell>{confidenceBadge(item.confidence)}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] text-green-700 border-green-200 hover:bg-green-50"
                      disabled={isPending}
                      onClick={() => resolve({ id: item.id, data: { action: 'approve' } })}
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />Да
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] text-red-700 border-red-200 hover:bg-red-50"
                      disabled={isPending}
                      onClick={() => resolve({ id: item.id, data: { action: 'reject' } })}
                    >
                      <XCircle className="w-3 h-3 mr-1" />Нет
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      disabled={isPending}
                      onClick={() => resolve({ id: item.id, data: { action: 'new_person' } })}
                    >
                      <UserPlus className="w-3 h-3 mr-1" />Новый
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Unmatched sub-tab ────────────────────────────────────────────────────────
function UnmatchedTab() {
  const { data: leads, isLoading: leadsLoading } = useGetUnmatchedLeads(
    {},
    { query: { queryKey: getGetUnmatchedLeadsQueryKey(), refetchInterval: 15000 } }
  );
  const { data: students, isLoading: studentsLoading } = useGetOrphanStudents(
    {},
    { query: { queryKey: getGetOrphanStudentsQueryKey(), refetchInterval: 15000 } }
  );

  return (
    <div className="space-y-6">
      {/* Unmatched leads */}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Megaphone className="w-4 h-4" />
          Несвязанные лиды <Badge variant="secondary">{Array.isArray(leads) ? leads.length : 0}</Badge>
        </h3>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="text-xs">Имя</TableHead>
                <TableHead className="text-xs">Телефон</TableHead>
                <TableHead className="text-xs">Канал</TableHead>
                <TableHead className="text-xs">Источник</TableHead>
                <TableHead className="text-xs">Дата</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leadsLoading && <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">Загрузка…</TableCell></TableRow>}
              {!leadsLoading && (!Array.isArray(leads) || leads.length === 0) && (
                <TableRow><TableCell colSpan={5} className="text-center py-4 text-green-600 text-sm">Все лиды сопоставлены!</TableCell></TableRow>
              )}
              {Array.isArray(leads) && leads.map((l) => (
                <TableRow key={l.id} className="text-xs font-mono">
                  <TableCell className="font-sans">{fmt(l.clientName)}</TableCell>
                  <TableCell>{fmt(l.phone)}</TableCell>
                  <TableCell>{fmt(l.channel)}</TableCell>
                  <TableCell>{fmt(l.sourceSystem)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(l.createdAt ?? l.eventTime)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Orphan students */}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <GraduationCap className="w-4 h-4" />
          Ученики без персоны <Badge variant="secondary">{Array.isArray(students) ? students.length : 0}</Badge>
        </h3>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="text-xs">Имя</TableHead>
                <TableHead className="text-xs">Телефон</TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentsLoading && <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">Загрузка…</TableCell></TableRow>}
              {!studentsLoading && (!Array.isArray(students) || students.length === 0) && (
                <TableRow><TableCell colSpan={4} className="text-center py-4 text-green-600 text-sm">Все ученики сопоставлены!</TableCell></TableRow>
              )}
              {Array.isArray(students) && students.map((s) => (
                <TableRow key={s.id} className="text-xs font-mono">
                  <TableCell className="font-sans">{fmt(s.fullName)}</TableCell>
                  <TableCell>{fmt(s.phone)}</TableCell>
                  <TableCell>{fmt(s.email)}</TableCell>
                  <TableCell>{fmt(s.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

// ─── Duplicates sub-tab ───────────────────────────────────────────────────────
interface DupGroup {
  normalized_value?: string | null;
  contact_type?: string | null;
  person_ids?: string[] | null;
  person_count?: string | number | null;
  all_are_guardians?: boolean | null;
  family_count?: string | number | null;
}

function DupTable({ rows, emptyMsg }: { rows: DupGroup[]; emptyMsg: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-green-700 py-3">{emptyMsg}</p>;
  }
  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="text-xs">Тип</TableHead>
            <TableHead className="text-xs">Значение</TableHead>
            <TableHead className="text-xs">Персон</TableHead>
            <TableHead className="text-xs">ID персон</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className="text-xs font-mono">
              <TableCell>
                {r.contact_type === 'phone'
                  ? <span className="flex items-center gap-1"><Phone className="w-3 h-3" />phone</span>
                  : <span className="flex items-center gap-1"><Mail className="w-3 h-3" />email</span>}
              </TableCell>
              <TableCell>{fmt(r.normalized_value)}</TableCell>
              <TableCell>
                <Badge variant="destructive" className="text-[11px]">{String(r.person_count ?? '?')}</Badge>
              </TableCell>
              <TableCell className="text-[10px] text-muted-foreground break-all">
                {Array.isArray(r.person_ids) ? r.person_ids.join(', ') : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DuplicatesTab() {
  const { data, isLoading } = useGetIdentityDuplicates({
    query: { queryKey: getGetIdentityDuplicatesQueryKey(), refetchInterval: 30000 },
  });

  const d = data as { realDuplicates?: DupGroup[]; familyGroups?: DupGroup[]; total?: number } | undefined;
  const realDuplicates = d?.realDuplicates ?? [];
  const familyGroups = d?.familyGroups ?? [];

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Загрузка…</div>;

  return (
    <div className="space-y-6">
      {/* Real duplicates */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Badge variant="destructive" className="text-[11px]">{realDuplicates.length}</Badge>
          Реальные дубликаты — требуют проверки
        </h3>
        <DupTable rows={realDuplicates} emptyMsg="✓ Реальных дубликатов не обнаружено" />
      </div>

      {/* Family-shared phone groups */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
          <Badge variant="secondary" className="text-[11px]">{familyGroups.length}</Badge>
          Общий телефон родителя (норма)
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Братья/сёстры с одним родительским номером. Это ожидаемо — эти группы отображаются в табе «Семьи».
        </p>
        <DupTable rows={familyGroups} emptyMsg="Групп с общим родительским телефоном нет" />
      </div>
    </div>
  );
}

// ─── Main Identity Resolution Center ─────────────────────────────────────────
export function IdentityPage() {
  const [subTab, setSubTab] = useState<SubTab>('persons');
  const qc = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useGetIdentityStats({
    query: {
      queryKey: getGetIdentityStatsQueryKey(),
      refetchInterval: 10000,
    },
  });

  const { mutate: runMatching, isPending: isRunning, data: matchResult } = useRunIdentityMatching({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetIdentityStatsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPersonsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetIdentityQueueQueryKey({ status: 'manual_review' }) });
        qc.invalidateQueries({ queryKey: getGetUnmatchedLeadsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetOrphanStudentsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetIdentityDuplicatesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetIdentityFamiliesQueryKey() });
      },
    },
  });

  const { mutate: buildTimeline, isPending: isBuildingTimeline, data: timelineResult } = useBuildTimeline({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetIdentityFamiliesQueryKey() });
      },
    },
  });

  const { mutate: calcHealth, isPending: isCalcHealth, data: healthResult } = useCalcHealth({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetIdentityFamiliesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFamiliesAtRiskQueryKey() });
      },
    },
  });

  const subTabs: { key: SubTab; label: string; badge?: number }[] = [
    { key: 'persons', label: 'Все персоны', badge: stats?.personsTotal },
    { key: 'queue', label: 'Очередь проверки', badge: stats?.manualReviewQueue },
    { key: 'unmatched', label: 'Несвязанные', badge: (stats?.unmatchedLeads ?? 0) + (stats?.orphanStudents ?? 0) },
    { key: 'families', label: 'Семьи', badge: stats?.familiesTotal },
    { key: 'duplicates', label: 'Дубликаты' },
    { key: 'quality', label: 'Data Quality' },
    { key: 'raw', label: 'Raw Preview' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-primary" />
            Identity Resolution Center
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Единый слой людей — один человек из всех источников.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => buildTimeline()}
            disabled={isBuildingTimeline}
            className="gap-1.5"
          >
            {isBuildingTimeline ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
            Построить Timeline
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => calcHealth()}
            disabled={isCalcHealth}
            className="gap-1.5"
          >
            {isCalcHealth ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            Рассчитать Health
          </Button>
          <Button
            size="sm"
            onClick={() => runMatching()}
            disabled={isRunning}
            className="gap-2"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isRunning ? 'Сопоставление…' : 'Запустить сопоставление'}
          </Button>
        </div>
      </div>

      {/* Result toast */}
      {matchResult && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-3 pb-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-green-900">
              <span>Лидов: <strong>{matchResult.leadsProcessed}</strong></span>
              <span>Учеников создано: <strong>{matchResult.studentsCreated}</strong></span>
              <span>Родителей создано: <strong>{matchResult.guardiansCreated}</strong></span>
              <span>Родителей переиспользовано: <strong>{matchResult.guardiansReused}</strong></span>
              <span>Семей: <strong>{matchResult.familiesCreated}</strong></span>
              <span>Связей guardian–student: <strong>{matchResult.familyLinksCreated}</strong></span>
              <span>На проверку: <strong>{matchResult.manualReviewQueue}</strong></span>
              <span>Всего персон: <strong>{matchResult.personsTotal}</strong></span>
              <span>Всего семей: <strong>{matchResult.familiesTotal}</strong></span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Всего персон"
          value={statsLoading ? '…' : stats?.personsTotal ?? 0}
          icon={<Users className="w-4 h-4 text-primary" />}
          variant="success"
        />
        <StatCard
          label="Семьи"
          value={statsLoading ? '…' : stats?.familiesTotal ?? 0}
          icon={<Home className="w-4 h-4 text-indigo-500" />}
          variant={(stats?.familiesTotal ?? 0) > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Родители"
          value={statsLoading ? '…' : stats?.personsWithGuardian ?? 0}
          icon={<Users className="w-4 h-4 text-violet-500" />}
        />
        <StatCard
          label="Ученики"
          value={statsLoading ? '…' : stats?.personsWithStudent ?? 0}
          icon={<GraduationCap className="w-4 h-4 text-green-600" />}
        />
        <StatCard
          label="На проверке"
          value={statsLoading ? '…' : stats?.manualReviewQueue ?? 0}
          icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}
          variant={(stats?.manualReviewQueue ?? 0) > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Secondary stats */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>Лиды: <strong className="text-foreground">{stats?.personsWithLead ?? 0}</strong></span>
        <span>Авто-сопоставлено: <strong className="text-foreground">{stats?.autoMatchedTotal ?? 0}</strong></span>
        <span>Несвязанных лидов: <strong className={stats?.unmatchedLeads ? 'text-yellow-700' : 'text-foreground'}>{stats?.unmatchedLeads ?? 0}</strong></span>
        <span>Учеников без персоны: <strong className={stats?.orphanStudents ? 'text-yellow-700' : 'text-foreground'}>{stats?.orphanStudents ?? 0}</strong></span>
      </div>

      {/* Sub-tabs */}
      <div>
        <div className="flex gap-1 border-b mb-4">
          {subTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors relative flex items-center gap-1.5 ${
                subTab === t.key
                  ? 'text-primary border-b-2 border-primary -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <Badge
                  variant={t.key === 'queue' ? 'destructive' : 'secondary'}
                  className="text-[10px] h-4 min-w-[16px] px-1"
                >
                  {t.badge}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {subTab === 'persons' && <PersonsTab />}
        {subTab === 'queue' && <QueueTab />}
        {subTab === 'unmatched' && <UnmatchedTab />}
        {subTab === 'families' && <FamiliesTab />}
        {subTab === 'duplicates' && <DuplicatesTab />}
        {subTab === 'quality' && <IdentityQualityTab />}
        {subTab === 'raw' && <StudentRawPreviewTab />}
      </div>
    </div>
  );
}
