import { useState, type ReactNode } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Workflow,
} from "lucide-react";
import {
  PREVIEW_KNOWLEDGE_ARTICLES,
  PREVIEW_KNOWLEDGE_GAPS,
  type PreviewFactStatus,
  type PreviewKnowledgeArticle,
  type PreviewKnowledgeStatus,
} from "@/features/front-office/knowledge-preview-data";

type WorkspaceView = "articles" | "gaps" | "governance";
type ArticleFilter = "ALL" | PreviewKnowledgeStatus;

const STATUS_LABELS: Record<PreviewKnowledgeStatus, string> = {
  APPROVED: "Утверждена",
  IN_REVIEW: "На проверке",
  DRAFT: "Черновик",
  STALE: "Устарела",
};

export function KnowledgePreviewWorkspace() {
  const [view, setView] = useState<WorkspaceView>("articles");
  const [filter, setFilter] = useState<ArticleFilter>("ALL");
  const [selectedArticleId, setSelectedArticleId] =
    useState<string>("KB-DEMO-001");

  const filteredArticles =
    filter === "ALL"
      ? PREVIEW_KNOWLEDGE_ARTICLES
      : PREVIEW_KNOWLEDGE_ARTICLES.filter(
          (article) => article.status === filter,
        );
  const selectedArticle =
    filteredArticles.find((article) => article.id === selectedArticleId) ??
    filteredArticles[0] ??
    null;
  const approvedCount = PREVIEW_KNOWLEDGE_ARTICLES.filter(
    (article) => article.status === "APPROVED",
  ).length;
  const aiEligibleCount = PREVIEW_KNOWLEDGE_ARTICLES.filter(
    (article) => article.aiEligible,
  ).length;

  const views: { key: WorkspaceView; label: string }[] = [
    { key: "articles", label: "Статьи" },
    { key: "gaps", label: "Пробелы знаний" },
    { key: "governance", label: "Правила публикации" },
  ];

  const filters: { key: ArticleFilter; label: string }[] = [
    { key: "ALL", label: "Все" },
    { key: "APPROVED", label: "Утверждены" },
    { key: "IN_REVIEW", label: "На проверке" },
    { key: "DRAFT", label: "Черновики" },
    { key: "STALE", label: "Устарели" },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <header className="border-b border-gray-100 bg-gradient-to-r from-violet-50 via-white to-white px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BookOpenCheck className="h-5 w-5 text-violet-600" />
              <h2 className="text-base font-bold text-gray-950">
                Управляемая база знаний
              </h2>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                SYNTHETIC
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">
              Одна статья — это версия, источник, владелец, утверждающий, срок
              действия и понятная граница для AI.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <KnowledgeMetric label="Утверждено" value={`${approvedCount}`} />
            <KnowledgeMetric
              label="Разрешено AI"
              value={`${aiEligibleCount}`}
            />
            <KnowledgeMetric
              label="Пробелы"
              value={`${PREVIEW_KNOWLEDGE_GAPS.length}`}
              alert
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-violet-100 pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-max gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-gray-200">
            {views.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className={`rounded-lg px-3 py-2 text-[11px] font-medium transition-colors ${
                  view === item.key
                    ? "bg-violet-600 text-white"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-gray-200 px-3 text-xs font-semibold text-gray-500 disabled:cursor-not-allowed"
          >
            <FileText className="h-3.5 w-3.5" />
            Создание статьи отключено
          </button>
        </div>
      </header>

      {view === "articles" && (
        <div>
          <div className="flex gap-1 overflow-x-auto border-b border-gray-100 bg-gray-50 px-4 py-2.5">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
                  filter === item.key
                    ? "bg-white text-violet-700 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid min-h-[560px] xl:grid-cols-[0.8fr_1.25fr]">
            <div className="border-b border-gray-100 xl:border-b-0 xl:border-r">
              {filteredArticles.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400">
                  В этом фильтре нет синтетических статей.
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredArticles.map((article) => (
                    <button
                      key={article.id}
                      type="button"
                      onClick={() => setSelectedArticleId(article.id)}
                      className={`w-full px-4 py-4 text-left transition-colors ${
                        selectedArticle?.id === article.id
                          ? "bg-violet-50"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold text-violet-600">
                          {article.id}
                        </span>
                        <ArticleStatusBadge status={article.status} />
                        <FactStatusBadge status={article.confidence} />
                      </div>
                      <p className="mt-2 text-xs font-semibold text-gray-900">
                        {article.title}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-400">
                        <span>v{article.version}</span>
                        <span>{article.topic}</span>
                        <span>{article.reviewAt}</span>
                      </div>
                      <div
                        className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-semibold ${
                          article.aiEligible
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {article.aiEligible ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <LockKeyhole className="h-3 w-3" />
                        )}
                        {article.aiEligible
                          ? "Можно использовать в AI-черновике"
                          : article.aiBlockReason}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedArticle ? (
              <KnowledgeArticleDetail article={selectedArticle} />
            ) : (
              <div className="flex items-center justify-center p-8 text-xs text-gray-400">
                Выберите статью.
              </div>
            )}
          </div>
        </div>
      )}

      {view === "gaps" && <KnowledgeGapsPanel />}
      {view === "governance" && <KnowledgeGovernancePanel />}
    </section>
  );
}

function KnowledgeMetric({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-20 rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
      <p
        className={`text-lg font-bold ${alert ? "text-rose-600" : "text-gray-950"}`}
      >
        {value}
      </p>
      <p className="text-[9px] font-medium text-gray-400">{label}</p>
    </div>
  );
}

function KnowledgeArticleDetail({
  article,
}: {
  article: PreviewKnowledgeArticle;
}) {
  return (
    <article className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-violet-600">
                {article.id} · v{article.version}
              </span>
              <ArticleStatusBadge status={article.status} />
            </div>
            <h3 className="mt-2 text-lg font-bold text-gray-950">
              {article.title}
            </h3>
            <p className="mt-1 text-[11px] text-gray-400">
              {article.topic} · {article.branchScope}
            </p>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 text-[10px] font-semibold ${
              article.aiEligible
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {article.aiEligible
              ? "AI: разрешена только для черновика"
              : `AI заблокирован: ${article.aiBlockReason}`}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <MetadataCard
            icon={<UserRound className="h-3.5 w-3.5" />}
            label="Владелец"
            value={article.owner}
          />
          <MetadataCard
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            label="Утверждающий"
            value={article.approver}
          />
          <MetadataCard
            icon={<FileCheck2 className="h-3.5 w-3.5" />}
            label="Действует с"
            value={article.effectiveAt}
          />
          <MetadataCard
            icon={<Clock3 className="h-3.5 w-3.5" />}
            label="Следующий пересмотр"
            value={article.reviewAt}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <DetailSection title="Применимость">
          <DetailLabel label="Услуги" values={article.services} />
          <DetailLabel label="Исключения" values={article.exceptions} />
        </DetailSection>

        <DetailSection title="Граница действий">
          <DetailLabel
            label="Разрешено"
            values={article.allowedActions}
            tone="emerald"
          />
          <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 p-3">
            <p className="text-[9px] font-bold uppercase tracking-wider text-rose-500">
              Эскалация
            </p>
            <p className="mt-1 text-[11px] leading-4 text-rose-800">
              {article.escalation}
            </p>
          </div>
        </DetailSection>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <DetailSection title={`Источники · ${article.sources.length}`}>
          {article.sources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 p-3 text-[11px] leading-4 text-rose-800">
              Источник отсутствует. Статья не может быть опубликована или
              использована AI.
            </div>
          ) : (
            <div className="space-y-2">
              {article.sources.map((source) => (
                <div
                  key={source.id}
                  className="rounded-xl border border-gray-100 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-violet-600">
                      {source.id}
                    </span>
                    <FactStatusBadge status={source.status} />
                  </div>
                  <p className="mt-1.5 text-xs font-semibold text-gray-800">
                    {source.label}
                  </p>
                  <p className="mt-1 text-[10px] text-gray-400">
                    {source.kind} · v{source.version} · {source.effectiveAt}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection title={`Проверяемые факты · ${article.facts.length}`}>
          <div className="space-y-2">
            {article.facts.map((fact) => (
              <div
                key={fact.statement}
                className="rounded-xl border border-gray-100 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-medium leading-4 text-gray-800">
                    {fact.statement}
                  </p>
                  <FactStatusBadge status={fact.status} />
                </div>
                <p className="mt-2 text-[9px] font-semibold text-violet-600">
                  {fact.sourceId}
                </p>
              </div>
            ))}
          </div>
        </DetailSection>
      </div>

      <DetailSection title="Утверждённый шаблон ответа" className="mt-3">
        <p className="rounded-xl border border-violet-100 bg-violet-50 p-3 text-xs leading-5 text-violet-950">
          {article.responseTemplate}
        </p>
      </DetailSection>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled
          className="inline-flex h-9 items-center justify-center rounded-xl bg-gray-200 px-3 text-xs font-semibold text-gray-500 disabled:cursor-not-allowed"
        >
          Редактирование отключено
        </button>
        <button
          type="button"
          disabled
          className="inline-flex h-9 items-center justify-center rounded-xl border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-400 disabled:cursor-not-allowed"
        >
          Публикация отключена
        </button>
      </div>
    </article>
  );
}

function KnowledgeGapsPanel() {
  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-950">
              Повторяющийся вопрос превращается в задачу знаний
            </p>
            <p className="mt-1 text-[11px] leading-4 text-amber-800">
              Сотрудник не придумывает правило в переписке. Система фиксирует
              пробел, владельца, срок и влияние на автоматизацию.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {PREVIEW_KNOWLEDGE_GAPS.map((gap) => (
          <article
            key={gap.id}
            className="rounded-2xl border border-black/[0.06] bg-white p-4"
          >
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.7fr_1fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold text-violet-600">
                    {gap.id}
                  </span>
                  <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700">
                    {gap.reason}
                  </span>
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[9px] font-semibold text-gray-600">
                    {gap.occurrences} обращений
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-gray-900">
                  {gap.topic}
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-gray-500">
                  {gap.impact}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  Владелец и срок
                </p>
                <p className="mt-1.5 text-[11px] font-semibold text-gray-800">
                  {gap.owner}
                </p>
                <p className="mt-1 text-[10px] text-rose-600">{gap.due}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  Следующее действие
                </p>
                <p className="mt-1.5 text-[11px] leading-4 text-gray-700">
                  {gap.nextAction}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function KnowledgeGovernancePanel() {
  const gates = [
    {
      title: "Изоляция проекта",
      text: "Статья относится только к ARTHELLO и не переносится между контурами.",
    },
    {
      title: "Версия и источник",
      text: "У каждого существенного факта есть текущая версия и точная ссылка на источник.",
    },
    {
      title: "Два человека в контуре",
      text: "Владелец поддерживает содержание, утверждающий принимает ответственность за публикацию.",
    },
    {
      title: "Срок действия",
      text: "Дата вступления и дата пересмотра обязательны; просрочка блокирует AI.",
    },
    {
      title: "Действия и эскалация",
      text: "Статья явно определяет, что разрешено, что запрещено и кому передавать исключения.",
    },
    {
      title: "AI не публикует",
      text: "AI использует только APPROVED + VERIFIED и создаёт только внутренний черновик.",
    },
  ];

  return (
    <div className="bg-[#F8F9FC] p-4 sm:p-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {gates.map((gate, index) => (
          <article
            key={gate.title}
            className="rounded-2xl border border-black/[0.06] bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                {index === gates.length - 1 ? (
                  <LockKeyhole className="h-4 w-4" />
                ) : (
                  <Workflow className="h-4 w-4" />
                )}
              </div>
              <span className="text-[10px] font-bold text-gray-300">
                0{index + 1}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-gray-900">
              {gate.title}
            </h3>
            <p className="mt-1.5 text-[11px] leading-4 text-gray-500">
              {gate.text}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
        <div>
          <p className="text-sm font-semibold text-rose-950">
            Автоматическая публикация запрещена
          </p>
          <p className="mt-1 text-[11px] leading-4 text-rose-800">
            Даже единичный ответ сотрудника не становится политикой. Изменение
            проходит версию, проверку источника и явное утверждение человеком.
          </p>
        </div>
      </div>
    </div>
  );
}

function MetadataCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <div className="flex items-center gap-1.5 text-gray-400">
        {icon}
        <span className="text-[9px] font-bold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] font-semibold text-gray-800">{value}</p>
    </div>
  );
}

function DetailSection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-black/[0.06] bg-white p-4 ${className}`}
    >
      <h4 className="mb-3 text-xs font-semibold text-gray-900">{title}</h4>
      {children}
    </section>
  );
}

function DetailLabel({
  label,
  values,
  tone = "gray",
}: {
  label: string;
  values: string[];
  tone?: "gray" | "emerald";
}) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className={`rounded-lg px-2 py-1 text-[10px] font-medium ${
              tone === "emerald"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function ArticleStatusBadge({ status }: { status: PreviewKnowledgeStatus }) {
  const classes: Record<PreviewKnowledgeStatus, string> = {
    APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    IN_REVIEW: "bg-amber-50 text-amber-700 ring-amber-200",
    DRAFT: "bg-blue-50 text-blue-700 ring-blue-200",
    STALE: "bg-rose-50 text-rose-700 ring-rose-200",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${classes[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function FactStatusBadge({ status }: { status: PreviewFactStatus }) {
  const classes: Record<PreviewFactStatus, string> = {
    VERIFIED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    PARTIAL: "bg-amber-50 text-amber-700 ring-amber-200",
    STALE: "bg-rose-50 text-rose-700 ring-rose-200",
  };

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${classes[status]}`}
    >
      {status}
    </span>
  );
}
