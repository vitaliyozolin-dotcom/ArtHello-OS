import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileSearch,
  History,
  MapPin,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type {
  PreviewLead,
  PreviewLeadDetail,
} from "@/features/front-office/preview-data";

type DrawerView = "qualification" | "history" | "draft";

export function LeadPreviewDrawer({
  lead,
  detail,
  onClose,
}: {
  lead: PreviewLead;
  detail: PreviewLeadDetail;
  onClose: () => void;
}) {
  const [view, setView] = useState<DrawerView>("qualification");

  const tabs: { key: DrawerView; label: string }[] = [
    { key: "qualification", label: "Квалификация" },
    { key: "history", label: "История касаний" },
    { key: "draft", label: "AI-черновик" },
  ];

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Закрыть карточку лида"
        onClick={onClose}
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-[#F7F8FB] shadow-2xl">
        <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-violet-600">
                  {lead.id}
                </span>
                <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                  {lead.stage}
                </span>
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  SYNTHETIC
                </span>
              </div>
              <h2 className="mt-2 truncate text-xl font-bold text-gray-950">
                {lead.need}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {lead.area}
                </span>
                <span className="inline-flex items-center gap-1">
                  <UserRound className="h-3 w-3" />
                  {lead.owner}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3 w-3" />
                  {lead.due}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="inline-flex min-w-max gap-1 rounded-xl bg-gray-100 p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setView(tab.key)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    view === tab.key
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {view === "qualification" && (
            <div className="space-y-4">
              <section className="grid gap-3 sm:grid-cols-2">
                <InfoCard label="Источник" value={detail.source} />
                <InfoCard label="Кампания" value={detail.campaign} />
                <InfoCard label="Возраст" value={detail.age} />
                <InfoCard
                  label="Предпочтительное время"
                  value={detail.preferredTime}
                />
              </section>

              <section className="rounded-2xl border border-black/[0.06] bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Цель семьи
                </p>
                <p className="mt-2 text-sm font-medium leading-5 text-gray-800">
                  {detail.goal}
                </p>
              </section>

              <section className="rounded-2xl border border-black/[0.06] bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      Полнота квалификации
                    </h3>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      Пропуски превращаются в вопросы, а не в догадки
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold text-gray-600">
                    {
                      detail.qualification.filter(
                        (item) => item.status === "known",
                      ).length
                    }
                    /{detail.qualification.length}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.qualification.map((item) => (
                    <div
                      key={item.label}
                      className={`rounded-xl border p-3 ${
                        item.status === "known"
                          ? "border-emerald-100 bg-emerald-50/60"
                          : "border-amber-200 bg-amber-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {item.status === "known" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <CircleAlert className="h-3.5 w-3.5 text-amber-600" />
                        )}
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          {item.label}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs font-medium text-gray-800">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-black/[0.06] bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <FileSearch className="h-4 w-4 text-violet-600" />
                  <h3 className="text-sm font-semibold text-gray-900">
                    Подходящие варианты
                  </h3>
                </div>
                {detail.candidates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800">
                    Подбор заблокирован: сначала нужны недостающие данные
                    квалификации.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detail.candidates.map((candidate) => (
                      <div
                        key={candidate.title}
                        className="rounded-xl border border-gray-100 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-900">
                            {candidate.title}
                          </p>
                          <EvidenceBadge status={candidate.status} />
                        </div>
                        <p className="mt-1.5 text-[11px] leading-4 text-gray-500">
                          {candidate.reason}
                        </p>
                        <p className="mt-2 text-[10px] font-medium text-violet-600">
                          {candidate.evidence}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {view === "history" && (
            <section className="rounded-2xl border border-black/[0.06] bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <History className="h-4 w-4 text-violet-600" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Неизменяемая история касаний
                  </h3>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    В preview события только отображаются
                  </p>
                </div>
              </div>
              <div className="space-y-0">
                {detail.touches.map((touch, index) => (
                  <div
                    key={`${touch.at}-${touch.summary}`}
                    className="flex gap-3"
                  >
                    <div className="flex flex-col items-center">
                      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-violet-500" />
                      {index < detail.touches.length - 1 && (
                        <div className="min-h-14 w-px flex-1 bg-violet-100" />
                      )}
                    </div>
                    <div className="pb-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold text-violet-600">
                          {touch.at}
                        </span>
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500">
                          {touch.channel}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs font-medium text-gray-800">
                        {touch.summary}
                      </p>
                      <p className="mt-1 text-[10px] text-gray-400">
                        {touch.actor}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                disabled
                className="mt-2 inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-medium text-gray-400 disabled:cursor-not-allowed"
              >
                Добавление события отключено
              </button>
            </section>
          )}

          {view === "draft" && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-violet-100 bg-violet-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-violet-950">
                        AI-черновик
                      </h3>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-violet-700 ring-1 ring-violet-200">
                        НЕ ОТПРАВЛЕН
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-violet-700">
                      Черновик использует только синтетические факты ниже.
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-violet-100 bg-white p-4 text-sm leading-6 text-gray-800">
                  {detail.draft.text}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-violet-300 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Отправка отключена
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-violet-200 bg-white px-3 text-xs font-medium text-violet-400 disabled:cursor-not-allowed"
                  >
                    Сохранение отключено
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-black/[0.06] bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-sm font-semibold text-gray-900">
                    Claim-level evidence
                  </h3>
                </div>
                <div className="space-y-2">
                  {detail.draft.claims.map((claim) => (
                    <div
                      key={claim.text}
                      className="rounded-xl border border-gray-100 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="max-w-md text-xs font-medium leading-5 text-gray-800">
                          {claim.text}
                        </p>
                        <EvidenceBadge status={claim.status} />
                      </div>
                      <p className="mt-2 text-[10px] font-medium text-violet-600">
                        {claim.evidence}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-4 text-amber-800">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                PARTIAL-факт допускается только как явное ограничение в
                черновике. Он не превращается в уверенное обещание.
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p className="mt-1.5 text-xs font-semibold text-gray-800">{value}</p>
    </div>
  );
}

function EvidenceBadge({ status }: { status: "VERIFIED" | "PARTIAL" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
        status === "VERIFIED"
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      }`}
    >
      {status}
    </span>
  );
}
