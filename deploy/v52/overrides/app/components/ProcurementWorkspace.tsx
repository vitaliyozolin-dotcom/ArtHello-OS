"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Card,
  CompactListCard,
  EmptyState,
  KpiCard,
  PageContainer,
  PageHeader,
  Tabs,
} from "./design-system";
import "./ProcurementWorkspace.ds.css";

type Data = {
  suppliers: Array<{ id: string; entityId: string; specialization: string; contractId: string; basePriceMinor: number; qualityScore: number; rating: number; marketIndex: number; status: string; dataQuality: string }>;
  requests: Array<{ id: string; requesterEntityId: string; unit: string; itemName: string; quantity: number; budgetMinor: number; needBy: string; status: string; justification: string; approverEntityId: string; approvedAt: string }>;
  offers: Array<{ id: string; requestId: string; supplierId: string; priceMinor: number; deliveryDays: number; warrantyMonths: number; qualityScore: number; status: string; comparisonNote: string; score: number }>;
  orders: Array<{ id: string; requestId: string; offerId: string; supplierId: string; orderNumber: string; amountMinor: number; status: string; orderedAt: string; expectedAt: string; contractId: string }>;
  deliveries: Array<{ id: string; orderId: string; deliveredAt: string; documentId: string; status: string; quantity: number; acceptedQuantity: number; qualityNote: string }>;
  items: Array<{ id: string; sku: string; name: string; category: string; warehouse: string; quantity: number; unitCostMinor: number; assetId: string; status: string }>;
  events: Array<{ id: string; itemId: string; eventType: string; quantity: number; fromLocation: string; toLocation: string; documentId: string; occurredAt: string }>;
  assets: Array<{ id: string; itemId: string; serialNumber: string; objectEntityId: string; assignedToEntityId: string; warrantyUntil: string; serviceDue: string; status: string; acquisitionDate: string; costMinor: number; monthlyDepreciationMinor: number; warrantyState: string }>;
  maintenance: Array<{ id: string; assetId: string; maintenanceType: string; scheduledAt: string; contractorId: string; status: string; costMinor: number; documentId: string; relatedTaskId: number | null }>;
  entityNames: Record<string, string>;
  payment?: { id: string; amountMinor: number; reportClass: string; dataQuality: string };
  summary: { requests: number; offers: number; stockUnits: number; assets: number; serviceDue: number };
  chain: { requestId: string; approvalId: string; offerId: string; supplierId: string; orderId: string; deliveryId: string; itemId: string; assetId: string; documentId: string; paymentId: string };
  boundary: string;
};

const codes: Record<string, string> = {
  "Собственник": "OWNER",
  "Директор": "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
  "Закупки": "PROCUREMENT",
  "Финансы": "FINANCE",
  "Юрист": "LEGAL",
  "HR": "HR",
  "Продажи": "SALES",
  "Маркетинг": "MARKETING",
  "Педагог": "TEACHER",
  "Методист": "METHODIST",
  "Родитель": "PARENT",
};

const tabs = ["Закупка", "Поставщики", "Склад", "Имущество", "Сквозная цепочка"] as const;
type Tab = (typeof tabs)[number];
const tabItems = tabs.map((id) => ({ id, label: id }));
const rub = (value: number) => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
}).format(value / 100);

export function ProcurementWorkspace({ role, notify, onTasksChanged, onOpenFinance }: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
  onOpenFinance: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Закупка");
  const [busy, setBusy] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [approvalRequestId, setApprovalRequestId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/procurement", {
        cache: "no-store",
        headers: { "x-arthello-role": codes[role] ?? "" },
      });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (caught) {
      setData(null);
      setError(caught instanceof Error ? caught.message : "Нет доступа");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/procurement-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": codes[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Действие уже выполнено" : "Операция закупки сохранена");
      await load();
      onTasksChanged();
      return true;
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Ошибка");
      return false;
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <PageContainer className="ahProcurementPage">
      <PageHeader eyebrow="От потребности до результата" title="Закупки и имущество" description="Заявки, поставщики, склад и жизненный цикл имущества." />
      <Card className="ahProcurementStatus"><span role="status">Загружаем закупки и имущество…</span></Card>
    </PageContainer>;
  }

  if (error || !data) {
    return <PageContainer className="ahProcurementPage">
      <PageHeader eyebrow="От потребности до результата" title="Закупки и имущество" description="Заявки, поставщики, склад и жизненный цикл имущества." />
      <Card className="ahProcurementStateCard"><EmptyState density="compact" title={error || "Раздел закупок недоступен"} description="Раздел доступен закупкам, финансам, руководителям и Представителю." action={<Button variant="primary" onClick={() => void load()}>Повторить</Button>} /></Card>
    </PageContainer>;
  }

  const entities = Object.entries(data.entityNames);
  const hasProcurementData = Boolean(
    data.suppliers.length || data.requests.length || data.offers.length || data.orders.length
    || data.deliveries.length || data.items.length || data.assets.length || data.maintenance.length,
  );
  const chainSteps: Array<[string, string, string]> = [
    ["Заявка", data.chain.requestId, "потребность и срок"],
    ["Согласование", data.chain.approvalId, "владелец решения"],
    ["Сравнение", data.chain.offerId, "цена, срок и качество"],
    ["Поставщик", data.chain.supplierId, "проверенный договор"],
    ["Заказ", data.chain.orderId, "подтверждённый объём"],
    ["Поставка", data.chain.deliveryId, "факт приёмки"],
    ["Склад", data.chain.itemId, "остаток и движение"],
    ["Имущество", data.chain.assetId, "гарантия и обслуживание"],
    ["Документ", data.chain.documentId, "основание операции"],
    ["Оплата", data.chain.paymentId, "связь с финансами"],
    ["ОПиУ", data.payment?.reportClass ?? "", "класс управленческого учёта"],
  ];

  return <PageContainer className="ahProcurementPage">
    <PageHeader
      eyebrow="От потребности до результата"
      title="Закупки и имущество"
      description="Заявки, поставщики, поставка, склад и жизненный цикл оборудования в одном контуре."
      actions={<Button variant="primary" disabled={!entities.length} onClick={() => setRequestOpen(true)}>+ Новая заявка</Button>}
    />

    <Card className="ahProcurementBoundary">
      <strong>{hasProcurementData ? "Рабочий контур" : "Рабочая структура"}</strong>
      <span>{hasProcurementData ? data.boundary : "Пустой контур не создаёт тестовую закупку. Для заявки нужен реальный сотрудник из единого справочника."}</span>
    </Card>

    <section className="ahProcurementKpis" aria-label="Показатели закупок и имущества">
      <KpiCard label="Заявки" value={data.summary.requests} note={`${data.summary.offers} предложений`} onClick={() => setTab("Закупка")} />
      <KpiCard label="Поставщики" value={data.suppliers.length} note="цена, качество, рейтинг" onClick={() => setTab("Поставщики")} />
      <KpiCard label="Остатки" value={data.summary.stockUnits} note="единиц на складах" onClick={() => setTab("Склад")} />
      <KpiCard className="ahProcurementKpiWarning" label="Обслуживание" value={data.summary.serviceDue} note="плановые события" onClick={() => setTab("Имущество")} />
    </section>

    <div className="ahProcurementTabs"><Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel="Разделы закупок и имущества" /></div>

    {tab === "Закупка" ? <div className="ahProcurementLayout">
      <Card className="ahProcurementPanel">
        <PanelHead eyebrow="Заявки" title="Потребность и согласование" meta={`${data.requests.length} записей`} />
        {data.requests.length ? <div className="ahProcurementRequestList">{data.requests.map((request) => <article key={request.id} data-ah-compact-card="true">
          <header><span>{request.id}</span><em>{request.status}</em></header>
          <h2>{request.itemName} · {request.quantity} шт.</h2><p>{request.justification}</p>
          <footer><span>{request.unit} · нужно до {request.needBy}</span><strong>{rub(request.budgetMinor)}</strong></footer>
          {request.status === "На согласовании" ? <Button className="ahProcurementInlineButton" variant="secondary" disabled={busy === request.id} onClick={() => setApprovalRequestId(request.id)}>Согласовать</Button> : null}
        </article>)}</div> : <EmptyState density="compact" title="Заявок пока нет" description="Укажите предмет, подразделение, количество, бюджет, срок и обоснование." action={<Button variant="primary" disabled={!entities.length} onClick={() => setRequestOpen(true)}>Создать заявку</Button>} />}
      </Card>
      <Card className="ahProcurementPanel">
        <PanelHead eyebrow="Сравнение" title="Предложения поставщиков" meta="единая формула" />
        {data.offers.length ? <div className="ahProcurementOfferList">{data.offers.map((offer, index) => <CompactListCard key={offer.id} index={String(index + 1).padStart(2, "0")} title={data.entityNames[data.suppliers.find((supplier) => supplier.id === offer.supplierId)?.entityId ?? ""] ?? offer.supplierId} description={`${rub(offer.priceMinor)} · ${offer.deliveryDays} дн. · гарантия ${offer.warrantyMonths} мес. · балл ${offer.score} · ${offer.status}`} />)}</div> : <EmptyState density="compact" title="Предложений пока нет" description="Сравнение появится после добавления поставщиков, предложений и договоров." />}
      </Card>
    </div> : null}

    {tab === "Поставщики" ? data.suppliers.length ? <div className="ahProcurementSupplierGrid">{data.suppliers.map((supplier) => <Card key={supplier.id} className="ahProcurementSupplier">
      <header><div><span>{supplier.id}</span><h2>{data.entityNames[supplier.entityId] ?? supplier.entityId}</h2></div><em>{supplier.status}</em></header>
      <p>{supplier.specialization}</p>
      <div className="ahProcurementScores"><span><small>Качество</small><strong>{supplier.qualityScore}</strong></span><span><small>Рейтинг</small><strong>{supplier.rating}</strong></span><span><small>Индекс рынка</small><strong>{supplier.marketIndex}</strong></span></div>
      <dl><div><dt>Базовая цена</dt><dd>{rub(supplier.basePriceMinor)}</dd></div><div><dt>Договор</dt><dd>{supplier.contractId || "Нет договора"}</dd></div></dl><footer>{supplier.dataQuality}</footer>
    </Card>)}</div> : <Card className="ahProcurementStateCard"><EmptyState density="compact" title="Поставщиков пока нет" description="Карточки поставщиков должны быть связаны с реальными контрагентами и договорами." /></Card> : null}

    {tab === "Склад" ? <div className="ahProcurementLayout">
      <Card className="ahProcurementPanel">
        <PanelHead eyebrow="Остатки" title="Склад и номенклатура" meta="приёмка · выдача · движение" />
        {data.items.length ? <div className="ahProcurementStockList">{data.items.map((item) => <article key={item.id} data-ah-compact-card="true"><span>{item.quantity}</span><div><strong>{item.name}</strong><small>{item.sku} · {item.category} · {item.warehouse}</small></div><em>{rub(item.unitCostMinor)}</em><Button className="ahProcurementInlineButton" variant="secondary" disabled={busy === item.id || item.quantity < 1} onClick={() => void action({ action: "inventoryEvent", itemId: item.id, eventType: "Выдача", quantity: 1, toLocation: "Ответственный получатель", documentId: `ISSUE-${item.id}` }, item.id)}>Выдать 1</Button></article>)}</div> : <EmptyState density="compact" title="Склад не заполнен" description="Приёмка, выдача, перемещение, списание и инвентаризация появятся после первой номенклатуры." />}
      </Card>
      <Card className="ahProcurementPanel">
        <PanelHead eyebrow="Журнал" title="Движение и инвентаризация" meta={`${data.events.length} событий`} />
        {data.events.length ? <div className="ahProcurementTimeline">{data.events.map((event) => <CompactListCard key={event.id} index={event.occurredAt.slice(5, 10)} title={`${event.eventType} · ${event.quantity}`} description={`${event.fromLocation} → ${event.toLocation} · ${event.documentId}`} />)}</div> : <EmptyState density="compact" title="Движений пока нет" description="Журнал появится после первой подтверждённой складской операции." />}
      </Card>
    </div> : null}

    {tab === "Имущество" ? <div className="ahProcurementLayout">
      <div className="ahProcurementAssetGrid">{data.assets.length ? data.assets.map((asset) => <Card key={asset.id} className="ahProcurementAsset">
        <header><span>{asset.id}</span><em>{asset.status}</em></header><h2>{asset.serialNumber}</h2>
        <dl><div><dt>Объект</dt><dd>{asset.objectEntityId}</dd></div><div><dt>Ответственный</dt><dd>{data.entityNames[asset.assignedToEntityId] ?? asset.assignedToEntityId}</dd></div><div><dt>Гарантия</dt><dd>{asset.warrantyUntil} · {asset.warrantyState}</dd></div><div><dt>Обслуживание</dt><dd>{asset.serviceDue}</dd></div><div><dt>Стоимость</dt><dd>{rub(asset.costMinor)}</dd></div><div><dt>Амортизация/мес.</dt><dd>{rub(asset.monthlyDepreciationMinor)}</dd></div></dl>
      </Card>) : <Card className="ahProcurementStateCard"><EmptyState density="compact" title="Карточек имущества пока нет" description="Серийный номер, объект, ответственный, гарантия и обслуживание будут храниться в одной карточке." /></Card>}</div>
      <Card className="ahProcurementPanel">
        <PanelHead eyebrow="Обслуживание и ремонт" title="План работ" meta="до задачи и акта" />
        {data.maintenance.length ? <div className="ahProcurementMaintenance">{data.maintenance.map((item) => <article key={item.id} data-ah-compact-card="true"><div><strong>{item.maintenanceType}</strong><small>{item.assetId} · {item.scheduledAt}</small></div><em>{item.status}</em>{item.relatedTaskId ? <span>TSK-{item.relatedTaskId}</span> : <Button className="ahProcurementInlineButton" variant="secondary" disabled={busy === item.id} onClick={() => void action({ action: "createMaintenanceTask", maintenanceId: item.id }, item.id)}>+ Задача</Button>}</article>)}</div> : <EmptyState density="compact" title="Работ пока нет" description="Обслуживание появится после назначения события для карточки имущества." />}
      </Card>
    </div> : null}

    {tab === "Сквозная цепочка" ? hasProcurementData ? <div className="ahProcurementLayout">
      <Card className="ahProcurementPanel"><PanelHead eyebrow="Приёмочный маршрут" title="От заявки до ОПиУ" meta="сквозная связь" /><div className="ahProcurementChain">{chainSteps.map(([label, id, detail], index) => <CompactListCard key={`${label}-${id}`} index={String(index + 1).padStart(2, "0")} title={id || "—"} description={`${label} · ${detail}`} />)}</div></Card>
      <Card className="ahProcurementPanel ahProcurementMoney"><PanelHead eyebrow="Денежная связь" title="Оплата и классификация" meta="подтверждённый источник" /><strong>{rub(data.payment?.amountMinor ?? 0)}</strong><p>{data.payment?.dataQuality || "Оплата появится после подтверждённой финансовой операции."}</p><Button variant="secondary" onClick={onOpenFinance}>Открыть в финансах</Button></Card>
    </div> : <Card className="ahProcurementStateCard"><EmptyState density="compact" title="Цепочка ещё не собрана" description="Заявка → согласование → предложение → заказ → поставка → склад → имущество → документ → оплата." /></Card> : null}

    {requestOpen ? <PurchaseRequestModal entities={entities} busy={busy === "new-request"} close={() => setRequestOpen(false)} save={async (body) => { const saved = await action({ action: "createRequest", ...body }, "new-request"); if (saved) { setRequestOpen(false); setTab("Закупка"); } }} /> : null}
    {approvalRequestId ? <PurchaseApprovalModal requestId={approvalRequestId} entities={entities} busy={busy === approvalRequestId} close={() => setApprovalRequestId("")} save={async (approverEntityId) => { const saved = await action({ action: "approveRequest", requestId: approvalRequestId, approverEntityId }, approvalRequestId); if (saved) setApprovalRequestId(""); }} /> : null}
  </PageContainer>;
}

function PanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return <header className="ahProcurementPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{meta}</span></header>;
}

function PurchaseRequestModal({ entities, busy, close, save }: {
  entities: Array<[string, string]>;
  busy: boolean;
  close: () => void;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save({
      requesterEntityId: String(form.get("requesterEntityId") ?? ""),
      itemName: String(form.get("itemName") ?? ""),
      unit: String(form.get("unit") ?? ""),
      quantity: Number(form.get("quantity") ?? 0),
      budgetMinor: Math.round(Number(form.get("budgetRubles") ?? 0) * 100),
      needBy: String(form.get("needBy") ?? ""),
      justification: String(form.get("justification") ?? ""),
    });
  }

  return createPortal(<div className="ahProcurementModalLayer">
    <button className="ahProcurementModalScrim" type="button" onClick={close} aria-label="Закрыть форму" />
    <form className="ahProcurementModal" onSubmit={submit}>
      <header><div><p>Закупки и имущество</p><h2>Новая заявка</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
      <div className="ahProcurementFormGrid">
        <label><span>Заявитель *</span><select name="requesterEntityId" required defaultValue=""><option value="">Выберите сотрудника</option>{entities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Подразделение *</span><input name="unit" required minLength={2} placeholder="Например, Атлас — школа" /></label>
        <label className="ahProcurementWideField"><span>Что требуется *</span><input name="itemName" required minLength={4} placeholder="Товар, оборудование или услуга" /></label>
        <label><span>Количество *</span><input name="quantity" type="number" min="1" step="1" required defaultValue="1" /></label>
        <label><span>Бюджет, ₽ *</span><input name="budgetRubles" type="number" min="0.01" step="0.01" required /></label>
        <label><span>Нужно до *</span><input name="needBy" type="date" required /></label>
        <label className="ahProcurementWideField"><span>Обоснование *</span><textarea name="justification" required minLength={8} placeholder="Зачем нужна закупка и какой результат ожидается" /></label>
      </div>
      <footer><Button variant="secondary" onClick={close}>Отмена</Button><Button type="submit" variant="primary" disabled={busy || !entities.length}>{busy ? "Сохраняем…" : "Создать заявку"}</Button></footer>
    </form>
  </div>, document.body);
}

function PurchaseApprovalModal({ requestId, entities, busy, close, save }: {
  requestId: string;
  entities: Array<[string, string]>;
  busy: boolean;
  close: () => void;
  save: (approverEntityId: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  return createPortal(<div className="ahProcurementModalLayer">
    <button className="ahProcurementModalScrim" type="button" onClick={close} aria-label="Закрыть согласование" />
    <form className="ahProcurementModal ahProcurementModalCompact" onSubmit={(event) => { event.preventDefault(); void save(value); }}>
      <header><div><p>{requestId}</p><h2>Согласовать заявку</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
      <label><span>Согласующий *</span><select value={value} onChange={(event) => setValue(event.target.value)} required><option value="">Выберите руководителя</option>{entities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <p className="ahProcurementModalNote">Согласование фиксируется в истории с выбранным сотрудником и текущим пользователем.</p>
      <footer><Button variant="secondary" onClick={close}>Отмена</Button><Button type="submit" variant="primary" disabled={busy || !value}>{busy ? "Сохраняем…" : "Подтвердить согласование"}</Button></footer>
    </form>
  </div>, document.body);
}
