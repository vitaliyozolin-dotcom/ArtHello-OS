"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityPanel } from "./RegistryWorkspace";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, SearchField } from "./design-system";
import "./ContractorWorkspace.ds.css";

type Contractor = {
  id: string;
  displayName: string;
  dataQuality: string;
  paymentCount: number;
  totalMinor: number;
  firstPaymentAt: string;
  lastPaymentAt: string;
  categories: string[];
  contracts: string[];
  documents: string[];
  sourceSystems: string[];
};

type Data = {
  contractors: Contractor[];
  summary: { contractors: number; payments: number; totalMinor: number; withContract: number };
  boundary: string;
};

const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function formatDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("ru-RU");
}

export function ContractorWorkspace({ notify, onOpenFinance }: {
  notify: (value: string) => void;
  onOpenFinance: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/contractors", { cache: "no-store" });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase("ru-RU");
    if (!data || !clean) return data?.contractors ?? [];
    return data.contractors.filter((row) => [row.id, row.displayName, ...row.categories, ...row.contracts]
      .some((value) => value.toLocaleLowerCase("ru-RU").includes(clean)));
  }, [data, query]);

  if (state === "loading") {
    return <PageContainer className="ahContractorPage">
      <PageHeader eyebrow="Оплаты · контрагенты · договоры" title="Подрядчики" description="Формируем реестр по подтверждённым банковским списаниям." />
      <Card className="ahContractorStatus" role="status">Строим реестр по фактическим списаниям…</Card>
    </PageContainer>;
  }

  if (state === "error" || !data) {
    return <PageContainer className="ahContractorPage">
      <PageHeader eyebrow="Оплаты · контрагенты · договоры" title="Подрядчики" description="Единый реестр получателей подтверждённых оплат." />
      <Card className="ahContractorStatus">
        <EmptyState
          title="Реестр оплат временно недоступен"
          description="Повторите загрузку. Существующие данные при этом не изменяются."
          action={<Button variant="primary" onClick={() => void load()}>Повторить</Button>}
        />
      </Card>
    </PageContainer>;
  }

  return <PageContainer className="ahContractorPage">
    <PageHeader
      eyebrow="Оплаты · контрагенты · договоры"
      title="Подрядчики"
      description="Карточка появляется после первого подтверждённого списания. Другие разделы не создают подрядчиков."
      actions={<Button variant="primary" onClick={onOpenFinance}>Открыть операции</Button>}
    />

    <Card className="ahContractorSource">
      <strong>Единственный источник</strong>
      <span>{data.boundary}</span>
    </Card>

    <section className="ahContractorKpis" aria-label="Показатели подрядчиков">
      <KpiCard label="Контрагентов" value={data.summary.contractors} note="по списаниям" />
      <KpiCard label="Операций" value={data.summary.payments} note="подтверждённый реестр" />
      <KpiCard label="Сумма" value={rub.format(data.summary.totalMinor / 100)} note="за доступный период" />
      <KpiCard label="Есть договор" value={data.summary.withContract} note="по ссылке операции" />
    </section>

    <Card className="ahContractorRegistry">
      <div className="ahContractorToolbar">
        <SearchField
          label="Поиск подрядчика"
          value={query}
          onChange={setQuery}
          placeholder="Найти по ID, статье или договору"
        />
        <span className="ahContractorCount" aria-live="polite">{visible.length} {visible.length === 1 ? "запись" : "записей"}</span>
      </div>

      {visible.length ? <>
        <div className="ahContractorTableWrap">
          <table className="ahContractorTable">
            <thead><tr><th>Контрагент</th><th>Категории</th><th>Платежи</th><th>Последний</th><th>Договоры</th><th>Сумма</th></tr></thead>
            <tbody>{visible.map((row) => <tr key={row.id} tabIndex={0} onClick={() => setSelectedId(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(row.id); }}>
              <td><strong>{row.displayName}</strong><small>{row.id} · {row.dataQuality}</small></td>
              <td>{row.categories.slice(0, 2).join(" · ") || "Не указаны"}</td>
              <td>{row.paymentCount}</td>
              <td>{formatDate(row.lastPaymentAt)}</td>
              <td>{row.contracts.length ? row.contracts.join(", ") : "Не указан"}</td>
              <td><strong>{rub.format(row.totalMinor / 100)}</strong></td>
            </tr>)}</tbody>
          </table>
        </div>

        <div className="ahContractorMobileList" aria-label="Подрядчики">
          {visible.map((row) => <button type="button" className="ahContractorMobileCard" data-ah-compact-card="true" key={row.id} onClick={() => setSelectedId(row.id)}>
            <span className="ahContractorMobileHead"><strong>{row.displayName}</strong><b>{rub.format(row.totalMinor / 100)}</b></span>
            <span className="ahContractorMobileMeta">{row.id} · {row.dataQuality}</span>
            <span className="ahContractorMobileGrid"><span><small>Операций</small><strong>{row.paymentCount}</strong></span><span><small>Последний платёж</small><strong>{formatDate(row.lastPaymentAt)}</strong></span></span>
            <span className="ahContractorMobileMeta">{row.contracts.length ? `Договоры: ${row.contracts.join(", ")}` : "Договор не указан"}</span>
          </button>)}
        </div>
      </> : <EmptyState
        density="compact"
        title="Подрядчиков пока нет"
        description="Они появятся автоматически после загрузки первой подтверждённой банковской операции."
        action={<Button variant="primary" onClick={onOpenFinance}>Проверить реестр оплат</Button>}
      />}
    </Card>

    {selectedId ? <EntityPanel entityId={selectedId} close={() => setSelectedId("")} notify={notify} onNavigate={setSelectedId} readOnly initialTab="overview" /> : null}
  </PageContainer>;
}
