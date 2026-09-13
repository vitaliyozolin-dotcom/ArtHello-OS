"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./AcquiringWorkspace.ds.css";

type PaymentRequest = {
  id: string;
  obligationId: string;
  amountMinor: number;
  currency: string;
  paymentLinkId: string;
  status: string;
  recipientLabel: string;
  receiptStatus: string;
  createdAt: string;
  updatedAt: string;
  branchId: string;
  purpose: string;
  studentName: string;
  payerName: string;
  hasProviderLink: boolean;
};

type AcquiringData = {
  requests: PaymentRequest[];
  summary: {
    paymentRequestCount: number;
    activePaymentRequestCount: number;
    paidPaymentCount: number;
    paidMinor: number;
    refundCount: number;
    refundedMinor: number;
    receiptReadyCount: number;
    receiptPendingCount: number;
  };
  capabilities: { canOpenPay: boolean };
  boundary: string;
};

const tabs = ["Обзор", "Ссылки и оплаты", "Чеки"] as const;
type Tab = typeof tabs[number];

const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const paidStatuses = new Set(["paid", "captured", "succeeded", "completed"]);
const refundStatuses = new Set(["refunded", "partially_refunded"]);

function money(value: number, currency = "RUB") {
  if (currency === "RUB") return rub.format(value / 100);
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value / 100)} ${currency}`;
}

function dateTime(value: string) {
  if (!value) return "Дата не указана";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function paymentStatus(value: string) {
  const labels: Record<string, string> = {
    ready: "Ссылка готова",
    link_creating: "Ссылка создаётся",
    waiting: "Ожидает оплаты",
    authorized: "Оплата авторизована",
    paid: "Оплачено",
    captured: "Оплачено",
    succeeded: "Оплачено",
    completed: "Оплачено",
    cancelled: "Отменено",
    refunded: "Возвращено",
    partially_refunded: "Частичный возврат",
  };
  return labels[value] || "Статус уточняется";
}

function receiptStatus(value: string) {
  const labels: Record<string, string> = {
    expected: "Чек ожидается",
    ready: "Чек готов",
    issued: "Чек сформирован",
    sent: "Чек отправлен",
    fiscalized: "Фискализирован",
  };
  return labels[value] || "Статус чека уточняется";
}

export function AcquiringWorkspace({ notify }: { notify: (value: string) => void }) {
  const [data, setData] = useState<AcquiringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Обзор");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/acquiring", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as AcquiringData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Эквайринг недоступен");
      setData(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Эквайринг недоступен");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredRequests = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    if (!needle || !data) return data?.requests ?? [];
    return data.requests.filter((item) => [
      item.purpose,
      item.studentName,
      item.payerName,
      item.recipientLabel,
      paymentStatus(item.status),
    ].some((value) => value.toLocaleLowerCase("ru-RU").includes(needle)));
  }, [data, query]);

  function openPay(destination: "create-link" | "payment-register") {
    if (!data?.capabilities.canOpenPay) {
      notify("Доступ к ArtHello Pay выдаётся владельцем в разделе «Доступы».");
      return;
    }
    const target = new URL("/api/pay-sso/open", window.location.origin);
    target.searchParams.set("action", destination === "create-link" ? "invoice" : "payment");
    window.location.assign(target.toString());
  }

  const actions = <div className="ahAcquiringActions">
    <Button variant="secondary" onClick={() => openPay("payment-register")}>Реестр платежей</Button>
    <Button variant="primary" onClick={() => openPay("create-link")}>Создать ссылку на оплату</Button>
  </div>;

  if (loading) return <PageContainer className="ahAcquiringPage"><PageHeader eyebrow="Ссылки · оплаты · возвраты · чеки" title="Эквайринг" description="Загружаем эквайринговые операции." actions={actions} /><Card className="ahAcquiringState">Получаем данные эквайринга…</Card></PageContainer>;
  if (error || !data) return <PageContainer className="ahAcquiringPage"><PageHeader eyebrow="Ссылки · оплаты · возвраты · чеки" title="Эквайринг" description="Клиентские оплаты ArtHello." /><Card><EmptyState density="compact" title="Эквайринг временно недоступен" description={error || "Не удалось получить данные"} action={<Button variant="secondary" onClick={() => void load()}>Повторить</Button>} /></Card></PageContainer>;

  const receiptRequests = data.requests.filter((item) => item.receiptStatus);

  return <PageContainer className="ahAcquiringPage">
    <PageHeader
      eyebrow="Ссылки · оплаты · возвраты · чеки"
      title="Эквайринг"
      description="Только операции приёма оплаты. Банковские счета и остатки находятся в разделе «Деньги»."
      actions={actions}
    />

    <Card className="ahAcquiringBoundary"><span className="ahAcquiringLive" aria-hidden="true" /><div><strong>Единая граница разделов зафиксирована</strong><p>{data.boundary}</p></div><button type="button" onClick={() => openPay("payment-register")}>Открыть ArtHello Pay</button></Card>

    <section className="ahAcquiringKpis" aria-label="Показатели эквайринга">
      <KpiCard label="Ссылки на оплату" value={data.summary.paymentRequestCount} note={`${data.summary.activePaymentRequestCount} активных`} onClick={() => setTab("Ссылки и оплаты")} />
      <KpiCard label="Успешные оплаты" value={data.summary.paidPaymentCount} note={money(data.summary.paidMinor)} onClick={() => setTab("Ссылки и оплаты")} />
      <KpiCard label="Возвраты" value={data.summary.refundCount} note={money(data.summary.refundedMinor)} onClick={() => setTab("Ссылки и оплаты")} />
      <KpiCard label="Готовые чеки" value={data.summary.receiptReadyCount} note={`${data.summary.receiptPendingCount} ожидают`} onClick={() => setTab("Чеки")} />
    </section>

    <div className="ahAcquiringTabs"><Tabs<Tab> items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы эквайринга" /></div>

    {tab === "Обзор" ? <div className="ahAcquiringOverview">
      <Card className="ahAcquiringPanel">
        <PanelHead eyebrow="Последние события" title="Ссылки и оплаты" meta={`${data.requests.length} операций`} />
        {data.requests.length ? <PaymentList requests={data.requests.slice(0, 8)} /> : <EmptyState density="compact" title="Эквайринговых операций пока нет" description="Создайте ссылку в ArtHello Pay. Банковские движения сюда не подмешиваются." action={<Button variant="primary" onClick={() => openPay("create-link")}>Создать ссылку на оплату</Button>} />}
        {data.requests.length > 8 ? <button className="ahAcquiringTextAction" type="button" onClick={() => setTab("Ссылки и оплаты")}>Показать все операции</button> : null}
      </Card>
      <Card className="ahAcquiringPanel">
        <PanelHead eyebrow="Источник" title="ArtHello Pay" meta="Отдельный рабочий модуль" />
        <div className="ahAcquiringScopeList">
          <p><strong>Здесь:</strong> ссылки, статусы оплат, возвраты и чеки.</p>
          <p><strong>В «Деньгах»:</strong> счета, остатки, банковские операции и синхронизация.</p>
          <p><strong>Вход администратора:</strong> только через ArtHello OS и отдельный доступ Pay.</p>
        </div>
        <Button variant="primary" onClick={() => openPay("payment-register")}>Перейти в ArtHello Pay</Button>
      </Card>
    </div> : null}

    {tab === "Ссылки и оплаты" ? <Card className="ahAcquiringPanel">
      <PanelHead eyebrow="Эквайринговый реестр" title="Все ссылки и оплаты" meta={`${filteredRequests.length} операций`} />
      <label className="ahAcquiringSearch"><span>Поиск</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Плательщик, ребёнок, назначение или статус" /></label>
      {filteredRequests.length ? <PaymentList requests={filteredRequests} detailed /> : <EmptyState density="compact" title={query ? "Ничего не найдено" : "Операций пока нет"} description={query ? "Измените запрос или очистите поиск." : "Новая ссылка появится после её создания в ArtHello Pay."} />}
    </Card> : null}

    {tab === "Чеки" ? <Card className="ahAcquiringPanel">
      <PanelHead eyebrow="Фискальные статусы" title="Чеки по оплатам" meta={`${data.summary.receiptReadyCount} готово`} />
      {receiptRequests.length ? <PaymentList requests={receiptRequests} detailed showReceipt /> : <EmptyState density="compact" title="Чеков пока нет" description="Статусы чеков появятся только у реальных эквайринговых операций; банковские выписки здесь не учитываются." />}
    </Card> : null}
  </PageContainer>;
}

function PanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return <header className="ahAcquiringPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{meta}</span></header>;
}

function PaymentList({ requests, detailed = false, showReceipt = false }: { requests: PaymentRequest[]; detailed?: boolean; showReceipt?: boolean }) {
  return <div className="ahAcquiringOperations">{requests.map((item) => {
    const paid = paidStatuses.has(item.status);
    const refunded = refundStatuses.has(item.status);
    return <article key={item.id}>
      <div className={`ahAcquiringDirection ${refunded ? "debit" : "credit"}`}>{refunded ? "↩" : paid ? "✓" : "↗"}</div>
      <div className="ahAcquiringOperationMain"><strong>{item.studentName || item.payerName || item.purpose || "Ссылка на оплату"}</strong><p>{item.purpose || "Назначение не указано"}</p>{detailed ? <small>{item.recipientLabel} · {item.hasProviderLink ? "Ссылка банка создана" : "Ожидает подключения провайдера"}</small> : null}</div>
      <div className="ahAcquiringOperationMeta"><strong className={refunded ? "debit" : "credit"}>{money(item.amountMinor, item.currency)}</strong><span>{showReceipt ? receiptStatus(item.receiptStatus) : paymentStatus(item.status)}</span><small>{dateTime(item.createdAt)}</small></div>
    </article>;
  })}</div>;
}
