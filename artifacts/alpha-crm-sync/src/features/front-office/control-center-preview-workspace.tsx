import { useState, type ReactNode } from "react";
import {
  Activity,
  Ban,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileLock2,
  Gauge,
  ListChecks,
  LockKeyhole,
  Power,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UserRoundCog,
  Workflow,
} from "lucide-react";
import controlCenterData from "@/features/front-office/control-center-preview-data.json";

type ControlView =
  | "readiness"
  | "roles"
  | "sla"
  | "actions"
  | "safety"
  | "contract";

export function ControlCenterPreviewWorkspace() {
  const [view, setView] = useState<ControlView>("readiness");
  const configuredCount = controlCenterData.requiredConfiguration.filter(
    (item) => item.status === "CONFIGURED",
  ).length;
  const blockerCount = controlCenterData.requiredConfiguration.filter(
    (item) => item.blocking,
  ).length;
  const assignedRoles = controlCenterData.roles.filter(
    (role) => role.assigned,
  ).length;

  const views: {
    key: ControlView;
    label: string;
    icon: ReactNode;
  }[] = [
    {
      key: "readiness",
      label: "Готовность",
      icon: <ListChecks className="h-3.5 w-3.5" />,
    },
    {
      key: "roles",
      label: "Роли",
      icon: <UserRoundCog className="h-3.5 w-3.5" />,
    },
    {
      key: "sla",
      label: "SLA",
      icon: <Clock3 className="h-3.5 w-3.5" />,
    },
    {
      key: "actions",
      label: "Действия",
      icon: <FileLock2 className="h-3.5 w-3.5" />,
    },
    {
      key: "safety",
      label: "Автономность",
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
    },
    {
      key: "contract",
      label: "AI-контракт",
      icon: <Workflow className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <header className="border-b border-gray-100 bg-gradient-to-r from-slate-50 via-white to-violet-50 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Settings2 className="h-5 w-5 text-violet-600" />
              <h2 className="text-base font-bold text-gray-950">
                Контур управления Front Office
              </h2>
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700 ring-1 ring-violet-200">
                {controlCenterData.configurationVersion}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">
              Кто отвечает, какие сроки действуют, что разрешено AI и при каком
              событии система обязана остановиться.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ControlMetric
              label="Режим"
              value={controlCenterData.currentMode}
              tone="violet"
            />
            <ControlMetric
              label="Настроено"
              value={`${configuredCount}/${controlCenterData.requiredConfiguration.length}`}
              tone="emerald"
            />
            <ControlMetric
              label="Блокеры"
              value={`${blockerCount}`}
              tone="rose"
            />
            <ControlMetric
              label="Роли"
              value={`${assignedRoles}/${controlCenterData.roles.length}`}
              tone="amber"
            />
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-[11px] font-semibold text-amber-950">
              Конфигурация только для проверки
            </p>
            <p className="mt-0.5 text-[10px] leading-4 text-amber-800">
              Реальные каналы выключены. Роли, SLA, политики и действия нельзя
              сохранять или активировать.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <div className="inline-flex min-w-max gap-1 rounded-xl bg-white p-1 ring-1 ring-gray-200">
            {views.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium transition-colors ${
                  view === item.key
                    ? "bg-violet-600 text-white"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {view === "readiness" && <ReadinessPanel />}
      {view === "roles" && <RolesPanel />}
      {view === "sla" && <SlaPanel />}
      {view === "actions" && <ActionsPanel />}
      {view === "safety" && <SafetyPanel />}
      {view === "contract" && <ProcessContractPanel />}
    </section>
  );
}

function ReadinessPanel() {
  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Обязательная конфигурация
          </h3>
          <p className="mt-1 text-[11px] text-gray-500">
            Незаданное значение остаётся блокером, а не заполняется догадкой.
          </p>
        </div>
        <DisabledControl label="Сохранение отключено" />
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {controlCenterData.requiredConfiguration.map((item) => (
          <article
            key={item.key}
            className="rounded-2xl border border-black/[0.06] bg-white p-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[9px] font-bold uppercase tracking-wider text-violet-600">
                  {item.key}
                </p>
                <h4 className="mt-1 text-xs font-semibold text-gray-900">
                  {item.label}
                </h4>
              </div>
              <ConfigurationStatusBadge status={item.status} />
            </div>
            <p className="mt-2 text-[11px] leading-4 text-gray-600">
              {item.value}
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-[9px] font-medium">
              {item.blocking ? (
                <>
                  <CircleAlert className="h-3 w-3 text-rose-600" />
                  <span className="text-rose-700">
                    Блокирует реальные каналы
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-700">
                    Безопасная граница задана
                  </span>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function RolesPanel() {
  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <div className="flex items-start gap-3">
          <UserRoundCog className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
          <div>
            <p className="text-sm font-semibold text-rose-950">
              Ответственные пока не назначены
            </p>
            <p className="mt-1 text-[11px] leading-4 text-rose-800">
              Без владельца поддержки, дежурного и профильных эскалаций пилот на
              реальных каналах запрещён.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {controlCenterData.roles.map((role) => (
          <article
            key={role.key}
            className="rounded-2xl border border-black/[0.06] bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-violet-600">
                  {role.key}
                </p>
                <h3 className="mt-1.5 text-sm font-semibold text-gray-900">
                  {role.label}
                </h3>
              </div>
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700 ring-1 ring-rose-200">
                UNASSIGNED
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-gray-500">
              {role.purpose}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {role.requiredFor.map((scope) => (
                <span
                  key={scope}
                  className="rounded-lg bg-gray-100 px-2 py-1 text-[9px] font-semibold text-gray-600"
                >
                  {scope}
                </span>
              ))}
            </div>
            <button
              type="button"
              disabled
              className="mt-4 inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-medium text-gray-400 disabled:cursor-not-allowed"
            >
              Назначение роли отключено
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function SlaPanel() {
  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-950">
            SLA существует только как проект
          </p>
          <p className="mt-1 text-[11px] text-amber-800">
            Точные минуты и часы не подставлены: их должен утвердить владелец.
          </p>
        </div>
        <DisabledControl label="Активация SLA отключена" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {controlCenterData.sla.map((item) => (
          <article
            key={item.priority}
            className="rounded-2xl border border-black/[0.06] bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span
                  className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${
                    item.priority === "P0"
                      ? "bg-rose-100 text-rose-800"
                      : item.priority === "P1"
                        ? "bg-orange-100 text-orange-800"
                        : item.priority === "P2"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {item.priority}
                </span>
                <h3 className="mt-2 text-sm font-semibold text-gray-900">
                  {item.label}
                </h3>
              </div>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-200">
                PROPOSAL
              </span>
            </div>
            <p className="mt-2 min-h-10 text-[11px] leading-4 text-gray-500">
              {item.example}
            </p>
            <div className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3">
              <SlaValue label="Первый ответ" value={item.responseTarget} />
              <SlaValue label="Решение" value={item.resolutionTarget} />
              <SlaValue label="Эскалация" value={item.escalationRole} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ActionsPanel() {
  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div>
              <p className="text-sm font-semibold text-emerald-950">
                Утверждённых действий:{" "}
                {controlCenterData.approvedActions.length}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-emerald-800">
                Пустой allowlist — правильное безопасное значение до отдельного
                решения и теста rollback.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start gap-3">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <div>
              <p className="text-sm font-semibold text-rose-950">
                Внешние действия выключены
              </p>
              <p className="mt-1 text-[11px] leading-4 text-rose-800">
                Ни один элемент ниже не является разрешением на выполнение.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {controlCenterData.proposedActions.map((action) => (
          <article
            key={action.key}
            className="grid gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 lg:grid-cols-[1.35fr_0.6fr_0.75fr_auto] lg:items-center"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[9px] font-bold text-violet-600">
                  {action.key}
                </span>
                <ActionStatusBadge status={action.status} />
              </div>
              <p className="mt-1.5 text-xs font-semibold text-gray-900">
                {action.label}
              </p>
            </div>
            <ActionProperty label="Риск" value={action.risk} />
            <ActionProperty
              label="Эффект"
              value={
                action.externalEffect ? "Внешний · запрещён" : "Внутренний"
              }
            />
            <button
              type="button"
              disabled
              className="inline-flex h-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-[10px] font-medium text-gray-400 disabled:cursor-not-allowed"
            >
              Утверждение отключено
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function SafetyPanel() {
  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-violet-600" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Уровни автономности
              </h3>
              <p className="mt-0.5 text-[10px] text-gray-400">
                Повышение требует отдельного QA-решения
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {controlCenterData.autonomyLevels.map((level) => (
              <div
                key={level.key}
                className={`rounded-xl border p-3 ${
                  level.status === "CURRENT"
                    ? "border-violet-200 bg-violet-50"
                    : level.status === "PROHIBITED"
                      ? "border-rose-200 bg-rose-50"
                      : "border-gray-100 bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold text-gray-900">{level.key}</p>
                  <AutonomyStatusBadge status={level.status} />
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-gray-600">
                  {level.description}
                </p>
              </div>
            ))}
          </div>
          <DisabledControl label="Смена режима отключена" className="mt-4" />
        </section>

        <section className="rounded-2xl border border-black/[0.06] bg-white p-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Power className="h-4 w-4 text-rose-600" />
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  Автоматическое отключение
                </h3>
                <p className="mt-0.5 text-[10px] text-gray-400">
                  Все триггеры взведены в синтетической конфигурации
                </p>
              </div>
            </div>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[9px] font-bold text-rose-700 ring-1 ring-rose-200">
              ARMED · {controlCenterData.killSwitches.length}
            </span>
          </div>
          <div className="space-y-2">
            {controlCenterData.killSwitches.map((trigger) => (
              <div
                key={trigger.key}
                className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[9px] font-bold text-violet-600">
                      {trigger.key}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[8px] font-bold ${
                        trigger.severity === "CRITICAL"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {trigger.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-gray-800">
                    {trigger.label}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-rose-700">
                  <Activity className="h-3 w-3" />
                  {trigger.targetMode}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProcessContractPanel() {
  const contract = controlCenterData.processContract;

  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <ContractCard
          title="Вход"
          value={contract.input}
          icon={<FileLock2 className="h-4 w-4" />}
        />
        <ContractCard
          title="Ожидаемый результат"
          value={contract.expectedResult}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <ContractListCard
          title="Разрешено"
          values={contract.allowed}
          tone="emerald"
        />
        <ContractListCard
          title="Запрещено"
          values={contract.forbidden}
          tone="rose"
        />
        <ContractCard
          title="Ответственный человек"
          value={contract.responsibleHuman}
          icon={<UserRoundCog className="h-4 w-4" />}
          alert
        />
        <ContractCard
          title="Стоимость выполнения"
          value={contract.executionCost}
          icon={<Gauge className="h-4 w-4" />}
        />
        <ContractListCard
          title="Метрики пользы"
          values={contract.benefitMetrics}
          tone="violet"
        />
        <ContractCard
          title="Автоматическое отключение"
          value={contract.automaticShutdown}
          icon={<Power className="h-4 w-4" />}
        />
      </div>

      <section className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-violet-950">
                Отказ от AI
              </h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-violet-700 ring-1 ring-violet-200">
                ДОСТУПЕН
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <OptOutValue
                label="Как оформить"
                value={contract.optOut.method}
              />
              <OptOutValue
                label="Что остаётся"
                value={contract.optOut.withoutAi}
              />
              <OptOutValue
                label="Что прекращается"
                value={contract.optOut.stoppedProcessing}
              />
              <OptOutValue
                label="Повторное включение"
                value={contract.optOut.reenable}
              />
            </div>
            <p className="mt-3 text-[10px] leading-4 text-violet-800">
              Хранение после отказа: {contract.optOut.retention}
            </p>
          </div>
        </div>
      </section>

      <DisabledControl
        label="Изменение AI-контракта отключено"
        className="mt-4"
      />
    </div>
  );
}

function ControlMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "violet" | "emerald" | "rose" | "amber";
}) {
  const classes = {
    violet: "text-violet-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
  };

  return (
    <div className="min-w-24 rounded-xl border border-gray-100 bg-white px-3 py-2 text-center shadow-sm">
      <p className={`text-sm font-bold ${classes[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[9px] font-medium text-gray-400">{label}</p>
    </div>
  );
}

function ConfigurationStatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    CONFIGURED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    SAFE_DEFAULT: "bg-blue-50 text-blue-700 ring-blue-200",
    PROPOSAL: "bg-amber-50 text-amber-700 ring-amber-200",
    MISSING: "bg-rose-50 text-rose-700 ring-rose-200",
  };

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold ring-1 ${
        classes[status] ?? "bg-gray-100 text-gray-600 ring-gray-200"
      }`}
    >
      {status}
    </span>
  );
}

function ActionStatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    PREVIEW_ONLY: "bg-blue-50 text-blue-700 ring-blue-200",
    PROHIBITED: "bg-rose-50 text-rose-700 ring-rose-200",
    HUMAN_ONLY: "bg-amber-50 text-amber-700 ring-amber-200",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[8px] font-bold ring-1 ${
        classes[status] ?? "bg-gray-100 text-gray-600 ring-gray-200"
      }`}
    >
      {status}
    </span>
  );
}

function AutonomyStatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    CURRENT: "bg-violet-100 text-violet-800",
    AVAILABLE: "bg-emerald-100 text-emerald-800",
    LOCKED: "bg-gray-200 text-gray-600",
    PROHIBITED: "bg-rose-100 text-rose-800",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${
        classes[status] ?? "bg-gray-100 text-gray-600"
      }`}
    >
      {status}
    </span>
  );
}

function SlaValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[9px] font-medium text-gray-400">{label}</span>
      <span className="max-w-36 text-right text-[9px] font-semibold text-gray-700">
        {value}
      </span>
    </div>
  );
}

function ActionProperty({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-[10px] font-semibold text-gray-700">{value}</p>
    </div>
  );
}

function ContractCard({
  title,
  value,
  icon,
  alert = false,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  alert?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border p-4 ${
        alert ? "border-rose-200 bg-rose-50" : "border-black/[0.06] bg-white"
      }`}
    >
      <div
        className={`flex items-center gap-2 ${
          alert ? "text-rose-700" : "text-violet-600"
        }`}
      >
        {icon}
        <h3 className="text-xs font-semibold">{title}</h3>
      </div>
      <p
        className={`mt-2 text-[11px] leading-4 ${
          alert ? "text-rose-800" : "text-gray-600"
        }`}
      >
        {value}
      </p>
    </section>
  );
}

function ContractListCard({
  title,
  values,
  tone,
}: {
  title: string;
  values: string[];
  tone: "emerald" | "rose" | "violet";
}) {
  const classes = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    violet: "border-violet-200 bg-violet-50 text-violet-800",
  };

  return (
    <section className={`rounded-2xl border p-4 ${classes[tone]}`}>
      <h3 className="text-xs font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {values.map((value) => (
          <li
            key={value}
            className="flex items-start gap-2 text-[10px] leading-4"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
            {value}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OptOutValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-violet-100 bg-white/80 p-3">
      <p className="text-[9px] font-bold uppercase tracking-wider text-violet-500">
        {label}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-violet-900">{value}</p>
    </div>
  );
}

function DisabledControl({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 text-[10px] font-semibold text-gray-400 disabled:cursor-not-allowed ${className}`}
    >
      <LockKeyhole className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
