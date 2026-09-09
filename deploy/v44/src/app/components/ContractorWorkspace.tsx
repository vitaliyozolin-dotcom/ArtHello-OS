"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EntityPanel } from "./RegistryWorkspace";
import styles from "./ContractorWorkspace.module.css";

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

const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

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

  if (state === "loading") return <section className={`page ${styles.workspace}`}><div className={styles.state}>Строим реестр по фактическим списаниям…</div></section>;
  if (state === "error" || !data) return <section className={`page ${styles.workspace}`}><div className={styles.state}><strong>Реестр оплат временно недоступен</strong><button onClick={() => void load()}>Повторить</button></div></section>;

  return <section className={`page ${styles.workspace}`}>
    <div className="page-heading">
      <div><p className="eyebrow">Только реестр оплат</p><h1>Подрядчики</h1><p>Карточка появляется после первого подтверждённого списания. Другие разделы не создают подрядчиков.</p></div>
      <button className="primary-action" onClick={onOpenFinance}>Открыть операции</button>
    </div>
    <div className={styles.boundary}><strong>ЕДИНСТВЕННЫЙ ИСТОЧНИК</strong><span>{data.boundary}</span></div>
    <div className={styles.kpis}>
      <article><span>Контрагентов</span><strong>{data.summary.contractors}</strong><small>по списаниям</small></article>
      <article><span>Операций</span><strong>{data.summary.payments}</strong><small>подтверждённый реестр</small></article>
      <article><span>Сумма</span><strong>{rub.format(data.summary.totalMinor / 100)}</strong><small>за доступный период</small></article>
      <article><span>Есть договор</span><strong>{data.summary.withContract}</strong><small>по ссылке операции</small></article>
    </div>
    <div className={styles.toolbar}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти по ID, статье или договору" /><span>{visible.length} записей</span></div>
    {visible.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Контрагент</th><th>Категории</th><th>Платежи</th><th>Последний</th><th>Договоры</th><th>Сумма</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id} tabIndex={0} onClick={() => setSelectedId(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(row.id); }}><td><strong>{row.displayName}</strong><small>{row.id} · {row.dataQuality}</small></td><td>{row.categories.slice(0, 2).join(" · ")}</td><td>{row.paymentCount}</td><td>{new Date(`${row.lastPaymentAt}T00:00:00Z`).toLocaleDateString("ru-RU")}</td><td>{row.contracts.length ? row.contracts.join(", ") : "Не указан"}</td><td><strong>{rub.format(row.totalMinor / 100)}</strong></td></tr>)}</tbody></table></div> : <div className={styles.state}><strong>Подрядчиков пока нет</strong><span>Они появятся автоматически после загрузки первой подтверждённой банковской операции.</span><button onClick={onOpenFinance}>Проверить реестр оплат</button></div>}
    {selectedId ? <EntityPanel entityId={selectedId} close={() => setSelectedId("")} notify={notify} onNavigate={setSelectedId} readOnly initialTab="overview" /> : null}
  </section>;
}
