import { ShieldAlert } from "lucide-react";

export default function TechnicalDashboard() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6" />
          <h1 className="text-lg font-semibold">Legacy CRM sync удалён</h1>
        </div>
        <p className="mt-3 text-sm leading-6">
          Универсальные runtime-действия больше недоступны. Read-only импорт
          выполняется только защищёнными sandbox-инструментами, а новые scoped
          jobs появятся лишь после отдельного решения и проверки доказательств.
        </p>
      </div>
    </div>
  );
}
