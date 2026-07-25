import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BuildTimelineResult } from '@workspace/api-client-react';
import {
  useGetIdentityFamilies,
  useBuildFamilies,
  useBuildTimeline,
  useCalcHealth,
  useGetFamiliesAtRisk,
  useGetFamilyHealth,
  useFullResync,
  getGetIdentityFamiliesQueryKey,
  getGetIdentityStatsQueryKey,
  getGetFamiliesAtRiskQueryKey,
  getGetFamilyHealthQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Users, Phone, GraduationCap, Building2, RefreshCw, Loader2,
  Megaphone, Clock, Activity, AlertTriangle, Heart, History,
  Search, Shield, ChevronRight, X, CheckCircle2,
  TrendingDown, CreditCard, CalendarDays, ArrowLeft,
} from 'lucide-react';
import { FamilyTimelineDrawer } from './family-timeline-drawer';

// ─── Design tokens ─────────────────────────────────────────────────────────────
const glass = 'bg-white/[0.92] backdrop-blur-sm rounded-[24px] border border-black/[0.08] shadow-[0_8px_32px_rgba(15,23,42,0.07)]';
const glassSmall = 'bg-white/[0.92] backdrop-blur-sm rounded-[18px] border border-black/[0.08] shadow-[0_4px_16px_rgba(15,23,42,0.06)]';

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v: string | null | undefined) { return v ?? '—'; }
function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function daysSince(v: string | null | undefined) {
  if (!v) return null;
  return Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000);
}
function childWord(n: number) {
  if (n === 1) return 'ребёнок';
  if (n < 5) return 'ребёнка';
  return 'детей';
}

function parseAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  let d: Date;
  if (dob.includes('.')) {
    const [day, month, year] = dob.split('.');
    d = new Date(`${year}-${month}-${day}`);
  } else {
    d = new Date(dob);
  }
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
}

function computeRisk(f: FamilyRow): number | null {
  const stored = f.churn_risk_score ? parseFloat(f.churn_risk_score) : null;
  if (stored !== null && !isNaN(stored)) return stored;
  // Inline risk from timeline data
  const daysPay = daysSince(f.last_payment_at);
  const daysAtt = daysSince(f.last_attendance_at);
  const hasEvents = Number(f.total_events ?? 0) > 0;
  if (!hasEvents) return null;
  if (daysPay !== null && daysPay > 60) return 0.7;
  if (daysAtt !== null && daysAtt > 30) return 0.5;
  if (daysPay !== null && daysPay > 30) return 0.35;
  if (daysAtt !== null && daysAtt > 14) return 0.25;
  return 0.1;
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface StudentRow {
  student_crm_id?: string | null;
  full_name?: string | null;
  branch_crm_id?: string | null;
  status?: string | null;
  dob?: string | null;
}

interface FamilyRow {
  id?: string | null;
  family_name?: string | null;
  primary_phone?: string | null;
  guardian_person_id?: string | null;
  guardian_name?: string | null;
  guardian_is_lead?: boolean | null;
  student_count?: number | string | null;
  students?: StudentRow[] | null;
  health_score?: string | null;
  churn_risk_score?: string | null;
  last_payment_at?: string | null;
  last_attendance_at?: string | null;
  total_events?: number | string | null;
  payment_events?: number | string | null;
  attended_events?: number | string | null;
  missed_events?: number | string | null;
  attended_30d?: number | string | null;
  missed_30d?: number | string | null;
  active_students?: number | null;
  inactive_students?: number | null;
  missed_lessons_30d?: number | null;
  alerts?: Array<{ alert_type?: string | null; severity?: string | null; message?: string | null }> | null;
}

type FilterTab = 'all' | 'risk' | 'debt' | 'new';

// ─── Status / Health helpers ────────────────────────────────────────────────────
function familyStatus(f: FamilyRow): { label: string; color: string; bg: string } {
  const risk = computeRisk(f);
  const daysPay = daysSince(f.last_payment_at);
  if (risk === null && Number(f.total_events ?? 0) === 0) return { label: 'Нет данных', color: 'text-gray-500', bg: 'bg-gray-100' };
  if (risk !== null && risk >= 0.6) return { label: 'В риске', color: 'text-red-700', bg: 'bg-red-50' };
  if (risk !== null && risk >= 0.3) return { label: 'Внимание', color: 'text-amber-700', bg: 'bg-amber-50' };
  if (daysPay !== null && daysPay > 60) return { label: 'Долг', color: 'text-orange-700', bg: 'bg-orange-50' };
  if (f.active_students === 0 && (f.inactive_students ?? 0) > 0) return { label: 'Архив', color: 'text-gray-600', bg: 'bg-gray-100' };
  return { label: 'Норма', color: 'text-emerald-700', bg: 'bg-emerald-50' };
}

function HealthRing({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 75 ? '#10B981' : pct >= 50 ? '#F97316' : pct >= 25 ? '#EF4444' : '#DC2626';
  return (
    <div className="relative w-10 h-10 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="14" fill="none" stroke="#f3f4f6" strokeWidth="3.5" />
        <circle cx="18" cy="18" r="14" fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${(pct / 100) * 87.96} 87.96`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold" style={{ color }}>{pct}</span>
      </div>
    </div>
  );
}

// ─── Header Actions Card ────────────────────────────────────────────────────────
function FamiliesHeaderCard({
  totalFamilies,
  totalStudents,
  atRiskCount,
  lastSyncLabel,
  isBuilding,
  isBuildingTimeline,
  isCalcHealth,
  isFullResync,
  onBuild,
  onTimeline,
  onHealth,
  onFullResync,
}: {
  totalFamilies: number;
  totalStudents: number;
  atRiskCount: number;
  lastSyncLabel: string;
  isBuilding: boolean;
  isBuildingTimeline: boolean;
  isCalcHealth: boolean;
  isFullResync: boolean;
  onBuild: () => void;
  onTimeline: () => void;
  onHealth: () => void;
  onFullResync: () => void;
}) {
  return (
    <div className={`${glass} p-6`}>
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Семей', value: totalFamilies || '—', color: 'text-[#0F172A]' },
          { label: 'Учеников', value: totalStudents || '—', color: 'text-[#0F172A]' },
          { label: 'В риске', value: atRiskCount > 0 ? atRiskCount : '0', color: atRiskCount > 0 ? 'text-[#EF4444]' : 'text-[#10B981]' },
          { label: 'Обновлено', value: lastSyncLabel, color: 'text-[#667085]' },
        ].map((s) => (
          <div key={s.label} className="bg-[#F6F7FB] rounded-[16px] p-3.5">
            <p className="text-[11px] text-[#667085] font-medium mb-1">{s.label}</p>
            <p className={`text-[17px] font-bold tabular-nums leading-tight ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Actions row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={onBuild}
          disabled={isBuilding}
          className="group flex flex-col gap-1.5 p-4 rounded-[18px] border border-black/[0.08] bg-white hover:bg-violet-50 hover:border-violet-200 transition-all text-left disabled:opacity-60"
        >
          <div className="flex items-center gap-2">
            {isBuilding
              ? <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
              : <RefreshCw className="w-4 h-4 text-violet-600 group-hover:rotate-90 transition-transform duration-300" />
            }
            <span className="text-[13px] font-semibold text-[#0F172A]">
              {isBuilding ? 'Обновляем…' : 'Обновить семьи'}
            </span>
          </div>
          <p className="text-[11px] text-[#667085] leading-snug">
            Пересобирает связи учеников по родителям и телефонам
          </p>
        </button>

        <button
          onClick={onTimeline}
          disabled={isBuildingTimeline}
          className="group flex flex-col gap-1.5 p-4 rounded-[18px] border border-black/[0.08] bg-white hover:bg-blue-50 hover:border-blue-200 transition-all text-left disabled:opacity-60"
        >
          <div className="flex items-center gap-2">
            {isBuildingTimeline
              ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              : <History className="w-4 h-4 text-blue-600" />
            }
            <span className="text-[13px] font-semibold text-[#0F172A]">
              {isBuildingTimeline ? 'Собираем историю…' : 'Построить историю'}
            </span>
          </div>
          <p className="text-[11px] text-[#667085] leading-snug">
            Собирает таймлайн: оплаты, посещения, записи, события
          </p>
        </button>

        <button
          onClick={onHealth}
          disabled={isCalcHealth}
          className="group flex flex-col gap-1.5 p-4 rounded-[18px] border border-black/[0.08] bg-white hover:bg-emerald-50 hover:border-emerald-200 transition-all text-left disabled:opacity-60"
        >
          <div className="flex items-center gap-2">
            {isCalcHealth
              ? <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              : <Activity className="w-4 h-4 text-emerald-600" />
            }
            <span className="text-[13px] font-semibold text-[#0F172A]">
              {isCalcHealth ? 'Оцениваем риск…' : 'Оценить риск'}
            </span>
          </div>
          <p className="text-[11px] text-[#667085] leading-snug">
            Риск ухода, долги, посещаемость и активность
          </p>
        </button>
      </div>

      {/* Full resync */}
      <div className="mt-3 pt-3 border-t border-black/[0.05]">
        <button
          onClick={onFullResync}
          disabled={isFullResync}
          className="w-full group flex items-center gap-3 p-3.5 rounded-[16px] border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-all text-left disabled:opacity-60"
        >
          {isFullResync
            ? <Loader2 className="w-4 h-4 animate-spin text-amber-700 shrink-0" />
            : <RefreshCw className="w-4 h-4 text-amber-700 shrink-0 group-hover:rotate-180 transition-transform duration-500" />
          }
          <div>
            <p className="text-[13px] font-semibold text-amber-900">
              {isFullResync ? 'Идёт полная пересборка CRM истории…' : 'Полная пересборка CRM истории'}
            </p>
            <p className="text-[11px] text-amber-700">
              Студенты + оплаты + уроки с 01.01.2025 + посещения → затем нажмите «Обновить семьи» и «Построить историю»
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Filter Tabs ────────────────────────────────────────────────────────────────
function FilterTabs({ active, onChange, counts }: {
  active: FilterTab;
  onChange: (t: FilterTab) => void;
  counts: Record<FilterTab, number>;
}) {
  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all',  label: 'Все' },
    { id: 'risk', label: 'В риске' },
    { id: 'debt', label: 'С долгом' },
    { id: 'new',  label: 'Новые' },
  ];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-[12px] text-[13px] font-semibold transition-all ${
            active === t.id
              ? 'bg-[#7C3AED] text-white shadow-sm'
              : 'bg-white/80 text-[#667085] hover:bg-white hover:text-[#0F172A] border border-black/[0.07]'
          }`}
        >
          {t.label}
          {counts[t.id] > 0 && active !== t.id && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              t.id === 'risk' ? 'bg-red-100 text-red-700' :
              t.id === 'debt' ? 'bg-orange-100 text-orange-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {counts[t.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Family Card ────────────────────────────────────────────────────────────────
interface FamilyCardProps {
  family: FamilyRow;
  onOpenDetail: (f: FamilyRow) => void;
  onOpenTimeline: (f: FamilyRow) => void;
}

function FamilyCard({ family, onOpenDetail, onOpenTimeline }: FamilyCardProps) {
  const students = family.students ?? [];
  const daysPay = daysSince(family.last_payment_at);
  const daysAtt = daysSince(family.last_attendance_at);
  const healthScore = family.health_score ? parseFloat(family.health_score) : null;
  const risk = computeRisk(family);
  const status = familyStatus(family);
  const totalEvents = Number(family.total_events ?? 0);
  const missed30 = Number(family.missed_30d ?? family.missed_lessons_30d ?? 0);

  // Student display: first 2 children with ages, then "+N ещё"
  const firstTwo = students.slice(0, 2);
  const remaining = students.length - firstTwo.length;

  return (
    <div
      className={`${glassSmall} p-4 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all active:translate-y-0`}
      onClick={() => onOpenDetail(family)}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[14px] bg-violet-100 flex items-center justify-center shrink-0">
          <span className="text-[14px] font-bold text-violet-700">
            {(family.guardian_name ?? family.family_name ?? '?').charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[14px] font-semibold text-[#0F172A] truncate">
              {fmt(family.guardian_name ?? family.family_name)}
            </span>
            {family.guardian_is_lead && (
              <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] h-4 px-1.5 gap-0.5 border shrink-0">
                <Megaphone className="w-2.5 h-2.5" /> лид
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[#667085]">
            <Phone className="w-3 h-3 shrink-0" />
            <span className="truncate">{fmt(family.primary_phone)}</span>
          </div>
        </div>

        <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-[10px] ${status.bg} ${status.color}`}>
          {status.label}
        </span>
      </div>

      {/* Children names */}
      <div className="bg-[#F6F7FB] rounded-[12px] p-2.5">
        <div className="flex items-center gap-1 mb-1.5">
          <GraduationCap className="w-3 h-3 text-[#7C3AED]" />
          <span className="text-[10px] text-[#667085] font-medium">
            {students.length === 1 ? 'Ребёнок' : 'Дети'}
          </span>
        </div>
        {students.length === 0 ? (
          <p className="text-[11px] text-[#667085]">Нет данных</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {firstTwo.map((s, i) => {
              const age = parseAge(s.dob);
              return (
                <p key={i} className="text-[12px] font-semibold text-[#0F172A] leading-snug">
                  {s.full_name ?? '—'}
                  {age !== null && (
                    <span className="text-[10px] font-normal text-[#667085] ml-1">{age} лет</span>
                  )}
                </p>
              );
            })}
            {remaining > 0 && (
              <p className="text-[10px] text-[#667085]">ещё {remaining}</p>
            )}
          </div>
        )}
      </div>

      {/* Metrics row: payment + attendance + risk */}
      <div className="grid grid-cols-3 gap-2">
        {/* Last payment */}
        <div className="bg-[#F6F7FB] rounded-[12px] p-2.5">
          <div className="flex items-center gap-1 mb-1">
            <CreditCard className="w-3 h-3 text-[#10B981]" />
            <span className="text-[10px] text-[#667085] font-medium">Оплата</span>
          </div>
          <p className={`text-[11px] font-bold leading-snug ${
            daysPay === null ? 'text-[#667085]' :
            daysPay > 60 ? 'text-red-600' :
            daysPay > 30 ? 'text-amber-600' : 'text-[#10B981]'
          }`}>
            {daysPay === null ? '—' : daysPay === 0 ? 'Сегодня' : `${daysPay}д назад`}
          </p>
          {Number(family.payment_events ?? 0) > 0 && (
            <p className="text-[9px] text-[#667085] mt-0.5">{family.payment_events} опл.</p>
          )}
        </div>

        {/* Last attendance */}
        <div className="bg-[#F6F7FB] rounded-[12px] p-2.5">
          <div className="flex items-center gap-1 mb-1">
            <Activity className="w-3 h-3 text-[#2563EB]" />
            <span className="text-[10px] text-[#667085] font-medium">Занятия</span>
          </div>
          <p className={`text-[11px] font-bold leading-snug ${
            daysAtt === null ? 'text-[#667085]' :
            daysAtt > 30 ? 'text-amber-600' : 'text-[#0F172A]'
          }`}>
            {daysAtt === null ? '—' : daysAtt === 0 ? 'Сегодня' : `${daysAtt}д назад`}
          </p>
          {Number(family.attended_events ?? 0) > 0 && (
            <p className="text-[9px] text-[#667085] mt-0.5">{family.attended_events} пос.</p>
          )}
        </div>

        {/* Risk */}
        <div className="bg-[#F6F7FB] rounded-[12px] p-2.5">
          <div className="flex items-center gap-1 mb-1">
            <Shield className="w-3 h-3 text-[#2563EB]" />
            <span className="text-[10px] text-[#667085] font-medium">Риск</span>
          </div>
          {risk !== null ? (
            <p className={`text-[11px] font-bold ${
              risk >= 0.6 ? 'text-red-600' : risk >= 0.3 ? 'text-amber-600' : 'text-[#10B981]'
            }`}>
              {risk >= 0.6 ? 'Высокий' : risk >= 0.3 ? 'Средний' : 'Норма'}
            </p>
          ) : (
            <p className="text-[11px] text-[#667085]">—</p>
          )}
          {totalEvents > 0 && (
            <p className="text-[9px] text-[#667085] mt-0.5">{totalEvents} соб.</p>
          )}
        </div>
      </div>

      {/* Alerts */}
      {family.alerts && family.alerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {family.alerts.slice(0, 2).map((a, i) => (
            <div key={i} className="flex items-center gap-1 text-[11px] text-amber-700">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[140px]">{a.message ?? a.alert_type}</span>
            </div>
          ))}
        </div>
      )}

      {/* Missed lessons */}
      {missed30 > 0 && (
        <div className="flex items-center gap-1.5 text-[12px] text-orange-600">
          <TrendingDown className="w-3.5 h-3.5 shrink-0" />
          <span>Пропусков за 30 дней: {missed30}</span>
        </div>
      )}

      {/* Health score if available */}
      {healthScore !== null && !isNaN(healthScore) && (
        <div className="flex items-center gap-2 pt-1 border-t border-black/[0.04]">
          <HealthRing score={Math.round(healthScore)} />
          <div>
            <p className="text-[11px] text-[#667085]">Оценка риска</p>
            <p className="text-[13px] font-semibold text-[#0F172A]">
              {healthScore >= 75 ? 'Здоровая семья' : healthScore >= 50 ? 'Наблюдение' : healthScore >= 25 ? 'Риск' : 'Критично'}
            </p>
          </div>
          <button
            className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:opacity-70 transition-opacity min-h-[36px] px-2"
            onClick={(e) => { e.stopPropagation(); onOpenTimeline(family); }}
          >
            <History className="w-3.5 h-3.5" /> История
          </button>
        </div>
      )}

      {/* Footer actions (when no health score) */}
      {(healthScore === null || isNaN(healthScore)) && (
        <div className="flex items-center gap-2 pt-1 border-t border-black/[0.04]">
          <button
            className="flex items-center gap-1.5 text-[12px] font-semibold text-[#667085] hover:text-[#0F172A] transition-colors min-h-[36px] px-1"
            onClick={(e) => { e.stopPropagation(); onOpenTimeline(family); }}
          >
            <History className="w-3.5 h-3.5" /> История
          </button>
          <div className="ml-auto flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED]">
            Открыть <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Family Detail Sheet ────────────────────────────────────────────────────────
function FamilyDetailSheet({ family, open, onClose, onOpenTimeline }: {
  family: FamilyRow | null;
  open: boolean;
  onClose: () => void;
  onOpenTimeline: (f: FamilyRow) => void;
}) {
  const { data: healthData } = useGetFamilyHealth(
    family?.id ?? '',
    { query: {
      queryKey: getGetFamilyHealthQueryKey(family?.id ?? ''),
      enabled: !!family?.id && open,
      staleTime: 120_000,
    }},
  );

  if (!family) return null;

  const studentCount = Number(family.student_count ?? (family.students?.length ?? 0));
  const status = familyStatus(family);
  const daysPay = daysSince(family.last_payment_at);
  const healthScore = healthData?.health?.health_score != null
    ? Math.round(parseFloat(String(healthData.health.health_score)))
    : (family.health_score ? Math.round(parseFloat(family.health_score)) : null);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-[480px] p-0 flex flex-col overflow-hidden bg-[#F6F7FB]">
        <SheetHeader className="p-5 pb-4 bg-white border-b border-black/[0.06]">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-[12px] text-[#667085] hover:text-[#0F172A] transition-colors mb-3 -mt-1 w-fit"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Назад</span>
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-[16px] bg-violet-100 flex items-center justify-center shrink-0">
                <span className="text-[18px] font-bold text-violet-700">
                  {(family.guardian_name ?? family.family_name ?? '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <SheetTitle className="text-[17px] font-bold text-[#0F172A] leading-snug">
                  {fmt(family.guardian_name ?? family.family_name)}
                </SheetTitle>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Phone className="w-3 h-3 text-[#667085]" />
                  <span className="text-[12px] text-[#667085]">{fmt(family.primary_phone)}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-[10px] ${status.bg} ${status.color}`}>
                {status.label}
              </span>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4 text-[#667085]" />
              </button>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-white rounded-[14px] p-3 border border-black/[0.06]">
              <p className="text-[10px] text-[#667085] mb-1">Детей</p>
              <p className="text-[18px] font-bold text-[#0F172A]">{studentCount}</p>
            </div>
            <div className="bg-white rounded-[14px] p-3 border border-black/[0.06]">
              <p className="text-[10px] text-[#667085] mb-1">Активных</p>
              <p className="text-[18px] font-bold text-[#10B981]">{family.active_students ?? '—'}</p>
            </div>
            <div className="bg-white rounded-[14px] p-3 border border-black/[0.06]">
              <p className="text-[10px] text-[#667085] mb-1">Пропусков</p>
              <p className={`text-[18px] font-bold ${(family.missed_lessons_30d ?? 0) > 0 ? 'text-amber-600' : 'text-[#0F172A]'}`}>
                {family.missed_lessons_30d ?? 0}
              </p>
            </div>
          </div>

          {/* Health / Risk */}
          {healthScore !== null ? (
            <div className="bg-white rounded-[18px] p-4 border border-black/[0.06]">
              <p className="text-[13px] font-semibold text-[#0F172A] mb-3">Оценка риска</p>
              <div className="flex items-center gap-4">
                <HealthRing score={healthScore} />
                <div className="flex-1">
                  <p className="text-[20px] font-bold text-[#0F172A]">{healthScore}/100</p>
                  <p className={`text-[13px] font-medium ${
                    healthScore >= 75 ? 'text-emerald-600' :
                    healthScore >= 50 ? 'text-amber-600' :
                    'text-red-600'
                  }`}>
                    {healthScore >= 75 ? 'Семья здорова, рисков нет' :
                     healthScore >= 50 ? 'Требует наблюдения' :
                     healthScore >= 25 ? 'Высокий риск ухода' : 'Критическое состояние'}
                  </p>
                </div>
              </div>
              {family.alerts && family.alerts.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {family.alerts.map((a, i) => (
                    <div key={i} className={`flex items-start gap-2 p-2.5 rounded-[10px] text-[12px] ${
                      a.severity === 'critical' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'
                    }`}>
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{a.message ?? a.alert_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-[18px] p-4 border border-black/[0.06]">
              <p className="text-[13px] font-semibold text-[#0F172A] mb-2">Оценка риска</p>
              <p className="text-[12px] text-[#667085]">
                Риск ещё не рассчитан. Нажмите «Оценить риск» на главной странице семей.
              </p>
            </div>
          )}

          {/* Finances */}
          <div className="bg-white rounded-[18px] p-4 border border-black/[0.06]">
            <p className="text-[13px] font-semibold text-[#0F172A] mb-3">Финансы</p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[#667085] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Последняя оплата
                </span>
                <span className={`text-[13px] font-semibold ${
                  daysPay === null ? 'text-[#667085]' :
                  daysPay > 60 ? 'text-red-600' :
                  daysPay > 30 ? 'text-amber-600' : 'text-[#0F172A]'
                }`}>
                  {daysPay === null ? '—' :
                   daysPay === 0 ? 'Сегодня' :
                   `${fmtDate(family.last_payment_at)} (${daysPay}д назад)`}
                </span>
              </div>
              {daysPay !== null && daysPay > 30 && (
                <div className="flex items-start gap-2 p-2.5 rounded-[10px] bg-amber-50 text-[12px] text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>Оплата не поступала {daysPay} дней. Требуется контакт с родителем.</span>
                </div>
              )}
              {daysPay === null && (
                <p className="text-[12px] text-[#667085]">
                  История оплат появится после синхронизации данных CRM.
                </p>
              )}
            </div>
          </div>

          {/* Children */}
          <div className="bg-white rounded-[18px] p-4 border border-black/[0.06]">
            <p className="text-[13px] font-semibold text-[#0F172A] mb-3">
              {studentCount > 0 ? `${studentCount} ${childWord(studentCount)}` : 'Ученики'}
            </p>
            {family.students && family.students.length > 0 ? (
              <div className="space-y-2">
                {family.students.map((s, i) => (
                  <div key={s.student_crm_id ?? i} className="flex items-center gap-3 p-2.5 bg-[#F6F7FB] rounded-[12px]">
                    <div className="w-8 h-8 rounded-[10px] bg-violet-100 flex items-center justify-center shrink-0">
                      <GraduationCap className="w-4 h-4 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#0F172A] truncate">{fmt(s.full_name)}</p>
                      <div className="flex items-center gap-2 text-[11px] text-[#667085]">
                        {s.branch_crm_id && (
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            Филиал {s.branch_crm_id}
                          </span>
                        )}
                        {s.dob && <span>{s.dob}</span>}
                      </div>
                    </div>
                    <Badge
                      className={`text-[10px] h-5 px-1.5 border shrink-0 ${
                        s.status === '1' || s.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}
                    >
                      {s.status === '1' || s.status === 'active' ? 'активен' : (s.status ?? 'неизвестно')}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[#667085]">
                Данные об учениках появятся после синхронизации CRM.
              </p>
            )}
          </div>

          {/* Timeline CTA */}
          <div className="bg-white rounded-[18px] p-4 border border-black/[0.06]">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[12px] bg-blue-50 flex items-center justify-center shrink-0">
                <History className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-[#0F172A]">История семьи</p>
                <p className="text-[12px] text-[#667085] mt-0.5 leading-relaxed">
                  Оплаты, посещения, записи, лиды и все события в одной ленте
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 rounded-[12px] text-[12px] font-semibold"
                onClick={() => { onOpenTimeline(family); onClose(); }}
              >
                Открыть <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────────
function FamiliesEmptyState({ onBuild }: { onBuild: () => void }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-6 gap-5">
      <div className="w-20 h-20 rounded-[28px] bg-violet-50 flex items-center justify-center">
        <Users className="w-10 h-10 text-[#7C3AED]" />
      </div>
      <div>
        <h3 className="text-[18px] font-bold text-[#0F172A] mb-2">Семьи ещё не собраны</h3>
        <p className="text-[14px] text-[#667085] max-w-sm mx-auto leading-relaxed">
          Система объединит учеников по телефонам родителей и покажет историю оплат, посещений и записей.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={onBuild}
          className="bg-[#7C3AED] hover:bg-violet-700 rounded-[14px] px-5 py-2.5 font-semibold"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Обновить семьи
        </Button>
      </div>
      <div className="bg-blue-50 border border-blue-100 rounded-[16px] px-4 py-3 max-w-sm text-left">
        <p className="text-[12px] text-blue-800 leading-relaxed">
          <strong>Как это работает:</strong> все ученики с одинаковым номером телефона родителя объединяются в одну семью. Братья и сёстры с общим телефоном — это норма.
        </p>
      </div>
    </div>
  );
}

// ─── FamiliesTab ───────────────────────────────────────────────────────────────
export function FamiliesTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedFamily, setSelectedFamily] = useState<FamilyRow | null>(null);
  const [drawerFamily, setDrawerFamily] = useState<FamilyRow | null>(null);
  const [buildResult, setBuildResult] = useState<{ familiesCreated: number; guardiansCreated: number; linksCreated: number } | null>(null);
  const [timelineResult, setTimelineResult] = useState<BuildTimelineResult | null>(null);
  const [healthResult, setHealthResult] = useState<{ familiesCalculated: number } | null>(null);

  const { data, isLoading } = useGetIdentityFamilies(
    { search: search || undefined },
    { query: { queryKey: getGetIdentityFamiliesQueryKey({ search: search || undefined }), staleTime: 30000 } },
  );

  const { mutate: buildFamilies, isPending: isBuilding } = useBuildFamilies({
    mutation: {
      onSuccess: (res) => {
        setBuildResult(res);
        qc.invalidateQueries({ queryKey: getGetIdentityFamiliesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetIdentityStatsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFamiliesAtRiskQueryKey() });
      },
    },
  });

  const { mutate: buildTimeline, isPending: isBuildingTimeline } = useBuildTimeline({
    mutation: {
      onSuccess: (res) => {
        setTimelineResult(res);
        qc.invalidateQueries({ queryKey: getGetIdentityFamiliesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFamiliesAtRiskQueryKey() });
      },
    },
  });

  const { mutate: calcHealth, isPending: isCalcHealth } = useCalcHealth({
    mutation: {
      onSuccess: (res) => {
        setHealthResult(res);
        qc.invalidateQueries({ queryKey: getGetIdentityFamiliesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetFamiliesAtRiskQueryKey() });
      },
    },
  });

  const [fullResyncResult, setFullResyncResult] = useState<{ message?: string } | null>(null);
  const { mutate: triggerFullResync, isPending: isFullResync } = useFullResync({
    mutation: {
      onSuccess: (res) => {
        setFullResyncResult(res ? { message: res.message } : null);
        qc.invalidateQueries({ queryKey: getGetIdentityFamiliesQueryKey() });
      },
    },
  });

  const { data: atRiskData } = useGetFamiliesAtRisk(
    { limit: 200 },
    { query: { queryKey: getGetFamiliesAtRiskQueryKey({ limit: 200 }), staleTime: 60000 } },
  );

  type AtRiskRow = NonNullable<typeof atRiskData>['families'][number];
  const healthMap = new Map<string, AtRiskRow>(
    (atRiskData?.families ?? []).map((f) => [f.family_id, f] as [string, AtRiskRow])
  );

  const families = (data?.families ?? []) as FamilyRow[];
  const total = data?.total ?? 0;

  const enrichedFamilies: FamilyRow[] = families.map((f) => {
    if (!f.id) return f;
    const h = healthMap.get(f.id);
    if (!h) return f;
    return {
      ...f,
      health_score: h.health_score ?? f.health_score,
      churn_risk_score: h.churn_risk_score ?? f.churn_risk_score,
      last_payment_at: h.last_payment_at ?? f.last_payment_at,
      active_students: h.active_students ?? f.active_students,
      inactive_students: h.inactive_students ?? f.inactive_students,
      missed_lessons_30d: h.missed_lessons_30d ?? f.missed_lessons_30d,
      alerts: h.alerts ?? f.alerts,
    };
  });

  // Filter logic
  const filteredFamilies = useMemo(() => {
    return enrichedFamilies.filter((f) => {
      if (filter === 'all') return true;
      const risk = computeRisk(f);
      const daysPay = daysSince(f.last_payment_at);
      if (filter === 'risk') return risk !== null && risk >= 0.3;
      if (filter === 'debt') return daysPay !== null && daysPay > 45;
      if (filter === 'new') return f.guardian_is_lead === true;
      return true;
    });
  }, [enrichedFamilies, filter]);

  // Filter tab counts
  const counts: Record<FilterTab, number> = useMemo(() => ({
    all: enrichedFamilies.length,
    risk: enrichedFamilies.filter((f) => { const r = computeRisk(f); return r !== null && r >= 0.3; }).length,
    debt: enrichedFamilies.filter((f) => { const d = daysSince(f.last_payment_at); return d !== null && d > 45; }).length,
    new: enrichedFamilies.filter((f) => f.guardian_is_lead === true).length,
  }), [enrichedFamilies]);

  const atRiskCount = enrichedFamilies.filter((f) => { const r = computeRisk(f); return r !== null && r >= 0.3; }).length;
  const totalStudents = enrichedFamilies.reduce((sum, f) => sum + Number(f.student_count ?? (f.students?.length ?? 0)), 0);

  const openDetail = (f: FamilyRow) => setSelectedFamily(f);
  const openTimeline = (f: FamilyRow) => setDrawerFamily({ ...f, family_id: f.id ?? undefined } as FamilyRow & { family_id?: string });

  return (
    <div className="space-y-4">
      {/* Header with stats + actions */}
      <FamiliesHeaderCard
        totalFamilies={total}
        totalStudents={totalStudents}
        atRiskCount={atRiskCount}
        lastSyncLabel={total > 0 ? 'Актуально' : '—'}
        isBuilding={isBuilding}
        isBuildingTimeline={isBuildingTimeline}
        isCalcHealth={isCalcHealth}
        isFullResync={isFullResync}
        onBuild={() => buildFamilies()}
        onTimeline={() => buildTimeline()}
        onHealth={() => calcHealth()}
        onFullResync={() => triggerFullResync({ data: { date_from: '2025-01-01' } })}
      />

      {/* Operation results */}
      {buildResult && (
        <div className="flex items-center gap-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-[16px] text-sm text-emerald-900">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Готово: создано <strong>{buildResult.familiesCreated}</strong> семей,{' '}
            <strong>{buildResult.guardiansCreated}</strong> родителей,{' '}
            <strong>{buildResult.linksCreated}</strong> связей
          </span>
          <button onClick={() => setBuildResult(null)} className="ml-auto p-1 hover:bg-emerald-100 rounded-lg">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {timelineResult && (() => {
        const dbgPay = timelineResult.debug?.payments;
        const dbgAtt = timelineResult.debug?.attendance;
        const unlinked = dbgPay ? (dbgPay.no_customer_id + dbgPay.orphan_not_synced) : 0;
        return (
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-[16px] text-sm text-blue-900 space-y-2">
            {/* Title row */}
            <div className="flex items-center gap-3">
              <History className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="font-semibold">
                История построена: <strong>{timelineResult.totalEvents}</strong> событий
              </span>
              <button onClick={() => setTimelineResult(null)} className="ml-auto p-1 hover:bg-blue-100 rounded-lg">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Event type summary */}
            {timelineResult.totalEvents > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-7 text-xs text-blue-700">
                {timelineResult.paymentsAdded > 0 && <span>💰 Оплат: {timelineResult.paymentsAdded}</span>}
                {timelineResult.subscriptionsAdded > 0 && <span>📘 Записей: {timelineResult.subscriptionsAdded}</span>}
                {timelineResult.attendanceAdded > 0 && <span>✅ Посещений: {timelineResult.attendanceAdded}</span>}
                {timelineResult.leadsAdded > 0 && <span>📞 Лидов: {timelineResult.leadsAdded}</span>}
              </div>
            )}

            {/* Payment linkage debug */}
            {dbgPay && (
              <div className="pl-7 space-y-1">
                <p className="text-[11px] font-semibold text-blue-800 uppercase tracking-wide">Привязка оплат</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-blue-700">
                  <span>В CRM: <strong>{dbgPay.total_in_crm}</strong></span>
                  <span className="text-emerald-700">Привязано к семьям: <strong>{dbgPay.linked_primary + dbgPay.linked_via_phone}</strong></span>
                  {dbgPay.linked_via_phone > 0 && (
                    <span className="text-sky-700">↳ через телефон: <strong>{dbgPay.linked_via_phone}</strong></span>
                  )}
                  {dbgPay.no_customer_id > 0 && (
                    <span className="text-amber-700">Без customer_id: <strong>{dbgPay.no_customer_id}</strong></span>
                  )}
                  {dbgPay.orphan_not_synced > 0 && (
                    <span className="text-orange-700">Студент не синхронизирован: <strong>{dbgPay.orphan_not_synced}</strong></span>
                  )}
                  {dbgPay.skipped_no_date > 0 && (
                    <span className="text-red-700">Пропущено (нет даты): <strong>{dbgPay.skipped_no_date}</strong></span>
                  )}
                </div>
                {unlinked > 0 && (
                  <p className="text-[11px] text-orange-700 mt-1">
                    ⚠ {unlinked} оплат без семьи. Синхронизируйте студентов → пересоберите семьи → пересоберите историю.
                  </p>
                )}
              </div>
            )}

            {/* Attendance debug */}
            {dbgAtt && (
              <div className="pl-7 space-y-0.5">
                <p className="text-[11px] font-semibold text-blue-800 uppercase tracking-wide">Посещения</p>
                {dbgAtt.total_in_crm === 0 ? (
                  <p className="text-xs text-orange-700">
                    ⚠ Посещения не синхронизированы — в базе 0 записей.
                    Запустите <strong>Sync Lessons</strong> + <strong>Sync Attendance</strong> в разделе CRM Sync.
                  </p>
                ) : (
                  <div className="text-xs text-blue-700 flex gap-4">
                    <span>В CRM: <strong>{dbgAtt.total_in_crm}</strong></span>
                    <span>Привязано: <strong>{dbgAtt.linked_to_family}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* Zero-state fallback */}
            {timelineResult.totalEvents === 0 && !dbgPay && (
              <p className="text-xs text-blue-700 pl-7">
                Нет данных для построения истории. Синхронизируйте платежи и посещения в разделе «CRM Sync».
              </p>
            )}
          </div>
        );
      })()}
      {healthResult && (
        <div className="flex items-center gap-3 p-3.5 bg-violet-50 border border-violet-200 rounded-[16px] text-sm text-violet-900">
          <Activity className="w-4 h-4 text-violet-600 shrink-0" />
          <span>Риск оценён для <strong>{healthResult.familiesCalculated}</strong> семей</span>
          <button onClick={() => setHealthResult(null)} className="ml-auto p-1 hover:bg-violet-100 rounded-lg">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search + filters */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#667085]" />
            <Input
              placeholder="Поиск по имени, телефону, ребёнку…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 text-sm rounded-[14px] border-black/[0.08] bg-white"
            />
          </div>
          <FilterTabs active={filter} onChange={setFilter} counts={counts} />
        </div>
      )}

      {/* Family list */}
      {isLoading ? (
        <div className="py-16 text-center flex items-center justify-center gap-2 text-[#667085]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[14px]">Загрузка семей…</span>
        </div>
      ) : total === 0 ? (
        <Card className="border-black/[0.06] shadow-none bg-white/80 rounded-[24px]">
          <CardContent className="p-0">
            <FamiliesEmptyState onBuild={() => buildFamilies()} />
          </CardContent>
        </Card>
      ) : filteredFamilies.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[14px] text-[#667085]">
            {search ? `По запросу «${search}» ничего не найдено` : 'Нет семей в этой категории'}
          </p>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="mt-2 text-[13px] font-semibold text-[#7C3AED] hover:opacity-70 transition-opacity"
            >
              Сбросить поиск
            </button>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[13px] text-[#667085]">
              {filter !== 'all'
                ? `${filteredFamilies.length} из ${total} семей`
                : `${total} ${total === 1 ? 'семья' : total < 5 ? 'семьи' : 'семей'}`}
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredFamilies.map((f, i) => (
              <FamilyCard
                key={f.id ?? i}
                family={f}
                onOpenDetail={openDetail}
                onOpenTimeline={openTimeline}
              />
            ))}
          </div>
        </div>
      )}

      {/* Family detail side sheet */}
      <FamilyDetailSheet
        family={selectedFamily}
        open={selectedFamily !== null}
        onClose={() => setSelectedFamily(null)}
        onOpenTimeline={openTimeline}
      />

      {/* Timeline drawer */}
      <FamilyTimelineDrawer
        family={drawerFamily ? { ...drawerFamily, family_id: drawerFamily.id ?? undefined } as Parameters<typeof FamilyTimelineDrawer>[0]['family'] : null}
        open={drawerFamily !== null}
        onClose={() => setDrawerFamily(null)}
      />
    </div>
  );
}
