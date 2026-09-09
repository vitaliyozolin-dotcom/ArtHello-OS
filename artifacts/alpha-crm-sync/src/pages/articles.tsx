import { apiFetch } from "@workspace/api-client-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, CheckCircle2, XCircle, ChevronRight, DollarSign, TrendingDown, ArrowLeftRight, Package, Landmark } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Article {
  id: string;
  code: string;
  name: string;
  groupName: string;
  subGroup: string | null;
  type: "income" | "expense" | "transfer" | "asset" | "liability";
  affectsDds: boolean;
  affectsPl: boolean;
  affectsEbitda: boolean;
  taxDeductible: boolean;
  isFixed: boolean;
  isOperational: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<Article["type"], { label: string; color: string; Icon: React.FC<{ className?: string }> }> = {
  income:    { label: "Доходы",     color: "emerald", Icon: DollarSign },
  expense:   { label: "Расходы",    color: "rose",    Icon: TrendingDown },
  transfer:  { label: "Переводы",   color: "blue",    Icon: ArrowLeftRight },
  asset:     { label: "Активы",     color: "violet",  Icon: Package },
  liability: { label: "Пассивы",    color: "amber",   Icon: Landmark },
};

// ─── Article Form Modal ───────────────────────────────────────────────────────

function ArticleForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<Article>;
  onSave: (data: Partial<Article>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Article>>({
    type: "expense",
    affectsDds: true,
    affectsPl: true,
    affectsEbitda: false,
    taxDeductible: false,
    isFixed: false,
    isOperational: true,
    ...initial,
  });

  const set = (key: keyof Article, val: unknown) => setForm((f) => ({ ...f, [key]: val }));

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-lg p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-5">
          {initial?.id ? "Редактировать статью" : "Новая статья"}
        </h2>

        <div className="space-y-4">
          {/* Code + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Код</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                placeholder="1.1"
                value={form.code ?? ""}
                onChange={(e) => set("code", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Тип</label>
              <select
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                value={form.type}
                onChange={(e) => set("type", e.target.value as Article["type"])}
              >
                {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Название</label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
              placeholder="Оплата за обучение"
              value={form.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>

          {/* Group + SubGroup */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Группа</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                placeholder="Доходы от деятельности"
                value={form.groupName ?? ""}
                onChange={(e) => set("groupName", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Подгруппа</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                placeholder="Учебные программы"
                value={form.subGroup ?? ""}
                onChange={(e) => set("subGroup", e.target.value)}
              />
            </div>
          </div>

          {/* Flags */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-2">Параметры</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["affectsDds",   "Влияет на ДДС"],
                ["affectsPl",    "Влияет на ОПиУ"],
                ["affectsEbitda","Влияет на EBITDA"],
                ["taxDeductible","Вычет по налогу"],
                ["isFixed",      "Постоянный расход"],
                ["isOperational","Операционный"],
              ] as [keyof Article, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    className="rounded accent-violet-600"
                    checked={Boolean(form[key])}
                    onChange={(e) => set(key, e.target.checked)}
                  />
                  <span className="text-[12px] text-gray-600">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={() => onSave(form)}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Flag Badge ───────────────────────────────────────────────────────────────

function Flag({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
      active ? "bg-violet-50 text-violet-600" : "bg-gray-50 text-gray-400"
    }`}>
      {label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ArticlesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Article | null>(null);
  const [filterType, setFilterType] = useState<Article["type"] | "all">("all");
  const [showInactive, setShowInactive] = useState(false);

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["articles"],
    queryFn: () => apiFetch("/api/articles").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: Partial<Article>) =>
      apiFetch("/api/articles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["articles"] }); setShowForm(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: Partial<Article> & { id: string }) =>
      apiFetch(`/api/articles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["articles"] }); setEditing(null); },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/articles/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["articles"] }),
  });

  const filtered = articles.filter((a) => {
    if (!showInactive && !a.isActive) return false;
    if (filterType !== "all" && a.type !== filterType) return false;
    return true;
  });

  // Group by type
  const grouped = Object.entries(TYPE_CONFIG).map(([type, cfg]) => ({
    type: type as Article["type"],
    cfg,
    items: filtered.filter((a) => a.type === type),
  })).filter((g) => g.items.length > 0 || filterType === g.type);

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1200px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Статьи ДДС / ОПиУ</h1>
          <p className="text-sm text-gray-400 mt-0.5">Справочник статей · план счетов</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Новая статья
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {([["all", "Все"] as const, ...Object.entries(TYPE_CONFIG).map(([k, v]) => [k, v.label] as const)]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilterType(key as typeof filterType)}
            className={`px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors ${
              filterType === key
                ? "bg-violet-600 text-white shadow-sm"
                : "bg-white border border-gray-200 text-gray-600 hover:border-violet-300"
            }`}
          >
            {label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 ml-auto text-[12px] text-gray-500 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-violet-600" />
          Показать неактивные
        </label>
      </div>

      {/* Stats row */}
      {!isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
            const count = articles.filter((a) => a.type === type && a.isActive).length;
            return (
              <div key={type} className="bg-white rounded-[14px] border border-black/[0.06] p-3 flex items-center gap-2">
                <cfg.Icon className={`w-4 h-4 text-${cfg.color}-500 shrink-0`} />
                <div>
                  <p className="text-xs text-gray-400">{cfg.label}</p>
                  <p className="text-sm font-bold text-gray-900">{count}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Article groups */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-white rounded-[22px] animate-pulse" />)}</div>
      ) : grouped.map(({ type, cfg, items }) => (
        <div key={type} className="bg-white rounded-[22px] border border-black/[0.06] shadow-[0_1px_6px_rgba(0,0,0,0.06)] overflow-hidden">
          {/* Group header */}
          <div className={`flex items-center gap-3 px-5 py-3.5 bg-${cfg.color}-50 border-b border-${cfg.color}-100`}>
            <cfg.Icon className={`w-4.5 h-4.5 text-${cfg.color}-600`} />
            <span className={`font-semibold text-sm text-${cfg.color}-800`}>{cfg.label}</span>
            <span className={`ml-auto text-xs font-medium text-${cfg.color}-600`}>{items.length} статей</span>
          </div>

          {items.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-6">Статей нет</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {items.map((article) => (
                <div
                  key={article.id}
                  className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-50/60 transition-colors ${!article.isActive ? "opacity-50" : ""}`}
                >
                  {/* Code */}
                  <span className="text-[11px] font-mono text-gray-400 w-8 shrink-0">{article.code}</span>

                  {/* Name + group */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{article.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">
                      {article.groupName}{article.subGroup ? ` · ${article.subGroup}` : ""}
                    </p>
                  </div>

                  {/* Flags */}
                  <div className="hidden sm:flex items-center gap-1 shrink-0">
                    <Flag active={article.affectsDds} label="ДДС" />
                    <Flag active={article.affectsPl} label="ОПиУ" />
                    <Flag active={article.affectsEbitda} label="EBITDA" />
                    <Flag active={article.taxDeductible} label="НО" />
                    <Flag active={article.isFixed} label="Пост." />
                  </div>

                  {/* Active badge */}
                  {!article.isActive && (
                    <span className="text-[10px] text-gray-400 font-medium shrink-0">неактивна</span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(article)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-violet-600 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {article.isActive ? (
                      <button
                        onClick={() => deactivateMutation.mutate(article.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => updateMutation.mutate({ id: article.id, isActive: true })}
                        className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-500 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {articles.length === 0 && !isLoading && (
        <div className="bg-white rounded-[22px] border border-black/[0.06] p-12 text-center">
          <p className="text-gray-400 text-sm">Статей нет — создайте первую или загрузите тестовые данные</p>
        </div>
      )}

      {/* Form modal */}
      {(showForm || editing) && (
        <ArticleForm
          initial={editing ?? undefined}
          onSave={(data) => {
            if (editing) updateMutation.mutate({ id: editing.id, ...data });
            else createMutation.mutate(data);
          }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
