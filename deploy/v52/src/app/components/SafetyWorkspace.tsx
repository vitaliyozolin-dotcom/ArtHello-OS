"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { recordLabel, taskRecordLabel } from "../../lib/record-labels";
import { Button, Card, CompactListCard, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./SafetyWorkspace.ds.css";

type SafetyData = {
  systems: Array<{ id: string; systemType: string; name: string; objectEntityId: string; schemeRef: string; journalRef: string; responsibleEntityId: string; status: string }>;
  equipment: Array<{ id: string; systemId: string; name: string; inventoryNumber: string; location: string; contractorId: string; criticality: string; nextCheckAt: string; status: string }>;
  checks: Array<{ id: string; equipmentId: string; objectEntityId: string; checkType: string; scheduledAt: string; checkedAt: string; result: string; evidence: string; responsibleEntityId: string; status: string }>;
  faults: Array<{ id: string; checkId: string; equipmentId: string; severity: string; description: string; detectedAt: string; status: string; relatedTaskId: number | null; sla: string }>;
  incidents: Array<{ id: string; objectEntityId: string; systemId: string; happenedAt: string; category: string; severity: string; description: string; response: string; status: string }>;
  repairs: Array<{ id: string; faultId: string; contractorId: string; actionType: string; startedAt: string; completedAt: string; result: string; actDocumentId: string; costMinor: number; paymentOperationId: string; status: string; payable: boolean }>;
  nextChecks: Array<{ id: string; equipmentId: string; sourceRepairId: string; scheduledAt: string; checkType: string; responsibleEntityId: string; status: string }>;
  guardShifts: Array<{ id: string; objectEntityId: string; employeeEntityId: string; post: string; startedAt: string; endedAt: string; journalRef: string; status: string }>;
  entityNames: Record<string, string>;
  summary: { systems: number; equipment: number; criticalEquipment: number; completed: number; failed: number; openFaults: number; readinessPercent: number; actsMissing: number };
  chain: Record<string, string>;
  boundary: string;
};

const roles: Record<string, string> = {
  "Собственник": "OWNER", "Директор": "DIRECTOR", "Представитель Виталия": "REPRESENTATIVE",
  "Безопасность": "SAFETY", "Финансы": "FINANCE", "Кухня": "KITCHEN", "Закупки": "PROCUREMENT",
  "Юрист": "LEGAL", "HR": "HR", "Продажи": "SALES", "Маркетинг": "MARKETING",
  "Педагог": "TEACHER", "Методист": "METHODIST", "Родитель": "PARENT",
};

const tabs = ["Контур", "Системы и оборудование", "Проверки и неисправности", "Инциденты и охрана", "Ремонты и документы"] as const;
type SafetyTab = typeof tabs[number];

const rub = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value / 100);

function namedEntity(data: SafetyData, value: string, kind: string) {
  const name = data.entityNames[value]?.trim();
  return name && !/\b[A-ZА-Я]{1,}(?:-[A-ZА-Я0-9]{1,})+\b/.test(name) ? name : value ? recordLabel(kind, value) : "Не указано";
}

function safetyChainLabel(label: string, value: string) {
  if (!value) return "Не создано";
  const kind = label === "Оплата" ? "Операция" : label === "Следующая проверка" ? "Проверка" : label;
  return recordLabel(kind, value);
}

function dateAfterDays(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function SafetyWorkspace({ role, notify, onTasksChanged, onOpenFinance }: {
  role: string;
  notify: (value: string) => void;
  onTasksChanged: () => void;
  onOpenFinance: () => void;
}) {
  const [data, setData] = useState<SafetyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SafetyTab>("Контур");
  const [busy, setBusy] = useState("");
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [repairId, setRepairId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/safety", { cache: "no-store", headers: { "x-arthello-role": roles[role] ?? "" } });
      const payload = await response.json() as SafetyData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Нет доступа");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function action(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const response = await fetch("/api/safety-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Действие уже существует" : "Запись безопасности сохранена");
      await load();
      onTasksChanged();
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Ошибка");
      return false;
    } finally {
      setBusy("");
    }
  }

  if (loading) return <section className="ahSafetyStatus">Загружаем контур безопасности…</section>;
  if (error || !data) return <section className="ahSafetyStatus"><Card><EmptyState title="Контур безопасности недоступен" description={error || "Для просмотра требуется разрешённая роль."} density="compact" /></Card></section>;

  const hasSafetyData = Boolean(data.systems.length || data.equipment.length || data.checks.length || data.faults.length || data.incidents.length || data.repairs.length || data.guardShifts.length);
  const boundary = hasSafetyData
    ? data.boundary
    : "Сначала добавьте объект, систему и оборудование. Пустой контур не создаёт фиктивные проверки или инциденты.";

  return <PageContainer className="ahSafetyPage">
    <PageHeader
      eyebrow="БЕЗОПАСНОСТЬ · ПРОВЕРКИ · ИНЦИДЕНТЫ"
      title="Безопасность объектов"
      description="Системы, оборудование, проверки, неисправности и ремонт — с доказательством до акта и оплаты."
      actions={<Button variant="primary" disabled={!data.systems.length} onClick={() => setIncidentOpen(true)}>+ Зафиксировать инцидент</Button>}
    />

    <Card className="ahSafetyBoundary">
      <strong>{hasSafetyData ? "Рабочий контур" : "Рабочая структура"}</strong>
      <span>{boundary}</span>
    </Card>

    <div className="ahSafetyKpis">
      <KpiCard label="Системы" value={data.summary.systems} note={`${data.summary.equipment} единиц оборудования`} onClick={() => setTab("Системы и оборудование")} />
      <KpiCard label="Готовность проверок" value={`${data.summary.readinessPercent}%`} note={`${data.summary.completed} завершено`} onClick={() => setTab("Проверки и неисправности")} />
      <KpiCard className="ahSafetyKpiWarning" label="Неисправности" value={data.summary.openFaults} note={`${data.summary.failed} выявлено проверками`} onClick={() => setTab("Проверки и неисправности")} />
      <KpiCard label="Нет актов" value={data.summary.actsMissing} note="оплата блокируется" onClick={() => setTab("Ремонты и документы")} />
    </div>

    <div className="ahSafetyTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы безопасности" /></div>

    {tab === "Контур" ? <SafetyOverview data={data} hasData={hasSafetyData} /> : null}
    {tab === "Системы и оборудование" ? <SafetySystems data={data} busy={busy} schedule={(equipmentId) => void action({ action: "scheduleCheck", equipmentId, scheduledAt: dateAfterDays(7) }, equipmentId)} /> : null}
    {tab === "Проверки и неисправности" ? <SafetyChecks data={data} busy={busy} createTask={(faultId) => void action({ action: "createFaultTask", faultId }, faultId)} /> : null}
    {tab === "Инциденты и охрана" ? <SafetyIncidents data={data} /> : null}
    {tab === "Ремонты и документы" ? <SafetyRepairs data={data} busy={busy} complete={setRepairId} onOpenFinance={onOpenFinance} /> : null}

    {incidentOpen ? <SafetyIncidentModal
      systems={data.systems}
      busy={busy === "incident"}
      close={() => setIncidentOpen(false)}
      save={async (body) => {
        const saved = await action({ action: "recordIncident", ...body }, "incident");
        if (saved) { setIncidentOpen(false); setTab("Инциденты и охрана"); }
      }}
    /> : null}
    {repairId ? <SafetyRepairModal
      repairId={repairId}
      entities={Object.entries(data.entityNames)}
      busy={busy === repairId}
      close={() => setRepairId("")}
      save={async (body) => {
        const saved = await action({ action: "completeRepair", repairId, ...body }, repairId);
        if (saved) setRepairId("");
      }}
    /> : null}
  </PageContainer>;
}

function SafetyOverview({ data, hasData }: { data: SafetyData; hasData: boolean }) {
  if (!hasData) return <Card className="ahSafetyPanel"><EmptyState title="Данных по безопасности пока нет" description="Добавьте объект и оборудование — вкладки, журналы и обязательная цепочка уже готовы к работе." density="compact" /></Card>;
  return <div className="ahSafetyLayout">
    <Card className="ahSafetyPanel">
      <PanelHead eyebrow="Карта риска" title="Системы по объектам" note="схема + журнал" />
      <div className="ahSafetySystemList">{data.systems.map((system, index) => <CompactListCard key={system.id} index={String(index + 1).padStart(2, "0")} title={system.name} description={`${system.systemType} · ${namedEntity(data, system.objectEntityId, "Объект")} · ${system.status}`} />)}</div>
    </Card>
    <Card className="ahSafetyPanel">
      <PanelHead eyebrow="Ближайшее действие" title="Контроль после ремонта" note={data.nextChecks[0]?.scheduledAt ?? "не назначен"} />
      <div className="ahSafetyChain">{[
        ["Оборудование", data.chain.equipmentId], ["Проверка", data.chain.checkId], ["Неисправность", data.chain.faultId],
        ["Ремонт", data.chain.repairId], ["Акт", data.chain.actId], ["Оплата", data.chain.paymentId], ["Следующая проверка", data.chain.nextCheckId],
      ].map(([label, value], index) => <CompactListCard key={label} index={String(index + 1).padStart(2, "0")} title={label} description={safetyChainLabel(label, value)} />)}</div>
    </Card>
  </div>;
}

function SafetySystems({ data, busy, schedule }: { data: SafetyData; busy: string; schedule: (equipmentId: string) => void }) {
  if (!data.systems.length) return <Card className="ahSafetyPanel"><EmptyState title="Систем и оборудования пока нет" description="Добавьте реальные инженерные и охранные системы с объектом и ответственным." density="compact" /></Card>;
  return <div className="ahSafetySystemGrid">{data.systems.map((system) => <Card key={system.id} className="ahSafetyPanel">
    <PanelHead eyebrow={system.systemType} title={system.name} note={system.status} />
    <div className="ahSafetySystemMeta"><span>Схема <strong>{system.schemeRef ? recordLabel("Схема", system.schemeRef) : "не приложена"}</strong></span><span>Журнал <strong>{system.journalRef ? recordLabel("Журнал", system.journalRef) : "не создан"}</strong></span></div>
    <div className="ahSafetyEquipmentList">{data.equipment.filter((item) => item.systemId === system.id).map((item) => <article key={item.id}>
      <div><strong>{item.name}</strong><small>{recordLabel("Имущество", item.inventoryNumber)} · {item.location}</small></div><em>{item.criticality}</em><span>{item.nextCheckAt}</span>
      <Button variant="secondary" disabled={busy === item.id} onClick={() => schedule(item.id)}>+ проверка</Button>
    </article>)}</div>
  </Card>)}</div>;
}

function SafetyChecks({ data, busy, createTask }: { data: SafetyData; busy: string; createTask: (faultId: string) => void }) {
  if (!data.checks.length && !data.faults.length) return <Card className="ahSafetyPanel"><EmptyState title="Проверки не назначены" description="План, результат, доказательство, неисправность, SLA и задача появятся после настройки оборудования." density="compact" /></Card>;
  return <div className="ahSafetyLayout">
    <Card className="ahSafetyPanel"><PanelHead eyebrow="Журнал проверок" title="План и результат" note={`${data.checks.length} записей`} /><div className="ahSafetyCheckList">{data.checks.map((check) => { const equipment = data.equipment.find((item) => item.id === check.equipmentId); return <CompactListCard key={check.id} index={check.scheduledAt.slice(5)} title={`${check.checkType} · ${equipment?.name || recordLabel("Оборудование", check.equipmentId)}`} description={`${check.result} · ${check.evidence || "без доказательства"}`} />; })}</div></Card>
    <Card className="ahSafetyPanel"><PanelHead eyebrow="Неисправности" title="Задачи и SLA" note={`${data.summary.openFaults} открыто`} /><div className="ahSafetyFaultList">{data.faults.map((fault) => <article key={fault.id}><header><strong>{recordLabel("Неисправность", fault.id)}</strong><span>{fault.severity} · {fault.sla}</span></header><p>{fault.description}</p><footer>{fault.relatedTaskId ? <span>{taskRecordLabel(fault.relatedTaskId)} · {fault.status}</span> : <Button variant="secondary" disabled={busy === fault.id} onClick={() => createTask(fault.id)}>Создать задачу</Button>}</footer></article>)}</div></Card>
  </div>;
}

function SafetyIncidents({ data }: { data: SafetyData }) {
  if (!data.incidents.length && !data.guardShifts.length) return <Card className="ahSafetyPanel"><EmptyState title="Инцидентов и смен пока нет" description="События фиксируются только по существующей системе и объекту." density="compact" /></Card>;
  return <div className="ahSafetyLayout">
    <Card className="ahSafetyPanel"><PanelHead eyebrow="Инциденты" title="Событие → реакция" note={`${data.incidents.length} записей`} /><div className="ahSafetyIncidentList">{data.incidents.map((incident) => <article key={incident.id}><header><strong>{incident.category}</strong><em>{incident.severity}</em></header><p>{incident.description}</p><small>{incident.response}</small><footer>{namedEntity(data, incident.objectEntityId, "Объект")} · {incident.status}</footer></article>)}</div></Card>
    <Card className="ahSafetyPanel"><PanelHead eyebrow="Охрана" title="Посты и смены" note="журнал" /><div className="ahSafetyGuardList">{data.guardShifts.map((shift, index) => <CompactListCard key={shift.id} index={String(index + 1).padStart(2, "0")} title={shift.post} description={`${namedEntity(data, shift.employeeEntityId, "Сотрудник")} · ${shift.startedAt.slice(11, 16)}–${shift.endedAt.slice(11, 16)} · ${shift.status}`} />)}</div></Card>
  </div>;
}

function SafetyRepairs({ data, busy, complete, onOpenFinance }: { data: SafetyData; busy: string; complete: (repairId: string) => void; onOpenFinance: () => void }) {
  if (!data.repairs.length) return <Card className="ahSafetyPanel"><EmptyState title="Ремонтов пока нет" description="Подрядчик, результат, акт, оплата и следующая проверка образуют обязательную цепочку." density="compact" /></Card>;
  return <Card className="ahSafetyPanel"><PanelHead eyebrow="Ремонты и документы" title="Закрытие неисправностей" note={`${data.repairs.length} записей`} /><div className="ahSafetyRepairTable"><table><thead><tr><th>Ремонт</th><th>Подрядчик</th><th>Стоимость</th><th>Акт</th><th>Оплата</th><th>Статус</th><th>Действие</th></tr></thead><tbody>{data.repairs.map((repair) => <tr key={repair.id}>
    <td data-label="Ремонт">{recordLabel("Ремонт", repair.id)}<small>{repair.actionType} · {recordLabel("Неисправность", repair.faultId)}</small></td>
    <td data-label="Подрядчик">{namedEntity(data, repair.contractorId, "Подрядчик")}</td>
    <td data-label="Стоимость">{rub(repair.costMinor)}</td>
    <td data-label="Акт">{repair.actDocumentId ? recordLabel("Акт", repair.actDocumentId) : "Не приложен"}</td>
    <td data-label="Оплата">{repair.paymentOperationId ? recordLabel("Операция", repair.paymentOperationId) : "Заблокирована"}</td>
    <td data-label="Статус">{repair.status}</td>
    <td data-label="Действие">{repair.status !== "Завершён" ? <Button variant="secondary" disabled={busy === repair.id} onClick={() => complete(repair.id)}>Завершить с актом</Button> : <Button variant="secondary" onClick={onOpenFinance} disabled={!repair.payable}>Открыть оплату</Button>}</td>
  </tr>)}</tbody></table></div></Card>;
}

function PanelHead({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return <header className="ahSafetyPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{note}</span></header>;
}

function SafetyIncidentModal({ systems, busy, close, save }: { systems: SafetyData["systems"]; busy: boolean; close: () => void; save: (body: Record<string, unknown>) => Promise<void> }) {
  const [systemId, setSystemId] = useState(systems[0]?.id ?? "");
  const system = systems.find((item) => item.id === systemId);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save({ systemId, objectEntityId: system?.objectEntityId ?? "", category: String(form.get("category") ?? ""), severity: String(form.get("severity") ?? ""), description: String(form.get("description") ?? "") });
  }
  return createPortal(<div className="ahSafetyModalLayer"><button className="ahSafetyModalScrim" type="button" onClick={close} aria-label="Закрыть форму" /><form className="ahSafetyModal" onSubmit={submit}>
    <header><div><p>Безопасность объектов</p><h2>Зафиксировать инцидент</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
    <label><span>Система *</span><select name="systemId" value={systemId} onChange={(event) => setSystemId(event.target.value)} required>{systems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="ahSafetyFormGrid"><label><span>Категория *</span><input name="category" required defaultValue={system?.systemType || "Наблюдение"} /></label><label><span>Важность *</span><select name="severity" defaultValue="Средняя"><option>Низкая</option><option>Средняя</option><option>Высокая</option><option>Критичная</option></select></label></div>
    <label><span>Что произошло *</span><textarea name="description" required minLength={8} placeholder="Только проверяемые факты без предположений" /></label>
    <footer><Button variant="secondary" onClick={close}>Отмена</Button><Button variant="primary" type="submit" disabled={busy || !systemId}>{busy ? "Сохраняем…" : "Сохранить инцидент"}</Button></footer>
  </form></div>, document.body);
}

function SafetyRepairModal({ repairId, entities, busy, close, save }: { repairId: string; entities: Array<[string, string]>; busy: boolean; close: () => void; save: (body: Record<string, unknown>) => Promise<void> }) {
  const [responsibleEntityId, setResponsibleEntityId] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save({ result: String(form.get("result") ?? ""), actDocumentId: String(form.get("actDocumentId") ?? ""), responsibleEntityId });
  }
  return createPortal(<div className="ahSafetyModalLayer"><button className="ahSafetyModalScrim" type="button" onClick={close} aria-label="Закрыть форму" /><form className="ahSafetyModal ahSafetyModalCompact" onSubmit={submit}>
    <header><div><p>{recordLabel("Ремонт", repairId)}</p><h2>Завершить ремонт</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header>
    <label><span>Результат работ *</span><textarea name="result" required minLength={8} placeholder="Что сделано и как проверена работоспособность" /></label>
    <label><span>Рабочий акт *</span><input name="actDocumentId" required minLength={5} placeholder="Номер фактического акта" /></label>
    <label><span>Ответственный за следующую проверку *</span><select name="responsibleEntityId" value={responsibleEntityId} onChange={(event) => setResponsibleEntityId(event.target.value)} required><option value="">Выберите сотрудника</option>{entities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <footer><Button variant="secondary" onClick={close}>Отмена</Button><Button variant="primary" type="submit" disabled={busy || !responsibleEntityId}>{busy ? "Сохраняем…" : "Завершить и назначить проверку"}</Button></footer>
  </form></div>, document.body);
}
