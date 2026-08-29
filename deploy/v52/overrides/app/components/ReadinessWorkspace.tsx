"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CompactListCard, EmptyState, KpiCard, PageContainer, PageHeader, Tabs } from "./design-system";
import "./ReadinessWorkspace.ds.css";

type Step = { id: string; step_order: number; step_name: string; entity_type: string; entity_id: string; check_type: string; status: string; evidence: string };
type Scenario = { id: string; number: number; name: string; chain: string; owner_entity_id: string; status: string; data_boundary: string; evidence: string; failure: string; last_run_at: string; duration_ms: number; steps: Step[] };
type Gate = { id: string; name: string; status: string; required: number; evidence: string; owner_entity_id: string; updated_at: string };
type Drill = { id: string; drill_type: string; scope: string; status: string; rpo_minutes: number; rto_minutes: number; evidence: string; limitation: string };
type Decision = { id: number; verdict: string; comment: string; actor: string; created_at: string };
type ReadinessData = {
  dataMode: "test" | "source_only" | "empty";
  scenarios: Scenario[];
  gates: Gate[];
  runs: Array<{ id: string; status: string; passed: number; failed: number; finished_at: string; initiated_by: string }>;
  drills: Drill[];
  decisions: Decision[];
  summary: { passedScenarios: number; totalScenarios: number; passedGates: number; totalGates: number; productionReady: boolean; blockedGateIds: string[] };
  testLayers: string[];
  boundary: string;
  medicalBoundary: string;
  productionDecision: string;
};

const roles: Record<string, string> = {
  "Контроль качества": "QUALITY", "Аналитика": "ANALYTICS", "Интеграции": "INTEGRATIONS",
  "Собственник": "OWNER", "Директор": "DIRECTOR", "Представитель Виталия": "REPRESENTATIVE",
};
const tabs = ["Визуальная оболочка", "10 сценариев", "Матрица проверок", "Release gates", "Recovery и rollback", "Решение представителя"] as const;
type ReadinessTab = typeof tabs[number];

const visualGates = [
  ["Иерархия", "Крупный заголовок раздела, компактная служебная типографика и единый вертикальный ритм"],
  ["Карточки", "Общие радиусы, границы, KPI-токены и аккуратные списки по эталону «Доступы»"],
  ["Навигация", "Маршруты, логический возврат, группы разделов и мобильный dock"],
  ["Поиск", "Назначение каждого поля однозначно; декоративные иконки не дублируют подсказку"],
  ["Роли", "Персональные профили и серверные ограничения чувствительных данных"],
  ["Интеграции", "Управляющие действия, журнал, конфликты и контролируемые тестовые данные"],
  ["Адаптивность", "Desktop, tablet и mobile проверяются на утверждённых разрешениях"],
  ["Безопасность выпуска", "Точная сборка, изолированный preview, A/B-скриншоты, backup и rollback"],
] as const;

export function ReadinessWorkspace({ role, notify }: { role: string; notify: (value: string) => void }) {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [tab, setTab] = useState<ReadinessTab>("Визуальная оболочка");
  const [selected, setSelected] = useState("SCN-T-01");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/readiness", { cache: "no-store", headers: { "x-arthello-role": roles[role] ?? "" } });
      const payload = await response.json() as ReadinessData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить готовность");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function runAll() {
    setBusy(true);
    try {
      const response = await fetch("/api/readiness-actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arthello-role": roles[role] ?? "" },
        body: JSON.stringify({ action: "runAllScenarios" }),
      });
      const payload = await response.json() as { error?: string; passed?: number; failed?: number };
      if (!response.ok) throw new Error(payload.error ?? "Проверка не выполнена");
      notify(`Сквозная проверка завершена: ${payload.passed ?? 0} пройдено, ${payload.failed ?? 0} не пройдено`);
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Проверка не выполнена");
    } finally {
      setBusy(false);
    }
  }

  async function decide(verdict: "ПРИНЯТО ПРЕДСТАВИТЕЛЕМ" | "ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ") {
    if (role !== "Представитель Виталия") return;
    if (comment.trim().length < 8) { notify("Добавьте содержательный комментарий представителя"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/acceptance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: "Плановая миграция Design System", verdict, comment: comment.trim() }),
      });
      if (!response.ok) throw new Error("Решение не сохранено");
      setComment("");
      notify("Решение представителя записано; production не разрешён автоматически");
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Решение не сохранено");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="ahReadinessStatus">Собираем сквозные доказательства…</section>;
  if (error || !data) return <section className="ahReadinessStatus"><Card><EmptyState title="Контур готовности недоступен" description={error || "Для просмотра требуется разрешённая роль."} density="compact" /></Card></section>;

  let selectedScenarioId = selected;
  if (!data.scenarios.length) selectedScenarioId = "";
  const scenario = data.scenarios.find((item) => item.id === selectedScenarioId) ?? data.scenarios[0];
  const canRun = ["Собственник", "Директор", "Представитель Виталия", "Контроль качества"].includes(role);
  const isDemo = data.dataMode === "test";
  const hasData = Boolean(data.scenarios.length || data.gates.length || data.runs.length || data.drills.length || data.decisions.length || data.testLayers.length);

  return <PageContainer className="ahReadinessPage">
    <PageHeader
      eyebrow="СЦЕНАРИИ · GATES · ROLLBACK"
      title="Готовность ArtHello OS"
      description="Визуальная проверка, сквозные сценарии, ворота выпуска и восстановление — только по сохранённым доказательствам."
      actions={<Button variant="primary" disabled={!canRun || busy || !data.scenarios.length} onClick={() => void runAll()}>{busy ? "Проверяем…" : "Запустить проверки"}</Button>}
    />

    <Card className="ahReadinessBoundary"><strong>{data.summary.productionReady ? "ГОТОВО К ИТОГОВОЙ ПРОВЕРКЕ" : "Production закрыт"}</strong><span>{hasData ? data.productionDecision : "Система не создаёт результаты приёмки автоматически. Настройте сценарии и ворота выпуска."}</span></Card>

    <div className="ahReadinessKpis">
      <KpiCard label="Сценарии" value={`${data.summary.passedScenarios}/${data.summary.totalScenarios}`} note="пройдено" onClick={() => setTab("10 сценариев")} />
      <KpiCard label="Ворота выпуска" value={`${data.summary.passedGates}/${data.summary.totalGates}`} note="по доказательствам" onClick={() => setTab("Release gates")} />
      <KpiCard label="Recovery drills" value={data.drills.length} note="сохранённых проверок" onClick={() => setTab("Recovery и rollback")} />
      <KpiCard className={data.summary.blockedGateIds.length ? "ahReadinessKpiWarning" : undefined} label="Блокирующие gates" value={data.summary.blockedGateIds.length} note={data.summary.productionReady ? "нет блокеров" : "выпуск запрещён"} onClick={() => setTab("Release gates")} />
    </div>

    <div className="ahReadinessTabs"><Tabs items={tabs.map((item) => ({ id: item, label: item }))} value={tab} onChange={setTab} ariaLabel="Разделы готовности" /></div>

    {tab === "Визуальная оболочка" ? isDemo ? <VisualHandoff /> : <Card className="ahReadinessPanel"><EmptyState title="Результаты визуальной проверки не добавлены" description="Здесь появятся только сохранённые результаты рабочей A/B-приёмки интерфейса." density="compact" /></Card> : null}
    {tab === "10 сценариев" ? <ScenarioPanel data={data} scenario={scenario} select={setSelected} /> : null}
    {tab === "Матрица проверок" ? <TestMatrix layers={data.testLayers} /> : null}
    {tab === "Release gates" ? <GatePanel gates={data.gates} /> : null}
    {tab === "Recovery и rollback" ? <RecoveryPanel drills={data.drills} /> : null}
    {tab === "Решение представителя" ? <DecisionPanel data={data} role={role} busy={busy} comment={comment} setComment={setComment} decide={decide} /> : null}
  </PageContainer>;
}

function VisualHandoff() {
  return <div className="ahReadinessLayout"><Card className="ahReadinessPanel"><PanelHead eyebrow="Этап 19 · единая визуальная оболочка и UX master-route" title="Что собрано и проверено" note="8/8 покрыто" /><div className="ahReadinessCompactList">{visualGates.map(([name, evidence], index) => <CompactListCard key={name} index={String(index + 1).padStart(2, "0")} title={name} description={evidence} />)}</div></Card><Card className="ahReadinessPanel"><PanelHead eyebrow="Маршрут представителя" title="Итоговая проверка" note="до production" /><ol className="ahReadinessRoute"><li>Проверить персональный дашборд для ключевых ролей.</li><li>Открыть все разделы с первого клика.</li><li>Раскрыть KPI, источник, расчёт и связи.</li><li>Проверить поиск и командную палитру.</li><li>Пройти интеграции и журнал ошибок.</li><li>Запустить сквозные сценарии.</li><li>Зафиксировать решение в последней вкладке.</li></ol><div className="ahReadinessLimit"><strong>Известные ограничения</strong><span>Внешние CRM, банки, ЭДО, СКУД и секреты проверяются только при наличии рабочего подключения. Медицинские данные закрыты по умолчанию.</span></div></Card></div>;
}

function ScenarioPanel({ data, scenario, select }: { data: ReadinessData; scenario?: Scenario; select: (id: string) => void }) {
  if (!data.scenarios.length || !scenario) return <Card className="ahReadinessPanel"><EmptyState title="Сценариев пока нет" description="Сценарий должен иметь владельца, цепочку, шаги, границу данных и проверяемое доказательство." density="compact" /></Card>;
  return <div className="ahReadinessScenarioShell"><Card className="ahReadinessPanel"><PanelHead eyebrow="Сквозные сценарии" title="Выберите цепочку" note={`${data.scenarios.length}`} /><div className="ahReadinessScenarioList">{data.scenarios.map((item) => <button type="button" key={item.id} className={item.id === scenario.id ? "active" : ""} onClick={() => select(item.id)}><b>{String(item.number).padStart(2, "0")}</b><span><strong>{item.name}</strong><small>{item.chain}</small></span><em className={statusClass(item.status)}>{item.status}</em></button>)}</div></Card><Card className="ahReadinessPanel"><PanelHead eyebrow={`${scenario.id} · ${scenario.owner_entity_id}`} title={scenario.name} note={scenario.status} /><p className="ahReadinessLimit">{scenario.data_boundary}</p><div className="ahReadinessCompactList">{scenario.steps.map((step) => <CompactListCard key={step.id} index={String(step.step_order).padStart(2, "0")} title={`${step.step_name} · ${step.status}`} description={`${step.entity_type} · ${step.entity_id} · ${step.evidence || "Будет проверено по D1"}`} />)}</div>{scenario.id === "SCN-T-09" ? <p className="ahReadinessLimit">{data.medicalBoundary}</p> : null}</Card></div>;
}

function TestMatrix({ layers }: { layers: string[] }) {
  if (!layers.length) return <Card className="ahReadinessPanel"><EmptyState title="Матрица проверок не настроена" description="Добавьте обязательные уровни от функции и контракта до backup restore." density="compact" /></Card>;
  return <Card className="ahReadinessPanel"><PanelHead eyebrow="Coverage уровней" title="От функции до восстановления" note={`${layers.length} уровней`} /><div className="ahReadinessMatrix">{layers.map((layer, index) => { const limited = layer === "Backup restore" || layer === "Browser compatibility" || layer === "Security"; const status = layer === "Backup restore" ? "Не выполнено" : limited ? "Ограничено" : "Покрыто"; return <CompactListCard key={layer} index={String(index + 1).padStart(2, "0")} title={`${layer} · ${status}`} description={layer === "Backup restore" ? "Нужен live D1 restore drill" : limited ? "Нужна внешняя production-проверка" : "Проверяется автоматической suite или доменным контрактом"} />; })}</div></Card>;
}

function GatePanel({ gates }: { gates: Gate[] }) {
  if (!gates.length) return <Card className="ahReadinessPanel"><EmptyState title="Ворота выпуска не настроены" description="Production остаётся закрытым, пока обязательные gates и их доказательства не зафиксированы." density="compact" /></Card>;
  return <div className="ahReadinessGateGrid">{gates.map((gate) => <Card key={gate.id} className={`ahReadinessPanel ${statusClass(gate.status)}`}><PanelHead eyebrow={gate.id} title={gate.name} note={gate.status} /><p>{gate.evidence || "Доказательство не приложено"}</p><small>{gate.owner_entity_id} · {gate.required ? "обязательный" : "информационный"}</small></Card>)}</div>;
}

function RecoveryPanel({ drills }: { drills: Drill[] }) {
  if (!drills.length) return <Card className="ahReadinessPanel"><EmptyState title="Recovery drills пока не выполнены" description="Rollback приложения не заменяет проверенное восстановление базы и контроль RPO/RTO." density="compact" /></Card>;
  return <div className="ahReadinessLayout"><Card className="ahReadinessPanel"><PanelHead eyebrow="Recovery drills" title="Что реально проверено" note={`${drills.length}`} /><div className="ahReadinessCompactList">{drills.map((drill, index) => <CompactListCard key={drill.id} index={String(index + 1).padStart(2, "0")} title={`${drill.drill_type} · ${drill.status}`} description={`${drill.scope} · ${drill.evidence} · ограничение: ${drill.limitation}`} />)}</div></Card><Card className="ahReadinessPanel"><PanelHead eyebrow="Rollback" title="Возврат приложения" note="без destructive migration" /><CompactListCard title="Sites checkpoint + аддитивная D1-схема" description="Каждая опубликованная версия неизменяема. Интерфейс можно вернуть на предыдущий checkpoint." /><p className="ahReadinessLimit">Важно: rollback приложения не заменяет проверенное восстановление базы.</p></Card></div>;
}

function DecisionPanel({ data, role, busy, comment, setComment, decide }: { data: ReadinessData; role: string; busy: boolean; comment: string; setComment: (value: string) => void; decide: (verdict: "ПРИНЯТО ПРЕДСТАВИТЕЛЕМ" | "ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ") => Promise<void> }) {
  return <div className="ahReadinessLayout"><Card className="ahReadinessPanel"><PanelHead eyebrow="Контроль собственника" title="Итоговая приёмка" note="не включает production" /><div className="ahReadinessSeal">НЕ ЯВЛЯЕТСЯ РАЗРЕШЕНИЕМ НА PRODUCTION</div><label className="ahReadinessComment"><span>Комментарий представителя</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Решение и конкретные замечания по рабочей проверке" /></label>{role !== "Представитель Виталия" ? <small>Для решения выберите роль «Представитель Виталия».</small> : null}<footer className="ahReadinessActions"><Button variant="secondary" disabled={role !== "Представитель Виталия" || busy || comment.trim().length < 8} onClick={() => void decide("ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ")}>Отклонить</Button><Button variant="primary" disabled={role !== "Представитель Виталия" || busy || comment.trim().length < 8} onClick={() => void decide("ПРИНЯТО ПРЕДСТАВИТЕЛЕМ")}>Принять</Button></footer></Card><Card className="ahReadinessPanel"><PanelHead eyebrow="Append-only" title="История решений" note={`${data.decisions.length}`} />{data.decisions.length ? <div className="ahReadinessCompactList">{data.decisions.map((item, index) => <CompactListCard key={item.id} index={String(index + 1).padStart(2, "0")} title={item.verdict} description={`${item.created_at} · ${item.actor} · ${item.comment || "Без комментария"}`} />)}</div> : <EmptyState title="Решений ещё нет" description="История появится после явного решения представителя." density="compact" />}</Card></div>;
}

function PanelHead({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return <header className="ahReadinessPanelHead"><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{note}</span></header>;
}

function statusClass(value: string) {
  return value === "Пройдено" || value === "Пройден" ? "passed" : value === "Заблокировано" || value === "Не выполнено" || value === "Не пройдено" ? "blocked" : "limited";
}
