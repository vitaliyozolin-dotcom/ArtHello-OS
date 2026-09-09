"use client";

import { useEffect, useState } from "react";
import styles from "./FamilyAlfaBalances.module.css";

export type FamilyAlfaBalance = {
  customerId: string; remoteBranchId: string; branchName: string;
  balanceMinor: number | null; observedAt: string | null; source: string;
  currency: null; status: "available" | "unconfirmed";
  refreshUnconfirmed: boolean;
};

export function FamilyAlfaBalanceRows({ balances }: { balances: FamilyAlfaBalance[] }) {
  return <section className={styles.card} aria-label="Остатки AlfaCRM">
    <header><span>Остатки AlfaCRM</span></header>
    <p>Последний подтверждённый денежный остаток клиента. Дата получения указана для каждого счёта.</p>
    {!balances.length ? <p>Остаток не получен. Подключите AlfaCRM и выполните выбранный импорт остатков в разделе «Интеграции».</p> : balances.map((row) => {
      const known = row.status === "available" && Number.isSafeInteger(row.balanceMinor)
        && row.observedAt !== null && Number.isFinite(Date.parse(row.observedAt));
      return <article key={JSON.stringify([row.remoteBranchId, row.customerId])}>
        <strong>{row.branchName} · клиент №{row.customerId}</strong>
        <span className={styles.amount}>{known ? new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(row.balanceMinor! / 100) : "Не подтверждён"}</span>
        <span>Источник: AlfaCRM</span>
        {known ? <time dateTime={row.observedAt!}>Получено {new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(row.observedAt!))} МСК</time> : null}
        {known && row.refreshUnconfirmed ? <span>Последнее обновление не подтверждено. Показан предыдущий подтверждённый остаток.</span> : null}
      </article>;
    })}
    <p>Валюта в данных AlfaCRM не указана. Эти остатки учитываются отдельно от банковских платежей и не суммируются между счетами.</p>
  </section>;
}

export function FamilyAlfaBalances({ familyId }: { familyId: string }) {
  const [result, setResult] = useState<{ familyId: string; balances: FamilyAlfaBalance[] } | null>(null);
  const [errorFamilyId, setErrorFamilyId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/families/alfacrm-balances?familyId=${encodeURIComponent(familyId)}`, { cache: "no-store", signal: controller.signal });
        if ([401, 403, 404].includes(response.status)) {
          if (!controller.signal.aborted) { setResult(null); setErrorFamilyId(null); }
          return;
        }
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json() as { familyId: string; balances: FamilyAlfaBalance[] };
        if (data.familyId !== familyId || !Array.isArray(data.balances)) throw new Error("invalid");
        if (!controller.signal.aborted) { setResult(data); setErrorFamilyId(null); }
      } catch { if (!controller.signal.aborted) setErrorFamilyId(familyId); }
    })();
    return () => controller.abort();
  }, [familyId]);
  if (errorFamilyId === familyId) return <section className={styles.card}><header><span>Остатки AlfaCRM</span></header><p>Данные временно недоступны. Закройте и снова откройте карточку, чтобы повторить проверку.</p></section>;
  return result?.familyId === familyId ? <FamilyAlfaBalanceRows balances={result.balances} /> : null;
}
