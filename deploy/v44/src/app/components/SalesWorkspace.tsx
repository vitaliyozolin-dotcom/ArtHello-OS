"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Lead = {
  id: string; firstClickAt: string; source: string; utmSource: string; utmMedium: string; utmCampaign: string; utmContent: string;
  campaignId: string; creativeId: string; offerId: string; formId: string; managerEntityId: string; stage: string; status: string;
  familyEntityId: string; childEntityId: string; contractId: string; serviceEntityId: string; rejectionReason: string; tags: string[]; dataQuality: string;
};

type Touchpoint = { id: string; leadId: string; touchpointType: string; occurredAt: string; channel: string; direction: string; summary: string; outcome: string; sourceRef: string };
type Lifecycle = { id: string; leadId: string; familyEntityId: string; childEntityId: string; contractId: string; serviceEntityId: string; accrualId: string; paymentOperationId: string; serviceStartDate: string; monthlyValueMinor: number; ltvMinor: number; lifetimeMonths: number; nextPaymentDate: string; nextPaymentMinor: number; churnRiskScore: number; churnRiskBand: string; loyaltyTier: string; repeatOffer: string; status: string; risk: { score: number; band: string; factors: string[]; disclaimer: string } };
type Accrual = { id: string; familyEntityId: string; childEntityId: string; contractId: string; serviceEntityId: string; period: string; amountMinor: number; dueDate: string; status: string; paymentOperationId: string; sourceType: string };
type Operation = { id: string; operationDate: string; amountMinor: number; category: string; contractId: string; counterpartyEntityId: string; bankOperationRef: string; sourceSystem: string; dataQuality: string };

type SalesData = {
  leads: Lead[];
  touchpoints: Touchpoint[];
  stageEvents: Array<{ id: number; leadId: string; fromStage: string; toStage: string; outcome: string; reason: string; actor: string; occurredAt: string }>;
  lifecycles: Lifecycle[];
  accruals: Accrual[];
  bonuses: Array<{ id: string; familyEntityId: string; eventType: string; points: number; reason: string; relatedContractId: string; occurredAt: string }>;
  operations: Operation[];
  entityNames: Record<string, string>;
  funnel: Array<{ stage: string; reached: number; conversionPercent: number }>;
  campaigns: Array<{ campaignId: string; leads: number; contracts: number; payments: number; revenueMinor: number }>;
  summary: { leads: number; activeLeads: number; paidLeads: number; leadToPaymentPercent: number; revenueMinor: number; nextPaymentsMinor: number; highRisk: number; families: number };
  sourcePolicy: { mode: string; note: string; financeLink: string };
  acceptanceChainLeadId: string;
};

type Tab = "funnel" | "leads" | "chain" | "clients" | "loyalty";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "funnel", label: "Воронка" },
  { id: "leads", label: "Лиды и контакты" },
  { id: "chain", label: "Сквозная цепочка" },
  { id: "clients", label: "Семьи и услуги" },
  { id: "loyalty", label: "LTV и лояльность" },
];

const roleCodes: Record<string, string> = {
  "Собственник": "OWNER", "Директор": "DIRECTOR", "Финансы": "FINANCE", "Продажи": "SALES", "Педагог": "TEACHER", "Представитель Виталия": "REPRESENTATIVE",
};
const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const rubles = (minor: number) => rub.format(minor / 100);
const displayDate = (value: string) => new Date(value.includes("T") ? value : `${value}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });

export function SalesWorkspace({ workspace, role, notify, onTasksChanged, onOpenFinance }: { workspace: "sales" | "clients"; role: string; notify: (message: string) => void; onTasksChanged: () => void; onOpenFinance: () => void }) {
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(() => workspace === "clients" ? "clients" : "funnel");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [evidence, setEvidence] = useState("");
  const [touchpointType, setTouchpointType] = useState("Звонок");
  const [touchpointSummary, setTouchpointSummary] = useState("");
  const [touchpointOutcome, setTouchpointOutcome] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/sales", { cache: "no-store" });
      const payload = await response.json() as SalesData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить продажи");
      setData(payload);
      setSelected((current) => current ? payload.leads.find((lead) => lead.id === current.id) ?? null : null);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить продажи");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const handle = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(handle); }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/sales-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roleCodes[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean; stage?: string };
      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");
      notify(payload.reused ? "Связанная задача уже существует" : payload.stage ? `Лид переведён: ${payload.stage}` : "Действие сохранено");
      setEvidence(""); setTouchpointSummary(""); setTouchpointOutcome("");
      await load(); onTasksChanged();
    } catch (actionError) {
      notify(actionError instanceof Error ? actionError.message : "Действие не выполнено");
    } finally { setBusy(""); }
  }

  const filteredLeads = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase("ru");
    return data.leads.filter((lead) => !normalized || [lead.id, lead.source, lead.stage, lead.campaignId, lead.managerEntityId, ...lead.tags].join(" ").toLocaleLowerCase("ru").includes(normalized));
  }, [data, query]);

  if (loading) return <section className="sales-loading">Загружаем сквозную воронку…</section>;
  if (error || !data) return <section className="sales-loading sales-error"><strong>{error || "Нет данных"}</strong><button onClick={() => { setLoading(true); void load(); }}>Повторить</button></section>;

  const chainLead = data.leads.find((lead) => lead.id === data.acceptanceChainLeadId)!;
  const chainLifecycle = data.lifecycles.find((row) => row.leadId === chainLead.id)!;
  const chainAccrual = data.accruals.find((row) => row.id === chainLifecycle.accrualId)!;
  const chainPayment = data.operations.find((row) => row.id === chainLifecycle.paymentOperationId)!;
  const maxFunnel = Math.max(...data.funnel.map((row) => row.reached), 1);

  return (
    <section className="page sales-workspace">
      <div className="sales-heading">
        <div><p className="eyebrow">{workspace === "clients" ? "Клиент 360° · единая карточка" : "Воронка · единый путь клиента"}</p><h1>{workspace === "clients" ? "Клиенты и семьи" : "Продажи"}</h1><p>{workspace === "clients" ? "Семья, ребёнок, договор, услуги, начисления, платежи, лояльность и обращения собраны в одной цепочке." : "Каждый договор и рубль сохраняет путь до первого клика — с менеджером, контактом и доказательством перехода."}</p></div>
        <div className="sales-heading-actions"><span><i />SYNTHETIC TEST</span><button onClick={() => { setTab("chain"); setSelected(chainLead); }}>Проверить цепочку T-014</button></div>
      </div>

      <div className="sales-source-boundary"><strong>ДАННЫЕ ДЛЯ ПРИЁМКИ</strong><span>{data.sourcePolicy.note}</span><em>Персональные данные не перенесены</em></div>

      <div className="sales-kpis">
        <button onClick={() => setTab("leads")}><span>Лиды в тесте</span><strong>{data.summary.leads}</strong><small>{data.summary.activeLeads} активных · {data.leads.filter((lead) => !lead.utmSource).length} без UTM</small></button>
        <button onClick={() => setTab("funnel")}><span>Конверсия в платёж</span><strong>{data.summary.leadToPaymentPercent}%</strong><small>{data.summary.paidLeads} из {data.summary.leads} дошли до оплаты</small></button>
        <button className="positive" onClick={() => setTab("chain")}><span>Выручка по цепочке</span><strong>{rubles(data.summary.revenueMinor)}</strong><small>синтетическая операция в финансах</small></button>
        <button className={data.summary.highRisk ? "warning" : ""} onClick={() => setTab("clients")}><span>Риск ухода</span><strong>{data.summary.highRisk}</strong><small>требует проверки менеджером</small></button>
      </div>

      <div className="sales-tabs" role="tablist">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "leads" ? <b>{data.leads.length}</b> : null}</button>)}</div>

      {tab === "funnel" ? <div className="sales-grid funnel-layout">
        <article className="sales-panel funnel-panel"><PanelHead eyebrow="Сквозная конверсия" title="От клика до платежа" aside="8 тестовых лидов" /><div className="funnel-steps">{data.funnel.map((row, index) => <button key={row.stage} onClick={() => { setTab("leads"); setQuery(row.stage); }}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{row.stage}</strong><i><b style={{ width: `${Math.max(8, row.reached / maxFunnel * 100)}%` }} /></i></div><em>{row.reached}</em><small>{index === 0 ? "100% вход" : `${row.conversionPercent}% с прошлого шага`}</small></button>)}</div></article>
        <article className="sales-panel campaign-panel"><PanelHead eyebrow="Атрибуция" title="Кампании → договоры → выручка" aside="first click" /><div className="campaign-list">{data.campaigns.map((campaign) => <article key={campaign.campaignId}><header><strong>{campaign.campaignId}</strong><span>{campaign.revenueMinor ? rubles(campaign.revenueMinor) : "—"}</span></header><div><span><small>Лиды</small><b>{campaign.leads}</b></span><span><small>Договоры</small><b>{campaign.contracts}</b></span><span><small>Платежи</small><b>{campaign.payments}</b></span></div></article>)}</div></article>
        <article className="sales-panel rejection-panel"><PanelHead eyebrow="Причины отказа" title="Закрытые обращения" aside="не потеряны" /><div>{data.leads.filter((lead) => lead.status === "Закрыт").map((lead) => <button key={lead.id} onClick={() => setSelected(lead)}><span><strong>{lead.id}</strong><small>{lead.source} · {lead.stage}</small></span><em>{lead.rejectionReason}</em></button>)}</div></article>
      </div> : null}

      {tab === "leads" ? <article className="sales-panel leads-panel"><PanelHead eyebrow="Операционный реестр" title="Лиды, менеджеры и контакты" aside={`${filteredLeads.length} записей`} /><div className="sales-toolbar"><input aria-label="Поиск лидов" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, источник, этап, кампания, тег…" /><button onClick={() => setQuery("")}>Сбросить</button></div><div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Лид</th><th>Первый клик</th><th>Атрибуция</th><th>Менеджер</th><th>Этап</th><th>Последний контакт</th><th>Статус</th></tr></thead><tbody>{filteredLeads.map((lead) => { const contacts = data.touchpoints.filter((row) => row.leadId === lead.id); const last = contacts.at(-1); return <tr key={lead.id} onClick={() => setSelected(lead)}><td><strong>{lead.id}</strong><small>{lead.tags.join(" · ")}</small></td><td><strong>{displayDate(lead.firstClickAt)}</strong><small>{lead.source}</small></td><td><strong>{lead.campaignId || "Без кампании"}</strong><small>{lead.utmSource ? `${lead.utmSource} / ${lead.utmMedium}` : "UTM отсутствует"}</small></td><td>{data.entityNames[lead.managerEntityId] ?? "Не назначен"}</td><td><span className="sales-stage-chip">{lead.stage}</span></td><td><strong>{last?.touchpointType ?? "Нет контакта"}</strong><small>{last?.outcome ?? "Создать задачу"}</small></td><td><span className={lead.status === "Активен" ? "sales-status active" : "sales-status closed"}>{lead.status}</span></td></tr>; })}</tbody></table></div></article> : null}

      {tab === "chain" ? <div className="sales-grid chain-layout">
        <article className="sales-panel chain-panel"><PanelHead eyebrow="Приёмочный маршрут" title="LEAD-T-014 · от клика до LTV" aside="CHAIN STATUS · PASS" /><div className="chain-ribbon">{[
          ["Первый клик", chainLead.source, chainLead.firstClickAt], ["Источник", `${chainLead.utmSource} / ${chainLead.utmMedium}`, chainLead.utmCampaign], ["Кампания", chainLead.campaignId, chainLead.creativeId], ["Оффер", chainLead.offerId, chainLead.formId], ["Заявка", chainLead.id, data.entityNames[chainLead.managerEntityId]], ["Консультация", "CONSULT-T-014", "04.04.2026"], ["Посещение", "VISIT-T-014", "Корпус 1"], ["Договор", chainLead.contractId, data.entityNames[chainLead.familyEntityId]], ["Ребёнок", data.entityNames[chainLead.childEntityId], chainLead.childEntityId], ["Услуга", data.entityNames[chainLead.serviceEntityId], chainLead.serviceEntityId], ["Начисление", chainAccrual.id, rubles(chainAccrual.amountMinor)], ["Платёж", chainPayment.id, rubles(chainPayment.amountMinor)], ["LTV", rubles(chainLifecycle.ltvMinor), `${chainLifecycle.lifetimeMonths} мес.`],
        ].map(([label, value, note], index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div>{index < 12 ? <i>→</i> : null}</article>)}</div><div className="chain-proof"><span>Финансовая граница</span><p>{data.sourcePolicy.financeLink}</p><button onClick={onOpenFinance}>Открыть операцию в финансах →</button></div></article>
        <article className="sales-panel chain-events"><PanelHead eyebrow="Доказательства" title="События и контакты" aside={`${data.touchpoints.filter((row) => row.leadId === chainLead.id).length} касаний`} /><div>{data.touchpoints.filter((row) => row.leadId === chainLead.id).map((row) => <article key={row.id}><time>{new Date(row.occurredAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span><strong>{row.touchpointType} · {row.channel}</strong><small>{row.summary}</small></span><em>{row.outcome}</em></article>)}</div></article>
      </div> : null}

      {tab === "clients" ? <div className="client-cards">{data.lifecycles.map((row) => { const lead = data.leads.find((item) => item.id === row.leadId)!; const accrual = data.accruals.find((item) => item.id === row.accrualId); return <article className="client-card" key={row.id}><header><div><span>{data.entityNames[row.familyEntityId]?.slice(-5) ?? "T"}</span><div><strong>{data.entityNames[row.familyEntityId]}</strong><small>{data.entityNames[row.childEntityId]} · {row.contractId}</small></div></div><em className={`risk-${row.churnRiskBand.toLocaleLowerCase("ru")}`}>Риск {row.churnRiskBand} · {row.churnRiskScore}</em></header><h2>{data.entityNames[row.serviceEntityId]}</h2><div className="client-money"><span><small>LTV</small><strong>{rubles(row.ltvMinor)}</strong></span><span><small>Срок жизни</small><strong>{row.lifetimeMonths} мес.</strong></span><span><small>Следующий платёж</small><strong>{rubles(row.nextPaymentMinor)}</strong><em>{displayDate(row.nextPaymentDate)}</em></span></div><div className="risk-explain"><strong>Почему такой сигнал</strong>{row.risk.factors.map((factor) => <span key={factor}>• {factor}</span>)}<small>{row.risk.disclaimer}</small></div><footer><span>{accrual?.id} · {accrual?.status}</span><button onClick={() => setSelected(lead)}>Открыть карточку →</button></footer></article>; })}</div> : null}

      {tab === "loyalty" ? <div className="sales-grid loyalty-layout"><article className="sales-panel loyalty-panel"><PanelHead eyebrow="Удержание" title="Лояльность и повторные продажи" aside={`${data.summary.families} семьи`} /><div>{data.lifecycles.map((row) => <article key={row.id}><header><span>{row.loyaltyTier}</span><strong>{data.entityNames[row.familyEntityId]}</strong><em>{rubles(row.ltvMinor)} LTV</em></header><p>{row.repeatOffer}</p><footer><span>Прогноз {displayDate(row.nextPaymentDate)} · {rubles(row.nextPaymentMinor)}</span><button onClick={() => setSelected(data.leads.find((lead) => lead.id === row.leadId) ?? null)}>Предложение</button></footer></article>)}</div></article><article className="sales-panel bonus-panel"><PanelHead eyebrow="Бонусный журнал" title="Начисления и списания" aside="append-only" /><div>{data.bonuses.map((bonus) => <article key={bonus.id}><span className={bonus.points > 0 ? "plus" : "minus"}>{bonus.points > 0 ? "+" : ""}{bonus.points}</span><div><strong>{bonus.reason}</strong><small>{data.entityNames[bonus.familyEntityId]} · {displayDate(bonus.occurredAt)}</small></div><em>{bonus.relatedContractId}</em></article>)}</div></article></div> : null}

      {selected ? <LeadDrawer lead={selected} data={data} busy={busy} evidence={evidence} setEvidence={setEvidence} touchpointType={touchpointType} setTouchpointType={setTouchpointType} touchpointSummary={touchpointSummary} setTouchpointSummary={setTouchpointSummary} touchpointOutcome={touchpointOutcome} setTouchpointOutcome={setTouchpointOutcome} close={() => setSelected(null)} action={action} /> : null}
    </section>
  );
}

function PanelHead({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {
  return <header className="sales-panel-head"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{aside}</span></header>;
}

function LeadDrawer({ lead, data, busy, evidence, setEvidence, touchpointType, setTouchpointType, touchpointSummary, setTouchpointSummary, touchpointOutcome, setTouchpointOutcome, close, action }: {
  lead: Lead; data: SalesData; busy: string; evidence: string; setEvidence: (value: string) => void; touchpointType: string; setTouchpointType: (value: string) => void; touchpointSummary: string; setTouchpointSummary: (value: string) => void; touchpointOutcome: string; setTouchpointOutcome: (value: string) => void; close: () => void; action: (body: Record<string, unknown>, key: string) => Promise<void>;
}) {
  const contacts = data.touchpoints.filter((row) => row.leadId === lead.id);
  const lifecycle = data.lifecycles.find((row) => row.leadId === lead.id);
  function advance(event: FormEvent) { event.preventDefault(); void action({ action: "advanceStage", leadId: lead.id, evidence }, `advance:${lead.id}`); }
  function contact(event: FormEvent) { event.preventDefault(); void action({ action: "logTouchpoint", leadId: lead.id, touchpointType, summary: touchpointSummary, outcome: touchpointOutcome }, `contact:${lead.id}`); }
  return <div className="sales-drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть карточку" /><aside className="sales-drawer"><header><div><span>{lead.status}</span><h2>{lead.id}</h2><p>{lead.source} · {lead.stage}</p></div><button onClick={close}>×</button></header><div className="sales-drawer-body"><section className="lead-origin"><p>Первый клик и атрибуция</p><dl><div><dt>Дата</dt><dd>{displayDate(lead.firstClickAt)}</dd></div><div><dt>Источник</dt><dd>{lead.source}</dd></div><div><dt>UTM</dt><dd>{lead.utmSource ? `${lead.utmSource} / ${lead.utmMedium} / ${lead.utmCampaign}` : "Не определён"}</dd></div><div><dt>Креатив</dt><dd>{lead.creativeId || "—"}</dd></div><div><dt>Оффер</dt><dd>{lead.offerId || "—"}</dd></div><div><dt>Форма</dt><dd>{lead.formId || "—"}</dd></div><div><dt>Менеджер</dt><dd>{data.entityNames[lead.managerEntityId] ?? "Не назначен"}</dd></div><div><dt>Теги</dt><dd>{lead.tags.join(", ")}</dd></div></dl></section><section className="lead-relations"><p>Связанные сущности</p><div>{[["Семья", lead.familyEntityId], ["Ребёнок", lead.childEntityId], ["Договор", lead.contractId], ["Услуга", lead.serviceEntityId]].map(([label, value]) => <article key={label}><small>{label}</small><strong>{(data.entityNames[value] ?? value) || "Появится на следующем этапе"}</strong></article>)}</div>{lifecycle ? <footer><span>LTV {rubles(lifecycle.ltvMinor)}</span><span>Риск {lifecycle.churnRiskBand} · {lifecycle.churnRiskScore}</span><span>{lifecycle.loyaltyTier}</span></footer> : null}</section><section className="lead-history"><p>Звонки, переписки, консультации и посещения</p>{contacts.length ? contacts.map((row) => <article key={row.id}><time>{displayDate(row.occurredAt)}</time><span><strong>{row.touchpointType} · {row.channel}</strong><small>{row.summary}</small></span><em>{row.outcome}</em></article>) : <small>Контактов пока нет.</small>}</section>{lead.status === "Активен" ? <><form className="lead-action-form" onSubmit={advance}><p>Перевести только на следующий этап</p><input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Подтверждение перехода: встреча, документ, результат" /><button disabled={busy === `advance:${lead.id}`}>Подтвердить переход</button></form><form className="lead-action-form contact-form" onSubmit={contact}><p>Зафиксировать контакт</p><select value={touchpointType} onChange={(event) => setTouchpointType(event.target.value)}><option>Звонок</option><option>Переписка</option><option>Консультация</option><option>Посещение</option></select><input value={touchpointSummary} onChange={(event) => setTouchpointSummary(event.target.value)} placeholder="Что обсуждали" /><input value={touchpointOutcome} onChange={(event) => setTouchpointOutcome(event.target.value)} placeholder="Итог" /><button disabled={busy === `contact:${lead.id}`}>Сохранить контакт</button></form><button className="followup-button" disabled={busy === `task:${lead.id}`} onClick={() => void action({ action: "createFollowupTask", leadId: lead.id }, `task:${lead.id}`)}>+ Задача на следующий шаг</button></> : <div className="closed-lead-note">Закрыт: {lead.rejectionReason}. История и доказательства сохранены.</div>}</div></aside></div>;
}
