import { useState, lazy, Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
const FinancePage = lazy(() => import('./finance'));
const IntegrationsPage = lazy(() => import('./integrations'));
const IdentityPage = lazy(() => import('./identity').then((m) => ({ default: m.IdentityPage })));
const BankingPage = lazy(() => import('./banking').then((m) => ({ default: m.BankingPage })));
import {
  useGetSyncStats,
  useGetSyncLogs,
  useGetBranches,
  useGetMarketingStats,
  useGetMarketingLeads,
  useGetLeadEvents,
  useGetFamiliesAtRisk,
  getGetSyncLogsQueryKey,
  getGetSyncStatsQueryKey,
  getGetBranchesQueryKey,
  getGetMarketingStatsQueryKey,
  getGetMarketingLeadsQueryKey,
  getGetLeadEventsQueryKey,
  getGetFamiliesAtRiskQueryKey,
  useTestConnection,
  useSyncBranches,
  useDiscoverEndpoints,
  useDetectLessonsEndpoint,
  useFindAtlas,
  useSyncStudentsAtlas,
  useNormalizeStudentsFromRaw,
  useNormalizeTeachersFromRaw,
  useNormalizeGroupsFromRaw,
  useNormalizeLessonsFromRaw,
  useExtractAttendanceFromRaw,
  useSyncPaymentsAtlas,
  useSyncLessonsAtlas,
  useSyncAttendanceFromLessons,
  useSyncSubjects,
  useSyncGoogleLeads,
  useSetAtlasBranch,
  useHealthCheck,
  type BranchSyncResult,
  type DetectEndpointResult,
  type FindAtlasResult,
  type GoogleLeadsSyncResult,
} from '@workspace/api-client-react';
import { FamilyTimelineDrawer } from './family-timeline-drawer';
import { SyncAction } from '@/components/SyncAction';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Activity, Database, RefreshCw, GitBranch,
  ChevronDown, ChevronUp, CheckCircle, Search, Loader2,
  BookOpen, Users, CreditCard, Calendar, TrendingUp,
  Megaphone, FileSpreadsheet, AlertCircle, ArrowUpRight,
  Zap, Eye, CircleDollarSign, GitMerge, Banknote,
  Heart, AlertTriangle, History, Phone, GraduationCap,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusBadgeClass(s: string) {
  switch (s.toLowerCase()) {
    case 'success': return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
    case 'error':   return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
    default:        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300';
  }
}

function fuzzyHighlight(name: string | null | undefined) {
  if (!name) return <span className="text-muted-foreground italic">—</span>;
  const lower = name.toLowerCase();
  const isMatch = lower.includes('atlas') || lower.includes('атлас');
  return <span className={isMatch ? 'font-semibold text-primary' : ''}>{name}</span>;
}

function StatCard({ label, value, icon, sub, colorClass = '' }: {
  label: string; value: number | null | undefined; icon: React.ReactNode;
  sub?: string; colorClass?: string;
}) {
  return (
    <div className="bg-card border rounded-xl p-4 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className={`text-muted-foreground ${colorClass}`}>{icon}</span>
      </div>
      <span className="text-3xl font-mono font-semibold">{value ?? 0}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

function SectionCard({ title, icon, children, className = '' }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3 border-b">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

// ─── Google Leads Sync result ─────────────────────────────────────────────────

function GoogleSyncResult({ result }: { result: GoogleLeadsSyncResult }) {
  const s = result.stats;
  if (!s) return <p className="text-xs text-red-600 px-4 py-3">{result.message}</p>;
  return (
    <div className="px-4 py-3 space-y-3">
      <p className={`text-sm font-medium ${result.success ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        {result.message}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([
          { label: 'Rows found', value: s.rowsFound, color: 'text-foreground' },
          { label: 'Imported',   value: s.inserted,  color: 'text-green-700 dark:text-green-400' },
          { label: 'Duplicates', value: s.duplicates, color: 'text-yellow-700 dark:text-yellow-400' },
          { label: 'Skipped',    value: s.skipped,   color: 'text-muted-foreground' },
        ] as const).map((item) => (
          <div key={item.label} className="bg-muted/40 rounded-lg p-3 text-center border">
            <div className={`text-2xl font-mono font-bold ${item.color}`}>{item.value ?? 0}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{item.label}</div>
          </div>
        ))}
      </div>
      {s.unrecognisedRows && s.unrecognisedRows.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Unrecognised rows (no phone): {s.unrecognisedRows.join(', ')}</span>
        </div>
      )}
      {s.headers && s.headers.length > 0 && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Detected columns →</summary>
          <div className="mt-2 font-mono bg-muted/40 rounded p-2 text-[10px] space-y-0.5">
            {Object.entries(s.columnMap ?? {}).map(([field, idx]) => (
              <div key={field}><span className="text-primary">{field}</span> ← col {Number(idx) + 1}: "{s.headers?.[Number(idx)]}"</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Detect result (lessons) ──────────────────────────────────────────────────

function DetectPanel({ result }: { result: DetectEndpointResult }) {
  const [showProbes, setShowProbes] = useState(false);
  return (
    <div className="px-4 pb-4 space-y-2">
      <div className={`flex items-center gap-2 text-sm font-medium ${result.found ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        {result.found ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
        {result.message}
      </div>
      {result.path && (
        <code className="text-xs font-mono bg-muted px-2 py-1 rounded block break-all text-primary">
          {result.fullUrl ?? result.path}
        </code>
      )}
      {result.recordsTotal != null && (
        <Badge variant="secondary" className="text-xs font-mono">{result.recordsTotal} records total</Badge>
      )}
      <button
        className="text-xs text-muted-foreground underline-offset-2 hover:underline flex items-center gap-1"
        onClick={() => setShowProbes(v => !v)}
      >
        {showProbes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {result.probes?.length ?? 0} probes
      </button>
      {showProbes && (
        <div className="overflow-auto max-h-48 text-[10px] font-mono border rounded">
          {result.probes?.map((p, i) => (
            <div key={i} className={`flex gap-2 px-2 py-1 border-b last:border-b-0 ${p.status && p.status < 300 ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
              <span className="text-muted-foreground w-6">{p.method}</span>
              <span className="flex-1 truncate">{p.url}</span>
              <span className={p.status && p.status < 300 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{p.status ?? 'ERR'}</span>
              <span className="text-muted-foreground">{p.durationMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const queryClient = useQueryClient();

  // UI state
  const [showBranchDebug, setShowBranchDebug]   = useState(false);
  const [showBranchesTable, setShowBranchesTable] = useState(false);
  const [showSyncLogs, setShowSyncLogs]         = useState(false);
  const [showRawBranches, setShowRawBranches]   = useState(false);
  const [showDiscover, setShowDiscover]         = useState(false);
  const [atlasMatches, setAtlasMatches]         = useState<Array<{ crmId: string; name: string | null }>>([]);
  const [branchSyncDebug, setBranchSyncDebug]   = useState<BranchSyncResult | null>(null);
  const [lessonsDetect, setLessonsDetect]       = useState<DetectEndpointResult | null>(null);
  const [googleSyncResult, setGoogleSyncResult] = useState<GoogleLeadsSyncResult | null>(null);
  const [activeTab, setActiveTab]               = useState<'overview' | 'leads' | 'finance' | 'integrations' | 'crm' | 'identity' | 'banking'>('overview');
  const [drawerFamily, setDrawerFamily]         = useState<{ family_id?: string | null; guardian_name?: string | null; primary_phone?: string | null; family_name?: string | null; health_score?: string | null; churn_risk_score?: string | null; active_students?: number | null; inactive_students?: number | null; last_payment_at?: string | null; missed_lessons_30d?: number | null } | null>(null);

  // Data queries
  const { data: stats }    = useGetSyncStats({ query: { refetchInterval: 10000, queryKey: getGetSyncStatsQueryKey() } });
  const { data: health }   = useHealthCheck({ query: { refetchInterval: 10000, queryKey: ['health'] } });
  const { data: mktStats } = useGetMarketingStats({ query: { refetchInterval: 10000, queryKey: getGetMarketingStatsQueryKey() } });
  const { data: leads, isLoading: leadsLoading } = useGetMarketingLeads({ limit: 20 }, { query: { refetchInterval: 15000, queryKey: getGetMarketingLeadsQueryKey({ limit: 20 }) } });
  const { data: logs, isLoading: logsLoading } = useGetSyncLogs({ limit: 30 }, { query: { refetchInterval: 10000, queryKey: getGetSyncLogsQueryKey({ limit: 30 }) } });
  const { data: branches, isLoading: branchesLoading } = useGetBranches({ query: { refetchInterval: 30000, queryKey: getGetBranchesQueryKey() } });
  const { data: atRisk } = useGetFamiliesAtRisk({ limit: 10 }, { query: { queryKey: getGetFamiliesAtRiskQueryKey({ limit: 10 }), refetchInterval: 60000, staleTime: 30000 } });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetSyncStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSyncLogsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBranchesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMarketingStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMarketingLeadsQueryKey() });
  };

  // Mutations
  const testConnection    = useTestConnection();
  const syncBranches      = useSyncBranches();
  const discoverEndpoints = useDiscoverEndpoints();
  const detectLessons     = useDetectLessonsEndpoint();
  const findAtlas         = useFindAtlas();
  const syncStudents          = useSyncStudentsAtlas();
  const normalizeStudents     = useNormalizeStudentsFromRaw();
  const normalizeTeachers     = useNormalizeTeachersFromRaw();
  const normalizeGroups       = useNormalizeGroupsFromRaw();
  const normalizeLessons      = useNormalizeLessonsFromRaw();
  const extractAttendanceRaw  = useExtractAttendanceFromRaw();
  const syncPayments          = useSyncPaymentsAtlas();
  const syncLessons            = useSyncLessonsAtlas();
  const extractAttendance      = useSyncAttendanceFromLessons();
  const syncSubjects           = useSyncSubjects();
  const syncGoogleLeads        = useSyncGoogleLeads();
  const setAtlasBranch    = useSetAtlasBranch();

  const handleFindAtlasSuccess = (data: FindAtlasResult) => {
    invalidateAll();
    if (data.matches) setAtlasMatches(data.matches.map(m => ({ crmId: m.crmId, name: m.name ?? null })));
  };

  const handleGoogleSync = () => {
    syncGoogleLeads.mutate({ data: {} }, {
      onSuccess: (data) => {
        setGoogleSyncResult(data);
        invalidateAll();
      },
    });
  };

  const handleSetAtlas = (branchCrmId: string) => {
    setAtlasBranch.mutate({ data: { branchCrmId } }, { onSuccess: () => { invalidateAll(); setAtlasMatches([]); } });
  };

  // Channel color
  const channelColor: Record<string, string> = {
    vk: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    instagram: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
    telegram: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
    site: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
    referral: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    whatsapp: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  };
  const channelBadge = (ch: string | null | undefined) => {
    const k = (ch ?? '').toLowerCase();
    return channelColor[k] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  };

  return (
    <div className="min-h-screen bg-background p-4 lg:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ── */}
        <header className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b pb-5">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-3">
              <Database className="w-7 h-7 text-primary" />
              Owner Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">Atlas CRM · Data layer v0.1</p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 items-center bg-card border rounded-xl px-4 py-2.5 shadow-sm text-sm">
            <Pill label="API" dot={health?.status === 'ok'} value={health?.status ?? '…'} testId="status-health" />
            <div className="w-px h-8 bg-border hidden sm:block" />
            <Pill label="CRM" dot={stats?.connectionStatus === 'connected'} value={stats?.connectionStatus ?? '…'} testId="status-connection" />
            <div className="w-px h-8 bg-border hidden sm:block" />
            <Pill label="Atlas" value={stats?.atlasBranchId ?? 'Not set'} testId="status-atlas" mono />
            <div className="w-px h-8 bg-border hidden sm:block" />
            <Pill label="Synced" value={stats?.lastSyncAt ? format(new Date(stats.lastSyncAt), 'HH:mm:ss') : 'Never'} testId="status-lastSync" mono />
          </div>
        </header>

        {/* ── Tabs ── */}
        <div className="flex gap-2 border-b pb-0">
          {([
            { key: 'overview',      label: 'Overview', icon: <TrendingUp className="w-4 h-4" /> },
            { key: 'leads',         label: 'Leads / Marketing', icon: <Megaphone className="w-4 h-4" /> },
            { key: 'finance',       label: 'Finance', icon: <CircleDollarSign className="w-4 h-4" /> },
            { key: 'integrations',  label: 'Integrations', icon: <Zap className="w-4 h-4" /> },
            { key: 'identity',      label: 'Identity', icon: <GitMerge className="w-4 h-4" /> },
            { key: 'crm',           label: 'CRM Sync', icon: <Activity className="w-4 h-4" /> },
            { key: 'banking',       label: 'Banking', icon: <Banknote className="w-4 h-4" /> },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════ OVERVIEW ══════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="space-y-6">

            {/* Data counts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Branches"   value={stats?.branches}   icon={<GitBranch className="w-4 h-4" />} />
              <StatCard label="Students"   value={stats?.students}   icon={<Users className="w-4 h-4" />} />
              <StatCard label="Leads"      value={stats?.leadEvents} icon={<Megaphone className="w-4 h-4" />} sub="from all channels" colorClass="text-blue-500" />
              <StatCard label="Payments"   value={stats?.payments}   icon={<CreditCard className="w-4 h-4" />} />
              <StatCard label="Lessons"    value={stats?.lessons}    icon={<BookOpen className="w-4 h-4" />} />
              <StatCard label="Attendance" value={stats?.attendance} icon={<Calendar className="w-4 h-4" />} />
            </div>

            {/* Marketing summary row */}
            {mktStats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-card border rounded-xl p-4 space-y-1 shadow-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Total Leads</p>
                  <p className="text-3xl font-mono">{mktStats.totalLeads}</p>
                  <p className="text-xs text-muted-foreground">all channels, all time</p>
                </div>
                <div className="bg-card border rounded-xl p-4 space-y-1 shadow-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Converted</p>
                  <p className="text-3xl font-mono text-green-600 dark:text-green-400">{mktStats.matched}</p>
                  <p className="text-xs text-muted-foreground">matched to students</p>
                </div>
                <div className="bg-card border rounded-xl p-4 space-y-1 shadow-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Conversion Rate</p>
                  <p className="text-3xl font-mono">{mktStats.conversionRate}%</p>
                  <p className="text-xs text-muted-foreground">lead → student match</p>
                </div>
                <div className="bg-card border rounded-xl p-4 space-y-1 shadow-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Duplicates</p>
                  <p className="text-3xl font-mono text-yellow-600 dark:text-yellow-400">{mktStats.duplicates}</p>
                  <p className="text-xs text-muted-foreground">flagged for review</p>
                </div>
              </div>
            )}

            {/* Leads by channel */}
            {mktStats && mktStats.byChannel && mktStats.byChannel.length > 0 && (
              <SectionCard title="Leads by Channel" icon={<Megaphone className="w-4 h-4 text-primary" />}>
                <div className="p-4 flex flex-wrap gap-2">
                  {mktStats.byChannel.map((row) => {
                    const ch = String((row as Record<string, unknown>)['channel'] ?? '');
                    const cnt = Number((row as Record<string, unknown>)['cnt'] ?? 0);
                    return (
                      <div key={ch} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${channelBadge(ch)}`}>
                        {ch || '(unknown)'}
                        <span className="font-mono font-bold">{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {/* Atlas multi-match */}
            {atlasMatches.length > 1 && (
              <Card className="border-yellow-300 dark:border-yellow-700">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                    <GitBranch className="w-4 h-4" />
                    Multiple Atlas matches — select one
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableBody>
                      {atlasMatches.map((b) => (
                        <TableRow key={b.crmId} className="font-mono text-sm">
                          <TableCell className="text-muted-foreground">{b.crmId}</TableCell>
                          <TableCell>{fuzzyHighlight(b.name)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant={stats?.atlasBranchId === b.crmId ? 'default' : 'outline'}
                              onClick={() => handleSetAtlas(b.crmId)} disabled={setAtlasBranch.isPending}>
                              {stats?.atlasBranchId === b.crmId ? <><CheckCircle className="w-3 h-3 mr-1" />Active</> : 'Set as Atlas'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* Lessons endpoint badge */}
            {stats?.lessonsEndpoint && (
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg border text-xs font-mono border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30 w-fit">
                <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />
                <span className="text-muted-foreground font-sans font-medium">Lessons endpoint:</span>
                <span className="font-mono font-semibold text-violet-700 dark:text-violet-300">{stats.lessonsEndpoint}</span>
                {stats.lessonsEndpointTotal != null && <Badge variant="secondary" className="font-mono text-[10px]">{stats.lessonsEndpointTotal} total</Badge>}
              </div>
            )}

            {/* ── Families At Risk ── */}
            {atRisk && atRisk.families && atRisk.families.length > 0 && (
              <Card className="border-red-200">
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    Семьи под риском оттока
                    <Badge className="bg-red-100 text-red-800 border-red-200 ml-1">{atRisk.total}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-2">
                  {atRisk.families.slice(0, 5).map((f) => {
                    const score = f.health_score ? Math.round(parseFloat(f.health_score)) : null;
                    const risk = f.churn_risk_score ? parseFloat(f.churn_risk_score) : null;
                    const scoreCls = score !== null
                      ? score >= 50 ? 'text-yellow-700' : 'text-red-700'
                      : 'text-muted-foreground';
                    return (
                      <div
                        key={f.family_id}
                        className="flex items-center gap-3 py-2 px-3 rounded-md border bg-background hover:bg-muted/40 cursor-pointer transition-colors"
                        onClick={() => setDrawerFamily({
                          family_id: f.family_id,
                          guardian_name: f.guardian_name,
                          primary_phone: f.primary_phone,
                          family_name: f.family_name,
                          health_score: f.health_score,
                          churn_risk_score: f.churn_risk_score,
                          active_students: f.active_students,
                          inactive_students: f.inactive_students,
                          last_payment_at: f.last_payment_at,
                          missed_lessons_30d: f.missed_lessons_30d,
                        })}
                      >
                        <Heart className={`w-4 h-4 shrink-0 ${scoreCls}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{f.guardian_name ?? '—'}</span>
                            {f.active_students != null && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <GraduationCap className="w-3 h-3" />
                                {f.active_students}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="w-3 h-3" />{f.primary_phone ?? '—'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {score !== null && (
                            <div className={`text-sm font-bold ${scoreCls}`}>{score}</div>
                          )}
                          {risk !== null && risk >= 0.3 && (
                            <div className="text-[10px] text-muted-foreground">
                              риск {Math.round(risk * 100)}%
                            </div>
                          )}
                        </div>
                        <History className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    );
                  })}
                  {atRisk.total > 5 && (
                    <p className="text-xs text-center text-muted-foreground pt-1">
                      + ещё {atRisk.total - 5} семей. Подробности — в табе Идентификация → Семьи.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ══════════════════════════════ LEADS / MARKETING ══════════════════════════════ */}
        {activeTab === 'leads' && (
          <div className="space-y-6">

            {/* Google Sheets Sync card */}
            <Card>
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                  Google Sheets Leads Sync
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pulls rows from the promotion spreadsheet (<code className="text-xs bg-muted px-1 rounded">GOOGLE_SHEET_ID_PROMOTION</code>),
                  auto-detects columns, flags duplicates (phone + date + source), and matches leads to students by phone.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={handleGoogleSync}
                    disabled={syncGoogleLeads.isPending}
                    className="gap-2"
                    data-testid="btn-sync-google-leads"
                  >
                    {syncGoogleLeads.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing…</>
                      : <><FileSpreadsheet className="w-4 h-4" />Sync Leads from Google Sheet</>
                    }
                  </Button>
                  {mktStats && (
                    <span className="text-sm text-muted-foreground font-mono">
                      {mktStats.totalLeads} leads in DB · {mktStats.matched} matched · {mktStats.conversionRate}% conv.
                    </span>
                  )}
                </div>
                {googleSyncResult && <GoogleSyncResult result={googleSyncResult} />}
              </CardContent>
            </Card>

            {/* Stats row */}
            {mktStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total Leads"  value={mktStats.totalLeads}  icon={<Megaphone className="w-4 h-4" />} />
                <StatCard label="Matched"      value={mktStats.matched}     icon={<CheckCircle className="w-4 h-4" />} sub="linked to students" colorClass="text-green-500" />
                <StatCard label="Duplicates"   value={mktStats.duplicates}  icon={<AlertCircle className="w-4 h-4" />} colorClass="text-yellow-500" />
                <StatCard label="Conv. Rate"   value={mktStats.conversionRate} icon={<ArrowUpRight className="w-4 h-4" />} sub="% lead → student" colorClass="text-blue-500" />
              </div>
            )}

            {/* Channel breakdown */}
            {mktStats && mktStats.byChannel && mktStats.byChannel.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <SectionCard title="By Channel" icon={<Megaphone className="w-4 h-4 text-primary" />}>
                  <div className="divide-y">
                    {mktStats.byChannel.map((row) => {
                      const ch = String((row as Record<string, unknown>)['channel'] ?? '(unknown)');
                      const cnt = Number((row as Record<string, unknown>)['cnt'] ?? 0);
                      const pct = mktStats.totalLeads > 0 ? Math.round((cnt / mktStats.totalLeads) * 100) : 0;
                      return (
                        <div key={ch} className="flex items-center gap-3 px-4 py-2.5">
                          <Badge variant="outline" className={`text-xs ${channelBadge(ch)}`}>{ch}</Badge>
                          <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-sm font-mono font-semibold w-8 text-right">{cnt}</span>
                          <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard title="By Status" icon={<Activity className="w-4 h-4 text-primary" />}>
                  <div className="divide-y">
                    {(mktStats.byStatus ?? []).map((row) => {
                      const st = String((row as Record<string, unknown>)['status'] ?? '(unknown)');
                      const cnt = Number((row as Record<string, unknown>)['cnt'] ?? 0);
                      return (
                        <div key={st} className="flex items-center justify-between px-4 py-2.5 text-sm">
                          <span className="text-muted-foreground">{st}</span>
                          <span className="font-mono font-semibold">{cnt}</span>
                        </div>
                      );
                    })}
                    {(!mktStats.byStatus || mktStats.byStatus.length === 0) && (
                      <p className="text-center text-muted-foreground py-6 text-sm">No status data yet</p>
                    )}
                  </div>
                </SectionCard>
              </div>
            )}

            {/* Recent leads table */}
            <SectionCard title="Recent Leads (last 20)" icon={<Eye className="w-4 h-4 text-primary" />}>
              {leadsLoading ? (
                <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>
              ) : !leads || leads.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  No leads yet. Click "Sync Leads from Google Sheet" to import.
                </p>
              ) : (
                <div className="overflow-auto">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Channel</TableHead>
                        <TableHead className="text-xs">Source</TableHead>
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs">Phone</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Manager</TableHead>
                        <TableHead className="text-xs">Branch</TableHead>
                        <TableHead className="text-xs">Dup?</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.map((l) => (
                        <TableRow key={l.id} className="text-xs font-mono">
                          <TableCell className="text-muted-foreground whitespace-nowrap">{l.leadDate ?? '—'}</TableCell>
                          <TableCell>
                            {l.channel
                              ? <Badge variant="outline" className={`text-[10px] ${channelBadge(l.channel)}`}>{l.channel}</Badge>
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[120px] truncate" title={l.source ?? ''}>{l.source ?? '—'}</TableCell>
                          <TableCell>{l.leadName ?? '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{l.phone ?? '—'}</TableCell>
                          <TableCell>{l.status ?? '—'}</TableCell>
                          <TableCell className="text-muted-foreground">{l.manager ?? '—'}</TableCell>
                          <TableCell className="text-muted-foreground max-w-[100px] truncate">{l.branchName ?? '—'}</TableCell>
                          <TableCell>
                            {l.duplicateCandidate
                              ? <Badge variant="outline" className="text-[9px] border-yellow-400 text-yellow-700 dark:text-yellow-400">dup</Badge>
                              : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {/* ══════════════════════════════ CRM SYNC ══════════════════════════════ */}
        {activeTab === 'finance' && (
          <Suspense fallback={<div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading Finance…</div>}>
            <FinancePage />
          </Suspense>
        )}

        {activeTab === 'integrations' && (
          <Suspense fallback={<div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading Integrations…</div>}>
            <IntegrationsPage />
          </Suspense>
        )}

        {activeTab === 'identity' && (
          <Suspense fallback={<div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading Identity…</div>}>
            <IdentityPage />
          </Suspense>
        )}

        {activeTab === 'crm' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left: Sync actions */}
            <div className="space-y-4">

              {/* AlphaCRM sync */}
              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    AlphaCRM Sync
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-2">
                  <SyncAction label="Test Connection"       mutation={testConnection}  testId="action-test-connection" onSuccess={invalidateAll} />
                  <SyncAction label="Sync Branches"         mutation={syncBranches}    testId="action-sync-branches"   onSuccess={(d: BranchSyncResult) => { invalidateAll(); setBranchSyncDebug(d); setShowBranchDebug(true); }} />
                  <SyncAction label="Find Atlas Branch"     mutation={findAtlas}       testId="action-find-atlas"      onSuccess={handleFindAtlasSuccess} />
                  <SyncAction label="Sync Atlas Students"      mutation={syncStudents}          testId="action-sync-students"          onSuccess={invalidateAll} />
                  <SyncAction label="▶ Normalize Students (P7.1)" mutation={normalizeStudents} testId="action-normalize-students" onSuccess={invalidateAll} />
                  <SyncAction label="▶ Normalize Teachers (P7.2)" mutation={normalizeTeachers} testId="action-normalize-teachers" onSuccess={invalidateAll} />
                  <SyncAction label="▶ Normalize Groups (P7.2)"   mutation={normalizeGroups}   testId="action-normalize-groups"   onSuccess={invalidateAll} />
                  <SyncAction label="▶ Normalize Lessons (P7.3)"  mutation={normalizeLessons}      testId="action-normalize-lessons"      onSuccess={invalidateAll} />
                  <SyncAction label="▶ Extract Attendance (P7.4)" mutation={extractAttendanceRaw}  testId="action-extract-attendance-raw" onSuccess={invalidateAll} />
                  <SyncAction label="Sync Atlas Payments"   mutation={syncPayments}    testId="action-sync-payments"   onSuccess={invalidateAll} />
                  <SyncAction label="Sync Atlas Lessons"    mutation={syncLessons}          testId="action-sync-lessons"         onSuccess={invalidateAll} />
                  <SyncAction label="Sync Subjects"         mutation={syncSubjects}         testId="action-sync-subjects"        onSuccess={invalidateAll} />
                  <SyncAction label="Extract Attendance"    mutation={extractAttendance}    testId="action-extract-attendance"   onSuccess={invalidateAll} />
                </CardContent>
              </Card>

              {/* Endpoint detection */}
              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                    <Zap className="w-3.5 h-3.5" />
                    Endpoint Detection
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-2">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1.5"
                    onClick={() => detectLessons.mutate(undefined, { onSuccess: (d) => { setLessonsDetect(d); invalidateAll(); } })}
                    disabled={detectLessons.isPending} data-testid="btn-detect-lessons">
                    {detectLessons.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Detecting…</> : <><BookOpen className="w-3 h-3" />Detect Lessons Endpoint</>}
                  </Button>
                  {lessonsDetect && <DetectPanel result={lessonsDetect} />}
                  <Button variant="ghost" size="sm" className="w-full text-xs gap-1.5 text-muted-foreground"
                    onClick={() => discoverEndpoints.mutate(undefined, { onSuccess: () => { setShowDiscover(true); invalidateAll(); } })}
                    disabled={discoverEndpoints.isPending} data-testid="btn-discover">
                    {discoverEndpoints.isPending ? <><Loader2 className="w-3 h-3 animate-spin" />Discovering…</> : <><Search className="w-3 h-3" />Full API Discovery</>}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Right: Branch sync debug + Branches table + Logs */}
            <div className="lg:col-span-2 space-y-4">

              {/* Atlas multi-match */}
              {atlasMatches.length > 1 && (
                <Card className="border-yellow-300 dark:border-yellow-700">
                  <CardHeader className="pb-3 border-b">
                    <CardTitle className="text-sm text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                      <GitBranch className="w-4 h-4" /> Select Atlas branch
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableBody>
                        {atlasMatches.map((b) => (
                          <TableRow key={b.crmId} className="font-mono text-xs">
                            <TableCell className="text-muted-foreground">{b.crmId}</TableCell>
                            <TableCell>{fuzzyHighlight(b.name)}</TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant={stats?.atlasBranchId === b.crmId ? 'default' : 'outline'}
                                onClick={() => handleSetAtlas(b.crmId)} disabled={setAtlasBranch.isPending} className="text-xs h-7">
                                {stats?.atlasBranchId === b.crmId ? 'Active' : 'Set as Atlas'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Branch sync debug */}
              {branchSyncDebug && (
                <Card className={branchSyncDebug.success ? 'border-green-300 dark:border-green-800' : 'border-red-300 dark:border-red-800'}>
                  <CardHeader className="pb-3 border-b cursor-pointer select-none" onClick={() => setShowBranchDebug(v => !v)}>
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <GitBranch className="w-4 h-4 text-primary" />
                        Branch Sync Debug
                        <Badge variant="outline" className={branchSyncDebug.success ? 'border-green-400 text-green-700 dark:text-green-400' : 'border-red-400 text-red-700 dark:text-red-400'}>
                          {branchSyncDebug.success ? 'success' : 'failed'}
                        </Badge>
                        {branchSyncDebug.recordsCount != null && <Badge variant="secondary" className="font-mono">{branchSyncDebug.recordsCount}</Badge>}
                      </span>
                      {showBranchDebug ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </CardTitle>
                  </CardHeader>
                  {showBranchDebug && (
                    <CardContent className="p-4 space-y-3">
                      <code className="text-xs font-mono bg-muted px-2 py-1 rounded block break-all">{branchSyncDebug.endpointUsed ?? 'none'}</code>
                      {branchSyncDebug.probes && branchSyncDebug.probes.length > 0 && (
                        <div className="overflow-auto max-h-40 text-[10px] font-mono border rounded">
                          {branchSyncDebug.probes.map((p, i) => (
                            <div key={i} className={`flex gap-2 px-2 py-1 border-b last:border-b-0 ${p.status && p.status < 300 ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
                              <span className="text-muted-foreground">{p.method}</span>
                              <span className="flex-1 truncate">{p.url}</span>
                              <span>{p.status ?? 'ERR'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              )}

              {/* Branches table */}
              <Card>
                <CardHeader className="pb-3 border-b cursor-pointer select-none" onClick={() => setShowBranchesTable(v => !v)}>
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-primary" />
                      Branches
                      {branches && <Badge variant="secondary" className="font-mono">{branches.length}</Badge>}
                    </span>
                    {showBranchesTable ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </CardTitle>
                </CardHeader>
                {showBranchesTable && (
                  <CardContent className="p-0">
                    {branchesLoading ? (
                      <p className="text-center text-muted-foreground py-6 text-sm">Loading…</p>
                    ) : !branches || branches.length === 0 ? (
                      <p className="text-center text-muted-foreground py-6 text-sm">No branches. Run Sync Branches.</p>
                    ) : (
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            <TableHead className="text-xs">ID</TableHead>
                            <TableHead className="text-xs">Name</TableHead>
                            <TableHead className="text-xs text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {branches.map((b) => {
                            const isActive = stats?.atlasBranchId === b.crmId;
                            return (
                              <TableRow key={b.crmId} className="font-mono text-xs">
                                <TableCell className="text-muted-foreground">{b.crmId}</TableCell>
                                <TableCell>
                                  <span className="flex items-center gap-1.5">
                                    {fuzzyHighlight(b.name)}
                                    {isActive && <Badge variant="outline" className="text-[9px] border-green-400 text-green-700 dark:text-green-400">active</Badge>}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" variant={isActive ? 'default' : 'ghost'}
                                    onClick={() => handleSetAtlas(b.crmId)}
                                    disabled={setAtlasBranch.isPending || isActive}
                                    className="text-xs h-7">
                                    {isActive ? <><CheckCircle className="w-3 h-3 mr-1" />Active</> : 'Set Atlas'}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                )}
              </Card>

              {/* Raw branches */}
              <Card>
                <CardHeader className="pb-3 border-b cursor-pointer select-none" onClick={() => setShowRawBranches(v => !v)} data-testid="btn-toggle-raw-debug">
                  <CardTitle className="text-sm flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" />Raw Branches JSON</span>
                    {showRawBranches ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </CardTitle>
                </CardHeader>
                {showRawBranches && (
                  <CardContent className="p-0">
                    {!branches || branches.length === 0
                      ? <p className="text-center text-muted-foreground py-6 text-sm">No branches.</p>
                      : <pre className="text-[10px] font-mono bg-muted/40 p-4 overflow-auto max-h-80 whitespace-pre-wrap break-words" data-testid="debug-raw-branches">
                          {JSON.stringify(branches.map(b => b.raw), null, 2)}
                        </pre>
                    }
                  </CardContent>
                )}
              </Card>

              {/* Sync Logs */}
              <Card>
                <CardHeader className="pb-3 border-b cursor-pointer select-none" onClick={() => setShowSyncLogs(v => !v)}>
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-primary" />
                      Sync Logs
                      <span className="relative flex h-2 w-2 ml-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                      </span>
                    </span>
                    {showSyncLogs ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </CardTitle>
                </CardHeader>
                {showSyncLogs && (
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead className="text-xs w-16">Time</TableHead>
                          <TableHead className="text-xs w-24">Entity</TableHead>
                          <TableHead className="text-xs w-16">Status</TableHead>
                          <TableHead className="text-xs">Message</TableHead>
                          <TableHead className="text-xs text-right w-12">Rec.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logsLoading && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                        )}
                        {!logsLoading && (!logs || logs.length === 0) && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No logs yet.</TableCell></TableRow>
                        )}
                        {!logsLoading && logs?.map((log) => (
                          <TableRow key={log.id} className="font-mono text-xs">
                            <TableCell className="text-muted-foreground py-2 whitespace-nowrap">
                              {log.startedAt ? format(new Date(log.startedAt), 'HH:mm:ss') : '—'}
                            </TableCell>
                            <TableCell className="uppercase tracking-wide font-semibold py-2">{log.entity}</TableCell>
                            <TableCell className="py-2">
                              <Badge variant="outline" className={`text-[9px] rounded-sm shadow-none ${statusBadgeClass(log.status)}`}>{log.status}</Badge>
                            </TableCell>
                            <TableCell className="truncate max-w-[180px] py-2" title={log.message}>{log.message}</TableCell>
                            <TableCell className="text-right text-muted-foreground py-2">{log.recordsCount ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ── Banking ── */}
        {activeTab === 'banking' && (
          <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Загрузка...</div>}>
            <BankingPage />
          </Suspense>
        )}

      </div>

      {/* ── Family timeline drawer ── */}
      <FamilyTimelineDrawer
        family={drawerFamily}
        open={drawerFamily !== null}
        onClose={() => setDrawerFamily(null)}
      />
    </div>
  );
}

// ─── Small bits ───────────────────────────────────────────────────────────────

function Pill({ label, dot, value, testId, mono }: {
  label: string; dot?: boolean; value: string; testId?: string; mono?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
      <div className="flex items-center gap-1.5 mt-0.5">
        {dot !== undefined && (
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot ? 'bg-green-500' : 'bg-yellow-500'}`} />
        )}
        <span className={`${mono ? 'font-mono' : ''} text-sm capitalize`} data-testid={testId}>{value}</span>
      </div>
    </div>
  );
}
