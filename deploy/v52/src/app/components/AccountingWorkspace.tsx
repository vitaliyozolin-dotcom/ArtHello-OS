"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { currentAccountingPeriod, rublesToMinorUnits } from "../../lib/accounting";
import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";
import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./AccountingWorkspace.ds.css";

type AccountingDocument = {
  id: string;
  documentType: string;
  number: string;
  documentDate: string;
  counterpartyEntityId: string;
  contractId: string;
  amountMinor: number;
  vatMinor: number;
  paymentOperationId: string;
  fileRef: string;
  signatureStatus: string;
  edoStatus: string;
  sourceType: string;
  status: string;
};

type Data = {
  documents: AccountingDocument[];
  links: Array<{ id: string; fromDocumentId: string; toDocumentId: string; relationType: string; evidence: string }>;
  checks: Array<{ id: string; operationId: string; contractId: string; requiredTypes: string[]; missingTypes: string[]; ownerEntityId: string; status: string; relatedTaskId: number | null; checkedAt: string }>;
  exports: Array<{ id: string; exportType: string; period: string; documentCount: number; amountMinor: number; status: string; fileRef: string; createdBy: string; createdAt: string }>;
  integrations: Array<{ id: string; system: string; mode: string; status: string; truth: string; lastSuccessAt: string; nextAttemptAt: string; recordCount: number; error: string }>;
  entityNames: Record<string, string>;
  counterparties: Array<{ id: string; displayName: string; entityType: string }>;
  operations: Record<string, { amountMinor: number; counterpartyEntityId: string; operationDate: string; sourceSystem: string }>;
  summary: { documents: number; linked: number; unsigned: number; incomplete: number; totalMinor: number };
  chain: Record<string, string>;
  boundary: string;
};

const roles: Record<string, string> = {
  "Бухгалтерия": "ACCOUNTING",
  "Медработник": "MEDICAL",
  "Собственник": "OWNER",
  "Директор": "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
  "Безопасность": "SAFETY",
  "Финансы": "FINANCE",
  "Кухня": "KITCHEN",
  "Закупки": "PROCUREMENT",
  "Юрист": "LEGAL",
  "HR": "HR",
  "Продажи": "SALES",
  "Маркетинг": "MARKETING",
  "Педагог": "TEACHER",
  "Методист": "METHODIST",
  "Родитель": "PARENT",
};

const tabs = ["Первичные документы", "Комплектность", "Связь с оплатами", "ЭДО и 1С", "Выгрузки"] as const;
type Tab = typeof tabs[number];

const rub = (value: number) => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
}).format(value / 100);

export function AccountingWorkspace({
  role,
  notify,
  onTasksChanged,
  onOpenFinance,
}: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
  onOpenFinance: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("Первичные документы");
  const [busy, setBusy] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/accounting", {
        cache: "no-store",
        headers: { "x-arthello-role": roles[role] ?? "" },
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

  async function action(body: Record<string, unknown>, key: string, successMessage: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/accounting-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Запись уже существует" : successMessage);
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

  if (loading) return <PageContainer className="ahAccountingPage"><PageHeader eyebrow="Документы · оплаты · учёт" title="Бухгалтерия и первичка" description="Первичные документы и их связь с подтверждёнными операциями." /><Card className="ahAccountingState">Загружаем первичные документы…</Card></PageContainer>;
  if (error || !data) return <PageContainer className="ahAccountingPage"><PageHeader eyebrow="Документы · оплаты · учёт" title="Бухгалтерия и первичка" description="Доступ зависит от роли и выданных полномочий." /><Card className="ahAccountingState"><EmptyState density="compact" title="Бухгалтерский контур недоступен" description={error || "Доступ разрешён бухгалтерии, финансам, юристу и руководителям."} /></Card></PageContainer>;

  const counterparties = data.counterparties
    .map((item) => [item.id, item.displayName] as [string, string])
    .sort((left, right) => left[1].localeCompare(right[1], "ru"));
  const hasAccountingData = Boolean(data.documents.length || data.links.length || data.checks.length || data.exports.length);
  const currentPeriod = currentAccountingPeriod();

  async function createDocument(values: ManualDocumentValues) {
    let amountMinor: number;
    try {
      amountMinor = rublesToMinorUnits(values.amountRub);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Проверьте сумму документа");
      return;
    }
    const saved = await action({
      action: "createDocument",
      documentType: values.documentType,
      number: values.number,
      documentDate: values.documentDate,
      counterpartyEntityId: values.counterpartyEntityId,
      contractId: values.contractId,
      amountMinor,
    }, "new", "Первичный документ сохранён");
    if (saved) {
      setCreateOpen(false);
      setTab("Первичные документы");
    }
  }

  return <>
    <PageContainer className="ahAccountingPage">
      <PageHeader
        eyebrow="Документы · оплаты · учёт"
        title="Бухгалтерия и первичка"
        description="Счета, акты, накладные, чеки и УПД — с комплектностью, подписью и связью до операции."
        actions={<Button variant="primary" disabled={busy === "new"} onClick={() => setCreateOpen(true)}>+ Добавить документ</Button>}
      />

      {!hasAccountingData ? <Card className="ahAccountingEmpty"><EmptyState
        density="compact"
        title="Первичных документов пока нет"
        description={counterparties.length ? "Добавьте первый документ вручную. После сохранения останутся доступны комплектность, связь с оплатами, ЭДО и выгрузки." : "Сначала создайте карточку контрагента в «Единых карточках», затем добавьте документ."}
        action={<Button variant="primary" onClick={() => setCreateOpen(true)}>Добавить первый документ</Button>}
      /></Card> : null}
      <>
        <Card className="ahAccountingBoundary"><strong>Рабочий контур</strong><span>{data.boundary}</span></Card>
        <section className="ahAccountingKpis" aria-label="Показатели бухгалтерского контура">
          <KpiCard label="Документы" value={data.summary.documents} note={rub(data.summary.totalMinor)} onClick={() => setTab("Первичные документы")} />
          <KpiCard label="Связаны с оплатой" value={data.summary.linked} note={`из ${data.summary.documents}`} onClick={() => setTab("Связь с оплатами")} />
          <KpiCard className="ahAccountingKpiWarning" label="Не комплектно" value={data.summary.incomplete} note="по открытым проверкам" onClick={() => setTab("Комплектность")} />
          <KpiCard className="ahAccountingKpiWarning" label="Подпись на проверке" value={data.summary.unsigned} note="ожидает подтверждения" onClick={() => setTab("ЭДО и 1С")} />
        </section>
        <div className="ahAccountingTabs">
          <Tabs<Tab> items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы бухгалтерского контура" />
        </div>

        {tab === "Первичные документы" ? <article className="ahAccountingPanel ahCard">
          <Head p="Единый реестр" h="Первичные документы" s={`${data.documents.length} записей`} />
          {data.documents.length ? <div className="ahAccountingTable"><table><thead><tr><th>Документ</th><th>Дата</th><th>Контрагент</th><th>Договор</th><th>Сумма</th><th>Подпись</th><th>Оплата</th><th>Статус</th></tr></thead><tbody>
            {data.documents.map((document) => <tr key={document.id} data-ah-compact-card="true">
              <td data-label="Документ"><strong>{recordLabel(document.documentType, document.number || document.id)}</strong><small>от {document.documentDate}</small></td>
              <td data-label="Дата">{document.documentDate}</td>
              <td data-label="Контрагент">{data.entityNames[document.counterpartyEntityId] || recordLabel("Контрагент", document.counterpartyEntityId)}</td>
              <td data-label="Договор">{document.contractId ? recordLabel("Договор", document.contractId) : "—"}</td>
              <td data-label="Сумма">{rub(document.amountMinor)}</td>
              <td data-label="Подпись">{document.signatureStatus === "На проверке" ? <button disabled={busy === document.id} onClick={() => void action({ action: "confirmSignature", documentId: document.id, evidence: "Реквизиты и подпись сверены бухгалтером по оригиналу" }, document.id, "Подпись подтверждена")}>Подтвердить</button> : document.signatureStatus}</td>
              <td data-label="Оплата">{document.paymentOperationId ? recordLabel("Операция", document.paymentOperationId) : "Не связана"}</td>
              <td data-label="Статус"><span>{document.status}</span></td>
            </tr>)}
          </tbody></table></div> : <EmptyState density="compact" title="Документов пока нет" description="Добавьте первый первичный документ — строка появится в реестре после сохранения." />}
        </article> : null}

        {tab === "Комплектность" ? data.checks.length ? <div className="ahAccountingChecks">{data.checks.map((check) => <article key={check.id} className="ahAccountingPanel ahCard" data-ah-compact-card="true">
          <Head p={check.operationId ? recordLabel("Операция", check.operationId) : "Без операции"} h={check.contractId ? recordLabel("Договор", check.contractId) : "Без договора"} s={check.status} />
          <div className="ahAccountingDocumentSet"><div><small>Требуется</small>{check.requiredTypes.map((type) => <span key={type}>{type}</span>)}</div><div><small>Отсутствует</small>{check.missingTypes.length ? check.missingTypes.map((type) => <strong key={type}>{type}</strong>) : <em>Комплект полный</em>}</div></div>
          <footer><span>Проверено {check.checkedAt.slice(0, 10)} · {data.entityNames[check.ownerEntityId] || "Ответственный не назначен"}</span>{check.relatedTaskId ? <b>{taskRecordLabel(check.relatedTaskId)}</b> : check.missingTypes.length ? <button disabled={busy === check.id} onClick={() => void action({ action: "createMissingTask", checkId: check.id }, check.id, "Задача создана")}>Создать задачу</button> : null}</footer>
        </article>)}</div> : <Card className="ahAccountingInlineEmpty"><EmptyState density="compact" title="Проверок комплектности пока нет" description="Проверки появятся после добавления первичных документов и их связи с договором." /></Card> : null}

        {tab === "Связь с оплатами" ? data.documents.length || data.links.length ? <div className="ahAccountingChain">
          <article className="ahAccountingPanel ahCard"><Head p="Проверяемая цепочка" h="Счёт → акт → договор → платёж" s="до источника" /><ol>
            <li><span>Счёт</span><strong>{data.chain.invoiceId ? recordLabel("Счёт", data.chain.invoiceId) : "Не связан"}</strong></li>
            <li><span>Акт</span><strong>{data.chain.actId ? recordLabel("Акт", data.chain.actId) : "Не связан"}</strong></li>
            <li><span>Договор</span><strong>{data.chain.contractId ? recordLabel("Договор", data.chain.contractId) : "Не связан"}</strong></li>
            <li><span>Операция</span><strong>{data.chain.paymentId ? recordLabel("Операция", data.chain.paymentId) : "Не связана"}</strong></li>
            <li><span>Источник</span><strong>{data.chain.paymentId ? "Финансовый реестр" : "—"}</strong></li>
          </ol><button onClick={onOpenFinance}>Открыть в финансах</button></article>
          <article className="ahAccountingPanel ahCard"><Head p="Связи документов" h="Основание сопоставления" s={`${data.links.length} связи`} />{data.links.length ? <div className="ahAccountingLinks">{data.links.map((link) => <article key={link.id} data-ah-compact-card="true"><strong>{recordLabel("Документ", link.fromDocumentId)}</strong><span>→</span><strong>{recordLabel("Запись", link.toDocumentId)}</strong><p>{link.relationType} · {humanTechnicalText(link.evidence)}</p></article>)}</div> : <EmptyState density="compact" title="Связей пока нет" description="Основание сопоставления появится после связи документа с подтверждённой оплатой." />}</article>
        </div> : <Card className="ahAccountingInlineEmpty"><EmptyState density="compact" title="Связей с оплатами пока нет" description="Сначала добавьте первичный документ. Затем его можно будет связать с подтверждённой операцией." /></Card> : null}

        {tab === "ЭДО и 1С" ? data.integrations.length ? <div className="ahAccountingIntegrationGrid">{data.integrations.map((integration) => <article key={integration.id} className="ahAccountingPanel ahCard" data-ah-compact-card="true"><header><span>{integration.system}</span><em>{integration.status}</em></header><h2>{humanTechnicalText(integration.mode)}</h2><p>{humanTechnicalText(integration.truth)}</p><dl><div><dt>Последний успех</dt><dd>{integration.lastSuccessAt || "Не было"}</dd></div><div><dt>Записей</dt><dd>{integration.recordCount}</dd></div></dl><footer>{humanTechnicalText(integration.error)}</footer></article>)}</div> : <Card className="ahAccountingInlineEmpty"><EmptyState density="compact" title="Интеграции не подключены" description="Первичку можно вести вручную. Подключение ЭДО и учётной системы добавим отдельно." /></Card> : null}

        {tab === "Выгрузки" ? <div className="ahAccountingChain">
          <article className="ahAccountingPanel ahCard ahAccountingExportCreate"><Head p="Контролируемый файл" h="Пакет для 1С" s="без отправки" /><p>Создаётся проверяемый реестр. Передачи в 1С и изменения учёта нет.</p><button disabled={busy === "export"} onClick={() => void action({ action: "prepareExport", period: currentPeriod }, "export", "Реестр подготовлен")}>Подготовить выгрузку за {humanPeriodLabel(currentPeriod)}</button></article>
          <article className="ahAccountingPanel ahCard"><Head p="История" h="Подготовленные пакеты" s={`${data.exports.length} записей`} />{data.exports.length ? <div className="ahAccountingExportList">{data.exports.map((item) => <article key={item.id} data-ah-compact-card="true"><div><strong>{recordLabel("Пакет", item.id)}</strong><small>{humanTechnicalText(item.exportType)} · {humanPeriodLabel(item.period)}</small></div><span>{item.documentCount} док.</span><b>{rub(item.amountMinor)}</b><em>{item.status}</em></article>)}</div> : <EmptyState density="compact" title="Пакетов пока нет" description="Подготовленные реестры появятся здесь после создания первой выгрузки." />}</article>
        </div> : null}
      </>
    </PageContainer>

    {createOpen ? <ManualDocumentModal counterparties={counterparties} saving={busy === "new"} close={() => setCreateOpen(false)} submit={createDocument} /> : null}
  </>;
}

type ManualDocumentValues = {
  documentType: string;
  number: string;
  documentDate: string;
  counterpartyEntityId: string;
  contractId: string;
  amountRub: string;
};

function ManualDocumentModal({ counterparties, saving, close, submit }: {
  counterparties: Array<[string, string]>;
  saving: boolean;
  close: () => void;
  submit: (values: ManualDocumentValues) => Promise<void>;
}) {
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as ManualDocumentValues;
    await submit(values);
  }

  return createPortal(<div className="modal-layer registry-modal-layer ahAccountingModalLayer">
    <button className="drawer-scrim" type="button" onClick={close} aria-label="Закрыть форму" />
    <form className="task-modal registry-modal ahAccountingModal" onSubmit={(event) => void onSubmit(event)}>
      <div className="drawer-head ahAccountingModalHead"><div><p>Бухгалтерия и первичка</p><h2>Добавить документ</h2></div><button type="button" onClick={close}>×</button></div>
      <div className="form-row ahAccountingFormRow">
        <label><span>Тип документа</span><select name="documentType" defaultValue="Счёт" required><option>Счёт</option><option>Акт</option><option>Накладная</option><option>УПД</option><option>Чек</option><option>Иное</option></select></label>
        <label><span>Номер документа</span><input name="number" required maxLength={80} placeholder="Например: 48/26" /></label>
      </div>
      <div className="form-row ahAccountingFormRow">
        <label><span>Дата документа</span><input type="date" name="documentDate" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label><span>Сумма, ₽</span><input type="number" name="amountRub" min="0.01" step="0.01" inputMode="decimal" required placeholder="0,00" /></label>
      </div>
      <label><span>Контрагент</span><select name="counterpartyEntityId" defaultValue="" required><option value="" disabled>{counterparties.length ? "Выберите карточку" : "Сначала создайте карточку контрагента"}</option>{counterparties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label><span>Договор, если есть</span><input name="contractId" maxLength={80} placeholder="Номер существующего договора" /></label>
      <div className="merge-warning ahAccountingNotice"><strong>Номер и источник назначит система</strong><span>Документ будет сохранён как ручной ввод с постоянным рабочим номером. Договор проверяется по юридическому реестру.</span></div>
      <div className="modal-actions ahAccountingModalActions"><button type="button" onClick={close}>Отмена</button><button type="submit" disabled={saving || !counterparties.length}>{saving ? "Сохраняем…" : "Сохранить документ"}</button></div>
    </form>
  </div>, document.body);
}

function Head({ p, h, s }: { p: string; h: string; s: string }) {
  return <header className="ahAccountingPanelHead"><div><p>{p}</p><h2>{h}</h2></div><span>{s}</span></header>;
}
