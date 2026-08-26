"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { currentAccountingPeriod, rublesToMinorUnits } from "../../lib/accounting";

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

  if (loading) return <section className="accounting-state">Загружаем первичные документы…</section>;
  if (error || !data) return <section className="accounting-state"><strong>{error}</strong><small>Доступ разрешён бухгалтерии, финансам, юристу, руководителям и Представителю.</small></section>;

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
    <section className="page accounting-workspace">
      <div className="accounting-heading">
        <div>
          <p className="eyebrow">Документы и учёт</p>
          <h1>Бухгалтерия и первичка</h1>
          <p>Счета, акты, накладные, чеки и УПД — с комплектностью, подписью и связью до операции.</p>
        </div>
        <button className="primary-action" disabled={busy === "new"} onClick={() => setCreateOpen(true)}>+ Добавить документ</button>
      </div>

      {!hasAccountingData ? <div className="manual-module-empty">
        <span>＋</span>
        <h2>Документов пока нет</h2>
        <p>{counterparties.length ? "Добавьте первый первичный документ вручную. Его рабочий ID назначит система." : "Сначала создайте карточку контрагента в «Единых карточках», затем добавьте документ."}</p>
        <button type="button" onClick={() => setCreateOpen(true)}>Добавить первый документ</button>
      </div> : <>
        <div className="accounting-boundary"><strong>РАБОЧИЙ КОНТУР</strong><span>{data.boundary}</span></div>
        <div className="accounting-kpis">
          <button onClick={() => setTab("Первичные документы")}><span>Документы</span><strong>{data.summary.documents}</strong><small>{rub(data.summary.totalMinor)}</small></button>
          <button onClick={() => setTab("Связь с оплатами")}><span>Связаны с оплатой</span><strong>{data.summary.linked}</strong><small>из {data.summary.documents}</small></button>
          <button className="warn" onClick={() => setTab("Комплектность")}><span>Не комплектно</span><strong>{data.summary.incomplete}</strong><small>по открытым проверкам</small></button>
          <button className="warn" onClick={() => setTab("ЭДО и 1С")}><span>Подпись на проверке</span><strong>{data.summary.unsigned}</strong><small>ожидает подтверждения</small></button>
        </div>
        <div className="accounting-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>

        {tab === "Первичные документы" ? <article className="accounting-panel">
          <Head p="Единый реестр" h="Первичные документы" s={`${data.documents.length} записей`} />
          <div className="accounting-table"><table><thead><tr><th>Документ</th><th>Дата</th><th>Контрагент</th><th>Договор</th><th>Сумма</th><th>Подпись</th><th>Оплата</th><th>Статус</th></tr></thead><tbody>
            {data.documents.map((document) => <tr key={document.id}>
              <td><strong>{document.documentType} · {document.number}</strong><small>{document.id}</small></td>
              <td>{document.documentDate}</td>
              <td>{data.entityNames[document.counterpartyEntityId] || document.counterpartyEntityId}</td>
              <td>{document.contractId || "—"}</td>
              <td>{rub(document.amountMinor)}</td>
              <td>{document.signatureStatus === "На проверке" ? <button disabled={busy === document.id} onClick={() => void action({ action: "confirmSignature", documentId: document.id, evidence: "Реквизиты и подпись сверены бухгалтером по оригиналу" }, document.id, "Подпись подтверждена")}>Подтвердить</button> : document.signatureStatus}</td>
              <td>{document.paymentOperationId || "Не связана"}</td>
              <td><span>{document.status}</span></td>
            </tr>)}
          </tbody></table></div>
        </article> : null}

        {tab === "Комплектность" ? <div className="accounting-checks">{data.checks.map((check) => <article key={check.id} className="accounting-panel">
          <Head p={check.operationId || "Без операции"} h={check.contractId || "Без договора"} s={check.status} />
          <div className="document-set"><div><small>Требуется</small>{check.requiredTypes.map((type) => <span key={type}>{type}</span>)}</div><div><small>Отсутствует</small>{check.missingTypes.length ? check.missingTypes.map((type) => <strong key={type}>{type}</strong>) : <em>Комплект полный</em>}</div></div>
          <footer><span>Проверено {check.checkedAt.slice(0, 10)} · {check.ownerEntityId || "Ответственный не назначен"}</span>{check.relatedTaskId ? <b>TSK-{check.relatedTaskId}</b> : check.missingTypes.length ? <button disabled={busy === check.id} onClick={() => void action({ action: "createMissingTask", checkId: check.id }, check.id, "Задача создана")}>Создать задачу</button> : null}</footer>
        </article>)}</div> : null}

        {tab === "Связь с оплатами" ? <div className="accounting-chain">
          <article className="accounting-panel"><Head p="Проверяемая цепочка" h="Счёт → акт → договор → платёж" s="до источника" /><ol>
            <li><span>Счёт</span><strong>{data.chain.invoiceId || "Не связан"}</strong></li>
            <li><span>Акт</span><strong>{data.chain.actId || "Не связан"}</strong></li>
            <li><span>Договор</span><strong>{data.chain.contractId || "Не связан"}</strong></li>
            <li><span>Операция</span><strong>{data.chain.paymentId || "Не связана"}</strong></li>
            <li><span>Источник</span><strong>{data.operations[data.chain.paymentId]?.sourceSystem || "—"}</strong></li>
          </ol><button onClick={onOpenFinance}>Открыть в финансах</button></article>
          <article className="accounting-panel"><Head p="Связи документов" h="Основание сопоставления" s={`${data.links.length} связи`} /><div className="accounting-links">{data.links.map((link) => <article key={link.id}><strong>{link.fromDocumentId}</strong><span>→</span><strong>{link.toDocumentId}</strong><p>{link.relationType} · {link.evidence}</p></article>)}</div></article>
        </div> : null}

        {tab === "ЭДО и 1С" ? data.integrations.length ? <div className="integration-status-grid">{data.integrations.map((integration) => <article key={integration.id} className="accounting-panel"><header><span>{integration.system}</span><em>{integration.status}</em></header><h2>{integration.mode}</h2><p>{integration.truth}</p><dl><div><dt>Последний успех</dt><dd>{integration.lastSuccessAt || "Не было"}</dd></div><div><dt>Записей</dt><dd>{integration.recordCount}</dd></div></dl><footer>{integration.error}</footer></article>)}</div> : <div className="manual-module-empty"><span>↔</span><h2>Интеграции не подключены</h2><p>Первичку можно вести вручную. Подключение ЭДО и учётной системы добавим отдельно.</p></div> : null}

        {tab === "Выгрузки" ? <div className="accounting-chain">
          <article className="accounting-panel export-create"><Head p="Контролируемый файл" h="Пакет для 1С" s="без отправки" /><p>Создаётся проверяемый реестр. Передачи в 1С и изменения учёта нет.</p><button disabled={busy === "export"} onClick={() => void action({ action: "prepareExport", period: currentPeriod }, "export", "Реестр подготовлен")}>Подготовить выгрузку за {currentPeriod}</button></article>
          <article className="accounting-panel"><Head p="История" h="Подготовленные пакеты" s={`${data.exports.length} записей`} /><div className="export-list">{data.exports.map((item) => <article key={item.id}><div><strong>{item.id}</strong><small>{item.exportType} · {item.period}</small></div><span>{item.documentCount} док.</span><b>{rub(item.amountMinor)}</b><em>{item.status}</em></article>)}</div></article>
        </div> : null}
      </>}
    </section>

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

  return createPortal(<div className="modal-layer registry-modal-layer">
    <button className="drawer-scrim" type="button" onClick={close} aria-label="Закрыть форму" />
    <form className="task-modal registry-modal" onSubmit={(event) => void onSubmit(event)}>
      <div className="drawer-head"><div><p>Бухгалтерия и первичка</p><h2>Добавить документ</h2></div><button type="button" onClick={close}>×</button></div>
      <div className="form-row">
        <label><span>Тип документа</span><select name="documentType" defaultValue="Счёт" required><option>Счёт</option><option>Акт</option><option>Накладная</option><option>УПД</option><option>Чек</option><option>Иное</option></select></label>
        <label><span>Номер документа</span><input name="number" required maxLength={80} placeholder="Например: 48/26" /></label>
      </div>
      <div className="form-row">
        <label><span>Дата документа</span><input type="date" name="documentDate" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label><span>Сумма, ₽</span><input type="number" name="amountRub" min="0.01" step="0.01" inputMode="decimal" required placeholder="0,00" /></label>
      </div>
      <label><span>Контрагент</span><select name="counterpartyEntityId" defaultValue="" required><option value="" disabled>{counterparties.length ? "Выберите карточку" : "Сначала создайте карточку контрагента"}</option>{counterparties.map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}</select></label>
      <label><span>Договор, если есть</span><input name="contractId" maxLength={80} placeholder="ID существующего договора" /></label>
      <div className="merge-warning"><strong>ID и источник назначит система</strong><span>Документ будет сохранён как ручной ввод с постоянным рабочим ID. Договор проверяется по юридическому реестру.</span></div>
      <div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button type="submit" disabled={saving || !counterparties.length}>{saving ? "Сохраняем…" : "Сохранить документ"}</button></div>
    </form>
  </div>, document.body);
}

function Head({ p, h, s }: { p: string; h: string; s: string }) {
  return <header className="accounting-panel-head"><div><p>{p}</p><h2>{h}</h2></div><span>{s}</span></header>;
}
