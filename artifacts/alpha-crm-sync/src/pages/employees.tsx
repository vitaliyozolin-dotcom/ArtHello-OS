import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserCheck, TrendingUp, BarChart2,
  Search, Plus, X, ChevronRight, Loader2,
  Briefcase, Building2, CalendarDays, Phone,
  Mail, CreditCard, ClipboardList, BookUser,
  CheckCircle2, PauseCircle, XCircle, AlertCircle,
  Download, Link2, Unlink, GraduationCap,
  Tag, Zap, Archive, SlidersHorizontal, Eye, EyeOff,
  ChevronDown, ChevronUp, Save, Pencil,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DirectionEntry {
  name: string;
  source: string;
  lessons_count: number;
  groups_count: number;
}

interface Department {
  id: string;
  name: string;
  code: string | null;
  sortOrder: number;
}

interface Employee {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  employmentType: string;
  status: string;
  primaryRole: string | null;
  primaryDepartment: string | null;
  startDate: string | null;
  inn: string | null;
  bankDetails: string | null;
  notes: string | null;
  teacherCrmId: string | null;
  branchCrmId: string | null;
  personId: string | null;
  month: string;
  lessonsCount: number | null;
  groupsCount: number | null;
  studentsCount: number | null;
  attendanceCount: number | null;
  attributionStatus: string | null;
  revenueRub: number | null;
  accrualsRub: number | null;
  marginRub: number | null;
  marginPct: number | null;
  // P9.3.1 classification
  employeeKind: string | null;
  employeeType: string | null;
  classificationStatus: string | null;
  classificationReason: string | null;
  directions: DirectionEntry[] | null;
  excludeFromStaffAnalytics: boolean;
}

interface PayrollRule {
  id: string;
  ruleType: string;
  amount: string | null;
  groupId: string | null;
  department: string | null;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  notes: string | null;
}

interface EmployeeRole {
  id: string;
  roleName: string;
  department: string | null;
  branchId: string | null;
  validFrom: string | null;
  validTo: string | null;
  isPrimary: boolean;
}

interface TopGroup {
  groupCrmId: string;
  groupName: string | null;
  subjectName: string | null;
  lessonsCount: number;
  uniqueStudentsCount: number;
  attendanceCount: number;
}

interface EducationalUnitLink {
  link_id: string;
  educational_unit_id: string;
  unit_name: string;
  educational_unit_type: string;
  department: string | null;
  crm_group_id: string | null;
  role_in_unit: string | null;
  attribution_model: string | null;
  is_primary: boolean;
  source: string | null;
  confidence: string | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
}

interface EmployeeDetail {
  employee: Employee & { departmentId: string | null; updatedAt: string };
  roles: EmployeeRole[];
  rules: PayrollRule[];
  month: string;
  educationalUnitLinks: EducationalUnitLink[];
  revenue: {
    lessonsCount: number;
    groupsCount: number;
    studentsCount: number;
    attendanceCount: number;
    revenueRub: number;
    topGroups: TopGroup[];
    attributionStatus: "ready" | "partial" | "missing_data";
    warnings: string[];
  } | null;
  finance: {
    revenueRub: number | null;
    accrualsRub: number | null;
    marginRub: number | null;
    marginPct: number | null;
    note: string;
  };
}

interface Stats {
  total: number;
  active: number;
  paused: number;
  dismissed: number;
  linkedToCrm: number;
  employees_total: number;
  employees_active: number;
  employees_with_teacher_crm_id: number;
  employees_without_teacher_crm_id: number;
  employees_with_person_id: number;
  employees_without_person_id: number;
  crm_teachers_total: number;
  crm_teachers_with_employee: number;
  crm_teachers_without_employee: number;
  teacher_link_coverage_percent: number;
  person_link_coverage_percent: number;
  // P9.3.1
  employees_visible: number;
  employees_excluded_from_analytics: number;
  real_employees: number;
  former_employees: number;
  technical_records: number;
  synthetic_shared_teachers: number;
  needs_review: number;
  classified: number;
  not_classified: number;
}

interface PopulateResult {
  processed: number;
  created: number;
  skipped_existing: number;
  errors: number;
  examples_created: string[];
  person_links_created: number;
  person_links_ambiguous: number;
  person_links_missing: number;
}

interface ClassifyResult {
  processed: number;
  classified: number;
  needs_review: number;
  excluded: number;
  technical_records: number;
  former_employees: number;
  synthetic_records: number;
  errors: string[];
  examples: Array<{ id: string; name: string; kind: string; reason: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ATTR_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  ready:        { label: "Атрибуция: готово", color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  partial:      { label: "Атрибуция: частично", color: "bg-amber-50 border-amber-200 text-amber-700" },
  missing_data: { label: "Нет данных за период", color: "bg-gray-50 border-gray-200 text-gray-400" },
};

const WARNING_LABELS: Record<string, string> = {
  synthetic_or_shared_teacher: "⚠ Синтетический/общий педагог — данные не персонифицированы",
  no_group_id_on_lessons:      "⚠ Часть уроков без group ID",
  no_attendance_data:          "⚠ Посещаемость не загружена — выручка не атрибутирована",
  historical_group_id:         "⚠ Исторические group ID (группа удалена из CRM)",
};

const EMPLOYEE_KIND_META: Record<string, { label: string; color: string; short: string }> = {
  real_employee:           { label: "Реальный сотрудник",   color: "bg-emerald-50 border-emerald-200 text-emerald-700", short: "Реальный" },
  former_employee:         { label: "Бывший сотрудник",     color: "bg-gray-50 border-gray-200 text-gray-500",          short: "Бывший" },
  contractor:              { label: "Подрядчик",            color: "bg-blue-50 border-blue-200 text-blue-700",           short: "Подрядчик" },
  technical_record:        { label: "Техническая запись",   color: "bg-red-50 border-red-200 text-red-600",              short: "Техн." },
  direction_record:        { label: "Направление",          color: "bg-purple-50 border-purple-200 text-purple-700",     short: "Направл." },
  synthetic_shared_teacher:{ label: "Общий педагог",        color: "bg-orange-50 border-orange-200 text-orange-700",     short: "Общий" },
  unknown:                 { label: "Не классифицирован",   color: "bg-yellow-50 border-yellow-200 text-yellow-700",     short: "Неизв." },
};

const EMPLOYEE_TYPE_LABELS: Record<string, string> = {
  teacher:            "Педагог",
  educator:           "Воспитатель",
  assistant_educator: "Помощник воспитателя",
  administrator:      "Администратор",
  sales_manager:      "Менеджер продаж",
  manager:            "Менеджер",
  kitchen:            "Кухня",
  cleaner:            "Уборщица",
  methodologist:      "Методист",
  contractor:         "Подрядчик",
  other:              "Другое",
};

const CLASSIFICATION_STATUS_META: Record<string, { label: string; color: string }> = {
  classified:                    { label: "Классифицирован",         color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  needs_review:                  { label: "Требует проверки",        color: "bg-amber-50 border-amber-200 text-amber-700" },
  excluded_from_staff_analytics: { label: "Исключён из аналитики",   color: "bg-red-50 border-red-200 text-red-600" },
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  employee: "Сотрудник",
  self_employed: "Самозанятый",
  contractor: "Подрядчик",
  sole_proprietor: "ИП",
};

const STATUS_META: Record<string, { label: string; color: string; Icon: React.FC<{ className?: string }> }> = {
  active:    { label: "Активный",   color: "text-emerald-600 bg-emerald-50 border-emerald-200", Icon: CheckCircle2 },
  paused:    { label: "Пауза",      color: "text-amber-600 bg-amber-50 border-amber-200",       Icon: PauseCircle },
  dismissed: { label: "Уволен",     color: "text-gray-400 bg-gray-50 border-gray-200",          Icon: XCircle },
};

const RULE_TYPE_LABELS: Record<string, string> = {
  fixed_salary:       "Оклад",
  per_child:          "За ребёнка",
  per_lesson:         "За занятие",
  per_hour:           "Почасово",
  per_shift:          "За смену",
  percent_of_revenue: "% от выручки",
  manual_bonus:       "Бонус",
  manual_penalty:     "Штраф",
};

const ALL_DEPARTMENTS = [
  "Детский сад", "Школа", "Клубные занятия", "Дополнительные услуги",
  "Онлайн школа", "Кухня", "Администрация", "Управление", "Не определено",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2).replace(/\.?0+$/, "")} млн ₽`;
  if (abs >= 100_000) return `${sign}${Math.round(abs / 1000)} тыс. ₽`;
  if (abs >= 1_000) return `${sign}${(abs / 1000).toFixed(1).replace(".0", "")} тыс. ₽`;
  return `${sign}${Math.round(abs).toLocaleString("ru-RU")} ₽`;
}

function monthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    opts.push({ val, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return opts;
}

// ─── KindBadge ────────────────────────────────────────────────────────────────

function KindBadge({ kind, short = false }: { kind: string | null; short?: boolean }) {
  if (!kind) return null;
  const meta = EMPLOYEE_KIND_META[kind];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${meta.color}`}>
      {short ? meta.short : meta.label}
    </span>
  );
}

// ─── ClassificationStatusBadge ────────────────────────────────────────────────

function ClassificationStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = CLASSIFICATION_STATUS_META[status];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent ?? "bg-[#F7F8FB]"}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-none mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Link badge ───────────────────────────────────────────────────────────────

function LinkBadge({ linked, yesLabel, noLabel }: { linked: boolean; yesLabel: string; noLabel: string }) {
  return linked ? (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium whitespace-nowrap">
      <CheckCircle2 className="w-2.5 h-2.5" />{yesLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-400 font-medium whitespace-nowrap">
      <XCircle className="w-2.5 h-2.5" />{noLabel}
    </span>
  );
}

// ─── Employee Row ─────────────────────────────────────────────────────────────

function EmployeeRow({
  e, onSelect, selected,
}: {
  e: Employee;
  onSelect: () => void;
  selected: boolean;
}) {
  const sm = STATUS_META[e.status] ?? STATUS_META["active"];
  const SmIcon = sm.Icon;
  const isExcluded = e.excludeFromStaffAnalytics;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left transition-colors ${
        selected ? "bg-violet-50" : "hover:bg-gray-50/80"
      } ${isExcluded ? "opacity-50" : ""}`}
    >
      {/* Mobile view */}
      <div className="flex items-center gap-3 px-4 py-3.5 sm:hidden">
        <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-violet-600">{e.fullName.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{e.fullName}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-400">{e.primaryDepartment ?? "—"}</span>
            {e.employeeKind && (
              <>
                <span className="text-[10px] text-gray-300">·</span>
                <KindBadge kind={e.employeeKind} short />
              </>
            )}
            {!e.employeeKind && (
              <>
                <span className="text-[10px] text-gray-300">·</span>
                <LinkBadge linked={!!e.teacherCrmId} yesLabel="CRM" noLabel="нет CRM" />
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {e.revenueRub != null && e.revenueRub > 0 && (
            <p className="text-sm font-bold text-emerald-600">{fmtCompact(e.revenueRub)}</p>
          )}
          {/* Badge priority: excluded > kind > status */}
          {e.excludeFromStaffAnalytics ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium bg-gray-50 border-gray-200 text-gray-400 whitespace-nowrap">
              <EyeOff className="w-2.5 h-2.5" />Исключён
            </span>
          ) : e.employeeKind === "former_employee" ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium bg-gray-100 border-gray-200 text-gray-500 whitespace-nowrap">
              Бывший
            </span>
          ) : e.employeeKind === "technical_record" ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium bg-red-50 border-red-200 text-red-500 whitespace-nowrap">
              Техн.
            </span>
          ) : e.classificationStatus === "needs_review" ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium bg-amber-50 border-amber-200 text-amber-600 whitespace-nowrap">
              Проверить
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${sm.color}`}>
              <SmIcon className="w-2.5 h-2.5" />{sm.label}
            </span>
          )}
        </div>
      </div>

      {/* Desktop row */}
      <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_auto_auto_auto_auto_auto_auto] gap-3 items-center px-4 py-3">
        {/* Сотрудник */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-violet-600">{e.fullName.charAt(0).toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{e.fullName}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {e.employeeKind
                ? <KindBadge kind={e.employeeKind} short />
                : <p className="text-[10px] text-gray-400">{EMPLOYMENT_LABELS[e.employmentType] ?? e.employmentType}</p>
              }
            </div>
          </div>
        </div>
        {/* Подразделение */}
        <p className="text-sm text-gray-600 truncate">{e.primaryDepartment ?? "—"}</p>
        {/* Тип сотрудника */}
        <p className="text-sm text-gray-500 truncate hidden lg:block">
          {e.employeeType ? (EMPLOYEE_TYPE_LABELS[e.employeeType] ?? e.employeeType) : (EMPLOYMENT_LABELS[e.employmentType] ?? e.employmentType)}
        </p>
        {/* CRM */}
        <div><LinkBadge linked={!!e.teacherCrmId} yesLabel="CRM ✓" noLabel="нет CRM" /></div>
        {/* Person */}
        <div><LinkBadge linked={!!e.personId} yesLabel="ID ✓" noLabel="нет ID" /></div>
        {/* Занятий */}
        <p className="text-sm text-gray-700 text-right tabular-nums w-10">
          {e.lessonsCount != null ? e.lessonsCount : <span className="text-gray-300">—</span>}
        </p>
        {/* Групп */}
        <p className="text-sm text-gray-700 text-right tabular-nums w-8">
          {e.groupsCount != null ? e.groupsCount : <span className="text-gray-300">—</span>}
        </p>
        {/* Посещений */}
        <p className="text-sm text-gray-700 text-right tabular-nums w-10">
          {e.attendanceCount != null ? e.attendanceCount : <span className="text-gray-300">—</span>}
        </p>
        {/* Статус — priority: excluded > kind > status */}
        <div className="flex flex-col items-end gap-1">
          {e.excludeFromStaffAnalytics ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap bg-gray-50 border-gray-200 text-gray-400">
              <EyeOff className="w-2.5 h-2.5" />Исключён
            </span>
          ) : e.employeeKind === "former_employee" ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap bg-gray-100 border-gray-200 text-gray-500">
              Бывший
            </span>
          ) : e.employeeKind === "technical_record" ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap bg-red-50 border-red-200 text-red-500">
              Техн.
            </span>
          ) : e.classificationStatus === "needs_review" ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap bg-amber-50 border-amber-200 text-amber-600">
              Проверить
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${sm.color}`}>
              <SmIcon className="w-2.5 h-2.5" />{sm.label}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Classification Editor (inside EmployeeCard) ──────────────────────────────

// Kinds that are always excluded from analytics — simplified form shown.
const AUTO_EXCLUDED_KINDS = new Set([
  "former_employee", "technical_record", "synthetic_shared_teacher",
]);

function ClassificationEditor({
  employee,
  onSaved,
}: {
  employee: EmployeeDetail["employee"];
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const [kind, setKind]       = useState(employee.employeeKind ?? "");
  const [empType, setEmpType] = useState(employee.employeeType ?? "");
  const [dept, setDept]       = useState(employee.primaryDepartment ?? "");
  const [reason, setReason]   = useState(employee.classificationReason ?? "");
  const [participation, setParticipation] = useState<"included" | "excluded">(
    employee.excludeFromStaffAnalytics ? "excluded" : "included",
  );

  const isSimplified = AUTO_EXCLUDED_KINDS.has(kind);

  function handleKindChange(newKind: string) {
    setKind(newKind);
    if (AUTO_EXCLUDED_KINDS.has(newKind)) setParticipation("excluded");
    else if (newKind === "real_employee")  setParticipation("included");
  }

  function buildPayload() {
    const exclude = participation === "excluded";
    const classificationStatus = exclude
      ? "excluded_from_staff_analytics"
      : kind === "real_employee" ? "classified" : "needs_review";
    return {
      employeeKind: kind || undefined,
      employeeType: isSimplified ? undefined : (empType || undefined),
      primaryDepartment: isSimplified ? undefined : (dept || undefined),
      classificationStatus,
      classificationReason: reason || undefined,
      excludeFromStaffAnalytics: exclude,
    };
  }

  const mutation = useMutation({
    mutationFn: (body: object) =>
      fetch(`/api/employees/${employee.id}/classification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-detail", employee.id] });
      qc.invalidateQueries({ queryKey: ["employees-stats"] });
      qc.invalidateQueries({ queryKey: ["employees-attribution"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      setOpen(false);
      onSaved();
    },
  });

  const sel = "w-full text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300";

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => { setOpen((v) => !v); setSaved(false); }}
          className="flex items-center gap-1.5 text-[11px] text-violet-600 font-medium hover:text-violet-800 transition-colors"
        >
          <Pencil className="w-3 h-3" />
          {open ? "Закрыть" : "Изменить классификацию"}
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
            <CheckCircle2 className="w-3 h-3" />Сохранено
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2.5 bg-gray-50 rounded-xl p-3 border border-gray-100 space-y-2.5">

          {/* Тип записи */}
          <div>
            <label className="text-[10px] font-medium text-gray-400 block mb-1">Тип записи</label>
            <select value={kind} onChange={(e) => handleKindChange(e.target.value)} className={sel}>
              <option value="">Не выбрано</option>
              {Object.entries(EMPLOYEE_KIND_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Должность + Подразделение — скрыты для "упрощённых" видов */}
          {!isSimplified && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium text-gray-400 block mb-1">Должность</label>
                <select value={empType} onChange={(e) => setEmpType(e.target.value)} className={sel}>
                  <option value="">—</option>
                  {Object.entries(EMPLOYEE_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-gray-400 block mb-1">Подразделение</label>
                <select value={dept} onChange={(e) => setDept(e.target.value)} className={sel}>
                  <option value="">—</option>
                  {ALL_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Участие в аналитике — единственный способ управлять exclude */}
          <div>
            <label className="text-[10px] font-medium text-gray-400 block mb-1.5">Участие в аналитике</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setParticipation("included")}
                disabled={isSimplified}
                className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors ${
                  participation === "included"
                    ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : "bg-white border-gray-200 text-gray-400 hover:bg-gray-50"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                Участвует
              </button>
              <button
                type="button"
                onClick={() => setParticipation("excluded")}
                className={`flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors ${
                  participation === "excluded"
                    ? "bg-red-50 border-red-300 text-red-700"
                    : "bg-white border-gray-200 text-gray-400 hover:bg-gray-50"
                }`}
              >
                Исключён
              </button>
            </div>
            {participation === "excluded" && !isSimplified && (
              <p className="text-[10px] text-amber-600 mt-1">
                Сотрудник будет скрыт из основного списка
              </p>
            )}
          </div>

          {/* Причина */}
          <div>
            <label className="text-[10px] font-medium text-gray-400 block mb-1">Причина</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Краткое пояснение"
              className="w-full text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300"
            />
          </div>

          <button
            onClick={() => mutation.mutate(buildPayload())}
            disabled={mutation.isPending}
            className="w-full bg-violet-600 text-white text-xs font-semibold py-2 rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {mutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Save className="w-3.5 h-3.5" />}
            {mutation.isPending ? "Сохраняю..." : "Сохранить"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Educational Units Block ──────────────────────────────────────────────────

const EDU_TYPE_LABELS: Record<string, string> = {
  kindergarten_group: "Детский сад",
  school_class:       "Школьный класс",
  club_group:         "Кружок",
  summer_camp:        "Летний лагерь",
  service:            "Сервис",
  unknown:            "Неизвестно",
};

const ROLE_LABELS: Record<string, string> = {
  educator:       "Воспитатель",
  class_teacher:  "Классный руководитель",
  teacher:        "Педагог",
  unknown:        "Неизвестно",
};

const ATTR_MODEL_LABELS: Record<string, string> = {
  group_based:  "group-based",
  lesson_based: "lesson-based",
  mixed:        "mixed",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low:    "bg-gray-100 text-gray-500",
};

const SOURCE_COLORS: Record<string, string> = {
  manual:    "bg-violet-100 text-violet-700",
  alpha_crm: "bg-blue-100 text-blue-700",
  inferred:  "bg-gray-100 text-gray-500",
};

type EmployeeDetailRevenue = {
  lessonsCount: number;
  groupsCount: number;
  studentsCount: number;
  attendanceCount: number;
  revenueRub: number;
  topGroups: TopGroup[];
  attributionStatus: "ready" | "partial" | "missing_data";
  warnings: string[];
} | null;

function EducationalUnitsBlock({
  links,
  revenue,
  month,
}: {
  links: EducationalUnitLink[];
  revenue: EmployeeDetailRevenue;
  month: string;
}) {
  const groupBased  = links.filter(l => l.attribution_model === "group_based");
  const lessonBased = links.filter(l => l.attribution_model === "lesson_based");
  const other       = links.filter(l => l.attribution_model !== "group_based" && l.attribution_model !== "lesson_based");

  const revGroupIds = new Set(revenue?.topGroups.map(g => g.groupCrmId) ?? []);

  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Образовательные единицы · {links.length}
      </p>

      {groupBased.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-medium text-gray-400 mb-1.5">
            🏫 group-based ({groupBased.length})
          </p>
          <div className="space-y-1.5">
            {groupBased.map(link => {
              const hasRevenue = link.crm_group_id ? revGroupIds.has(link.crm_group_id) : false;
              const topGroup   = revenue?.topGroups.find(g => g.groupCrmId === link.crm_group_id);
              return (
                <div
                  key={link.link_id}
                  className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 flex flex-col gap-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-gray-800 leading-tight">{link.unit_name}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      {link.is_primary && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">
                          primary
                        </span>
                      )}
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${CONFIDENCE_COLORS[link.confidence ?? "low"] ?? "bg-gray-100 text-gray-500"}`}>
                        {link.confidence ?? "?"}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_COLORS[link.source ?? "inferred"] ?? "bg-gray-100 text-gray-400"}`}>
                        {link.source ?? "—"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-gray-500">
                      {EDU_TYPE_LABELS[link.educational_unit_type] ?? link.educational_unit_type}
                    </span>
                    <span className="text-[10px] text-gray-400">·</span>
                    <span className="text-[10px] text-gray-500">
                      {ROLE_LABELS[link.role_in_unit ?? ""] ?? link.role_in_unit ?? "—"}
                    </span>
                    {link.department && (
                      <>
                        <span className="text-[10px] text-gray-400">·</span>
                        <span className="text-[10px] text-gray-400">{link.department}</span>
                      </>
                    )}
                  </div>
                  {hasRevenue && topGroup && (
                    <div className="flex items-center gap-3 pt-0.5">
                      <span className="text-[10px] text-emerald-700">
                        {topGroup.lessonsCount} урок{topGroup.lessonsCount === 1 ? "" : topGroup.lessonsCount < 5 ? "а" : "ов"} · {month}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {topGroup.uniqueStudentsCount} уч.
                      </span>
                    </div>
                  )}
                  {link.notes && (
                    <p className="text-[10px] text-amber-600 italic">{link.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lessonBased.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-medium text-gray-400 mb-1.5">
            📚 lesson-based ({lessonBased.length})
          </p>
          <div className="space-y-1.5">
            {lessonBased.map(link => {
              const topGroup = revenue?.topGroups.find(g => g.groupCrmId === link.crm_group_id);
              return (
                <div
                  key={link.link_id}
                  className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 flex flex-col gap-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-gray-800 leading-tight">{link.unit_name}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${CONFIDENCE_COLORS[link.confidence ?? "low"] ?? "bg-gray-100 text-gray-500"}`}>
                        {link.confidence ?? "?"}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_COLORS[link.source ?? "inferred"] ?? "bg-gray-100 text-gray-400"}`}>
                        {link.source ?? "—"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-gray-500">
                      {EDU_TYPE_LABELS[link.educational_unit_type] ?? link.educational_unit_type}
                    </span>
                    <span className="text-[10px] text-gray-400">·</span>
                    <span className="text-[10px] text-gray-500">
                      {ROLE_LABELS[link.role_in_unit ?? ""] ?? link.role_in_unit ?? "—"}
                    </span>
                  </div>
                  {topGroup && (
                    <div className="flex items-center gap-3 pt-0.5">
                      <span className="text-[10px] text-emerald-700">
                        {topGroup.lessonsCount} урок{topGroup.lessonsCount === 1 ? "" : topGroup.lessonsCount < 5 ? "а" : "ов"} · {month}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {topGroup.uniqueStudentsCount} уч.
                      </span>
                    </div>
                  )}
                  {link.notes && (
                    <p className="text-[10px] text-amber-600 italic">{link.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {other.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-medium text-gray-400 mb-1.5">
            📎 другие ({other.length})
          </p>
          <div className="space-y-1">
            {other.map(link => (
              <div key={link.link_id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                <p className="text-xs text-gray-700">{link.unit_name}</p>
                <div className="flex items-center gap-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${CONFIDENCE_COLORS[link.confidence ?? "low"] ?? "bg-gray-100 text-gray-500"}`}>
                    {link.confidence ?? "?"}
                  </span>
                  <span className="text-[9px] text-gray-400 px-1.5 py-0.5 rounded-full bg-gray-100">
                    {ATTR_MODEL_LABELS[link.attribution_model ?? ""] ?? link.attribution_model ?? "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {links.length === 0 && (
        <p className="text-xs text-gray-400 italic">Нет привязанных образовательных единиц</p>
      )}
    </div>
  );
}

// ─── Employee Card ────────────────────────────────────────────────────────────

function EmployeeCard({
  employeeId, month, onClose, departments,
}: {
  employeeId: string;
  month: string;
  onClose: () => void;
  departments: Department[];
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<EmployeeDetail>({
    queryKey: ["employee-detail", employeeId, month],
    queryFn: () =>
      fetch(`/api/employees/${employeeId}?month=${month}`).then((r) => r.json()),
  });

  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [ruleType, setRuleType] = useState("per_lesson");
  const [ruleAmount, setRuleAmount] = useState("");
  const [ruleNotes, setRuleNotes] = useState("");

  const addRuleMutation = useMutation({
    mutationFn: (body: object) =>
      fetch("/api/employees/payroll-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-detail", employeeId] });
      setAddRuleOpen(false);
      setRuleAmount("");
      setRuleNotes("");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  const { employee, roles, rules, revenue, finance } = data;
  const sm = STATUS_META[employee.status] ?? STATUS_META["active"];
  const SmIcon = sm.Icon;
  const directions = (employee.directions as DirectionEntry[] | null) ?? [];

  // Display-only override: kind/exclude takes priority over raw CRM status
  const displaySm = (() => {
    if (employee.excludeFromStaffAnalytics) {
      return { label: "Исключён из аналитики", color: "bg-gray-100 text-gray-500 border-gray-200", Icon: EyeOff };
    }
    if (employee.employeeKind === "former_employee") {
      return { label: "Бывший сотрудник", color: "bg-gray-100 text-gray-500 border-gray-200", Icon: Archive };
    }
    if (employee.employeeKind === "technical_record") {
      return { label: "Техническая запись", color: "bg-red-50 text-red-500 border-red-200", Icon: AlertCircle };
    }
    if (employee.employeeKind === "synthetic_shared_teacher") {
      return { label: "Общий педагог", color: "bg-gray-100 text-gray-500 border-gray-200", Icon: Users };
    }
    return sm;
  })();
  const DisplayIcon = displaySm.Icon;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0">
          <span className="text-lg font-bold text-violet-600">
            {employee.fullName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-900 leading-tight">{employee.fullName}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {employee.primaryRole ?? "—"} · {employee.primaryDepartment ?? "—"}
          </p>
          {employee.employeeKind && (
            <div className="mt-1">
              <KindBadge kind={employee.employeeKind} />
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 px-5 py-4 space-y-5 pb-8">
        {/* Block 1 — General */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Общее</p>
          <div className="bg-white rounded-2xl border border-black/[0.06] divide-y divide-gray-50">
            <InfoRow
              icon={<DisplayIcon className={`w-3.5 h-3.5 ${displaySm.color.split(" ")[0]}`} />}
              label="Статус"
              value={displaySm.label}
            />
            <InfoRow
              icon={<Briefcase className="w-3.5 h-3.5 text-gray-400" />}
              label="Оформление"
              value={EMPLOYMENT_LABELS[employee.employmentType] ?? employee.employmentType}
            />
            {employee.inn && (
              <InfoRow
                icon={<CreditCard className="w-3.5 h-3.5 text-gray-400" />}
                label="ИНН"
                value={employee.inn}
              />
            )}
            {employee.startDate && (
              <InfoRow
                icon={<CalendarDays className="w-3.5 h-3.5 text-gray-400" />}
                label="Дата начала"
                value={employee.startDate}
              />
            )}
            {employee.phone && (
              <InfoRow
                icon={<Phone className="w-3.5 h-3.5 text-gray-400" />}
                label="Телефон"
                value={employee.phone}
              />
            )}
            {employee.email && (
              <InfoRow
                icon={<Mail className="w-3.5 h-3.5 text-gray-400" />}
                label="Email"
                value={employee.email}
              />
            )}
            {employee.teacherCrmId && (
              <InfoRow
                icon={<UserCheck className="w-3.5 h-3.5 text-violet-400" />}
                label="CRM Teacher ID"
                value={employee.teacherCrmId}
              />
            )}
          </div>
        </div>

        {/* Block 2 — Classification */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Классификация</p>
          <div className="bg-white rounded-2xl border border-black/[0.06] p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-gray-400 mb-1">Тип записи</p>
                {employee.employeeKind
                  ? <KindBadge kind={employee.employeeKind} />
                  : <p className="text-xs text-gray-300">Не классифицирован</p>
                }
              </div>
              <div>
                <p className="text-[10px] text-gray-400 mb-1">Должность</p>
                <p className="text-sm text-gray-800 font-medium">
                  {employee.employeeType
                    ? (EMPLOYEE_TYPE_LABELS[employee.employeeType] ?? employee.employeeType)
                    : "—"
                  }
                </p>
              </div>
            </div>

            {/* Участие в аналитике — единый читаемый индикатор */}
            <div>
              <p className="text-[10px] text-gray-400 mb-1">Участие в аналитике</p>
              {employee.excludeFromStaffAnalytics ? (
                <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border bg-red-50 border-red-200 text-red-600 font-medium">
                  <EyeOff className="w-3 h-3" />Исключён
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3 h-3" />Участвует
                </span>
              )}
            </div>

            {employee.classificationReason && (
              <div>
                <p className="text-[10px] text-gray-400 mb-1">Причина</p>
                <p className="text-xs text-gray-600">{employee.classificationReason}</p>
              </div>
            )}

            {/* Directions */}
            {directions.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-400 mb-2">Направления</p>
                <div className="space-y-1.5">
                  {directions.slice(0, 8).map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2"
                    >
                      <p className="text-xs font-medium text-gray-800 truncate flex-1">{d.name}</p>
                      <div className="flex items-center gap-2 shrink-0 text-[10px] text-gray-500 ml-2">
                        <span>{d.lessons_count} зан.</span>
                        {d.groups_count > 0 && <span>{d.groups_count} гр.</span>}
                      </div>
                    </div>
                  ))}
                  {directions.length > 8 && (
                    <p className="text-[10px] text-gray-400 text-center">
                      +{directions.length - 8} ещё
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Manual editor */}
            <ClassificationEditor
              employee={employee}
              onSaved={() => {}}
            />
          </div>
        </div>

        {/* Block 3 — Educational Units */}
        {data.educationalUnitLinks && data.educationalUnitLinks.length > 0 && (
          <EducationalUnitsBlock
            links={data.educationalUnitLinks}
            revenue={data.revenue}
            month={month}
          />
        )}

        {/* Block 4 — Finance */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Финансы · {month}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <FinanceCell
              label="Выручка"
              value={finance.revenueRub != null ? fmtCompact(finance.revenueRub) : null}
              color="text-emerald-600"
            />
            <FinanceCell
              label="Начислено"
              value={finance.accrualsRub != null ? fmtCompact(finance.accrualsRub) : null}
              color="text-blue-600"
              placeholder="Расчёт: этап 2"
            />
            <FinanceCell
              label="Маржа"
              value={finance.marginRub != null ? fmtCompact(finance.marginRub) : null}
              color="text-violet-600"
              placeholder="—"
            />
            <FinanceCell
              label="Маржинальность"
              value={finance.marginPct != null ? `${finance.marginPct.toFixed(1)}%` : null}
              color="text-violet-600"
              placeholder="—"
            />
          </div>
          {!employee.teacherCrmId && (
            <p className="text-[10px] text-amber-600 bg-amber-50 rounded-xl px-3 py-2 mt-2 border border-amber-100">
              Нет привязки к CRM-преподавателю — выручка недоступна
            </p>
          )}
        </div>

        {/* Block 4 — Operations */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Операционные показатели · {month}
            </p>
            {revenue?.attributionStatus && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${ATTR_STATUS_LABEL[revenue.attributionStatus]?.color ?? "bg-gray-50 border-gray-200 text-gray-400"}`}>
                {ATTR_STATUS_LABEL[revenue.attributionStatus]?.label ?? revenue.attributionStatus}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <OpsCell label="Занятий" value={revenue?.lessonsCount} />
            <OpsCell label="Групп" value={revenue?.groupsCount} />
            <OpsCell label="Детей" value={revenue?.studentsCount} />
            <OpsCell label="Посещений" value={revenue?.attendanceCount} />
          </div>
          {revenue?.warnings && revenue.warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {revenue.warnings.map((w) => (
                <p key={w} className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5">
                  {WARNING_LABELS[w] ?? w}
                </p>
              ))}
            </div>
          )}
          {revenue?.topGroups && revenue.topGroups.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Группы</p>
              <div className="space-y-1.5">
                {revenue.topGroups.map((g) => (
                  <div
                    key={g.groupCrmId}
                    className="bg-white rounded-xl border border-black/[0.06] px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-800 truncate">
                        {g.groupName ?? `Group ${g.groupCrmId}`}
                        {!g.groupName && (
                          <span className="ml-1 text-[9px] text-gray-400">(историч.)</span>
                        )}
                      </p>
                      {g.subjectName && (
                        <p className="text-[10px] text-gray-400 truncate">{g.subjectName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-[10px] text-gray-500">
                      <span className="font-medium">{g.lessonsCount} зан.</span>
                      {g.uniqueStudentsCount > 0 && <span>{g.uniqueStudentsCount} дет.</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!employee.teacherCrmId && (
            <p className="text-[10px] text-gray-400 mt-2 text-center">
              Привяжите CRM Teacher ID для отображения данных
            </p>
          )}
        </div>

        {/* Block 5 — Payroll Rules */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Правила начислений
            </p>
            <button
              onClick={() => setAddRuleOpen((v) => !v)}
              className="text-[11px] text-violet-600 font-medium flex items-center gap-1 hover:text-violet-800"
            >
              <Plus className="w-3 h-3" />
              Добавить
            </button>
          </div>

          {addRuleOpen && (
            <div className="bg-violet-50 rounded-2xl p-4 border border-violet-100 mb-3 space-y-3">
              <div>
                <label className="text-[11px] text-gray-500 font-medium block mb-1">Тип правила</label>
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value)}
                  className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-medium block mb-1">Сумма / %</label>
                <input
                  type="number"
                  value={ruleAmount}
                  onChange={(e) => setRuleAmount(e.target.value)}
                  placeholder="0"
                  className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-medium block mb-1">Примечание</label>
                <input
                  value={ruleNotes}
                  onChange={(e) => setRuleNotes(e.target.value)}
                  placeholder="Необязательно"
                  className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    addRuleMutation.mutate({
                      employeeId: employee.id,
                      ruleType,
                      amount: ruleAmount || undefined,
                      notes: ruleNotes || undefined,
                    })
                  }
                  disabled={addRuleMutation.isPending}
                  className="flex-1 bg-violet-600 text-white text-sm font-medium py-2 rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-colors"
                >
                  {addRuleMutation.isPending ? "Сохраняю..." : "Сохранить"}
                </button>
                <button
                  onClick={() => setAddRuleOpen(false)}
                  className="flex-1 bg-white border border-gray-200 text-sm font-medium py-2 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {rules.length === 0 ? (
            <div className="text-center py-6">
              <ClipboardList className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-xs text-gray-400">Правила не добавлены</p>
              <p className="text-[10px] text-gray-300 mt-1">Расчёт начислений: этап 2</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="bg-white rounded-xl border border-black/[0.06] px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {RULE_TYPE_LABELS[r.ruleType] ?? r.ruleType}
                    </p>
                    {r.notes && <p className="text-[10px] text-gray-400 mt-0.5">{r.notes}</p>}
                    {r.department && <p className="text-[10px] text-gray-400">{r.department}</p>}
                  </div>
                  {r.amount && (
                    <p className="text-sm font-bold text-gray-900">
                      {r.ruleType === "percent_of_revenue"
                        ? `${r.amount}%`
                        : fmtCompact(parseFloat(r.amount))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Roles */}
        {roles.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Роли</p>
            <div className="space-y-1.5">
              {roles.map((r) => (
                <div
                  key={r.id}
                  className="bg-white rounded-xl border border-black/[0.06] px-4 py-2.5 flex items-center gap-3"
                >
                  {r.isPrimary && (
                    <span className="text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                      Основная
                    </span>
                  )}
                  <p className="text-sm font-medium text-gray-800 flex-1">{r.roleName}</p>
                  {r.department && (
                    <p className="text-[10px] text-gray-400 shrink-0">{r.department}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {employee.notes && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
            <p className="text-[11px] font-semibold text-amber-700 mb-1">Заметки</p>
            <p className="text-sm text-amber-800">{employee.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function InfoRow({
  icon, label, value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="shrink-0">{icon}</div>
      <p className="text-[11px] text-gray-400 w-24 shrink-0">{label}</p>
      <p className="text-sm text-gray-800 font-medium flex-1 min-w-0 truncate">{value}</p>
    </div>
  );
}

function FinanceCell({
  label, value, color, placeholder,
}: {
  label: string;
  value: string | null;
  color: string;
  placeholder?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-black/[0.06] p-3 text-center">
      <p className="text-[10px] text-gray-400 mb-1">{label}</p>
      {value != null ? (
        <p className={`text-base font-bold ${color}`}>{value}</p>
      ) : (
        <p className="text-xs text-gray-300">{placeholder ?? "—"}</p>
      )}
    </div>
  );
}

function OpsCell({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="bg-white rounded-2xl border border-black/[0.06] p-3 text-center">
      <p className="text-[10px] text-gray-400 mb-1">{label}</p>
      {value != null ? (
        <p className="text-xl font-bold text-gray-900">{value}</p>
      ) : (
        <p className="text-lg text-gray-200">—</p>
      )}
    </div>
  );
}

// ─── Add Employee Modal ───────────────────────────────────────────────────────

function AddEmployeeModal({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [employmentType, setEmploymentType] = useState("employee");
  const [primaryRole, setPrimaryRole] = useState("");
  const [primaryDepartment, setPrimaryDepartment] = useState("");
  const [startDate, setStartDate] = useState("");
  const [teacherCrmId, setTeacherCrmId] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) =>
      fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.error) { setError(String(data.error)); return; }
      onCreated();
    },
    onError: () => setError("Ошибка при создании"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">Новый сотрудник</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="ФИО *">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванова Анна Петровна"
              className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Телефон">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 999 000 00 00"
                className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </Field>
            <Field label="Email">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@arth.ru"
                className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Тип оформления">
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Дата начала">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Основная роль">
              <input
                value={primaryRole}
                onChange={(e) => setPrimaryRole(e.target.value)}
                placeholder="Педагог"
                className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </Field>
            <Field label="Подразделение">
              <select
                value={primaryDepartment}
                onChange={(e) => setPrimaryDepartment(e.target.value)}
                className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                <option value="">Не выбрано</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="CRM Teacher ID (для выручки)">
            <input
              value={teacherCrmId}
              onChange={(e) => setTeacherCrmId(e.target.value)}
              placeholder="Числовой ID преподавателя из AlphaCRM"
              className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </Field>
        </div>

        {error && (
          <p className="text-sm text-red-500 mt-3 bg-red-50 rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 mt-5">
          <button
            onClick={() =>
              mutation.mutate({
                fullName,
                phone: phone || undefined,
                email: email || undefined,
                employmentType,
                primaryRole: primaryRole || undefined,
                primaryDepartment: primaryDepartment || undefined,
                startDate: startDate || undefined,
                teacherCrmId: teacherCrmId || undefined,
              })
            }
            disabled={!fullName.trim() || mutation.isPending}
            className="flex-1 bg-violet-600 text-white font-medium py-2.5 rounded-2xl hover:bg-violet-700 disabled:opacity-40 transition-colors"
          >
            {mutation.isPending ? "Создаю..." : "Создать"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-700 font-medium py-2.5 rounded-2xl hover:bg-gray-200 transition-colors"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ─── Result banners ───────────────────────────────────────────────────────────

function PopulateResultBanner({
  result, onClose,
}: {
  result: PopulateResult;
  onClose: () => void;
}) {
  return (
    <div className="mx-4 sm:mx-6 lg:mx-8 mb-4 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-bold text-emerald-800 mb-2">✅ Загрузка из AlphaCRM завершена</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-white rounded-xl px-3 py-2 border border-emerald-100">
              <p className="text-gray-400">Обработано</p>
              <p className="text-base font-bold text-gray-900">{result.processed}</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2 border border-emerald-100">
              <p className="text-gray-400">Создано</p>
              <p className="text-base font-bold text-emerald-700">{result.created}</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2 border border-emerald-100">
              <p className="text-gray-400">Уже было</p>
              <p className="text-base font-bold text-gray-500">{result.skipped_existing}</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2 border border-emerald-100">
              <p className="text-gray-400">Ошибок</p>
              <p className={`text-base font-bold ${result.errors > 0 ? "text-red-600" : "text-gray-400"}`}>{result.errors}</p>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="w-6 h-6 rounded-full bg-white border border-emerald-200 flex items-center justify-center hover:bg-emerald-100 transition-colors shrink-0 mt-0.5">
          <X className="w-3 h-3 text-gray-400" />
        </button>
      </div>
    </div>
  );
}

function ClassifyResultBanner({
  result, onClose,
}: {
  result: ClassifyResult;
  onClose: () => void;
}) {
  return (
    <div className="mx-4 sm:mx-6 lg:mx-8 mb-4 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-bold text-violet-800 mb-2">⚡ Классификация завершена</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-2">
            <div className="bg-white rounded-xl px-3 py-2 border border-violet-100">
              <p className="text-gray-400">Обработано</p>
              <p className="text-base font-bold text-gray-900">{result.processed}</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2 border border-violet-100">
              <p className="text-gray-400">Классифицировано</p>
              <p className="text-base font-bold text-emerald-700">{result.classified}</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2 border border-violet-100">
              <p className="text-gray-400">Исключено</p>
              <p className="text-base font-bold text-gray-500">{result.excluded}</p>
            </div>
            <div className="bg-white rounded-xl px-3 py-2 border border-violet-100">
              <p className="text-gray-400">Проверить</p>
              <p className={`text-base font-bold ${result.needs_review > 0 ? "text-amber-600" : "text-gray-400"}`}>{result.needs_review}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            <span className="bg-white border border-red-100 rounded-full px-2.5 py-0.5 text-red-600">
              Техн. записи: <strong>{result.technical_records}</strong>
            </span>
            <span className="bg-white border border-gray-200 rounded-full px-2.5 py-0.5">
              Бывшие: <strong>{result.former_employees}</strong>
            </span>
            <span className="bg-white border border-orange-100 rounded-full px-2.5 py-0.5 text-orange-600">
              Синтетич.: <strong>{result.synthetic_records}</strong>
            </span>
            {result.errors.length > 0 && (
              <span className="bg-white border border-red-200 rounded-full px-2.5 py-0.5 text-red-500">
                Ошибок: <strong>{result.errors.length}</strong>
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="w-6 h-6 rounded-full bg-white border border-violet-200 flex items-center justify-center hover:bg-violet-100 transition-colors shrink-0 mt-0.5">
          <X className="w-3 h-3 text-gray-400" />
        </button>
      </div>
    </div>
  );
}

// ─── Filter Drawer (mobile) ───────────────────────────────────────────────────

function FilterDrawer({
  open, onClose,
  months, month, setMonth,
  departments, department, setDepartment,
  status, setStatus,
  employmentType, setEmploymentType,
  showExcluded, setShowExcluded,
  activeFilterCount,
}: {
  open: boolean;
  onClose: () => void;
  months: { val: string; label: string }[];
  month: string;
  setMonth: (v: string) => void;
  departments: Department[];
  department: string;
  setDepartment: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  employmentType: string;
  setEmploymentType: (v: string) => void;
  showExcluded: boolean;
  setShowExcluded: (v: boolean) => void;
  activeFilterCount: number;
}) {
  if (!open) return null;
  const selectCls = "w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-200";
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:hidden" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl shadow-2xl p-5 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-gray-900">Фильтры</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>

        <Field label="Месяц">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
            {months.map((m) => <option key={m.val} value={m.val}>{m.label}</option>)}
          </select>
        </Field>

        <Field label="Подразделение">
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className={selectCls}>
            <option value="">Все подразделения</option>
            {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </Field>

        <Field label="Статус">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="paused">Пауза</option>
            <option value="dismissed">Уволенные</option>
          </select>
        </Field>

        <Field label="Тип оформления">
          <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className={selectCls}>
            <option value="">Все типы</option>
            {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>

        <label className="flex items-center gap-3 cursor-pointer p-3 bg-gray-50 rounded-2xl">
          <input
            type="checkbox"
            checked={showExcluded}
            onChange={(e) => setShowExcluded(e.target.checked)}
            className="w-4 h-4 rounded accent-violet-600"
          />
          <div>
            <p className="text-sm font-medium text-gray-800">Показать архив</p>
            <p className="text-[11px] text-gray-400">Включая технические записи и бывших сотрудников</p>
          </div>
        </label>

        <button
          onClick={onClose}
          className="w-full bg-violet-600 text-white font-medium py-3 rounded-2xl hover:bg-violet-700 transition-colors"
        >
          Применить
        </button>
      </div>
    </div>
  );
}

// ─── Responsibility Audit Types ───────────────────────────────────────────────

interface ResponsibilityCandidate {
  employee_id: string;
  full_name: string;
  employee_type: string | null;
  lessons_taught: number;
  attendance_count: number;
  coverage_pct: number;
}

interface UnitResponsibility {
  educational_unit_id: string;
  crm_group_id: string | null;
  name: string;
  educational_unit_type: string;
  department: string | null;
  linked_employees_count: number;
  primary_responsible_employee: string | null;
  primary_responsible_employee_id: string | null;
  responsibility_confidence: string;
  needs_review: boolean;
  primary_lessons_count: number;
  primary_coverage_pct: number;
  total_group_lessons: number;
  primary_attendance_count: number;
  all_candidates: ResponsibilityCandidate[];
}

interface EmployeeResponsibilitySummary {
  employee_id: string;
  full_name: string;
  employee_type: string | null;
  attribution_model: string | null;
  primary_units_count: number;
  secondary_units_count: number;
  primary_units: { id: string; name: string; type: string; confidence: string }[];
  secondary_units: { id: string; name: string; type: string }[];
}

interface ResponsibilityAudit {
  generated_at: string;
  branch_id: string;
  lookback_months: number;
  summary: {
    total_units: number;
    kindergarten: number;
    school: number;
    club: number;
    other: number;
    with_high_confidence: number;
    with_medium_confidence: number;
    with_low_confidence: number;
    needs_review: number;
    no_data: number;
  };
  top_20: {
    name: string;
    type: string;
    responsible: string | null;
    lessons: number;
    coverage: number;
    confidence: string;
    review: boolean;
  }[];
  kindergarten: UnitResponsibility[];
  school: UnitResponsibility[];
  club_top30: UnitResponsibility[];
  all_units: UnitResponsibility[];
  employee_summary: EmployeeResponsibilitySummary[];
}

// ─── Confidence badge helpers ──────────────────────────────────────────────────

function ConfidenceBadge({ confidence, needsReview }: { confidence: string; needsReview?: boolean }) {
  if (needsReview) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
        ⚠️ REVIEW
      </span>
    );
  }
  const map: Record<string, string> = {
    high:    "bg-emerald-100 text-emerald-700",
    medium:  "bg-amber-100 text-amber-700",
    low:     "bg-red-100 text-red-600",
    no_data: "bg-gray-100 text-gray-400",
  };
  const label: Record<string, string> = {
    high:    "🟢 HIGH",
    medium:  "🟡 MEDIUM",
    low:     "🔴 LOW",
    no_data: "— NO DATA",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[confidence] ?? "bg-gray-100 text-gray-400"}`}>
      {label[confidence] ?? confidence}
    </span>
  );
}

function EduTypePill({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    kindergarten_group:        { label: "Детский сад",   cls: "bg-pink-50 text-pink-700 border-pink-200" },
    school_class:              { label: "Школа",         cls: "bg-blue-50 text-blue-700 border-blue-200" },
    club_subscription_group:   { label: "Кружок",        cls: "bg-violet-50 text-violet-700 border-violet-200" },
    club_group:                { label: "Кружок",        cls: "bg-violet-50 text-violet-700 border-violet-200" },
    summer_camp:               { label: "Лагерь",        cls: "bg-orange-50 text-orange-700 border-orange-200" },
    service:                   { label: "Сервис",        cls: "bg-gray-50 text-gray-500 border-gray-200" },
    unknown:                   { label: "Неизв.",        cls: "bg-gray-50 text-gray-400 border-gray-200" },
  };
  const m = map[type] ?? { label: type, cls: "bg-gray-50 text-gray-400 border-gray-200" };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ─── Responsibility Unit Row ───────────────────────────────────────────────────

function UnitResponsibilityRow({ unit }: { unit: UnitResponsibility }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        className={`border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer transition-colors ${expanded ? "bg-violet-50/30" : ""}`}
        onClick={() => setExpanded(v => !v)}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <ChevronRight className={`w-3 h-3 text-gray-300 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
            <p className="text-xs font-medium text-gray-800 leading-tight">{unit.name}</p>
          </div>
        </td>
        <td className="px-3 py-2.5 hidden sm:table-cell">
          <EduTypePill type={unit.educational_unit_type} />
        </td>
        <td className="px-3 py-2.5">
          {unit.primary_responsible_employee ? (
            <p className="text-xs text-gray-700 truncate max-w-[160px]">{unit.primary_responsible_employee}</p>
          ) : (
            <p className="text-xs text-gray-300 italic">не определён</p>
          )}
        </td>
        <td className="px-3 py-2.5 text-right hidden sm:table-cell">
          <span className="text-xs text-gray-500">{unit.primary_lessons_count > 0 ? unit.primary_lessons_count : "—"}</span>
        </td>
        <td className="px-3 py-2.5 text-right hidden md:table-cell">
          <span className="text-xs text-gray-500">{unit.primary_coverage_pct > 0 ? `${unit.primary_coverage_pct}%` : "—"}</span>
        </td>
        <td className="px-3 py-2.5">
          <ConfidenceBadge confidence={unit.responsibility_confidence} needsReview={unit.needs_review} />
        </td>
      </tr>
      {expanded && unit.all_candidates.length > 0 && (
        <tr className="bg-violet-50/20 border-b border-violet-100/50">
          <td colSpan={6} className="px-8 py-2.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Все кандидаты ({unit.all_candidates.length})
            </p>
            <div className="space-y-1">
              {unit.all_candidates.map((c, i) => (
                <div key={c.employee_id} className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold w-4 ${i === 0 ? "text-violet-500" : "text-gray-300"}`}>
                    #{i + 1}
                  </span>
                  <span className="text-xs text-gray-700 flex-1">{c.full_name}</span>
                  <span className="text-[10px] text-gray-500">{c.lessons_taught} ур.</span>
                  <span className="text-[10px] font-medium text-gray-600">{c.coverage_pct}%</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Unit Table ───────────────────────────────────────────────────────────────

function UnitTable({ units, title }: { units: UnitResponsibility[]; title?: string }) {
  if (units.length === 0) {
    return <p className="text-xs text-gray-400 italic py-4">Нет данных</p>;
  }
  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</p>}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-50 bg-gray-50/50">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Группа</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Тип</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Ответственный</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Уроков</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden md:table-cell">Охват</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Уверенность</th>
            </tr>
          </thead>
          <tbody>
            {units.map(u => <UnitResponsibilityRow key={u.educational_unit_id} unit={u} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Responsibility Tab ────────────────────────────────────────────────────────

type ResponsibilitySection = "all" | "kindergarten" | "school" | "club" | "employees";

function ResponsibilityTab() {
  const [section, setSection] = useState<ResponsibilitySection>("all");
  const [empSearch, setEmpSearch] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery<ResponsibilityAudit>({
    queryKey: ["responsibility-audit"],
    queryFn: () => fetch("/api/educational-units/responsibility-audit").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || isFetching) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
        <span className="ml-3 text-sm text-gray-400">Вычисляем ответственность...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mb-3" />
        <p className="text-sm font-medium text-gray-700 mb-1">Ошибка загрузки</p>
        <button onClick={() => refetch()} className="mt-2 text-xs text-violet-600 hover:underline">Повторить</button>
      </div>
    );
  }

  const s = data.summary;

  const SECTIONS: { key: ResponsibilitySection; label: string; count: number }[] = [
    { key: "all",          label: "Все",          count: s.total_units },
    { key: "kindergarten", label: "Детский сад",  count: s.kindergarten },
    { key: "school",       label: "Школа",        count: s.school },
    { key: "club",         label: "Кружки",       count: s.club },
    { key: "employees",    label: "Сотрудники",   count: data.employee_summary.length },
  ];

  const filteredEmployees = empSearch
    ? data.employee_summary.filter(e => e.full_name.toLowerCase().includes(empSearch.toLowerCase()))
    : data.employee_summary;

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-8 space-y-6">
      {/* Summary header */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            Итог · {s.total_units} единиц · данные за {data.lookback_months} мес.
          </p>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 disabled:opacity-40"
          >
            <Zap className="w-3.5 h-3.5" />
            Обновить
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
          {[
            { label: "🟢 HIGH",     value: s.with_high_confidence,   cls: "bg-emerald-50 border-emerald-100 text-emerald-700" },
            { label: "🟡 MEDIUM",   value: s.with_medium_confidence, cls: "bg-amber-50 border-amber-100 text-amber-700" },
            { label: "🔴 LOW",      value: s.with_low_confidence,    cls: "bg-red-50 border-red-100 text-red-600" },
            { label: "⚠️ REVIEW",   value: s.needs_review,           cls: "bg-orange-50 border-orange-100 text-orange-700" },
            { label: "— NO DATA",   value: s.no_data,                cls: "bg-gray-50 border-gray-100 text-gray-500" },
          ].map(({ label, value, cls }) => (
            <div key={label} className={`rounded-xl border px-3 py-2.5 ${cls}`}>
              <p className="text-[11px] font-semibold">{label}</p>
              <p className="text-xl font-bold mt-0.5">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap">
        {SECTIONS.map(sec => (
          <button
            key={sec.key}
            onClick={() => setSection(sec.key)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl border transition-colors ${
              section === sec.key
                ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            {sec.label}
            <span className={`text-[10px] font-bold px-1 rounded-full ${section === sec.key ? "bg-violet-500 text-white" : "bg-gray-100 text-gray-400"}`}>
              {sec.count}
            </span>
          </button>
        ))}
      </div>

      {/* All units */}
      {section === "all" && (
        <div className="space-y-6">
          {/* Top 20 */}
          {data.top_20.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Топ-20 по вовлечённости
              </p>
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-50 bg-gray-50/50">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Группа</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Тип</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Ответственный</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Уроков</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden md:table-cell">Охват</th>
                      <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Уверенность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_20.map(u => (
                      <tr key={u.name + u.type} className="border-b border-gray-50 hover:bg-gray-50/40 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="text-xs font-medium text-gray-800">{u.name}</p>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell"><EduTypePill type={u.type} /></td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs text-gray-700 truncate max-w-[160px]">{u.responsible ?? "—"}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                          <span className="text-xs text-gray-500">{u.lessons}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right hidden md:table-cell">
                          <span className="text-xs text-gray-500">{u.coverage}%</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <ConfidenceBadge confidence={u.confidence} needsReview={u.review} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <UnitTable units={data.all_units} title={`Все единицы (${data.all_units.length})`} />
        </div>
      )}

      {/* Kindergarten */}
      {section === "kindergarten" && (
        <UnitTable units={data.kindergarten} title={`Детский сад (${data.kindergarten.length} групп)`} />
      )}

      {/* School */}
      {section === "school" && (
        <UnitTable units={data.school} title={`Школа (${data.school.length} классов)`} />
      )}

      {/* Club */}
      {section === "club" && (
        <div className="space-y-4">
          <UnitTable units={data.club_top30} title={`Кружки — топ-30 по урокам`} />
          {data.all_units.filter(u => u.educational_unit_type.startsWith("club")).length > 30 && (
            <p className="text-xs text-gray-400 italic">Показаны 30 из {data.all_units.filter(u => u.educational_unit_type.startsWith("club")).length}</p>
          )}
        </div>
      )}

      {/* Employees */}
      {section === "employees" && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
            <input
              value={empSearch}
              onChange={e => setEmpSearch(e.target.value)}
              placeholder="Поиск сотрудника..."
              className="pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-200 w-full sm:w-64"
            />
          </div>
          <div className="space-y-2">
            {filteredEmployees.slice(0, 80).map(emp => (
              <div key={emp.employee_id} className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.04)] px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{emp.full_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {emp.employee_type && (
                        <span className="text-[10px] text-gray-400">{emp.employee_type}</span>
                      )}
                      {emp.attribution_model && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100">
                          {emp.attribution_model}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {emp.primary_units_count > 0 && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                        {emp.primary_units_count} primary
                      </span>
                    )}
                    {emp.secondary_units_count > 0 && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {emp.secondary_units_count} secondary
                      </span>
                    )}
                  </div>
                </div>
                {emp.primary_units.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {emp.primary_units.map(u => (
                      <div key={u.id} className="flex items-center gap-1">
                        <EduTypePill type={u.type} />
                        <span className="text-[11px] text-gray-700">{u.name}</span>
                        <ConfidenceBadge confidence={u.confidence} />
                      </div>
                    ))}
                  </div>
                )}
                {emp.secondary_units.length > 0 && (
                  <div className="mt-1.5">
                    <p className="text-[10px] text-gray-400 mb-1">+ вторичные:</p>
                    <div className="flex flex-wrap gap-1">
                      {emp.secondary_units.slice(0, 5).map(u => (
                        <span key={u.id} className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-md">
                          {u.name}
                        </span>
                      ))}
                      {emp.secondary_units.length > 5 && (
                        <span className="text-[10px] text-gray-400 px-2 py-0.5">+{emp.secondary_units.length - 5}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {filteredEmployees.length > 80 && (
              <p className="text-xs text-gray-400 text-center py-2">Показано 80 из {filteredEmployees.length}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function EmployeesPage() {
  const months = useMemo(() => monthOptions(), []);
  const [month, setMonth] = useState(months[0].val);
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("active");
  const [employmentType, setEmploymentType] = useState("");
  const [search, setSearch] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [populateResult, setPopulateResult] = useState<PopulateResult | null>(null);
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [activeTab, setActiveTab] = useState<"staff" | "responsibility">("staff");
  const qc = useQueryClient();

  const populateMutation = useMutation({
    mutationFn: () =>
      fetch("/api/employees/populate-from-crm-teachers", { method: "POST" }).then((r) => r.json()),
    onSuccess: (data: PopulateResult) => {
      setPopulateResult(data);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees-stats"] });
    },
  });

  const classifyMutation = useMutation({
    mutationFn: () =>
      fetch("/api/employees/classify", { method: "POST" }).then((r) => r.json()),
    onSuccess: (data: ClassifyResult) => {
      setClassifyResult(data);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees-stats"] });
    },
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: () => fetch("/api/departments").then((r) => r.json()),
  });

  const params = new URLSearchParams({ month });
  if (department) params.set("department", department);
  if (status) params.set("status", status);
  if (employmentType) params.set("employment_type", employmentType);
  if (search) params.set("search", search);
  if (showExcluded) params.set("show_excluded", "true");

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["employees", month, department, status, employmentType, search, showExcluded],
    queryFn: () => fetch(`/api/employees?${params}`).then((r) => r.json()),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["employees-stats"],
    queryFn: () => fetch("/api/employees/stats").then((r) => r.json()),
  });

  const totalRevenue = employees.reduce((s, e) => s + (e.revenueRub ?? 0), 0);

  // Active filter count (for mobile button badge)
  const activeFilterCount = [department, employmentType].filter(Boolean).length
    + (status !== "active" ? 1 : 0)
    + (showExcluded ? 1 : 0);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${selectedId ? "hidden lg:flex" : "flex"}`}>
        {/* Header */}
        <div className="px-4 sm:px-6 lg:px-8 pt-5 sm:pt-6 pb-4 shrink-0">

          {/* Title + action buttons */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Персонал</h1>
              {/* Mobile summary line */}
              <p className="text-sm text-gray-400 mt-0.5 sm:hidden">
                {stats
                  ? `${stats.employees_visible ?? stats.employees_total} видимых · ${stats.needs_review ?? 0} требуют проверки`
                  : "загрузка..."}
              </p>
              <p className="hidden sm:block text-sm text-gray-400 mt-0.5">
                Реестр сотрудников · единый источник правды
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Classify button */}
              <button
                onClick={() => classifyMutation.mutate()}
                disabled={classifyMutation.isPending}
                title="Классифицировать всех сотрудников"
                className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium px-3 py-2.5 rounded-2xl hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                {classifyMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Zap className="w-4 h-4 text-violet-500" />}
                <span className="hidden sm:inline">
                  {classifyMutation.isPending ? "Классификация..." : "Классифицировать"}
                </span>
              </button>
              <button
                onClick={() => populateMutation.mutate()}
                disabled={populateMutation.isPending}
                title="Загрузить из AlphaCRM"
                className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium px-3 py-2.5 rounded-2xl hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                {populateMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline">
                  {populateMutation.isPending ? "Загрузка..." : "Из AlphaCRM"}
                </span>
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1.5 bg-violet-600 text-white text-sm font-medium px-3 py-2.5 rounded-2xl hover:bg-violet-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Добавить</span>
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mb-3">
            {([
              { key: "staff",          label: "Персонал",        icon: "👤" },
              { key: "responsibility", label: "Ответственность",  icon: "🏫" },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-xl border transition-colors ${
                  activeTab === t.key
                    ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                <span>{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Stats + filters — staff tab only */}
          {activeTab === "staff" && (<><div className="hidden sm:grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard
              label="Всего в реестре"
              value={String(stats?.employees_total ?? employees.length)}
              sub={`${stats?.employees_visible ?? "?"} видимых · ${stats?.employees_excluded_from_analytics ?? "?"} скрыто`}
              icon={<BookUser className="w-5 h-5 text-violet-500" />}
              accent="bg-violet-50"
            />
            <StatCard
              label="Классификация"
              value={stats ? `${stats.real_employees ?? 0}` : "—"}
              sub={stats ? `реальных · ${stats.needs_review ?? 0} на проверке` : "загрузка..."}
              icon={<Tag className="w-5 h-5 text-emerald-500" />}
              accent="bg-emerald-50"
            />
            <StatCard
              label="CRM coverage"
              value={stats ? `${stats.teacher_link_coverage_percent}%` : "—"}
              sub={stats ? `${stats.employees_with_teacher_crm_id} из ${stats.employees_total}` : "загрузка..."}
              icon={<UserCheck className="w-5 h-5 text-blue-500" />}
              accent="bg-blue-50"
            />
            <StatCard
              label="Выручка за месяц"
              value={totalRevenue > 0 ? fmtCompact(totalRevenue) : "—"}
              sub="по привязанным к CRM"
              icon={<TrendingUp className="w-5 h-5 text-amber-500" />}
              accent="bg-amber-50"
            />
          </div>

          {/* Mobile stat chips — horizontal scroll */}
          <div className="flex sm:hidden gap-2 overflow-x-auto pb-2 mb-3 scrollbar-none">
            {[
              { label: `${stats?.real_employees ?? "—"} реальных`,        color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
              { label: `${stats?.needs_review ?? "—"} проверить`,          color: "bg-amber-50 text-amber-700 border-amber-200" },
              { label: `${stats?.technical_records ?? "—"} техн.`,         color: "bg-red-50 text-red-600 border-red-200" },
              { label: `${stats?.former_employees ?? "—"} бывших`,         color: "bg-gray-50 text-gray-500 border-gray-200" },
              { label: `${stats?.teacher_link_coverage_percent ?? "—"}% CRM`, color: "bg-blue-50 text-blue-700 border-blue-200" },
            ].map(({ label, color }) => (
              <span key={label} className={`shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap ${color}`}>
                {label}
              </span>
            ))}
          </div>

          {/* Filters — desktop inline, mobile: search + filter button */}
          <div className="flex items-center gap-2">
            {/* Search — always visible */}
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-200 w-full sm:w-44"
              />
            </div>

            {/* Mobile: show excluded toggle + filter button */}
            <div className="flex items-center gap-2 sm:hidden">
              <button
                onClick={() => setShowExcluded((v) => !v)}
                title={showExcluded ? "Скрыть архив" : "Показать архив"}
                className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border transition-colors ${
                  showExcluded
                    ? "bg-violet-100 border-violet-300 text-violet-700"
                    : "bg-white border-gray-200 text-gray-500"
                }`}
              >
                {showExcluded ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setFilterDrawerOpen(true)}
                className={`relative flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border transition-colors ${
                  activeFilterCount > 0
                    ? "bg-violet-600 border-violet-600 text-white"
                    : "bg-white border-gray-200 text-gray-700"
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Фильтры
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Desktop filters */}
            <div className="hidden sm:flex items-center gap-2 flex-wrap">
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                {months.map((m) => (
                  <option key={m.val} value={m.val}>{m.label}</option>
                ))}
              </select>

              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                <option value="">Все подразделения</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>

              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                <option value="">Все статусы</option>
                <option value="active">Активные</option>
                <option value="paused">Пауза</option>
                <option value="dismissed">Уволенные</option>
              </select>

              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
                className="text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                <option value="">Все типы</option>
                {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>

              {/* Show excluded toggle */}
              <button
                onClick={() => setShowExcluded((v) => !v)}
                className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border transition-colors ${
                  showExcluded
                    ? "bg-violet-100 border-violet-300 text-violet-700"
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}
              >
                {showExcluded ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{showExcluded ? "Скрыть архив" : "Показать архив"}</span>
              </button>
            </div>
          </div>
          </>)}
        </div>

        {activeTab === "responsibility" ? (
          <ResponsibilityTab />
        ) : (
          <>
        {/* Result banners */}
        {classifyResult && (
          <ClassifyResultBanner result={classifyResult} onClose={() => setClassifyResult(null)} />
        )}
        {populateResult && (
          <PopulateResultBanner result={populateResult} onClose={() => setPopulateResult(null)} />
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-7 h-7 text-violet-400 animate-spin" />
            </div>
          ) : employees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-3xl bg-violet-50 flex items-center justify-center mb-4">
                <GraduationCap className="w-8 h-8 text-violet-300" />
              </div>
              <p className="text-base font-semibold text-gray-700 mb-1">
                {search || department || employmentType ? "Нет совпадений" : "Реестр пустой"}
              </p>
              <p className="text-sm text-gray-400 max-w-xs">
                {search || department || employmentType
                  ? "Попробуйте изменить фильтры"
                  : "Нажмите «Из AlphaCRM» чтобы загрузить всех преподавателей, или «Добавить» для ручного ввода"}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden">
              {/* Table header */}
              <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_auto_auto_auto_auto_auto_auto] gap-3 px-4 py-2.5 border-b border-gray-50 bg-gray-50/50">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Сотрудник</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Подразделение</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden lg:block">Должность</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">CRM</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Person</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Занятий</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Групп</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Посещ.</p>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Статус</p>
              </div>
              <div className="divide-y divide-gray-50/80">
                {employees.map((e) => (
                  <EmployeeRow
                    key={e.id}
                    e={e}
                    selected={selectedId === e.id}
                    onSelect={() => setSelectedId(selectedId === e.id ? null : e.id)}
                  />
                ))}
              </div>
              <div className="px-4 py-2.5 border-t border-gray-50 bg-gray-50/30">
                <p className="text-[11px] text-gray-400">
                  Показано {employees.length} сотрудников
                  {totalRevenue > 0 && ` · Выручка по фильтру: ${fmtCompact(totalRevenue)}`}
                  {!showExcluded && stats && stats.employees_excluded_from_analytics > 0 && (
                    <span className="ml-2 text-violet-500 cursor-pointer hover:underline" onClick={() => setShowExcluded(true)}>
                      +{stats.employees_excluded_from_analytics} скрыто (архив)
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {/* Right panel — Employee Card */}
      {selectedId && (
        <div className="flex flex-col w-full lg:w-[420px] xl:w-[460px] shrink-0 border-l border-gray-100 bg-[#F7F8FB] overflow-hidden">
          <EmployeeCard
            employeeId={selectedId}
            month={month}
            departments={departments}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

      {/* Add modal */}
      {addOpen && (
        <AddEmployeeModal
          departments={departments}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            qc.invalidateQueries({ queryKey: ["employees"] });
            qc.invalidateQueries({ queryKey: ["employees-stats"] });
          }}
        />
      )}

      {/* Mobile filter drawer */}
      <FilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        months={months}
        month={month}
        setMonth={setMonth}
        departments={departments}
        department={department}
        setDepartment={setDepartment}
        status={status}
        setStatus={setStatus}
        employmentType={employmentType}
        setEmploymentType={setEmploymentType}
        showExcluded={showExcluded}
        setShowExcluded={setShowExcluded}
        activeFilterCount={activeFilterCount}
      />
    </div>
  );
}

export default EmployeesPage;
