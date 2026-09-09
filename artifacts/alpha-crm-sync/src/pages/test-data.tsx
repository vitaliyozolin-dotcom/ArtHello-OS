import { apiFetch } from "@workspace/api-client-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical, Trash2, Zap, CheckCircle2, Loader2,
  AlertTriangle, ClipboardList, Building2, Receipt, TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestDataStatus {
  hasTestData: boolean;
  operations: number;
  contractors: number;
  taxes: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 bg-[#F7F8FB] rounded-2xl px-4 py-3">
      <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-lg font-bold text-gray-900 leading-none mt-0.5">{value.toLocaleString("ru-RU")}</p>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TestDataPage() {
  const [seedResult, setSeedResult] = useState<{ operations: number; contractors: number; taxes: string } | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ operations: number; contractors: number; taxes: number } | null>(null);
  const qc = useQueryClient();

  const { data: status, isLoading: statusLoading, refetch } = useQuery<TestDataStatus>({
    queryKey: ["test-data-status"],
    queryFn: () => apiFetch("/api/test-data/status").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const seedMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/test-data/seed", { method: "POST" }).then((r) => r.json()),
    onSuccess: (data) => {
      setSeedResult(data.seeded);
      setDeleteResult(null);
      qc.invalidateQueries({ queryKey: ["test-data-status"] });
      qc.invalidateQueries({ queryKey: ["pnl-summary"] });
      qc.invalidateQueries({ queryKey: ["pnl-trend"] });
      qc.invalidateQueries({ queryKey: ["contractors"] });
      qc.invalidateQueries({ queryKey: ["taxes-summary"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/test-data", { method: "DELETE" }).then((r) => r.json()),
    onSuccess: (data) => {
      setDeleteResult(data.deleted);
      setSeedResult(null);
      qc.invalidateQueries({ queryKey: ["test-data-status"] });
      qc.invalidateQueries({ queryKey: ["pnl-summary"] });
      qc.invalidateQueries({ queryKey: ["pnl-trend"] });
      qc.invalidateQueries({ queryKey: ["contractors"] });
      qc.invalidateQueries({ queryKey: ["taxes-summary"] });
    },
  });

  const hasTestData = status?.hasTestData ?? false;
  const isBusy = seedMutation.isPending || deleteMutation.isPending;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[900px] mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Тестовые данные</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Загрузка реалистичных данных за 2025–2026 для демонстрации всех модулей
        </p>
      </div>

      {/* Status card */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6">
        <div className="flex items-center gap-3 mb-5">
          {statusLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          ) : hasTestData ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-semibold text-emerald-700">Тестовые данные загружены</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-gray-300" />
              <span className="text-sm font-semibold text-gray-500">Тестовых данных нет</span>
            </div>
          )}
        </div>

        {hasTestData && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <StatPill
              icon={<ClipboardList className="w-4 h-4 text-violet-500" />}
              label="Операций"
              value={status?.operations ?? 0}
            />
            <StatPill
              icon={<Building2 className="w-4 h-4 text-blue-500" />}
              label="Подрядчиков"
              value={status?.contractors ?? 0}
            />
            <StatPill
              icon={<Receipt className="w-4 h-4 text-amber-500" />}
              label="Налогов"
              value={status?.taxes ?? 0}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => seedMutation.mutate()}
            disabled={isBusy}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 text-white rounded-2xl font-semibold text-sm hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_2px_8px_rgba(124,58,237,0.25)]"
          >
            {seedMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Генерация данных…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Загрузить тестовые данные
              </>
            )}
          </button>

          {hasTestData && (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={isBusy}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-red-50 text-red-600 border border-red-200 rounded-2xl font-semibold text-sm hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Удаление…
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Удалить тестовые данные
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Seed result */}
      {seedResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-[22px] p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h2 className="text-sm font-semibold text-emerald-800">Данные успешно загружены</h2>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <div className="bg-white rounded-xl p-3">
              <p className="text-2xl font-bold text-emerald-700">{seedResult.operations}</p>
              <p className="text-xs text-gray-400 mt-0.5">операций</p>
            </div>
            <div className="bg-white rounded-xl p-3">
              <p className="text-2xl font-bold text-emerald-700">{seedResult.contractors}</p>
              <p className="text-xs text-gray-400 mt-0.5">подрядчиков</p>
            </div>
            <div className="bg-white rounded-xl p-3">
              <p className="text-2xl font-bold text-emerald-700">✓</p>
              <p className="text-xs text-gray-400 mt-0.5">налоги и резерв</p>
            </div>
          </div>
          <p className="text-xs text-emerald-700 mt-3">
            Период: январь 2025 — май 2026. Перейдите в ОПиУ, Подрядчики или Налоги для просмотра.
          </p>
        </div>
      )}

      {/* Delete result */}
      {deleteResult && (
        <div className="bg-gray-50 border border-gray-200 rounded-[22px] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Trash2 className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-700">Тестовые данные удалены</h2>
          </div>
          <p className="text-xs text-gray-400">
            Удалено: {deleteResult.operations} операций · {deleteResult.contractors} подрядчиков · {deleteResult.taxes} налогов
          </p>
        </div>
      )}

      {/* What's included */}
      <div className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Что включено в тестовый набор</h2>
        <div className="space-y-3 text-sm text-gray-600">
          {[
            { icon: <TrendingUp className="w-4 h-4 text-violet-500" />, title: "Операции (500+)", desc: "Доходы (оплаты родителей с авансами), расходы (аренда, ФОТ, маркетинг, питание, IT, коммуналка), налоги — за 17 месяцев" },
            { icon: <Building2 className="w-4 h-4 text-blue-500" />, title: "10 подрядчиков", desc: "ИП, ООО, самозанятые — с разными типами, налоговым статусом, риском и trust score. Начисления, оплаты, документы" },
            { icon: <Receipt className="w-4 h-4 text-amber-500" />, title: "Налоговые обязательства", desc: "УСН (квартально), НДФЛ, ПФР, ФСС — за каждый месяц периода. Налоговый резерв по месяцам" },
          ].map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-xl bg-[#F7F8FB] flex items-center justify-center shrink-0 mt-0.5">{item.icon}</div>
              <div>
                <p className="font-semibold text-gray-800">{item.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Все тестовые записи помечены флагом <code className="font-mono bg-amber-100 px-1 rounded">is_test_data=true</code> — они не затрагивают реальные данные и удаляются одной кнопкой.</span>
        </div>
      </div>
    </div>
  );
}
