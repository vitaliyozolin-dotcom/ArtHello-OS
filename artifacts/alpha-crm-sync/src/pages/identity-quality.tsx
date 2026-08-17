import { useState } from 'react';
import {
  useGetIdentityQualityCheck,
  useGetStudentRawPreview,
  getGetIdentityQualityCheckQueryKey,
  getGetStudentRawPreviewQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Phone, AlertTriangle, Users, UserCheck, GitMerge, Copy,
  Search, Download, ChevronDown, ChevronUp, GraduationCap,
  Megaphone, CheckCircle2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type QualityRecord = Record<string, unknown>;
type QualitySection = { count: number; records?: QualityRecord[]; groups?: QualityRecord[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function fmtDate(v: unknown): string {
  if (!v || v === 'null') return '—';
  try { return new Date(String(v)).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return String(v); }
}

function buildCsvUrl(section: string): string {
  return `/api/identity/quality-check?section=${section}&format=csv`;
}

// ─── Collapsible quality block ────────────────────────────────────────────────
function QualityBlock({
  title, icon, count, variant = 'default', children, section,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  variant?: 'ok' | 'warn' | 'bad' | 'default';
  children: React.ReactNode;
  section: string;
}) {
  const [open, setOpen] = useState(false);
  const borderColor = variant === 'ok' ? 'border-green-200' : variant === 'warn' ? 'border-yellow-200' : variant === 'bad' ? 'border-red-200' : '';
  const bgColor = variant === 'ok' ? 'bg-green-50' : variant === 'warn' ? 'bg-yellow-50' : variant === 'bad' ? 'bg-red-50' : '';
  const badgeColor = variant === 'ok' ? 'bg-green-100 text-green-800' : variant === 'warn' ? 'bg-yellow-100 text-yellow-800' : variant === 'bad' ? 'bg-red-100 text-red-800' : '';

  return (
    <Card className={`${borderColor}`}>
      <CardHeader className={`pb-2 pt-3 ${bgColor} rounded-t-lg`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-semibold">{title}</span>
            <Badge className={`text-xs ${badgeColor}`}>{count}</Badge>
          </div>
          <div className="flex gap-2">
            {count > 0 && (
              <a href={buildCsvUrl(section)} download>
                <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1">
                  <Download className="w-3 h-3" />CSV
                </Button>
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] gap-1"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {open ? 'Скрыть' : 'Показать'}
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="pt-3 pb-3">
          {count === 0
            ? <p className="text-sm text-green-700 py-2">Проблем не обнаружено ✓</p>
            : children}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Simple record table ──────────────────────────────────────────────────────
function RecordTable({ records, columns }: {
  records: QualityRecord[];
  columns: { key: string; label: string; render?: (v: unknown, row: QualityRecord) => React.ReactNode }[];
}) {
  return (
    <div className="rounded-md border overflow-auto max-h-72">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            {columns.map((c) => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.slice(0, 100).map((r, i) => (
            <TableRow key={i} className="text-xs font-mono">
              {columns.map((c) => (
                <TableCell key={c.key}>
                  {c.render ? c.render(r[c.key], r) : fmt(r[c.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Quality Check tab ────────────────────────────────────────────────────────
export function IdentityQualityTab() {
  const { data, isLoading } = useGetIdentityQualityCheck(
    {},
    { query: { queryKey: getGetIdentityQualityCheckQueryKey(), refetchInterval: 30000 } }
  );

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Загрузка данных качества…</div>;

  const q = data as Record<string, QualitySection> | undefined;
  if (!q) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Диагностика данных — выявляет пробелы, дубли и несвязанные записи.
      </p>

      {/* 1. Without phone */}
      <QualityBlock
        title="Ученики без телефона"
        icon={<Phone className="w-4 h-4" />}
        count={q.studentsWithoutPhone?.count ?? 0}
        section="studentsWithoutPhone"
        variant={q.studentsWithoutPhone?.count ? 'bad' : 'ok'}
      >
        <RecordTable
          records={q.studentsWithoutPhone?.records ?? []}
          columns={[
            { key: 'crm_id', label: 'CRM ID' },
            { key: 'full_name', label: 'Имя' },
            { key: 'parent_name', label: 'Родитель' },
            { key: 'branch_crm_id', label: 'Филиал' },
          ]}
        />
      </QualityBlock>

      {/* 2. Invalid phone */}
      <QualityBlock
        title="Ученики с некорректным телефоном"
        icon={<AlertTriangle className="w-4 h-4 text-red-500" />}
        count={q.studentsInvalidPhone?.count ?? 0}
        section="studentsInvalidPhone"
        variant={q.studentsInvalidPhone?.count ? 'bad' : 'ok'}
      >
        <RecordTable
          records={q.studentsInvalidPhone?.records ?? []}
          columns={[
            { key: 'crm_id', label: 'CRM ID' },
            { key: 'full_name', label: 'Имя' },
            { key: 'phone', label: 'Телефон (некорректный)' },
            { key: 'parent_name', label: 'Родитель' },
            { key: 'raw_phones', label: 'raw.phone[]', render: (v) => <span className="text-muted-foreground">{fmt(v)}</span> },
          ]}
        />
      </QualityBlock>

      {/* 3. Family groups */}
      <QualityBlock
        title="Семьи — братья/сёстры (один родительский телефон)"
        icon={<Users className="w-4 h-4 text-blue-600" />}
        count={q.familyGroups?.count ?? 0}
        section="familyGroups"
        variant="default"
      >
        <div className="space-y-3 max-h-72 overflow-auto">
          {(q.familyGroups?.groups ?? []).map((group, i) => (
            <div key={i} className="border rounded p-2">
              <div className="flex items-center gap-2 mb-2">
                <Phone className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-mono font-semibold">{fmt(group.phone)}</span>
                <Badge variant="secondary" className="text-[10px]">{fmt(group.student_count)} учеников</Badge>
              </div>
              <div className="space-y-1">
                {(group.students as QualityRecord[] ?? []).map((s, j) => (
                  <div key={j} className="text-xs flex gap-3 text-muted-foreground">
                    <span className="font-mono">{fmt(s.crm_id)}</span>
                    <span className="font-sans text-foreground">{fmt(s.full_name)}</span>
                    <span>родитель: {fmt(s.parent_name)}</span>
                    <span>филиал: {fmt(s.branch_crm_id)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </QualityBlock>

      {/* 4. Student-only persons */}
      <QualityBlock
        title="Персоны только из CRM (без лида)"
        icon={<GraduationCap className="w-4 h-4 text-blue-500" />}
        count={q.personsStudentOnly?.count ?? 0}
        section="personsStudentOnly"
        variant={q.personsStudentOnly?.count ? 'warn' : 'ok'}
      >
        <RecordTable
          records={q.personsStudentOnly?.records ?? []}
          columns={[
            { key: 'full_name', label: 'Имя' },
            { key: 'primary_phone', label: 'Телефон' },
            { key: 'primary_email', label: 'Email' },
            { key: 'confidence_score', label: 'Confidence' },
          ]}
        />
      </QualityBlock>

      {/* 5. Lead-only persons */}
      <QualityBlock
        title="Персоны только из лидов (без ученика в CRM)"
        icon={<Megaphone className="w-4 h-4 text-orange-500" />}
        count={q.personsLeadOnly?.count ?? 0}
        section="personsLeadOnly"
        variant={q.personsLeadOnly?.count ? 'warn' : 'ok'}
      >
        <RecordTable
          records={q.personsLeadOnly?.records ?? []}
          columns={[
            { key: 'full_name', label: 'Имя' },
            { key: 'primary_phone', label: 'Телефон' },
            { key: 'primary_email', label: 'Email' },
          ]}
        />
      </QualityBlock>

      {/* 6. Both student and lead */}
      <QualityBlock
        title="Персоны связаны и с учеником, и с лидом"
        icon={<GitMerge className="w-4 h-4 text-green-600" />}
        count={q.personsBothStudentAndLead?.count ?? 0}
        section="personsBothStudentAndLead"
        variant={q.personsBothStudentAndLead?.count ? 'ok' : 'default'}
      >
        <RecordTable
          records={q.personsBothStudentAndLead?.records ?? []}
          columns={[
            { key: 'full_name', label: 'Имя' },
            { key: 'primary_phone', label: 'Телефон' },
            { key: 'confidence_score', label: 'Confidence' },
          ]}
        />
      </QualityBlock>

      {/* 7. Students linked to person */}
      <QualityBlock
        title="Ученики, привязанные к персоне"
        icon={<UserCheck className="w-4 h-4 text-green-600" />}
        count={q.studentsLinkedToPerson?.count ?? 0}
        section="studentsLinkedToPerson"
        variant={q.studentsLinkedToPerson?.count ? 'ok' : 'default'}
      >
        <RecordTable
          records={q.studentsLinkedToPerson?.records ?? []}
          columns={[
            { key: 'crm_id', label: 'CRM ID' },
            { key: 'full_name', label: 'Ученик' },
            { key: 'parent_name', label: 'Родитель' },
            { key: 'phone', label: 'Телефон' },
            { key: 'person_full_name', label: 'Персона' },
            { key: 'confidence', label: 'Conf.' },
            { key: 'is_lead', label: 'Есть лид', render: (v) => v ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <span className="text-muted-foreground">—</span> },
          ]}
        />
      </QualityBlock>

      {/* 8. Phone mismatch */}
      <QualityBlock
        title="Расхождение raw.phone[0] и phone (или несколько телефонов)"
        icon={<AlertTriangle className="w-4 h-4 text-yellow-500" />}
        count={q.possiblePhoneMismatch?.count ?? 0}
        section="possiblePhoneMismatch"
        variant={q.possiblePhoneMismatch?.count ? 'warn' : 'ok'}
      >
        <RecordTable
          records={q.possiblePhoneMismatch?.records ?? []}
          columns={[
            { key: 'crm_id', label: 'CRM ID' },
            { key: 'full_name', label: 'Имя' },
            { key: 'parent_name', label: 'Родитель' },
            { key: 'stored_phone', label: 'phone (БД)' },
            { key: 'raw_first_phone', label: 'raw.phone[0]' },
            { key: 'all_raw_phones', label: 'Все raw.phones', render: (v) => <span className="text-muted-foreground text-[10px]">{fmt(v)}</span> },
          ]}
        />
      </QualityBlock>
    </div>
  );
}

// ─── Student Raw Preview tab ───────────────────────────────────────────────────
export function StudentRawPreviewTab() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  function onSearch(v: string) {
    setSearch(v);
    const t = setTimeout(() => setDebouncedSearch(v), 350);
    return () => clearTimeout(t);
  }

  const params = debouncedSearch ? { search: debouncedSearch } : {};
  const { data: rows, isLoading } = useGetStudentRawPreview(
    params,
    { query: { queryKey: getGetStudentRawPreviewQueryKey(params), refetchInterval: 30000 } }
  );

  const records = Array.isArray(rows) ? rows as QualityRecord[] : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Поиск по имени, телефону, имени родителя…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-muted-foreground">{records.length} учеников</span>
      </div>

      <div className="rounded-md border overflow-auto max-h-[560px]">
        <Table>
          <TableHeader className="bg-muted/30 sticky top-0 z-10">
            <TableRow>
              <TableHead className="text-xs">CRM ID</TableHead>
              <TableHead className="text-xs">Имя ученика</TableHead>
              <TableHead className="text-xs">Телефон (БД)</TableHead>
              <TableHead className="text-xs">Родитель (legal_name)</TableHead>
              <TableHead className="text-xs">raw.phone[]</TableHead>
              <TableHead className="text-xs">raw.contacts</TableHead>
              <TableHead className="text-xs">Дата рожд.</TableHead>
              <TableHead className="text-xs">Персона</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Загрузка…</TableCell></TableRow>
            )}
            {!isLoading && records.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Ничего не найдено</TableCell></TableRow>
            )}
            {records.map((r, i) => (
              <TableRow key={i} className={`text-xs font-mono ${r.is_linked ? '' : 'opacity-60'}`}>
                <TableCell className="text-muted-foreground">{fmt(r.crm_id)}</TableCell>
                <TableCell className="font-sans font-medium">{fmt(r.full_name)}</TableCell>
                <TableCell>{fmt(r.stored_phone)}</TableCell>
                <TableCell className="font-sans text-blue-700">{fmt(r.parent_name)}</TableCell>
                <TableCell>
                  {(() => {
                    try {
                      const arr = r.raw_phones;
                      if (Array.isArray(arr)) return <span className="text-muted-foreground">[{arr.join(', ')}]</span>;
                      return <span className="text-muted-foreground">{fmt(r.raw_phones)}</span>;
                    } catch { return '—'; }
                  })()}
                </TableCell>
                <TableCell>
                  {r.raw_contacts && r.raw_contacts !== 'null'
                    ? <span className="text-orange-600 text-[10px]">{fmt(r.raw_contacts)}</span>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{fmt(r.dob)}</TableCell>
                <TableCell>
                  {r.is_linked
                    ? <span className="text-green-700 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{fmt(r.linked_person_name)}</span>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
