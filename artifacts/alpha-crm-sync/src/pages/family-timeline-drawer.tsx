import { useState, useMemo } from 'react';
import {
  useGetFamilyTimeline,
  useGetFamilyHealth,
  useGetFamilyStats,
  getGetFamilyTimelineQueryKey,
  getGetFamilyHealthQueryKey,
  getGetFamilyStatsQueryKey,
} from '@workspace/api-client-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone, GraduationCap, AlertTriangle, CreditCard,
  Calendar, UserPlus, BookOpen, Clock, ChevronDown, Loader2,
  TrendingDown, CircleAlert, CheckCircle2, Sparkles,
  BarChart2, Activity, PhoneCall, MessageCircle, ClipboardList,
  ChevronRight, Heart, Banknote, TrendingUp,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FamilyForDrawer {
  family_id?: string | null;
  family_name?: string | null;
  primary_phone?: string | null;
  guardian_name?: string | null;
  health_score?: string | null;
  churn_risk_score?: string | null;
  active_students?: number | null;
  inactive_students?: number | null;
  last_payment_at?: string | null;
  missed_lessons_30d?: number | null;
  students?: Array<{ full_name?: string | null; status?: string | null }> | null;
  alerts?: Array<{ alert_type?: string | null; severity?: string | null; message?: string | null }> | null;
}

interface EventRow {
  id?: string | null;
  event_type?: string | null;
  event_time?: string | null;
  title?: string | null;
  description?: string | null;
  amount?: string | null;
  severity?: string | null;
  student_name?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: string | null | undefined) { return v ?? '—'; }

function fmtMoney(v: string | null | undefined) {
  if (!v) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('ru', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateShort(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
}

function fmtTime(v: string | null | undefined) {
  if (!v) return '';
  return new Date(v).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateGroup(v: string | null | undefined) {
  if (!v) return 'Дата неизвестна';
  const d = new Date(v);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysSince(v: string | null | undefined): number | null {
  if (!v) return null;
  return Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000);
}

function fmtDaysAgo(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days <= 6) return `${days} дня назад`;
  if (days <= 30) return `${days} дней назад`;
  if (days <= 60) return '~месяц назад';
  return `${Math.round(days / 30)} мес. назад`;
}

// ─── Health gauge ─────────────────────────────────────────────────────────────

function HealthGauge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 75 ? '#16a34a' : pct >= 50 ? '#ca8a04' : pct >= 25 ? '#ea580c' : '#dc2626';
  const label = pct >= 75 ? 'Здоровая' : pct >= 50 ? 'Наблюдение' : pct >= 25 ? 'Риск' : 'Критично';
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className="relative w-[60px] h-[60px]">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-bold leading-none" style={{ color }}>{pct}</span>
        </div>
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>{label}</span>
    </div>
  );
}

// ─── Event type config ────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  payment_received:    { icon: <Banknote className="w-3.5 h-3.5" />,      color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', label: 'Оплата' },
  payment_overdue:     { icon: <AlertTriangle className="w-3.5 h-3.5" />,  color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         label: 'Просрочка' },
  payment_adjustment:  { icon: <AlertTriangle className="w-3.5 h-3.5" />,  color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     label: 'Корректировка' },
  lesson_attended:     { icon: <CheckCircle2 className="w-3.5 h-3.5" />,   color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',       label: 'Посещение' },
  lesson_missed:       { icon: <TrendingDown className="w-3.5 h-3.5" />,   color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200',   label: 'Пропуск' },
  subscription_started:{ icon: <UserPlus className="w-3.5 h-3.5" />,       color: 'text-violet-700',  bg: 'bg-violet-50 border-violet-200',   label: 'Записан' },
  subscription_ended:  { icon: <Clock className="w-3.5 h-3.5" />,          color: 'text-gray-700',    bg: 'bg-gray-100 border-gray-200',      label: 'Выбыл' },
  lead_created:        { icon: <BookOpen className="w-3.5 h-3.5" />,       color: 'text-sky-700',     bg: 'bg-sky-50 border-sky-200',         label: 'Лид' },
  trial_lesson:        { icon: <Calendar className="w-3.5 h-3.5" />,       color: 'text-teal-700',    bg: 'bg-teal-50 border-teal-200',       label: 'Пробный' },
  churn_risk:          { icon: <CircleAlert className="w-3.5 h-3.5" />,    color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         label: 'Риск' },
  manager_comment:     { icon: <MessageCircle className="w-3.5 h-3.5" />,  color: 'text-purple-700',  bg: 'bg-purple-50 border-purple-200',   label: 'Комментарий' },
  manager_call:        { icon: <PhoneCall className="w-3.5 h-3.5" />,      color: 'text-indigo-700',  bg: 'bg-indigo-50 border-indigo-200',   label: 'Звонок' },
};

const SEVERITY_BORDER: Record<string, string> = {
  info: 'border-l-slate-200',
  warning: 'border-l-amber-400',
  critical: 'border-l-red-500',
};

const FILTER_TABS = [
  { key: undefined,              label: 'Все' },
  { key: 'payment_received',     label: '💰 Оплаты' },
  { key: 'lesson_attended',      label: '📘 Посещения' },
  { key: 'lesson_missed',        label: '❌ Пропуски' },
  { key: 'subscription_started', label: '📋 Записи' },
  { key: 'payment_adjustment',   label: '⚠️ Корректировки' },
  { key: 'lead_created',         label: '📞 Лиды' },
] as const;

// ─── EventItem ────────────────────────────────────────────────────────────────

function EventItem({ e }: { e: EventRow }) {
  const type = e.event_type ?? 'other';
  const cfg = EVENT_CONFIG[type];
  const borderCls = SEVERITY_BORDER[e.severity ?? 'info'] ?? 'border-l-slate-200';
  return (
    <div className={`border-l-[3px] pl-3 pr-2 py-2 rounded-r-lg bg-white/60 ${borderCls}`}>
      <div className="flex items-start gap-2">
        {cfg ? (
          <span className={`mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium shrink-0 ${cfg.bg} ${cfg.color}`}>
            {cfg.icon}
            {cfg.label}
          </span>
        ) : (
          <span className="mt-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium shrink-0 bg-gray-100 text-gray-700 border-gray-200">
            <Activity className="w-3.5 h-3.5" />
            Событие
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight">{fmt(e.title)}</p>
          {e.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{e.description}</p>
          )}
          {e.student_name && (
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
              <GraduationCap className="w-3 h-3" />{e.student_name}
            </p>
          )}
        </div>
        <div className="text-right shrink-0 text-[10px] text-muted-foreground leading-tight">
          <div className="font-medium">{fmtTime(e.event_time)}</div>
          {e.amount && parseFloat(e.amount) !== 0 && (
            <div className={`font-semibold mt-0.5 ${parseFloat(e.amount) < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {fmtMoney(e.amount)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Alert label mapping ──────────────────────────────────────────────────────

const ALERT_CFG: Record<string, { label: string; icon: React.ReactNode }> = {
  overdue_payment:      { label: 'Просрочка оплаты', icon: <CreditCard className="w-3.5 h-3.5" /> },
  attendance_drop:      { label: 'Падение посещаемости', icon: <TrendingDown className="w-3.5 h-3.5" /> },
  inactive_family:      { label: 'Семья неактивна', icon: <Clock className="w-3.5 h-3.5" /> },
  churn_risk:           { label: 'Риск ухода', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  no_future_lessons:    { label: 'Нет запланированных уроков', icon: <Calendar className="w-3.5 h-3.5" /> },
  expiring_subscription:{ label: 'Абонемент заканчивается', icon: <CircleAlert className="w-3.5 h-3.5" /> },
};

// ─── StatCell ─────────────────────────────────────────────────────────────────

function StatCell({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white/70 rounded-xl p-3 flex flex-col gap-0.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-base font-bold leading-tight ${accent ?? 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── FamilyTimelineDrawer ─────────────────────────────────────────────────────

interface Props {
  family: FamilyForDrawer | null;
  open: boolean;
  onClose: () => void;
}

export function FamilyTimelineDrawer({ family, open, onClose }: Props) {
  const [activeFilter, setActiveFilter] = useState<string | undefined>(undefined);
  const [showMore, setShowMore] = useState(false);

  const familyId = family?.family_id ?? '';
  const limit = showMore ? 300 : 80;

  const { data: timeline, isLoading: timelineLoading } = useGetFamilyTimeline(
    familyId,
    { event_type: activeFilter, limit },
    { query: { queryKey: getGetFamilyTimelineQueryKey(familyId, { event_type: activeFilter, limit }), enabled: open && !!familyId, staleTime: 30000 } },
  );

  const { data: healthData } = useGetFamilyHealth(familyId, {
    query: { queryKey: getGetFamilyHealthQueryKey(familyId), enabled: open && !!familyId, staleTime: 30000 },
  });

  const { data: stats, isLoading: statsLoading } = useGetFamilyStats(familyId, {
    query: { queryKey: getGetFamilyStatsQueryKey(familyId), enabled: open && !!familyId, staleTime: 30000 },
  });

  const health = healthData?.health;
  const alerts = (healthData?.alerts ?? family?.alerts ?? []) as Array<{
    alert_type?: string | null; severity?: string | null; message?: string | null; resolved?: boolean;
  }>;
  const events = (timeline?.events ?? []) as EventRow[];
  const totalEvents = timeline?.total ?? 0;
  const students = (health?.students ?? family?.students ?? []) as Array<{ full_name?: string | null; status?: string | null }>;

  const healthScore = health?.health_score
    ? Math.round(parseFloat(health.health_score))
    : family?.health_score
    ? Math.round(parseFloat(family.health_score))
    : null;

  const openAlerts = alerts.filter(a => !a.resolved);

  // Group events by date for timeline display
  const groupedEvents = useMemo(() => {
    const groups = new Map<string, EventRow[]>();
    for (const e of events) {
      const key = fmtDateGroup(e.event_time);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return [...groups.entries()];
  }, [events]);

  if (!family) return null;

  const daysWithUs = stats?.days_with_us ?? null;
  const totalPaid = stats?.total_paid ? parseFloat(stats.total_paid) : 0;
  const paidThisMonth = stats?.paid_this_month ? parseFloat(stats.paid_this_month) : 0;
  const paymentCount = stats?.payment_count ?? 0;
  const lastPayDays = daysSince(stats?.last_payment_at);
  const attendedTotal = stats?.attended_total ?? 0;
  const missedTotal = stats?.missed_total ?? 0;
  const attendancePct = (attendedTotal + missedTotal) > 0
    ? Math.round((attendedTotal / (attendedTotal + missedTotal)) * 100)
    : null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0 bg-[#F6F7FB]">

        {/* ── Header ────────────────────────────────────────────────── */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b bg-white/80 backdrop-blur-sm shrink-0">
          <SheetTitle asChild>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-lg font-bold truncate leading-tight">
                  {fmt(family.guardian_name ?? family.family_name)}
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                  <Phone className="w-3.5 h-3.5 shrink-0" />
                  {fmt(family.primary_phone)}
                </div>
                {/* Quick meta */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                  {daysWithUs !== null && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      С нами {daysWithUs} дн.
                    </span>
                  )}
                  {stats?.total_events !== undefined && stats.total_events > 0 && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      {stats.total_events} событий
                    </span>
                  )}
                  {totalPaid > 0 && (
                    <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      LTV {fmtMoney(String(totalPaid))}
                    </span>
                  )}
                </div>
              </div>
              {healthScore !== null && <HealthGauge score={healthScore} />}
            </div>
          </SheetTitle>

          {/* Children */}
          {students.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {students.map((s, i) => (
                <span key={i} className="flex items-center gap-1 text-xs bg-background border rounded-full px-2.5 py-1 font-medium">
                  <GraduationCap className="w-3 h-3 text-muted-foreground" />
                  {s.full_name ?? '—'}
                  <span className={`w-1.5 h-1.5 rounded-full ml-0.5 ${s.status === '1' ? 'bg-emerald-400' : 'bg-orange-400'}`} />
                </span>
              ))}
            </div>
          )}
        </SheetHeader>

        {/* ── Scrollable body ───────────────────────────────────────── */}
        <ScrollArea className="flex-1">
          <div className="px-4 py-4 space-y-3">

            {/* ── AI Summary ────────────────────────────────────────── */}
            {stats && !statsLoading && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  </div>
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Сводка по семье</p>
                </div>
                <p className="text-sm text-amber-900 leading-relaxed">{stats.ai_summary}</p>
              </div>
            )}
            {statsLoading && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                <span className="text-sm text-amber-700">Анализируем семью…</span>
              </div>
            )}

            {/* ── Manager Actions ───────────────────────────────────── */}
            {openAlerts.length > 0 && (
              <div className="bg-white/80 border border-red-100 rounded-2xl overflow-hidden">
                <div className="px-4 pt-3.5 pb-2 flex items-center gap-2 border-b border-red-50">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-xs font-semibold text-red-800 uppercase tracking-wide">Требует внимания</p>
                </div>
                <div className="p-2 space-y-1.5">
                  {openAlerts.map((a, i) => {
                    const cfg = ALERT_CFG[a.alert_type ?? ''];
                    const isCrit = a.severity === 'critical';
                    return (
                      <div key={i} className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border ${isCrit ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'}`}>
                        <span className={isCrit ? 'text-red-500 mt-0.5 shrink-0' : 'text-orange-500 mt-0.5 shrink-0'}>
                          {cfg?.icon ?? <AlertTriangle className="w-3.5 h-3.5" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-semibold ${isCrit ? 'text-red-800' : 'text-orange-800'}`}>
                            {cfg?.label ?? a.alert_type}
                          </p>
                          {a.message && (
                            <p className={`text-[11px] mt-0.5 ${isCrit ? 'text-red-700' : 'text-orange-700'}`}>{a.message}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* Action buttons */}
                  <div className="flex gap-2 px-1 pt-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1 gap-1.5">
                      <PhoneCall className="w-3 h-3" /> Позвонить
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1 gap-1.5">
                      <MessageCircle className="w-3 h-3" /> Написать
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1 gap-1.5">
                      <ClipboardList className="w-3 h-3" /> Задача
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Financial Summary ─────────────────────────────────── */}
            <div className="bg-white/80 border border-black/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 pt-3.5 pb-2.5 border-b border-black/[0.04] flex items-center gap-2">
                <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Финансы</p>
              </div>
              {statsLoading ? (
                <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Загрузка…
                </div>
              ) : paymentCount === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  <CreditCard className="w-6 h-6 mx-auto mb-1 opacity-30" />
                  У семьи ещё нет оплат
                </div>
              ) : (
                <div className="p-3 grid grid-cols-2 gap-2">
                  <StatCell
                    label="Оплачено всего"
                    value={fmtMoney(String(totalPaid))}
                    sub={`${paymentCount} платежей`}
                    accent="text-emerald-700"
                  />
                  <StatCell
                    label="В этом месяце"
                    value={fmtMoney(String(paidThisMonth))}
                    sub={paidThisMonth === 0 ? 'Нет оплат' : undefined}
                    accent={paidThisMonth > 0 ? 'text-emerald-700' : 'text-muted-foreground'}
                  />
                  <StatCell
                    label="Последняя оплата"
                    value={fmtDateShort(stats?.last_payment_at)}
                    sub={lastPayDays !== null ? fmtDaysAgo(lastPayDays) : undefined}
                    accent={lastPayDays !== null && lastPayDays > 30 ? 'text-orange-600' : undefined}
                  />
                  <StatCell
                    label="Сумма посл. платежа"
                    value={fmtMoney(stats?.last_payment_amount ?? undefined)}
                  />
                </div>
              )}
            </div>

            {/* ── Attendance Summary ────────────────────────────────── */}
            <div className="bg-white/80 border border-black/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 pt-3.5 pb-2.5 border-b border-black/[0.04] flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-600 shrink-0" />
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Посещаемость</p>
              </div>
              {statsLoading ? (
                <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Загрузка…
                </div>
              ) : attendedTotal === 0 && missedTotal === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  <Calendar className="w-6 h-6 mx-auto mb-1 opacity-30" />
                  <p className="font-medium text-foreground/60">Посещения не синхронизированы</p>
                  <p className="text-xs mt-0.5">Запустите синхронизацию уроков в разделе CRM Sync</p>
                </div>
              ) : (
                <div className="p-3 grid grid-cols-2 gap-2">
                  <StatCell
                    label="Посещений всего"
                    value={String(attendedTotal)}
                    sub={attendancePct !== null ? `${attendancePct}% посещаемость` : undefined}
                    accent="text-blue-700"
                  />
                  <StatCell
                    label="Пропусков"
                    value={String(missedTotal)}
                    accent={missedTotal > 0 ? 'text-orange-600' : undefined}
                  />
                  <StatCell
                    label="Последнее посещение"
                    value={fmtDateShort(stats?.last_attendance_at)}
                    sub={stats?.last_attendance_at ? fmtDaysAgo(daysSince(stats.last_attendance_at)) : undefined}
                  />
                  <StatCell
                    label="Активных учеников"
                    value={String(stats?.active_students ?? 0)}
                    sub={`из ${stats?.total_students ?? 0}`}
                  />
                </div>
              )}
            </div>

            {/* ── Timeline section ──────────────────────────────────── */}
            <div className="bg-white/80 border border-black/[0.06] rounded-2xl overflow-hidden">
              <div className="px-4 pt-3.5 pb-2.5 border-b border-black/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-violet-600 shrink-0" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    История
                    {totalEvents > 0 && <span className="ml-1.5 text-muted-foreground font-normal normal-case">({totalEvents})</span>}
                  </p>
                </div>
              </div>

              {/* Filters */}
              <div className="px-3 py-2 border-b border-black/[0.04] flex gap-1.5 flex-wrap">
                {FILTER_TABS.map(({ key, label }) => (
                  <button
                    key={String(key ?? 'all')}
                    onClick={() => setActiveFilter(key)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      activeFilter === key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Events */}
              <div className="p-3">
                {timelineLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Загрузка истории…
                  </div>
                ) : events.length === 0 ? (
                  <div className="py-8 text-center">
                    <Heart className="w-8 h-8 mx-auto mb-2 opacity-20 text-muted-foreground" />
                    {activeFilter === 'payment_received' ? (
                      <>
                        <p className="text-sm font-medium text-foreground/60">Оплат нет</p>
                        <p className="text-xs text-muted-foreground mt-1">У семьи ещё не было оплат</p>
                      </>
                    ) : activeFilter === 'lesson_attended' || activeFilter === 'lesson_missed' ? (
                      <>
                        <p className="text-sm font-medium text-foreground/60">Посещения не синхронизированы</p>
                        <p className="text-xs text-muted-foreground mt-1">Запустите синхронизацию уроков в CRM Sync</p>
                      </>
                    ) : activeFilter === 'lead_created' ? (
                      <>
                        <p className="text-sm font-medium text-foreground/60">Лидов не найдено</p>
                        <p className="text-xs text-muted-foreground mt-1">CRM события ещё не подключены</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground/60">История пуста</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          После оплат, посещений и CRM событий здесь появится история семьи
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Нажмите «Построить историю» для сборки timeline
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedEvents.map(([date, dayEvents]) => (
                      <div key={date}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-px flex-1 bg-black/[0.06]" />
                          <span className="text-[11px] font-semibold text-muted-foreground shrink-0 uppercase tracking-wide">
                            {date}
                          </span>
                          <div className="h-px flex-1 bg-black/[0.06]" />
                        </div>
                        <div className="space-y-1.5">
                          {dayEvents.map((e, i) => <EventItem key={e.id ?? i} e={e} />)}
                        </div>
                      </div>
                    ))}

                    {!showMore && totalEvents > 80 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full gap-1.5 text-muted-foreground mt-1"
                        onClick={() => setShowMore(true)}
                      >
                        <ChevronDown className="w-4 h-4" />
                        Показать ещё ({totalEvents - events.length} событий)
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* bottom padding */}
            <div className="h-4" />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
