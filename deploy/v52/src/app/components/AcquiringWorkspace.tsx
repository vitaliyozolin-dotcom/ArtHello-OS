"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./AcquiringWorkspace.ds.css";

type Account = {
  id: string;
  provider: string;
  legalEntityId: string;
  legalEntityName: string;
  maskedAccount: string;
  name: string;
  currency: string;
  status: string;
  balanceMinor: number | null;
  balanceAsOf: string;
  syncedAt: string;
};

type Operation = {
  id: string;
  provider: string;
  accountName: string;
  maskedAccount: string;
  legalEntityName: string;
  operationDate: string;
  direction: string;
  amountMinor: number;
  currency: string;
  status: string;
  documentNumber: string;
  transactionType: string;
  description: string;
  counterpartyName: string;
  importedAt: string;
  allocated: boolean;
};

type Synchronization = {
  id: string;
  system: string;
  status: string;
  enabled: boolean;
  verified: boolean;
  lastSuccessAt: string;
  nextSyncAt: string;
  receivedCount: number;
  acceptedCount: number;
  errorCount: number;
};

type AcquiringData = {
  accounts: Account[];
  operations: Operation[];
  synchronization: Synchronization[];
  summary: {
    accountCount: number;
    accountsWithBalance: number;
    rubBalanceMinor: number;
    statementCount: number;
    transactionCount: number;
    incomingMinor: number;
    outgoingMinor: number;
    latestSyncAt: string;
    paymentRequestCount: number;
    activePaymentRequestCount: number;
  };
  capabilities: { canOpenPay: boolean };
  boundary: string;
};

const tabs = ["Обзор", "Операции", "Счета", "Синхронизация"] as const;
type Tab = typeof tabs[number];

const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

function money(value: number | null, currency = "RUB") {
  if (value === null) return "Остаток не получен";
  if (currency === "RUB") return rub.format(value / 100);
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value / 100)} ${currency}`;
}

function dateTime(value: string) {
  if (!value) return "Нет успешной синхронизации";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function incoming(direction: string) {
  return /credit|incoming|приход|поступ|вход/i.test(direction);
}

export function AcquiringWorkspace({ notify, onOpenIntegrations }: {
  notify: (value: string) => void;
  onOpenIntegrations: () => void;
}) {
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

  const filteredOperations = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    if (!needle || !data) return data?.operations ?? [];
    return data.operations.filter((operation) => [
      operation.counterpartyName,
      operation.description,
      operation.documentNumber,
      operation.accountName,
      operation.maskedAccount,
      operation.legalEntityName,
    ].some((value) => value.toLocaleLowerCase("ru-RU").includes(needle)));
  }, [data, query]);

  function openPay(action: "invoice" | "payment") {
    if (!data?.capabilities.canOpenPay) {
      notify("Доступ к ArtHello Pay выдаётся владельцем в разделе «Доступы».");
      return;
    }
    const target = new URL("/api/pay-sso/open", window.location.origin);
    target.searchParams.set("action", action);
    window.location.assign(target.toString());
  }

  const actions = <div className="ahAcquiringActions">
    <Button variant="secondary" onClick={() => openPay("invoice")}>Новый счёт</Button>
    <Button variant="primary" onClick={() => openPay("payment")}>Оплата</Button>
  </div>;

  if (loading) return <PageContainer className="ahAcquiringPage"><PageHeader eyebrow="Банк · операции · платёжные ссылки" title="Эквайринг" description="Загружаем счета и последнюю подтверждённую синхронизацию." actions={actions} /><Card className="ahAcquiringState">Получаем банковские данные…</Card></PageContainer>;
  if (error || !data) return <PageContainer className="ahAcquiringPage"><PageHeader eyebrow="Банк · операции · платёжные ссылки" title="Эквайринг" description="Центральный банковский контур ArtHello." /><Card><EmptyState density="compact" title="Эквайринг временно недоступен" description={error || "Не удалось получить данные"} action={<Button variant="secondary" onClick={() => void load()}>Повторить</Button>} /></Card></PageContainer>;

  return <PageContainer className="ahAcquiringPage">
    <PageHeader
      eyebrow="Банк · операции · платёжные ссылки"
      title="Эквайринг"
      description="Счета юридических лиц, остатки, банковские операции и контроль синхронизации. Выставление ссылок вынесено в отдельный ArtHello Pay."
      actions={actions}
    />

    <Card className="ahAcquiringBoundary"><span className="ahAcquiringLive" aria-hidden="true" /><div><strong>Банковский контур подключён на чтение</strong><p>{data.boundary}</p></div><button type="button" onClick={onOpenIntegrations}>Настройки подключения</button></Card>

    <section className="ahAcquiringKpis" aria-label="Показатели эквайринга">
      <KpiCard label="Остаток по счетам" value={money(data.summary.rubBalanceMinor)} note={`${data.summary.accountsWithBalance} из ${data.summary.accountCount} счетов с остатком`} onClick={() => setTab("Счета")} />
      <KpiCard label="Банковские операции" value={data.summary.transactionCount} note={`${data.summary.statementCount} выписок загружено`} onClick={() => setTab("Операции")} />
      <KpiCard label="Входящие" value={money(data.summary.incomingMinor)} note="по загруженным операциям" onClick={() => setTab("Операции")} />
      <KpiCard label="Ссылки на оплату" value={data.summary.paymentRequestCount} note={`${data.summary.activePaymentRequestCount} активных`} onClick={() => openPay("payment")} />
    </section>

    <div className="ahAcquiringTabs"><Tabs<Tab> items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы эквайринга" /></div>

    {tab === "Обзор" ? <div className="ahAcquiringOverview">
      <Card className="ahAcquiringPanel">
        <PanelHead eyebrow="Счета" title="Актуальные остатки" meta={`Обновлено ${dateTime(data.summary.latestSyncAt)}`} />
        {data.accounts.length ? <div className="ahAcquiringAccountGrid">{data.accounts.map((account) => <AccountCard key={account.id} account={account} />)}</div> : <EmptyState density="compact" title="Счета ещё не получены" description="Проверьте состояние Точки в центре интеграций." action={<Button variant="secondary" onClick={onOpenIntegrations}>Открыть интеграции</Button>} />}
      </Card>
      <Card className="ahAcquiringPanel">
        <PanelHead eyebrow="Последние движения" title="Банковские операции" meta={`${data.operations.length} в текущем окне`} />
        {data.operations.length ? <OperationList operations={data.operations.slice(0, 8)} /> : <EmptyState density="compact" title="Операций пока нет" description="Остатки уже могут быть доступны, даже если выписка ещё не содержит движений." />}
        {data.operations.length > 8 ? <button className="ahAcquiringTextAction" type="button" onClick={() => setTab("Операции")}>Показать все операции</button> : null}
      </Card>
    </div> : null}

    {tab === "Операции" ? <Card className="ahAcquiringPanel">
      <PanelHead eyebrow="Выписка" title="Все загруженные операции" meta={`${filteredOperations.length} строк`} />
      <label className="ahAcquiringSearch"><span>Поиск</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Контрагент, назначение, номер документа или счёт" /></label>
      {filteredOperations.length ? <OperationList operations={filteredOperations} detailed /> : <EmptyState density="compact" title={query ? "Ничего не найдено" : "Операций пока нет"} description={query ? "Измените запрос или очистите поиск." : "Новые проведённые операции появятся после банковской синхронизации."} />}
    </Card> : null}

    {tab === "Счета" ? <Card className="ahAcquiringPanel">
      <PanelHead eyebrow="Юридические лица" title="Банковские счета и остатки" meta={`${data.accounts.length} счетов`} />
      {data.accounts.length ? <div className="ahAcquiringAccountGrid ahAcquiringAccountGridWide">{data.accounts.map((account) => <AccountCard key={account.id} account={account} detailed />)}</div> : <EmptyState density="compact" title="Счета ещё не получены" description="Откройте настройки банковской интеграции и проверьте статус подключения." />}
    </Card> : null}

    {tab === "Синхронизация" ? <Card className="ahAcquiringPanel">
      <PanelHead eyebrow="Только чтение" title="Синхронизация с банками" meta={`Последние данные ${dateTime(data.summary.latestSyncAt)}`} />
      {data.synchronization.length ? <div className="ahAcquiringSyncList">{data.synchronization.map((item) => <article key={item.id}>
        <div><span className={item.errorCount ? "isError" : item.verified ? "isReady" : "isWaiting"} /><strong>{item.system}</strong><small>{item.id}</small></div>
        <dl><div><dt>Статус</dt><dd>{item.status}</dd></div><div><dt>Последний успех</dt><dd>{dateTime(item.lastSuccessAt)}</dd></div><div><dt>Следующий запуск</dt><dd>{dateTime(item.nextSyncAt)}</dd></div><div><dt>Принято</dt><dd>{item.acceptedCount} из {item.receivedCount}</dd></div></dl>
      </article>)}</div> : <EmptyState density="compact" title="Банковские подключения не найдены" description="Подключения настраиваются владельцем в центре интеграций." />}
      <div className="ahAcquiringSyncFooter"><p>Автосинхронизация загружает счета, остатки, выписки и проведённые операции. Платёжные поручения она не создаёт.</p><Button variant="secondary" onClick={onOpenIntegrations}>Открыть интеграции</Button></div>
    </Card> : null}
  </PageContainer>;
}

function PanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return <header className="ahAcquiringPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{meta}</span></header>;
}

function AccountCard({ account, detailed = false }: { account: Account; detailed?: boolean }) {
  return <article className="ahAcquiringAccount">
    <header><div><span>{account.provider}</span><strong>{account.name}</strong></div><em>{account.status}</em></header>
    <div className="ahAcquiringBalance">{money(account.balanceMinor, account.currency)}</div>
    <p>{account.legalEntityName}</p>
    <footer><span>{account.maskedAccount || "Номер скрыт"}</span><small>{detailed ? `Остаток на ${account.balanceAsOf || "дату банка"} · синхронизация ${dateTime(account.syncedAt)}` : dateTime(account.syncedAt)}</small></footer>
  </article>;
}

function OperationList({ operations, detailed = false }: { operations: Operation[]; detailed?: boolean }) {
  return <div className="ahAcquiringOperations">{operations.map((operation) => {
    const credit = incoming(operation.direction);
    return <article key={operation.id}>
      <div className={`ahAcquiringDirection ${credit ? "credit" : "debit"}`}>{credit ? "↓" : "↑"}</div>
      <div className="ahAcquiringOperationMain"><strong>{operation.counterpartyName || operation.description || "Банковская операция"}</strong><p>{operation.description || operation.transactionType || "Без назначения"}</p>{detailed ? <small>{operation.legalEntityName} · {operation.accountName} {operation.maskedAccount}</small> : null}</div>
      <div className="ahAcquiringOperationMeta"><strong className={credit ? "credit" : "debit"}>{credit ? "+" : "−"}{money(Math.abs(operation.amountMinor), operation.currency)}</strong><span>{operation.operationDate}</span><small>{operation.allocated ? "Разнесено" : "Ожидает разнесения"}</small></div>
    </article>;
  })}</div>;
}
