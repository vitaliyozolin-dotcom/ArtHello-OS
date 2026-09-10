"use client";

import { useCallback, useEffect, useState } from "react";
import { recordLabel, recordNumber } from "../../lib/record-labels";
import { Button, Card, CompactListCard, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./MedicalWorkspace.ds.css";

type MedicalData = {
  documents: Array<{ id: string; subjectEntityId: string; subjectType: string; documentType: string; documentRef: string; validFrom: string; validUntil: string; status: string; storageClass: string; minimumSummary: string; confirmedAt: string; expiryBand: string }>;
  restrictions: Array<{ id: string; subjectEntityId: string; recordId: string; category: string; limitation: string; validUntil: string; actionScope: string; status: string }>;
  cases: Array<{ id: string; subjectEntityId: string; caseType: string; openedAt: string; severity: string; minimumSummary: string; responsibleEntityId: string; dueAt: string; status: string; closedAt: string; confirmationRef: string }>;
  incidents: Array<{ id: string; caseId: string; happenedAt: string; incidentType: string; minimumFacts: string; responseRequired: string; status: string }>;
  actions: Array<{ id: string; caseId: string; incidentId: string; actionType: string; responsibleEntityId: string; dueAt: string; completedAt: string; result: string; confirmationRef: string; status: string }>;
  audit: Array<{ id: number; action: string; entityType: string; entityId: string; createdAt: string }>;
  summary: { documents: number; expiring: number; activeRestrictions: number; openCases: number; pendingActions: number };
  boundary: string;
};

const roles: Record<string, string> = {
  "Медработник": "MEDICAL", "Собственник": "OWNER", "Директор": "DIRECTOR", "Представитель Виталия": "REPRESENTATIVE",
  "Безопасность": "SAFETY", "Финансы": "FINANCE", "Кухня": "KITCHEN", "Закупки": "PROCUREMENT",
  "Юрист": "LEGAL", "HR": "HR", "Продажи": "SALES", "Маркетинг": "MARKETING",
  "Педагог": "TEACHER", "Методист": "METHODIST", "Родитель": "PARENT",
};

const tabs = ["Контроль", "Документы", "Ограничения", "Случаи и действия", "Аудит просмотров"] as const;
type MedicalTab = typeof tabs[number];

export function MedicalWorkspace({ role, notify }: { role: string; notify: (value: string) => void }) {
  const [data, setData] = useState<MedicalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<MedicalTab>("Контроль");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/medical", { cache: "no-store", headers: { "x-arthello-role": roles[role] ?? "" } });
      const payload = await response.json() as MedicalData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Доступ закрыт");
      setData(payload);
      setError("");
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Доступ закрыт");
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
      const response = await fetch("/api/medical-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string; reused?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      notify(payload.reused ? "Действие уже было выполнено" : "Медицинская запись сохранена; аудит обновлён");
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Ошибка");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <section className="ahMedicalStatus">Проверяем специальный допуск…</section>;
  if (error || !data) return <PageContainer className="ahMedicalDenied"><PageHeader eyebrow="ОСОБО ЧУВСТВИТЕЛЬНЫЕ ДАННЫЕ" title="Медицинский контур закрыт" description={error || "Для просмотра требуется отдельная медицинская роль."} /><Card><EmptyState title="По умолчанию скрыто" description="Нет счётчиков, списков, документов, диагнозов или косвенных признаков. Попытка доступа фиксируется в аудите." density="compact" /></Card></PageContainer>;

  const hasMedicalData = Boolean(data.documents.length || data.restrictions.length || data.cases.length || data.incidents.length || data.actions.length);
  const boundary = hasMedicalData ? data.boundary : "Пустой контур не раскрывает персональные или косвенные медицинские сведения.";

  return <PageContainer className="ahMedicalPage">
    <PageHeader
      eyebrow="МЕДИЦИНА · ДОПУСК · АУДИТ"
      title="Медицинское сопровождение"
      description="Минимально необходимые сведения, отдельные права и аудит каждого просмотра."
      actions={<Button variant="secondary" onClick={() => setTab("Аудит просмотров")}>Открыть аудит</Button>}
    />

    <Card className="ahMedicalBoundary"><strong>Защищённая зона</strong><span>{boundary}</span></Card>

    <div className="ahMedicalKpis">
      <KpiCard label="Документы" value={data.summary.documents} note={`${data.summary.expiring} истекает`} onClick={() => setTab("Документы")} />
      <KpiCard label="Ограничения" value={data.summary.activeRestrictions} note="только необходимый режим" onClick={() => setTab("Ограничения")} />
      <KpiCard className="ahMedicalKpiWarning" label="Открытые случаи" value={data.summary.openCases} note={`${data.summary.pendingActions} действий ожидает`} onClick={() => setTab("Случаи и действия")} />
      <KpiCard label="Контроль доступа" value="100%" note="просмотр фиксируется" onClick={() => setTab("Аудит просмотров")} />
    </div>

    <div className="ahMedicalTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы медицинского сопровождения" /></div>

    {tab === "Контроль" ? <MedicalControl data={data} hasData={hasMedicalData} /> : null}
    {tab === "Документы" ? <MedicalDocuments data={data} busy={busy} confirm={(documentId) => void action({ action: "confirmDocument", documentId }, documentId)} /> : null}
    {tab === "Ограничения" ? <MedicalRestrictions data={data} /> : null}
    {tab === "Случаи и действия" ? <MedicalCases data={data} busy={busy} action={action} /> : null}
    {tab === "Аудит просмотров" ? <MedicalAudit data={data} /> : null}
  </PageContainer>;
}

function MedicalControl({ data, hasData }: { data: MedicalData; hasData: boolean }) {
  if (!hasData) return <Card className="ahMedicalPanel"><EmptyState title="Медицинских записей пока нет" description="Контроль, документы, ограничения, случаи, действия и аудит готовы к защищённой работе." density="compact" /></Card>;
  return <div className="ahMedicalLayout">
    <Card className="ahMedicalPanel"><PanelHead eyebrow="Принципы" title="Минимизация раскрытия" note="обязательно" /><div className="ahMedicalRules">
      <CompactListCard index="01" title="Отдельный допуск" description="Руководитель без медицинской роли не видит записи." />
      <CompactListCard index="02" title="Аудит каждого просмотра" description="Фиксируются пользователь, время, область и цель." />
      <CompactListCard index="03" title="Минимум раскрытия" description="В другие контуры передаётся только разрешённый режим действия." />
    </div></Card>
    <Card className="ahMedicalPanel"><PanelHead eyebrow="Сроки" title="Ближайшие действия" note={`${data.summary.pendingActions} ожидает`} /><div className="ahMedicalDue">{data.actions.filter((item) => item.status !== "Выполнено").map((item) => <CompactListCard key={item.id} index={recordNumber(item.id)} title={item.actionType} description={`${recordLabel("Случай", item.caseId)} · ${item.dueAt} · ${item.status}`} />)}</div></Card>
  </div>;
}

function MedicalDocuments({ data, busy, confirm }: { data: MedicalData; busy: string; confirm: (documentId: string) => void }) {
  if (!data.documents.length) return <Card className="ahMedicalPanel"><EmptyState title="Медицинских документов пока нет" description="Новые сведения появляются только после защищённого ввода и подтверждения." density="compact" /></Card>;
  return <div className="ahMedicalCardGrid">{data.documents.map((document) => <Card key={document.id} className="ahMedicalDocument"><header><span>{document.subjectType} · {recordLabel("Документ", document.id)}</span><em>{document.expiryBand}</em></header><h2>{document.documentType}</h2><p>{document.minimumSummary}</p><dl><div><dt>Карточка</dt><dd>{recordLabel(document.subjectType, document.subjectEntityId)}</dd></div><div><dt>Действует</dt><dd>{document.validFrom}—{document.validUntil}</dd></div><div><dt>Хранение</dt><dd>Защищённый медицинский контур</dd></div><div><dt>Оригинал</dt><dd>Ссылка доступна только медработнику</dd></div></dl><footer><span>{document.confirmedAt ? `Подтверждено ${document.confirmedAt.slice(0, 10)}` : "Нужно подтверждение"}</span><Button variant="secondary" disabled={busy === document.id} onClick={() => confirm(document.id)}>Подтвердить</Button></footer></Card>)}</div>;
}

function MedicalRestrictions({ data }: { data: MedicalData }) {
  if (!data.restrictions.length) return <Card className="ahMedicalPanel"><EmptyState title="Ограничений пока нет" description="Раздел хранит только необходимый режим и срок, а не избыточный диагноз." density="compact" /></Card>;
  return <div className="ahMedicalCardGrid">{data.restrictions.map((restriction) => <Card key={restriction.id} className="ahMedicalRestriction"><header><span>{recordLabel("Ограничение", restriction.id)} · только необходимое</span><em>{restriction.status}</em></header><h2>{restriction.category}</h2><strong>{restriction.limitation}</strong><p>{restriction.actionScope}</p><footer><span>{recordLabel("Карточка", restriction.subjectEntityId)}</span><time>до {restriction.validUntil}</time></footer></Card>)}</div>;
}

function MedicalCases({ data, busy, action }: { data: MedicalData; busy: string; action: (body: Record<string, unknown>, key: string) => Promise<void> }) {
  if (!data.cases.length && !data.actions.length) return <Card className="ahMedicalPanel"><EmptyState title="Случаев и действий пока нет" description="Каждое действие имеет срок, ответственного, результат и подтверждение." density="compact" /></Card>;
  return <div className="ahMedicalCaseGrid">{data.cases.map((medicalCase) => <Card key={medicalCase.id} className="ahMedicalCase"><PanelHead eyebrow={`${recordLabel("Случай", medicalCase.id)} · ${medicalCase.severity}`} title={medicalCase.caseType} note={medicalCase.status} /><p>{medicalCase.minimumSummary}</p><div className="ahMedicalTimeline">
    {data.incidents.filter((item) => item.caseId === medicalCase.id).map((incident) => <CompactListCard key={incident.id} index={recordNumber(incident.id)} title={incident.incidentType} description={`${incident.minimumFacts} · ${incident.responseRequired}`} />)}
    {data.actions.filter((item) => item.caseId === medicalCase.id).map((medicalAction) => <article key={medicalAction.id}><CompactListCard index={recordNumber(medicalAction.id)} title={medicalAction.actionType} description={medicalAction.result || `Срок ${medicalAction.dueAt}`} />{medicalAction.status !== "Выполнено" ? <Button variant="secondary" disabled={busy === medicalAction.id} onClick={() => void action({ action: "completeAction", actionId: medicalAction.id, result: "Контроль выполнен, дальнейшие действия — по действующему протоколу", confirmationRef: `Подтверждено медработником ${new Date().toLocaleDateString("ru-RU")}` }, medicalAction.id)}>Выполнить</Button> : null}</article>)}
  </div><footer><span>Ответственный медработник назначен</span>{medicalCase.status !== "Закрыт" ? <Button variant="secondary" disabled={busy === medicalCase.id || data.actions.some((item) => item.caseId === medicalCase.id && item.status !== "Выполнено")} onClick={() => void action({ action: "closeCase", caseId: medicalCase.id, result: "Случай закрыт после выполнения действий и контроля", confirmationRef: `Подтверждено медработником ${new Date().toLocaleDateString("ru-RU")}` }, medicalCase.id)}>Закрыть с подтверждением</Button> : <strong>Закрытие подтверждено</strong>}</footer></Card>)}</div>;
}

function MedicalAudit({ data }: { data: MedicalData }) {
  if (!data.audit.length) return <Card className="ahMedicalPanel"><EmptyState title="История действий пока пуста" description="Этот и последующие просмотры фиксируются в защищённом аудите." density="compact" /></Card>;
  return <Card className="ahMedicalPanel"><PanelHead eyebrow="Неизменяемая история" title="Просмотры и действия" note={`${data.audit.length} событий`} /><div className="ahMedicalAuditTable"><table><thead><tr><th>Время</th><th>Действие</th><th>Область</th><th>Запись</th></tr></thead><tbody>{data.audit.map((item) => <tr key={item.id}><td data-label="Время">{item.createdAt}</td><td data-label="Действие">{medicalAuditAction(item.action)}</td><td data-label="Область">{medicalAuditArea(item.entityType)}</td><td data-label="Запись">{recordLabel("Запись", item.entityId)}</td></tr>)}</tbody></table></div></Card>;
}

function medicalAuditAction(value: string) {
  if (value.includes("view")) return "Просмотр защищённой записи";
  if (value.includes("confirm")) return "Подтверждение документа";
  if (value.includes("close")) return "Закрытие случая";
  if (value.includes("complete")) return "Выполнение действия";
  return "Действие в медицинском контуре";
}

function medicalAuditArea(value: string) {
  if (value.includes("document")) return "Документы";
  if (value.includes("case")) return "Медицинские случаи";
  if (value.includes("action")) return "Действия";
  return "Медицинское сопровождение";
}

function PanelHead({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return <header className="ahMedicalPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{note}</span></header>;
}
