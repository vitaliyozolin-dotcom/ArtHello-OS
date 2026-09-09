import { formatRubles } from "@workspace/shared/money";
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetCoverageEnvironment,
  useGetCoverageRegistry,
  useGetCoverageBatches,
  useGetCoverageSummary,
  useGetCoverageFieldInventory,
  useGetCoverageIssues,
  useGetCoverageRawRecords,
  useRunCoverageDiscover,
  useRunCoverageSync,
  useRunCoverageVerify,
  useGetCoverageVerificationReport,
  useGetCoverageScope,
  useSetCoverageScope,
  useGetCoverageBranches,
  useGetCoverageAtlasSummary,
  useGetCoverageNormalizationAudit,
  useGetCoverageEntityReconciliation,
  useGetCoverageDuplicates,
  useGetCoverageAttendanceStudentIdentity,
  useGetCoverageCustomerRawBranchCoverage,
  usePostCoverageResolveGhostCustomers,
  useRunDuplicateDetection,
  useGetCoveragePaymentTruthAudit,
  useGetCoveragePaymentCleanupAudit,
  useGetCoverageFinalAlphaAuditReport,
  useGetCoverageBankAccountsAudit,
  getGetCoverageBankAccountsAuditQueryKey,
  useGetCoverageBankTransactionsAudit,
  getGetCoverageBankTransactionsAuditQueryKey,
  useGetCoverageCounterpartiesAudit,
  getGetCoverageCounterpartiesAuditQueryKey,
  useGetCoverageCounterpartyReclassificationAudit,
  getGetCoverageCounterpartyReclassificationAuditQueryKey,
  useGetCoverageBankAlphaReconciliationAudit,
  getGetCoverageBankAlphaReconciliationAuditQueryKey,
  useSaveEvotorPublisherToken,
  useGetEvotorStatus,
  getGetEvotorStatusQueryKey,
  useDiscoverEvotor,
  useGetCoverageEvotorCoverageAudit,
  getGetCoverageEvotorCoverageAuditQueryKey,
  type EvotorCoverageAuditResponse,
  getGetCoverageFinalAlphaAuditReportQueryKey,
  getGetCoverageRegistryQueryKey,
  getGetCoverageBatchesQueryKey,
  getGetCoverageSummaryQueryKey,
  getGetCoverageEnvironmentQueryKey,
  getGetCoverageVerificationReportQueryKey,
  getGetCoverageScopeQueryKey,
  getGetCoverageBranchesQueryKey,
  getGetCoverageAtlasSummaryQueryKey,
  getGetCoverageNormalizationAuditQueryKey,
  getGetCoverageEntityReconciliationQueryKey,
  getGetCoverageAttendanceStudentIdentityQueryKey,
  getGetCoverageCustomerRawBranchCoverageQueryKey,
  getGetCoverageDuplicatesQueryKey,
  getGetCoveragePaymentTruthAuditQueryKey,
  getGetCoveragePaymentCleanupAuditQueryKey,
  type CoverageEndpointEntry,
  type AlphaSyncBatch,
  type CoverageSummaryEntityRow,
  type AlphaLinkingIssue,
  type AlphaRawRecord,
  type AlphaBranchDetail,
} from '@workspace/api-client-react';
import {
  AlertTriangle, RefreshCw, Loader2, CheckCircle2, XCircle,
  AlertCircle, Database, Clock, ChevronDown, ChevronRight,
  Play, Zap, Search, FileText, Copy, CopyCheck,
  Activity, List, Eye, BarChart3, Bug, HardDrive,
  Shield, TrendingDown, ShieldAlert, ShieldCheck, FlaskConical,
  Target, GitBranch, MapPin, Lock, Unlock, Info, ClipboardList, Users,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTs(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function useRetiredLegacyAction() {
  return {
    data: undefined,
    isPending: false,
    mutate: (..._args: unknown[]) => toast.error('Legacy-действие удалено. Используйте утверждённый sandbox или scoped workflow.'),
  };
}

function fmtDur(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

const STATUS_COLORS: Record<string, string> = {
  OK:          'bg-emerald-100 text-emerald-800 border-emerald-300',
  EMPTY:       'bg-yellow-100 text-yellow-800 border-yellow-200',
  PARTIAL:     'bg-amber-100 text-amber-800 border-amber-300',
  NOT_FOUND:   'bg-gray-100 text-gray-600 border-gray-300',
  FORBIDDEN:   'bg-red-100 text-red-700 border-red-300',
  NOT_EXPOSED: 'bg-gray-100 text-gray-500 border-gray-200',
  ERROR:       'bg-red-100 text-red-700 border-red-300',
  EMBEDDED:    'bg-blue-100 text-blue-700 border-blue-200',
  UNKNOWN:     'bg-gray-100 text-gray-500 border-gray-200',
};

const BATCH_STATUS_COLORS: Record<string, string> = {
  running:   'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed:    'bg-red-100 text-red-700',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border font-mono ${cls}`}>
      {status}
    </span>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.FC<{ className?: string }>; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-violet-600 shrink-0" />
      <div>
        <h3 className="text-[14px] font-bold text-gray-900">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-400">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Warning Banner ───────────────────────────────────────────────────────────

function WarningBanner() {
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-[12px] p-3 flex gap-2.5">
      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-[12px] font-bold text-amber-800">Техническое предупреждение</p>
        <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
          Банковская интеграция уже содержит счета, балансы, выписки и транзакции, но большинство транзакций
          ещё <strong>не сопоставлены, не классифицированы и не сверены</strong> с данными AlphaCRM.
          Результаты AlphaCRM Coverage — это данные источника (source coverage), а не окончательная финансовая истина.
          Финальная сверка требует отдельного слоя сопоставления банк ↔ AlphaCRM.
        </p>
      </div>
    </div>
  );
}

// ─── Non-Production Red Warning ───────────────────────────────────────────────

function NonProdBanner({ isProduction }: { isProduction: boolean }) {
  if (isProduction) return null;
  return (
    <div className="bg-red-50 border-2 border-red-400 rounded-[12px] p-3 flex gap-2.5">
      <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-[13px] font-bold text-red-800">⚠ Аудит запущен НЕ в production</p>
        <p className="text-[11px] text-red-700 mt-0.5 leading-relaxed">
          NODE_ENV ≠ production. Данные AlphaCRM реальные (продакшн API), но база данных —
          <strong> development БД</strong>. Результаты верификации отражают реальный AlphaCRM,
          но не production БД этого приложения.
        </p>
      </div>
    </div>
  );
}

// ─── Environment Panel ────────────────────────────────────────────────────────

function EnvironmentPanel() {
  const { data, isLoading } = useGetCoverageEnvironment();

  if (isLoading) return <div className="h-16 bg-gray-100 rounded-[12px] animate-pulse" />;
  if (!data) return null;

  const counts = data.tableCounts as Record<string, string | number> ?? {};
  const isProduction = data.isProduction as boolean ?? false;

  return (
    <div className="space-y-2">
      <NonProdBanner isProduction={isProduction} />
      <div className="bg-gray-950 text-gray-300 rounded-[12px] p-3 font-mono text-[11px]">
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-gray-400 font-semibold uppercase tracking-wide text-[9px]">
            Database / Environment
          </span>
          <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold ${isProduction ? 'bg-red-900 text-red-300' : 'bg-amber-900 text-amber-300'}`}>
            {isProduction ? '⚠ PRODUCTION' : '⚠ DEVELOPMENT (non-prod DB)'}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-[10px]">
          <span><span className="text-gray-500">env:</span> {String(data.environment ?? '—')}</span>
          <span><span className="text-gray-500">db:</span> {String(data.database ?? '—')}</span>
          <span><span className="text-gray-500">crm:</span> {String(data.alfacrmDomain ?? '—')}</span>
          {Object.entries(counts).map(([k, v]) => (
            <span key={k}><span className="text-gray-500">{k}:</span> {String(v)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Endpoint Registry Table ──────────────────────────────────────────────────

function RegistryTable({ branchId }: { branchId: string }) {
  const { data, isLoading } = useGetCoverageRegistry({ branchId });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const registry = (data?.registry ?? []) as CoverageEndpointEntry[];

  const okCount     = registry.filter(r => r.status === 'OK').length;
  const emptyCount  = registry.filter(r => r.status === 'EMPTY').length;
  const errCount    = registry.filter(r => ['ERROR','FORBIDDEN','NOT_FOUND','NOT_EXPOSED'].includes(r.status ?? '')).length;
  const unknownCount = registry.filter(r => r.status === 'UNKNOWN').length;

  if (isLoading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (registry.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-[13px]">
        Нет данных — запустите <strong>Run Discovery</strong>
      </div>
    );
  }

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id); setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div>
      {/* Stats row */}
      <div className="flex gap-3 mb-3 flex-wrap text-[11px]">
        <span className="text-emerald-600 font-semibold">✓ OK: {okCount}</span>
        <span className="text-yellow-600 font-semibold">◌ EMPTY: {emptyCount}</span>
        <span className="text-red-600 font-semibold">✕ ERROR/NOT_FOUND: {errCount}</span>
        <span className="text-gray-400">? UNKNOWN: {unknownCount}</span>
        <span className="text-gray-400 ml-auto">Total: {registry.length}</span>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Entity</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Endpoint</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">HTTP</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Records</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Last checked</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Next action</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {registry.map((row) => {
                const isExpanded = expandedId === row.id;
                return (
                  <React.Fragment key={row.id ?? row.entity_key}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50/60 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : (row.id ?? null))}>
                      <td className="px-3 py-2 font-mono text-[10px] text-violet-700 whitespace-nowrap">{row.entity_key ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap max-w-[160px] truncate">{row.endpoint ?? '—'}</td>
                      <td className="px-3 py-2"><StatusBadge status={row.status ?? 'UNKNOWN'} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                        {row.http_status ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {row.records_fetched !== null && row.records_fetched !== undefined ? row.records_fetched.toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{fmtTs(row.last_checked_at)}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px]">
                        <span className="line-clamp-1">{row.next_action ?? '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-950 text-gray-300">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="font-mono text-[10px] space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">endpoint:</span>
                              <span className="text-green-400">{row.endpoint}</span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); copyText(row.endpoint ?? '', (row.id ?? '') + '-ep'); }}
                                className="text-gray-500 hover:text-gray-300"
                              >
                                {copied === (row.id ?? '') + '-ep' ? <CopyCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                            {row.notes && (
                              <div><span className="text-gray-500">notes:</span>{' '}{String(row.notes)}</div>
                            )}
                            {row.error_message && (
                              <div><span className="text-red-400">error:</span>{' '}<span className="text-red-300">{String(row.error_message)}</span></div>
                            )}
                            {!!row.discovered_fields && (
                              <div>
                                <span className="text-gray-500">fields discovered:</span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {(row.discovered_fields as string[]).map((f) => (
                                    <span key={f} className="px-1 py-0.5 bg-gray-800 text-gray-300 rounded text-[9px]">{f}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {!!row.response_sample && (
                              <div>
                                <span className="text-gray-500">sample:</span>
                                <pre className="mt-1 text-[9px] text-gray-400 overflow-x-auto max-h-32">
                                  {JSON.stringify(row.response_sample, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Coverage Summary Table ───────────────────────────────────────────────────

function SummaryTable() {
  const { data, isLoading } = useGetCoverageSummary();

  if (isLoading) return <div className="h-32 bg-gray-100 rounded-[12px] animate-pulse" />;
  if (!data) return null;

  const byEntity = (data.byEntity ?? []) as CoverageSummaryEntityRow[];
  const regCounts = data.registryStatusCounts as { status: string; cnt: string }[] ?? [];
  const issueCounts = data.openIssueCounts as { severity: string; cnt: string }[] ?? [];
  const lastBatch = data.lastBatch as AlphaSyncBatch | null;

  return (
    <div className="space-y-3">
      {/* Registry status pills */}
      <div className="flex gap-2 flex-wrap">
        {regCounts.map(({ status, cnt }) => (
          <span key={status} className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {status}: {cnt}
          </span>
        ))}
        {issueCounts.map(({ severity, cnt }) => (
          <span key={severity} className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${severity === 'critical' ? 'bg-red-100 text-red-700 border-red-200' : severity === 'warning' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
            {severity} issues: {cnt}
          </span>
        ))}
      </div>

      {/* Last batch */}
      {lastBatch && (
        <div className="text-[11px] text-gray-500 font-mono bg-gray-50 rounded px-2 py-1">
          Last batch: <span className={`font-bold ${BATCH_STATUS_COLORS[lastBatch.status ?? ''] ?? ''} px-1 rounded`}>{(lastBatch.status ?? '').toUpperCase()}</span>
          {' '}mode={lastBatch.mode}
          {' '}fetched={lastBatch.total_fetched ?? 0}
          {' '}saved={lastBatch.total_saved ?? 0}
          {' '}errors={lastBatch.total_errors ?? 0}
          {' '}dur={fmtDur(lastBatch.duration_ms)}
          {' '}at={fmtTs(lastBatch.started_at)}
        </div>
      )}

      {/* By entity table */}
      {byEntity.length > 0 && (
        <div className="border border-gray-200 rounded-[10px] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Entity</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Raw saved</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Normalized</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Missing ID</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Branches</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {byEntity.map((row) => {
                const total = Number(row.total_raw);
                const norm  = Number(row.normalized);
                const pct   = total > 0 ? Math.round((norm / total) * 100) : 0;
                return (
                  <tr key={row.entity_type} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-[10px] text-violet-700">{row.entity_type}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{Number(row.total_raw).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`tabular-nums font-semibold ${pct === 100 ? 'text-emerald-600' : pct > 50 ? 'text-amber-600' : 'text-gray-500'}`}>
                        {norm > 0 ? `${norm} (${pct}%)` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{Number(row.missing_id) > 0 ? Number(row.missing_id) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{row.branches}</td>
                    <td className="px-3 py-2 text-gray-400">{fmtTs(row.last_synced)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {byEntity.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-[13px]">
          Нет данных в alpha_raw_records — запустите <strong>Run Raw Sync</strong>
        </div>
      )}
    </div>
  );
}

// ─── Batch History ────────────────────────────────────────────────────────────

function BatchHistory() {
  const { data, isLoading } = useGetCoverageBatches({ limit: 15 });
  const batches = (data?.batches ?? []) as AlphaSyncBatch[];

  if (isLoading) return <div className="h-24 bg-gray-100 rounded-[12px] animate-pulse" />;

  if (batches.length === 0) {
    return <div className="text-center py-6 text-gray-400 text-[12px]">Нет истории</div>;
  }

  return (
    <div className="border border-gray-200 rounded-[10px] overflow-hidden">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Mode</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Branch</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600">Checked</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600">Fetched</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600">Saved</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600">Errors</th>
            <th className="text-right px-3 py-2 font-semibold text-gray-600">Duration</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Started</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="border-b border-gray-100 last:border-0 font-mono">
              <td className="px-3 py-1.5 text-[10px] text-violet-600 font-semibold">{b.mode}</td>
              <td className="px-3 py-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${BATCH_STATUS_COLORS[b.status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                  {b.status}
                </span>
              </td>
              <td className="px-3 py-1.5 text-gray-400">{b.branch_id ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{b.endpoints_checked ?? b.entities_requested ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{b.total_fetched ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600 font-semibold">{b.total_saved ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-red-500">{b.total_errors ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">{fmtDur(b.duration_ms)}</td>
              <td className="px-3 py-1.5 text-gray-400">{fmtTs(b.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Field Inventory ──────────────────────────────────────────────────────────

function FieldInventory({ entityType }: { entityType: string }) {
  const { data, isLoading } = useGetCoverageFieldInventory(entityType ? { entityType } : {});
  const inventory = data?.fieldInventory as Record<string, { fieldName: string; appearedInRecordsCount: number; emptyCount: number; sampleValues: unknown[] }[]> ?? {};

  if (isLoading) return <div className="h-32 bg-gray-100 rounded animate-pulse" />;

  const entities = Object.keys(inventory);
  if (entities.length === 0) {
    return <div className="text-center py-6 text-gray-400 text-[12px]">Нет данных — сначала запустите Raw Sync</div>;
  }

  const target = entityType && inventory[entityType] ? entityType : entities[0];
  const fields = inventory[target] ?? [];

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500 font-mono">
        entity: <strong className="text-violet-600">{target}</strong> · {fields.length} fields · {data?.totalRecordsAnalyzed} records analyzed
      </p>
      <div className="border border-gray-200 rounded-[10px] overflow-hidden max-h-[320px] overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b border-gray-200">
              <th className="text-left px-3 py-2 font-semibold text-gray-600">Field</th>
              <th className="text-right px-3 py-2 font-semibold text-gray-600">Present in</th>
              <th className="text-right px-3 py-2 font-semibold text-gray-600">Empty</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600">Sample values</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.fieldName} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                <td className="px-3 py-1.5 font-mono text-[10px] text-blue-700">{f.fieldName}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{f.appearedInRecordsCount}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">{f.emptyCount > 0 ? f.emptyCount : '—'}</td>
                <td className="px-3 py-1.5 text-gray-500 max-w-[260px] truncate font-mono text-[9px]">
                  {f.sampleValues.map((v) => JSON.stringify(v)).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Issues Panel ─────────────────────────────────────────────────────────────

function IssuesPanel() {
  const { data, isLoading } = useGetCoverageIssues({ limit: 50 });
  const issues = (data?.issues ?? []) as AlphaLinkingIssue[];

  if (isLoading) return <div className="h-20 bg-gray-100 rounded animate-pulse" />;
  if (issues.length === 0) {
    return <div className="text-center py-6 text-gray-400 text-[12px]">Нет открытых проблем</div>;
  }

  return (
    <div className="border border-gray-200 rounded-[10px] overflow-hidden max-h-[280px] overflow-y-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-gray-50">
          <tr className="border-b border-gray-200">
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Entity</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Alpha ID</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Issue type</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Severity</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Message</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-600">Action</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
              <td className="px-3 py-1.5 font-mono text-[10px] text-violet-600">{issue.entity_type ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-[10px] text-gray-500">{issue.alpha_id ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-[10px] text-red-600">{issue.issue_type ?? '—'}</td>
              <td className="px-3 py-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${issue.severity === 'critical' ? 'bg-red-100 text-red-700' : issue.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  {issue.severity ?? 'info'}
                </span>
              </td>
              <td className="px-3 py-1.5 text-gray-500 max-w-[200px] truncate">{issue.issue_message ?? '—'}</td>
              <td className="px-3 py-1.5 text-gray-400 max-w-[160px] truncate text-[10px]">{issue.suggested_action ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Raw Records Browser ──────────────────────────────────────────────────────

function RawRecordsBrowser() {
  const [entityFilter, setEntityFilter] = useState('');
  const [applied, setApplied] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useGetCoverageRawRecords(applied ? { entityType: applied, limit: 30 } : { limit: 30 });
  const records = (data?.records ?? []) as AlphaRawRecord[];

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="h-7 px-2.5 rounded-xl border border-gray-200 text-[12px] flex-1 focus:outline-none focus:border-violet-400"
          placeholder="Entity type (e.g. students, payments, lessons)"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setApplied(entityFilter)}
        />
        <button
          type="button"
          onClick={() => setApplied(entityFilter)}
          className="h-7 px-3 bg-gray-800 text-white text-[11px] font-semibold rounded-xl hover:bg-gray-700"
        >
          <Search className="w-3 h-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
      ) : records.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-[12px]">Нет записей</div>
      ) : (
        <div className="border border-gray-200 rounded-[10px] overflow-hidden max-h-[340px] overflow-y-auto">
          {records.map((r) => (
            <div key={r.id ?? r.entity_type} className="border-b border-gray-100 last:border-0">
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 font-mono text-[10px]"
                onClick={() => setExpanded(expanded === (r.id ?? '') ? null : (r.id ?? ''))}
              >
                <span className="text-violet-600 font-semibold">{r.entity_type}</span>
                <span className="text-gray-400">id={r.alpha_id ?? '?'}</span>
                <span className="text-gray-300">branch={r.branch_id ?? '?'}</span>
                <span className="text-gray-300">p{r.page ?? 0}</span>
                <span className="text-gray-400 ml-auto">{fmtTs(r.synced_at)}</span>
                {expanded === r.id ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
              </div>
              {expanded === r.id && (
                <div className="bg-gray-950 px-3 py-2">
                  <pre className="text-[9px] text-gray-300 overflow-x-auto max-h-[200px] font-mono">
                    {JSON.stringify(r.source_payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Verification Report ──────────────────────────────────────────────────────

function SuspiciousFlag({ flag }: { flag: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-red-100 last:border-0">
      <TrendingDown className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
      <span className="text-[11px] text-red-700 font-mono">{flag}</span>
    </div>
  );
}

function MetricRow({ label, value, suspicious }: { label: string; value: unknown; suspicious?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1 border-b border-gray-100 last:border-0">
      <span className="text-[11px] text-gray-500 font-mono">{label}</span>
      <span className={`text-[11px] font-semibold font-mono ${suspicious ? 'text-red-600' : 'text-gray-800'}`}>
        {value === null || value === undefined ? '—' : String(value)}
      </span>
    </div>
  );
}

function BranchAuditCard({ branchId, audit }: { branchId: string; audit: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState<string | null>('students');

  const sections: { key: string; label: string; data: Record<string, unknown> }[] = [
    { key: 'students',      label: 'Студенты / Клиенты',      data: (audit.students as Record<string, unknown>) ?? {} },
    { key: 'lessons',       label: 'Занятия',                 data: (audit.lessons as Record<string, unknown>) ?? {} },
    { key: 'payments',      label: 'Платежи',                 data: (audit.payments as Record<string, unknown>) ?? {} },
    { key: 'subjects',      label: 'Предметы / Направления',  data: (audit.subjects as Record<string, unknown>) ?? {} },
    { key: 'groups',        label: 'Группы',                  data: (audit.groups as Record<string, unknown>) ?? {} },
    { key: 'subscriptions', label: 'Абонементы',              data: (audit.subscriptions as Record<string, unknown>) ?? {} },
  ];

  return (
    <div className="border border-gray-200 rounded-[12px] overflow-hidden">
      <div className="bg-gray-50 px-4 py-2.5 flex items-center gap-2 border-b border-gray-200">
        <Database className="w-4 h-4 text-violet-600" />
        <span className="text-[13px] font-bold text-gray-900">Branch {branchId}</span>
        <span className="text-[11px] text-gray-400 ml-1">{String(audit.branchName ?? '')}</span>
      </div>
      <div className="divide-y divide-gray-100">
        {sections.map(({ key, label, data }) => {
          const isOpen = expanded === key;
          const isSuspicious = !!(data.suspiciousLowVolume);
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : key)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${isSuspicious ? 'bg-red-50' : ''}`}
              >
                {isSuspicious
                  ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  : <CheckCircle2 className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
                <span className={`text-[12px] font-semibold flex-1 ${isSuspicious ? 'text-red-700' : 'text-gray-700'}`}>{label}</span>
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {isOpen && (
                <div className="px-4 pb-3 bg-gray-50/50">
                  {Object.entries(data)
                    .filter(([k]) => !['suspiciousLowVolume', 'discoveredFields', 'subjectIds', 'subjectNames', 'customerTariffs', 'tariffMovements', 'statusBreakdown'].includes(k))
                    .map(([k, v]) => (
                      <MetricRow
                        key={k}
                        label={k}
                        value={typeof v === 'object' ? JSON.stringify(v) : v}
                        suspicious={k.toLowerCase().includes('suspicious') && !!v}
                      />
                    ))}
                  {/* Status breakdown for lessons */}
                  {key === 'lessons' && !!(data.statusBreakdown) && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold text-gray-500 mb-1">Status breakdown:</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(data.statusBreakdown as Record<string, number>).map(([s, cnt]) => (
                          <span key={s} className="px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded text-[9px] font-mono">{s}: {cnt}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Subscription sub-sections */}
                  {key === 'subscriptions' && (
                    <div className="space-y-2 mt-1">
                      {(['customerTariffs', 'tariffMovements'] as const).map((sub) => {
                        const subData = data[sub] as Record<string, unknown> | undefined;
                        if (!subData) return null;
                        return (
                          <div key={sub} className="border border-gray-200 rounded-[8px] p-2">
                            <p className="text-[10px] font-bold text-gray-600 mb-1 font-mono">{sub}</p>
                            {Object.entries(subData)
                              .filter(([k]) => !['discoveredFields'].includes(k))
                              .map(([k, v]) => (
                                <MetricRow key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : v} />
                              ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Subject names */}
                  {key === 'subjects' && !!(data.subjectNames) && Object.keys(data.subjectNames as object).length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold text-gray-500 mb-1">Subjects found:</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(data.subjectNames as Record<string, string>).map(([id, name]) => (
                          <span key={id} className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-[9px] font-mono">{id}: {name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerificationReport({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGetCoverageVerificationReport();
  const verifyMut = useRunCoverageVerify();

  const reportData = data?.report as Record<string, unknown> | null | undefined;
  const reportStatus = data?.status ?? 'not_run';

  const handleVerify = () => {
    verifyMut.mutate(
      { data: { fromDate, toDate } },
      {
        onSuccess: (d) => {
          toast.success(`Верификация запущена (${d.reportId?.slice(0, 8)}…) — займёт 1–2 минуты`);
          setTimeout(() => qc.invalidateQueries({ queryKey: getGetCoverageVerificationReportQueryKey() }), 15000);
          setTimeout(() => qc.invalidateQueries({ queryKey: getGetCoverageVerificationReportQueryKey() }), 60000);
          setTimeout(() => qc.invalidateQueries({ queryKey: getGetCoverageVerificationReportQueryKey() }), 120000);
        },
        onError: () => toast.error('Ошибка запуска верификации'),
      },
    );
  };

  const overallStatus = (reportData?.overallStatus as string) ?? 'unknown';
  const suspiciousFlags = (reportData?.suspiciousFlags as string[]) ?? [];
  const nextActions = (reportData?.nextActions as string[]) ?? [];
  const branchAudits = (reportData?.branchAudits as Record<string, Record<string, unknown>>) ?? {};
  const branchCoverage = reportData?.branchCoverage as Record<string, unknown> | undefined;
  const env = reportData?.environment as Record<string, unknown> | undefined;

  const overallColor = overallStatus === 'clean' ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : overallStatus === 'warning' ? 'text-amber-700 bg-amber-50 border-amber-200'
    : overallStatus === 'suspicious' ? 'text-red-700 bg-red-50 border-red-200'
    : 'text-gray-500 bg-gray-50 border-gray-200';

  return (
    <div className="space-y-4">
      {/* Run control */}
      <div className="flex items-center gap-3 p-3 bg-violet-50 rounded-[12px] border border-violet-200">
        <FlaskConical className="w-4 h-4 text-violet-600 shrink-0" />
        <div className="flex-1">
          <p className="text-[12px] font-bold text-violet-900">Deep Verification Audit</p>
          <p className="text-[11px] text-violet-600">
            Проверяет AlphaCRM live: ветки, студентов, занятия, платежи, предметы, абонементы.
            Выявляет подозрительные объёмы и незаполненные поля. Занимает 1–2 минуты.
          </p>
        </div>
        <button
          type="button"
          disabled={verifyMut.isPending || reportStatus === 'running'}
          onClick={handleVerify}
          className="flex items-center gap-1.5 h-8 px-4 bg-violet-600 text-white text-[12px] font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {(verifyMut.isPending || reportStatus === 'running')
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Запуск…</>
            : <><Shield className="w-3.5 h-3.5" /> Run Verify</>}
        </button>
      </div>

      {/* No report yet */}
      {reportStatus === 'not_run' && (
        <div className="text-center py-10 text-gray-400 text-[13px]">
          Нет данных верификации — нажмите <strong>Run Verify</strong>
        </div>
      )}

      {/* Running */}
      {reportStatus === 'running' && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-[12px] border border-blue-200">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <div>
            <p className="text-[13px] font-bold text-blue-800">Верификация выполняется…</p>
            <p className="text-[11px] text-blue-600">Опрашиваем AlphaCRM endpoints. Обновится автоматически через ~60 секунд.</p>
          </div>
        </div>
      )}

      {/* Report loaded */}
      {reportData && reportStatus !== 'running' && (
        <>
          {/* Overall status */}
          <div className={`flex items-center gap-3 p-3 rounded-[12px] border ${overallColor}`}>
            {overallStatus === 'clean'
              ? <ShieldCheck className="w-5 h-5 shrink-0" />
              : <ShieldAlert className="w-5 h-5 shrink-0" />}
            <div>
              <p className="text-[13px] font-bold">
                Статус: {overallStatus.toUpperCase()}
                {suspiciousFlags.length > 0 && ` — ${suspiciousFlags.length} suspicious flags`}
              </p>
              <p className="text-[11px]">
                Аудит: {String(reportData.requestedFromDate ?? '?')} → {String(reportData.requestedToDate ?? '?')} ·
                Сгенерирован: {fmtTs(reportData.generatedAt as string)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: getGetCoverageVerificationReportQueryKey() })}
              className="ml-auto text-current opacity-60 hover:opacity-100"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Environment info */}
          {env && (
            <div className="bg-gray-950 text-gray-300 rounded-[12px] p-3 font-mono text-[10px]">
              <p className="text-gray-500 text-[9px] uppercase tracking-wide mb-1.5">Verified Environment</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <span><span className="text-gray-500">nodeEnv:</span> {String(env.nodeEnv ?? '—')}</span>
                <span><span className="text-gray-500">isProduction:</span> <span className={env.isProduction ? 'text-red-400' : 'text-amber-400'}>{String(env.isProduction)}</span></span>
                <span><span className="text-gray-500">domain:</span> {String(env.alfacrmDomain ?? '—')}</span>
                <span><span className="text-gray-500">creds:</span> {String(env.credentialsSource ?? '—')}</span>
              </div>
              {!!env.warningNotProduction && (
                <p className="mt-2 text-amber-400 text-[10px]">{String(env.warningNotProduction)}</p>
              )}
            </div>
          )}

          {/* Branch coverage */}
          {branchCoverage && (
            <div className="bg-blue-50 rounded-[12px] border border-blue-200 p-3">
              <p className="text-[12px] font-bold text-blue-900 mb-1">
                Branch Coverage — {String(branchCoverage.branchesDetected ?? '?')} ветка(и) обнаружено,{' '}
                {String(branchCoverage.branchesAudited ?? '?')} проверено
              </p>
              <p className="text-[11px] text-blue-700">{String(branchCoverage.multibranchNote ?? '')}</p>
              {Array.isArray(branchCoverage.branches) && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {(branchCoverage.branches as { id: string; name: string }[]).map((b) => (
                    <span key={b.id} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg text-[10px] font-mono border border-blue-200">
                      [{b.id}] {b.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Suspicious flags */}
          {suspiciousFlags.length > 0 && (
            <div className="border border-red-200 rounded-[12px] overflow-hidden">
              <div className="bg-red-50 px-4 py-2 border-b border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-[12px] font-bold text-red-800">{suspiciousFlags.length} Suspicious Flags</span>
              </div>
              <div className="px-4 py-2">
                {suspiciousFlags.map((f, i) => <SuspiciousFlag key={i} flag={f} />)}
              </div>
            </div>
          )}

          {/* Per-branch audits */}
          {Object.entries(branchAudits).map(([bid, audit]) => (
            <BranchAuditCard key={bid} branchId={bid} audit={audit} />
          ))}

          {/* Next actions */}
          {nextActions.length > 0 && (
            <div className="border border-gray-200 rounded-[12px] p-4 bg-gray-50">
              <p className="text-[12px] font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-gray-500" /> Рекомендуемые следующие шаги
              </p>
              <ul className="space-y-1.5">
                {nextActions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-gray-600">
                    <span className="text-violet-500 font-bold shrink-0">{i + 1}.</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Failed */}
      {reportStatus === 'failed' && !reportData && (
        <div className="p-3 bg-red-50 rounded-[12px] border border-red-200 text-[12px] text-red-700">
          Верификация завершилась с ошибкой. Проверьте лог сервера и повторите.
        </div>
      )}
    </div>
  );
}

// ─── ScopePanel ───────────────────────────────────────────────────────────────

const RECOMMENDED_USE_COLORS: Record<string, string> = {
  CURRENT_SCOPE:           'bg-emerald-100 text-emerald-800 border-emerald-300',
  EXCLUDE_NOW:             'bg-gray-100 text-gray-600 border-gray-300',
  ARCHIVE_ONLY:            'bg-yellow-100 text-yellow-700 border-yellow-300',
  UNKNOWN_REVIEW_REQUIRED: 'bg-amber-100 text-amber-800 border-amber-300',
};

function BranchRow({ branch }: { branch: AlphaBranchDetail }) {
  const cls = RECOMMENDED_USE_COLORS[branch.recommendedUse ?? 'EXCLUDE_NOW'] ?? RECOMMENDED_USE_COLORS.EXCLUDE_NOW;
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[12px] ${branch.isActiveScope ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-150'}`}>
      <span className="text-[14px]">{branch.isActiveScope ? '🎯' : '🚫'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-gray-800">{branch.branchName}</span>
          <span className="text-gray-400 text-[10px]">id={branch.branchId}</span>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${cls}`}>
            {branch.recommendedUse}
          </span>
          {!!branch.notYetSynced && (
            <span className="text-[9px] text-gray-400 italic">not synced yet</span>
          )}
        </div>
        <div className="text-gray-500 text-[10px] mt-0.5">{branch.suspectedMeaning}</div>
        {branch.rawCounts && !branch.notYetSynced && (
          <div className="flex gap-3 mt-1 text-[10px] text-gray-500">
            <span>👥 {String(branch.rawCounts.students ?? 0)}</span>
            <span>📚 {String(branch.rawCounts.lessons ?? 0)}</span>
            <span>💳 {String(branch.rawCounts.payments ?? 0)}</span>
            <span className="text-gray-400">total: {String(branch.rawCounts.total ?? 0)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ScopePanel() {
  const scopeQ     = useGetCoverageScope();
  const branchesQ  = useGetCoverageBranches();
  const setScopeMut = useSetCoverageScope();
  const qc = useQueryClient();

  const scope     = scopeQ.data?.scope as Record<string, unknown> | null | undefined;
  const branches  = branchesQ.data?.branches ?? [];
  const excluded  = branchesQ.data?.excludedBranches ?? [];
  const atlasId   = branchesQ.data?.atlasIdentification as Record<string, unknown> | null | undefined;

  const handleSetAtlas = () => {
    setScopeMut.mutate(
      { data: { branchId: '6', branchName: 'Атлас', scopeName: 'Atlas only', reason: 'Main physical ArtHello location — P6.2 scope lock' } },
      {
        onSuccess: () => {
          toast.success('Scope set to Atlas (branchId=6)');
          qc.invalidateQueries({ queryKey: getGetCoverageScopeQueryKey() });
          qc.invalidateQueries({ queryKey: getGetCoverageBranchesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetCoverageAtlasSummaryQueryKey() });
        },
        onError: () => toast.error('Failed to set scope'),
      },
    );
  };

  if (scopeQ.isLoading || branchesQ.isLoading) {
    return <div className="flex items-center gap-2 text-gray-400 text-[12px]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загрузка scope...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Atlas scope lock banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-[14px] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-emerald-800">
                Текущий scope: <span className="font-black">{String(scope?.branch_name ?? scope?.branchName ?? 'Атлас')}</span>
                <span className="ml-1.5 text-[11px] font-normal text-emerald-600">(branchId={String(scope?.branch_id ?? scope?.branchId ?? '6')})</span>
              </p>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                {String(scope?.scope_name ?? scope?.scopeName ?? 'Atlas only')} — только этот branch участвует в raw sync и нормализации
              </p>
              {!!(scope?.reason ?? scope?.notes) && (
                <p className="text-[10px] text-emerald-600 mt-1 italic">{String(scope?.reason ?? scope?.notes ?? '')}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSetAtlas}
            disabled={setScopeMut.isPending}
            className="shrink-0 flex items-center gap-1 h-7 px-2.5 bg-emerald-600 text-white text-[11px] font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {setScopeMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
            Lock to Atlas
          </button>
        </div>
      </div>

      {/* Atlas identification */}
      {atlasId && (
        <div className="bg-blue-50 border border-blue-200 rounded-[14px] p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Target className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-[12px] font-bold text-blue-800">Atlas Branch Identification</span>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${
              atlasId.confidence === 'high' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-yellow-100 text-yellow-800 border-yellow-300'
            }`}>
              confidence: {String(atlasId.confidence ?? '?')}
            </span>
          </div>
          <p className="text-[11px] text-blue-700">
            <strong>branchId={String(atlasId.atlasBranchId ?? '?')}</strong> · {String(atlasId.atlasBranchName ?? '?')}
          </p>
          <p className="text-[10px] text-blue-600 mt-0.5">{String(atlasId.reason ?? '')}</p>
        </div>
      )}

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-[14px] p-3 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-[12px] font-semibold text-amber-800">Scope Lock: Atlas Only</p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            Current AlphaCRM audit scope is <strong>Atlas only</strong>. Other branches are discovered but excluded from current raw sync and normalization. All-branch sync is blocked.
          </p>
        </div>
      </div>

      {/* All branches */}
      <div>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
          Все обнаруженные ветки ({branches.length})
        </p>
        <div className="space-y-1.5">
          {branches.map((b) => <BranchRow key={b.branchId} branch={b} />)}
          {branches.length === 0 && (
            <p className="text-[12px] text-gray-400 italic">
              Ветки ещё не обнаружены. Запустите Верификацию сначала.
            </p>
          )}
        </div>
      </div>

      {/* Excluded summary */}
      {excluded.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-[14px] p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <XCircle className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-[11px] font-bold text-gray-600">Исключены из текущего scope ({excluded.length} веток)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {excluded.map((b) => (
              <span key={b.branchId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-200 text-gray-600 text-[10px] font-medium">
                <span>{b.branchName}</span>
                <span className="text-gray-400">#{b.branchId}</span>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5 italic">
            Эти ветки видны в Discovery, но не синхронизируются в основные таблицы (families, students, payments).
          </p>
        </div>
      )}
    </div>
  );
}

// ─── AtlasSummaryPanel ────────────────────────────────────────────────────────

function ReadinessBadge({ status }: { status: string }) {
  const cfg = {
    READY:     { cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'READY' },
    PARTIAL:   { cls: 'bg-yellow-100  text-yellow-800  border-yellow-300',  icon: <AlertCircle  className="w-3.5 h-3.5" />, label: 'PARTIAL' },
    NOT_READY: { cls: 'bg-red-100     text-red-700     border-red-300',     icon: <XCircle      className="w-3.5 h-3.5" />, label: 'NOT READY' },
  }[status] ?? { cls: 'bg-gray-100 text-gray-600 border-gray-300', icon: <AlertCircle className="w-3.5 h-3.5" />, label: status };
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[12px] font-bold border ${cfg.cls}`}>
      {cfg.icon} Big Alpha Audit: {cfg.label}
    </div>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-[10px] p-2.5 border ${highlight && value > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-150'}`}>
      <p className="text-[10px] text-gray-500 leading-tight">{label}</p>
      <p className={`text-[19px] font-black mt-0.5 leading-tight ${value === 0 ? 'text-gray-300' : highlight ? 'text-emerald-700' : 'text-gray-800'}`}>{value}</p>
    </div>
  );
}

function BatchInfo({ batch, label }: { batch: Record<string, unknown> | null | undefined; label: string }) {
  if (!batch) return (
    <div className="bg-gray-50 border border-gray-200 rounded-[10px] p-2.5">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-[11px] text-gray-400 italic mt-0.5">Not run yet</p>
    </div>
  );
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-[10px] p-2.5">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        <span><span className="text-gray-400">status: </span>
          <span className={batch.status === 'completed' ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>{String(batch.status ?? '—')}</span>
        </span>
        <span><span className="text-gray-400">saved: </span>{String(batch.total_saved ?? '—')}</span>
        <span><span className="text-gray-400">fetched: </span>{String(batch.total_fetched ?? '—')}</span>
        <span><span className="text-gray-400">at: </span>{fmtTs(batch.finished_at as string)}</span>
      </div>
    </div>
  );
}

function AtlasSummaryPanel() {
  const q            = useGetCoverageAtlasSummary();
  const discoverMut  = useRunCoverageDiscover();
  const syncMut      = useRunCoverageSync();
  const qc           = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetCoverageAtlasSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageBatchesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageRegistryQueryKey() });
  };

  const runDiscover = () => {
    discoverMut.mutate(
      { data: { branchId: '6', fromDate: '2025-01-01', toDate: new Date().toISOString().slice(0, 10) } },
      {
        onSuccess: () => { toast.success('Atlas Discovery запущен — обновится через ~30 сек'); setTimeout(invalidate, 35000); },
        onError: () => toast.error('Ошибка запуска Discovery'),
      },
    );
  };

  const runSync = () => {
    syncMut.mutate(
      { data: { branchId: '6', fromDate: '2025-01-01', toDate: new Date().toISOString().slice(0, 10) } },
      {
        onSuccess: () => { toast.success('Atlas Raw Sync запущен — может занять несколько минут'); setTimeout(invalidate, 60000); setTimeout(invalidate, 180000); },
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(msg.slice(0, 80) || 'Ошибка запуска Raw Sync');
        },
      },
    );
  };

  const d = q.data;

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-gray-400 text-[12px]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Загрузка Atlas summary...</div>;
  }
  if (q.isError || !d) {
    return <div className="text-red-500 text-[12px]">Ошибка загрузки Atlas summary</div>;
  }

  const counts   = d.rawCounts              as Record<string, number>         | undefined;
  const lsnS     = d.lessonSummary          as Record<string, unknown>        | undefined;
  const payS     = d.paymentSummary         as Record<string, unknown>        | undefined;
  const subS     = d.subjectSummary         as Record<string, unknown>        | undefined;
  const ctS      = d.customerTariffSummary  as Record<string, unknown>        | undefined;
  const epStatus = d.endpointStatusSummary  as Record<string, number>         | undefined;
  const readiness = d.bigAlphaAuditReadiness as Record<string, unknown>       | undefined;
  const registry = (d.endpointRegistry      ?? []) as Record<string, unknown>[];
  const unresolved = (d.unresolvedEndpoints ?? []) as Record<string, unknown>[];
  const lastDisc = d.lastDiscoveryBatch as Record<string, unknown> | null | undefined;
  const lastSync = d.lastRawSyncBatch   as Record<string, unknown> | null | undefined;
  const readStatus = String(readiness?.status ?? 'NOT_READY');
  const blockers   = (readiness?.blockers  as string[]) ?? [];
  const notes      = (readiness?.notes     as string[]) ?? [];
  const checklist  = (readiness?.checklist as Record<string, boolean>) ?? {};

  const lsnByMonth = (lsnS?.byMonth  as { month: string; count: number }[]) ?? [];
  const payByMonth = (payS?.byMonth  as { month: string; count: number }[]) ?? [];

  const COUNT_ITEMS = [
    { label: '👥 Студенты',      key: 'students',        core: true  },
    { label: '🎓 Лиды',          key: 'leads',           core: false },
    { label: '📚 Занятия',       key: 'lessons',         core: true  },
    { label: '🪑 Посещения',     key: 'attendanceExtracted', core: true },
    { label: '💳 Платежи',       key: 'payments',        core: true  },
    { label: '👥 Группы',        key: 'groups',          core: true  },
    { label: '📖 Предметы',      key: 'subjects',        core: false },
    { label: '🧑‍🏫 Учителя',      key: 'teachers',        core: false },
    { label: '🎫 Абонементы',    key: 'customerTariffs', core: false },
    { label: '📋 Тарифы',        key: 'tariffs',         core: false },
    { label: '🎁 Скидки',        key: 'discounts',       core: false },
    { label: '✅ Задачи',         key: 'tasks',           core: false },
    { label: '💬 Комм.',         key: 'communications',  core: false },
  ];

  return (
    <div className="space-y-4">
      {/* Header: readiness + run buttons */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-bold text-gray-900">
            {String(d.atlasBranchName ?? 'Атлас')}
            <span className="ml-1.5 text-[11px] font-normal text-gray-500">branchId={String(d.atlasBranchId ?? '6')}</span>
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Scope: <span className={`font-semibold ${d.scopeStatus === 'ACTIVE' ? 'text-emerald-600' : 'text-red-500'}`}>{String(d.scopeStatus ?? '—')}</span>
            {d.scopeName ? <span className="ml-1 text-gray-400">({String(d.scopeName)})</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ReadinessBadge status={readStatus} />
          <button type="button" onClick={runDiscover} disabled={discoverMut.isPending}
            className="flex items-center gap-1.5 h-7 px-2.5 bg-blue-600 text-white text-[11px] font-semibold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
            {discoverMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Run Atlas Discovery
          </button>
          <button type="button" onClick={runSync} disabled={syncMut.isPending}
            className="flex items-center gap-1.5 h-7 px-2.5 bg-emerald-600 text-white text-[11px] font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50">
            {syncMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Run Atlas Raw Sync
          </button>
          <button type="button" onClick={() => q.refetch()}
            className="flex items-center gap-1 h-7 px-2 border border-gray-200 text-gray-500 text-[11px] rounded-lg hover:bg-gray-50">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      {/* DEV environment warning */}
      {!d.isProduction && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-[12px]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <p className="text-[11px] text-amber-800">
            <strong>Среда: {String(d.syncEnvironment ?? 'development')}</strong>
            {' '}· DB: <span className="font-mono">{String(d.dbName ?? '—')}</span>
            {' '}· Host: <span className="font-mono">{String(d.dbHostMasked ?? '—')}</span>
            {' '}· AlphaCRM: <span className="font-mono text-[10px]">{String(d.alphaCrmBaseUrl ?? '—')}</span>
          </p>
        </div>
      )}

      {/* Readiness: blockers + checklist */}
      {(blockers.length > 0 || notes.length > 0 || readStatus !== 'NOT_READY') && (
        <div className={`rounded-[12px] p-3 border ${
          readStatus === 'READY'     ? 'bg-emerald-50 border-emerald-200' :
          readStatus === 'PARTIAL'   ? 'bg-yellow-50 border-yellow-200' :
          'bg-red-50 border-red-200'
        }`}>
          <p className="text-[11px] font-bold mb-2 text-gray-700 uppercase tracking-wide">Big Alpha Audit Readiness Checklist</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mb-2">
            {Object.entries(checklist).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1 text-[10px]">
                {v ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" /> : <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                <span className={v ? 'text-gray-600' : 'text-red-600 font-semibold'}>{k}</span>
              </div>
            ))}
          </div>
          {blockers.length > 0 && (
            <div className="space-y-1 mt-2">
              {blockers.map((b, i) => (
                <div key={i} className="flex items-start gap-1 text-[11px] text-red-700">
                  <XCircle className="w-3 h-3 shrink-0 mt-0.5" /> {b}
                </div>
              ))}
            </div>
          )}
          {notes.length > 0 && (
            <div className="space-y-1 mt-2">
              {notes.map((n, i) => (
                <div key={i} className="flex items-start gap-1 text-[11px] text-amber-700">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" /> {n}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Raw counts grid */}
      <div>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Raw Records по типу (Atlas branchId=6)</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          {COUNT_ITEMS.map(({ label, key, core }) => (
            <MiniStat key={key} label={label} value={counts?.[key] ?? 0} highlight={core} />
          ))}
          <div className="bg-violet-50 border border-violet-200 rounded-[10px] p-2.5">
            <p className="text-[10px] text-violet-600 leading-tight">📦 Total</p>
            <p className="text-[19px] font-black text-violet-700 mt-0.5">{counts?.total ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Lessons summary */}
      <div className="bg-blue-50 border border-blue-100 rounded-[14px] p-3">
        <p className="text-[11px] font-bold text-blue-700 mb-2">📚 Lessons Analysis</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
          <span><span className="text-gray-400">count: </span><strong>{Number(lsnS?.count ?? 0)}</strong></span>
          <span><span className="text-gray-400">earliest: </span>{String(lsnS?.earliest ?? '—')}</span>
          <span><span className="text-gray-400">latest: </span>{String(lsnS?.latest ?? '—')}</span>
          <span><span className="text-gray-400">with attendance: </span>{Number(lsnS?.lessonsWithVisits ?? 0)}</span>
          <span><span className="text-gray-400">visits extracted: </span><strong>{Number(lsnS?.attendanceExtracted ?? 0)}</strong></span>
          <span><span className="text-gray-400">avg visits/lesson: </span>{String(lsnS?.avgVisitsPerLesson ?? 0)}</span>
          <span><span className="text-gray-400">with subjectId: </span>{Number(lsnS?.withSubjectId ?? 0)}</span>
          <span><span className="text-gray-400">with groupId: </span>{Number(lsnS?.withGroupId ?? 0)}</span>
          <span><span className="text-gray-400">with teacherId: </span>{Number(lsnS?.withTeacherId ?? 0)}</span>
          <span><span className="text-gray-400">cancelled: </span>{Number(lsnS?.cancelledCount ?? 0)}</span>
          <span className="col-span-2">
            <span className="text-gray-400">dateFilter: </span>
            <span className={`font-mono font-bold text-[10px] ${
              String(lsnS?.dateFilterStatus) === 'ACCEPTED'  ? 'text-emerald-600' :
              String(lsnS?.dateFilterStatus).includes('IGNORED') ? 'text-red-600' :
              'text-gray-500'
            }`}>{String(lsnS?.dateFilterStatus ?? 'UNKNOWN')}</span>
          </span>
        </div>
        {lsnByMonth.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {lsnByMonth.map((m) => (
              <span key={m.month} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 border border-blue-200 rounded text-[10px] text-blue-700 font-mono">
                {m.month}: <strong>{m.count}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Payments summary */}
      <div className="bg-emerald-50 border border-emerald-100 rounded-[14px] p-3">
        <p className="text-[11px] font-bold text-emerald-700 mb-2">💳 Payments Analysis</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
          <span><span className="text-gray-400">count: </span><strong>{Number(payS?.count ?? 0)}</strong></span>
          <span><span className="text-gray-400">earliest: </span>{String(payS?.earliest ?? '—')}</span>
          <span><span className="text-gray-400">latest: </span>{String(payS?.latest ?? '—')}</span>
          <span><span className="text-gray-400">with customerId: </span>{Number(payS?.withCustomerId ?? 0)}</span>
          <span><span className="text-gray-400">without customerId: </span>{Number(payS?.withoutCustomerId ?? 0)}</span>
          <span><span className="text-gray-400">has note field: </span><span className={payS?.hasNoteField ? 'text-emerald-600' : 'text-gray-400'}>{payS?.hasNoteField ? '✓' : '✗'}</span></span>
          <span><span className="text-gray-400">has balance field: </span><span className={payS?.hasBalanceField ? 'text-emerald-600' : 'text-gray-400'}>{payS?.hasBalanceField ? '✓' : '✗'}</span></span>
          <span><span className="text-gray-400">has debt field: </span><span className={payS?.hasDebtField ? 'text-emerald-600' : 'text-gray-400'}>{payS?.hasDebtField ? '✓' : '✗'}</span></span>
        </div>
        {payByMonth.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {payByMonth.map((m) => (
              <span key={m.month} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 border border-emerald-200 rounded text-[10px] text-emerald-700 font-mono">
                {m.month}: <strong>{m.count}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Subjects + Customer-Tariff side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-purple-50 border border-purple-100 rounded-[14px] p-3">
          <p className="text-[11px] font-bold text-purple-700 mb-2">📖 Subjects Resolution</p>
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between"><span className="text-gray-500">total in DB:</span> <strong>{Number(subS?.count ?? 0)}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">refs from lessons:</span> <strong>{Number(subS?.referencedByLessons ?? 0)}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">resolved:</span> <span className="text-emerald-600 font-bold">{Number(subS?.resolved ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">unresolved:</span> <span className={Number(subS?.unresolved ?? 0) > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}>{Number(subS?.unresolved ?? 0)}</span></div>
          </div>
          {(subS?.unresolvedIds as string[] | undefined)?.length ? (
            <p className="text-[10px] text-red-600 mt-1 font-mono truncate">IDs: {(subS?.unresolvedIds as string[]).slice(0, 5).join(', ')}</p>
          ) : null}
        </div>

        <div className="bg-orange-50 border border-orange-100 rounded-[14px] p-3">
          <p className="text-[11px] font-bold text-orange-700 mb-2">🎫 Customer-Tariff / Абонементы</p>
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between"><span className="text-gray-500">endpoint status:</span>
              <StatusBadge status={String(ctS?.endpointStatus ?? 'NOT_DISCOVERED')} />
            </div>
            <div className="flex justify-between"><span className="text-gray-500">records:</span> <strong>{Number(ctS?.count ?? 0)}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">abonement data:</span>
              <span className={ctS?.hasAbonementData ? 'text-emerald-600 font-bold' : 'text-gray-400'}>
                {ctS?.hasAbonementData ? '✓ found' : '✗ none'}
              </span>
            </div>
          </div>
          {(ctS?.abonementFieldsFound as string[] | undefined)?.length ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(ctS?.abonementFieldsFound as string[]).map((f) => (
                <span key={f} className="px-1 py-0.5 bg-orange-100 rounded text-[9px] font-mono text-orange-700">{f}</span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-400 italic mt-1">
              {String(ctS?.endpointStatus ?? '') === 'NOT_DISCOVERED' ? 'Run Discovery to probe endpoint' : 'No abonement fields found'}
            </p>
          )}
        </div>
      </div>

      {/* Endpoint status summary */}
      {(registry.length > 0 || epStatus) && (
        <div>
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Endpoint Status Summary (Atlas)</p>
          {epStatus && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                { k: 'ok',       label: 'OK',        cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
                { k: 'empty',    label: 'EMPTY',      cls: 'bg-blue-100 text-blue-800 border-blue-300' },
                { k: 'embedded', label: 'EMBEDDED',   cls: 'bg-purple-100 text-purple-700 border-purple-300' },
                { k: 'notFound', label: 'NOT_FOUND',  cls: 'bg-gray-100 text-gray-600 border-gray-300' },
                { k: 'unknown',  label: 'UNKNOWN',    cls: 'bg-amber-100 text-amber-700 border-amber-300' },
                { k: 'error',    label: 'ERROR',      cls: 'bg-red-100 text-red-700 border-red-300' },
                { k: 'forbidden',label: 'FORBIDDEN',  cls: 'bg-orange-100 text-orange-700 border-orange-300' },
              ].filter(({ k }) => (epStatus[k] ?? 0) > 0).map(({ k, label, cls }) => (
                <span key={k} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold ${cls}`}>
                  {label} <strong>{epStatus[k]}</strong>
                </span>
              ))}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border bg-gray-50 text-gray-500 text-[10px]">
                total: <strong>{epStatus.total ?? registry.length}</strong>
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {registry.map((r) => (
              <div key={String(r.entityKey)} className="flex items-center justify-between px-2 py-1 rounded-lg bg-gray-50 border border-gray-150">
                <span className="text-[10px] font-mono text-gray-600 truncate">{String(r.entityKey)}</span>
                <StatusBadge status={String(r.status ?? 'UNKNOWN')} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unresolved endpoints */}
      {unresolved.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-[12px] p-3">
          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-1">
            ⚠ Unresolved Endpoints ({unresolved.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unresolved.map((u) => (
              <span key={String(u.entityKey)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 text-[10px] border border-amber-200">
                {String(u.entityKey)} <StatusBadge status={String(u.status ?? '?')} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Last batches */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <BatchInfo batch={lastDisc} label="Last Discovery Batch" />
        <BatchInfo batch={lastSync} label="Last Raw Sync Batch" />
      </div>

      {/* Env footer */}
      <div className="text-[10px] text-gray-400 font-mono flex flex-wrap gap-3">
        <span>env: {String(d.syncEnvironment ?? '—')}</span>
        <span>db: {String(d.dbName ?? '—')}</span>
        <span>host: {String(d.dbHostMasked ?? '—')}</span>
        <span>crm: {String(d.alphaCrmBaseUrl ?? '—')}</span>
      </div>
    </div>
  );
}

// ─── P7 Audit Panels ──────────────────────────────────────────────────────────

function AuditStatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-[14px] border border-black/[0.06] p-3 flex flex-col gap-1">
      <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{label}</div>
      <div className={`text-[22px] font-bold tabular-nums ${color ?? 'text-[#0F172A]'}`}>{typeof value === 'number' ? value.toLocaleString('ru') : value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

function NormGapRow({ row }: { row: { entityType: string; rawCount: number; normalizedCount: number | null; notNormalized: number | null; normalizationRate: number | null } }) {
  const rate = row.normalizationRate ?? 0;
  const color = rate >= 80 ? 'text-emerald-600' : rate >= 30 ? 'text-amber-600' : 'text-red-500';
  const bg = rate >= 80 ? 'bg-emerald-500' : rate >= 30 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2 text-[12px] font-mono">{row.entityType}</td>
      <td className="px-3 py-2 text-right tabular-nums text-[12px]">{(row.rawCount ?? 0).toLocaleString('ru')}</td>
      <td className="px-3 py-2 text-right tabular-nums text-[12px]">{row.normalizedCount != null ? row.normalizedCount.toLocaleString('ru') : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-[12px] text-red-500 font-semibold">{row.notNormalized != null && row.notNormalized > 0 ? row.notNormalized.toLocaleString('ru') : '—'}</td>
      <td className="px-3 py-2 text-[12px]">
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-100 rounded-full h-1.5 w-16">
            <div className={`h-1.5 rounded-full ${bg}`} style={{ width: `${Math.min(rate, 100)}%` }} />
          </div>
          <span className={`tabular-nums font-semibold ${color}`}>{rate}%</span>
        </div>
      </td>
    </tr>
  );
}

function NormalizationAuditPanel({ branchId }: { branchId: string }) {
  const { data, isLoading, error, refetch } = useGetCoverageNormalizationAudit(
    { branchId },
    { query: { queryKey: getGetCoverageNormalizationAuditQueryKey({ branchId }), staleTime: 60_000 } },
  );

  if (isLoading) return <div className="flex items-center gap-2 text-[12px] text-gray-400 py-6"><Loader2 className="w-4 h-4 animate-spin" />Загрузка аудита нормализации…</div>;
  if (error || !data) return <div className="text-[12px] text-red-500 py-4">Ошибка загрузки. <button onClick={() => refetch()} className="underline">Повторить</button></div>;

  const d = data as Record<string, unknown>;
  const gap = (d.normalizationGap as Array<{ entityType: string; rawCount: number; normalizedCount: number | null; notNormalized: number | null; normalizationRate: number | null }>) ?? [];
  const identity = (d.identityLayer as Record<string, number>) ?? {};
  const missing = (d.missingLinks as Record<string, unknown>) ?? {};
  const verdict = (d.verdict as { critical: string[]; warning: string[] }) ?? { critical: [], warning: [] };
  const statusAudit = (d.studentStatusAudit as Record<string, unknown>) ?? {};
  const fromRaw = (statusAudit.fromRaw as Record<string, string>) ?? {};

  return (
    <div className="space-y-5">
      {verdict.critical.length > 0 && (
        <div className="rounded-[14px] border border-red-200 bg-red-50 p-4 space-y-1">
          <div className="text-[12px] font-semibold text-red-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Критические проблемы нормализации</div>
          {verdict.critical.map((msg, i) => <div key={i} className="text-[11px] text-red-600 pl-5">{msg}</div>)}
        </div>
      )}
      {verdict.warning.length > 0 && (
        <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4 space-y-1">
          <div className="text-[12px] font-semibold text-amber-700 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Предупреждения</div>
          {verdict.warning.map((msg, i) => <div key={i} className="text-[11px] text-amber-600 pl-5">{msg}</div>)}
        </div>
      )}

      <div>
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Normalization Gap по entity</div>
        <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">Entity</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Raw</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Normalized</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Не нормализовано</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Rate</th>
              </tr>
            </thead>
            <tbody>
              {gap.map(row => <NormGapRow key={row.entityType} row={row} />)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AuditStatCard label="Student Profiles" value={identity.studentProfiles ?? 0} sub="identity layer" />
        <AuditStatCard label="Families" value={identity.families ?? 0} sub="identity layer" />
        <AuditStatCard label="Persons" value={identity.persons ?? 0} sub="identity layer" />
        <AuditStatCard label="Guardian Links" value={identity.guardianStudentLinks ?? 0} sub="identity layer" />
      </div>

      <div>
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Статус студентов в сырых данных</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <AuditStatCard label="is_study = 1" value={fromRaw.is_study_yes ?? '—'} sub="активно учатся" color="text-emerald-600" />
          <AuditStatCard label="is_study = 0" value={fromRaw.is_study_no ?? '—'} sub="не учатся" color="text-amber-600" />
          <AuditStatCard label="is_archived = 1" value={fromRaw.is_archived ?? '—'} sub="в архиве" color="text-red-500" />
          <AuditStatCard label="Не архивированы" value={fromRaw.not_archived ?? '—'} sub="активные" />
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Отсутствующие критические ссылки</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { key: 'rawStudentsNotNormalized', label: 'Raw students → не нормализованы' },
            { key: 'rawLessonsNotNormalized', label: 'Raw lessons → не нормализованы' },
            { key: 'rawPaymentsNotNormalized', label: 'Raw payments → не нормализованы' },
            { key: 'studentsWithoutFamily', label: 'Студенты без семьи (profiles)' },
            { key: 'studentsWithoutPerson', label: 'Студенты без Person записи' },
            { key: 'rawLessonsWithoutGroup', label: 'Уроки без группы' },
            { key: 'rawLessonsWithoutSubject', label: 'Уроки без предмета' },
            { key: 'rawLessonsWithoutTeacher', label: 'Уроки без учителя' },
            { key: 'rawPaymentsWithoutCustomer', label: 'Платежи без клиента' },
          ].map(({ key, label }) => {
            const val = missing[key] as number ?? 0;
            return <AuditStatCard key={key} label={label} value={val} color={val > 0 ? 'text-red-500' : 'text-emerald-600'} />;
          })}
        </div>
      </div>

      {(missing.rawStudentsNotNormalizedList as unknown[])?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Студенты в raw, но не нормализованы</div>
          <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-hidden">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">Alpha ID</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Имя</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Телефон</th>
              </tr></thead>
              <tbody>
                {(missing.rawStudentsNotNormalizedList as Array<Record<string, string>>).map((r, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 font-mono">{r.alpha_id}</td>
                    <td className="px-3 py-1.5">{r.name ?? '—'}</td>
                    <td className="px-3 py-1.5 text-gray-400">{r.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-[10px] text-gray-400 italic">Сгенерировано: {String(d.generatedAt ?? '—')}</div>
    </div>
  );
}

function EntityReconciliationPanel({ branchId }: { branchId: string }) {
  const { data, isLoading, error, refetch } = useGetCoverageEntityReconciliation(
    { branchId },
    { query: { queryKey: getGetCoverageEntityReconciliationQueryKey({ branchId }), staleTime: 60_000 } },
  );

  if (isLoading) return <div className="flex items-center gap-2 text-[12px] text-gray-400 py-6"><Loader2 className="w-4 h-4 animate-spin" />Загрузка сверки…</div>;
  if (error || !data) return <div className="text-[12px] text-red-500 py-4">Ошибка. <button onClick={() => refetch()} className="underline">Повторить</button></div>;

  const d = data as Record<string, unknown>;
  const students = (d.students as Record<string, unknown>) ?? {};
  const families = (d.families as Record<string, unknown>) ?? {};
  const lessons = (d.lessons as Record<string, unknown>) ?? {};
  const payments = (d.payments as Record<string, unknown>) ?? {};
  const groups = (d.groups as Record<string, unknown>) ?? {};
  const subjects = (d.subjects as Record<string, unknown>) ?? {};
  const teachers = (d.teachers as Record<string, unknown>) ?? {};

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <Section title="Студенты (Children)">
        <AuditStatCard label="Raw (AlphaCRM)" value={Number(students.raw ?? 0)} sub="alpha_raw_records" />
        <AuditStatCard label="Normalized" value={Number(students.normalized ?? 0)} sub="crm_students" color={Number(students.normalized ?? 0) < Number(students.raw ?? 1) ? 'text-amber-600' : 'text-emerald-600'} />
        <AuditStatCard label="Student Profiles" value={Number(students.studentProfiles ?? 0)} sub="identity layer" />
        <AuditStatCard label="В семьях" value={Number(students.inFamilies ?? 0)} sub="family_id IS NOT NULL" />
        <AuditStatCard label="Не нормализовано" value={Number(students.notNormalized ?? 0)} color={Number(students.notNormalized ?? 0) > 0 ? 'text-red-500' : 'text-emerald-600'} />
        <AuditStatCard label="Уник. в уроках" value={Number(students.uniqueStudentIdsInLessons ?? 0)} sub="по customer_id" />
        <AuditStatCard label="Уник. в платежах" value={Number(students.uniqueStudentIdsInPayments ?? 0)} sub="по customer_id" />
      </Section>

      <Section title="Семьи">
        <AuditStatCard label="Всего семей" value={Number(families.total ?? 0)} />
        <AuditStatCard label="С детьми" value={Number(families.withChildren ?? 0)} color="text-emerald-600" />
        <AuditStatCard label="Без детей" value={Number(families.withoutChildren ?? 0)} color={Number(families.withoutChildren ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <AuditStatCard label="Только неактивные дети" value={Number(families.withOnlyInactiveChildren ?? 0)} color={Number(families.withOnlyInactiveChildren ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'} />
      </Section>

      <Section title="Уроки">
        <AuditStatCard label="Raw" value={Number(lessons.raw ?? 0)} sub="alpha_raw_records" />
        <AuditStatCard label="Normalized" value={Number(lessons.normalized ?? 0)} sub="crm_lessons" color={Number(lessons.normalizationRate ?? 0) < 10 ? 'text-red-500' : 'text-amber-600'} />
        <AuditStatCard label="Не нормализовано" value={Number(lessons.notNormalized ?? 0)} color="text-red-500" />
        <AuditStatCard label="Rate" value={`${lessons.normalizationRate ?? 0}%`} color={Number(lessons.normalizationRate ?? 0) < 10 ? 'text-red-500' : 'text-amber-600'} />
        <AuditStatCard label="Без группы" value={Number(lessons.withoutGroup ?? 0)} color={Number(lessons.withoutGroup ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <AuditStatCard label="Без предмета" value={Number(lessons.withoutSubject ?? 0)} color={Number(lessons.withoutSubject ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <AuditStatCard label="Без учителя" value={Number(lessons.withoutTeacher ?? 0)} color={Number(lessons.withoutTeacher ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <AuditStatCard label="Attendance записи" value={Number(lessons.attendanceRecords ?? 0)} />
      </Section>

      <Section title="Платежи">
        <AuditStatCard label="Raw" value={Number(payments.raw ?? 0)} sub="alpha_raw_records" />
        <AuditStatCard label="Normalized" value={Number(payments.normalized ?? 0)} sub="crm_payments" color={Number(payments.normalizationRate ?? 0) < 10 ? 'text-red-500' : 'text-amber-600'} />
        <AuditStatCard label="Не нормализовано" value={Number(payments.notNormalized ?? 0)} color="text-red-500" />
        <AuditStatCard label="Rate" value={`${payments.normalizationRate ?? 0}%`} color={Number(payments.normalizationRate ?? 0) < 10 ? 'text-red-500' : 'text-amber-600'} />
        <AuditStatCard label="Привязаны к студенту" value={Number(payments.linkedToStudent ?? 0)} color="text-emerald-600" />
        <AuditStatCard label="Без customer_id" value={Number(payments.unlinkedFromCustomer ?? 0)} color={Number(payments.unlinkedFromCustomer ?? 0) > 0 ? 'text-red-500' : 'text-emerald-600'} />
        <AuditStatCard label="Сумма income (raw)" value={Math.round(Number(payments.totalIncomeSum ?? 0)).toLocaleString('ru')} sub="₽ AlphaCRM" />
      </Section>
      <div className="rounded-[10px] bg-amber-50 border border-amber-200 px-4 py-2 text-[11px] text-amber-700">
        ⚠️ AlphaCRM payments = операционные записи. <strong>Не являются банковской истиной.</strong> Требуется сверка с банком.
      </div>

      <Section title="Группы / Предметы / Учителя">
        <AuditStatCard label="Группы raw" value={Number(groups.raw ?? 0)} />
        <AuditStatCard label="Группы с предметом" value={Number(groups.withSubject ?? 0)} color={Number(groups.withSubject ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'} />
        <AuditStatCard label="Группы с учителем" value={Number(groups.withTeacher ?? 0)} color={Number(groups.withTeacher ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'} />
        <AuditStatCard label="Предметы raw" value={Number(subjects.raw ?? 0)} />
        <AuditStatCard label="Предметы в уроках" value={Number(subjects.referencedByLessons ?? 0)} />
        <AuditStatCard label="Неразрешённые subj." value={Number(subjects.unresolvedInLessons ?? 0)} color={Number(subjects.unresolvedInLessons ?? 0) > 0 ? 'text-red-500' : 'text-emerald-600'} />
        <AuditStatCard label="Учителя raw" value={Number(teachers.raw ?? 0)} />
        <AuditStatCard label="Учителя normalized" value={Number(teachers.normalized ?? 0)} />
      </Section>

      {(lessons.byMonth as unknown[])?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Уроки по месяцам (raw)</div>
          <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">Месяц</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Уроков</th>
              </tr></thead>
              <tbody>
                {(lessons.byMonth as Array<{ month: string; cnt: string }>).map((row, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 font-mono">{row.month}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{Number(row.cnt).toLocaleString('ru')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(payments.byMonth as unknown[])?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Платежи по месяцам (raw)</div>
          <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">Месяц</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Платежей</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Сумма ₽</th>
              </tr></thead>
              <tbody>
                {(payments.byMonth as Array<{ raw_month: string; cnt: string; income_sum: string }>).map((row, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 font-mono">{row.raw_month}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(row.cnt).toLocaleString('ru')}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{Math.round(Number(row.income_sum)).toLocaleString('ru')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(payments.suspiciousHigh as unknown[])?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-2">⚠️ Подозрительно высокие платежи (&gt;100к)</div>
          <div className="bg-white rounded-[14px] border border-red-100 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-red-50 border-b border-red-100">
                <th className="px-3 py-2 text-left font-medium text-red-400">Alpha ID</th>
                <th className="px-3 py-2 text-right font-medium text-red-400">Сумма</th>
                <th className="px-3 py-2 text-left font-medium text-red-400">Дата</th>
                <th className="px-3 py-2 text-left font-medium text-red-400">Customer ID</th>
              </tr></thead>
              <tbody>
                {(payments.suspiciousHigh as Array<Record<string, string>>).map((r, i) => (
                  <tr key={i} className="border-t border-red-50">
                    <td className="px-3 py-1.5 font-mono">{r.alpha_id}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-red-600 font-bold">{Number(r.income).toLocaleString('ru')}</td>
                    <td className="px-3 py-1.5">{r.date}</td>
                    <td className="px-3 py-1.5 text-gray-400">{r.customer_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-[10px] text-gray-400 italic">Сгенерировано: {String(d.generatedAt ?? '—')}</div>
    </div>
  );
}

// ─── P7.5 Payment Truth Audit ─────────────────────────────────────────────────
function PaymentAuditPanel({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useGetCoveragePaymentTruthAudit(
    { branchId },
    { query: { queryKey: getGetCoveragePaymentTruthAuditQueryKey({ branchId }), staleTime: 60_000 } },
  );
  const [showMonthly, setShowMonthly] = useState(false);

  const normMut = useRetiredLegacyAction();

  const audit = data as unknown as Record<string, unknown> | undefined;
  const norm  = audit?.normalization as Record<string, unknown> | undefined;
  const totals = audit?.totals      as Record<string, unknown> | undefined;
  const links  = audit?.linkingSummary as Record<string, unknown> | undefined;
  const types  = (audit?.typeBreakdown as Array<Record<string, unknown>> | undefined) ?? [];
  const monthly = (audit?.monthly as Array<Record<string, unknown>> | undefined) ?? [];
  const suspicious = (audit?.suspicious as Record<string, unknown> | undefined);
  const topUnlinked = (audit?.topUnlinkedCustomerIds as Array<Record<string, unknown>> | undefined) ?? [];

  const normRate  = Number(norm?.normalizationRate ?? 0);
  const rawCount  = Number(norm?.rawPayments ?? 0);
  const normCount = Number(norm?.normalizedPayments ?? 0);

  const fmt = (n: number) => n.toLocaleString('ru-RU');
  const fmtRub = (n: number) => formatRubles(n);

  if (isLoading) return <div className="py-6 text-center text-gray-400 text-sm"><Loader2 className="inline animate-spin mr-1 w-4 h-4" />Загрузка payment audit…</div>;
  if (error) return <div className="py-4 text-red-500 text-sm">Ошибка: {String(error)}</div>;

  return (
    <div className="space-y-4">
      {/* warning banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12px] text-amber-800 flex gap-2 items-start">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span><strong>Внимание:</strong> Это операционные платежи из AlphaCRM — НЕ банковская истина. Банковская сверка выполняется отдельно в модуле «Деньги».</span>
      </div>

      {/* Normalize button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => normMut.mutate()}
          disabled={normMut.isPending}
          className="flex items-center gap-1.5 bg-indigo-600 text-white text-[12px] font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {normMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {normMut.isPending ? 'Нормализация…' : 'Нормализовать платежи (P7.5)'}
        </button>
        <button onClick={() => void refetch()} className="text-[12px] text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Обновить
        </button>
      </div>

      {/* Normalization progress */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-[13px] font-semibold text-gray-800 mb-3">Нормализация платежей (P7.5)</div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-[20px] font-bold text-gray-800">{fmt(rawCount)}</div>
            <div className="text-[11px] text-gray-500">Raw платежей</div>
          </div>
          <div className="bg-indigo-50 rounded-lg p-3 text-center">
            <div className="text-[20px] font-bold text-indigo-700">{fmt(normCount)}</div>
            <div className="text-[11px] text-gray-500">Нормализовано</div>
          </div>
          <div className={`rounded-lg p-3 text-center ${normRate >= 99 ? 'bg-green-50' : 'bg-amber-50'}`}>
            <div className={`text-[20px] font-bold ${normRate >= 99 ? 'text-green-700' : 'text-amber-700'}`}>{normRate}%</div>
            <div className="text-[11px] text-gray-500">Покрытие</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="text-gray-500">Parse errors: <span className="font-semibold text-red-600">{Number(norm?.parseErrors ?? 0)}</span></div>
          <div className="text-gray-500">Не подтверждено: <span className="font-semibold text-orange-600">{fmt(Number(norm?.unconfirmed ?? 0))}</span></div>
          <div className="text-gray-500">Пробел raw-norm: <span className="font-semibold">{fmt(rawCount - normCount)}</span></div>
        </div>
      </div>

      {/* Totals */}
      {totals && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">Суммы (AlphaCRM, не банк)</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-[16px] font-bold text-green-700">{fmtRub(Number(totals.incomeSum ?? 0))}</div>
              <div className="text-[11px] text-gray-500">Доход (pay_type=1)</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-[16px] font-bold text-blue-700">{fmtRub(Number(totals.correctionSum ?? 0))}</div>
              <div className="text-[11px] text-gray-500">Корректировки (pay_type=6)</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <div className="text-[16px] font-bold text-red-700">{fmtRub(Number(totals.outcomeSum ?? 0))}</div>
              <div className="text-[11px] text-gray-500">Инкассация (pay_type=12)</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-gray-500">
            <div>Отрицательных: <span className="font-semibold text-red-600">{fmt(Number(totals.negativeCount ?? 0))}</span></div>
            <div>Подозрительных (&gt;100K): <span className="font-semibold text-orange-600">{Number(totals.suspiciousHigh ?? 0)}</span></div>
            <div>Период: {String(totals.earliestDate ?? '?')} → {String(totals.latestDate ?? '?')}</div>
          </div>
        </div>
      )}

      {/* Type breakdown */}
      {types.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">Типы платежей</div>
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-gray-100 text-gray-500"><th className="text-left pb-1">Тип</th><th className="text-right pb-1">ID</th><th className="text-right pb-1">Кол-во</th><th className="text-right pb-1">Сумма дохода</th><th className="text-right pb-1">Сумма расхода</th></tr></thead>
            <tbody>
              {types.map((t, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1 font-medium">{String(t.type_normalized ?? '?')}</td>
                  <td className="py-1 text-right text-gray-500">{String(t.type_id_raw ?? '?')} / {String(t.type_name_raw ?? '?')}</td>
                  <td className="py-1 text-right font-semibold">{fmt(Number(t.cnt ?? 0))}</td>
                  <td className="py-1 text-right text-green-700">{fmtRub(Number(t.income_sum ?? 0))}</td>
                  <td className="py-1 text-right text-red-700">{fmtRub(Number(t.outcome_sum ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Linking summary */}
      {links && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">Привязка к студентам / семьям</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Активный студент', val: Number(links.activeStudent ?? 0), color: 'bg-green-50 text-green-700' },
              { label: 'Неактивный студент', val: Number(links.inactiveStudent ?? 0), color: 'bg-yellow-50 text-yellow-700' },
              { label: 'Историческая идентичность', val: Number(links.historicalOnly ?? 0), color: 'bg-blue-50 text-blue-700' },
              { label: 'С семьёй', val: Number(links.withFamily ?? 0), color: 'bg-teal-50 text-teal-700' },
              { label: 'Без привязки', val: Number(links.unlinked ?? 0), color: 'bg-red-50 text-red-700' },
              { label: 'Без customer_id', val: Number(links.noCustomerId ?? 0), color: 'bg-gray-50 text-gray-600' },
            ].map(({ label, val, color }) => (
              <div key={label} className={`${color} rounded-lg p-2.5 text-center`}>
                <div className="text-[17px] font-bold">{fmt(val)}</div>
                <div className="text-[10px] mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          {topUnlinked.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold text-gray-600 mb-1">Топ customer_id без привязки:</div>
              <div className="flex flex-wrap gap-1">
                {topUnlinked.map((r, i) => (
                  <span key={i} className="bg-gray-100 text-gray-700 text-[10px] px-2 py-0.5 rounded">
                    {String(r.student_crm_id ?? r.customer_id ?? '?')} ({String(r.cnt ?? '?')} пл.)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suspicious */}
      {Number(suspicious?.count ?? 0) > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="text-[13px] font-semibold text-orange-800 mb-2">⚠️ Подозрительные суммы ({String(suspicious?.count)} записей &gt;100,000 ₽)</div>
          <div className="space-y-1">
            {((suspicious?.examples as Array<Record<string, unknown>>) ?? []).slice(0, 5).map((p, i) => (
              <div key={i} className="flex gap-2 text-[11px] text-orange-900">
                <span className="font-mono text-orange-600">ID:{String(p.crm_id ?? p.alpha_id ?? '?')}</span>
                <span>{String(p.date ?? p.document_date ?? '?')}</span>
                <span className="font-semibold">{fmtRub(Number(p.income ?? p.outcome ?? 0))}</span>
                <span className="text-orange-500">{String(p.direction ?? '')}</span>
                <span className="text-orange-400">customer:{String(p.customer_id ?? p.student_crm_id ?? 'нет')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly (collapsible) */}
      {monthly.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowMonthly(v => !v)}
            className="w-full flex items-center justify-between p-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50"
          >
            <span>📅 Помесячная разбивка ({monthly.length} месяцев)</span>
            {showMonthly ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {showMonthly && (
            <div className="px-4 pb-3 overflow-x-auto">
              <table className="w-full text-[11px] min-w-[600px]">
                <thead><tr className="border-b border-gray-100 text-gray-500">
                  <th className="text-left pb-1">Месяц</th>
                  <th className="text-right pb-1">Всего</th>
                  <th className="text-right pb-1">Доходов</th>
                  <th className="text-right pb-1">Корр.</th>
                  <th className="text-right pb-1">Расход</th>
                  <th className="text-right pb-1">Сумма доходов</th>
                  <th className="text-right pb-1">Студенты/Идент.</th>
                </tr></thead>
                <tbody>
                  {monthly.map((m, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-0.5 font-mono">{String(m.month ?? '?')}</td>
                      <td className="py-0.5 text-right">{fmt(Number(m.total_payments ?? 0))}</td>
                      <td className="py-0.5 text-right text-green-700">{fmt(Number(m.income_cnt ?? 0))}</td>
                      <td className="py-0.5 text-right text-blue-700">{fmt(Number(m.correction_cnt ?? 0))}</td>
                      <td className="py-0.5 text-right text-red-600">{fmt(Number(m.outcome_cnt ?? 0))}</td>
                      <td className="py-0.5 text-right font-medium">{fmtRub(Number(m.income_sum ?? 0))}</td>
                      <td className="py-0.5 text-right text-gray-500">{fmt(Number(m.linked_student ?? 0))} / {fmt(Number(m.linked_identity ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── P7.6 Payment Cleanup Audit ───────────────────────────────────────────────
function PaymentCleanupPanel({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useGetCoveragePaymentCleanupAudit(
    { branchId },
    { query: { queryKey: getGetCoveragePaymentCleanupAuditQueryKey({ branchId }), staleTime: 60_000 } },
  );
  const [showCollection, setShowCollection] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const cleanupMut = useRetiredLegacyAction();

  const d    = data as unknown as Record<string, unknown> | undefined;
  const cnt  = d?.counts as Record<string, unknown> | undefined;
  const unk  = d?.unknownPayments as Record<string, unknown> | undefined;
  const unl  = d?.unlinkedPayments as Record<string, unknown> | undefined;
  const col  = d?.collectionRisk as Record<string, unknown> | undefined;
  const susp = d?.suspiciousFlags as Record<string, unknown> | undefined;
  const crf  = (d?.correctionsRefundsOutcomes as Array<Record<string, unknown>> | undefined) ?? [];
  const unlinkedClass = (unl?.classification as Array<Record<string, unknown>> | undefined) ?? [];
  const byType = (susp?.byType as Array<Record<string, unknown>> | undefined) ?? [];
  const examples = (susp?.examples as Array<Record<string, unknown>> | undefined) ?? [];
  const readiness = String(d?.readiness ?? 'NOT_READY');
  const reasons   = (d?.readinessReasons as string[] | undefined) ?? [];
  const cleanupRan = Boolean(d?.cleanupRan);

  const fmt    = (n: number) => n.toLocaleString('ru-RU');
  const fmtRub = (n: number) => formatRubles(n);

  const readinessColor = readiness === 'READY' ? 'bg-green-50 border-green-200 text-green-800'
    : readiness === 'PARTIAL' ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-red-50 border-red-200 text-red-700';
  const readinessIcon = readiness === 'READY' ? '✅' : readiness === 'PARTIAL' ? '⚠️' : '🔴';

  if (isLoading) return <div className="py-6 text-center text-gray-400 text-sm"><Loader2 className="inline animate-spin mr-1 w-4 h-4" />Загрузка cleanup audit…</div>;
  if (error)     return <div className="py-4 text-red-500 text-sm">Ошибка: {String(error)}</div>;

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => cleanupMut.mutate()}
          disabled={cleanupMut.isPending}
          className="flex items-center gap-1.5 bg-violet-600 text-white text-[12px] font-medium px-4 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-50"
        >
          {cleanupMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {cleanupMut.isPending ? 'Очистка…' : 'Запустить P7.6 cleanup (идемпотентно)'}
        </button>
        <button onClick={() => void refetch()} className="text-[12px] text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Обновить
        </button>
      </div>

      {!cleanupRan && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-[12px] text-gray-600">
          Cleanup ещё не запускался. Нажмите кнопку выше, чтобы проставить risk-флаги, перепривязать платежи и создать issues.
        </div>
      )}

      {/* Readiness badge */}
      {cleanupRan && (
        <div className={`border rounded-lg p-3 text-[12px] ${readinessColor}`}>
          <div className="font-semibold mb-1">{readinessIcon} Готовность к банковской сверке: <span className="uppercase">{readiness}</span></div>
          {reasons.map((r, i) => <div key={i} className="mt-1">• {r}</div>)}
        </div>
      )}

      {/* Key counts grid */}
      {cnt && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Неизвестный тип', val: Number(cnt.unknownCnt ?? 0), color: Number(cnt.unknownCnt ?? 0) === 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700' },
            { label: 'Непривязанных',   val: Number(cnt.unlinkedCnt ?? 0), color: 'bg-amber-50 text-amber-700' },
            { label: 'Risk: HIGH',       val: Number(cnt.riskHigh ?? 0),    color: 'bg-red-50 text-red-700' },
            { label: 'Risk: LOW',        val: Number(cnt.riskLow ?? 0),     color: 'bg-green-50 text-green-700' },
          ].map(({ label, val, color }) => (
            <div key={label} className={`rounded-lg p-3 text-center ${color}`}>
              <div className="text-[18px] font-bold">{fmt(val)}</div>
              <div className="text-[10px] mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Unknown payments */}
      {unk && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-2">❓ Неизвестный тип ({Number(unk.count ?? 0)})</div>
          <div className="text-[12px] text-gray-600 mb-3">{String(unk.explanation ?? '')}</div>
          <div className="text-[11px] bg-gray-50 rounded p-2 text-gray-500">
            Рекомендация: <span className="font-medium">{String(unk.recommendedAction ?? '')}</span>
          </div>
        </div>
      )}

      {/* Unlinked classification */}
      {unlinkedClass.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">🔗 Непривязанные платежи — классификация ({fmt(Number(cnt?.unlinkedCnt ?? 0))})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-gray-100">
                <th className="text-left pb-1 text-gray-500">Класс</th>
                <th className="text-left pb-1 text-gray-500">Тип платежа</th>
                <th className="text-right pb-1 text-gray-500">Кол-во</th>
                <th className="text-right pb-1 text-gray-500">Доход</th>
                <th className="text-right pb-1 text-gray-500">Расход</th>
              </tr></thead>
              <tbody>
                {unlinkedClass.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1 font-mono text-[10px] text-gray-700">{String(r.class ?? '')}</td>
                    <td className="py-1 text-gray-600">{String(r.type_norm ?? '')}</td>
                    <td className="py-1 text-right font-semibold">{fmt(Number(r.cnt ?? 0))}</td>
                    <td className="py-1 text-right text-green-600">{Number(r.sum_income ?? 0) > 0 ? fmtRub(Number(r.sum_income)) : '—'}</td>
                    <td className="py-1 text-right text-red-600">{Number(r.sum_outcome ?? 0) > 0 ? fmtRub(Number(r.sum_outcome)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Collection risk */}
      {col && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-semibold text-red-800">
              🏦 Инкассация / коллекция — HIGH RISK ({fmt(Number(col.totalCount ?? 0))} записей, {fmtRub(Number(col.totalAmount ?? 0))})
            </div>
            <button onClick={() => setShowCollection(!showCollection)} className="text-[11px] text-red-600 hover:text-red-800">
              {showCollection ? 'Скрыть' : 'По месяцам'}
            </button>
          </div>
          <div className="text-[12px] text-red-700 mb-2">{String(col.note ?? '')}</div>
          <div className="flex gap-3 text-[11px]">
            <span className="bg-red-100 text-red-800 rounded px-2 py-0.5">Риск: {String(col.riskLevel ?? '')}</span>
            <span className="bg-red-100 text-red-800 rounded px-2 py-0.5">Трактовка: {String(col.financeTreatment ?? '')}</span>
            <span className="bg-amber-100 text-amber-800 rounded px-2 py-0.5">{String(col.recommendation ?? '')}</span>
          </div>
          {showCollection && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead><tr className="border-b border-red-200">
                  <th className="text-left pb-1 text-red-600">Месяц</th>
                  <th className="text-right pb-1 text-red-600">Кол-во</th>
                  <th className="text-right pb-1 text-red-600">Сумма</th>
                </tr></thead>
                <tbody>
                  {(col.byMonth as Array<Record<string, unknown>> | undefined ?? []).map((r, i) => (
                    <tr key={i} className="border-b border-red-100">
                      <td className="py-0.5 font-mono">{String(r.month ?? '')}</td>
                      <td className="py-0.5 text-right">{fmt(Number(r.cnt ?? 0))}</td>
                      <td className="py-0.5 text-right">{fmtRub(Number(r.total_outcome ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Corrections / refunds / outcomes */}
      {crf.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">📋 Корректировки / возвраты / инкассация</div>
          <table className="w-full text-[11px]">
            <thead><tr className="border-b border-gray-100">
              <th className="text-left pb-1 text-gray-500">Тип</th>
              <th className="text-right pb-1 text-gray-500">Кол-во</th>
              <th className="text-right pb-1 text-gray-500">Сумма доход</th>
              <th className="text-right pb-1 text-gray-500">Сумма расход</th>
              <th className="text-right pb-1 text-gray-500">Привяз.</th>
              <th className="text-right pb-1 text-gray-500">Непривяз.</th>
            </tr></thead>
            <tbody>
              {crf.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1 font-semibold text-gray-700">{String(r.payment_type_normalized ?? '')}</td>
                  <td className="py-1 text-right">{fmt(Number(r.cnt ?? 0))}</td>
                  <td className="py-1 text-right text-green-600">{Number(r.sum_income ?? 0) !== 0 ? fmtRub(Number(r.sum_income)) : '—'}</td>
                  <td className="py-1 text-right text-red-600">{Number(r.sum_outcome ?? 0) > 0 ? fmtRub(Number(r.sum_outcome)) : '—'}</td>
                  <td className="py-1 text-right text-gray-500">{fmt(Number(r.linked_student ?? 0) + Number(r.linked_identity ?? 0))}</td>
                  <td className="py-1 text-right text-amber-600">{fmt(Number(r.unlinked ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Suspicious flags */}
      {cleanupRan && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-gray-800">
              🚨 Issues / Flags ({fmt(Number(susp?.total ?? 0))})
            </div>
            <button onClick={() => setShowIssues(!showIssues)} className="text-[11px] text-gray-500 hover:text-gray-700">
              {showIssues ? 'Скрыть примеры' : 'Показать примеры'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {byType.map((r, i) => (
              <div key={i} className="text-[10px] bg-gray-100 rounded px-2 py-1">
                <span className="font-mono text-gray-700">{String(r.issue_type ?? '')}</span>
                <span className="text-gray-500 ml-1">×{fmt(Number(r.cnt ?? 0))}</span>
              </div>
            ))}
          </div>
          {showIssues && examples.length > 0 && (
            <div className="space-y-1">
              {examples.map((e, i) => (
                <div key={i} className="text-[10px] bg-amber-50 border border-amber-100 rounded p-2">
                  <span className="font-mono text-amber-700">[{String(e.issue_type ?? '')}]</span>
                  <span className="text-gray-600 ml-1">{String(e.issue_message ?? '').slice(0, 100)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AttendanceIdentityPanel({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useGetCoverageAttendanceStudentIdentity(
    { branchId },
    { query: { queryKey: getGetCoverageAttendanceStudentIdentityQueryKey({ branchId }), staleTime: 60_000 } },
  );
  const { data: branchCov, isLoading: branchCovLoading, refetch: refetchBranchCov } =
    useGetCoverageCustomerRawBranchCoverage(
      { query: { queryKey: getGetCoverageCustomerRawBranchCoverageQueryKey(), staleTime: 60_000 } },
    );

  const pullMut = useRetiredLegacyAction();

  const resolveGhostMut = usePostCoverageResolveGhostCustomers({
    mutation: {
      onSuccess: (res) => {
        const r = res as unknown as Record<string, unknown>;
        const saved = Number(r.rawRecordsSaved ?? 0);
        const ghosts = Number(r.ghostCount ?? 0);
        toast.success(`Ghost resolution завершён: ${saved} записей сохранено из ${ghosts} ghost IDs. Перезагружаю аудит…`);
        void refetch();
      },
      onError: (err: unknown) => { toast.error(`Ошибка resolve-ghost-customers: ${String(err)}`); },
    },
  });

  const ghostResult = resolveGhostMut.data as unknown as Record<string, unknown> | undefined;

  const normalizeHistMut = useRetiredLegacyAction();
  const normHistResult = normalizeHistMut.data as unknown as Record<string, unknown> | undefined;

  if (isLoading) return <div className="flex items-center gap-2 text-[12px] text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Загрузка покрытия идентичности…</div>;
  if (error || !data) return <div className="text-[12px] text-red-500 py-3">Ошибка. <button onClick={() => refetch()} className="underline">Повторить</button></div>;

  const d = data as unknown as Record<string, unknown>;
  const raw = (d.rawLookup as Record<string, unknown>) ?? {};
  const rec = (d.recommendation as string) ?? '?';
  const recColor = rec === 'A' ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                 : rec === 'B' ? 'text-amber-700 bg-amber-50 border-amber-200'
                 : 'text-red-700 bg-red-50 border-red-200';
  const top20 = (d.top20Unlinked as Array<Record<string, unknown>>) ?? [];
  const classSummary = (d.classificationSummary as Record<string, { customer_count: number; attendance_count: number; examples: string[] }>) ?? {};
  const rawBranchCounts = (raw.rawBranchCounts as Record<string, number>) ?? {};
  const branchesAvailable = (raw.rawBranchesAvailable as string[]) ?? [];
  const totalRawStudents = Number(raw.totalRawStudentRecords ?? 0);

  const bc = branchCov as unknown as Record<string, unknown> | undefined;
  const perBranch = (bc?.perBranch as Array<Record<string, unknown>>) ?? [];
  const bcGlobal = (bc?.global as Record<string, unknown>) ?? {};

  const clsColor = (cls: string) => {
    if (cls === 'OTHER_BRANCH_RAW_EXISTS') return 'text-amber-700';
    if (cls === 'MULTI_BRANCH_CUSTOMER') return 'text-blue-600';
    if (cls === 'ATLAS_RAW_EXISTS_NOT_NORMALIZED') return 'text-purple-600';
    if (cls === 'RAW_CUSTOMER_NOT_FOUND') return 'text-red-500';
    if (cls === 'ARCHIVED_CUSTOMER_FOUND') return 'text-indigo-600';
    if (cls === 'INACTIVE_CUSTOMER_FOUND') return 'text-orange-600';
    return 'text-gray-500';
  };

  return (
    <div className="space-y-4">
      {/* Pull Students All Branches button */}
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-gray-700">
          Raw покрытие студентов: {branchesAvailable.length} из 8 веток
          {totalRawStudents > 0 && <span className="ml-2 text-gray-400 font-normal">({totalRawStudents} raw-записей)</span>}
        </div>
        <button
          onClick={() => pullMut.mutate({})}
          disabled={pullMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {pullMut.isPending
            ? <><Loader2 className="w-3 h-3 animate-spin" />Загрузка…</>
            : <><GitBranch className="w-3 h-3" />Pull Students (все 8 веток)</>
          }
        </button>
      </div>

      {/* Per-branch raw student coverage table */}
      {(perBranch.length > 0 || branchCovLoading) && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Raw студенты по веткам (alpha_raw_records)</div>
          {branchCovLoading
            ? <div className="flex items-center gap-1 text-[11px] text-gray-400 py-2"><Loader2 className="w-3 h-3 animate-spin" />Загрузка…</div>
            : (
              <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead><tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">ID</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Ветка</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Студентов</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Записей</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Статус</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Последний sync</th>
                  </tr></thead>
                  <tbody>
                    {perBranch.map((b, i) => {
                      const ok = String(b.status) === 'available';
                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 font-mono text-gray-400">{String(b.branchId)}</td>
                          <td className="px-3 py-1.5 font-medium">{String(b.branchName)}{Number(b.branchId) === 6 && <span className="ml-1 text-violet-600 text-[9px] font-bold">ATLAS</span>}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${ok ? 'text-emerald-600' : 'text-gray-300'}`}>{ok ? Number(b.rawStudentCount).toLocaleString('ru') : '—'}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${ok ? 'text-gray-600' : 'text-gray-300'}`}>{ok ? Number(b.rawRecordCount).toLocaleString('ru') : '—'}</td>
                          <td className="px-3 py-1.5">
                            {ok
                              ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-medium"><CheckCircle2 className="w-3 h-3" />получено</span>
                              : <span className="inline-flex items-center gap-0.5 text-gray-400"><AlertCircle className="w-3 h-3" />не получено</span>
                            }
                          </td>
                          <td className="px-3 py-1.5 text-gray-400 text-[10px]">{ok ? fmtTs(String(b.latestSynced ?? '')) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {perBranch.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td colSpan={2} className="px-3 py-1.5 text-[10px] font-semibold text-gray-500">Итого</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-bold text-[11px]">{Number(bcGlobal.uniqueAlphaIds ?? 0).toLocaleString('ru')}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px]">{Number(bcGlobal.totalRawRecords ?? 0).toLocaleString('ru')}</td>
                        <td className="px-3 py-1.5 text-[10px] text-gray-500">{Number(bcGlobal.branchesWithData ?? 0)} / 8 веток</td>
                        <td className="px-3 py-1.5 text-[10px] text-gray-400">{Number(bcGlobal.multiBranchCustomers ?? 0)} multi-branch</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )
          }
        </div>
      )}

      {/* Coverage counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AuditStatCard label="Уник. customer_ids" value={Number(d.uniqueCustomerIds ?? 0)} sub="в attendance" />
        <AuditStatCard label="Привязано (ids)" value={Number(d.linkedCustomerIds ?? 0)} color="text-emerald-600" sub={`${String(d.linkedPctByCustomer ?? 0)}%`} />
        <AuditStatCard label="Не привязано (ids)" value={Number(d.unlinkedCustomerIds ?? 0)} color={Number(d.unlinkedCustomerIds ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        <AuditStatCard label="Привязано (записи)" value={Number(d.linkedAttendanceRecords ?? 0)} sub={`из ${Number(d.totalAttendanceRecords ?? 0).toLocaleString('ru')} записей`} color="text-emerald-600" />
      </div>

      {/* Raw lookup — after/before comparison */}
      <div>
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Поиск непривязанных IDs в raw-записях
          {branchesAvailable.length > 1 && <span className="ml-2 normal-case font-normal text-emerald-600">({branchesAvailable.length} веток доступно)</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <AuditStatCard label="В Atlas raw" value={Number(raw.foundInAtlasRaw ?? 0)} sub="branchId=6" color={Number(raw.foundInAtlasRaw ?? 0) > 0 ? 'text-amber-600' : 'text-gray-400'} />
          <AuditStatCard label="В др. ветвях raw" value={Number(raw.foundInOtherBranch ?? 0)} sub="other branches" color={Number(raw.foundInOtherBranch ?? 0) > 0 ? 'text-amber-600' : 'text-gray-400'} />
          <AuditStatCard label="Multi-branch" value={Number(raw.foundInMultiBranch ?? 0)} color={Number(raw.foundInMultiBranch ?? 0) > 0 ? 'text-blue-600' : 'text-gray-400'} />
          <AuditStatCard label="Не найдено в raw" value={Number(raw.notFoundInAnyRaw ?? 0)} color={Number(raw.notFoundInAnyRaw ?? 0) > 0 ? 'text-red-500' : 'text-emerald-600'} sub="ни в одной ветви" />
        </div>
        {/* Raw branch counts inline badge row */}
        {Object.keys(rawBranchCounts).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Object.entries(rawBranchCounts).map(([bid, cnt]) => (
              <span key={bid} className={`inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full font-mono border ${bid === '6' ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                b{bid}: {cnt}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Note */}
      {Boolean(raw.note) && (
        <div className="rounded-[10px] bg-gray-50 border border-gray-200 px-4 py-2 text-[11px] text-gray-600">
          ℹ️ {String(raw.note)}
        </div>
      )}

      {/* Ghost Resolution Section */}
      {(() => {
        const ghostData = (d.ghostResolution as Record<string, unknown> | undefined) ?? {};
        const resolutionRan = Boolean(ghostData.resolutionRan);
        const foundTotal = Number(ghostData.foundTotal ?? 0);
        const stillNotFound = Number(ghostData.stillNotFound ?? 0);
        const notFoundInAnyRaw = Number(raw.notFoundInAnyRaw ?? 0);
        if (notFoundInAnyRaw === 0 && !resolutionRan && !ghostResult) return null;
        return (
          <div className="rounded-[14px] border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-indigo-800">Ghost Customer Resolution (P7.4.3b)</div>
                <div className="text-[11px] text-indigo-600 mt-0.5">
                  {resolutionRan
                    ? `${foundTotal} найдено (${Number(ghostData.foundArchived ?? 0)} archived + ${Number(ghostData.foundInactive ?? 0)} inactive), ${stillNotFound} осталось`
                    : `${notFoundInAnyRaw} ghost IDs не найдено ни в одной ветке — нужно проверить архивные/неактивные профили`
                  }
                </div>
              </div>
              <button
                onClick={() => resolveGhostMut.mutate()}
                disabled={resolveGhostMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {resolveGhostMut.isPending
                  ? <><Loader2 className="w-3 h-3 animate-spin" />Запрос…</>
                  : <><RefreshCw className="w-3 h-3" />{resolutionRan ? 'Перезапустить' : 'Запустить'} Resolution</>
                }
              </button>
            </div>

            {/* Live result stats after mutation */}
            {ghostResult && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <AuditStatCard label="Ghost IDs" value={Number(ghostResult.ghostCount ?? 0)} sub="входило" />
                <AuditStatCard label="Записей сохранено" value={Number(ghostResult.rawRecordsSaved ?? 0)} color="text-indigo-600" />
                <AuditStatCard label="Найдено" value={Number((ghostResult.directLookup as Record<string, unknown> | undefined)?.found ?? 0)} color="text-emerald-600" sub="direct lookup" />
                <AuditStatCard label="Не найдено" value={Number((ghostResult.directLookup as Record<string, unknown> | undefined)?.notFound ?? 0)} color="text-red-500" sub="hard-deleted?" />
              </div>
            )}

            {/* Variant results table (from last run) */}
            {ghostResult && Array.isArray(ghostResult.variants) && (ghostResult.variants as Array<Record<string, unknown>>).length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide mb-1.5">Варианты запросов</div>
                <div className="bg-white rounded-[10px] border border-indigo-100 overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead><tr className="bg-indigo-50 border-b border-indigo-100">
                      <th className="px-2 py-1.5 text-left font-medium text-indigo-700">Вариант</th>
                      <th className="px-2 py-1.5 text-right font-medium text-indigo-700">Ghost IDs</th>
                      <th className="px-2 py-1.5 text-right font-medium text-indigo-700">Записей</th>
                      <th className="px-2 py-1.5 text-left font-medium text-indigo-700">Статус</th>
                    </tr></thead>
                    <tbody>
                      {(ghostResult.variants as Array<Record<string, unknown>>).map((v, i) => (
                        <tr key={i} className="border-t border-indigo-50">
                          <td className="px-2 py-1 font-mono text-indigo-700">{String(v.name ?? `V${i}`)}</td>
                          <td className="px-2 py-1 text-right tabular-nums font-semibold">{Number(v.ghostIdsFound ?? 0)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{Number(v.itemsFetched ?? 0)}</td>
                          <td className="px-2 py-1 text-gray-500">{String(v.paginationStatus ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Resolved note */}
            {resolutionRan && Boolean(ghostData.note) && (
              <div className="text-[11px] text-indigo-700 bg-indigo-50 rounded-[8px] px-3 py-2 border border-indigo-200">
                {String(ghostData.note)}
              </div>
            )}
            {resolutionRan && Boolean(ghostData.recommendedAction) && (
              <div className="text-[11px] text-indigo-800 font-medium">
                Следующий шаг: {String(ghostData.recommendedAction)}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── P7.4.3c: Normalize Historical Students ─────────────────────────── */}
      {(() => {
        const ib = (d.identityBreakdown as Record<string, unknown> | undefined) ?? {};
        const activeLinked    = Number(ib.activeStudentLinked    ?? 0);
        const inactiveLinked  = Number(ib.inactiveStudentLinked  ?? 0);
        const histCreated     = Number(ib.historicalIdentityCreated ?? 0);
        const stillUnresolved = Number(ib.stillUnresolved        ?? 0);
        const attIdentOnly    = Number(ib.attendanceWithIdentityOnly ?? 0);
        const attUnresolved   = Number(ib.attendanceStillUnresolved ?? 0);
        const ibNote          = String(ib.note ?? '');
        // Show section if: stillUnresolved > 0, or identityBreakdown has been populated, or normHistResult
        if (!normHistResult && activeLinked === 0 && inactiveLinked === 0 && histCreated === 0 && stillUnresolved === 0) return null;
        return (
          <div className="rounded-[14px] border border-teal-200 bg-teal-50/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-teal-800">Нормализация исторических студентов (P7.4.3c)</div>
                <div className="text-[11px] text-teal-600 mt-0.5">
                  {histCreated > 0 || (normHistResult)
                    ? `${inactiveLinked} inactive нормализовано · ${histCreated} исторических плейсхолдеров создано · ${attIdentOnly.toLocaleString('ru')} посещений identity-привязано`
                    : stillUnresolved > 0
                      ? `${stillUnresolved} ghost customer_ids требуют плейсхолдеров — запустите нормализацию`
                      : 'Запустите для создания исторических плейсхолдеров'
                  }
                </div>
              </div>
              <button
                onClick={() => normalizeHistMut.mutate()}
                disabled={normalizeHistMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {normalizeHistMut.isPending
                  ? <><Loader2 className="w-3 h-3 animate-spin" />Выполнение…</>
                  : <><RefreshCw className="w-3 h-3" />{(histCreated > 0 || normHistResult) ? 'Перезапустить' : 'Нормализовать'}</>
                }
              </button>
            </div>

            {/* Identity breakdown stat cards */}
            {(activeLinked > 0 || inactiveLinked > 0 || histCreated > 0 || normHistResult) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <AuditStatCard label="Активные студенты" value={activeLinked} color="text-emerald-600" sub={`${Number(ib.activePct ?? 0)}%`} />
                <AuditStatCard label="Inactive нормализовано" value={inactiveLinked} color="text-orange-600" sub={`${Number(ib.inactivePct ?? 0)}%`} />
                <AuditStatCard label="Исторические ID" value={histCreated} color="text-teal-600" sub={`${Number(ib.historicalPct ?? 0)}% · ${attIdentOnly.toLocaleString('ru')} посещ.`} />
                <AuditStatCard label="Не разрешено" value={stillUnresolved} color={stillUnresolved > 0 ? 'text-red-500' : 'text-emerald-600'} sub={attUnresolved > 0 ? `${attUnresolved.toLocaleString('ru')} посещ.` : ''} />
              </div>
            )}

            {/* Live mutation result */}
            {normHistResult && (() => {
              const cA = normHistResult.caseA as Record<string, unknown> | undefined;
              const cB = normHistResult.caseB as Record<string, unknown> | undefined;
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <AuditStatCard label="Case A: найдено" value={Number(cA?.rawFound ?? 0)} sub="archived raw" />
                  <AuditStatCard label="Case A: привязано" value={Number(cA?.relinked ?? 0)} color="text-orange-600" sub="attendance relinked" />
                  <AuditStatCard label="Case B: плейсхолдеров" value={Number(cB?.created ?? 0)} color="text-teal-600" sub={`+${Number(cB?.updated ?? 0)} обн.`} />
                  <AuditStatCard label="Case B: привязано" value={Number(cB?.relinked ?? 0)} color="text-teal-700" sub="identity-linked" />
                </div>
              );
            })()}

            {/* Note */}
            {Boolean(ibNote) && (
              <div className="rounded-[8px] bg-teal-50 border border-teal-200 px-3 py-2 text-[11px] text-teal-800">
                ℹ️ {ibNote}
              </div>
            )}

            {/* Historical-only warning */}
            {histCreated > 0 && (
              <div className="rounded-[8px] bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
                ⚠️ Исторические плейсхолдеры — это <strong>не полные профили студентов</strong>. Они сохраняют исторические данные посещаемости для {histCreated} клиентов, которые были <strong>безвозвратно удалены</strong> из AlphaCRM. CRM-данные недоступны.
              </div>
            )}
          </div>
        );
      })()}

      {/* Classification summary */}
      {Object.keys(classSummary).length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Классификация непривязанных customer_ids</div>
          <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">Класс</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">IDs</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Посещения</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Примеры</th>
              </tr></thead>
              <tbody>
                {Object.entries(classSummary).map(([cls, v], i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className={`px-3 py-1.5 font-mono text-[10px] font-semibold ${clsColor(cls)}`}>{cls}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{v.customer_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v.attendance_count.toLocaleString('ru')}</td>
                    <td className="px-3 py-1.5 text-gray-400 font-mono text-[10px]">{(v.examples ?? []).slice(0, 3).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recommendation */}
      <div className={`rounded-[12px] border px-4 py-3 text-[12px] ${recColor}`}>
        <div className="font-bold mb-1">Рекомендация: Вариант {rec}</div>
        <div>{String(d.recommendationReason ?? '')}</div>
      </div>

      {/* Top 20 unlinked */}
      {top20.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Топ-20 непривязанных customer_ids (по числу посещений)</div>
          <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">customer_id</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Посещ.</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Уроков</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Первый</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Последний</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Найдено в</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Класс</th>
              </tr></thead>
              <tbody>
                {top20.map((r, i) => {
                  const foundBranches = (r.raw_found_in_branches as string[]) ?? [];
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 font-mono font-bold">{String(r.customer_id)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{Number(r.attendance_count).toLocaleString('ru')}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.lesson_count)}</td>
                      <td className="px-3 py-1.5 text-gray-500">{String(r.first_lesson_date ?? '—')}</td>
                      <td className="px-3 py-1.5 text-gray-500">{String(r.last_lesson_date ?? '—')}</td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-gray-500">
                        {foundBranches.length > 0 ? foundBranches.map(b => `b${b}`).join(', ') : '—'}
                      </td>
                      <td className={`px-3 py-1.5 font-mono text-[10px] font-semibold ${clsColor(String(r.classification))}`}>{String(r.classification ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-[10px] text-gray-400 italic">
        Проблем в linking_issues: {Number(d.linkingIssuesInserted ?? 0)} · Сформировано: {fmtTs(String(d.generatedAt ?? ''))}
      </div>
    </div>
  );
}

function DuplicatesPanel({ branchId }: { branchId: string }) {
  const { data, isLoading, error, refetch } = useGetCoverageDuplicates(
    { branchId },
    { query: { queryKey: getGetCoverageDuplicatesQueryKey({ branchId }), staleTime: 30_000 } },
  );
  const detectMut = useRunDuplicateDetection();

  const handleDetect = () => {
    detectMut.mutate(
      { data: { branchId } },
      {
        onSuccess: (r) => {
          const res = r as Record<string, unknown>;
          toast.success(`Детекция завершена: ${res.inserted ?? 0} новых кандидатов`);
          refetch();
        },
        onError: () => toast.error('Ошибка детекции дубликатов'),
      },
    );
  };

  if (isLoading) return <div className="flex items-center gap-2 text-[12px] text-gray-400 py-6"><Loader2 className="w-4 h-4 animate-spin" />Загрузка дубликатов…</div>;
  if (error || !data) return <div className="text-[12px] text-red-500 py-4">Ошибка. <button onClick={() => refetch()} className="underline">Повторить</button></div>;

  const d = data as Record<string, unknown>;
  const candidates = (d.candidates as Array<Record<string, unknown>>) ?? [];
  const openByType = (d.openByType as Array<{ entity_type: string; candidate_type: string; cnt: string }>) ?? [];

  const CAND_COLOR: Record<string, string> = {
    same_name_and_phone: 'bg-red-100 text-red-700',
    same_phone: 'bg-amber-100 text-amber-700',
    child_in_multiple_families: 'bg-red-100 text-red-700',
    same_name: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1">
          <AuditStatCard label="Всего кандидатов" value={Number(d.totalCandidates ?? 0)} />
          <AuditStatCard label="Открытых (open)" value={Number(d.openCandidates ?? 0)} color={Number(d.openCandidates ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600'} />
        </div>
        <button
          onClick={handleDetect}
          disabled={detectMut.isPending}
          className="ml-4 flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-[10px] bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {detectMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          Запустить детекцию
        </button>
      </div>

      <div className="rounded-[10px] bg-amber-50 border border-amber-200 px-4 py-2 text-[11px] text-amber-700">
        ⚠️ Детекция только выявляет кандидатов. Дубликаты <strong>не объединяются автоматически</strong>. Только отчёт.
      </div>

      {openByType.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Открытые кандидаты по типу</div>
          <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-hidden">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">Entity</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Тип кандидата</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Кол-во</th>
              </tr></thead>
              <tbody>
                {openByType.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono">{row.entity_type}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CAND_COLOR[row.candidate_type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {row.candidate_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{Number(row.cnt).toLocaleString('ru')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Кандидаты (до 200)</div>
          <div className="bg-white rounded-[14px] border border-black/[0.06] overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left font-medium text-gray-500">Entity</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Тип</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">ID A</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">ID B</th>
                <th className="px-3 py-2 text-right font-medium text-gray-500">Conf.</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Причина</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Статус</th>
              </tr></thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-mono">{String(c.entity_type)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CAND_COLOR[String(c.candidate_type)] ?? 'bg-gray-100 text-gray-600'}`}>
                        {String(c.candidate_type)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{String(c.entity_a_id).slice(0, 12)}…</td>
                    <td className="px-3 py-1.5 font-mono text-gray-600">{String(c.entity_b_id).slice(0, 12)}…</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{(Number(c.confidence) * 100).toFixed(0)}%</td>
                    <td className="px-3 py-1.5 text-gray-500 max-w-[200px] truncate">{String(c.reason ?? '—')}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${c.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                        {String(c.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {candidates.length === 0 && !isLoading && (
        <div className="text-center py-8 text-[12px] text-gray-400">
          Нет кандидатов. Нажмите «Запустить детекцию» для первичного анализа.
        </div>
      )}

      <div className="text-[10px] text-gray-400 italic">Сгенерировано: {String(d.generatedAt ?? '—')}</div>
    </div>
  );
}

// ─── P7.7 Final AlphaCRM Audit Report Panel ───────────────────────────────────
function FinalAuditReportPanel({ branchId }: { branchId: string }) {
  const { data, isLoading, error, refetch } = useGetCoverageFinalAlphaAuditReport(
    { branchId },
    { query: { queryKey: getGetCoverageFinalAlphaAuditReportQueryKey({ branchId }), staleTime: 120_000 } },
  );
  const [showLimitations, setShowLimitations] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [showNextStage, setShowNextStage] = useState(true);

  const d    = data as unknown as Record<string, unknown> | undefined;
  const exec = d?.executiveSummary as Record<string, unknown> | undefined;
  const norm = d?.normalizationCoverage as Record<string, unknown> | undefined;
  const ident= d?.identityResolution as Record<string, unknown> | undefined;
  const la   = d?.lessonsAttendance as Record<string, unknown> | undefined;
  const gst  = d?.groupsSubjectsTeachers as Record<string, unknown> | undefined;
  const pay  = d?.payments as Record<string, unknown> | undefined;
  const rem  = d?.remainingIssues as Record<string, unknown> | undefined;
  const raw  = d?.rawDataCoverage as Record<string, unknown> | undefined;
  const next = d?.nextStageRecommendation as Record<string, unknown> | undefined;
  const ready= d?.readinessForNextStage as Record<string, unknown> | undefined;
  const lims = (d?.apiLimitations as Array<Record<string, unknown>> | undefined) ?? [];
  const warns= (d?.warnings as string[] | undefined) ?? [];

  const fmt    = (n: number | unknown) => Number(n).toLocaleString('ru-RU');
  const fmtRub = (n: number | unknown) => formatRubles(Number(n));

  const verdictColor = (v: string | undefined) => {
    if (!v) return 'bg-gray-100 text-gray-700';
    if (v.includes('COMPLETE') || v.includes('READY') || v === 'READY_WITH_CAVEATS') return 'bg-green-100 text-green-800';
    if (v.includes('PARTIAL')) return 'bg-amber-100 text-amber-800';
    if (v.includes('NOT_READY') || v.includes('NEEDED')) return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-700';
  };

  if (isLoading) return <div className="py-10 text-center text-gray-400 text-sm"><Loader2 className="inline animate-spin mr-1 w-4 h-4" />Загрузка финального отчёта…</div>;
  if (error)     return <div className="py-4 text-red-500 text-sm">Ошибка: {String(error)}</div>;
  if (!d)        return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] text-gray-400 font-mono">Сформирован: {String(d.generatedAt ?? '')}</div>
          <div className="text-[11px] text-gray-500">{String(d.scope ?? '')}</div>
        </div>
        <button onClick={() => void refetch()} className="text-[12px] text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Обновить
        </button>
      </div>

      {/* ── EXECUTIVE VERDICTS ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Big AlphaCRM Audit',      val: String(exec?.bigAlphaCRMAudit            ?? '') },
          { label: 'Alpha Operational Layer', val: String(exec?.alphaOperationalLayer        ?? '') },
          { label: 'Bank Reconciliation',     val: String(exec?.bankReconciliationReadiness  ?? '') },
          { label: 'Final Financial Truth',   val: String(exec?.finalFinancialTruth          ?? '') },
        ].map(({ label, val }) => (
          <div key={label} className={`rounded-xl p-3 text-center border ${verdictColor(val)}`}>
            <div className="text-[11px] font-bold tracking-wide uppercase">{val.replace(/_/g, ' ')}</div>
            <div className="text-[10px] mt-1 opacity-75">{label}</div>
          </div>
        ))}
      </div>

      {/* ── WARNINGS ── */}
      {warns.length > 0 && (
        <div className="space-y-1">
          {warns.map((w, i) => {
            const color = w.startsWith('CRITICAL') ? 'bg-red-50 border-red-200 text-red-800'
              : w.startsWith('HIGH') ? 'bg-orange-50 border-orange-200 text-orange-800'
              : w.startsWith('MEDIUM') ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-blue-50 border-blue-200 text-blue-700';
            return (
              <div key={i} className={`text-[11px] border rounded-lg px-3 py-2 ${color}`}>{w}</div>
            );
          })}
        </div>
      )}

      {/* ── NORMALIZATION COVERAGE ── */}
      {norm && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">🔬 Покрытие нормализации</div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[
              { label: 'Студенты',  val: (norm.students as Record<string,unknown>)?.active },
              { label: 'Учителя',   val: (norm.teachers as Record<string,unknown>)?.normalized },
              { label: 'Группы',    val: (norm.groups   as Record<string,unknown>)?.normalized },
              { label: 'Уроки',     val: (norm.lessons  as Record<string,unknown>)?.normalized },
              { label: 'Посещения', val: (norm.attendance as Record<string,unknown>)?.extracted },
              { label: 'Платежи',   val: (norm.payments as Record<string,unknown>)?.normalized },
            ].map(({ label, val }) => (
              <div key={label} className="text-center">
                <div className="text-[18px] font-bold text-gray-800">{fmt(val)}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-600 sm:grid-cols-4">
            <div>Студенты: <span className="font-medium text-gray-800">{fmt((norm.students as Record<string,unknown>)?.active)} active</span>, {fmt((norm.students as Record<string,unknown>)?.inactive)} inactive, {fmt((norm.students as Record<string,unknown>)?.legacyPreP7)} legacy</div>
            <div>Группы: <span className="font-medium text-gray-800">{fmt((norm.groups as Record<string,unknown>)?.withTeacher)}</span> с учителем, {fmt((norm.groups as Record<string,unknown>)?.withInferredSubject)} с предметом</div>
            <div>Уроки: <span className="font-medium text-gray-800">{String((norm.lessons as Record<string,unknown>)?.minDate ?? '').slice(0,10)}</span> → {String((norm.lessons as Record<string,unknown>)?.maxDate ?? '').slice(0,10)}</div>
            <div>Платежи: <span className="font-medium text-green-700">{fmtRub((norm.payments as Record<string,unknown>)?.incomeSum)}</span> доход</div>
          </div>
        </div>
      )}

      {/* ── IDENTITY RESOLUTION ── */}
      {ident && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">🪪 Identity Resolution</div>
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { label: 'Всего посещений',    val: ident.totalAttendanceRecords, color: 'text-gray-800' },
              { label: 'Активные студенты',  val: ident.activeAttendance,       color: 'text-green-700' },
              { label: 'Исторические',       val: ident.historicalOnlyAttendance, color: 'text-amber-700' },
              { label: 'Нерешённые',         val: ident.unresolvedAttendance,   color: Number(ident.unresolvedAttendance) === 0 ? 'text-green-600' : 'text-red-600' },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div className={`text-[18px] font-bold ${color}`}>{fmt(val)}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-gray-500 bg-amber-50 border border-amber-100 rounded p-2">
            ⚠️ 158 исторических плейсхолдеров — это НЕ активные студенты. Данные CRM для них недоступны (hard-deleted из AlphaCRM).
          </div>
        </div>
      )}

      {/* ── PAYMENTS ── */}
      {pay && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">💳 Платежи</div>
          <div className="grid grid-cols-5 gap-3 text-center mb-3">
            {[
              { label: 'Итого',         val: pay.normalized,                  color: 'text-gray-800' },
              { label: 'Доходы',        val: (pay.typeBreakdown as Record<string,unknown>)?.income,  color: 'text-green-700' },
              { label: 'Корректировки', val: (pay.typeBreakdown as Record<string,unknown>)?.correction, color: 'text-blue-700' },
              { label: 'Инкассация',    val: (pay.typeBreakdown as Record<string,unknown>)?.outcome, color: 'text-red-700' },
              { label: 'Непривяз.',     val: (pay.linking as Record<string,unknown>)?.unlinked,      color: 'text-amber-700' },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div className={`text-[16px] font-bold ${color}`}>{fmt(val)}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="bg-red-100 text-red-800 rounded px-2 py-0.5">HIGH: {fmt((pay.risk as Record<string,unknown>)?.high)}</span>
            <span className="bg-amber-100 text-amber-800 rounded px-2 py-0.5">MED: {fmt((pay.risk as Record<string,unknown>)?.medium)}</span>
            <span className="bg-green-100 text-green-800 rounded px-2 py-0.5">LOW: {fmt((pay.risk as Record<string,unknown>)?.low)}</span>
            <span className="bg-red-50 text-red-700 rounded px-2 py-0.5 border border-red-200">Инкассация: {fmt((pay.collectionRisk as Record<string,unknown>)?.count)} записей, {fmtRub((pay.collectionRisk as Record<string,unknown>)?.amountRub)}</span>
            <span className="bg-orange-50 text-orange-700 rounded px-2 py-0.5 border border-orange-200">cleanup: {String((pay as Record<string,unknown>)?.cleanupReadiness ?? 'PARTIAL')}</span>
          </div>
          <div className="mt-2 text-[10px] text-red-700 bg-red-50 border border-red-100 rounded p-2">
            {String((pay.financialTotals as Record<string,unknown>)?.warning ?? '')}
          </div>
        </div>
      )}

      {/* ── LESSONS / ATTENDANCE ── */}
      {la && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">📚 Уроки / Посещения</div>
          <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
            {[
              { label: 'Уроков',  val: la.lessonsTotal },
              { label: 'Визитов', val: la.visitsTotal  },
              { label: 'Присут.', val: la.present      },
              { label: 'Отсутств.', val: la.absent     },
              { label: 'Уваж.',   val: la.excused      },
              { label: 'Неуваж.', val: la.unexcused    },
            ].map(({ label, val }) => (
              <div key={label} className="text-center">
                <div className="text-[16px] font-bold text-gray-800">{fmt(val)}</div>
                <div className="text-[10px] text-gray-500">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-gray-500">{String(la.lessonMinDate ?? '').slice(0,10)} → {String(la.lessonMaxDate ?? '').slice(0,10)} (29 мес)</div>
        </div>
      )}

      {/* ── REMAINING ISSUES ── */}
      {rem && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-gray-800">⚠️ Оставшиеся issues ({fmt(rem.total)})</div>
            <button onClick={() => setShowIssues(!showIssues)} className="text-[11px] text-gray-500 hover:text-gray-700">{showIssues ? 'Скрыть' : 'Показать все'}</button>
          </div>
          {showIssues && (
            <div className="space-y-1.5">
              {(rem.byType as Array<Record<string,unknown>> ?? []).map((r, i) => {
                const sev = String(r.severity ?? '');
                const sevColor = sev === 'HIGH' ? 'text-red-600' : sev === 'MEDIUM' ? 'text-amber-600' : 'text-gray-500';
                return (
                  <div key={i} className="text-[11px] bg-gray-50 rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-gray-700">{String(r.issueType ?? '')}</span>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${sevColor}`}>{sev}</span>
                        <span className="text-gray-600">×{fmt(r.count)}</span>
                      </div>
                    </div>
                    <div className="text-gray-500 mt-0.5">{String(r.recommendedAction ?? '')}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── READINESS VERDICTS ── */}
      {ready && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">✅ Готовность к следующему этапу</div>
          <div className="space-y-2">
            {([
              { key: 'alphaOperationalLayer', label: 'Alpha Operational Layer' },
              { key: 'bankReconciliation',     label: 'Bank Reconciliation'     },
              { key: 'finalFinanceReports',    label: 'Final Finance Reports'   },
              { key: 'contractorLayer',        label: 'Contractor Layer'        },
            ] as Array<{ key: string; label: string }>).map(({ key, label }) => {
              const section = (ready as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
              const status  = String(section?.status ?? section?.reason ?? '');
              return (
                <div key={key} className="flex items-start gap-3">
                  <div className={`text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap mt-0.5 ${verdictColor(status)}`}>{status.replace(/_/g, ' ')}</div>
                  <div>
                    <div className="text-[11px] font-medium text-gray-700">{label}</div>
                    <div className="text-[10px] text-gray-500">{String(section?.details ?? section?.reason ?? '')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── NEXT STAGE ── */}
      {next && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-semibold text-violet-800">🚀 Следующий этап: {String(next.stage ?? '')}</div>
            <button onClick={() => setShowNextStage(!showNextStage)} className="text-[11px] text-violet-600 hover:text-violet-800">{showNextStage ? 'Свернуть' : 'Развернуть'}</button>
          </div>
          {showNextStage && (
            <>
              <div className="text-[11px] text-violet-700 mb-3">{String(next.rationale ?? '')}</div>
              <div className="space-y-1">
                {(next.tasks as string[] | undefined ?? []).map((t, i) => (
                  <div key={i} className="text-[11px] text-violet-800 flex items-start gap-1.5">
                    <span className="text-violet-400 mt-0.5">→</span>{t}
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1">
                {(next.doNotDo as string[] | undefined ?? []).map((t, i) => (
                  <div key={i} className="text-[11px] text-gray-500 flex items-start gap-1.5">
                    <span className="text-red-400 mt-0.5">✕</span>{t}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── RAW COVERAGE ── */}
      {raw && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-semibold text-gray-800">📦 Raw покрытие AlphaCRM</div>
            <button onClick={() => setShowRaw(!showRaw)} className="text-[11px] text-gray-500 hover:text-gray-700">{showRaw ? 'Скрыть' : 'Показать'}</button>
          </div>
          {showRaw && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {(raw.entities as Array<Record<string,unknown>> | undefined ?? []).map((r, i) => (
                  <div key={i} className="text-[11px] bg-gray-50 rounded px-2 py-1 flex justify-between">
                    <span className="font-mono text-gray-700">{String(r.entity_type ?? '')}</span>
                    <span className="text-gray-600 font-semibold">{fmt(r.cnt)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium text-gray-700 mb-1">❌ Недоступные endpoints</div>
                  <button onClick={() => setShowLimitations(!showLimitations)} className="text-[11px] text-gray-500 hover:text-gray-700">{showLimitations ? 'Скрыть' : 'Ограничения API'}</button>
                </div>
                {(raw.unavailableEndpoints as Array<Record<string,unknown>> | undefined ?? []).map((r, i) => (
                  <div key={i} className="text-[10px] text-gray-500 flex gap-2">
                    <span className="font-mono text-red-500">{String(r.endpoint ?? '')}</span>
                    <span className="bg-gray-100 rounded px-1">{String(r.status ?? '')}</span>
                    <span>{String(r.note ?? '')}</span>
                  </div>
                ))}
                {showLimitations && lims.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {lims.map((l, i) => {
                      const sevColor = l.severity === 'CRITICAL' ? 'text-red-600' : l.severity === 'MISSING' ? 'text-amber-600' : 'text-gray-500';
                      return (
                        <div key={i} className="text-[10px] bg-amber-50 border border-amber-100 rounded p-1.5">
                          <span className={`font-mono font-semibold ${sevColor}`}>[{String(l.severity ?? '')}] {String(l.key ?? '')}:</span>
                          <span className="text-gray-600 ml-1">{String(l.description ?? '')}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── GST ── */}
      {gst && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[13px] font-semibold text-gray-800 mb-3">👥 Группы / Предметы / Учителя</div>
          <div className="grid grid-cols-3 gap-4 text-[11px]">
            <div>
              <div className="font-medium text-gray-700 mb-1">Учителя</div>
              <div>Нормализовано: <span className="font-bold">{fmt((gst.teachers as Record<string,unknown>)?.normalized)}</span></div>
              <div>Активных: <span className="font-bold text-green-700">{fmt((gst.teachers as Record<string,unknown>)?.active)}</span></div>
            </div>
            <div>
              <div className="font-medium text-gray-700 mb-1">Группы</div>
              <div>Всего: <span className="font-bold">{fmt((gst.groups as Record<string,unknown>)?.normalized)}</span></div>
              <div>С учителем: <span className="font-bold">{fmt((gst.groups as Record<string,unknown>)?.withTeacher)}</span></div>
              <div>С предметом: <span className="font-bold">{fmt((gst.groups as Record<string,unknown>)?.withInferredSubject)}</span></div>
            </div>
            <div>
              <div className="font-medium text-gray-700 mb-1">Предметы</div>
              <div>Всего: <span className="font-bold">{fmt((gst.subjects as Record<string,unknown>)?.totalResolved)}</span></div>
              <div>Реф. уроками: <span className="font-bold">{fmt((gst.subjects as Record<string,unknown>)?.referencedByLessons)}</span></div>
              <div>Нерешённых: <span className="font-bold text-green-700">{fmt((gst.subjects as Record<string,unknown>)?.unresolvedForP7Lessons)}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── P8.1 Bank Accounts Panel ────────────────────────────────────────────────

function BankReadinessBadge({ value }: { value?: string }) {
  if (!value) return null;
  const map: Record<string, string> = {
    READY:              'bg-green-100 text-green-800',
    PARTIAL:            'bg-yellow-100 text-yellow-700',
    NOT_READY:          'bg-red-100 text-red-700',
    NOT_APPLICABLE_DEV: 'bg-gray-100 text-gray-600',
  };
  const icon =
    value === 'READY'              ? '✅' :
    value === 'PARTIAL'            ? '⚠️' :
    value === 'NOT_APPLICABLE_DEV' ? 'ℹ️' : '🔴';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[value] ?? 'bg-gray-100 text-gray-600'}`}>
      {icon} {value}
    </span>
  );
}

function IssueSeverityBadge({ severity }: { severity?: string }) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-800',
    HIGH:     'bg-orange-100 text-orange-700',
    MEDIUM:   'bg-yellow-100 text-yellow-700',
    LOW:      'bg-gray-100 text-gray-500',
    INFO:     'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${map[severity ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
      {severity}
    </span>
  );
}

function ConnectorStatusBadge({ status }: { status?: string }) {
  const map: Record<string, string> = {
    active:    'bg-green-100 text-green-800',
    inactive:  'bg-gray-100 text-gray-500',
    error:     'bg-red-100 text-red-700',
    not_configured: 'bg-gray-100 text-gray-400',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
      {status ?? 'unknown'}
    </span>
  );
}

function BankAccountsPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useGetCoverageBankAccountsAudit(
    { query: { queryKey: getGetCoverageBankAccountsAuditQueryKey(), staleTime: 60_000 } },
  );

  if (isLoading) return <div className="flex items-center gap-2 text-[13px] text-gray-500 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Загружаем банковский аудит…</div>;
  if (isError || !data) return <div className="text-red-500 text-[13px] py-4">Ошибка загрузки /coverage/bank-accounts-audit</div>;

  const d = data as {
    generatedAt?: string;
    environment?: { nodeEnv?: string; dbName?: string; isProduction?: boolean; dbKind?: string; bankIntegrationExpected?: boolean; auditValidity?: string; environmentWarning?: string | null };
    connectors?: Array<{ id?: string; bankName?: string; displayName?: string; status?: string; authType?: string; lastSyncAt?: string | null; lastSuccessAt?: string | null; lastError?: string | null; accountsImported?: number; authIssue?: boolean }>;
    sourceConnectors?: Array<{ source_name?: string; source_type?: string; status?: string; last_sync_at?: string | null }>;
    summary?: { totalConnectors?: number; activeConnectors?: number; errorConnectors?: number; totalAccounts?: number; totalRawTransactions?: number; totalNormalizedTransactions?: number; totalStatements?: number; totalOperations?: number; balanceByCurrency?: Record<string,number>; duplicateCandidates?: number };
    accounts?: Array<{ internalAccountId?: string; externalAccountId?: string | null; bankName?: string | null; accountName?: string | null; maskedAccountNumber?: string | null; currency?: string | null; currentBalance?: number | null; availableBalance?: number | null; accountStatus?: string | null; hasBalance?: boolean; balanceStale?: boolean; transactionsCount?: number; firstTransactionDate?: string | null; lastTransactionDate?: string | null; statementsCount?: number; legalEntityName?: string | null; ownerStatus?: string; duplicateCandidate?: boolean; missingCriticalFields?: string[]; auditStatus?: string }>;
    duplicateCandidates?: Array<{ reason?: string; affectedIds?: string[]; severity?: string; suggestedAction?: string }>;
    otherFinanceData?: { operations?: { count?: number; minDate?: string | null; maxDate?: string | null; note?: string }; bankTransactionsRaw?: { count?: number; note?: string }; bankTransactionsNormalized?: { count?: number; minDate?: string | null; maxDate?: string | null } };
    issues?: Array<{ issueType?: string; severity?: string; count?: number; description?: string; recommendedAction?: string }>;
    issueSummary?: { total?: number; critical?: number; high?: number; medium?: number; low?: number };
    bankAccountsReadiness?: string;
    readinessReason?: string;
    nextRecommendedStep?: string;
    warnings?: string[];
  };

  const env     = d.environment ?? {};
  const summary = d.summary ?? {};
  const issues  = d.issues ?? [];

  return (
    <div className="space-y-5 text-[13px]">
      {/* Refetch */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-400">Сгенерировано: {d.generatedAt ? new Date(d.generatedAt).toLocaleString('ru-RU') : '—'}</div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-[12px] font-medium hover:bg-violet-100 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      {/* Environment banner */}
      {env.auditValidity === 'NOT_VALID_DEV' ? (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold text-red-800 text-[14px]">🚫 BANK AUDIT NOT VALID IN DEV</div>
              <div className="text-red-700 mt-1">
                Банковская интеграция (Точка, счета, транзакции) существует <strong>только в продакшн</strong>. Текущая база данных — dev/staging.
              </div>
              <div className="mt-2 space-y-1 text-[12px] text-red-600">
                <div>• Отсутствие банковских счетов в dev — это <strong>ожидаемо</strong>, не ошибка</div>
                <div>• Ошибка коннектора Точки в dev — <strong>не указывает</strong> на проблему в продакшн</div>
                <div>• <strong>Не</strong> запускай OAuth flow и не меняй токены в dev</div>
              </div>
              <div className="mt-3 bg-white border border-red-200 rounded px-3 py-2 text-[12px] font-semibold text-red-700">
                → Для реального аудита запусти P8.1 против production базы данных / окружения
              </div>
              <div className="text-[11px] text-red-500 mt-2">
                NODE_ENV: <span className="font-mono">{env.nodeEnv}</span> · DB: <span className="font-mono">{env.dbName}</span> · dbKind: <span className="font-mono">{env.dbKind}</span>
              </div>
            </div>
          </div>
        </div>
      ) : !env.isProduction ? (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-amber-800">Не продакшн</div>
            <div className="text-amber-700 mt-0.5">{env.environmentWarning ?? 'Текущая база данных — dev/staging.'}</div>
            <div className="text-[11px] text-amber-600 mt-1">NODE_ENV: <span className="font-mono">{env.nodeEnv}</span> · DB: <span className="font-mono">{env.dbName}</span></div>
          </div>
        </div>
      ) : null}

      {/* Readiness verdict */}
      <div className={`border rounded-lg p-4 ${d.bankAccountsReadiness === 'NOT_APPLICABLE_DEV' ? 'border-gray-200 bg-gray-50' : 'border-gray-200'}`}>
        <div className="flex items-center gap-3 mb-2">
          <span className="font-semibold text-gray-800">Готовность P8.1</span>
          <BankReadinessBadge value={d.bankAccountsReadiness} />
        </div>
        <div className="text-gray-600 mb-2">{d.readinessReason}</div>
        {d.nextRecommendedStep && (
          <div className={`text-[12px] rounded px-2 py-1 ${d.bankAccountsReadiness === 'NOT_APPLICABLE_DEV' ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-700'}`}>
            {d.bankAccountsReadiness === 'NOT_APPLICABLE_DEV' ? '→' : 'Следующий шаг:'} {d.nextRecommendedStep}
          </div>
        )}
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Коннекторов', value: summary.totalConnectors ?? 0, sub: `${summary.activeConnectors ?? 0} active / ${summary.errorConnectors ?? 0} error` },
          { label: 'Банк. счетов', value: summary.totalAccounts ?? 0, sub: 'bank_accounts' },
          { label: 'Транзакций (raw)', value: summary.totalRawTransactions ?? 0, sub: 'bank_transactions_raw' },
          { label: 'Операций', value: summary.totalOperations ?? 0, sub: 'operations (ручные)' },
        ].map(s => (
          <div key={s.label} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <div className="text-[22px] font-bold text-gray-900">{s.value.toLocaleString('ru-RU')}</div>
            <div className="text-[12px] font-medium text-gray-700">{s.label}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Connectors */}
      <div>
        <div className="text-[12px] font-semibold text-gray-700 mb-2">Банковские коннекторы</div>
        {(d.connectors ?? []).length === 0
          ? <div className="text-gray-400 italic">Нет коннекторов</div>
          : (d.connectors ?? []).map(c => (
            <div key={c.id} className="border border-gray-100 rounded-lg p-3 mb-2">
              <div className="flex items-center gap-2 mb-1">
                <HardDrive className="w-3.5 h-3.5 text-gray-500" />
                <span className="font-semibold">{c.displayName ?? c.bankName}</span>
                <ConnectorStatusBadge status={c.status ?? undefined} />
                <span className="text-[11px] text-gray-400">{c.authType}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-gray-500 mt-1">
                <div>Счетов импортировано: <b>{c.accountsImported ?? 0}</b></div>
                <div>Последняя синх.: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString('ru-RU') : '—'}</div>
                <div>Последний успех: {c.lastSuccessAt ? new Date(c.lastSuccessAt).toLocaleString('ru-RU') : <span className="text-red-500">никогда</span>}</div>
              </div>
              {c.lastError && (
                <div className="mt-2 bg-red-50 border border-red-100 rounded p-2 text-[11px] text-red-700">
                  <span className="font-semibold">Ошибка:</span> {c.lastError}
                </div>
              )}
            </div>
          ))
        }
      </div>

      {/* Bank accounts list */}
      <div>
        <div className="text-[12px] font-semibold text-gray-700 mb-2">Банковские счета ({(d.accounts ?? []).length})</div>
        {(d.accounts ?? []).length === 0 ? (
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-center text-gray-500">
            <HardDrive className="w-6 h-6 mx-auto mb-1 text-gray-300" />
            <div className="font-medium">Банковские счета не импортированы</div>
            <div className="text-[12px] mt-1 text-gray-400">Коннектор Точки не завершил OAuth flow. После авторизации счета появятся здесь.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] text-gray-400">
                  <th className="pb-1.5 pr-3">Счёт</th>
                  <th className="pb-1.5 pr-3">Банк</th>
                  <th className="pb-1.5 pr-3">Валюта</th>
                  <th className="pb-1.5 pr-3">Баланс</th>
                  <th className="pb-1.5 pr-3">Транзакции</th>
                  <th className="pb-1.5 pr-3">Владелец</th>
                  <th className="pb-1.5">Статус</th>
                </tr>
              </thead>
              <tbody>
                {(d.accounts ?? []).map(acc => (
                  <tr key={acc.internalAccountId} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-3 font-mono">{acc.maskedAccountNumber ?? acc.externalAccountId ?? '—'}</td>
                    <td className="py-1.5 pr-3">{acc.bankName ?? '—'}</td>
                    <td className="py-1.5 pr-3">{acc.currency ?? '—'}</td>
                    <td className="py-1.5 pr-3">{acc.currentBalance !== null ? acc.currentBalance?.toLocaleString('ru-RU') : <span className="text-gray-300">—</span>}</td>
                    <td className="py-1.5 pr-3">{acc.transactionsCount ?? 0}</td>
                    <td className="py-1.5 pr-3">{acc.legalEntityName ?? <span className="text-gray-300 italic">неизвестен</span>}</td>
                    <td className="py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        acc.auditStatus === 'OK' ? 'bg-green-100 text-green-700' :
                        acc.auditStatus === 'WARNING' ? 'bg-yellow-100 text-yellow-700' :
                        acc.auditStatus === 'ERROR' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>{acc.auditStatus}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Duplicate candidates */}
      {(d.duplicateCandidates ?? []).length > 0 && (
        <div>
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Дубликаты ({d.duplicateCandidates?.length})</div>
          {d.duplicateCandidates?.map((dup, i) => (
            <div key={i} className="border border-orange-100 bg-orange-50 rounded p-2.5 mb-1.5">
              <div className="flex items-center gap-2">
                <IssueSeverityBadge severity={dup.severity} />
                <span>{dup.reason}</span>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">{dup.suggestedAction}</div>
            </div>
          ))}
        </div>
      )}

      {/* Finance data overview */}
      <div>
        <div className="text-[12px] font-semibold text-gray-700 mb-2">Прочие финансовые данные</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { title: 'bank_transactions_raw', count: d.otherFinanceData?.bankTransactionsRaw?.count ?? 0, note: d.otherFinanceData?.bankTransactionsRaw?.note },
            { title: 'bank_transactions (norm)', count: d.otherFinanceData?.bankTransactionsNormalized?.count ?? 0, note: `${d.otherFinanceData?.bankTransactionsNormalized?.minDate ?? '?'} → ${d.otherFinanceData?.bankTransactionsNormalized?.maxDate ?? '?'}` },
            { title: 'operations', count: d.otherFinanceData?.operations?.count ?? 0, note: d.otherFinanceData?.operations?.note },
          ].map(s => (
            <div key={s.title} className="bg-gray-50 rounded-lg border border-gray-100 p-3">
              <div className="font-mono text-[11px] text-gray-500 mb-0.5">{s.title}</div>
              <div className="text-[20px] font-bold text-gray-800">{s.count.toLocaleString('ru-RU')}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{s.note}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Source connectors */}
      <div>
        <div className="text-[12px] font-semibold text-gray-700 mb-2">Source connectors</div>
        <div className="flex flex-wrap gap-2">
          {(d.sourceConnectors ?? []).map(sc => (
            <div key={sc.source_name} className="flex items-center gap-1.5 border border-gray-100 rounded-lg px-2.5 py-1.5 bg-gray-50">
              <ConnectorStatusBadge status={sc.status} />
              <span className="font-medium text-[12px]">{sc.source_name}</span>
              <span className="text-[10px] text-gray-400">{sc.source_type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Issues */}
      <div>
        <div className="text-[12px] font-semibold text-gray-700 mb-2">
          Проблемы
          {d.issueSummary?.critical ? <span className="ml-2 text-red-700 font-bold">● {d.issueSummary.critical} CRITICAL</span> : null}
          {(d.issueSummary?.high ?? 0) > 0 ? <span className="ml-2 text-orange-600">● {d.issueSummary?.high} HIGH</span> : null}
        </div>
        {issues.length === 0
          ? <div className="text-gray-400 italic">Нет проблем</div>
          : issues.map((iss, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3 mb-2">
              <div className="flex items-center gap-2 mb-1">
                <IssueSeverityBadge severity={iss.severity} />
                <span className="font-mono text-[11px] text-gray-500">{iss.issueType}</span>
              </div>
              <div className="text-gray-700 mb-0.5">{iss.description}</div>
              <div className="text-[12px] text-blue-600">→ {iss.recommendedAction}</div>
            </div>
          ))
        }
      </div>

      {/* Warnings */}
      {(d.warnings ?? []).length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-amber-700 mb-1.5">Важные замечания</div>
          {d.warnings?.map((w, i) => (
            <div key={i} className="text-[12px] text-amber-700 mb-0.5">{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── P8.2 Bank Transactions Panel ────────────────────────────────────────────

function CoveragePct({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round(value / total * 100) : 0;
  const color = pct === 100 ? 'text-green-700' : pct >= 80 ? 'text-yellow-700' : 'text-red-700';
  return <span className={`font-mono text-[11px] ${color}`}>{pct}%</span>;
}

function GapBadge({ verdict }: { verdict?: string }) {
  if (!verdict) return null;
  const map: Record<string, string> = {
    EXPLAINED:            'bg-green-100 text-green-800',
    PARTIALLY_EXPLAINED:  'bg-yellow-100 text-yellow-700',
    UNEXPLAINED:          'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[verdict] ?? 'bg-gray-100 text-gray-500'}`}>
      {verdict}
    </span>
  );
}

function BankTransactionsPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useGetCoverageBankTransactionsAudit(
    { query: { queryKey: getGetCoverageBankTransactionsAuditQueryKey(), staleTime: 60_000 } },
  );

  if (isLoading) return <div className="flex items-center gap-2 text-[13px] text-gray-500 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Загружаем аудит транзакций…</div>;
  if (isError || !data) return <div className="text-red-500 text-[13px] py-4">Ошибка загрузки /coverage/bank-transactions-audit</div>;

  const d = data as {
    auditType?: string; generatedAt?: string;
    environment?: { dbKind?: string; auditValidity?: string; isProduction?: boolean; dbName?: string; nodeEnv?: string };
    rawTransactions?: { total?: number; uniqueExtIds?: number; hasExtId?: number; hasOperationDate?: number; missingOperationDate?: number; hasRawJson?: number; hasAmount?: number; hasDirection?: number; hasCounterpartyName?: number; hasCounterpartyInn?: number; hasPurpose?: number; normalizedStatusBreakdown?: { pending?: number; normalized?: number; skipped?: number; error?: number }; normBookkeepingGap?: boolean; normBookkeepingGapNote?: string | null };
    dateFieldInventory?: { documentProcessDate?: { present?: number; total?: number; coveragePct?: number; minDate?: string | null; maxDate?: string | null; isReliable?: boolean }; operationDateColumn?: { present?: number; missing?: number; total?: number; coveragePct?: number }; normalizedTableDateStatus?: string; rootCause?: string; rootCauseDetail?: string };
    normalizedTransactions?: { total?: number; dateRange?: { min?: string | null; max?: string | null }; hasOperationDate?: number; hasAmount?: number; hasDirection?: number; hasCounterpartyName?: number; hasCounterpartyInn?: number; hasPurpose?: number; hasExtId?: number; hasCounterpartyAccount?: number; hasAccountId?: number; matchStatus?: { unmatched?: number; matched?: number } };
    rawNormalizedGap?: { rawTotal?: number; normalizedTotal?: number; gap?: number; classification?: { trueDuplicates?: number; crossAccountTransfers?: number; unexplained?: number }; verdict?: string; trueDuplicatesNote?: string; crossAccountNote?: string };
    perAccountCoverage?: Array<{ accountId?: string; maskedAccount?: string; rawCount?: number; normalizedCount?: number; rawNotNormalized?: number; rawDateFrom?: string | null; rawDateTo?: string | null; rawMissingOpDate?: number; normalizedDateFrom?: string | null; normalizedDateTo?: string | null; incomeSum?: number; expenseSum?: number; incomeCnt?: number; expenseCnt?: number }>;
    duplicates?: { rawDuplicates?: { count?: number; examples?: Array<{ externalTransactionId?: string; accountId?: string; occurrences?: number }> }; normalizedDuplicates?: { count?: number; note?: string } };
    counterpartyReadiness?: { uniqueCounterpartyNames?: number; uniqueCounterpartyInns?: number; uniqueCounterpartyAccounts?: number; incomeTransactions?: number; expenseTransactions?: number; missingCounterparty?: number; topIncomeCounterparties?: Array<{ name?: string; inn?: string; count?: number; totalSum?: number }>; topExpenseCounterparties?: Array<{ name?: string; inn?: string; count?: number; totalSum?: number }>; counterpartyLayerReadiness?: string; caveats?: string[] };
    operations?: { total?: number; linkedBankTx?: number; uniqueSources?: number; dateRange?: { min?: string | null; max?: string | null }; note?: string; devProductionDifference?: string };
    statementsPerAccount?: Array<{ externalAccountId?: string; statementCount?: number; periodFrom?: string; periodTo?: string; totalTransactions?: number; readyCount?: number }>;
    issues?: Array<{ issueType?: string; severity?: string; count?: number; description?: string; recommendedAction?: string }>;
    issueSummary?: { total?: number; critical?: number; high?: number; medium?: number; low?: number; info?: number };
    bankTransactionsReadiness?: string;
    readinessReason?: string;
    nextRecommendedStep?: string;
    p83CanStart?: boolean;
    p83Blockers?: string[];
    warnings?: string[];
  };

  const env    = d.environment ?? {};
  const raw    = d.rawTransactions ?? {};
  const norm   = d.normalizedTransactions ?? {};
  const gap    = d.rawNormalizedGap ?? {};
  const cp     = d.counterpartyReadiness ?? {};
  const issues = d.issues ?? [];

  if (env.auditValidity === 'BANK_TRANSACTION_AUDIT_NOT_VALID_OUTSIDE_PRODUCTION') {
    return (
      <div className="space-y-4 text-[13px]">
        <div className="border border-red-200 bg-red-50 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold text-red-800 text-[14px]">🚫 P8.2 NOT VALID IN DEV</div>
              <div className="text-red-700 mt-1">Bank transaction data exists only in production. Current environment is dev/staging.</div>
              <div className="text-[11px] text-red-500 mt-2 font-mono">NODE_ENV: {env.nodeEnv} · DB: {env.dbName}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-[13px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-400">Сгенерировано: {d.generatedAt ? new Date(d.generatedAt).toLocaleString('ru-RU') : '—'}</div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-[12px] font-medium hover:bg-violet-100 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Обновить
        </button>
      </div>

      {/* Readiness verdict */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="font-semibold text-gray-800">Готовность P8.2</span>
          <BankReadinessBadge value={d.bankTransactionsReadiness} />
          {d.p83CanStart && <span className="text-[11px] bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-semibold">→ P8.3 можно начинать</span>}
        </div>
        <div className="text-gray-600 mb-2">{d.readinessReason}</div>
        {d.nextRecommendedStep && (
          <div className="text-[12px] bg-blue-50 text-blue-700 rounded px-2 py-1">Следующий шаг: {d.nextRecommendedStep}</div>
        )}
        {(d.p83Blockers ?? []).length > 0 && (
          <div className="mt-2 space-y-1">
            {d.p83Blockers!.map((b, i) => <div key={i} className="text-[12px] text-red-700 bg-red-50 rounded px-2 py-1">🔴 {b}</div>)}
          </div>
        )}
      </div>

      {/* Top-level counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Raw транзакций', value: raw.total ?? 0, sub: 'bank_transactions_raw' },
          { label: 'Нормализовано', value: norm.total ?? 0, sub: `${norm.dateRange?.min ?? '?'} → ${norm.dateRange?.max ?? '?'}` },
          { label: 'Разрыв (gap)', value: gap.gap ?? 0, sub: gap.verdict ? `${gap.verdict}` : '—', warn: (gap.classification?.unexplained ?? 0) > 0 },
          { label: 'Контрагентов', value: cp.uniqueCounterpartyNames ?? 0, sub: `${cp.uniqueCounterpartyInns ?? 0} ИНН · ${cp.uniqueCounterpartyAccounts ?? 0} счетов` },
        ].map(s => (
          <div key={s.label} className={`rounded-lg p-3 border ${s.warn ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
            <div className={`text-[22px] font-bold ${s.warn ? 'text-red-700' : 'text-gray-900'}`}>{s.value.toLocaleString('ru-RU')}</div>
            <div className="text-[12px] font-medium text-gray-700">{s.label}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Gap analysis */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-semibold text-gray-800 text-[13px]">Raw → Normalized Gap Analysis</span>
          <GapBadge verdict={gap.verdict} />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {[
            { label: 'Raw total', value: gap.rawTotal ?? 0 },
            { label: 'Normalized', value: gap.normalizedTotal ?? 0 },
            { label: 'Gap', value: gap.gap ?? 0, warn: true },
          ].map(s => (
            <div key={s.label} className={`rounded p-2 text-center ${s.warn && s.value > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-gray-50 border border-gray-100'}`}>
              <div className={`text-[18px] font-bold ${s.warn && s.value > 0 ? 'text-orange-700' : 'text-gray-800'}`}>{s.value}</div>
              <div className="text-[11px] text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-start gap-2 text-[12px]">
            <span className="text-green-600 font-semibold shrink-0">✅ Истинные дубликаты:</span>
            <span className="text-gray-700">{gap.classification?.trueDuplicates ?? 0} записей — {gap.trueDuplicatesNote}</span>
          </div>
          <div className="flex items-start gap-2 text-[12px]">
            <span className="text-blue-600 font-semibold shrink-0">ℹ️ Кросс-счетовые:</span>
            <span className="text-gray-700">{gap.classification?.crossAccountTransfers ?? 0} записей — {gap.crossAccountNote}</span>
          </div>
          {(gap.classification?.unexplained ?? 0) > 0 && (
            <div className="flex items-start gap-2 text-[12px]">
              <span className="text-red-600 font-semibold shrink-0">🔴 Необъяснённые:</span>
              <span className="text-gray-700">{gap.classification?.unexplained} записей — требуется расследование</span>
            </div>
          )}
        </div>
      </div>

      {/* Date field inventory */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-gray-800 text-[13px] mb-3">📅 Инвентарь полей дат (bank_transactions_raw)</div>
        <div className="space-y-2 mb-3">
          {[
            { label: 'raw_json→documentProcessDate', present: d.dateFieldInventory?.documentProcessDate?.present ?? 0, total: raw.total ?? 0, note: `${d.dateFieldInventory?.documentProcessDate?.minDate ?? '?'} → ${d.dateFieldInventory?.documentProcessDate?.maxDate ?? '?'}`, reliable: d.dateFieldInventory?.documentProcessDate?.isReliable },
            { label: 'operation_date (колонка)', present: d.dateFieldInventory?.operationDateColumn?.present ?? 0, total: raw.total ?? 0, note: `${d.dateFieldInventory?.operationDateColumn?.missing ?? 0} пустых` },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3">
              <div className="font-mono text-[11px] text-gray-600 w-64 shrink-0">{f.label}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className={`h-2 rounded-full ${f.reliable ? 'bg-green-400' : 'bg-yellow-400'}`} style={{ width: `${f.total > 0 ? Math.round(f.present / f.total * 100) : 0}%` }} />
              </div>
              <CoveragePct value={f.present} total={f.total} />
              <div className="text-[10px] text-gray-400 w-32 shrink-0">{f.note}</div>
            </div>
          ))}
        </div>
        <div className={`rounded p-3 text-[12px] ${d.dateFieldInventory?.rootCause === 'documentProcessDate_in_raw_json' ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <div className="font-semibold mb-1">Корневая причина: <code className="font-mono">{d.dateFieldInventory?.rootCause}</code></div>
          <div className="text-gray-700">{d.dateFieldInventory?.rootCauseDetail}</div>
          <div className="mt-1 text-[11px] text-gray-500">Normalized table: <span className={`font-semibold ${d.dateFieldInventory?.normalizedTableDateStatus === 'complete' ? 'text-green-700' : 'text-yellow-700'}`}>{d.dateFieldInventory?.normalizedTableDateStatus?.toUpperCase()}</span> — все {norm.total} нормализованных имеют operation_date</div>
        </div>
      </div>

      {/* Field quality tables */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Raw field quality */}
        <div className="border border-gray-200 rounded-lg p-3">
          <div className="font-semibold text-[12px] text-gray-700 mb-2">Качество полей: bank_transactions_raw ({raw.total ?? 0})</div>
          <table className="w-full text-[11px]">
            <tbody>
              {([
                ['external_id', raw.hasExtId],
                ['operation_date', raw.hasOperationDate],
                ['amount', raw.hasAmount],
                ['direction', raw.hasDirection],
                ['counterparty_name', raw.hasCounterpartyName],
                ['counterparty_inn', raw.hasCounterpartyInn],
                ['purpose', raw.hasPurpose],
                ['raw_json', raw.hasRawJson],
              ] as [string, number | undefined][]).map(([field, val]) => (
                <tr key={field} className="border-b border-gray-50">
                  <td className="py-0.5 font-mono text-gray-500 pr-2">{field}</td>
                  <td className="py-0.5 text-right pr-2">{(val ?? 0).toLocaleString('ru-RU')}</td>
                  <td className="py-0.5 text-right"><CoveragePct value={val ?? 0} total={raw.total ?? 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {raw.normBookkeepingGap && (
            <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded p-2 text-[11px] text-yellow-800">
              ⚠️ normalized_status = 'pending' для всех записей. {raw.normBookkeepingGapNote}
            </div>
          )}
        </div>

        {/* Normalized field quality */}
        <div className="border border-gray-200 rounded-lg p-3">
          <div className="font-semibold text-[12px] text-gray-700 mb-2">Качество полей: bank_transactions ({norm.total ?? 0})</div>
          <table className="w-full text-[11px]">
            <tbody>
              {([
                ['operation_date', norm.hasOperationDate],
                ['amount', norm.hasAmount],
                ['direction', norm.hasDirection],
                ['counterparty_name', norm.hasCounterpartyName],
                ['counterparty_inn', norm.hasCounterpartyInn],
                ['purpose', norm.hasPurpose],
                ['external_id', norm.hasExtId],
                ['counterparty_account', norm.hasCounterpartyAccount],
                ['account_id', norm.hasAccountId],
              ] as [string, number | undefined][]).map(([field, val]) => (
                <tr key={field} className="border-b border-gray-50">
                  <td className="py-0.5 font-mono text-gray-500 pr-2">{field}</td>
                  <td className="py-0.5 text-right pr-2">{(val ?? 0).toLocaleString('ru-RU')}</td>
                  <td className="py-0.5 text-right"><CoveragePct value={val ?? 0} total={norm.total ?? 0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] text-gray-500">
            match_status: <span className="font-semibold text-orange-700">{norm.matchStatus?.unmatched ?? 0}</span> unmatched · <span className="font-semibold text-green-700">{norm.matchStatus?.matched ?? 0}</span> matched
          </div>
        </div>
      </div>

      {/* Per-account coverage */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-gray-800 text-[13px] mb-3">📊 Покрытие по счетам</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[10px] text-gray-400">
                <th className="pb-1.5 pr-3">Счёт</th>
                <th className="pb-1.5 pr-3 text-right">Raw</th>
                <th className="pb-1.5 pr-3 text-right">Norm</th>
                <th className="pb-1.5 pr-3 text-right">Gap</th>
                <th className="pb-1.5 pr-3">Период (raw_json)</th>
                <th className="pb-1.5 pr-3">Период (norm)</th>
                <th className="pb-1.5 pr-3 text-right">Income</th>
                <th className="pb-1.5 text-right">Expense</th>
              </tr>
            </thead>
            <tbody>
              {(d.perAccountCoverage ?? []).map(acc => (
                <tr key={acc.accountId} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 pr-3 font-mono font-semibold">{acc.maskedAccount ?? acc.accountId}</td>
                  <td className="py-1.5 pr-3 text-right">{acc.rawCount?.toLocaleString('ru-RU')}</td>
                  <td className="py-1.5 pr-3 text-right">{acc.normalizedCount?.toLocaleString('ru-RU')}</td>
                  <td className={`py-1.5 pr-3 text-right font-semibold ${(acc.rawNotNormalized ?? 0) > 0 ? 'text-orange-600' : 'text-green-600'}`}>{acc.rawNotNormalized ?? 0}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{acc.rawDateFrom ?? '?'} → {acc.rawDateTo ?? '?'}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{acc.normalizedDateFrom ?? '?'} → {acc.normalizedDateTo ?? '?'}</td>
                  <td className="py-1.5 pr-3 text-right text-green-700">{acc.incomeSum != null ? acc.incomeSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—'}</td>
                  <td className="py-1.5 text-right text-red-700">{acc.expenseSum != null ? acc.expenseSum.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Counterparty readiness */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-semibold text-gray-800 text-[13px]">Готовность контрагентного слоя (P8.3)</span>
          <BankReadinessBadge value={cp.counterpartyLayerReadiness} />
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Уникальных имён', value: cp.uniqueCounterpartyNames ?? 0 },
            { label: 'Уникальных ИНН', value: cp.uniqueCounterpartyInns ?? 0 },
            { label: 'Уникальных счетов', value: cp.uniqueCounterpartyAccounts ?? 0 },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 rounded p-2 text-center border border-gray-100">
              <div className="text-[16px] font-bold text-gray-800">{s.value}</div>
              <div className="text-[10px] text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold text-gray-600 mb-1.5">Топ входящих контрагентов</div>
            {(cp.topIncomeCounterparties ?? []).slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] mb-0.5 py-0.5 border-b border-gray-50">
                <div className="truncate text-gray-700 mr-2" title={c.name ?? ''}>{c.name ?? '—'}</div>
                <div className="shrink-0 text-green-700 font-semibold">{c.count} · {(c.totalSum ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-gray-600 mb-1.5">Топ исходящих контрагентов</div>
            {(cp.topExpenseCounterparties ?? []).slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] mb-0.5 py-0.5 border-b border-gray-50">
                <div className="truncate text-gray-700 mr-2" title={c.name ?? ''}>{c.name ?? '—'}</div>
                <div className="shrink-0 text-red-700 font-semibold">{c.count} · {(c.totalSum ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</div>
              </div>
            ))}
          </div>
        </div>
        {(cp.caveats ?? []).length > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded p-2.5">
            <div className="text-[11px] font-semibold text-amber-700 mb-1">Оговорки</div>
            {cp.caveats!.map((c, i) => <div key={i} className="text-[11px] text-amber-700">• {c}</div>)}
          </div>
        )}
      </div>

      {/* Duplicates */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-gray-800 text-[13px] mb-3">🔁 Дубликаты</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-gray-50 rounded p-3 border border-gray-100">
            <div className="text-[16px] font-bold text-orange-700">{d.duplicates?.rawDuplicates?.count ?? 0}</div>
            <div className="text-[11px] text-gray-600">Истинных дубликатов в raw</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Одинаковый ext_id + счёт</div>
          </div>
          <div className="bg-gray-50 rounded p-3 border border-gray-100">
            <div className="text-[16px] font-bold text-green-700">{d.duplicates?.normalizedDuplicates?.count ?? 0}</div>
            <div className="text-[11px] text-gray-600">Дубликатов в normalized</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{d.duplicates?.normalizedDuplicates?.note}</div>
          </div>
        </div>
        {(d.duplicates?.rawDuplicates?.examples ?? []).length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-gray-600 mb-1">Примеры дубликатов raw:</div>
            {d.duplicates!.rawDuplicates!.examples!.slice(0, 3).map((ex, i) => (
              <div key={i} className="text-[11px] font-mono text-gray-500 mb-0.5">
                {ex.externalTransactionId} · cnt={ex.occurrences}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Operations warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="font-semibold text-amber-800 text-[12px] mb-1">⚠️ Операции (operations table)</div>
        <div className="text-[12px] text-amber-700">
          Продакшн: <b>{d.operations?.total ?? 0}</b> записей · source=bank_api · linked_bank_tx: <b>{d.operations?.linkedBankTx ?? 0}</b> · период: {d.operations?.dateRange?.min?.slice(0, 10) ?? '?'} → {d.operations?.dateRange?.max?.slice(0, 10) ?? '?'}
        </div>
        {d.operations?.devProductionDifference && (
          <div className="text-[11px] text-amber-600 mt-1">{d.operations.devProductionDifference}</div>
        )}
      </div>

      {/* Issues */}
      <div>
        <div className="text-[12px] font-semibold text-gray-700 mb-2">
          Проблемы
          {(d.issueSummary?.high ?? 0) > 0 ? <span className="ml-2 text-orange-600">● {d.issueSummary?.high} HIGH</span> : null}
          {(d.issueSummary?.medium ?? 0) > 0 ? <span className="ml-2 text-yellow-600">● {d.issueSummary?.medium} MEDIUM</span> : null}
          {(d.issueSummary?.info ?? 0) > 0 ? <span className="ml-2 text-blue-500">● {d.issueSummary?.info} INFO</span> : null}
        </div>
        {issues.length === 0
          ? <div className="text-gray-400 italic">Нет проблем</div>
          : issues.map((iss, i) => (
            <div key={i} className="border border-gray-100 rounded-lg p-3 mb-2">
              <div className="flex items-center gap-2 mb-1">
                <IssueSeverityBadge severity={iss.severity} />
                <span className="font-mono text-[11px] text-gray-500">{iss.issueType}</span>
                {iss.count != null && <span className="text-[11px] text-gray-400">× {iss.count}</span>}
              </div>
              <div className="text-gray-700 mb-0.5">{iss.description}</div>
              <div className="text-[12px] text-blue-600">→ {iss.recommendedAction}</div>
            </div>
          ))
        }
      </div>

      {/* Warnings */}
      {(d.warnings ?? []).length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
          <div className="text-[11px] font-semibold text-amber-700 mb-1.5">Важные замечания</div>
          {d.warnings!.map((w, i) => <div key={i} className="text-[12px] text-amber-700 mb-0.5">{w}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── P8.3 Counterparties Panel ───────────────────────────────────────────────

function CounterpartiesPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useGetCoverageCounterpartiesAudit();
  const buildMutation = useRetiredLegacyAction();

  if (isLoading) return <div className="flex items-center gap-2 text-[13px] text-gray-500 py-8 px-4"><Loader2 className="animate-spin w-4 h-4" /> Загрузка аудита контрагентов…</div>;
  if (isError || !data) return (
    <div className="p-4">
      <div className="text-red-600 text-[13px] mb-3">Ошибка загрузки. Возможно, контрагенты ещё не построены.</div>
      <button onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending}
        className="px-3 py-1.5 bg-blue-600 text-white text-[12px] rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
        {buildMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
        legacy action retired
      </button>
    </div>
  );

  const d = data;
  const env  = (d.environment ?? {}) as Record<string, unknown>;
  const srcTx      = typeof env.sourceTransactionCount === 'number' ? env.sourceTransactionCount : null;
  const p82Exp     = typeof env.p82ExpectedCount === 'number' ? env.p82ExpectedCount : 854;
  const srcMatches = env.sourceMatchesP82 === true;
  const srcBad     = env.sourceMismatch === true;

  const readinessColor = d.counterpartyFoundationReadiness === 'READY_WITH_REVIEW'
    ? 'text-green-700 bg-green-50'
    : d.counterpartyFoundationReadiness === 'PARTIAL'
      ? 'text-yellow-700 bg-yellow-50'
      : 'text-red-700 bg-red-50';

  const byType = (d.byType ?? {}) as Record<string, { count: number; totalAmount?: string }>;
  const byConf = (d.byConfidence ?? {}) as Record<string, number>;
  const topIncome = (d.topIncomeCounterparties ?? []) as Array<Record<string, unknown>>;
  const topExpense = (d.topExpenseCounterparties ?? []) as Array<Record<string, unknown>>;
  const dupCandidates = (d.duplicateCandidates ?? []) as Array<Record<string, unknown>>;
  const issues = (d.issues ?? []) as Array<Record<string, unknown>>;
  const summary = (d.summary ?? {}) as Record<string, unknown>;

  const TYPE_LABELS: Record<string, string> = {
    internal_company:          '🏭 Внутренняя компания',
    parent_client:             '👨‍👩‍👧 Клиент (родитель)',
    bank_or_fee:               '🏦 Банк / комиссия',
    tax_authority:             '📋 Налоговая',
    contractor:                '🔧 Подрядчик',
    employee_or_self_employed: '👤 Сотрудник / самозанятый',
    unknown:                   '❓ Неизвестно',
  };

  return (
    <div className="space-y-4 pb-8">
      {/* Environment strip */}
      <div className="mx-4 mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div className="bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5">
          <span className="text-gray-400">dbKind </span>
          <span className="font-semibold text-gray-700">{String(env.dbKind ?? '—')}</span>
          {' '}<span className={env.isProduction ? 'text-green-600' : 'text-red-600'}>{env.isProduction ? '✅' : '❌'}</span>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5">
          <span className="text-gray-400">Транзакций в БД </span>
          <span className={`font-semibold ${srcMatches ? 'text-green-700' : srcTx === 0 ? 'text-red-700' : 'text-yellow-700'}`}>
            {srcTx !== null ? srcTx.toLocaleString('ru-RU') : '—'}
          </span>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5">
          <span className="text-gray-400">P8.2 эталон </span>
          <span className="font-semibold text-gray-700">{p82Exp.toLocaleString('ru-RU')}</span>
        </div>
        <div className={`border rounded px-2.5 py-1.5 ${srcMatches ? 'bg-green-50 border-green-200' : srcBad ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
          <span className="text-gray-400">Источник P8.2 </span>
          <span className={`font-semibold ${srcMatches ? 'text-green-700' : 'text-red-700'}`}>
            {srcMatches ? '✅ совпадает' : srcTx === 0 ? '❌ пустой' : '⚠️ расхождение'}
          </span>
        </div>
      </div>

      {/* Source mismatch warning */}
      {srcTx === 0 && (
        <div className="mx-4 bg-red-50 border border-red-300 rounded px-3 py-2.5">
          <div className="text-[12px] font-semibold text-red-700 mb-1">🚫 bank_transactions пустой в текущей среде</div>
          <div className="text-[11px] text-red-700 space-y-0.5">
            <div>P8.2 доказал: 854 нормализованных транзакций существуют в production-деплое.</div>
            <div>Текущая среда: dev DATABASE_URL ≠ production DATABASE_URL.</div>
            <div className="font-semibold mt-1">Решение: опубликовать деплой → нажать «Построить контрагентов» в этом интерфейсе.</div>
          </div>
        </div>
      )}
      {srcBad && srcTx !== 0 && !!env.sourceMismatchNote && (
        <div className="mx-4 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 text-[11px] text-amber-700">
          ⚠️ {String(env.sourceMismatchNote)}
        </div>
      )}

      {/* Readiness + Actions */}
      <div className="flex flex-wrap items-center gap-3 px-4">
        <span className={`text-[12px] font-bold px-3 py-1 rounded-full ${readinessColor}`}>
          {d.counterpartyFoundationReadiness ?? 'N/A'}
        </span>
        <span className="text-[12px] text-gray-500">{d.readinessReason}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending}
            className="px-3 py-1.5 bg-blue-600 text-white text-[12px] rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
            {buildMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Построить контрагентов
          </button>
          <button onClick={() => refetch()} disabled={isFetching}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-[12px] rounded hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1.5">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Обновить
          </button>
        </div>
      </div>

      {d.nextRecommendedStep && (
        <div className="mx-4 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
          Следующий шаг: <span className="font-mono">{d.nextRecommendedStep}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4">
        {([
          ['Контрагентов', summary.totalCounterparties],
          ['Транзакций покрыто', summary.linkedTransactions],
          ['Транзакций не связано', summary.unlinkedTransactions],
          ['Дублей кандидатов', summary.duplicateCandidates],
        ] as [string, unknown][]).map(([label, val]) => (
          <div key={label} className="bg-white border border-gray-200 rounded p-3">
            <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
            <div className="text-[22px] font-bold text-gray-900">{typeof val === 'number' ? val.toLocaleString('ru-RU') : String(val ?? '—')}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4">
        {/* By Type */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">По типу контрагента</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-gray-500 border-b border-gray-100">
              <th className="text-left py-0.5">Тип</th>
              <th className="text-right py-0.5">Кол-во</th>
              <th className="text-right py-0.5">Сумма</th>
            </tr></thead>
            <tbody>
              {Object.entries(byType).map(([type, row]) => (
                <tr key={type} className="border-b border-gray-50">
                  <td className="py-0.5 pr-2">{TYPE_LABELS[type] ?? type}</td>
                  <td className="py-0.5 text-right pr-2 font-mono">{row.count.toLocaleString('ru-RU')}</td>
                  <td className="py-0.5 text-right font-mono text-gray-500">{row.totalAmount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* By Confidence */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">По уверенности классификации</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-gray-500 border-b border-gray-100">
              <th className="text-left py-0.5">Уверенность</th>
              <th className="text-right py-0.5">Кол-во</th>
            </tr></thead>
            <tbody>
              {Object.entries(byConf).map(([conf, cnt]) => {
                const color = conf === 'high' ? 'text-green-700' : conf === 'medium' ? 'text-yellow-700' : 'text-red-700';
                const label = conf === 'high' ? '✅ Высокая' : conf === 'medium' ? '⚠️ Средняя' : '❓ Низкая';
                return (
                  <tr key={conf} className="border-b border-gray-50">
                    <td className={`py-0.5 pr-2 ${color}`}>{label}</td>
                    <td className="py-0.5 text-right font-mono">{typeof cnt === 'number' ? cnt.toLocaleString('ru-RU') : cnt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4">
        {/* Top Income */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Топ контрагентов по приходу</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-gray-500 border-b border-gray-100">
              <th className="text-left py-0.5">Контрагент</th>
              <th className="text-right py-0.5">Сумма</th>
              <th className="text-right py-0.5">Тип</th>
            </tr></thead>
            <tbody>
              {topIncome.slice(0, 10).map((cp, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-0.5 pr-2 max-w-[180px] truncate">{String(cp.canonicalName ?? cp.canonical_name ?? '—')}</td>
                  <td className="py-0.5 text-right pr-2 font-mono text-green-700">{String(cp.totalIncome ?? cp.total_income ?? '—')}</td>
                  <td className="py-0.5 text-right text-gray-500">{String(cp.type ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top Expense */}
        <div className="bg-white border border-gray-200 rounded p-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Топ контрагентов по расходу</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-gray-500 border-b border-gray-100">
              <th className="text-left py-0.5">Контрагент</th>
              <th className="text-right py-0.5">Сумма</th>
              <th className="text-right py-0.5">Тип</th>
            </tr></thead>
            <tbody>
              {topExpense.slice(0, 10).map((cp, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-0.5 pr-2 max-w-[180px] truncate">{String(cp.canonicalName ?? cp.canonical_name ?? '—')}</td>
                  <td className="py-0.5 text-right pr-2 font-mono text-red-700">{String(cp.totalExpense ?? cp.total_expense ?? '—')}</td>
                  <td className="py-0.5 text-right text-gray-500">{String(cp.type ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dupCandidates.length > 0 && (
        <div className="mx-4 bg-white border border-amber-200 rounded p-3">
          <div className="text-[12px] font-semibold text-amber-700 mb-2">⚠️ Кандидаты на дубли ({dupCandidates.length})</div>
          <table className="w-full text-[11px]">
            <thead><tr className="text-gray-500 border-b border-gray-100">
              <th className="text-left py-0.5">Контрагент A</th>
              <th className="text-left py-0.5">Контрагент B</th>
              <th className="text-left py-0.5">Причина</th>
            </tr></thead>
            <tbody>
              {dupCandidates.slice(0, 15).map((dup, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-0.5 pr-2 font-mono max-w-[180px] truncate">{String(dup.canonicalNameA ?? dup.canonical_name_a ?? '—')}</td>
                  <td className="py-0.5 pr-2 font-mono max-w-[180px] truncate">{String(dup.canonicalNameB ?? dup.canonical_name_b ?? '—')}</td>
                  <td className="py-0.5 text-gray-500">{String(dup.reason ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mx-4 bg-white border border-red-200 rounded p-3">
          <div className="text-[12px] font-semibold text-red-700 mb-2">🚨 Issues ({issues.length})</div>
          <div className="space-y-0.5">
            {issues.slice(0, 20).map((iss, i) => (
              <div key={i} className="text-[11px] text-red-700 font-mono">[{String(iss.code ?? '')}] {String(iss.message ?? '')}</div>
            ))}
          </div>
        </div>
      )}

      {(d.warnings ?? []).length > 0 && (
        <div className="mx-4 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <div className="text-[11px] font-semibold text-amber-700 mb-1">Замечания</div>
          {(d.warnings ?? []).map((w, i) => <div key={i} className="text-[11px] text-amber-700 mb-0.5">{w}</div>)}
        </div>
      )}
    </div>
  );
}

// ─── P8.4a Panel ──────────────────────────────────────────────────────────────

function P84aReclassificationPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useGetCoverageCounterpartyReclassificationAudit();
  const reclassMut = useRetiredLegacyAction();

  if (isLoading) return <div className="flex items-center gap-2 text-[13px] text-gray-500 py-8 px-4"><Loader2 className="animate-spin w-4 h-4" /> Загрузка аудита реклассификации…</div>;

  const d = (data ?? {}) as Record<string, unknown>;
  const env = (d.environment ?? {}) as Record<string, unknown>;
  const isProd = env.isProduction === true;
  const summary = (d.summary ?? {}) as Record<string, unknown>;
  const byCurrentType = (d.byCurrentType ?? {}) as Record<string, { count: number; totalIncome: number; totalExpense: number }>;
  const issues = (d.issues ?? []) as Array<Record<string, unknown>>;
  const internalCompanies = (d.internalCompanies ?? []) as Array<Record<string, unknown>>;
  const bankOrFee = (d.bankOrFee ?? []) as Array<Record<string, unknown>>;
  const parentClientCandidates = (d.parentClientCandidates ?? []) as Array<Record<string, unknown>>;
  const needsReviewList = (d.needsManualReviewList ?? []) as Array<Record<string, unknown>>;
  const dupSample = (d.duplicateCandidatesSample ?? []) as Array<Record<string, unknown>>;
  const readiness = (d.counterpartyReclassificationReadiness as string) ?? 'NOT_READY';
  const readinessReason = (d.readinessReason as string) ?? '';
  const byVersion = (summary.byClassificationVersion ?? {}) as Record<string, number>;

  const readinessColor = readiness === 'READY_FOR_RECONCILIATION'
    ? 'text-green-700 bg-green-50 border-green-200'
    : readiness === 'READY_WITH_REVIEW'
      ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
      : 'text-red-700 bg-red-50 border-red-200';

  const TYPE_LABELS: Record<string, string> = {
    internal_company:       '🏭 Внутренняя компания',
    parent_client:          '👨‍👩‍👧 Клиент (родитель)',
    bank_or_fee:            '🏦 Банк / комиссия',
    tax_authority:          '🏛️ Налоговый орган',
    contractor:             '🔧 Подрядчик',
    supplier:               '🛒 Поставщик',
    employee_or_self_employed: '👤 Сотрудник / самозанятый',
    unknown:                '❓ Неизвестен',
  };

  const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  if (!isProd && !isLoading && !isError) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-[13px] text-yellow-800">
        <div className="font-semibold mb-1">⚠️ Dev-среда</div>
        <div>P8.4a Reclassification Audit доступен только в production (реальные bank_transactions). Переключитесь на production URL.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Header: readiness badge + run button */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className={`border rounded-lg px-4 py-2.5 flex-1 min-w-0 ${readinessColor}`}>
          <div className="text-[12px] font-bold uppercase tracking-wide mb-0.5">
            {readiness === 'READY_FOR_RECONCILIATION' ? '✅' : readiness === 'READY_WITH_REVIEW' ? '🟡' : '🔴'} {readiness}
          </div>
          <div className="text-[12px]">{readinessReason || 'Аудит ещё не получен.'}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => refetch()} disabled={isFetching}
            className="px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-700 text-[12px] rounded hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1.5">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Обновить
          </button>
          <button onClick={() => reclassMut.mutate()} disabled={reclassMut.isPending}
            className="px-3 py-1.5 bg-violet-600 text-white text-[12px] rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5">
            {reclassMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            legacy action retired
          </button>
        </div>
      </div>

      {/* Classification version summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Всего контрагентов',  val: String(summary.totalCounterparties ?? '—'), color: 'bg-gray-50 border-gray-200' },
          { label: 'Реклассифицировано (p84a_v1)', val: String(summary.reclassifiedP84a ?? '—'), color: 'bg-green-50 border-green-200' },
          { label: 'Исходная P8.3 версия', val: String(summary.atP83Original ?? '—'), color: (Number(summary.atP83Original ?? 0) > 0 ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200') },
          { label: 'Нужен ручной разбор', val: String(summary.needsManualReview ?? '—'), color: (Number(summary.needsManualReview ?? 0) > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200') },
        ].map(({ label, val, color }) => (
          <div key={label} className={`border rounded-lg px-3 py-2.5 text-center ${color}`}>
            <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
            <div className="text-[20px] font-bold text-gray-800">{val}</div>
          </div>
        ))}
      </div>

      {/* By classification version */}
      {Object.keys(byVersion).length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Версии классификации</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byVersion).map(([ver, cnt]) => (
              <span key={ver} className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${ver === 'p84a_v1' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {ver}: {cnt}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* By current type */}
      {Object.keys(byCurrentType).length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">По типу контрагента (после реклассификации)</div>
          <div className="space-y-1.5">
            {Object.entries(byCurrentType).sort((a, b) => b[1].count - a[1].count).map(([type, stats]) => (
              <div key={type} className="flex items-center gap-2 text-[12px]">
                <span className="w-52 text-gray-700">{TYPE_LABELS[type] ?? type}</span>
                <span className="w-8 text-right font-mono font-bold text-gray-800">{stats.count}</span>
                {stats.totalIncome > 0 && <span className="text-green-700 ml-2">+{fmt(stats.totalIncome)} ₽</span>}
                {stats.totalExpense > 0 && <span className="text-red-600 ml-1">−{fmt(stats.totalExpense)} ₽</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Internal companies */}
      {internalCompanies.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-red-800 mb-2">
            🏭 Внутренние компании (ИСКЛЮЧЕНЫ из выручки/расходов)
          </div>
          <div className="space-y-1">
            {internalCompanies.map((cp) => (
              <div key={cp.id as string} className="flex items-center gap-2 text-[11px]">
                <span className="text-red-700 font-medium">{cp.displayName as string}</span>
                {!!cp.inn && <span className="text-red-400">ИНН {cp.inn as string}</span>}
                <span className="ml-auto text-red-400">{fmt(Number(cp.totalIncome ?? 0))} / {fmt(Number(cp.totalExpense ?? 0))} ₽</span>
                {!!cp.excludeFromRevExp && <span className="px-1.5 py-0.5 bg-red-100 border border-red-300 rounded text-[10px] text-red-700">excluded ✓</span>}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-red-600 font-medium">⚠️ Исключить из всех расчётов P&L до банковской сверки</div>
        </div>
      )}

      {/* Bank / fee */}
      {bankOrFee.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-amber-800 mb-2">🏦 Банк / комиссия (требует операционной детализации)</div>
          <div className="space-y-1">
            {bankOrFee.map((cp) => (
              <div key={cp.id as string} className="flex items-center gap-2 text-[11px]">
                <span className="text-amber-800 font-medium">{cp.displayName as string}</span>
                <span className="text-amber-500">{cp.operationsCount as number} операций</span>
                {!!((cp.riskFlags as Record<string, unknown>)?.['needs_operation_level_classification']) && (
                  <span className="px-1.5 py-0.5 bg-amber-100 border border-amber-300 rounded text-[10px] text-amber-700">needs op-level split ⚠️</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-amber-700">Не считать все операции Банка Точки расходами — часть может быть комиссия эквайринга. Разбор в P8.4b.</div>
        </div>
      )}

      {/* Parent client candidates */}
      {parentClientCandidates.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-blue-800 mb-1">👨‍👩‍👧 Parent-client кандидаты (нужна привязка к AlphaCRM)</div>
          <div className="space-y-1">
            {parentClientCandidates.map((cp) => (
              <div key={cp.id as string} className="text-[11px] text-blue-700">
                {cp.displayName as string} — {fmt(Number(cp.totalIncome ?? 0))} ₽ приход
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Needs manual review */}
      {needsReviewList.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">🔍 Нужен ручной разбор ({needsReviewList.length})</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {needsReviewList.map((cp) => (
              <div key={cp.id as string} className="flex items-center gap-2 text-[11px] border-b border-gray-50 pb-1">
                <span className="text-gray-700 font-medium min-w-0 truncate">{cp.displayName as string}</span>
                <span className="text-gray-400 shrink-0">{cp.counterpartyType as string}</span>
                <span className="text-gray-400 shrink-0 ml-auto text-[10px]">{cp.reclassificationReason as string}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-gray-500">Не блокирует P8.4b. Разобрать в ходе Bank ↔ AlphaCRM сверки.</div>
        </div>
      )}

      {/* Duplicate candidates policy */}
      {dupSample.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-1">
            🪞 Дубли-кандидаты ({Number(summary.openDuplicateCandidates ?? 0)} открытых) — только ручной разбор
          </div>
          <div className="space-y-1 mb-2">
            {dupSample.map((dc, i) => (
              <div key={i} className="text-[11px] text-gray-600">
                {dc.aName as string} ↔ {dc.bName as string} <span className="text-gray-400">({dc.reason as string})</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-red-700 font-medium">⚠️ НЕ авто-мержить! same_inn_diff_key = вероятно общий ИНН СБП. Разбор вручную.</div>
        </div>
      )}

      {/* Issues */}
      {issues.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Проблемы ({issues.length})</div>
          <div className="space-y-2">
            {issues.map((issue, i) => {
              const sev = issue.severity as string;
              const sevColor = sev === 'HIGH' ? 'text-red-700 bg-red-50 border-red-200'
                : sev === 'MEDIUM' ? 'text-amber-700 bg-amber-50 border-amber-200'
                : sev === 'LOW' ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
                : 'text-gray-600 bg-gray-50 border-gray-200';
              return (
                <div key={i} className={`border rounded px-3 py-2 text-[11px] ${sevColor}`}>
                  <div className="font-semibold mb-0.5">[{sev}] {issue.issueType as string} ({issue.count as number})</div>
                  <div>{issue.description as string}</div>
                  <div className="italic mt-0.5">{issue.recommendedAction as string}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Warnings */}
      {(d.warnings ?? []) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <div className="text-[11px] font-semibold text-amber-800 mb-1">Замечания</div>
          {(d.warnings as string[] ?? []).map((w, i) => (
            <div key={i} className="text-[11px] text-amber-700 mb-0.5">{w}</div>
          ))}
        </div>
      )}

    </div>
  );
}

// ─── P8.4b: Bank ↔ AlphaCRM Reconciliation Panel ──────────────────────────────
function BankAlphaReconciliationPanel() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } =
    useGetCoverageBankAlphaReconciliationAudit();
  const reconcileMut = useRetiredLegacyAction();

  if (isLoading) return (
    <div className="flex items-center gap-2 text-[13px] text-gray-500 py-8 px-4">
      <Loader2 className="animate-spin w-4 h-4" /> Загрузка аудита сверки Bank ↔ CRM…
    </div>
  );
  if (isError) return (
    <div className="text-red-500 text-[13px] py-4">Ошибка загрузки /coverage/bank-alpha-reconciliation-audit</div>
  );

  const d = (data ?? {}) as Record<string, unknown>;
  const env = (d.environment ?? {}) as Record<string, unknown>;
  const isProd = env.isProduction === true;
  const latestRun = (d.latestRun ?? null) as Record<string, unknown> | null;
  const summary = (d.summary ?? {}) as Record<string, unknown>;
  const matchBreakdown = (d.matchBreakdown ?? {}) as Record<string, unknown>;
  const byStatus = (matchBreakdown.byStatus ?? {}) as Record<string, { count: number; totalBankAmount: number }>;
  const byConf = (matchBreakdown.byConfidence ?? {}) as Record<string, number>;
  const unmatchedSample = (d.unmatchedBankSample ?? []) as Array<Record<string, unknown>>;
  const needsReviewSample = (d.needsReviewSample ?? []) as Array<Record<string, unknown>>;
  const matchedSample = (d.matchedSample ?? []) as Array<Record<string, unknown>>;
  const issues = (d.issues ?? []) as Array<Record<string, unknown>>;
  const readiness = (d.bankAlphaReconciliationReadiness as string) ?? 'NOT_RUN';
  const readinessReason = (d.readinessReason as string) ?? '';

  const fmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtAmt = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const readinessColor =
    readiness === 'READY_FOR_P85' ? 'text-green-700 bg-green-50 border-green-200' :
    readiness === 'PARTIAL_READY' ? 'text-yellow-700 bg-yellow-50 border-yellow-200' :
    readiness === 'NOT_RUN'       ? 'text-blue-700 bg-blue-50 border-blue-200' :
    'text-red-700 bg-red-50 border-red-200';

  const STATUS_LABELS: Record<string, string> = {
    matched:              '✅ Сопоставлен',
    possible_match:       '🟡 Возможный',
    needs_review:         '🔍 Требует разбора',
    unmatched_bank:       '❌ Нет в CRM',
    excluded_internal:    '🏭 Внутренний (исключён)',
    excluded_bank_fee:    '🏦 Банк/комиссия (исключён)',
    excluded_collection:  '💰 Инкассация (исключена)',
  };
  const CONF_LABELS: Record<string, string> = {
    exact: '🎯 Exact', high: '⬆️ High', medium: '🟡 Medium', low: '⬇️ Low', none: '—',
  };

  if (!isProd && !isLoading) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-[13px] text-yellow-800">
        <div className="font-semibold mb-1">⚠️ Dev-среда</div>
        <div>P8.4b Bank ↔ AlphaCRM Reconciliation доступен только в production (реальные bank_transactions). Переключитесь на production URL.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Header: readiness badge + run button */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className={`border rounded-lg px-4 py-2.5 flex-1 min-w-0 ${readinessColor}`}>
          <div className="text-[12px] font-bold uppercase tracking-wide mb-0.5">
            {readiness === 'READY_FOR_P85' ? '✅' : readiness === 'PARTIAL_READY' ? '🟡' : readiness === 'NOT_RUN' ? 'ℹ️' : '🔴'} {readiness}
          </div>
          <div className="text-[12px]">{readinessReason || 'Аудит ещё не получен.'}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => refetch()} disabled={isFetching}
            className="px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-700 text-[12px] rounded hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1.5">
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Обновить
          </button>
          <button onClick={() => reconcileMut.mutate()} disabled={reconcileMut.isPending}
            className="px-3 py-1.5 bg-violet-600 text-white text-[12px] rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5">
            {reconcileMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            legacy action retired
          </button>
        </div>
      </div>

      {/* Precondition warning if no run yet */}
      {readiness === 'NOT_RUN' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[12px] text-blue-800">
          <div className="font-semibold mb-1">ℹ️ Первый запуск</div>
          <div>Нажми кнопку «legacy action retired» для первого прохода сверки Bank ↔ AlphaCRM.</div>
          <div className="mt-1 text-[11px] text-blue-600">Предусловия: P8.4a COMPLETE ✓ | 854 bank transactions ✓ | 100% counterparty links ✓</div>
        </div>
      )}

      {/* Latest run summary */}
      {latestRun && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Bank транзакций',   val: fmt(Number(latestRun.bankTransactionsChecked ?? 0)), color: 'bg-gray-50 border-gray-200' },
            { label: 'CRM платежей',       val: fmt(Number(latestRun.crmPaymentsChecked ?? 0)),     color: 'bg-gray-50 border-gray-200' },
            { label: 'Сопоставлено',       val: fmt(Number(latestRun.matchedCount ?? 0)),            color: 'bg-green-50 border-green-200' },
            { label: 'Нет совпадений (Bank)', val: fmt(Number(latestRun.unmatchedBankCount ?? 0)),  color: Number(latestRun.unmatchedBankCount ?? 0) > 50 ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-200' },
          ].map(({ label, val, color }) => (
            <div key={label} className={`border rounded-lg px-3 py-2.5 text-center ${color}`}>
              <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
              <div className="text-[20px] font-bold text-gray-800">{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Match rate + exclusion summary */}
      {latestRun && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Возможные совпадения', val: fmt(Number(latestRun.possibleCount ?? 0)),           color: 'bg-yellow-50 border-yellow-200' },
            { label: 'Требуют разбора',       val: fmt(Number(latestRun.needsReviewCount ?? 0)),       color: Number(latestRun.needsReviewCount ?? 0) > 0 ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200' },
            { label: 'Внутренние (искл.)',    val: fmt(Number(latestRun.excludedInternalCount ?? 0)),  color: 'bg-gray-50 border-gray-200' },
            { label: 'Инкассация (искл.)',    val: fmt(Number(latestRun.excludedCollectionCount ?? 0)), color: 'bg-gray-50 border-gray-200' },
          ].map(({ label, val, color }) => (
            <div key={label} className={`border rounded-lg px-3 py-2.5 text-center ${color}`}>
              <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
              <div className="text-[18px] font-bold text-gray-800">{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Match rate bar */}
      {latestRun && Number(summary.matchRatePct ?? 0) > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[12px] font-semibold text-gray-700">Match rate (income bank → CRM income)</div>
            <div className="text-[14px] font-bold text-gray-800">{String(summary.matchRatePct ?? 0)}%</div>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${Number(summary.matchRatePct ?? 0) >= 80 ? 'bg-green-500' : Number(summary.matchRatePct ?? 0) >= 40 ? 'bg-yellow-400' : 'bg-red-400'}`}
              style={{ width: `${Math.min(100, Number(summary.matchRatePct ?? 0))}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-gray-400">
            {fmt(Number(summary.eligibleBankIncomeCount ?? 0))} eligible bank income tx | {fmt(Number(latestRun.matchedCount ?? 0))} confirmed + {fmt(Number(latestRun.possibleCount ?? 0))} possible
          </div>
        </div>
      )}

      {/* Match breakdown by status */}
      {Object.keys(byStatus).length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Разбивка по статусу</div>
          <div className="space-y-1.5">
            {Object.entries(byStatus).sort((a, b) => b[1].count - a[1].count).map(([status, stats]) => (
              <div key={status} className="flex items-center gap-2 text-[12px]">
                <span className="w-52 text-gray-700">{STATUS_LABELS[status] ?? status}</span>
                <span className="w-8 text-right font-mono font-bold text-gray-800">{stats.count}</span>
                {stats.totalBankAmount > 0 && (
                  <span className="text-gray-500 ml-2 text-[11px]">{fmtAmt(stats.totalBankAmount)} ₽</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match confidence breakdown */}
      {Object.keys(byConf).filter(k => k !== 'none').length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Уверенность сопоставления</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byConf).filter(([k]) => k !== 'none').map(([conf, cnt]) => (
              <span key={conf} className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                conf === 'exact' ? 'bg-green-50 border-green-200 text-green-700' :
                conf === 'high'  ? 'bg-teal-50 border-teal-200 text-teal-700' :
                conf === 'medium'? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                'bg-orange-50 border-orange-200 text-orange-700'
              }`}>
                {CONF_LABELS[conf] ?? conf}: {cnt}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Matched sample */}
      {matchedSample.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">✅ Сопоставленные записи (топ {matchedSample.length} по сумме)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400">
                  <th className="text-left pb-1.5 font-normal">Сумма (₽)</th>
                  <th className="text-left pb-1.5 font-normal">Bank дата</th>
                  <th className="text-left pb-1.5 font-normal">CRM дата</th>
                  <th className="text-left pb-1.5 font-normal">Δ дней</th>
                  <th className="text-left pb-1.5 font-normal">Уверенность</th>
                  <th className="text-left pb-1.5 font-normal">Контрагент</th>
                </tr>
              </thead>
              <tbody>
                {matchedSample.map((m, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1 pr-2 font-mono font-medium text-green-700">{fmtAmt(Number(m.bankAmount ?? 0))}</td>
                    <td className="py-1 pr-2 font-mono text-gray-600">{(m.bankDate as string) ?? '—'}</td>
                    <td className="py-1 pr-2 font-mono text-gray-600">{(m.crmDate as string) ?? '—'}</td>
                    <td className="py-1 pr-2 text-center font-mono">{m.dateDeltaDays !== null && m.dateDeltaDays !== undefined ? String(m.dateDeltaDays) : '—'}</td>
                    <td className="py-1 pr-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        m.matchConfidence === 'exact' ? 'bg-green-50 border-green-200 text-green-700' :
                        m.matchConfidence === 'high'  ? 'bg-teal-50 border-teal-200 text-teal-700' :
                        'bg-yellow-50 border-yellow-200 text-yellow-700'
                      }`}>{CONF_LABELS[m.matchConfidence as string] ?? (m.matchConfidence as string)}</span>
                    </td>
                    <td className="py-1 text-gray-500 truncate max-w-[140px]">{(m.bankCounterpartyName as string) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Needs review sample */}
      {needsReviewSample.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-amber-800 mb-2">🔍 Требуют разбора — несколько CRM-кандидатов (топ {needsReviewSample.length})</div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {needsReviewSample.map((r, i) => {
              const reasons = (r.reasons ?? {}) as Record<string, unknown>;
              const candidateCount = Number(reasons.candidateCount ?? 0);
              return (
                <div key={i} className="flex items-start gap-2 text-[11px] border-b border-amber-100 pb-1.5">
                  <span className="text-amber-800 font-mono font-medium shrink-0">
                    {fmtAmt(Number(r.bankAmount ?? 0))} ₽
                  </span>
                  <span className="text-amber-600 shrink-0">{(r.bankDate as string) ?? '—'}</span>
                  <span className="text-amber-700 shrink-0">{(r.bankCounterpartyName as string) ?? '—'}</span>
                  {candidateCount > 0 && (
                    <span className="ml-auto text-amber-500 shrink-0">{candidateCount} CRM-кандидатов</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] text-amber-700">
            Разбор вручную: несколько CRM платежей с той же суммой. Посмотреть контекст студента/цели.
          </div>
        </div>
      )}

      {/* Unmatched bank sample */}
      {unmatchedSample.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-red-800 mb-2">❌ Нет совпадения в CRM (топ {unmatchedSample.length} по сумме)</div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {unmatchedSample.map((r, i) => {
              const reasons = (r.reasons ?? {}) as Record<string, unknown>;
              return (
                <div key={i} className="flex items-start gap-2 text-[11px] border-b border-red-100 pb-1.5">
                  <span className="text-red-800 font-mono font-medium shrink-0">
                    {fmtAmt(Number(r.bankAmount ?? 0))} ₽
                  </span>
                  <span className="text-red-600 shrink-0">{(r.bankDate as string) ?? '—'}</span>
                  <span className="text-red-700 shrink-0 truncate max-w-[160px]">{(r.bankCounterpartyName as string) ?? '—'}</span>
                  {reasons.reason ? (
                    <span className="ml-auto text-red-400 shrink-0 text-[10px]">{String(reasons.reason)}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] text-red-700">
            Возможные причины: CRM не зафиксировал платёж, другой период, bank-only поступление.
          </div>
        </div>
      )}

      {/* Issues */}
      {issues.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Проблемы ({issues.length})</div>
          <div className="space-y-2">
            {issues.map((issue, i) => {
              const sev = issue.severity as string;
              const sevColor = sev === 'HIGH' ? 'text-red-700 bg-red-50 border-red-200'
                : sev === 'MEDIUM' ? 'text-amber-700 bg-amber-50 border-amber-200'
                : 'text-yellow-700 bg-yellow-50 border-yellow-200';
              return (
                <div key={i} className={`border rounded px-3 py-2 text-[11px] ${sevColor}`}>
                  <div className="font-semibold mb-0.5">[{sev}] {issue.issueType as string} ({issue.count as number})</div>
                  <div>{issue.description as string}</div>
                  <div className="italic mt-0.5">{issue.recommendedAction as string}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Warnings */}
      {(d.warnings as string[] | undefined)?.length ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <div className="text-[11px] font-semibold text-amber-800 mb-1">⚠️ Замечания P8.4b</div>
          {(d.warnings as string[]).map((w, i) => (
            <div key={i} className="text-[11px] text-amber-700 mb-0.5">{w}</div>
          ))}
        </div>
      ) : null}

    </div>
  );
}

// ─── EvotorPanel (P8.5a) ─────────────────────────────────────────────────────

const READINESS_COLOR: Record<string, string> = {
  NOT_CONNECTED:        'bg-gray-100 text-gray-600',
  TOKEN_SAVED:          'bg-blue-100 text-blue-700',
  USER_TOKEN_RECEIVED:  'bg-violet-100 text-violet-700',
  DISCOVERY_READY:      'bg-emerald-100 text-emerald-700',
  ERROR:                'bg-red-100 text-red-600',
};

function EvotorPanel() {
  const qc = useQueryClient();
  const [tokenInput, setTokenInput] = useState('');
  const [copied, setCopied]         = useState(false);

  const statusQ  = useGetEvotorStatus();
  const auditQ   = useGetCoverageEvotorCoverageAudit();
  const saveMut  = useSaveEvotorPublisherToken();
  const discoverMut = useDiscoverEvotor();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetEvotorStatusQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageEvotorCoverageAuditQueryKey() });
  };

  const handleSave = () => {
    if (!tokenInput.trim()) return;
    saveMut.mutate(
      { data: { token: tokenInput.trim() } },
      {
        onSuccess: () => {
          toast.success('Publisher token сохранён');
          setTokenInput('');
          invalidate();
        },
        onError: () => toast.error('Ошибка сохранения токена'),
      },
    );
  };

  const handleDiscover = () => {
    discoverMut.mutate(undefined, {
      onSuccess: (d) => {
        const r = d as EvotorCoverageAuditResponse & { storesCount?: number; devicesCount?: number; employeesCount?: number; errors?: string[] };
        if (r.storesCount !== undefined) {
          toast.success(`Discovery: stores=${r.storesCount}, devices=${r.devicesCount}, employees=${r.employeesCount}`);
        } else {
          toast.success('Discovery запущен');
        }
        setTimeout(invalidate, 1000);
      },
      onError: () => toast.error('Discovery failed — проверьте токен'),
    });
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const status  = statusQ.data;
  const audit   = auditQ.data as EvotorCoverageAuditResponse | undefined;
  const readiness = status?.readiness ?? 'NOT_CONNECTED';
  const callbackUrl = status?.callbackUrl ?? 'https://alpha-crm-sync.replit.app/api/integrations/evotor/user-token';

  return (
    <div className="space-y-4">

      {/* Readiness status bar */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide ${READINESS_COLOR[readiness] ?? 'bg-gray-100 text-gray-600'}`}>
          {readiness}
        </span>
        <span className="text-[12px] text-gray-500">{audit?.readinessReason ?? '…'}</span>
        <button
          type="button"
          onClick={invalidate}
          className="ml-auto p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
          title="Обновить статус"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${(statusQ.isFetching || auditQ.isFetching) ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Token input */}
      <div className="p-4 bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="text-[13px] font-semibold text-gray-800 mb-1">Publisher Token</div>
        <div className="text-[11px] text-gray-400 mb-3">
          Из Evotor Marketplace → Мои приложения → Ваше приложение → Publisher Token.
          Токен шифруется AES-256-GCM и никогда не возвращается через API.
        </div>
        {status?.publisherTokenPresent ? (
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[12px] text-emerald-700 font-medium">
              Токен сохранён · ****{status.publisherTokenLast4 ?? '????'}
            </span>
            {status.publisherTokenSavedAt && (
              <span className="text-[11px] text-gray-400 ml-1">
                · {new Date(String(status.publisherTokenSavedAt)).toLocaleString('ru-RU')}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[11px] text-gray-400 mb-3">
            <Unlock className="w-3 h-3" /> Токен не сохранён
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Вставьте Publisher Token…"
            className="flex-1 h-8 px-2.5 rounded-xl border border-gray-200 text-[12px] focus:outline-none focus:border-violet-400 font-mono"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            type="button"
            disabled={!tokenInput.trim() || saveMut.isPending}
            onClick={handleSave}
            className="flex items-center gap-1.5 h-8 px-3 bg-violet-600 text-white text-[12px] font-semibold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            Сохранить
          </button>
        </div>
      </div>

      {/* Callback URL */}
      <div className="p-4 bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="text-[13px] font-semibold text-gray-800 mb-1">Callback URL для Эвотора</div>
        <div className="text-[11px] text-gray-400 mb-3">
          Укажите этот URL в настройках приложения в Evotor Marketplace → OAuth Redirect / Webhook URL.
        </div>
        <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-xl border border-gray-100">
          <code className="flex-1 text-[11px] text-violet-700 font-mono break-all">{callbackUrl}</code>
          <button
            type="button"
            onClick={() => handleCopy(callbackUrl)}
            className="shrink-0 p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
            title="Скопировать"
          >
            {copied ? <CopyCheck className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
          </button>
        </div>
      </div>

      {/* Token statuses */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded-xl border border-gray-100">
          <div className="text-[11px] text-gray-400 mb-1">Publisher Token</div>
          <div className={`text-[12px] font-semibold ${status?.publisherTokenPresent ? 'text-emerald-600' : 'text-gray-400'}`}>
            {status?.publisherTokenPresent ? `✓ Сохранён  · ****${status.publisherTokenLast4 ?? ''}` : '✗ Не сохранён'}
          </div>
        </div>
        <div className="p-3 bg-white rounded-xl border border-gray-100">
          <div className="text-[11px] text-gray-400 mb-1">User Token (OAuth callback)</div>
          <div className={`text-[12px] font-semibold ${status?.userTokenPresent ? 'text-emerald-600' : 'text-gray-400'}`}>
            {status?.userTokenPresent ? `✓ Получен · ****${status.userTokenLast4 ?? ''}` : '✗ Не получен'}
          </div>
        </div>
      </div>

      {/* Discovery stats + button */}
      <div className="p-4 bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] font-semibold text-gray-800">Discovery</div>
          <button
            type="button"
            disabled={!status?.publisherTokenPresent || discoverMut.isPending}
            onClick={handleDiscover}
            className="flex items-center gap-1.5 h-7 px-3 bg-violet-600 text-white text-[11px] font-semibold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {discoverMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Run Discovery
          </button>
        </div>
        {status?.lastDiscoveryAt ? (
          <div className="text-[11px] text-gray-400 mb-3">
            Последний запуск: {new Date(String(status.lastDiscoveryAt)).toLocaleString('ru-RU')}
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 mb-3">Discovery ещё не запускался</div>
        )}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Магазины',   value: status?.storesCount    ?? 0 },
            { label: 'Устройства', value: status?.devicesCount   ?? 0 },
            { label: 'Сотрудники', value: status?.employeesCount ?? 0 },
            { label: 'Документы',  value: status?.documentsCount ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} className="p-2.5 bg-gray-50 rounded-xl text-center">
              <div className="text-[18px] font-bold text-gray-800">{value}</div>
              <div className="text-[10px] text-gray-400">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Raw audit JSON */}
      {audit && (
        <details className="p-3 bg-gray-50 rounded-xl border border-gray-100">
          <summary className="text-[11px] font-semibold text-gray-500 cursor-pointer select-none">
            Raw audit JSON
          </summary>
          <pre className="mt-2 text-[10px] text-gray-600 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify({ ...audit, discoveryRaw: audit.discoveryRaw ? '(hidden)' : null }, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type CoverageTab = 'bank-p81' | 'bank-p82' | 'cp-p83' | 'cp-p84a' | 'bank-p84b' | 'evotor-p85a' | 'final-report' | 'scope' | 'atlas' | 'registry' | 'summary' | 'batches' | 'fields' | 'issues' | 'raw' | 'verify' | 'audit-norm' | 'audit-recon' | 'audit-dups';

const TABS: { key: CoverageTab; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { key: 'bank-p81',     label: '🏦 Банк (P8.1)',          Icon: HardDrive },
  { key: 'bank-p82',     label: '📊 Транзакции (P8.2)',    Icon: Activity },
  { key: 'cp-p83',       label: '🏢 Контрагенты (P8.3)',   Icon: Users },
  { key: 'cp-p84a',      label: '🔄 Реклассификация (P8.4a)', Icon: RefreshCw },
  { key: 'bank-p84b',    label: '🔗 Bank↔CRM (P8.4b)',       Icon: GitBranch },
  { key: 'evotor-p85a',  label: '🧾 Эвотор / POS (P8.5a)',  Icon: Zap },
  { key: 'final-report', label: '📋 Финальный отчёт',       Icon: ClipboardList },
  { key: 'scope',        label: '🎯 Scope Lock',        Icon: Target },
  { key: 'atlas',        label: '📊 Atlas Summary',     Icon: MapPin },
  { key: 'audit-norm',   label: '🔬 Нормализация',       Icon: FlaskConical },
  { key: 'audit-recon',  label: '⚖️ Сверка сущностей',   Icon: Activity },
  { key: 'audit-dups',   label: '🪞 Дубликаты',          Icon: ShieldAlert },
  { key: 'verify',       label: '🔍 Верификация',         Icon: Shield },
  { key: 'registry',     label: 'Endpoint Registry',    Icon: List },
  { key: 'summary',      label: 'Coverage Summary',     Icon: BarChart3 },
  { key: 'batches',      label: 'Batch History',        Icon: Clock },
  { key: 'fields',       label: 'Field Inventory',      Icon: Database },
  { key: 'issues',       label: 'Linking Issues',       Icon: Bug },
  { key: 'raw',          label: 'Raw Records',          Icon: Eye },
];

export default function CoveragePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<CoverageTab>('bank-p81');
  const [branchId, setBranchId] = useState('6'); // default = Atlas
  const [fromDate, setFromDate] = useState('2025-01-01');
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [fieldEntityFilter, setFieldEntityFilter] = useState('');

  const discoverMut  = useRunCoverageDiscover();
  const syncMut      = useRunCoverageSync();
  const scopeQ       = useGetCoverageScope();
  const scopeBranchId = String((scopeQ.data?.scope as Record<string, unknown> | null)?.branch_id ?? '6');
  const isOutOfScope  = branchId !== scopeBranchId;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetCoverageRegistryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageBatchesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageEnvironmentQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageVerificationReportQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageScopeQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageBranchesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageAtlasSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageNormalizationAuditQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageEntityReconciliationQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCoverageDuplicatesQueryKey() });
  };

  const handleDiscover = () => {
    discoverMut.mutate(
      { data: { branchId, fromDate, toDate } },
      {
        onSuccess: (d) => {
          const bid = String((d as unknown as Record<string, unknown>).branchId ?? branchId);
          toast.success(`Discovery запущен для branch ${bid} (batch ${d.batchId?.slice(0, 8)}…) — обновите через 30–60 сек`);
          setTimeout(invalidateAll, 5000);
          setTimeout(invalidateAll, 30000);
        },
        onError: () => toast.error('Ошибка запуска discovery'),
      },
    );
  };

  const handleSync = () => {
    if (isOutOfScope) {
      const ok = window.confirm(
        `⚠️ ВНИМАНИЕ: Branch ${branchId} находится ВНЕ активного scope (Atlas = ${scopeBranchId}).\n\nДанные НЕ будут нормализованы в families/children.\n\nПродолжить?`
      );
      if (!ok) return;
    }
    syncMut.mutate(
      { data: { branchId, fromDate, toDate } },
      {
        onSuccess: (d) => {
          const warn = String((d as unknown as Record<string, unknown>).outOfScopeWarning ?? '');
          if (warn) toast.warning(warn.slice(0, 100));
          else toast.success(`Raw sync запущен (batch ${d.batchId?.slice(0, 8)}…) — может занять несколько минут`);
          setTimeout(invalidateAll, 10000);
          setTimeout(invalidateAll, 60000);
          setTimeout(invalidateAll, 180000);
        },
        onError: () => toast.error('Ошибка запуска raw sync'),
      },
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold text-gray-900 leading-tight">AlphaCRM Coverage Audit</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">Технический аудит источника данных — сырой слой, без финальной сверки</p>
        </div>
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 shrink-0"
          onClick={invalidateAll}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Warning */}
      <WarningBanner />

      {/* Environment */}
      <EnvironmentPanel />

      {/* Controls */}
      <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-3">
        {/* Out-of-scope warning */}
        {isOutOfScope && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <p className="text-[11px] text-amber-800">
              <strong>⚠ Branch {branchId} вне активного scope</strong> (scope = Atlas, branchId={scopeBranchId}). Raw Sync потребует подтверждение.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-500">Branch:</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={`h-7 px-2 rounded-lg border text-[12px] focus:outline-none ${isOutOfScope ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}
            >
              <option value="6">6 — Атлас 🎯 (scope)</option>
              <option value="1">1 — Онлайн школа</option>
              <option value="2">2 — Лиственная</option>
              <option value="3">3 — Остров</option>
              <option value="4">4 — Лыжный</option>
              <option value="5">5 — Онлайн Школа</option>
              <option value="7">7 — Кемпинг</option>
              <option value="8">8 — Школа 1-11</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-500">From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-7 px-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-500">To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-7 px-2 rounded-lg border border-gray-200 text-[12px] focus:outline-none"
            />
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              disabled={discoverMut.isPending}
              onClick={handleDiscover}
              className="flex items-center gap-1.5 h-8 px-3 bg-violet-600 text-white text-[12px] font-semibold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {discoverMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Run Discovery
            </button>
            <button
              type="button"
              disabled={syncMut.isPending}
              onClick={handleSync}
              className="flex items-center gap-1.5 h-8 px-3 bg-emerald-600 text-white text-[12px] font-semibold rounded-xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {syncMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Run Raw Sync
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200 scrollbar-none">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`shrink-0 flex items-center gap-1.5 px-4 h-9 text-[12px] font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === key ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
        {tab === 'bank-p81' && (
          <>
            <SectionHeader icon={HardDrive} title="P8.1 — Bank Accounts Verification" subtitle="Аудит банковской инфраструктуры: коннекторы, счета, балансы, транзакции, владельцы, дубликаты. Вердикт готовности к P8.2." />
            <BankAccountsPanel />
          </>
        )}
        {tab === 'bank-p82' && (
          <>
            <SectionHeader icon={Activity} title="P8.2 — Bank Transactions Truth Audit" subtitle="Raw→normalized gap, инвентарь полей дат, покрытие по счетам, дубликаты, готовность контрагентного слоя. Production only." />
            <BankTransactionsPanel />
          </>
        )}
        {tab === 'cp-p83' && (
          <>
            <SectionHeader icon={Users} title="P8.3 — Counterparty Foundation" subtitle="Классификация контрагентов из bank_transactions: тип, уверенность, топ по приходу/расходу, дубли, покрытие. Production only." />
            <CounterpartiesPanel />
          </>
        )}
        {tab === 'cp-p84a' && (
          <>
            <SectionHeader icon={RefreshCw} title="P8.4a — Counterparty Reclassification Cleanup" subtitle="Исправление ошибок P8.3 классификации: внутренние компании, коммунальщики, лизинг, подрядчики. Исключение внутренних из P&L. Production only." />
            <P84aReclassificationPanel />
          </>
        )}
        {tab === 'bank-p84b' && (
          <>
            <SectionHeader icon={GitBranch} title="P8.4b — Bank ↔ AlphaCRM Reconciliation" subtitle="Сопоставление банковских транзакций с платежами AlphaCRM. Метод: amount + date window. Исключения: internal_company, collection_internal, bank_fee. Production only." />
            <BankAlphaReconciliationPanel />
          </>
        )}
        {tab === 'evotor-p85a' && (
          <>
            <SectionHeader icon={Zap} title="P8.5a — Evotor Auth Layer" subtitle="Подключение Эвотор POS: хранение Publisher Token (AES-256-GCM), OAuth callback, discovery магазинов/устройств/сотрудников. Финансовые отчёты не строятся." />
            <EvotorPanel />
          </>
        )}
        {tab === 'final-report' && (
          <>
            <SectionHeader icon={ClipboardList} title="P7.7 — Финальный отчёт AlphaCRM" subtitle="Итоговый технический и бизнес-читаемый отчёт Big AlphaCRM Audit. Статус нормализации, идентификации, платежей и готовность к Bank Reconciliation." />
            <FinalAuditReportPanel branchId={branchId} />
          </>
        )}
        {tab === 'scope' && (
          <>
            <SectionHeader icon={Target} title="Scope Lock — Atlas Only" subtitle="Управление активным scope синхронизации. Только Атлас участвует в raw sync и нормализации данных." />
            <ScopePanel />
          </>
        )}
        {tab === 'atlas' && (
          <>
            <SectionHeader icon={MapPin} title="Atlas Branch Summary" subtitle="Сводка по сырым данным ветки Атлас — счётчики, даты, статус endpoints" />
            <AtlasSummaryPanel />
          </>
        )}
        {tab === 'verify' && (
          <>
            <SectionHeader icon={Shield} title="Verification Report" subtitle="Глубокий аудит AlphaCRM: ветки, объёмы, дата-фильтры, пагинация, подозрительные числа" />
            <VerificationReport fromDate={fromDate} toDate={toDate} />
          </>
        )}
        {tab === 'registry' && (
          <>
            <SectionHeader icon={List} title="Endpoint Registry" subtitle="Результаты последнего discovery — статус каждого AlphaCRM endpoint" />
            <RegistryTable branchId={branchId} />
          </>
        )}
        {tab === 'summary' && (
          <>
            <SectionHeader icon={BarChart3} title="Coverage Summary" subtitle="Сводка по сохранённым сырым записям per entity type" />
            <SummaryTable />
          </>
        )}
        {tab === 'batches' && (
          <>
            <SectionHeader icon={Clock} title="Sync Batch History" subtitle="История всех запусков discovery и raw sync" />
            <BatchHistory />
          </>
        )}
        {tab === 'fields' && (
          <>
            <SectionHeader icon={Database} title="Field Inventory" subtitle="Какие поля AlphaCRM присутствуют в сырых записях" />
            <div className="mb-3 flex gap-2">
              <input
                className="h-7 px-2.5 rounded-xl border border-gray-200 text-[12px] focus:outline-none focus:border-violet-400"
                placeholder="Entity type filter"
                value={fieldEntityFilter}
                onChange={(e) => setFieldEntityFilter(e.target.value)}
              />
            </div>
            <FieldInventory entityType={fieldEntityFilter} />
          </>
        )}
        {tab === 'issues' && (
          <>
            <SectionHeader icon={Bug} title="Linking Issues" subtitle="Проблемы привязки — payment_unlinked, lesson_subject_missing и т.д." />
            <IssuesPanel />
          </>
        )}
        {tab === 'raw' && (
          <>
            <SectionHeader icon={Eye} title="Raw Records Browser" subtitle="Просмотр полных JSON-payload из alpha_raw_records" />
            <RawRecordsBrowser />
          </>
        )}
        {tab === 'audit-norm' && (
          <>
            <SectionHeader icon={FlaskConical} title="P7 — Нормализация (Raw → Internal)" subtitle="Сколько raw-записей стали нормализованными сущностями. Пробелы = данные потеряны при нормализации." />
            <NormalizationAuditPanel branchId={branchId} />
          </>
        )}
        {tab === 'audit-recon' && (
          <>
            <SectionHeader icon={Activity} title="P7 — Сверка сущностей" subtitle="Raw vs Normalized vs Identity layer. Статус каждой группы сущностей по всем слоям системы." />
            <EntityReconciliationPanel branchId={branchId} />
            <div className="mt-6">
              <div className="text-[13px] font-semibold text-gray-700 mb-3">💳 Платежи AlphaCRM — Нормализация и аудит (P7.5)</div>
              <PaymentAuditPanel branchId={branchId} />
            </div>
            <div className="mt-6">
              <div className="text-[13px] font-semibold text-gray-700 mb-3">🧹 Платежи AlphaCRM — Очистка и риск-флаги (P7.6)</div>
              <PaymentCleanupPanel branchId={branchId} />
            </div>
            <div className="mt-6">
              <div className="text-[13px] font-semibold text-gray-700 mb-3">🪪 Покрытие идентичности в посещениях (P7.4.1)</div>
              <AttendanceIdentityPanel branchId={branchId} />
            </div>
          </>
        )}
        {tab === 'audit-dups' && (
          <>
            <SectionHeader icon={ShieldAlert} title="P7 — Дубликаты" subtitle="Кандидаты на дублирование студентов, семей, учителей. Детекция только — без авто-слияния." />
            <DuplicatesPanel branchId={branchId} />
          </>
        )}
      </div>
    </div>
  );
}
