import {
  useGetSyncStats, useGetMarketingStats,
  useGetBankingCashflow, useGetBankingAlerts, useGetBankingForecast,
  useGetFamiliesAtRisk, useGetIdentityFamilies,
  getGetSyncStatsQueryKey, getGetMarketingStatsQueryKey,
  getGetBankingCashflowQueryKey, getGetBankingAlertsQueryKey,
  getGetBankingForecastQueryKey, getGetFamiliesAtRiskQueryKey,
  getGetIdentityFamiliesQueryKey,
  type FamilyAtRisk,
} from '@workspace/api-client-react';
import { useNavigation } from '@/context/NavigationContext';
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Zap, ArrowRight, Banknote, Megaphone, Users, BarChart3,
  ArrowUpRight, ArrowDownRight, Clock, Phone, Eye,
  Info, Loader2, WifiOff, Target, ChevronRight, Plug,
  Activity, Shield, Flame, Calendar,
} from 'lucide-react';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  glass: 'bg-white/[0.92] backdrop-blur-sm rounded-[28px] border border-black/[0.08] shadow-[0_18px_50px_rgba(15,23,42,0.08)]',
  glassStrong: 'bg-white rounded-[28px] border border-black/[0.08] shadow-[0_18px_50px_rgba(15,23,42,0.08)]',
  glassSmall: 'bg-white/[0.92] backdrop-blur-sm rounded-[20px] border border-black/[0.08] shadow-[0_8px_24px_rgba(15,23,42,0.06)]',
  pagePad: 'px-5 sm:px-7 lg:px-8',
  sectionGap: 'space-y-7',
  metricVal: 'font-bold text-[#0F172A] tabular-nums whitespace-nowrap overflow-hidden text-ellipsis',
  textPrimary: 'text-[#0F172A]',
  textSecondary: 'text-[#667085]',
  purple: '#7C3AED',
  green: '#10B981',
  red: '#EF4444',
  orange: '#F97316',
  blue: '#2563EB',
};

// ─── Formatters ────────────────────────────────────────────────────────────────
function formatCompactRub(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} млн ₽`;
  if (abs >= 100_000)   return `${sign}${Math.round(abs / 1000)} тыс. ₽`;
  if (abs >= 1_000)     return `${sign}${(abs / 1000).toFixed(1).replace('.0', '')} тыс. ₽`;
  return `${sign}${Math.round(abs).toLocaleString('ru-RU')} ₽`;
}

function fmtRubFull(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function fmtNum(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('ru-RU');
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
}

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

// ─── Micro components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
    </div>
  );
}

function SectionTitle({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <h2 className="text-[19px] font-bold text-[#0F172A] tracking-tight leading-tight">{title}</h2>
        {subtitle && <p className="text-[13px] text-[#667085] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function ConnectCTA({
  icon, title, body, btn1, btn2,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  btn1: string;
  btn2?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center py-8 px-6 gap-4">
      <div className="w-14 h-14 rounded-3xl bg-[#F6F7FB] flex items-center justify-center text-[#7C3AED]">
        {icon}
      </div>
      <div>
        <p className="text-[15px] font-semibold text-[#0F172A]">{title}</p>
        <p className="text-[13px] text-[#667085] mt-1 max-w-xs mx-auto leading-relaxed">{body}</p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <button className="px-4 py-2.5 rounded-[14px] bg-[#7C3AED] text-white text-[13px] font-semibold min-h-[44px] hover:bg-violet-700 transition-colors">
          {btn1}
        </button>
        {btn2 && (
          <button className="px-4 py-2.5 rounded-[14px] bg-[#F6F7FB] text-[#667085] text-[13px] font-medium min-h-[44px] hover:bg-gray-100 transition-colors">
            {btn2}
          </button>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: 'good' | 'warn' | 'risk' }) {
  const map = {
    good: 'bg-[#10B981]',
    warn: 'bg-[#F97316]',
    risk: 'bg-[#EF4444]',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${map[status]} animate-pulse`} />
  );
}

// ─── HERO STATUS CARD ──────────────────────────────────────────────────────────

function HeroStatusCard() {
  const navigate = useNavigation();
  const { data: cashflow, isLoading: cashLoading } = useGetBankingCashflow({
    query: { queryKey: getGetBankingCashflowQueryKey(), refetchInterval: 60_000 },
  });
  const { data: atRisk, isLoading: riskLoading } = useGetFamiliesAtRisk(
    { limit: 100 },
    { query: { queryKey: getGetFamiliesAtRiskQueryKey({ limit: 100 }), refetchInterval: 60_000 } },
  );
  const { data: mktStats, isLoading: mktLoading } = useGetMarketingStats({
    query: { queryKey: getGetMarketingStatsQueryKey(), refetchInterval: 30_000 },
  });
  const { data: syncStats } = useGetSyncStats({
    query: { queryKey: getGetSyncStatsQueryKey(), refetchInterval: 30_000 },
  });

  const loading = cashLoading || riskLoading || mktLoading;

  const hasBanking = cashflow?.hasLiveData;
  const totalBalance = toNum(cashflow?.totalBalance);
  const riskFamilies = (atRisk?.families ?? []).filter((f) => toNum(f.churn_risk_score) > 0.5).length;
  const totalLeads = toNum(mktStats?.totalLeads);
  const studentCount = toNum(syncStats?.students);

  const today = new Date().toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });

  let overallStatus: 'good' | 'warn' | 'risk' = 'good';
  let statusLabel = 'Всё в порядке';
  let statusBody = '';

  if (!hasBanking && studentCount === 0) {
    overallStatus = 'warn';
    statusLabel = 'Настройка системы';
    statusBody = 'Данных по банкам и CRM пока нет. Подключите источники для полной картины.';
  } else if (!hasBanking) {
    overallStatus = 'warn';
    statusLabel = 'Банк не подключён';
    statusBody = `CRM работает — ${fmtNum(studentCount)} учеников синхронизировано. Подключите банк для финансовой аналитики.`;
  } else if (riskFamilies > 3) {
    overallStatus = 'risk';
    statusLabel = 'Требует внимания';
    statusBody = `${riskFamilies} семей в зоне риска ухода. Касса: ${formatCompactRub(totalBalance)}.`;
  } else if (riskFamilies > 0) {
    overallStatus = 'warn';
    statusLabel = 'Незначительные риски';
    statusBody = `${riskFamilies} семей под наблюдением. Касса стабильна: ${formatCompactRub(totalBalance)}.`;
  } else if (hasBanking) {
    overallStatus = 'good';
    statusLabel = 'Бизнес работает стабильно';
    statusBody = `Касса: ${formatCompactRub(totalBalance)}. ${fmtNum(atRisk?.total)} семей, рисков нет.`;
  }

  const statusColors = {
    good: { bg: 'from-emerald-500 to-teal-500', badge: 'bg-emerald-100 text-emerald-800', dot: 'good' as const },
    warn: { bg: 'from-amber-500 to-orange-500', badge: 'bg-amber-100 text-amber-800', dot: 'warn' as const },
    risk: { bg: 'from-red-500 to-rose-500', badge: 'bg-red-100 text-red-800', dot: 'risk' as const },
  };
  const sc = statusColors[overallStatus];

  if (loading) {
    return (
      <div className={`${C.glass} p-6`}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className={`${C.glass} overflow-hidden`}>
      {/* Gradient stripe */}
      <div className={`h-1.5 bg-gradient-to-r ${sc.bg} rounded-t-[28px]`} />

      <div className="p-6">
        {/* Top row */}
        <div className="flex items-start justify-between mb-5 gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <StatusDot status={sc.dot} />
              <span className={`text-[12px] font-semibold px-2.5 py-0.5 rounded-full ${sc.badge}`}>
                {statusLabel}
              </span>
            </div>
            <h1 className="text-[26px] sm:text-[30px] font-bold text-[#0F172A] tracking-tight leading-tight">
              Пульс бизнеса
            </h1>
            <p className="text-[13px] text-[#667085] mt-1 capitalize">{today}</p>
          </div>
          <div className="shrink-0 flex flex-col items-center gap-1">
            <img
              src="https://upload.wikimedia.org/wikipedia/en/a/aa/Bart_Simpson_200px.png"
              alt="Bart Simpson"
              className="w-16 h-16 object-contain drop-shadow-sm"
            />
            <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 rounded-full border border-emerald-100">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-semibold text-emerald-700">live</span>
            </div>
          </div>
        </div>

        {/* Status message */}
        {statusBody && (
          <p className="text-[14px] text-[#667085] mb-5 leading-relaxed">{statusBody}</p>
        )}

        {/* Quick metrics row */}
        <div className="grid grid-cols-3 gap-3">
          <div
            className="bg-[#F6F7FB] rounded-[18px] p-3.5 cursor-pointer hover:bg-gray-100 transition-colors active:bg-gray-200"
            onClick={() => navigate('money')}
          >
            <p className="text-[11px] text-[#667085] mb-1">Касса</p>
            <p className={`text-[15px] font-bold whitespace-nowrap overflow-hidden text-ellipsis tabular-nums ${hasBanking ? 'text-[#0F172A]' : 'text-[#667085]'}`}>
              {hasBanking ? formatCompactRub(totalBalance) : 'Нет данных'}
            </p>
          </div>
          <div
            className="bg-[#F6F7FB] rounded-[18px] p-3.5 cursor-pointer hover:bg-gray-100 transition-colors active:bg-gray-200"
            onClick={() => navigate('marketing')}
          >
            <p className="text-[11px] text-[#667085] mb-1">Лиды</p>
            <p className={`text-[15px] font-bold tabular-nums ${totalLeads > 0 ? 'text-[#0F172A]' : 'text-[#667085]'}`}>
              {totalLeads > 0 ? fmtNum(totalLeads) : 'Нет данных'}
            </p>
          </div>
          <div
            className="bg-[#F6F7FB] rounded-[18px] p-3.5 cursor-pointer hover:bg-gray-100 transition-colors active:bg-gray-200"
            onClick={() => navigate('families')}
          >
            <p className="text-[11px] text-[#667085] mb-1">Семьи в риске</p>
            <p className={`text-[15px] font-bold tabular-nums ${riskFamilies > 0 ? 'text-[#EF4444]' : 'text-[#10B981]'}`}>
              {atRisk ? (riskFamilies > 0 ? `${riskFamilies} ⚠` : 'Норма') : 'Нет данных'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── COMPACT KPI CARDS ─────────────────────────────────────────────────────────

interface KpiProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: 'up' | 'down' | 'flat' | null;
  trendLabel?: string;
  noData?: boolean;
  noDataLabel?: string;
  loading?: boolean;
  ctaLabel?: string;
  onClick?: () => void;
}

function MetricCard({ icon, iconBg, label, value, sub, trend, trendLabel, noData, noDataLabel, loading, ctaLabel, onClick }: KpiProps) {
  const trendColor = trend === 'up' ? 'text-[#10B981]' : trend === 'down' ? 'text-[#EF4444]' : 'text-[#667085]';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Activity;

  return (
    <div
      className={`${C.glassSmall} p-4 flex flex-col min-h-[130px] ${onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        {trend && trendLabel && !noData && !loading && (
          <div className={`flex items-center gap-0.5 text-[11px] font-semibold ${trendColor}`}>
            <TrendIcon className="w-3 h-3" />
            {trendLabel}
          </div>
        )}
      </div>
      <p className="text-[12px] font-medium text-[#667085] mb-1">{label}</p>
      {loading ? (
        <div className="flex-1 flex items-center">
          <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
        </div>
      ) : noData ? (
        <div className="flex-1 flex flex-col justify-between">
          <p className="text-[13px] font-semibold text-[#667085]">{noDataLabel ?? 'Нет данных'}</p>
          {ctaLabel && (
            <button className="mt-2 text-[11px] font-semibold text-[#7C3AED] flex items-center gap-1 hover:opacity-70 transition-opacity">
              <Plug className="w-3 h-3" />{ctaLabel}
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-between">
          <div className={`text-[clamp(22px,5vw,32px)] leading-tight ${C.metricVal}`}>{value}</div>
          {sub && <p className="text-[12px] text-[#667085] mt-1 leading-snug">{sub}</p>}
        </div>
      )}
    </div>
  );
}

function PulseKPISection() {
  const navigate = useNavigation();
  const { data: cashflow, isLoading: cashLoading } = useGetBankingCashflow({
    query: { queryKey: getGetBankingCashflowQueryKey(), refetchInterval: 60_000 },
  });
  const { data: syncStats, isLoading: syncLoading } = useGetSyncStats({
    query: { queryKey: getGetSyncStatsQueryKey(), refetchInterval: 30_000 },
  });
  const { data: mktStats, isLoading: mktLoading } = useGetMarketingStats({
    query: { queryKey: getGetMarketingStatsQueryKey(), refetchInterval: 30_000 },
  });
  const { data: atRisk, isLoading: atRiskLoading } = useGetFamiliesAtRisk(
    { limit: 100 },
    { query: { queryKey: getGetFamiliesAtRiskQueryKey({ limit: 100 }), refetchInterval: 60_000 } },
  );
  const { data: familiesData, isLoading: familiesLoading } = useGetIdentityFamilies(
    {},
    { query: { queryKey: getGetIdentityFamiliesQueryKey({}), staleTime: 60_000 } },
  );

  const hasBanking = cashflow?.hasLiveData;
  const totalBalance = toNum(cashflow?.totalBalance);
  const todayNet = toNum(cashflow?.netToday);
  const riskCount = (atRisk?.families ?? []).filter((f) => toNum(f.churn_risk_score) > 0.5).length;
  const totalFamilies = toNum(familiesData?.total ?? atRisk?.total);
  const totalLeads = toNum(mktStats?.totalLeads);
  const converted = toNum(mktStats?.matched);
  const convRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;
  const studentCount = toNum(syncStats?.students);
  const riskLoading = atRiskLoading || familiesLoading;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
      <MetricCard
        icon={<Banknote className="w-4.5 h-4.5 text-[#10B981]" />}
        iconBg="bg-emerald-50"
        label="Касса"
        loading={cashLoading}
        noData={!hasBanking}
        noDataLabel="Банк не подключён"
        ctaLabel="Подключить банк"
        value={formatCompactRub(totalBalance)}
        sub={todayNet !== 0 ? (
          <span className={todayNet > 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}>
            {todayNet > 0 ? '+' : ''}{formatCompactRub(todayNet)} сегодня
          </span>
        ) : 'Нет движения'}
        trend={hasBanking ? (todayNet > 0 ? 'up' : todayNet < 0 ? 'down' : 'flat') : null}
        onClick={() => navigate('money')}
      />

      <MetricCard
        icon={<Megaphone className="w-4.5 h-4.5 text-[#7C3AED]" />}
        iconBg="bg-violet-50"
        label="Лиды"
        loading={mktLoading}
        noData={!mktStats || totalLeads === 0}
        noDataLabel="Источник не подключён"
        ctaLabel="Подключить лиды"
        value={fmtNum(totalLeads)}
        sub={`конверсия ${convRate}%`}
        trend={converted > 0 ? 'up' : null}
        onClick={() => navigate('marketing')}
      />

      <MetricCard
        icon={<Target className="w-4.5 h-4.5 text-[#2563EB]" />}
        iconBg="bg-blue-50"
        label="Конверсии"
        loading={mktLoading}
        noData={!mktStats || totalLeads === 0}
        noDataLabel="Нет данных"
        value={fmtNum(converted)}
        sub={`из ${fmtNum(totalLeads)} лидов`}
        trend={converted > 0 ? 'up' : null}
        onClick={() => navigate('marketing')}
      />

      <MetricCard
        icon={<Users className="w-4.5 h-4.5 text-[#2563EB]" />}
        iconBg="bg-blue-50"
        label="Ученики"
        loading={syncLoading}
        noData={studentCount === 0}
        noDataLabel="Нет синхронизации"
        ctaLabel="Синхронизировать"
        value={fmtNum(studentCount)}
        sub={syncStats?.lastSyncAt ? `Обновлено ${fmtDate(syncStats.lastSyncAt)}` : 'Не синхронизировано'}
        trend={studentCount > 0 ? 'up' : null}
        onClick={() => navigate('families')}
      />

      <MetricCard
        icon={<Users className="w-4.5 h-4.5 text-[#F97316]" />}
        iconBg="bg-orange-50"
        label="Семьи"
        loading={riskLoading}
        noData={totalFamilies === 0}
        noDataLabel="Семьи не построены. Синхронизируйте учеников и нажмите «Обновить семьи»"
        ctaLabel="Открыть раздел Семьи"
        value={fmtNum(totalFamilies)}
        sub={riskCount > 0
          ? <span className="text-[#EF4444]">{riskCount} в риске</span>
          : 'Рисков нет'}
        trend={riskCount > 0 ? 'down' : (totalFamilies > 0 ? 'up' : null)}
        trendLabel={riskCount > 0 ? `${riskCount} рисков` : undefined}
        onClick={() => navigate('families')}
      />

      <MetricCard
        icon={<BarChart3 className="w-4.5 h-4.5 text-[#10B981]" />}
        iconBg="bg-emerald-50"
        label="Runway"
        loading={cashLoading}
        noData={!hasBanking || cashflow?.runwayDays == null}
        noDataLabel="Подключите банк для прогноза кассы"
        value={cashflow?.runwayDays != null ? `${cashflow.runwayDays}` : '—'}
        sub="дней запаса кассы"
        trend={cashflow?.runwayDays != null
          ? (cashflow.runwayDays > 60 ? 'up' : cashflow.runwayDays > 30 ? 'flat' : 'down')
          : null}
        onClick={() => navigate('money')}
      />
    </div>
  );
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────

interface PulseAlert {
  id: string;
  severity: 'critical' | 'warning' | 'good' | 'info';
  title: string;
  description: string;
  action?: string;
}

const ALERT_CFG = {
  critical: {
    bg: 'bg-red-50',
    left: 'border-l-[#EF4444]',
    icon: 'text-[#EF4444]',
    label: 'Критично',
    labelCls: 'text-red-700',
    Icon: AlertTriangle,
  },
  warning: {
    bg: 'bg-amber-50',
    left: 'border-l-[#F97316]',
    icon: 'text-[#F97316]',
    label: 'Внимание',
    labelCls: 'text-amber-700',
    Icon: AlertTriangle,
  },
  good: {
    bg: 'bg-emerald-50',
    left: 'border-l-[#10B981]',
    icon: 'text-[#10B981]',
    label: 'Хорошо',
    labelCls: 'text-emerald-700',
    Icon: CheckCircle2,
  },
  info: {
    bg: 'bg-blue-50',
    left: 'border-l-[#2563EB]',
    icon: 'text-[#2563EB]',
    label: 'Информация',
    labelCls: 'text-blue-700',
    Icon: Info,
  },
};

function AlertCard({ alert }: { alert: PulseAlert }) {
  const cfg = ALERT_CFG[alert.severity];
  const { Icon } = cfg;
  return (
    <div className={`flex items-start gap-3.5 p-4 rounded-[18px] border-l-4 ${cfg.bg} ${cfg.left}`}>
      <Icon className={`w-4.5 h-4.5 mt-0.5 shrink-0 ${cfg.icon}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.labelCls}`}>{cfg.label}</span>
        </div>
        <p className="text-[14px] font-semibold text-[#0F172A] leading-snug">{alert.title}</p>
        <p className="text-[12px] text-[#667085] mt-0.5">{alert.description}</p>
      </div>
      {alert.action && (
        <div className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-[#667085] hover:text-[#0F172A] cursor-pointer transition-colors">
          {alert.action} <ArrowRight className="w-3 h-3" />
        </div>
      )}
    </div>
  );
}

function PulseAlertsSection() {
  const { data: bankAlerts, isLoading } = useGetBankingAlerts({
    query: { queryKey: getGetBankingAlertsQueryKey(), refetchInterval: 120_000 },
  });
  const { data: atRisk } = useGetFamiliesAtRisk(
    { limit: 5 },
    { query: { queryKey: getGetFamiliesAtRiskQueryKey({ limit: 5 }), refetchInterval: 60_000 } },
  );
  const { data: cashflow } = useGetBankingCashflow({
    query: { queryKey: getGetBankingCashflowQueryKey(), refetchInterval: 60_000 },
  });
  const { data: forecast } = useGetBankingForecast({
    query: { queryKey: getGetBankingForecastQueryKey(), refetchInterval: 300_000 },
  });

  const alerts: PulseAlert[] = [];

  if (forecast?.cashGapDate && forecast.hasData) {
    const daysUntil = Math.round((new Date(forecast.cashGapDate).getTime() - Date.now()) / 86_400_000);
    if (daysUntil > 0 && daysUntil < 45) {
      alerts.unshift({
        id: 'cash_gap',
        severity: daysUntil < 14 ? 'critical' : 'warning',
        title: `Риск кассового разрыва через ${daysUntil} дней`,
        description: `Прогнозируемый нулевой остаток: ${fmtDate(forecast.cashGapDate)}`,
        action: 'Деньги',
      });
    }
  }

  (bankAlerts?.alerts ?? []).slice(0, 2).forEach((a) => {
    alerts.push({
      id: a.id,
      severity: a.severity === 'critical' ? 'critical' : 'warning',
      title: a.message,
      description: `Тип: ${a.type}`,
      action: 'Деньги',
    });
  });

  const highRisk = (atRisk?.families ?? []).filter((f) => toNum(f.churn_risk_score) > 0.6);
  if (highRisk.length > 0) {
    const f = highRisk[0];
    alerts.push({
      id: `fam_${f.family_id}`,
      severity: 'warning',
      title: `${highRisk.length} ${highRisk.length === 1 ? 'семья' : 'семьи'} в зоне высокого риска`,
      description: `Пример: ${f.family_name ?? f.guardian_name ?? 'Семья'} · риск ${Math.round(toNum(f.churn_risk_score) * 100)}%`,
      action: 'Семьи',
    });
  }

  if (cashflow?.hasLiveData && toNum(cashflow.netToday) > 0) {
    alerts.push({
      id: 'good_cashflow',
      severity: 'good',
      title: `Положительный баланс сегодня: +${formatCompactRub(toNum(cashflow.netToday))}`,
      description: 'Поступления превышают расходы',
    });
  }

  if (isLoading) return <Spinner />;

  if (alerts.length === 0) {
    return (
      <div className={`${C.glassSmall} flex items-center gap-3.5 px-5 py-4`}>
        <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-[#0F172A]">Всё спокойно</p>
          <p className="text-[12px] text-[#667085]">Критичных событий нет</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.slice(0, 4).map((a) => <AlertCard key={a.id} alert={a} />)}
    </div>
  );
}

// ─── ПЛАН / ФАКТ ──────────────────────────────────────────────────────────────

function PlanFactRow({ label, fact, plan, isRub }: {
  label: string;
  fact: number | null;
  plan: number | null;
  isRub?: boolean;
}) {
  const pct = plan && plan > 0 && fact != null ? Math.min(Math.round((fact / plan) * 100), 100) : null;
  const barColor = pct == null ? 'bg-gray-200' : pct >= 90 ? 'bg-[#10B981]' : pct >= 60 ? 'bg-[#F97316]' : 'bg-[#EF4444]';
  const pctColor = pct == null ? 'text-[#667085]' : pct >= 90 ? 'text-[#10B981]' : pct >= 60 ? 'text-[#F97316]' : 'text-[#EF4444]';
  const fmt2 = (n: number | null) => n == null ? '—' : isRub ? formatCompactRub(n) : fmtNum(n);

  return (
    <div className="flex items-center gap-3 py-3 border-b border-black/[0.04] last:border-0">
      <div className="w-[90px] sm:w-[110px] shrink-0 text-[13px] font-medium text-[#0F172A]">{label}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden min-w-0">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct ?? 0}%` }} />
          </div>
          <span className={`text-[11px] font-bold w-9 text-right tabular-nums shrink-0 ${pctColor}`}>
            {pct != null ? `${pct}%` : '—'}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 text-[11px] text-[#667085]">
          <span>Факт: <span className="font-semibold text-[#0F172A]">{fmt2(fact)}</span></span>
          <span>План: <span className="text-[#667085]">{fmt2(plan)}</span></span>
        </div>
      </div>
    </div>
  );
}

function PulsePlanFactSection() {
  const { data: syncStats } = useGetSyncStats({ query: { queryKey: getGetSyncStatsQueryKey() } });
  const { data: mktStats } = useGetMarketingStats({ query: { queryKey: getGetMarketingStatsQueryKey() } });

  const hasAnyPlan = false;

  const rows = [
    { label: 'Лиды',       fact: toNum(mktStats?.totalLeads), plan: null as number | null },
    { label: 'Конверсии',  fact: toNum(mktStats?.matched),    plan: null as number | null },
    { label: 'Ученики',    fact: toNum(syncStats?.students),  plan: null as number | null },
    { label: 'Платежи',    fact: toNum(syncStats?.payments),  plan: null as number | null },
  ];

  if (!hasAnyPlan) {
    return (
      <div className={`${C.glass} p-6`}>
        <div className="flex items-start justify-between mb-5 gap-3">
          <div>
            <h3 className="text-[17px] font-bold text-[#0F172A]">План / Факт</h3>
            <p className="text-[12px] text-[#667085] mt-0.5">Ключевые показатели месяца</p>
          </div>
          <span className="text-[11px] font-medium px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-100 shrink-0">
            Текущий месяц
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 bg-[#F6F7FB] rounded-[20px] p-5 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center shrink-0 shadow-sm">
            <Target className="w-5 h-5 text-[#7C3AED]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[#0F172A]">План не настроен</p>
            <p className="text-[13px] text-[#667085] mt-0.5 leading-relaxed">
              Задайте план по лидам, ученикам, оплатам и выручке — система будет считать выполнение и прогноз.
            </p>
          </div>
          <button className="shrink-0 px-4 py-2.5 rounded-[14px] bg-[#7C3AED] text-white text-[13px] font-semibold min-h-[44px] hover:bg-violet-700 transition-colors whitespace-nowrap">
            Настроить план
          </button>
        </div>

        <div className="space-y-0">
          {rows.map((r) => (
            <PlanFactRow key={r.label} {...r} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`${C.glass} p-6`}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[17px] font-bold text-[#0F172A]">План / Факт</h3>
        <span className="text-[11px] font-medium px-2.5 py-1 bg-gray-100 text-[#667085] rounded-full">Текущий месяц</span>
      </div>
      {rows.map((r) => <PlanFactRow key={r.label} {...r} />)}
    </div>
  );
}

// ─── ФИНАНСЫ ──────────────────────────────────────────────────────────────────

function PulseFinanceSection() {
  const { data: cashflow, isLoading } = useGetBankingCashflow({
    query: { queryKey: getGetBankingCashflowQueryKey(), refetchInterval: 60_000 },
  });
  const { data: forecast } = useGetBankingForecast({
    query: { queryKey: getGetBankingForecastQueryKey(), refetchInterval: 300_000 },
  });

  if (isLoading) {
    return <div className={`${C.glass} p-6`}><Spinner /></div>;
  }

  const hasData = cashflow?.hasLiveData;

  if (!hasData) {
    return (
      <div className={`${C.glass} overflow-hidden`}>
        <div className="p-6 border-b border-black/[0.06]">
          <h3 className="text-[17px] font-bold text-[#0F172A]">ДДС и остатки</h3>
          <p className="text-[12px] text-[#667085] mt-0.5">Движение денег, счета, прогноз кассы</p>
        </div>
        <ConnectCTA
          icon={<Banknote className="w-7 h-7" />}
          title="Банк не подключён"
          body="После подключения появятся живые остатки, ДДС и прогноз кассы. Поддерживаются Точка, Т-Банк, ВТБ и выгрузка CSV."
          btn1="Настроить банк"
          btn2="Загрузить выписку"
        />
      </div>
    );
  }

  const net = toNum(cashflow?.netToday);

  return (
    <div className={`${C.glass} p-6`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-[17px] font-bold text-[#0F172A]">ДДС и остатки</h3>
          <p className="text-[12px] text-[#667085] mt-0.5">Движение денег · сегодня</p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Онлайн
        </span>
      </div>

      {/* Balance hero */}
      <div className="bg-[#F6F7FB] rounded-[20px] p-5 mb-4">
        <p className="text-[12px] text-[#667085] mb-1">Всего на счетах</p>
        <p className="text-[32px] font-bold text-[#0F172A] tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          {formatCompactRub(cashflow?.totalBalance)}
        </p>
        <p className="text-[11px] text-[#667085] mt-1">{fmtRubFull(cashflow?.totalBalance)}</p>
      </div>

      {/* ДДС grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-emerald-50 rounded-[16px] p-3.5">
          <ArrowUpRight className="w-3.5 h-3.5 text-[#10B981] mb-2" />
          <p className="text-[11px] text-emerald-700 font-medium mb-0.5">Поступления</p>
          <p className="text-[15px] font-bold text-emerald-800 tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {formatCompactRub(cashflow?.todayIncome)}
          </p>
        </div>
        <div className="bg-red-50 rounded-[16px] p-3.5">
          <ArrowDownRight className="w-3.5 h-3.5 text-[#EF4444] mb-2" />
          <p className="text-[11px] text-red-600 font-medium mb-0.5">Расходы</p>
          <p className="text-[15px] font-bold text-red-700 tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
            {formatCompactRub(cashflow?.todayExpense)}
          </p>
        </div>
        <div className={`rounded-[16px] p-3.5 ${net >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
          <BarChart3 className={`w-3.5 h-3.5 mb-2 ${net >= 0 ? 'text-[#2563EB]' : 'text-[#F97316]'}`} />
          <p className={`text-[11px] font-medium mb-0.5 ${net >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>Сальдо</p>
          <p className={`text-[15px] font-bold tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${net >= 0 ? 'text-blue-800' : 'text-orange-700'}`}>
            {net >= 0 ? '+' : ''}{formatCompactRub(net)}
          </p>
        </div>
      </div>

      {/* Footer metrics */}
      <div className="flex flex-wrap gap-4 pt-4 border-t border-black/[0.04]">
        {cashflow?.runwayDays != null && (
          <div>
            <p className="text-[11px] text-[#667085]">Runway</p>
            <p className="text-[14px] font-bold text-[#0F172A] tabular-nums">{cashflow.runwayDays} дней</p>
          </div>
        )}
        {cashflow?.avgDailyExpense != null && (
          <div>
            <p className="text-[11px] text-[#667085]">Расход/день</p>
            <p className="text-[14px] font-bold text-[#0F172A] tabular-nums whitespace-nowrap">
              {formatCompactRub(cashflow.avgDailyExpense)}
            </p>
          </div>
        )}
        {forecast?.projectedBalance30d != null && (
          <div>
            <p className="text-[11px] text-[#667085]">Прогноз 30 дней</p>
            <p className={`text-[14px] font-bold tabular-nums whitespace-nowrap ${forecast.projectedBalance30d >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
              {formatCompactRub(forecast.projectedBalance30d)}
            </p>
          </div>
        )}
      </div>

      {forecast?.cashGapDate && (
        <div className="mt-4 flex items-start gap-2.5 p-3.5 rounded-[14px] bg-red-50 border border-red-100">
          <AlertTriangle className="w-4 h-4 text-[#EF4444] mt-0.5 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold text-red-800">Риск кассового разрыва</p>
            <p className="text-[11px] text-red-600 mt-0.5">Прогноз: {fmtDate(forecast.cashGapDate)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── МАРКЕТИНГ ────────────────────────────────────────────────────────────────

function PulseMarketingSection() {
  const { data: mktStats, isLoading } = useGetMarketingStats({
    query: { queryKey: getGetMarketingStatsQueryKey(), refetchInterval: 60_000 },
  });

  if (isLoading) return <div className={`${C.glass} p-6`}><Spinner /></div>;

  const hasData = mktStats && toNum(mktStats.totalLeads) > 0;

  if (!hasData) {
    return (
      <div className={`${C.glass} overflow-hidden`}>
        <div className="p-6 border-b border-black/[0.06]">
          <h3 className="text-[17px] font-bold text-[#0F172A]">Лиды и каналы</h3>
          <p className="text-[12px] text-[#667085] mt-0.5">CPL, заявки, конверсии, эффективность источников</p>
        </div>
        <ConnectCTA
          icon={<Megaphone className="w-7 h-7" />}
          title="Источник лидов не подключён"
          body="После подключения появятся CPL, CAC, конверсии и прогноз набора. Можно загрузить лиды из Google Sheets."
          btn1="Открыть маркетинг"
          btn2="Загрузить лиды"
        />
      </div>
    );
  }

  const totalLeads = toNum(mktStats!.totalLeads);
  const converted = toNum(mktStats!.matched);
  const convRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;

  return (
    <div className={`${C.glass} p-6`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-[17px] font-bold text-[#0F172A]">Лиды и каналы</h3>
          <p className="text-[12px] text-[#667085] mt-0.5">Эффективность привлечения</p>
        </div>
        <span className="text-[12px] font-semibold text-[#7C3AED]">{fmtNum(totalLeads)} лидов</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Всего лидов',   value: fmtNum(totalLeads), color: 'text-[#0F172A]' },
          { label: 'Конверсии',     value: fmtNum(converted),  color: 'text-[#7C3AED]' },
          { label: 'Конверсия %',   value: `${convRate}%`,     color: convRate > 20 ? 'text-[#10B981]' : 'text-[#F97316]' },
          { label: 'CPL',           value: 'Нет данных',       color: 'text-[#667085]' },
        ].map((item) => (
          <div key={item.label} className="bg-[#F6F7FB] rounded-[16px] p-3.5">
            <p className="text-[11px] text-[#667085] mb-1">{item.label}</p>
            <p className={`text-[18px] font-bold tabular-nums ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <p className="text-[12px] text-[#667085] mt-4">
        Детализация по каналам появится после подключения источников расходов на рекламу
      </p>
    </div>
  );
}

// ─── СЕМЬИ В РИСКЕ ────────────────────────────────────────────────────────────

function FamilyRiskCard({ family }: { family: FamilyAtRisk }) {
  const risk = toNum(family.churn_risk_score) * 100;
  const riskBg = risk > 70 ? 'bg-red-50 border-red-100' : risk > 40 ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100';
  const riskText = risk > 70 ? 'text-[#EF4444]' : risk > 40 ? 'text-[#F97316]' : 'text-[#667085]';
  const problems: string[] = Array.isArray(family.alerts)
    ? family.alerts.map((a: { message?: string }) => a.message ?? '').filter(Boolean)
    : [];

  return (
    <div className={`${C.glassSmall} p-4`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#0F172A] truncate">
            {family.family_name ?? family.guardian_name ?? 'Семья'}
          </p>
          <p className="text-[12px] text-[#667085] mt-0.5">
            {family.active_students ?? 0} уч. · {family.inactive_students ?? 0} не активны
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border ${riskBg} ${riskText}`}>
          {risk > 0 ? `${Math.round(risk)}%` : 'Норма'}
        </span>
      </div>

      {problems.length > 0 && (
        <div className="space-y-1 mb-3">
          {problems.slice(0, 2).map((p, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[12px] text-[#667085]">
              <AlertTriangle className="w-3 h-3 text-[#F97316] mt-0.5 shrink-0" />
              <span className="leading-tight">{p}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        {family.last_payment_at && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#667085]">
            <Clock className="w-3 h-3" />
            {fmtDate(family.last_payment_at)}
          </div>
        )}
        <button className="flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:opacity-70 transition-opacity ml-auto min-h-[44px]">
          <Eye className="w-3.5 h-3.5" /> История
        </button>
      </div>
    </div>
  );
}

function PulseFamiliesSection() {
  const navigate = useNavigation();
  const { data: atRisk, isLoading: atRiskLoading } = useGetFamiliesAtRisk(
    { limit: 6 },
    { query: { queryKey: getGetFamiliesAtRiskQueryKey({ limit: 6 }), refetchInterval: 60_000 } },
  );
  const { data: familiesData, isLoading: familiesLoading } = useGetIdentityFamilies(
    {},
    { query: { queryKey: getGetIdentityFamiliesQueryKey({}), staleTime: 60_000 } },
  );

  const isLoading = atRiskLoading || familiesLoading;
  if (isLoading) return <div className={`${C.glass} p-6`}><Spinner /></div>;

  const realTotal = toNum(familiesData?.total ?? atRisk?.total);
  const families = atRisk?.families ?? [];
  const atRiskFamilies = families.filter((f) => toNum(f.churn_risk_score) > 0.2);
  const familiesBuilt = realTotal > 0;

  return (
    <div className={`${C.glass} p-6`}>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h3 className="text-[17px] font-bold text-[#0F172A]">Семьи</h3>
          <p className="text-[12px] text-[#667085] mt-0.5">
            {familiesBuilt
              ? `${realTotal} ${realTotal === 1 ? 'семья' : realTotal < 5 ? 'семьи' : 'семей'} · ${atRiskFamilies.length} требуют внимания`
              : 'Ученики и родители, объединённые по телефону'}
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 text-[13px] font-semibold text-[#7C3AED] hover:opacity-70 transition-opacity min-h-[44px]"
          onClick={() => navigate('families')}
        >
          Все семьи <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {!familiesBuilt ? (
        <div className="flex flex-col items-center text-center py-6 px-4 gap-4">
          <div className="w-14 h-14 rounded-3xl bg-[#F6F7FB] flex items-center justify-center text-[#7C3AED]">
            <Users className="w-7 h-7" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[#0F172A]">Семьи ещё не собраны</p>
            <p className="text-[13px] text-[#667085] mt-1 max-w-sm mx-auto leading-relaxed">
              Система объединит учеников по телефонам родителей и покажет историю оплат, посещений и записей.
            </p>
          </div>
          <button
            className="px-4 py-2.5 rounded-[14px] bg-[#7C3AED] text-white text-[13px] font-semibold min-h-[44px] hover:bg-violet-700 transition-colors"
            onClick={() => navigate('families')}
          >
            Открыть раздел Семьи
          </button>
        </div>
      ) : atRiskFamilies.length === 0 ? (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-[18px] cursor-pointer hover:bg-emerald-100 transition-colors" onClick={() => navigate('families')}>
          <CheckCircle2 className="w-5 h-5 text-[#10B981] shrink-0" />
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-emerald-800">Все семьи в хорошем состоянии</p>
            <p className="text-[12px] text-emerald-700">{realTotal} семей под наблюдением — рисков нет</p>
          </div>
          <ChevronRight className="w-4 h-4 text-emerald-600 shrink-0" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {atRiskFamilies.slice(0, 6).map((f) => (
            <FamilyRiskCard key={f.family_id} family={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ЧТО СДЕЛАТЬ СЕГОДНЯ ─────────────────────────────────────────────────────

interface TodayAction {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  cta: string;
  icon: React.ReactNode;
}

const PRIO_CFG = {
  high:   { dot: 'bg-[#EF4444]', label: 'Срочно',  cls: 'text-red-700 bg-red-50' },
  medium: { dot: 'bg-[#F97316]', label: 'Важно',   cls: 'text-amber-700 bg-amber-50' },
  low:    { dot: 'bg-[#2563EB]', label: 'Планово', cls: 'text-blue-700 bg-blue-50' },
};

function ActionItem({ action }: { action: TodayAction }) {
  const cfg = PRIO_CFG[action.priority];
  return (
    <div className="flex items-start gap-3.5 py-4 border-b border-black/[0.04] last:border-0">
      <div className="w-9 h-9 shrink-0 bg-[#F6F7FB] rounded-[12px] flex items-center justify-center text-[#667085] mt-0.5">
        {action.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${cfg.cls}`}>
            {cfg.label}
          </span>
        </div>
        <p className="text-[14px] font-semibold text-[#0F172A] leading-snug">{action.title}</p>
        <p className="text-[12px] text-[#667085] mt-0.5">{action.reason}</p>
      </div>
      <button className="shrink-0 text-[12px] font-semibold text-[#7C3AED] flex items-center gap-0.5 hover:opacity-70 transition-opacity min-h-[44px]">
        {action.cta} <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );
}

function PulseActionsSection() {
  const { data: bankAlerts } = useGetBankingAlerts({ query: { queryKey: getGetBankingAlertsQueryKey() } });
  const { data: atRisk } = useGetFamiliesAtRisk(
    { limit: 10 },
    { query: { queryKey: getGetFamiliesAtRiskQueryKey({ limit: 10 }) } },
  );
  const { data: forecast } = useGetBankingForecast({ query: { queryKey: getGetBankingForecastQueryKey() } });
  const { data: syncStats } = useGetSyncStats({ query: { queryKey: getGetSyncStatsQueryKey() } });
  const { data: cashflow } = useGetBankingCashflow({ query: { queryKey: getGetBankingCashflowQueryKey() } });

  const actions: TodayAction[] = [];

  if (forecast?.cashGapDate && forecast.hasData) {
    const days = Math.round((new Date(forecast.cashGapDate).getTime() - Date.now()) / 86_400_000);
    if (days < 30) {
      actions.push({
        id: 'cashgap', priority: 'high',
        title: 'Проверить кассовую ситуацию',
        reason: `Прогнозируемый разрыв через ${days} дней`,
        cta: 'Деньги',
        icon: <Banknote className="w-4 h-4" />,
      });
    }
  }

  const highRisk = (atRisk?.families ?? []).filter((f) => toNum(f.churn_risk_score) > 0.6);
  if (highRisk.length > 0) {
    actions.push({
      id: 'family_call', priority: 'high',
      title: `Связаться с ${highRisk.length} семьями`,
      reason: `Высокий риск ухода · ${highRisk[0].family_name ?? highRisk[0].guardian_name ?? 'Семья'}`,
      cta: 'Семьи',
      icon: <Phone className="w-4 h-4" />,
    });
  }

  (bankAlerts?.alerts ?? []).slice(0, 2).forEach((a, i) => {
    actions.push({
      id: `alert_${i}`, priority: a.severity === 'critical' ? 'high' : 'medium',
      title: a.message,
      reason: `Финансовое оповещение`,
      cta: 'Подробнее',
      icon: <AlertTriangle className="w-4 h-4" />,
    });
  });

  if (!cashflow?.hasLiveData) {
    actions.push({
      id: 'connect_bank', priority: 'medium',
      title: 'Подключить банковский счёт',
      reason: 'Нужно для финансовой аналитики и прогнозов',
      cta: 'Настроить',
      icon: <Plug className="w-4 h-4" />,
    });
  }

  if (!syncStats?.lastSyncAt || new Date(syncStats.lastSyncAt) < new Date(Date.now() - 86_400_000 * 2)) {
    actions.push({
      id: 'sync', priority: 'medium',
      title: 'Синхронизировать данные из AlphaCRM',
      reason: 'Данные могут быть устаревшими',
      cta: 'Синхронизировать',
      icon: <Zap className="w-4 h-4" />,
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: 'review', priority: 'low',
      title: 'Проверить отчёт за неделю',
      reason: 'Плановая проверка показателей',
      cta: 'Отчёты',
      icon: <BarChart3 className="w-4 h-4" />,
    });
  }

  return (
    <div className={`${C.glass} p-6`}>
      <div className="flex items-end justify-between mb-1">
        <h3 className="text-[17px] font-bold text-[#0F172A]">Задачи на сегодня</h3>
        <span className="text-[12px] font-medium text-[#667085]">{actions.length} задач</span>
      </div>
      <p className="text-[12px] text-[#667085] mb-5">Сформировано автоматически на основе данных</p>
      <div>
        {actions.slice(0, 6).map((a) => <ActionItem key={a.id} action={a} />)}
      </div>
    </div>
  );
}

// ─── QUICK STATS STRIP ────────────────────────────────────────────────────────

function QuickStatsStrip() {
  const { data: syncStats } = useGetSyncStats({ query: { queryKey: getGetSyncStatsQueryKey() } });
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#667085]">
      <div className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5" />
        <span>{dateStr}</span>
      </div>
      {syncStats?.lastSyncAt && (
        <div className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-emerald-500" />
          <span>CRM: {fmtDate(syncStats.lastSyncAt)}</span>
        </div>
      )}
      {syncStats?.branches != null && (
        <div className="flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-violet-500" />
          <span>{syncStats.branches} {syncStats.branches === 1 ? 'филиал' : 'филиала'}</span>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export function PulsePage() {
  return (
    <div className={`${C.pagePad} py-6 pb-24 lg:pb-8 max-w-[1440px] mx-auto`}>
      {/* Quick stats bar */}
      <div className="mb-5">
        <QuickStatsStrip />
      </div>

      <div className={C.sectionGap}>
        {/* Hero */}
        <HeroStatusCard />

        {/* KPI grid */}
        <section>
          <SectionTitle
            title="Ключевые показатели"
            subtitle="Текущий месяц · обновляется в реальном времени"
          />
          <PulseKPISection />
        </section>

        {/* Alerts */}
        <section>
          <SectionTitle title="Оповещения" subtitle="Требуют вашего внимания" />
          <PulseAlertsSection />
        </section>

        {/* Plan / Fact */}
        <section>
          <PulsePlanFactSection />
        </section>

        {/* Finance */}
        <section>
          <PulseFinanceSection />
        </section>

        {/* Marketing */}
        <section>
          <PulseMarketingSection />
        </section>

        {/* Families */}
        <section>
          <PulseFamiliesSection />
        </section>

        {/* Actions */}
        <section>
          <PulseActionsSection />
        </section>
      </div>
    </div>
  );
}
