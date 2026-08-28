"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Card,
  CompactListCard,
  EmptyState,
  KpiCard,
  PageContainer,
  PageHeader,
  SearchField,
  Tabs,
} from "./design-system";
import "./LegalWorkspace.ds.css";

type Data = {
  contracts: Array<{ id: string; referenceDocumentId: string; contractType: string; partyType: string; partyEntityId: string; number: string; signedStatus: string; validFrom: string; validUntil: string; limitMinor: number; spentMinor: number; status: string; electronicSignatureStatus: string; requisiteStatus: string; ownerEntityId: string; closingRequired: boolean; utilization: number }>;
  documents: Array<{ id: string; stableId: string; contractId: string; itemType: string; title: string; version: number; required: boolean; signedStatus: string; status: string; dueDate: string; reference: string }>;
  zones: Array<{ id: string; contractId: string; zone: string; responsibleEntityId: string; scope: string; status: string }>;
  checks: Array<{ id: string; contractId: string; signalType: string; severity: string; evidence: string; recommendation: string; status: string; relatedTaskId: number | null; resolution: string }>;
  entityNames: Record<string, string>;
  tasks: Array<{ id: number; sourceId: string; status: string }>;
  summary: { contracts: number; unsigned: number; expiring: number; openSignals: number; missingRequired: number };
  chain: { partyId: string; contractId: string; documentId: string; appendixId: string; actId: string; zoneId: string; signalId: string };
  boundary: string;
};

const codes: Record<string, string> = {
  "Собственник": "OWNER",
  "Директор": "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
  "Юрист": "LEGAL",
  "HR": "HR",
  "Финансы": "FINANCE",
  "Продажи": "SALES",
  "Маркетинг": "MARKETING",
  "Педагог": "TEACHER",
  "Методист": "METHODIST",
  "Родитель": "PARENT",
};

const tabs = ["Реестр", "Документы", "Контроль", "Ответственность", "Сквозная цепочка"] as const;
type Tab = (typeof tabs)[number];
const tabItems = tabs.map((id) => ({ id, label: id }));
const rub = (value: number) => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
}).format(value / 100);

export function LegalWorkspace({
  role,
  notify,
  onTasksChanged,
  onOpenIntegrations,
  focusId,
}: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
  onOpenIntegrations: () => void;
  focusId?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Реестр");
  const [busy, setBusy] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/legal", {
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

  useEffect(() => {
    if (!focusId) return;
    const timer = window.setTimeout(() => setTab("Реестр"), 0);
    return () => window.clearTimeout(timer);
  }, [focusId]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/legal-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": codes[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Результат уже существует" : "Юридическое действие сохранено");
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
    return <PageContainer className="ahLegalPage">
      <PageHeader
        eyebrow="Документы и обязательства"
        title="Юридический контур"
        description="Договоры, версии, сроки и закрывающие документы."
      />
      <Card className="ahLegalStatus"><span role="status">Загружаем юридический контур…</span></Card>
    </PageContainer>;
  }

  if (error || !data) {
    return <PageContainer className="ahLegalPage">
      <PageHeader
        eyebrow="Документы и обязательства"
        title="Юридический контур"
        description="Договоры, версии, сроки и закрывающие документы."
      />
      <Card className="ahLegalStateCard">
        <EmptyState
          density="compact"
          title={error || "Юридический контур недоступен"}
          description="Договоры, ставки и сигналы доступны только юридической и управленческой ролям."
          action={<Button variant="primary" onClick={() => void load()}>Повторить</Button>}
        />
      </Card>
    </PageContainer>;
  }

  const hasData = Boolean(data.contracts.length || data.documents.length || data.checks.length || data.zones.length);

  const chainContract = data.contracts.find((contract) => contract.id === data.chain.contractId);
  const chainSteps: Array<[string, string, string | undefined]> = [
    ["Сторона", data.chain.partyId, data.entityNames[data.chain.partyId]],
    ["Договор", data.chain.contractId, chainContract?.number],
    ["Документ", data.chain.documentId, "v2 · истекает"],
    ["Приложение", data.chain.appendixId, "подписано"],
    ["Зона ответственности", data.chain.zoneId, "приёмка работ"],
    ["Обязательство", data.chain.actId, "акт до 31 августа"],
    ["Сигнал", data.chain.signalId, "акт отсутствует"],
    ["Действие", "LEGAL_SIGNAL:SIG-LGL-T-002", "идемпотентная задача"],
  ];

  return <PageContainer className="ahLegalPage">
    <PageHeader
      eyebrow="Этап 9 · документы до обязательства"
      title="Юридический контур"
      description="Договоры, версии, сроки, лимиты и закрывающие документы с доказательными сигналами."
      actions={<>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>+ Договор</Button>
        <Button variant="secondary" onClick={onOpenIntegrations}>Подключить ЭДО</Button>
      </>}
    />

    <Card className="ahLegalBoundary">
      <strong>Без обвинений</strong>
      <span>{data.boundary}</span>
    </Card>

    <section className="ahLegalKpis" aria-label="Показатели юридического контура">
      <KpiCard label="Договоры" value={data.summary.contracts} note={`${data.summary.unsigned} не подписан`} onClick={() => setTab("Реестр")} />
      <KpiCard label="Истекают" value={data.summary.expiring} note="требуют решения владельца" onClick={() => setTab("Контроль")} />
      <KpiCard className="ahLegalKpiWarning" label="Нет обязательных" value={data.summary.missingRequired} note="акт или закрывающий пакет" onClick={() => setTab("Документы")} />
      <KpiCard className="ahLegalKpiDanger" label="Открытые сигналы" value={data.summary.openSignals} note="до доказательства" onClick={() => setTab("Контроль")} />
    </section>

    <div className="ahLegalTabs">
      <Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel="Разделы юридического контура" />
    </div>

    {tab === "Реестр" ? <LegalRegistry contracts={data.contracts} names={data.entityNames} focusId={focusId} openDocuments={() => setTab("Документы")} /> : null}

    {tab === "Документы" ? <Card className="ahLegalPanel ahLegalDocuments">
      <LegalPanelHead eyebrow="Комплектность" title="Приложения, акты, согласия, инструкции и журналы" meta="append-only версии" />
      {data.documents.length ? <div className="ahLegalDocumentTableWrap">
        <table className="ahLegalDocumentTable">
          <thead><tr><th>ID</th><th>Тип</th><th>Документ</th><th>Версия</th><th>Подпись</th><th>Статус</th><th>Срок</th><th /></tr></thead>
          <tbody>{data.documents.map((document) => <tr key={document.id} data-ah-compact-card="true">
            <td data-label="ID">{document.stableId}</td>
            <td data-label="Тип">{document.itemType}</td>
            <td data-label="Документ"><strong>{document.title}</strong><small>{document.contractId}</small></td>
            <td data-label="Версия">v{document.version}</td>
            <td data-label="Подпись">{document.signedStatus}</td>
            <td data-label="Статус"><span className={document.status === "Отсутствует" ? "isMissing" : ""}>{document.status}</span></td>
            <td data-label="Срок">{document.dueDate || "—"}</td>
            <td className="ahLegalDocumentAction"><Button className="ahLegalInlineButton" variant="secondary" disabled={busy === document.id} onClick={() => void action({ action: "createDocumentVersion", stableId: document.stableId, reference: `Основание проверки ${new Date().toISOString().slice(0, 10)}` }, document.id)}>+ версия</Button></td>
          </tr>)}</tbody>
        </table>
      </div> : <EmptyState density="compact" title="Документов пока нет" description="Приложения и закрывающие документы появятся после добавления договора." />}
    </Card> : null}

    {tab === "Контроль" ? data.checks.length ? <div className="ahLegalSignalGrid">
      {data.checks.map((check) => <Card key={check.id} className="ahLegalSignal">
        <header className="ahLegalSignalHeader"><span>{check.signalType}</span><em data-severity={check.severity}>{check.severity}</em></header>
        <h2>{check.id}</h2>
        <p>{check.evidence}</p>
        <div className="ahLegalRecommendation"><strong>Рекомендуемое действие</strong><span>{check.recommendation}</span></div>
        <footer className="ahLegalSignalFooter">
          <em>{check.status}</em>
          {check.status === "Закрыт" ? <small>{check.resolution}</small> : check.relatedTaskId ? <span>Задача TSK-{check.relatedTaskId}</span> : <Button className="ahLegalSmallButton" variant="secondary" disabled={busy === check.id} onClick={() => void action({ action: "createSignalTask", signalId: check.id }, check.id)}>+ Задача на проверку</Button>}
        </footer>
      </Card>)}
    </div> : <Card className="ahLegalStateCard"><EmptyState density="compact" title="Сигналов пока нет" description="Контрольные сигналы появятся после проверки документов и сроков." /></Card> : null}

    {tab === "Ответственность" ? data.zones.length ? <div className="ahLegalZoneGrid">
      {data.zones.map((zone) => <Card key={zone.id} className="ahLegalZone">
        <span className="ahLegalZoneId">{zone.id}</span>
        <h2>{zone.zone}</h2>
        <p>{zone.scope}</p>
        <dl>
          <div><dt>Договор</dt><dd>{zone.contractId}</dd></div>
          <div><dt>Ответственный</dt><dd>{data.entityNames[zone.responsibleEntityId] ?? zone.responsibleEntityId}</dd></div>
          <div><dt>Статус</dt><dd>{zone.status}</dd></div>
        </dl>
      </Card>)}
    </div> : <Card className="ahLegalStateCard"><EmptyState density="compact" title="Зоны ответственности не назначены" description="Они появятся после связи договора с владельцем обязательства." /></Card> : null}

    {tab === "Сквозная цепочка" ? hasData ? <div className="ahLegalChainLayout">
      <Card className="ahLegalPanel ahLegalChain">
        <LegalPanelHead eyebrow="Приёмочный маршрут" title="От стороны до управляемого сигнала" meta="CHAIN STATUS · PASS" />
        <div className="ahLegalChainSteps">
          {chainSteps.map(([label, id, detail], index) => <CompactListCard
            key={`${label}-${id}`}
            className="ahLegalChainStep"
            index={String(index + 1).padStart(2, "0")}
            title={id || "—"}
            description={`${label}${detail ? ` · ${detail}` : ""}`}
          />)}
        </div>
      </Card>
      <Card className="ahLegalPanel ahLegalProof">
        <LegalPanelHead eyebrow="Контроль решения" title="Только документы и факты" meta="ИИ не обвиняет" />
        <blockquote>«Возможный конфликт» означает совпадение проверяемого признака. Это приглашение сверить полномочия и документы, а не вывод о человеке или подрядчике.</blockquote>
        <dl>
          <div><dt>Лимит</dt><dd>{rub(chainContract?.limitMinor ?? 0)}</dd></div>
          <div><dt>Расход</dt><dd>{rub(chainContract?.spentMinor ?? 0)}</dd></div>
          <div><dt>Отклонение</dt><dd>{rub((chainContract?.spentMinor ?? 0) - (chainContract?.limitMinor ?? 0))}</dd></div>
          <div><dt>Закрывающий</dt><dd>Отсутствует</dd></div>
        </dl>
      </Card>
    </div> : <Card className="ahLegalStateCard"><EmptyState density="compact" title="Сквозная цепочка ещё не собрана" description="Сторона, договор, документ, обязательство и сигнал появятся только после сохранения реальных данных." /></Card> : null}

    {createOpen ? <ContractModal
      busy={busy === "create-contract"}
      close={() => setCreateOpen(false)}
      save={async (body) => {
        const saved = await action({ ...body, action: "createContract" }, "create-contract");
        if (saved) {
          setCreateOpen(false);
          setTab("Реестр");
        }
      }}
    /> : null}
  </PageContainer>;
}

function ContractModal({
  busy,
  close,
  save,
}: {
  busy: boolean;
  close: () => void;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(Object.fromEntries(new FormData(event.currentTarget).entries()));
  }

  return createPortal(<div className="modal-layer ahLegalCreateLayer">
    <button className="drawer-scrim" type="button" onClick={close} aria-label="Закрыть форму" />
    <form className="task-modal ahLegalCreateModal" onSubmit={submit}>
      <div className="drawer-head"><div><p>Юридический контур</p><h2>Добавить договор</h2></div><button type="button" onClick={close}>×</button></div>
      <div className="ahLegalCreateGrid">
        <label><span>Сторона договора *</span><input name="partyName" required minLength={3} placeholder="Наименование организации или ФИО" /></label>
        <label><span>Тип стороны</span><select name="partyType" defaultValue="Контрагент"><option>Контрагент</option><option>Клиент</option><option>Сотрудник</option><option>Подрядчик</option><option>Поставщик</option><option>Арендодатель</option></select></label>
        <label><span>Тип договора</span><select name="contractType" defaultValue="Договор"><option>Договор</option><option>Клиентский договор</option><option>Трудовой договор</option><option>Договор поставки</option><option>Договор подряда</option><option>Договор аренды</option></select></label>
        <label><span>Номер *</span><input name="number" required minLength={2} placeholder="Например, 14/26" /></label>
        <label><span>Действует с *</span><input type="date" name="validFrom" required /></label>
        <label><span>Действует до *</span><input type="date" name="validUntil" required /></label>
        <label><span>Сумма или лимит, ₽</span><input type="number" min="0" step="0.01" name="limitRubles" defaultValue="0" /></label>
        <label><span>Подпись</span><select name="signedStatus" defaultValue="Не подписан"><option>Не подписан</option><option>Подписан</option><option>На согласовании</option></select></label>
      </div>
      <label className="ahLegalClosingCheck"><input type="checkbox" name="closingRequired" /><span>Требуются закрывающие документы</span></label>
      <div className="access-separation"><strong>Ручной ввод требует проверки</strong><span>Система создаст сторону, договор и версию v1. Электронная подпись и реквизиты не считаются подтверждёнными до отдельной сверки.</span></div>
      <div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить договор"}</button></div>
    </form>
  </div>, document.body);
}

function LegalPanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return <header className="ahLegalPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{meta}</span></header>;
}

function LegalRegistry({
  contracts,
  names,
  focusId,
  openDocuments,
}: {
  contracts: Data["contracts"];
  names: Record<string, string>;
  focusId?: string;
  openDocuments: () => void;
}) {
  const [filter, setFilter] = useState("Все");
  const [query, setQuery] = useState("");
  const filters = ["Все", "Клиенты", "Сотрудники", "Подрядчики и поставщики", "Аренда и партнёры", "Прочие"];
  const normalized = query.trim().toLocaleLowerCase("ru");
  const visible = useMemo(() => contracts.filter((contract) => {
    if (filter !== "Все" && partyGroup(contract.partyType, contract.contractType) !== filter) return false;
    if (!normalized) return true;
    return [
      contract.id,
      contract.referenceDocumentId,
      contract.partyEntityId,
      names[contract.partyEntityId] ?? "",
      contract.contractType,
      contract.partyType,
      contract.number,
      contract.signedStatus,
      contract.status,
    ].some((value) => value.toLocaleLowerCase("ru").includes(normalized));
  }), [contracts, filter, names, normalized]);

  return <Card className="ahLegalRegistry">
    <div className="ahLegalRegistryToolbar">
      <SearchField label="Поиск договора" value={query} onChange={setQuery} placeholder="Найти сторону, номер или документ" />
      <span className="ahLegalRegistryCount" aria-live="polite">{visible.length} {visible.length === 1 ? "запись" : "записей"}</span>
    </div>
    <div className="ahLegalRegistryFilters" aria-label="Фильтр документов">
      <span className="ahLegalFilterLabel">Фильтр документов</span>
      {filters.map((item) => <button type="button" key={item} className={filter === item ? "isActive" : ""} onClick={() => setFilter(item)}>
        {item}<b>{contracts.filter((contract) => item === "Все" || partyGroup(contract.partyType, contract.contractType) === item).length}</b>
      </button>)}
    </div>
    {visible.length ? <div className="ahLegalRegistryTable">
      <div className="ahLegalRegistryHead"><span>Сторона / документ</span><span>Категория</span><span>Срок</span><span>Сумма / лимит</span><span>Подпись</span><span>Статус</span></div>
      {visible.map((contract) => <button
        type="button"
        key={contract.id}
        onClick={openDocuments}
        aria-label={`Открыть документы договора ${contract.number}`}
        data-ah-compact-card="true"
        className={`ahLegalRegistryRow${focusId && [contract.id, contract.referenceDocumentId, contract.partyEntityId].includes(focusId) ? " isFocused" : ""}`}
      >
        <span className="ahLegalRegistryCell ahLegalRegistryPrimary" data-label="Сторона / документ"><strong>{names[contract.partyEntityId] ?? contract.partyEntityId}</strong><small>{contract.contractType} № {contract.number} · {contract.referenceDocumentId}</small></span>
        <span className="ahLegalRegistryCell" data-label="Категория"><strong>{partyGroup(contract.partyType, contract.contractType)}</strong><small>{contract.partyType}</small></span>
        <span className="ahLegalRegistryCell" data-label="Срок"><strong>{contract.validUntil}</strong><small>с {contract.validFrom}</small></span>
        <span className="ahLegalRegistryCell" data-label="Сумма / лимит"><strong>{contract.limitMinor ? rub(contract.limitMinor) : "Без лимита"}</strong><small className={contract.utilization > 100 ? "isOver" : ""}>{contract.limitMinor ? `использовано ${contract.utilization}%` : "сумма в документе"}</small></span>
        <span className="ahLegalRegistryCell" data-label="Подпись"><strong className={contract.signedStatus === "Подписан" ? "isOk" : "isBad"}>{contract.signedStatus}</strong><small>{contract.electronicSignatureStatus}</small></span>
        <span className="ahLegalRegistryCell" data-label="Статус"><strong>{contract.status}</strong><small>{contract.requisiteStatus}</small></span>
      </button>)}
    </div> : <EmptyState density="compact" title="Документы не найдены" description={query ? "Измените строку поиска или выберите другую категорию." : "В этой категории документов пока нет."} />}
  </Card>;
}

function partyGroup(partyType: string, contractType: string) {
  const value = `${partyType} ${contractType}`.toLowerCase();
  if (value.includes("сем") || value.includes("клиент")) return "Клиенты";
  if (value.includes("сотруд")) return "Сотрудники";
  if (value.includes("подряд") || value.includes("постав")) return "Подрядчики и поставщики";
  if (value.includes("аренд") || value.includes("партн")) return "Аренда и партнёры";
  return "Прочие";
}
