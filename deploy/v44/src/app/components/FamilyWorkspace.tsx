"use client";

import { useCallback, useEffect, useState } from "react";
import { EntityPanel } from "./RegistryWorkspace";

type Family = {
  id: string;
  displayName: string;
  status: string;
  sourceSystem: string;
  sourceRecordId: string;
  dataQuality: string;
  scope: string;
};

export function FamilyWorkspace({ notify, onOpenIntegrations }: {
  notify: (message: string) => void;
  onOpenIntegrations: () => void;
}) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedId, setSelectedId] = useState("");
  const [initialTab, setInitialTab] = useState<"overview" | "documents">("overview");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ type: "Семья" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/entities?${params}`, { cache: "no-store" });
      const payload = await response.json() as { entities?: Family[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить семьи");
      setFamilies(payload.entities ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  function open(id: string, tab: "overview" | "documents") {
    setInitialTab(tab);
    setSelectedId(id);
  }

  return <section className="page family-workspace">
    <div className="page-heading">
      <div><p className="eyebrow">Клиент 360° · отдельный справочник</p><h1>Семьи</h1><p>Семья, дети, договоры, платежи и обращения — без перехода в воронку продаж.</p></div>
      <button className="primary-action" onClick={onOpenIntegrations}>Импортировать из AlfaCRM</button>
    </div>
    <div className="family-toolbar">
      <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти семью по имени или ID" /></label>
      <strong>{families.length} семей</strong>
    </div>
    {state === "loading" ? <div className="family-state"><strong>Загружаем семьи…</strong><span>Собираем единые карточки и связи.</span></div> : null}
    {state === "error" ? <div className="family-state"><strong>Семьи временно недоступны</strong><button onClick={() => void load()}>Повторить</button></div> : null}
    {state === "ready" && !families.length ? <div className="family-state"><strong>Семей пока нет</strong><span>Подключите AlfaCRM или создайте карточку в Едином реестре.</span><button onClick={onOpenIntegrations}>Настроить AlfaCRM</button></div> : null}
    {state === "ready" && families.length ? <div className="family-grid">
      {families.map((family) => <article key={family.id}>
        <button className="family-main" onClick={() => open(family.id, "overview")}>
          <span>{family.id}</span><h2>{family.displayName}</h2><p>{family.scope}</p>
          <small>{family.sourceSystem} · {family.dataQuality}</small>
        </button>
        <footer><span>{family.status}</span><button onClick={() => open(family.id, "documents")}>Договоры →</button></footer>
      </article>)}
    </div> : null}
    {selectedId ? <EntityPanel
      key={`${selectedId}:${initialTab}`}
      entityId={selectedId}
      close={() => setSelectedId("")}
      notify={notify}
      refreshList={load}
      onNavigate={(id) => setSelectedId(id)}
      initialTab={initialTab}
    /> : null}
  </section>;
}
