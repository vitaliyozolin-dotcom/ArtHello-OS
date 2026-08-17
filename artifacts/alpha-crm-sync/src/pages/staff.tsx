import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, BookOpen, Wallet, TrendingUp, ChevronDown, Plus,
  X, Check, AlertCircle, GraduationCap, Phone, Mail,
  Settings2, MoreHorizontal, Loader2, Calculator, Percent,
} from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = { GraduationCap, Phone, Mail, Percent, MoreHorizontal };

// ─── FOT Dashboard types ──────────────────────────────────────────────────────

interface FotTeacher {
  teacher: { crmId: string; fullName: string | null };
  profile: { position: string | null; ndflRate: string | null; pfrRate: string | null; fssRate: string | null } | null;
  totalGross: number;
  bonus: number;
  ndflAmount: number;
  netTakeHome: number;
  pfrAmount: number;
  fssAmount: number;
  employerCost: number;
  kpiActual: number;
  kpiTarget: number | null;
  status: string;
}

interface FotDashboard {
  month: string | null;
  teachers: FotTeacher[];
  totals: { totalGross: number; totalNdfl: number; totalPfr: number; totalFss: number; totalEmployerCost: number };
}

function FotDashboardView({ month }: { month: string }) {
  const { data, isLoading } = useQuery<FotDashboard>({
    queryKey: ["fot-dashboard", month],
    queryFn: () => fetch(`/api/staff/fot-dashboard?month=${month}`).then((r) => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-violet-400" /></div>;

  const totals = data?.totals;
  const teachers = data?.teachers ?? [];

  function fmtRub(n: number) {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Начислено (gross)", value: fmtRub(totals?.totalGross ?? 0), color: "text-gray-900" },
          { label: "НДФЛ (−13%)", value: fmtRub(totals?.totalNdfl ?? 0), color: "text-red-500" },
          { label: "ПФР (22%)", value: fmtRub(totals?.totalPfr ?? 0), color: "text-amber-600" },
          { label: "ФСС (2.9%)", value: fmtRub(totals?.totalFss ?? 0), color: "text-amber-600" },
          { label: "Итого для компании", value: fmtRub(totals?.totalEmployerCost ?? 0), color: "text-violet-700" },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-[18px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-4">
            <p className="text-[10px] text-gray-400 font-medium leading-tight">{item.label}</p>
            <p className={`text-lg font-bold mt-1 ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {/* Teacher breakdown table */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="px-5 py-4 border-b border-black/[0.04]">
          <h3 className="text-sm font-semibold text-gray-700">Детализация по педагогам</h3>
        </div>
        {teachers.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-400">
            Нет данных за {month}. Сначала пересчитайте выплаты.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-gray-400 uppercase tracking-wider bg-gray-50/50">
                  <th className="text-left px-5 py-3 font-medium">Педагог</th>
                  <th className="text-right px-3 py-3 font-medium">Gross</th>
                  <th className="text-right px-3 py-3 font-medium">НДФЛ</th>
                  <th className="text-right px-3 py-3 font-medium">На руки</th>
                  <th className="text-right px-3 py-3 font-medium">ПФР+ФСС</th>
                  <th className="text-right px-5 py-3 font-medium">Стоимость</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {teachers.map((t) => (
                  <tr key={t.teacher.crmId} className="hover:bg-gray-50/40 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{t.teacher.fullName ?? "—"}</p>
                      {t.profile?.position && <p className="text-[10px] text-gray-400">{t.profile.position}</p>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-700">{fmtRub(t.totalGross)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-red-400">−{fmtRub(t.ndflAmount)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-gray-900">{fmtRub(t.netTakeHome)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-amber-500">{fmtRub(t.pfrAmount + t.fssAmount)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold text-violet-600">{fmtRub(t.employerCost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-violet-50/60 font-semibold text-sm border-t border-violet-100">
                  <td className="px-5 py-3 text-violet-800">Итого</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-800">{fmtRub(totals?.totalGross ?? 0)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-red-500">−{fmtRub(totals?.totalNdfl ?? 0)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-800">{fmtRub((totals?.totalGross ?? 0) - (totals?.totalNdfl ?? 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-amber-600">{fmtRub((totals?.totalPfr ?? 0) + (totals?.totalFss ?? 0))}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-violet-700">{fmtRub(totals?.totalEmployerCost ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Rate {
  id: string;
  rateType: "per_lesson" | "fixed_monthly" | "per_hour";
  rateAmount: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

interface Teacher {
  id: string;
  crmId: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  lessonsCount: number;
  calculatedPay: number | null;
  rate: Rate | null;
  payout: {
    id: string;
    lessonsCount: number;
    calculatedAmount: string | null;
    confirmedAmount: string | null;
    status: string;
    paidAt: string | null;
  } | null;
}

interface Stats {
  totalTeachers: number;
  activeTeachers: number;
  lessonsThisMonth: number;
  avgLessonsPerTeacher: number;
  payrollEstimate: number;
  ratesConfigured: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const RATE_TYPE_LABELS: Record<string, string> = {
  per_lesson: "за занятие",
  fixed_monthly: "фиксированный/мес",
  per_hour: "за час",
};

// Predefined avatar colours per teacher index
const AVATAR_COLORS = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-indigo-100 text-indigo-700",
  "bg-pink-100 text-pink-700",
];

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5 flex items-start gap-4">
      <div className="w-10 h-10 rounded-xl bg-[#F7F8FB] flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Rate dialog ──────────────────────────────────────────────────────────────

function RateDialog({ teacher, onClose }: { teacher: Teacher; onClose: () => void }) {
  const qc = useQueryClient();
  const [rateType, setRateType] = useState<"per_lesson" | "fixed_monthly" | "per_hour">(
    teacher.rate?.rateType ?? "per_lesson",
  );
  const [amount, setAmount] = useState(teacher.rate ? teacher.rate.rateAmount : "");
  const [notes, setNotes] = useState(teacher.rate?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError("Укажите ставку > 0"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherCrmId: teacher.crmId,
          rateType,
          rateAmount: amt,
          effectiveFrom: today,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Ошибка"); }
      await qc.invalidateQueries({ queryKey: ["staff-teachers"] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-[22px] shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Ставка педагога</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[#F7F8FB] rounded-xl p-3 text-sm font-medium text-gray-700">
          {teacher.fullName ?? "Неизвестный"}
        </div>

        {/* Rate type */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 font-medium">Тип ставки</label>
          <div className="grid grid-cols-3 gap-2">
            {(["per_lesson", "fixed_monthly", "per_hour"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setRateType(t)}
                className={`text-xs px-3 py-2 rounded-xl border transition-colors ${rateType === t
                  ? "border-violet-500 bg-violet-50 text-violet-700 font-semibold"
                  : "border-gray-200 text-gray-500 hover:border-gray-300"}`}
              >
                {RATE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Amount */}
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400 font-medium">Сумма (₽)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400 font-medium">Заметки</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Необязательно"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="w-4 h-4" />{error}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50">
            Отмена
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Teacher card ─────────────────────────────────────────────────────────────

function TeacherCard({
  teacher, colorClass, onSetRate,
}: {
  teacher: Teacher;
  colorClass: string;
  onSetRate: (t: Teacher) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = teacher.status === "1" || teacher.status === "active"
    ? "text-emerald-600 bg-emerald-50"
    : "text-gray-400 bg-gray-100";
  const statusLabel = teacher.status === "1" || teacher.status === "active"
    ? "Активен" : (teacher.status ?? "—");

  const payAmount = teacher.payout?.confirmedAmount
    ? parseFloat(teacher.payout.confirmedAmount)
    : teacher.calculatedPay;

  const payStatus = teacher.payout?.status ?? "none";
  const payStatusLabel: Record<string, string> = { draft: "Расчёт", confirmed: "Подтверждено", paid: "Выплачено", none: "Без ставки" };
  const payStatusColor: Record<string, string> = {
    draft: "text-amber-600 bg-amber-50",
    confirmed: "text-blue-600 bg-blue-50",
    paid: "text-emerald-600 bg-emerald-50",
    none: "text-gray-400 bg-gray-100",
  };

  return (
    <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center gap-4">
        {/* Avatar */}
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold shrink-0 ${colorClass}`}>
          {initials(teacher.fullName)}
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm truncate">{teacher.fullName ?? "Неизвестный"}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
            {teacher.rate && (
              <span className="text-[10px] text-gray-400">
                {parseFloat(teacher.rate.rateAmount).toLocaleString("ru-RU")} ₽ {RATE_TYPE_LABELS[teacher.rate.rateType]}
              </span>
            )}
          </div>
        </div>

        {/* Lesson count */}
        <div className="text-right shrink-0">
          <p className="text-xl font-bold text-gray-900">{teacher.lessonsCount}</p>
          <p className="text-[10px] text-gray-400">занятий</p>
        </div>

        {/* Expand toggle */}
        <button onClick={() => setExpanded((v) => !v)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Pay summary row */}
      <div className="px-5 pb-4 flex items-center gap-3">
        <div className="flex-1 bg-[#F7F8FB] rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">К выплате</span>
          <span className="text-sm font-semibold text-gray-900">{fmt(payAmount)}</span>
        </div>
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${payStatusColor[payStatus] ?? payStatusColor["none"]}`}>
          {payStatusLabel[payStatus] ?? "—"}
        </span>
        <button
          onClick={() => onSetRate(teacher)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700"
          title="Настроить ставку"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Expanded: contacts */}
      {expanded && (
        <div className="border-t border-black/[0.04] px-5 py-4 space-y-2">
          {teacher.phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Phone className="w-3.5 h-3.5 text-gray-400" />
              {teacher.phone}
            </div>
          )}
          {teacher.email && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Mail className="w-3.5 h-3.5 text-gray-400" />
              {teacher.email}
            </div>
          )}
          {!teacher.phone && !teacher.email && (
            <p className="text-xs text-gray-400">Нет контактных данных в CRM</p>
          )}
          {teacher.rate && (
            <div className="mt-2 pt-2 border-t border-black/[0.04] text-xs text-gray-400">
              Ставка с {teacher.rate.effectiveFrom}
              {teacher.rate.notes ? ` · ${teacher.rate.notes}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
        <GraduationCap className="w-8 h-8 text-violet-400" />
      </div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">Педагоги не синхронизированы</h3>
      <p className="text-sm text-gray-400 max-w-xs">
        Перейдите в Технический режим → CRM Sync и нажмите «Sync Teachers»
      </p>
    </div>
  );
}

// ─── Vacation types ───────────────────────────────────────────────────────────

const VAC_TYPE_LABELS: Record<string, string> = {
  annual: "Ежегодный", sick: "Больничный", unpaid: "За свой счёт", maternity: "Декрет",
};

const VAC_STATUS: Record<string, { label: string; color: string }> = {
  planned:   { label: "Запланирован", color: "text-blue-600 bg-blue-50 border-blue-100" },
  approved:  { label: "Утверждён",   color: "text-emerald-600 bg-emerald-50 border-emerald-100" },
  completed: { label: "Завершён",     color: "text-gray-500 bg-gray-100 border-gray-200" },
  cancelled: { label: "Отменён",      color: "text-red-500 bg-red-50 border-red-100" },
};

const DED_TYPE_LABELS: Record<string, string> = {
  advance: "Аванс", loan: "Займ", penalty: "Штраф", tax: "Налог", absence: "Прогул", other: "Прочее",
};

interface Vacation {
  id: string;
  teacherCrmId: string;
  vacationType: string | null;
  startDate: string;
  endDate: string;
  daysCount: number | null;
  accruedAmount: string | null;
  paidAmount: string | null;
  status: string | null;
  notes: string | null;
}

interface Deduction {
  id: string;
  teacherCrmId: string;
  periodMonth: string;
  deductionType: string;
  amount: string;
  reason: string | null;
  status: string | null;
}

interface PayrollReserve {
  avgMonthlyPayroll: number;
  avgMonthlyBonus: number;
  vacationReserve: number;
  reserveAmount: number;
  months: string[];
  note: string;
}

function fmtRub2(n: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

// ─── Vacations Tab ────────────────────────────────────────────────────────────

function VacationsTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ teacherCrmId: "", vacationType: "annual", startDate: "", endDate: "", accruedAmount: "", notes: "" });
  const [adding, setAdding] = useState(false);

  const { data: teachers } = useQuery<{ teachers: Teacher[] }>({
    queryKey: ["staff-teachers", ""],
    queryFn: () => fetch("/api/staff/teachers").then((r) => r.json()),
  });

  const { data: vacations = [], isLoading } = useQuery<Vacation[]>({
    queryKey: ["staff-vacations"],
    queryFn: () => fetch("/api/staff/vacations").then((r) => r.json()),
  });

  const { data: hrSummary } = useQuery<{ vacations: { total: number; onVacation: number; planned: number; totalDays: number } }>({
    queryKey: ["staff-hr-summary"],
    queryFn: () => fetch("/api/staff/hr-summary").then((r) => r.json()),
  });

  const teacherName = (crmId: string) =>
    teachers?.teachers?.find((t) => t.crmId === crmId)?.fullName ?? crmId;

  async function addVacation() {
    if (!form.teacherCrmId || !form.startDate || !form.endDate) return;
    setAdding(true);
    try {
      await fetch("/api/staff/vacations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, accruedAmount: form.accruedAmount || undefined }),
      });
      qc.invalidateQueries({ queryKey: ["staff-vacations"] });
      qc.invalidateQueries({ queryKey: ["staff-hr-summary"] });
      setShowAdd(false);
      setForm({ teacherCrmId: "", vacationType: "annual", startDate: "", endDate: "", accruedAmount: "", notes: "" });
    } finally {
      setAdding(false);
    }
  }

  const vs = hrSummary?.vacations;

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Всего записей", value: vs?.total ?? 0, color: "text-violet-600" },
          { label: "Сейчас в отпуске", value: vs?.onVacation ?? 0, color: "text-amber-600" },
          { label: "Запланировано", value: vs?.planned ?? 0, color: "text-blue-600" },
          { label: "Дней отдыха (всего)", value: vs?.totalDays ?? 0, color: "text-emerald-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5">
            <p className="text-xs font-medium text-gray-400 mb-2">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* List card */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
          <h3 className="text-sm font-semibold text-gray-800">Отпуска и больничные</h3>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-xl hover:bg-violet-700"
          >
            <Plus className="w-3.5 h-3.5" />Добавить
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="px-5 py-4 bg-violet-50 border-b border-violet-100 space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Педагог</label>
                <select value={form.teacherCrmId} onChange={(e) => setForm({ ...form, teacherCrmId: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">Выбрать…</option>
                  {teachers?.teachers?.map((t) => <option key={t.crmId} value={t.crmId}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Тип</label>
                <select value={form.vacationType} onChange={(e) => setForm({ ...form, vacationType: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                  {Object.entries(VAC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Начисление (₽)</label>
                <input value={form.accruedAmount} onChange={(e) => setForm({ ...form, accruedAmount: e.target.value })}
                  placeholder="0" className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата начала</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата окончания</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Примечание</label>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="…" className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-gray-200 text-sm rounded-xl hover:bg-gray-50">Отмена</button>
              <button onClick={addVacation} disabled={adding || !form.teacherCrmId || !form.startDate || !form.endDate}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm rounded-xl hover:bg-violet-700 disabled:opacity-50">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Сохранить
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
        ) : vacations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-600">Нет записей</p>
            <p className="text-xs text-gray-400 mt-1">Добавьте первый отпуск</p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {vacations.map((v) => {
              const sc = VAC_STATUS[v.status ?? "approved"] ?? VAC_STATUS.approved;
              return (
                <div key={v.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-gray-900">{teacherName(v.teacherCrmId)}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${sc.color}`}>{sc.label}</span>
                      <span className="text-xs text-gray-400">{VAC_TYPE_LABELS[v.vacationType ?? "annual"] ?? v.vacationType}</span>
                    </div>
                    <div className="text-xs text-gray-400">{v.startDate} — {v.endDate} · {v.daysCount ?? "?"} дн.</div>
                    {v.notes && <div className="text-xs text-gray-400 mt-0.5">{v.notes}</div>}
                  </div>
                  {v.accruedAmount && (
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-800">{fmtRub2(parseFloat(v.accruedAmount))}</p>
                      <p className="text-[10px] text-gray-400">начислено</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Deductions Tab ───────────────────────────────────────────────────────────

function DeductionsTab({ month }: { month: string }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ teacherCrmId: "", periodMonth: month, deductionType: "advance", amount: "", reason: "" });
  const [adding, setAdding] = useState(false);

  const { data: teachers } = useQuery<{ teachers: Teacher[] }>({
    queryKey: ["staff-teachers", ""],
    queryFn: () => fetch("/api/staff/teachers").then((r) => r.json()),
  });

  const { data: deductions = [], isLoading } = useQuery<Deduction[]>({
    queryKey: ["staff-deductions", month],
    queryFn: () => fetch(`/api/staff/deductions?periodMonth=${month}`).then((r) => r.json()),
  });

  const totalAmount = deductions.reduce((s, d) => s + parseFloat(d.amount), 0);

  const teacherName = (crmId: string) =>
    teachers?.teachers?.find((t) => t.crmId === crmId)?.fullName ?? crmId;

  async function addDeduction() {
    if (!form.teacherCrmId || !form.amount) return;
    setAdding(true);
    try {
      await fetch("/api/staff/deductions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, periodMonth: month }),
      });
      qc.invalidateQueries({ queryKey: ["staff-deductions"] });
      setShowAdd(false);
      setForm({ teacherCrmId: "", periodMonth: month, deductionType: "advance", amount: "", reason: "" });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Всего удержаний", value: deductions.length, color: "text-violet-600" },
          { label: "Сумма удержаний", value: fmtRub2(totalAmount), color: "text-red-500" },
          { label: "Ожидают обработки", value: deductions.filter((d) => d.status === "pending").length, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5">
            <p className="text-xs font-medium text-gray-400 mb-2">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
          <h3 className="text-sm font-semibold text-gray-800">Удержания из зарплаты</h3>
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-xl hover:bg-violet-700">
            <Plus className="w-3.5 h-3.5" />Добавить
          </button>
        </div>

        {showAdd && (
          <div className="px-5 py-4 bg-violet-50 border-b border-violet-100 space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Педагог</label>
                <select value={form.teacherCrmId} onChange={(e) => setForm({ ...form, teacherCrmId: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">Выбрать…</option>
                  {teachers?.teachers?.map((t) => <option key={t.crmId} value={t.crmId}>{t.fullName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Тип удержания</label>
                <select value={form.deductionType} onChange={(e) => setForm({ ...form, deductionType: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300">
                  {Object.entries(DED_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Сумма (₽)</label>
                <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0" className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
              <div className="col-span-2 lg:col-span-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Основание</label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Причина удержания…" className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border border-gray-200 text-sm rounded-xl hover:bg-gray-50">Отмена</button>
              <button onClick={addDeduction} disabled={adding || !form.teacherCrmId || !form.amount}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm rounded-xl hover:bg-violet-700 disabled:opacity-50">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Сохранить
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
        ) : deductions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Calculator className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-sm font-semibold text-gray-600">Удержаний нет</p>
            <p className="text-xs text-gray-400 mt-1">В выбранном периоде</p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {deductions.map((d) => (
              <div key={d.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-gray-900">{teacherName(d.teacherCrmId)}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                      {DED_TYPE_LABELS[d.deductionType] ?? d.deductionType}
                    </span>
                  </div>
                  {d.reason && <p className="text-xs text-gray-400">{d.reason}</p>}
                  <p className="text-xs text-gray-300">{d.periodMonth}</p>
                </div>
                <span className="text-sm font-bold text-red-500 shrink-0">−{fmtRub2(parseFloat(d.amount))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Payroll Reserve Tab ──────────────────────────────────────────────────────

function ReserveTab() {
  const { data: reserve, isLoading } = useQuery<PayrollReserve>({
    queryKey: ["staff-payroll-reserve"],
    queryFn: () => fetch("/api/staff/payroll-reserve").then((r) => r.json()),
  });

  const bars = reserve ? [
    { label: "Ср. ФОТ (3 мес.)", value: reserve.avgMonthlyPayroll, color: "bg-violet-500", pct: 100 },
    { label: "Ср. бонусы",       value: reserve.avgMonthlyBonus,   color: "bg-indigo-400",  pct: reserve.avgMonthlyPayroll ? Math.round((reserve.avgMonthlyBonus / reserve.avgMonthlyPayroll) * 100) : 0 },
    { label: "Резерв отпускных", value: reserve.vacationReserve,   color: "bg-amber-400",   pct: reserve.avgMonthlyPayroll ? Math.round((reserve.vacationReserve / reserve.avgMonthlyPayroll) * 100) : 0 },
  ] : [];

  return (
    <div className="space-y-5">
      {/* Main reserve card */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-violet-50 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-violet-500" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Резерв ФОТ</h3>
            <p className="text-xs text-gray-400">рекомендованная подушка безопасности</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
        ) : reserve ? (
          <div className="space-y-5">
            {/* Big number */}
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-violet-600">{fmtRub2(reserve.reserveAmount)}</p>
              <p className="text-sm text-gray-400 mt-1">{reserve.note}</p>
            </div>

            {/* Breakdown bars */}
            <div className="space-y-4">
              {bars.map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-medium text-gray-600">{b.label}</span>
                    <span className="text-xs font-bold text-gray-800">{fmtRub2(b.value)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${b.color} rounded-full`} style={{ width: `${Math.min(b.pct, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Periods used */}
            <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-400">
              Расчёт по данным за: {reserve.months.join(", ")}
            </div>

            {/* Recommendations */}
            <div className="bg-violet-50 rounded-[18px] p-4">
              <h4 className="text-xs font-semibold text-violet-800 mb-2">Рекомендации</h4>
              <ul className="space-y-1 text-xs text-violet-700">
                <li>• Держите резерв на отдельном счёте или в депозите</li>
                <li>• Пополняйте ежемесячно на разницу между фактом и резервом</li>
                <li>• Пересчитывайте резерв при найме новых сотрудников</li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">Нет данных о выплатах. Сначала запустите расчёт ФОТ.</p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StaffPage() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [rateTeacher, setRateTeacher] = useState<Teacher | null>(null);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"teachers" | "fot" | "vacations" | "deductions" | "reserve">("teachers");
  const qc = useQueryClient();

  const { data: monthsData } = useQuery<string[]>({
    queryKey: ["staff-months"],
    queryFn: () => fetch("/api/staff/months").then((r) => r.json()),
  });

  const { data: statsData, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["staff-stats", month],
    queryFn: () => fetch(`/api/staff/stats?month=${month}`).then((r) => r.json()),
  });

  const { data: teachersData, isLoading: teachersLoading } = useQuery<{ teachers: Teacher[]; month: string | null }>({
    queryKey: ["staff-teachers", month],
    queryFn: () => fetch(`/api/staff/teachers?month=${month}`).then((r) => r.json()),
  });

  const teachers = teachersData?.teachers ?? [];

  const monthOptions = useMemo(() => {
    const opts = monthsData ?? [];
    if (!opts.includes(defaultMonth)) return [defaultMonth, ...opts];
    return opts;
  }, [monthsData, defaultMonth]);

  function monthLabel(m: string) {
    const [y, mo] = m.split("-");
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return d.toLocaleString("ru-RU", { month: "long", year: "numeric" });
  }

  async function recalc() {
    setRecalcLoading(true);
    try {
      await fetch("/api/staff/payouts/recalc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      await qc.invalidateQueries({ queryKey: ["staff-teachers"] });
      await qc.invalidateQueries({ queryKey: ["staff-stats"] });
    } finally {
      setRecalcLoading(false);
    }
  }

  const hasTeachers = teachers.length > 0;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1440px] mx-auto space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Сотрудники</h1>
          <p className="text-sm text-gray-400 mt-0.5">Педагоги, нагрузка и выплаты</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Month picker */}
          <div className="relative">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="appearance-none bg-white border border-gray-200 rounded-xl pl-4 pr-8 py-2.5 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300 cursor-pointer"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>

          {/* Recalc */}
          <button
            onClick={recalc}
            disabled={recalcLoading || !hasTeachers}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {recalcLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            Пересчитать
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-black/[0.06] -mb-2">
        {[
          { key: "teachers" as const, label: "👩‍🏫 Педагоги" },
          { key: "fot" as const, label: "💰 ФОТ и налоги" },
          { key: "vacations" as const, label: "🏖️ Отпуска" },
          { key: "deductions" as const, label: "📉 Удержания" },
          { key: "reserve" as const, label: "🏦 Резерв ФОТ" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === t.key ? "text-violet-600 border-violet-500" : "text-gray-400 border-transparent hover:text-gray-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* New tabs */}
      {activeTab === "fot" && <FotDashboardView month={month} />}
      {activeTab === "vacations" && <VacationsTab />}
      {activeTab === "deductions" && <DeductionsTab month={month} />}
      {activeTab === "reserve" && <ReserveTab />}

      {/* Teachers tab content */}
      {activeTab === "teachers" && <>

      {/* Stats row — показываем только если данные валидны */}
      {!statsLoading && (statsData?.totalTeachers ?? 0) > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Users className="w-5 h-5 text-violet-500" />}
            label="Педагогов"
            value={String(statsData!.totalTeachers)}
            sub={`активных: ${statsData!.activeTeachers}`}
          />
          <StatCard
            icon={<BookOpen className="w-5 h-5 text-blue-500" />}
            label="Занятий за месяц"
            value={String(statsData?.lessonsThisMonth ?? 0)}
            sub={`ср. нагрузка: ${statsData?.avgLessonsPerTeacher ?? 0} зан/пед`}
          />
          <StatCard
            icon={<Wallet className="w-5 h-5 text-emerald-500" />}
            label="Фонд оплаты"
            value={fmt(statsData?.payrollEstimate ?? 0)}
            sub="расчётный"
          />
          <StatCard
            icon={<Settings2 className="w-5 h-5 text-amber-500" />}
            label="Ставки настроены"
            value={`${statsData?.ratesConfigured ?? 0} / ${statsData!.totalTeachers}`}
            sub={statsData && statsData.ratesConfigured < statsData.totalTeachers
              ? "нужно настроить"
              : "всё настроено"}
          />
        </div>
      )}

      {/* Alert: no rates configured */}
      {hasTeachers && statsData && statsData.ratesConfigured === 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Ставки не настроены</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Нажмите на иконку настроек у каждого педагога, чтобы задать ставку и рассчитать выплаты.
            </p>
          </div>
        </div>
      )}

      {/* Teachers grid */}
      {teachersLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
        </div>
      ) : !hasTeachers ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teachers.map((t, i) => (
            <TeacherCard
              key={t.id}
              teacher={t}
              colorClass={AVATAR_COLORS[i % AVATAR_COLORS.length]}
              onSetRate={setRateTeacher}
            />
          ))}
        </div>
      )}

      {/* Rate dialog */}
      {rateTeacher && (
        <RateDialog teacher={rateTeacher} onClose={() => setRateTeacher(null)} />
      )}
      </>}
    </div>
  );
}
