"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { recordLabel } from "../../lib/record-labels";
import "./SalesWorkspace.css";
import "./SalesOperatingWorkspace.css";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./SalesWorkspace.ds.css";

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
const campaignNames: Record<string, string> = {
  school_2026: "Набор в школу 2026",
  kindergarten_aug: "Набор в детский сад",
  august_referral: "Рекомендации семей в августе",
  parent_referral: "Рекомендации родителей",
  direct_august: "Прямые обращения в августе",
  maps_august: "Карты в августе",
  theatre_summer: "Летний набор в театральную студию",
};
const creativeNames: Record<string, string> = {
  math_future: "Будущее математики",
  open_day: "День открытых дверей",
  campus_tour: "Экскурсия по комплексу",
  family_story: "История семьи",
  school_landing: "Страница школы",
  campus_photo: "Фотографии комплекса",
  stage_video: "Видео со сцены",
};
const channelNames: Record<string, string> = {
  cpc: "платная реклама", social: "социальные сети", messenger: "мессенджер", partner: "партнёрская рекомендация", organic: "обычный переход",
};

function leadLabel(value: string) { return recordLabel("Лид", value); }
function friendlyCampaign(lead: Lead) { return campaignNames[lead.utmCampaign] ?? (lead.campaignId ? recordLabel("Кампания", lead.campaignId) : "Без кампании"); }
function friendlyCreative(lead: Lead) { return creativeNames[lead.utmContent] ?? (lead.creativeId ? recordLabel("Материал", lead.creativeId) : "Материал не указан"); }
function friendlyChannel(lead: Lead) { return channelNames[lead.utmMedium] ?? (lead.utmMedium ? "канал отмечен в источнике" : "канал не указан"); }
function entityLabel(data: SalesData, value: string, kind: string) {
  const name = data.entityNames[value]?.trim();
  return name && !/\b[A-ZА-Я]{1,}(?:-[A-ZА-Я0-9]{1,})+\b/.test(name) ? name : value ? recordLabel(kind, value) : "Не связано";
}

export function SalesWorkspace({ workspace, role, notify, onTasksChanged, onOpenFinance, onOpenIntegrations, focusId }: { workspace: "sales" | "clients"; role: string; notify: (message: string) => void; onTasksChanged: () => void; onOpenFinance: () => void; onOpenIntegrations: () => void; focusId?: string }) {
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
  const [leadCreateOpen, setLeadCreateOpen] = useState(false);

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
      const payload = await response.json() as { error?: string; reused?: boolean; stage?: string; lead?: { id: string } };
      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");
      notify(payload.lead?.id ? `${leadLabel(payload.lead.id)} создан` : payload.reused ? "Связанная задача уже существует" : payload.stage ? `Лид переведён: ${payload.stage}` : "Действие сохранено");
      setEvidence(""); setTouchpointSummary(""); setTouchpointOutcome("");
      await load(); onTasksChanged();
      return true;
    } catch (actionError) {
      notify(actionError instanceof Error ? actionError.message : "Действие не выполнено");
      return false;
    } finally { setBusy(""); }
  }

  const filteredLeads = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase("ru");
    return data.leads.filter((lead) => !normalized || [lead.id, data.entityNames[lead.familyEntityId], lead.source, lead.stage, lead.campaignId, lead.managerEntityId, ...lead.tags].join(" ").toLocaleLowerCase("ru").includes(normalized));
  }, [data, query]);

  if (loading) return <section className="ahSalesStatus">Загружаем сквозную воронку…</section>;
  if (error || !data) return <PageContainer className="ahSalesDenied"><Card><EmptyState title="Контур продаж временно недоступен" description={error || "Данные не получены."} density="compact" action={<Button onClick={() => { setLoading(true); void load(); }}>Повторить</Button>} /></Card></PageContainer>;

  const chainLead = data.leads.find((lead) => lead.id === data.acceptanceChainLeadId) ?? data.leads[0] ?? null;
  const chainLifecycle = chainLead ? data.lifecycles.find((row) => row.leadId === chainLead.id) ?? null : null;
  const chainAccrual = chainLifecycle ? data.accruals.find((row) => row.id === chainLifecycle.accrualId) ?? null : null;
  const chainPayment = chainLifecycle ? data.operations.find((row) => row.id === chainLifecycle.paymentOperationId) ?? null : null;
  const hasSalesData = Boolean(data.leads.length || data.lifecycles.length || data.touchpoints.length || data.operations.length);
  return (
    <PageContainer className="ahSalesPage">
      <PageHeader
        eyebrow={workspace === "clients" ? "КЛИЕНТ 360° · СВЯЗИ · ИСТОРИЯ" : "ПРОДАЖИ · ВОРОНКА · ДОКАЗАТЕЛЬСТВА"}
        title={workspace === "clients" ? "Клиенты и семьи" : "Продажи"}
        description={workspace === "clients" ? "Семья, ребёнок, договор, услуги, начисления, платежи, лояльность и обращения собраны в одной цепочке." : "Каждый договор и рубль сохраняет путь до первого клика — с менеджером, контактом и доказательством перехода."}
        actions={<Button variant="primary" onClick={() => setLeadCreateOpen(true)}>Добавить лид</Button>}
      />

      <div className="ahSalesBoundary"><strong>{hasSalesData ? "СОХРАНЁННЫЕ ДАННЫЕ" : "НЕТ ИСХОДНЫХ ДАННЫХ"}</strong><span>{data.sourcePolicy.note}</span><em>Персональные данные не перенесены</em></div>

      <div className="ahSalesKpis">
        <KpiCard label="Лиды" value={data.summary.leads} note={`${data.summary.activeLeads} активных · ${data.leads.filter((lead) => !lead.utmSource).length} без UTM`} onClick={() => setTab("leads")} />
        <KpiCard label="Конверсия в платёж" value={`${data.summary.leadToPaymentPercent}%`} note={`${data.summary.paidLeads} из ${data.summary.leads} дошли до оплаты`} onClick={() => setTab("funnel")} />
        <KpiCard label="Выручка по цепочке" value={rubles(data.summary.revenueMinor)} note={data.operations.length ? "по сохранённым операциям" : "операций пока нет"} onClick={() => setTab("chain")} />
        <KpiCard label="Высокий риск ухода" value={data.summary.highRisk} note={data.summary.highRisk ? "требует проверки менеджером" : "сигналов пока нет"} onClick={() => setTab("clients")} className={data.summary.highRisk ? "ahSalesKpiWarning" : undefined} />
      </div>

      <div className="ahSalesTabs"><Tabs items={tabs.map((item) => ({ id: item.id, label: item.id === "leads" ? <>{item.label}{data.leads.length ? <b>{data.leads.length}</b> : null}</> : item.label }))} value={tab} onChange={setTab} ariaLabel="Разделы продаж" /></div>

      {tab === "funnel" ? hasSalesData ? <div className="crm-view">
        <div className="crm-toolbar"><div><strong>Основная воронка</strong><span>Карточка открывается по клику; перенос между этапами подтверждается внутри карточки.</span></div><div><button onClick={() => setLeadCreateOpen(true)}>+ Добавить лид</button><button onClick={() => setTab("leads")}>Реестр лидов</button><button onClick={onOpenIntegrations}>Источники</button></div></div>
        <div className="crm-board" aria-label="Воронка продаж по этапам">{data.funnel.map((column, index) => {
          const cards = data.leads.filter((lead) => lead.stage === column.stage && lead.status !== "Закрыт");
          return <section className="crm-column" key={column.stage}><header><div><span>{String(index + 1).padStart(2, "0")}</span><strong>{column.stage}</strong></div><b>{cards.length}</b><small>{index === 0 ? "100% вход" : `${column.conversionPercent}% переход`}</small></header><div>{cards.map((lead) => {
            const lifecycle = data.lifecycles.find((row) => row.leadId === lead.id);
            const last = data.touchpoints.filter((row) => row.leadId === lead.id).at(-1);
            return <button className="crm-lead-card" key={lead.id} onClick={() => setSelected(lead)}><span className="crm-lead-id">{leadLabel(lead.id)}<em>{lead.tags.at(0) ?? "новый"}</em></span><strong>{lead.familyEntityId ? entityLabel(data, lead.familyEntityId, "Клиент") : lead.source}</strong><small>{lead.childEntityId ? entityLabel(data, lead.childEntityId, "Ребёнок") : `${lead.source} · ${friendlyCampaign(lead)}`}</small>{lifecycle ? <b>{rubles(lifecycle.monthlyValueMinor)} / мес.</b> : <b>{lead.source}</b>}<footer><span>{lead.managerEntityId ? entityLabel(data, lead.managerEntityId, "Менеджер") : "Без менеджера"}</span><time>{last ? displayDate(last.occurredAt) : displayDate(lead.firstClickAt)}</time></footer></button>;
          })}{!cards.length ? <div className="crm-column-empty">Нет карточек на этапе</div> : null}</div></section>;
        })}</div>
        <div className="crm-lost"><strong>Закрытые и потерянные</strong>{data.leads.filter((lead) => lead.status === "Закрыт").map((lead) => <button key={lead.id} onClick={() => setSelected(lead)}><span>{leadLabel(lead.id)} · {lead.source}</span><em>{lead.rejectionReason || "Причина не указана"}</em></button>)}</div>
      </div> : <Card className="ahSalesEmptyPanel"><EmptyState title="Лидов и этапов пока нет" description="Добавьте первую заявку вручную или подключите подтверждённый источник продаж." density="compact" action={<div className="ahSalesEmptyActions"><Button variant="primary" onClick={() => setLeadCreateOpen(true)}>Добавить первый лид</Button><Button onClick={onOpenIntegrations}>Настроить источники</Button></div>} /></Card> : null}

      {tab === "leads" ? <article className="sales-panel leads-panel"><PanelHead eyebrow="Операционный реестр" title="Лиды, менеджеры и контакты" aside={`${filteredLeads.length} записей`} /><div className="sales-toolbar"><input aria-label="Поиск лидов" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, источник, этап, кампания или тег…" /><button onClick={() => setQuery("")}>Сбросить</button></div>{filteredLeads.length ? <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Лид</th><th>Первый клик</th><th>Атрибуция</th><th>Менеджер</th><th>Этап</th><th>Последний контакт</th><th>Статус</th></tr></thead><tbody>{filteredLeads.map((lead) => { const contacts = data.touchpoints.filter((row) => row.leadId === lead.id); const last = contacts.at(-1); return <tr key={lead.id} onClick={() => setSelected(lead)}><td><strong>{leadLabel(lead.id)}</strong><small>{lead.tags.join(" · ")}</small></td><td><strong>{displayDate(lead.firstClickAt)}</strong><small>{lead.source}</small></td><td><strong>{friendlyCampaign(lead)}</strong><small>{lead.utmSource ? `${lead.source} · ${friendlyChannel(lead)}` : "Рекламная метка отсутствует"}</small></td><td>{lead.managerEntityId ? entityLabel(data, lead.managerEntityId, "Менеджер") : "Не назначен"}</td><td><span className="sales-stage-chip">{lead.stage}</span></td><td><strong>{last?.touchpointType ?? "Нет контакта"}</strong><small>{last?.outcome ?? "Создать задачу"}</small></td><td><span className={lead.status === "Активен" ? "sales-status active" : "sales-status closed"}>{lead.status}</span></td></tr>; })}</tbody></table></div> : <EmptyState title="Лидов не найдено" description={query ? "Измените запрос или сбросьте фильтр." : "Реестр появится после загрузки источника продаж."} density="compact" />}</article> : null}

      {tab === "chain" ? chainLead && chainLifecycle && chainAccrual && chainPayment ? <div className="sales-grid chain-layout">
        <article className="sales-panel chain-panel"><PanelHead eyebrow="Сквозной маршрут" title={`${leadLabel(chainLead.id)} · от клика до LTV`} aside="Цепочка сохранена" /><div className="chain-ribbon">{[
          ["Первый клик", chainLead.source, displayDate(chainLead.firstClickAt)], ["Источник", `${chainLead.source} · ${friendlyChannel(chainLead)}`, friendlyCampaign(chainLead)], ["Кампания", friendlyCampaign(chainLead), friendlyCreative(chainLead)], ["Предложение", chainLead.offerId ? recordLabel("Предложение", chainLead.offerId) : "Не связано", chainLead.formId ? recordLabel("Форма", chainLead.formId) : "Форма не указана"], ["Заявка", leadLabel(chainLead.id), chainLead.managerEntityId ? entityLabel(data, chainLead.managerEntityId, "Менеджер") : "Менеджер не назначен"], ["Консультация", "Консультация проведена", "04.04.2026"], ["Посещение", "Посещение состоялось", "Корпус 1"], ["Договор", recordLabel("Договор", chainLead.contractId), entityLabel(data, chainLead.familyEntityId, "Семья")], ["Ребёнок", entityLabel(data, chainLead.childEntityId, "Ребёнок"), "Карточка связана"], ["Услуга", entityLabel(data, chainLead.serviceEntityId, "Услуга"), "Карточка связана"], ["Начисление", recordLabel("Начисление", chainAccrual.id), rubles(chainAccrual.amountMinor)], ["Платёж", recordLabel("Операция", chainPayment.id), rubles(chainPayment.amountMinor)], ["LTV", rubles(chainLifecycle.ltvMinor), `${chainLifecycle.lifetimeMonths} мес.`],
        ].map(([label, value, note], index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div>{index < 12 ? <i>→</i> : null}</article>)}</div><div className="chain-proof"><span>Финансовая граница</span><p>{data.sourcePolicy.financeLink}</p><button onClick={onOpenFinance}>Открыть операцию в финансах →</button></div></article>
        <article className="sales-panel chain-events"><PanelHead eyebrow="Доказательства" title="События и контакты" aside={`${data.touchpoints.filter((row) => row.leadId === chainLead.id).length} касаний`} /><div>{data.touchpoints.filter((row) => row.leadId === chainLead.id).map((row) => <article key={row.id}><time>{new Date(row.occurredAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span><strong>{row.touchpointType} · {row.channel}</strong><small>{row.summary}</small></span><em>{row.outcome}</em></article>)}</div></article>
      </div> : <Card className="ahSalesEmptyPanel"><EmptyState title="Сквозная цепочка пока не собрана" description="Она появится после связи лида, договора, начисления и подтверждённой финансовой операции." density="compact" /></Card> : null}

      {tab === "clients" ? <article className="sales-panel service-registry"><PanelHead eyebrow="Действующие отношения" title="Семьи и услуги" aside={`${data.lifecycles.length} семей`} /><div className="service-registry-note"><strong>Одна строка — одна семья и услуга</strong><span>Карточка показывает договор, обучение, начисление и риск. История связей открывается уже внутри семьи.</span></div><div className="service-table-wrap"><table><thead><tr><th>Семья и ребёнок</th><th>Услуга</th><th>Договор</th><th>Платёж в месяц</th><th>LTV факт</th><th>Следующий платёж</th><th>Риск</th><th /></tr></thead><tbody>{data.lifecycles.map((row) => { const lead = data.leads.find((item) => item.id === row.leadId); const accrual = data.accruals.find((item) => item.id === row.accrualId); return <tr key={row.id}><td><strong>{entityLabel(data, row.familyEntityId, "Семья")}</strong><small>{entityLabel(data, row.childEntityId, "Ребёнок")}</small></td><td><strong>{entityLabel(data, row.serviceEntityId, "Услуга")}</strong><small>{row.status} · {row.lifetimeMonths} мес.</small></td><td><strong>{recordLabel("Договор", row.contractId)}</strong><small>{accrual ? `${recordLabel("Начисление", accrual.id)} · ${accrual.status}` : "Начисление не создано"}</small></td><td>{rubles(row.monthlyValueMinor)}</td><td><strong>{rubles(row.ltvMinor)}</strong></td><td><strong>{rubles(row.nextPaymentMinor)}</strong><small>{displayDate(row.nextPaymentDate)}</small></td><td><span className={`service-risk risk-${row.churnRiskBand.toLocaleLowerCase("ru")}`}>{row.churnRiskBand} · {row.churnRiskScore}</span></td><td><button disabled={!lead} onClick={() => setSelected(lead ?? null)}>Открыть</button></td></tr>; })}</tbody></table></div></article> : null}

      {tab === "loyalty" ? <div className="ltv-workspace">
        <div className="ltv-kpis"><article><span>LTV факт</span><strong>{rubles(data.ltvPlan.actualLtvMinor)}</strong><small>все подтверждённые платежи семей</small></article><article><span>Средний LTV семьи</span><strong>{rubles(data.ltvPlan.averageActualLtvMinor)}</strong><small>факт / число семей</small></article><article><span>База следующих 12 мес.</span><strong>{rubles(data.ltvPlan.baseNext12MonthsMinor)}</strong><small>без поправки на риск</small></article><article className="accent"><span>Прогноз с учётом риска</span><strong>{rubles(data.ltvPlan.riskAdjustedNext12MonthsMinor)}</strong><small>включён в финансовый план</small></article></div>
        <article className="sales-panel ltv-register"><PanelHead eyebrow="Клиентская экономика" title="LTV по семьям" aside={`${data.ltvPlan.families.length} семей`} /><div className="ltv-table-wrap"><table><thead><tr><th>Семья</th><th>Услуга</th><th>LTV факт</th><th>В месяц</th><th>Вероятность удержания</th><th>12 мес. с риском</th><th>Прогнозный LTV</th><th /></tr></thead><tbody>{data.ltvPlan.families.map((plan) => { const lifecycle = data.lifecycles.find((row) => row.familyEntityId === plan.familyEntityId)!; return <tr key={plan.familyEntityId}><td><strong>{entityLabel(data, plan.familyEntityId, "Семья")}</strong><small>{entityLabel(data, lifecycle.childEntityId, "Ребёнок")}</small></td><td>{entityLabel(data, lifecycle.serviceEntityId, "Услуга")}</td><td><strong>{rubles(plan.actualLtvMinor)}</strong></td><td>{rubles(plan.monthlyValueMinor)}</td><td><span className="retention-meter"><i style={{ width: `${plan.retentionProbability}%` }} /></span><b>{plan.retentionProbability}%</b></td><td>{rubles(plan.riskAdjustedNext12MonthsMinor)}</td><td><strong>{rubles(plan.forecastLtvMinor)}</strong></td><td><button onClick={() => setSelected(data.leads.find((lead) => lead.id === lifecycle.leadId) ?? null)}>Карточка</button></td></tr>; })}</tbody></table></div><footer className="ltv-method"><div><strong>Как считается</strong><span>{data.ltvPlan.method}</span></div><button onClick={onOpenFinance}>Открыть финансовый план →</button></footer></article>
        <div className="ltv-secondary"><article className="sales-panel"><PanelHead eyebrow="Удержание" title="Следующие предложения" aside="решает менеджер" /><div className="ltv-offers">{data.lifecycles.map((row) => <button key={row.id} onClick={() => setSelected(data.leads.find((lead) => lead.id === row.leadId) ?? null)}><span><strong>{entityLabel(data, row.familyEntityId, "Семья")}</strong><small>{row.loyaltyTier} · платёж {displayDate(row.nextPaymentDate)}</small></span><em>{row.repeatOffer}</em></button>)}</div></article><article className="sales-panel"><PanelHead eyebrow="Бонусный журнал" title="Начисления и списания" aside="неизменяемый журнал" /><div className="ltv-bonuses">{data.bonuses.map((bonus) => <article key={bonus.id}><b className={bonus.points > 0 ? "plus" : "minus"}>{bonus.points > 0 ? "+" : ""}{bonus.points}</b><span><strong>{bonus.reason}</strong><small>{entityLabel(data, bonus.familyEntityId, "Семья")} · {displayDate(bonus.occurredAt)}</small></span><em>{recordLabel("Договор", bonus.relatedContractId)}</em></article>)}</div></article></div>
      </div> : null}

      {leadCreateOpen ? <LeadCreateModal busy={busy === "create-lead"} close={() => setLeadCreateOpen(false)} save={async (lead) => { const saved = await action({ action: "createLead", ...lead }, "create-lead"); if (saved) { setLeadCreateOpen(false); setTab("leads"); } return saved; }} /> : null}
      {selected ? <LeadDrawer lead={selected} data={data} busy={busy} evidence={evidence} setEvidence={setEvidence} touchpointType={touchpointType} setTouchpointType={setTouchpointType} touchpointSummary={touchpointSummary} setTouchpointSummary={setTouchpointSummary} touchpointOutcome={touchpointOutcome} setTouchpointOutcome={setTouchpointOutcome} close={() => setSelected(null)} action={action} /> : null}
    </PageContainer>
  );
}

function LeadCreateModal({ busy, close, save }: { busy: boolean; close: () => void; save: (lead: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("Ручной ввод");
  const [interest, setInterest] = useState("");
  const [branchId, setBranchId] = useState("");
  const [comment, setComment] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [consent, setConsent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save({ name, phone, email, source, interest, branchId, comment, utmSource, utmMedium, utmCampaign, consent });
  }
  return createPortal(<div className="lead-create-layer"><button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть создание лида" /><form className="lead-create-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="lead-create-title"><header><div><p>Новая запись в воронке</p><h2 id="lead-create-title">Добавить лид</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header><div className="lead-create-grid"><label><span>Имя *</span><input name="name" value={name} onChange={(event) => setName(event.target.value)} autoFocus required placeholder="Как обращаться к клиенту" /></label><label><span>Источник *</span><select name="source" value={source} onChange={(event) => setSource(event.target.value)}><option>Ручной ввод</option><option>Сайт</option><option>Телефон</option><option>WhatsApp</option><option>Telegram</option><option>VK</option><option>Яндекс</option><option>Email</option><option>Рекомендация</option><option>Другое</option></select></label><label><span>Телефон</span><input name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+7 …" /></label><label><span>Email</span><input name="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="name@example.ru" /></label><label><span>Интерес / услуга</span><input name="interest" value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="Садик, школа, курс, мероприятие" /></label><label><span>Филиал</span><select name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Пока не определён</option><option value="BR-KINDERGARTEN">Атлас — садик</option><option value="BR-ATLAS-SCHOOL">Атлас — школа</option><option value="BR-SCHOOL">1–11</option><option value="BR-NEBO">Небо</option><option value="BR-LISTVENNAYA">Лиственная</option></select></label><label className="wide"><span>Комментарий</span><textarea name="comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Запрос клиента, удобное время связи, важные детали" /></label><details className="wide"><summary>UTM и рекламная атрибуция</summary><div className="lead-utm-grid"><label><span>utm_source</span><input name="utmSource" value={utmSource} onChange={(event) => setUtmSource(event.target.value)} /></label><label><span>utm_medium</span><input name="utmMedium" value={utmMedium} onChange={(event) => setUtmMedium(event.target.value)} /></label><label><span>utm_campaign</span><input name="utmCampaign" value={utmCampaign} onChange={(event) => setUtmCampaign(event.target.value)} /></label></div></details><label className="lead-consent"><input name="consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Подтверждаю, что контакт передан клиентом для связи и может быть сохранён в ArtHello OS.</span></label></div><footer><span>После сохранения лид попадёт на этап «Заявка» без назначенного менеджера.</span><div><button type="button" onClick={close}>Отмена</button><button className="primary" disabled={busy || !name.trim() || (!phone.trim() && !email.trim()) || !consent}>{busy ? "Сохраняем…" : "Создать лид"}</button></div></footer></form></div>, document.body);
}

function PanelHead({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {
  return <header className="sales-panel-head"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{aside}</span></header>;
}

function LeadDrawer({ lead, data, busy, evidence, setEvidence, touchpointType, setTouchpointType, touchpointSummary, setTouchpointSummary, touchpointOutcome, setTouchpointOutcome, close, action }: {
  lead: Lead; data: SalesData; busy: string; evidence: string; setEvidence: (value: string) => void; touchpointType: string; setTouchpointType: (value: string) => void; touchpointSummary: string; setTouchpointSummary: (value: string) => void; touchpointOutcome: string; setTouchpointOutcome: (value: string) => void; close: () => void; action: (body: Record<string, unknown>, key: string) => Promise<boolean>;
}) {
  const contacts = data.touchpoints.filter((row) => row.leadId === lead.id);
  const lifecycle = data.lifecycles.find((row) => row.leadId === lead.id);
  function advance(event: FormEvent) { event.preventDefault(); void action({ action: "advanceStage", leadId: lead.id, evidence }, `advance:${lead.id}`); }
  function contact(event: FormEvent) { event.preventDefault(); void action({ action: "logTouchpoint", leadId: lead.id, touchpointType, summary: touchpointSummary, outcome: touchpointOutcome }, `contact:${lead.id}`); }
  return createPortal(<div className="sales-drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть карточку" /><aside className="sales-drawer"><header><div><span>{lead.status}</span><h2>{leadLabel(lead.id)}</h2><p>{lead.source} · {lead.stage}</p></div><button onClick={close}>×</button></header><div className="sales-drawer-body"><section className="lead-origin"><p>Первый клик и атрибуция</p><dl><div><dt>Дата</dt><dd>{displayDate(lead.firstClickAt)}</dd></div><div><dt>Источник</dt><dd>{lead.source}</dd></div><div><dt>Кампания</dt><dd>{friendlyCampaign(lead)}</dd></div><div><dt>Канал</dt><dd>{friendlyChannel(lead)}</dd></div><div><dt>Материал</dt><dd>{friendlyCreative(lead)}</dd></div><div><dt>Предложение</dt><dd>{lead.offerId ? recordLabel("Предложение", lead.offerId) : "Не указано"}</dd></div><div><dt>Форма</dt><dd>{lead.formId ? recordLabel("Форма", lead.formId) : "Не указана"}</dd></div><div><dt>Менеджер</dt><dd>{lead.managerEntityId ? entityLabel(data, lead.managerEntityId, "Менеджер") : "Не назначен"}</dd></div><div><dt>Теги</dt><dd>{lead.tags.join(", ")}</dd></div></dl>{lead.utmSource || lead.utmMedium || lead.utmCampaign ? <details><summary>Технические метки рекламы</summary><p>Источник: {lead.utmSource || "—"} · канал: {lead.utmMedium || "—"} · кампания: {lead.utmCampaign || "—"}</p></details> : null}</section><section className="lead-relations"><p>Связанные сущности</p><div>{[["Семья", lead.familyEntityId], ["Ребёнок", lead.childEntityId], ["Договор", lead.contractId], ["Услуга", lead.serviceEntityId]].map(([label, value]) => <article key={label}><small>{label}</small><strong>{value ? (label === "Договор" ? recordLabel(label, value) : entityLabel(data, value, label)) : "Появится на следующем этапе"}</strong></article>)}</div>{lifecycle ? <footer><span>LTV {rubles(lifecycle.ltvMinor)}</span><span>Риск {lifecycle.churnRiskBand} · {lifecycle.churnRiskScore}</span><span>{lifecycle.loyaltyTier}</span></footer> : null}</section><section className="lead-history"><p>Звонки, переписки, консультации и посещения</p>{contacts.length ? contacts.map((row) => <article key={row.id}><time>{displayDate(row.occurredAt)}</time><span><strong>{row.touchpointType} · {row.channel}</strong><small>{row.summary}</small></span><em>{row.outcome}</em></article>) : <small>Контактов пока нет.</small>}</section>{lead.status === "Активен" ? <><form className="lead-action-form" onSubmit={advance}><p>Перевести только на следующий этап</p><input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Подтверждение перехода: встреча, документ, результат" /><button disabled={busy === `advance:${lead.id}`}>Подтвердить переход</button></form><form className="lead-action-form contact-form" onSubmit={contact}><p>Зафиксировать контакт</p><select value={touchpointType} onChange={(event) => setTouchpointType(event.target.value)}><option>Звонок</option><option>Переписка</option><option>Консультация</option><option>Посещение</option></select><input value={touchpointSummary} onChange={(event) => setTouchpointSummary(event.target.value)} placeholder="Что обсуждали" /><input value={touchpointOutcome} onChange={(event) => setTouchpointOutcome(event.target.value)} placeholder="Итог" /><button disabled={busy === `contact:${lead.id}`}>Сохранить контакт</button></form><button className="followup-button" disabled={busy === `task:${lead.id}`} onClick={() => void action({ action: "createFollowupTask", leadId: lead.id }, `task:${lead.id}`)}>+ Задача на следующий шаг</button></> : <div className="closed-lead-note">Закрыт: {lead.rejectionReason}. История и доказательства сохранены.</div>}</div></aside></div>, document.body);
}
