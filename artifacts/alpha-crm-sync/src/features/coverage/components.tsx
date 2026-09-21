import type { FC } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  OK: "bg-emerald-100 text-emerald-800 border-emerald-300",
  EMPTY: "bg-yellow-100 text-yellow-800 border-yellow-200",
  PARTIAL: "bg-amber-100 text-amber-800 border-amber-300",
  NOT_FOUND: "bg-gray-100 text-gray-600 border-gray-300",
  FORBIDDEN: "bg-red-100 text-red-700 border-red-300",
  NOT_EXPOSED: "bg-gray-100 text-gray-500 border-gray-200",
  ERROR: "bg-red-100 text-red-700 border-red-300",
  EMBEDDED: "bg-blue-100 text-blue-700 border-blue-200",
  UNKNOWN: "bg-gray-100 text-gray-500 border-gray-200",
};

export function coverageStatusColor(status: string) {
  return STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = coverageStatusColor(status);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border font-mono ${cls}`}
    >
      {status}
    </span>
  );
}

export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: FC<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
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

export function WarningBanner() {
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-[12px] p-3 flex gap-2.5">
      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-[12px] font-bold text-amber-800">
          Техническое предупреждение
        </p>
        <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
          Банковская интеграция уже содержит счета, балансы, выписки и
          транзакции, но большинство транзакций ещё{" "}
          <strong>не сопоставлены, не классифицированы и не сверены</strong> с
          данными AlphaCRM. Результаты AlphaCRM Coverage — это данные источника
          (source coverage), а не окончательная финансовая истина. Финальная
          сверка требует отдельного слоя сопоставления банк ↔ AlphaCRM.
        </p>
      </div>
    </div>
  );
}

export function NonProdBanner({ isProduction }: { isProduction: boolean }) {
  if (isProduction) return null;
  return (
    <div className="bg-red-50 border-2 border-red-400 rounded-[12px] p-3 flex gap-2.5">
      <ShieldAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
      <div>
        <p className="text-[13px] font-bold text-red-800">
          ⚠ Аудит запущен НЕ в production
        </p>
        <p className="text-[11px] text-red-700 mt-0.5 leading-relaxed">
          NODE_ENV ≠ production. Данные AlphaCRM реальные (продакшн API), но
          база данных —<strong> development БД</strong>. Результаты верификации
          отражают реальный AlphaCRM, но не production БД этого приложения.
        </p>
      </div>
    </div>
  );
}
