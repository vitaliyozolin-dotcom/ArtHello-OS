"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import "./SalesWorkspace.css";

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
  ltvPlan: {
    families: Array<{ familyEntityId: string; actualLtvMinor: number; monthlyValueMinor: number; retentionProbability: number; baseNext12MonthsMinor: number; riskAdjustedNext12MonthsMinor: number; forecastLtvMinor: number }>;
    actualLtvMinor: number; averageActualLtvMinor: number; baseNext12MonthsMinor: number; riskAdjustedNext12MonthsMinor: number; forecastLtvMinor: number; method: string;
  };
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

export function SalesWorkspace({ workspace, role, notify, onTasksChanged, onOpenFinance, focusId }: { workspace: "sales" | "clients"; role: string; notify: (message: string) => void; onTasksChanged: () => void; onOpenFinance: () => void; focusId?: string }) {
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
  useEffect(() => { if (!focusId) return; const handle = window.setTimeout(() => { setTab("leads"); setQuery(focusId); }, 0); return () => window.clearTimeout(handle); }, [focusId]);

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
  if (!data.leads.length) return <section className="page sales-workspace">
    <div className="sales-heading"><div><p className="eyebrow">Воронка · единый путь клиента</p><h1>Продажи</h1><p>Лиды, контакты, этапы воронки и связанные платежи появятся после добавления данных.</p></div></div>
    <div className="manual-module-empty"><span>＋</span><h2>Лидов пока нет</h2><p>Подключите CRM или добавьте первую заявку вручную.</p></div>
  </section>;

  const chainLead = data.leads.find((lead) => lead.id === data.acceptanceChainLeadId) ?? data.leads[0];
  const chainLifecycle = data.lifecycles.find((row) => row.leadId === chainLead.id);
  const chainAccrual = chainLifecycle ? data.accruals.find((row) => row.id === chainLifecycle.accrualId) : undefined;
  const chainPayment = chainLifecycle ? data.operations.find((row) => row.id === chainLifecycle.paymentOperationId) : undefined;
  const chainSteps = chainLifecycle && chainAccrual && chainPayment ? [
    ["Первый клик", chainLead.source, chainLead.firstClickAt],
    ["Источник", [chainLead.utmSource, chainLead.utmMedium].filter(Boolean).join(" / ") || "Не указан", chainLead.utmCampaign],
    ["Кампания", chainLead.campaignId, chainLead.creativeId],
    ["Оффер", chainLead.offerId, chainLead.formId],
    ["Заявка", chainLead.id, data.entityNames[chainLead.managerEntityId]],
    ["Договор", chainLead.contractId, data.entityNames[chainLead.familyEntityId]],
    ["Ребёнок", data.entityNames[chainLead.childEntityId], chainLead.childEntityId],
    ["Услуга", data.entityNames[chainLead.serviceEntityId], chainLead.serviceEntityId],
    ["Начисление", chainAccrual.id, rubles(chainAccrual.amountMinor)],
    ["Платёж", chainPayment.id, rubles(chainPayment.amountMinor)],
    ["LTV", rubles(chainLifecycle.ltvMinor), `${chainLifecycle.lifetimeMonths} мес.`],
  ] : [];
  return (
    <section className="page sales-workspace">
      <div className="sales-heading">
        <div><p className="eyebrow">{workspace === "clients" ? "Клиент 360° · единая карточка" : "Воронка · единый путь клиента"}</p><h1>{workspace === "clients" ? "Клиенты и семьи" : "Продажи"}</h1><p>{workspace === "clients" ? "Семья, ребёнок, договор, услуги, начисления, платежи, лояльность и обращения собраны в одной цепочке." : "Каждый договор и рубль сохраняет путь до первого клика — с менеджером, контактом и доказательством перехода."}</p></div>
        <div className="sales-heading-actions"><span><i />Рабочие данные</span><button onClick={() => { setTab("chain"); setSelected(chainLead); }}>Открыть цепочку {chainLead.id}</button></div>
      </div>

      <div className="sales-source-boundary"><strong>ДАННЫЕ ПРОДАЖ</strong><span>{data.sourcePolicy.note}</span><em>Показываются только сохранённые записи</em></div>

      <div className="sales-kpis">
        <button onClick={() => setTab("leads")}><span>Лиды</span><strong>{data.summary.leads}</strong><small>{data.summary.activeLeads} активных · {data.leads.filter((lead) => !lead.utmSource).length} без UTM</small></button>
        <button onClick={() => setTab("funnel")}><span>Конверсия в платёж</span><strong>{data.summary.leadToPaymentPercent}%</strong><small>{data.summary.paidLeads} из {data.summary.leads} дошли до оплаты</small></button>
        <button className="positive" onClick={() => setTab("chain")}><span>Выручка по цепочке</span><strong>{rubles(data.summary.revenueMinor)}</strong><small>по связанным финансовым операциям</small></button>
        <button className={data.summary.highRisk ? "warning" : ""} onClick={() => setTab("clients")}><span>Риск ухода</span><strong>{data.summary.highRisk}</strong><small>требует проверки менеджером</small></button>
      </div>

      <div className="sales-tabs" role="tablist">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "leads" ? <b>{data.leads.length}</b> : null}</button>)}</div>

      {tab === "funnel" ? <div className="crm-view">
        <div className="crm-toolbar"><div><strong>Основная воронка</strong><span>Карточка открывается по клику; перенос между этапами подтверждается внутри карточки.</span></div><div><button onClick={() => setTab("leads")}>Реестр лидов</button><button onClick={() => setQuery("")}>Все менеджеры</button></div></div>
        <div className="crm-board" aria-label="Воронка продаж по этапам">{data.funnel.map((column, index) => {
          const cards = data.leads.filter((lead) => lead.stage === column.stage && lead.status !== "Закрыт");
          return <section className="crm-column" key={column.stage}><header><div><span>{String(index + 1).padStart(2, "0")}</span><strong>{column.stage}</strong></div><b>{cards.length}</b><small>{index === 0 ? "100% вход" : `${column.conversionPercent}% переход`}</small></header><div>{cards.map((lead) => {
            const lifecycle = data.lifecycles.find((row) => row.leadId === lead.id);
            const last = data.touchpoints.filter((row) => row.leadId === lead.id).at(-1);
            return <button className="crm-lead-card" key={lead.id} onClick={() => setSelected(lead)}><span className="crm-lead-id">{lead.id}<em>{lead.tags.at(0) ?? "новый"}</em></span><strong>{data.entityNames[lead.familyEntityId] ?? lead.source}</strong><small>{data.entityNames[lead.childEntityId] ?? `${lead.source} · ${lead.campaignId || "без кампании"}`}</small>{lifecycle ? <b>{rubles(lifecycle.monthlyValueMinor)} / мес.</b> : <b>{lead.source}</b>}<footer><span>{data.entityNames[lead.managerEntityId] ?? "Без менеджера"}</span><time>{last ? displayDate(last.occurredAt) : displayDate(lead.firstClickAt)}</time></footer></button>;
          })}{!cards.length ? <div className="crm-column-empty">Нет карточек на этапе</div> : null}</div></section>;
        })}</div>
        <div className="crm-lost"><strong>Закрытые и потерянные</strong>{data.leads.filter((lead) => lead.status === "Закрыт").map((lead) => <button key={lead.id} onClick={() => setSelected(lead)}><span>{lead.id} · {lead.source}</span><em>{lead.rejectionReason || "Причина не указана"}</em></button>)}</div>
      </div> : null}

      {tab === "leads" ? <article className="sales-panel leads-panel"><PanelHead eyebrow="Операционный реестр" title="Лиды, менеджеры и контакты" aside={`${filteredLeads.length} записей`} /><div className="sales-toolbar"><input aria-label="Поиск лидов" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, источник, этап, кампания, тег…" /><button onClick={() => setQuery("")}>Сбросить</button></div><div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Лид</th><th>Первый клик</th><th>Атрибуция</th><th>Менеджер</th><th>Этап</th><th>Последний контакт</th><th>Статус</th></tr></thead><tbody>{filteredLeads.map((lead) => { const contacts = data.touchpoints.filter((row) => row.leadId === lead.id); const last = contacts.at(-1); return <tr key={lead.id} onClick={() => setSelected(lead)}><td><strong>{lead.id}</strong><small>{lead.tags.join(" · ")}</small></td><td><strong>{displayDate(lead.firstClickAt)}</strong><small>{lead.source}</small></td><td><strong>{lead.campaignId || "Без кампании"}</strong><small>{lead.utmSource ? `${lead.utmSource} / ${lead.utmMedium}` : "UTM отсутствует"}</small></td><td>{data.entityNames[lead.managerEntityId] ?? "Не назначен"}</td><td><span className="sales-stage-chip">{lead.stage}</span></td><td><strong>{last?.touchpointType ?? "Нет контакта"}</strong><small>{last?.outcome ?? "Создать задачу"}</small></td><td><span className={lead.status === "Активен" ? "sales-status active" : "sales-status closed"}>{lead.status}</span></td></tr>; })}</tbody></table></div></article> : null}

      {tab === "chain" ? chainLifecycle && chainAccrual && chainPayment ? <div className="sales-grid chain-layout">
        <article className="sales-panel chain-panel"><PanelHead eyebrow="Сквозной маршрут" title={`${chainLead.id} · от клика до LTV`} aside="связи подтверждены" /><div className="chain-ribbon">{chainSteps.map(([label, value, note], index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{label}</small><strong>{value || "—"}</strong><em>{note || "—"}</em></div>{index < chainSteps.length - 1 ? <i>→</i> : null}</article>)}</div><div className="chain-proof"><span>Финансовая граница</span><p>{data.sourcePolicy.financeLink}</p><button onClick={onOpenFinance}>Открыть операцию в финансах →</button></div></article>
        <article className="sales-panel chain-events"><PanelHead eyebrow="Доказательства" title="События и контакты" aside={`${data.touchpoints.filter((row) => row.leadId === chainLead.id).length} касаний`} /><div>{data.touchpoints.filter((row) => row.leadId === chainLead.id).map((row) => <article key={row.id}><time>{new Date(row.occurredAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span><strong>{row.touchpointType} · {row.channel}</strong><small>{row.summary}</small></span><em>{row.outcome}</em></article>)}</div></article>
      </div> : <div className="manual-module-empty"><span>↗</span><h2>Сквозная цепочка ещё не собрана</h2><p>Для лида {chainLead.id} пока нет связанного договора, начисления или платежа. Раздел продолжает работать без фиктивных связей.</p></div> : null}

      {tab === "clients" ? <article className="sales-panel service-registry"><PanelHead eyebrow="Действующие отношения" title="Семьи и услуги" aside={`${data.lifecycles.length} семей`} /><div className="service-registry-note"><strong>Одна строка — одна семья и услуга</strong><span>Карточка показывает договор, обучение, начисление и риск. История связей открывается уже внутри семьи.</span></div><div className="service-table-wrap"><table><thead><tr><th>Семья и ребёнок</th><th>Услуга</th><th>Договор</th><th>Платёж в месяц</th><th>LTV факт</th><th>Следующий платёж</th><th>Риск</th><th /></tr></thead><tbody>{data.lifecycles.map((row) => { const lead = data.leads.find((item) => item.id === row.leadId); const accrual = data.accruals.find((item) => item.id === row.accrualId); return <tr key={row.id}><td><strong>{data.entityNames[row.familyEntityId]}</strong><small>{data.entityNames[row.childEntityId]}</small></td><td><strong>{data.entityNames[row.serviceEntityId]}</strong><small>{row.status} · {row.lifetimeMonths} мес.</small></td><td><strong>{row.contractId}</strong><small>{accrual?.id} · {accrual?.status}</small></td><td>{rubles(row.monthlyValueMinor)}</td><td><strong>{rubles(row.ltvMinor)}</strong></td><td><strong>{rubles(row.nextPaymentMinor)}</strong><small>{displayDate(row.nextPaymentDate)}</small></td><td><span className={`service-risk risk-${row.churnRiskBand.toLocaleLowerCase("ru")}`}>{row.churnRiskBand} · {row.churnRiskScore}</span></td><td><button disabled={!lead} onClick={() => setSelected(lead ?? null)}>Открыть</button></td></tr>; })}</tbody></table></div></article> : null}

      {tab === "loyalty" ? <div className="ltv-workspace">
        <div className="ltv-kpis"><article><span>LTV факт</span><strong>{rubles(data.ltvPlan.actualLtvMinor)}</strong><small>все подтверждённые платежи семей</small></article><article><span>Средний LTV семьи</span><strong>{rubles(data.ltvPlan.averageActualLtvMinor)}</strong><small>факт / число семей</small></article><article><span>База следующих 12 мес.</span><strong>{rubles(data.ltvPlan.baseNext12MonthsMinor)}</strong><small>без поправки на риск</small></article><article className="accent"><span>Прогноз с учётом риска</span><strong>{rubles(data.ltvPlan.riskAdjustedNext12MonthsMinor)}</strong><small>включён в финансовый план</small></article></div>
        <article className="sales-panel ltv-register"><PanelHead eyebrow="Клиентская экономика" title="LTV по семьям" aside={`${data.ltvPlan.families.length} семей`} /><div className="ltv-table-wrap"><table><thead><tr><th>Семья</th><th>Услуга</th><th>LTV факт</th><th>В месяц</th><th>Вероятность удержания</th><th>12 мес. с риском</th><th>Прогнозный LTV</th><th /></tr></thead><tbody>{data.ltvPlan.families.map((plan) => { const lifecycle = data.lifecycles.find((row) => row.familyEntityId === plan.familyEntityId)!; return <tr key={plan.familyEntityId}><td><strong>{data.entityNames[plan.familyEntityId]}</strong><small>{data.entityNames[lifecycle.childEntityId]}</small></td><td>{data.entityNames[lifecycle.serviceEntityId]}</td><td><strong>{rubles(plan.actualLtvMinor)}</strong></td><td>{rubles(plan.monthlyValueMinor)}</td><td><span className="retention-meter"><i style={{ width: `${plan.retentionProbability}%` }} /></span><b>{plan.retentionProbability}%</b></td><td>{rubles(plan.riskAdjustedNext12MonthsMinor)}</td><td><strong>{rubles(plan.forecastLtvMinor)}</strong></td><td><button onClick={() => setSelected(data.leads.find((lead) => lead.id === lifecycle.leadId) ?? null)}>Карточка</button></td></tr>; })}</tbody></table></div><footer className="ltv-method"><div><strong>Как считается</strong><span>{data.ltvPlan.method}</span></div><button onClick={onOpenFinance}>Открыть финансовый план →</button></footer></article>
        <div className="ltv-secondary"><article className="sales-panel"><PanelHead eyebrow="Удержание" title="Следующие предложения" aside="решает менеджер" /><div className="ltv-offers">{data.lifecycles.map((row) => <button key={row.id} onClick={() => setSelected(data.leads.find((lead) => lead.id === row.leadId) ?? null)}><span><strong>{data.entityNames[row.familyEntityId]}</strong><small>{row.loyaltyTier} · платёж {displayDate(row.nextPaymentDate)}</small></span><em>{row.repeatOffer}</em></button>)}</div></article><article className="sales-panel"><PanelHead eyebrow="Бонусный журнал" title="Начисления и списания" aside="append-only" /><div className="ltv-bonuses">{data.bonuses.map((bonus) => <article key={bonus.id}><b className={bonus.points > 0 ? "plus" : "minus"}>{bonus.points > 0 ? "+" : ""}{bonus.points}</b><span><strong>{bonus.reason}</strong><small>{data.entityNames[bonus.familyEntityId]} · {displayDate(bonus.occurredAt)}</small></span><em>{bonus.relatedContractId}</em></article>)}</div></article></div>
      </div> : null}

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
