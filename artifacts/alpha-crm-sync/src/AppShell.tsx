import { useState, lazy, Suspense } from 'react';
import { NavigationProvider } from '@/context/NavigationContext';
import { useAuth } from '@/context/AuthContext';
import LoginPage from '@/pages/login';
import { useQuery } from '@tanstack/react-query';
import { useAppMode } from '@/context/AppModeContext';
import { canViewFrontOfficePreview } from '@/features/front-office/preview-contract';
import {
  Zap, Banknote, TrendingUp, BarChart2, Users,
  UserCheck, FileText, Settings, Bell, CheckSquare,
  MonitorCog, ChevronRight, Menu, X, ClipboardList,
  ArrowLeftRight, Building2, Receipt, FlaskConical,
  Bot, Shield, Lock, Flame, Clock, ShieldAlert, LogOut,
  FileSignature, GraduationCap, CalendarDays, Plug,
} from 'lucide-react';

const PulsePageComponent          = lazy(() => import('@/pages/pulse').then((m) => ({ default: m.PulsePage })));
const BankingPageComponent        = lazy(() => import('@/pages/banking').then((m) => ({ default: m.BankingPage })));
const BankIntegrationsPageComponent = lazy(() => import('@/pages/banking').then((m) => ({ default: m.BankIntegrationsPage })));
const IdentityFamilies            = lazy(() => import('@/pages/identity-families').then((m) => ({ default: m.FamiliesTab })));
const LedgerPageComponent         = lazy(() => import('@/pages/ledger'));
const ReconciliationPageComponent = lazy(() => import('@/pages/reconciliation'));
const StaffPageComponent          = lazy(() => import('@/pages/staff'));
const PnlPageComponent            = lazy(() => import('@/pages/pnl'));
const ContractorsPageComponent    = lazy(() => import('@/pages/contractors'));
const TaxesPageComponent          = lazy(() => import('@/pages/taxes'));
const TestDataPageComponent       = lazy(() => import('@/pages/test-data'));
const CfoPageComponent            = lazy(() => import('@/pages/cfo'));
const TrustScorePageComponent     = lazy(() => import('@/pages/trust-score'));
const MonthClosingPageComponent   = lazy(() => import('@/pages/month-closing'));
const FinanceQaPageComponent      = lazy(() => import('@/pages/finance-qa'));
const ArticlesPageComponent       = lazy(() => import('@/pages/articles'));
const TechnicalDashboard          = lazy(() => import('@/pages/dashboard'));
const DocumentsPageComponent      = lazy(() => import('@/pages/documents'));
const ContractsPageComponent      = lazy(() => import('@/pages/contracts'));
const EducationalPageComponent    = lazy(() => import('@/pages/educational'));
const SchedulePageComponent       = lazy(() => import('@/pages/schedule'));
const CoveragePageComponent       = lazy(() => import('@/pages/coverage'));
const EmployeesPageComponent      = lazy(() => import('@/pages/employees').then((m) => ({ default: m.EmployeesPage })));
const FrontOfficePageComponent     = lazy(() => import('@/pages/front-office').then((m) => ({ default: m.FrontOfficePage })));

// ─── Nav definition ───────────────────────────────────────────────────────────

type OwnerSection =
  | 'pulse' | 'money' | 'pnl' | 'ledger' | 'reconciliation'
  | 'finance-matching' | 'finance-cashflow' | 'finance-payment-plan' | 'finance-payables'
  | 'contractors' | 'staff' | 'taxes' | 'families' | 'employees'
  | 'cfo' | 'trust-score' | 'month-closing' | 'finance-qa'
  | 'articles' | 'documents' | 'test-data' | 'settings'
  | 'front-office' | 'contracts' | 'educational' | 'schedule'
  | 'bank-integrations' | 'crm-coverage';

type NavItem = { key: OwnerSection; label: string; Icon: React.FC<{ className?: string }> };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: '',
    items: [
      { key: 'pulse', label: 'Пульс', Icon: Zap },
    ],
  },
  {
    label: 'Финансы',
    items: [
      { key: 'money',                label: 'Операции',      Icon: Banknote },
      { key: 'finance-matching',     label: 'Сопоставление', Icon: ArrowLeftRight },
      { key: 'finance-cashflow',     label: 'ДДС',           Icon: TrendingUp },
      { key: 'pnl',                  label: 'ОПиУ',          Icon: BarChart2 },
      { key: 'finance-payment-plan', label: 'План платежей', Icon: CalendarDays },
      { key: 'finance-payables',     label: 'Обязательства',  Icon: ClipboardList },
    ],
  },
  {
    label: 'Продажи и сервис',
    items: [
      { key: 'front-office', label: 'Front Office', Icon: ClipboardList },
    ],
  },
  {
    label: 'Клиенты',
    items: [
      { key: 'families',    label: 'Семьи',          Icon: Users },
      { key: 'contracts',   label: 'Договоры',       Icon: FileSignature },
      { key: 'educational', label: 'Образование',    Icon: GraduationCap },
      { key: 'schedule',    label: 'Расписание',     Icon: CalendarDays },
    ],
  },
  {
    label: 'Команда',
    items: [
      { key: 'employees',   label: 'Персонал',   Icon: Users },
      { key: 'staff',       label: 'Сотрудники', Icon: UserCheck },
      { key: 'contractors', label: 'Подрядчики', Icon: Building2 },
      { key: 'taxes',       label: 'Налоги',     Icon: Receipt },
    ],
  },
  {
    label: 'Аналитика',
    items: [
      { key: 'cfo',           label: 'AI Финдиректор',   Icon: Bot },
      { key: 'trust-score',   label: 'Trust Score',      Icon: Shield },
      { key: 'month-closing', label: 'Закрытие месяца',  Icon: Lock },
      { key: 'finance-qa',    label: 'Finance QA',       Icon: FileText },
    ],
  },
  {
    label: 'Система',
    items: [
      { key: 'bank-integrations', label: 'Интеграции · Банки', Icon: Plug },
      { key: 'crm-coverage',      label: 'AlphaCRM Coverage',  Icon: Flame },
      { key: 'articles',          label: 'Статьи ДДС/ОПиУ',   Icon: ClipboardList },
      { key: 'documents',         label: 'Документы',          Icon: FileText },
      { key: 'test-data',         label: 'Тест. данные',       Icon: FlaskConical },
      { key: 'settings',          label: 'Настройки',          Icon: Settings },
    ],
  },
];

// Flat list for lookups
const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

// ─── Banking Analytics Panel ──────────────────────────────────────────────────

interface BankAnalytics {
  bankBalance: number;
  avgBurnRate: number;
  avgIncome: number;
  runway: number | null;
  runwayMonths: number | null;
  safeBalance: number;
  isBelowSafe: boolean;
  safeBalanceGap: number;
}

function BankingAnalyticsPanel() {
  const { data, isLoading } = useQuery<BankAnalytics>({
    queryKey: ['banking-analytics'],
    queryFn: () => fetch('/api/banking/analytics').then((r) => r.json()),
    refetchInterval: 120000,
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n);

  if (isLoading || !data) return null;

  const runwayOk = (data.runwayMonths ?? 0) >= 2;
  const runwayWarn = (data.runwayMonths ?? 0) >= 1;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div className="bg-white rounded-[18px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Banknote className="w-3.5 h-3.5 text-blue-500" />
          <p className="text-[10px] text-gray-400 font-medium">Остаток в банке</p>
        </div>
        <p className={`text-lg font-bold ${data.isBelowSafe ? 'text-red-500' : 'text-blue-600'}`}>{fmt(data.bankBalance)}</p>
        {data.isBelowSafe && <p className="text-[10px] text-red-400 mt-0.5">Ниже безопасного уровня</p>}
      </div>
      <div className="bg-white rounded-[18px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Flame className="w-3.5 h-3.5 text-orange-500" />
          <p className="text-[10px] text-gray-400 font-medium">Burn Rate (3 мес. ср.)</p>
        </div>
        <p className="text-lg font-bold text-orange-600">{fmt(data.avgBurnRate)}<span className="text-xs font-normal text-gray-400">/мес</span></p>
      </div>
      <div className="bg-white rounded-[18px] border border-black/[0.06] shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-3.5 h-3.5 text-violet-500" />
          <p className="text-[10px] text-gray-400 font-medium">Runway</p>
        </div>
        <p className={`text-lg font-bold ${runwayOk ? 'text-emerald-600' : runwayWarn ? 'text-amber-600' : 'text-red-500'}`}>
          {data.runwayMonths != null ? `${data.runwayMonths} мес.` : '—'}
        </p>
        <p className="text-[10px] text-gray-400 mt-0.5">при текущих расходах</p>
      </div>
      <div className={`rounded-[18px] border shadow-[0_1px_4px_rgba(0,0,0,0.05)] p-4 ${data.isBelowSafe ? 'bg-red-50 border-red-200' : 'bg-white border-black/[0.06]'}`}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className={`w-3.5 h-3.5 ${data.isBelowSafe ? 'text-red-500' : 'text-emerald-500'}`} />
          <p className="text-[10px] text-gray-400 font-medium">Безопасный остаток</p>
        </div>
        <p className={`text-lg font-bold ${data.isBelowSafe ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(data.safeBalance)}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">2 месяца burn rate</p>
      </div>
    </div>
  );
}

// ─── Placeholder for sections not yet built ───────────────────────────────────

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-3xl bg-violet-50 flex items-center justify-center mb-5">
        <MonitorCog className="w-8 h-8 text-violet-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">{label}</h2>
      <p className="text-sm text-gray-500 max-w-xs">
        Этот раздел находится в разработке.
      </p>
    </div>
  );
}

// ─── User badge in sidebar ────────────────────────────────────────────────────

function UserBadge() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const roleLabel: Record<string, string> = { owner: 'Владелец', accountant: 'Бухгалтер', viewer: 'Просмотр' };
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg group">
      <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold text-violet-600">{user.name.slice(0, 1)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-gray-700 truncate">{user.name}</p>
        <p className="text-[10px] text-gray-400 truncate">{roleLabel[user.role] ?? user.role}</p>
      </div>
      <button onClick={logout} title="Выйти" className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Sidebar nav button ───────────────────────────────────────────────────────

function SideNavBtn({
  item, active, onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 group
        ${active
          ? 'bg-violet-600 text-white shadow-[0_2px_8px_rgba(124,58,237,0.25)]'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
        }`}
    >
      <item.Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'}`} />
      <span className="truncate">{item.label}</span>
      {active && <ChevronRight className="w-3 h-3 ml-auto opacity-60 shrink-0" />}
    </button>
  );
}

// ─── Sidebar component ────────────────────────────────────────────────────────

function Sidebar({
  section, onSection, onClose,
}: {
  section: OwnerSection;
  onSection: (s: OwnerSection) => void;
  onClose?: () => void;
}) {
  const { isTechnical, toggleMode } = useAppMode();
  const { user } = useAuth();

  const handleSection = (s: OwnerSection) => {
    onSection(s);
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-100">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-50">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-sm shrink-0">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <div className="min-w-0">
          <div className="font-bold text-gray-900 leading-tight text-sm">ArtHello</div>
          <div className="text-[9px] text-gray-400 uppercase tracking-widest">Owner Dashboard</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav — grouped, compact, scrollable */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-3">
        {NAV_GROUPS
          .filter((group) => group.label !== 'Продажи и сервис' || canViewFrontOfficePreview(user?.role))
          .map((group) => (
          <div key={group.label || '__top'}>
            {group.label && (
              <p className="px-2 mb-1 text-[9px] font-semibold text-gray-400 uppercase tracking-widest">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SideNavBtn
                  key={item.key}
                  item={item}
                  active={!isTechnical && section === item.key}
                  onClick={() => handleSection(item.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom controls */}
      <div className="px-2.5 py-3 border-t border-gray-50 space-y-0.5">
        <button className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
          <Bell className="w-4 h-4 text-gray-400 shrink-0" />
          Уведомления
        </button>
        <button className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
          <CheckSquare className="w-4 h-4 text-gray-400 shrink-0" />
          Задачи
        </button>
        <UserBadge />
        <button
          onClick={toggleMode}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150
            ${isTechnical
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
            }`}
        >
          <MonitorCog className={`w-4 h-4 shrink-0 ${isTechnical ? 'text-amber-600' : 'text-gray-400'}`} />
          <span className="flex-1 text-left truncate">Техн. режим</span>
          <div className={`w-7 h-4 rounded-full transition-colors relative shrink-0 ${isTechnical ? 'bg-amber-400' : 'bg-gray-200'}`}>
            <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-transform shadow-sm ${isTechnical ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Mobile bottom navigation ─────────────────────────────────────────────────

const FINANCE_SECTIONS: OwnerSection[] = [
  'money', 'finance-matching', 'finance-cashflow', 'pnl', 'finance-payment-plan', 'finance-payables',
];

const MOBILE_NAV: { key: OwnerSection; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { key: 'pulse',    label: 'Пульс',   Icon: Zap },
  { key: 'money',    label: 'Финансы', Icon: Banknote },
  { key: 'families', label: 'Семьи',   Icon: Users },
];

function MobileBottomNav({
  section, onSection, onMenu,
}: {
  section: OwnerSection;
  onSection: (s: OwnerSection) => void;
  onMenu: () => void;
}) {
  const { isTechnical } = useAppMode();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex items-center lg:hidden z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {MOBILE_NAV.map((item) => (
        <button
          key={item.key}
          onClick={() => onSection(item.key)}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors min-h-[56px]
            ${!isTechnical && (item.key === 'money' ? FINANCE_SECTIONS.includes(section) : section === item.key) ? 'text-violet-600' : 'text-gray-400'}`}
        >
          <item.Icon className="w-5 h-5" />
          <span className="text-[10px] font-medium">{item.label}</span>
        </button>
      ))}
      <button
        onClick={onMenu}
        className="flex-1 flex flex-col items-center gap-1 py-3 text-gray-400 min-h-[56px]"
      >
        <Menu className="w-5 h-5" />
        <span className="text-[10px] font-medium">Ещё</span>
      </button>
    </nav>
  );
}

// ─── Mobile drawer ────────────────────────────────────────────────────────────

function MobileDrawer({
  open, onClose, section, onSection,
}: {
  open: boolean;
  onClose: () => void;
  section: OwnerSection;
  onSection: (s: OwnerSection) => void;
}) {
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40 lg:hidden backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed left-0 top-0 bottom-0 w-72 z-50 lg:hidden shadow-2xl">
        <Sidebar section={section} onSection={onSection} onClose={onClose} />
      </div>
    </>
  );
}

// ─── Content renderer ─────────────────────────────────────────────────────────

function OwnerContent({ section }: { section: OwnerSection }) {
  switch (section) {
    case 'pulse':          return <PulsePageComponent />;
    case 'front-office':    return <FrontOfficePageComponent />;
    case 'ledger':         return <LedgerPageComponent />;
    case 'reconciliation': return <ReconciliationPageComponent />;
    case 'employees':      return <EmployeesPageComponent />;
    case 'staff':          return <StaffPageComponent />;
    case 'pnl':            return <PnlPageComponent />;
    case 'contractors':    return <ContractorsPageComponent />;
    case 'taxes':          return <TaxesPageComponent />;
    case 'test-data':      return <TestDataPageComponent />;
    case 'cfo':            return <CfoPageComponent />;
    case 'trust-score':   return <TrustScorePageComponent />;
    case 'month-closing': return <MonthClosingPageComponent />;
    case 'finance-qa':    return <FinanceQaPageComponent />;
    case 'articles':      return <ArticlesPageComponent />;
    case 'documents':     return <DocumentsPageComponent />;
    case 'contracts':     return <ContractsPageComponent />;
    case 'educational':   return <EducationalPageComponent />;
    case 'schedule':      return <SchedulePageComponent />;
    case 'money': return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto">
        <BankingPageComponent activeSection="transactions" />
      </div>
    );
    case 'finance-matching': return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto">
        <BankingPageComponent activeSection="matching" />
      </div>
    );
    case 'finance-cashflow': return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto">
        <BankingPageComponent activeSection="ledger-dds" />
      </div>
    );
    case 'finance-payment-plan': return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto">
        <BankingPageComponent activeSection="recurring" />
      </div>
    );
    case 'finance-payables': return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto">
        <BankingPageComponent activeSection="payables" />
      </div>
    );
    case 'bank-integrations': return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto">
        <BankIntegrationsPageComponent />
      </div>
    );
    case 'crm-coverage': return (
      <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1440px] mx-auto">
        <CoveragePageComponent />
      </div>
    );
    case 'families': return (
      <div className="px-6 lg:px-8 py-6 max-w-[1440px] mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Семьи</h1>
          <p className="text-sm text-gray-400 mt-0.5">Группировка учеников по родителям</p>
        </div>
        <IdentityFamilies />
      </div>
    );
    default: return <ComingSoon label={NAV.find((n) => n.key === section)?.label ?? section} />;
  }
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

export function AppShell() {
  const { isOwner, isTechnical } = useAppMode();
  const { user, loading } = useAuth();
  const [section, setSection] = useState<OwnerSection>('pulse');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Auth gate
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F8FB] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <div className="flex overflow-hidden" style={{ height: '100dvh', background: '#F7F8FB' }}>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[232px] shrink-0 flex-col h-full">
        <Sidebar section={section} onSection={setSection} />
      </aside>

      {/* Mobile drawer */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        section={section}
        onSection={(s) => { setSection(s); setDrawerOpen(false); }}
      />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto lg:pb-0" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <NavigationProvider onNavigate={(s) => setSection(s as OwnerSection)}>
            {isTechnical ? (
              <div className="px-4 py-4 max-w-[1440px] mx-auto">
                <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                  <MonitorCog className="w-4 h-4 shrink-0" />
                  <span><strong>Технический режим</strong> — служебные данные, интеграции, sync-логи.</span>
                </div>
                <TechnicalDashboard />
              </div>
            ) : (
              <OwnerContent section={section} />
            )}
          </NavigationProvider>
        </Suspense>
      </main>

      {/* Mobile bottom nav */}
      <MobileBottomNav
        section={section}
        onSection={setSection}
        onMenu={() => setDrawerOpen(true)}
      />
    </div>
  );
}
