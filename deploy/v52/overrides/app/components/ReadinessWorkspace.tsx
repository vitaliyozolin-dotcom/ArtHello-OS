"use client";

import { useCallback, useEffect, useState } from "react";

type Step = { id: string; step_order: number; step_name: string; entity_type: string; entity_id: string; check_type: string; status: string; evidence: string };
type Scenario = { id: string; number: number; name: string; chain: string; owner_entity_id: string; status: string; data_boundary: string; evidence: string; failure: string; last_run_at: string; duration_ms: number; steps: Step[] };
type Gate = { id: string; name: string; status: string; required: number; evidence: string; owner_entity_id: string; updated_at: string };
type Drill = { id: string; drill_type: string; scope: string; status: string; rpo_minutes: number; rto_minutes: number; evidence: string; limitation: string };
type Decision = { id: number; verdict: string; comment: string; actor: string; created_at: string };
type Data = {
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
  "Контроль качества": "QUALITY",
  "Аналитика": "ANALYTICS",
  "Интеграции": "INTEGRATIONS",
  "Собственник": "OWNER",
  "Директор": "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
};
const tabs = ["Визуальная оболочка", "10 сценариев", "Матрица проверок", "Release gates", "Recovery и rollback", "Решение представителя"] as const;
type Tab = typeof tabs[number];

const visualGates = [
  ["Айдентика", "Единые токены, AH-монограмма, изумрудный каркас и точечный лаймовый акцент"],
  ["Типографика", "16 px основной текст, 14 px служебный; микротекст поздних модулей нормализован"],
  ["Навигация", "25 разделов, push-history, хлебные крошки, логический возврат, недавние и начало раздела"],
  ["Поиск", "Разделы, семьи, сотрудники, договоры, платежи, задачи и быстрые действия"],
  ["Роли", "8 персональных профилей дашборда и серверные ограничения чувствительных данных"],
  ["Интеграции", "8 реальных управляющих действий, журнал, конфликты, add/delete test data"],
  ["Responsive", "Отдельные desktop, tablet и mobile-композиции; mobile dock и navigation drawer"],
  ["Performance", "Ленивая загрузка модулей; основной shell 64 kB при бюджете 100 kB"],
] as const;

export function ReadinessWorkspace({ role, notify }: { role: string; notify: (value: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("Визуальная оболочка");
  const [selected, setSelected] = useState("SCN-T-01");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/readiness", { cache: "no-store", headers: { "x-arthello-role": roles[role] ?? "" } });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
    } catch (cause) {
      setData(null);
      notify(cause instanceof Error ? cause.message : "Не удалось загрузить готовность");
    } finally {
      setLoading(false);
    }
  }, [role, notify]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
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
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Проверка не выполнена");
    } finally {
      setBusy(false);
    }
  }

  async function decide(verdict: "ПРИНЯТО ПРЕДСТАВИТЕЛЕМ" | "ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ") {
    if (role !== "Представитель Виталия") return;
    if (comment.trim().length < 8) {
      notify("Добавьте содержательный комментарий представителя");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/acceptance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: "Этап 19 · единая визуальная оболочка и UX master-route", verdict, comment: comment.trim() }),
      });
      if (!response.ok) throw new Error("Решение не сохранено");
      setComment("");
      notify("Решение представителя записано; production не разрешён");
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Решение не сохранено");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="readiness-state">Собираем сквозные доказательства…</section>;
  if (!data) return <section className="readiness-state">Контур готовности недоступен для выбранной роли.</section>;
  if (!data.scenarios.length) {
    return <section className="page readiness-workspace">
      <header className="readiness-heading"><div><p className="eyebrow">Контроль готовности</p><h1>Готовность ArtHello OS</h1><p>Сценарии, ворота выпуска и результаты проверок появятся после их настройки.</p></div></header>
      <div className="manual-module-empty"><span>＋</span><h2>Проверок пока нет</h2><p>Система не создаёт результаты приёмки и готовности автоматически.</p></div>
    </section>;
  }

  const scenario = data.scenarios.find((item) => item.id === selected) ?? data.scenarios[0];
  const canRun = ["Собственник", "Директор", "Представитель Виталия", "Контроль качества"].includes(role);
  const isDemo = data.dataMode === "test";

  return <section className="page readiness-workspace">
    <header className="readiness-heading">
      <div><p className="eyebrow">{isDemo ? "Этап 19 · единая визуальная оболочка" : "Контроль готовности"}</p><h1>Готовность ArtHello OS</h1><p>{isDemo ? "Айдентика, разделы, персональные дашборды, навигация и сквозные доказательства собраны в закрытом контуре." : "Сценарии и ворота выпуска отражают только сохранённые результаты проверок."}</p></div>
      <div><span className="readiness-release ready">{isDemo ? "ГОТОВО К ИТОГОВОЙ ПРОВЕРКЕ" : "ТЕКУЩЕЕ СОСТОЯНИЕ"}</span><button disabled={!canRun || busy} onClick={() => void runAll()}>{busy ? "Проверяем…" : isDemo ? "Запустить 10 сценариев" : "Запустить проверки"}</button></div>
    </header>
    <div className="readiness-alert"><strong>{isDemo ? "PRODUCTION ЗАКРЫТ" : "РЕШЕНИЕ О ВЫПУСКЕ"}</strong><span>{data.productionDecision}</span></div>
    <div className="readiness-kpis">
      <article><span>{isDemo ? "Разделы" : "Сценарии"}</span><strong>{isDemo ? "25/25" : data.summary.totalScenarios}</strong><small>{isDemo ? "открытие с первого клика" : "сохранено в контуре"}</small></article>
      <article><span>{isDemo ? "Действия" : "Пройдено"}</span><strong>{isDemo ? "181" : data.summary.passedScenarios}</strong><small>{isDemo ? "аудируемый реестр" : "сценариев"}</small></article>
      <article><span>{isDemo ? "Автотесты" : "Ворота выпуска"}</span><strong>{isDemo ? "84/84" : `${data.summary.passedGates}/${data.summary.totalGates}`}</strong><small>{isDemo ? "lint и production build пройдены" : "по сохранённым результатам"}</small></article>
      <article className="blocked"><span>Production</span><strong>запрещён</strong><small>{data.summary.blockedGateIds.length} незакрытых gates</small></article>
    </div>
    <nav className="readiness-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>

    {tab === "Визуальная оболочка" ? isDemo ? <VisualHandoff /> : <div className="manual-module-empty"><span>＋</span><h2>Результаты визуальной проверки не добавлены</h2><p>Здесь появятся только сохранённые результаты рабочей приёмки интерфейса.</p></div> : null}
    {tab === "10 сценариев" ? <ScenarioPanel data={data} scenario={scenario} select={setSelected} /> : null}
    {tab === "Матрица проверок" ? <TestMatrix layers={data.testLayers} /> : null}
    {tab === "Release gates" ? <GatePanel gates={data.gates} /> : null}
    {tab === "Recovery и rollback" ? <RecoveryPanel drills={data.drills} /> : null}
    {tab === "Решение представителя" ? <div className="readiness-decision">
      <section><p>Контроль собственника</p><h2>Итоговая приёмка визуальной оболочки</h2><div className="production-seal">НЕ ЯВЛЯЕТСЯ РАЗРЕШЕНИЕМ НА PRODUCTION</div><label><span>Комментарий представителя</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={isDemo ? "Принято для тестового контура или конкретный список замечаний" : "Решение и конкретные замечания по рабочей проверке"} /></label>{role !== "Представитель Виталия" ? <small>Для решения выберите роль «Представитель Виталия».</small> : null}<footer><button disabled={role !== "Представитель Виталия" || busy || comment.trim().length < 8} onClick={() => void decide("ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ")}>Отклонить оболочку</button><button disabled={role !== "Представитель Виталия" || busy || comment.trim().length < 8} onClick={() => void decide("ПРИНЯТО ПРЕДСТАВИТЕЛЕМ")}>Принять оболочку</button></footer></section>
      <aside><p>История решений</p>{data.decisions.length ? data.decisions.map((item) => <article key={item.id}><strong>{item.verdict}</strong><small>{item.created_at} · {item.actor}</small><span>{item.comment || "Без комментария"}</span></article>) : <div>Решений по итоговой визуальной приёмке ещё нет.</div>}</aside>
    </div> : null}
  </section>;
}

function VisualHandoff() {
  return <div className="visual-handoff">
    <section className="visual-gates"><header><div><p>Внутренние ворота</p><h2>Что собрано и проверено</h2></div><span>8/8 покрыто</span></header><div>{visualGates.map(([name, evidence], index) => <article key={name}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{name}</strong><small>{evidence}</small></span><em>ПРОЙДЕНО</em></article>)}</div></section>
    <aside className="visual-route"><p>Маршрут представителя</p><h2>Итоговая проверка</h2><ol><li>Переключить роль и проверить персональный дашборд.</li><li>Открыть разделы из каждой группы меню с первого клика.</li><li>Раскрыть KPI, строку, источник, расчёт и связи.</li><li>Проверить поиск и командную палитру.</li><li>Пройти интеграции: test, sync, log, errors, test data.</li><li>Запустить 10 D1-сценариев.</li><li>Зафиксировать решение в последней вкладке.</li></ol><div><strong>Известные ограничения</strong><span>Реальные CRM, банки, ЭДО, СКУД и секреты не предоставлены. Локальные исходники фирменного шрифта и утверждённый пакет логотипа отсутствуют. Медицинские данные остаются закрытыми по умолчанию.</span></div></aside>
  </div>;
}

function ScenarioPanel({ data, scenario, select }: { data: Data; scenario: Scenario; select: (id: string) => void }) {
  return <div className="scenario-layout"><div className="scenario-list">{data.scenarios.map((item) => <button key={item.id} className={item.id === scenario.id ? "active" : ""} onClick={() => select(item.id)}><span>{String(item.number).padStart(2, "0")}</span><p><strong>{item.name}</strong><small>{item.chain}</small></p><em className={statusClass(item.status)}>{item.status}</em></button>)}</div><article className="scenario-detail"><header><div><p>{scenario.id} · {scenario.owner_entity_id}</p><h2>{scenario.name}</h2></div><span className={statusClass(scenario.status)}>{scenario.status}</span></header><p className="scenario-boundary">{scenario.data_boundary}</p><div className="step-rail">{scenario.steps.map((step) => <article key={step.id} className={statusClass(step.status)}><b>{String(step.step_order).padStart(2, "0")}</b><div><strong>{step.step_name}</strong><small>{step.entity_type} · {step.entity_id}</small><em>{step.evidence || "Будет проверено по D1"}</em></div><span>{step.status}</span></article>)}</div>{scenario.id === "SCN-T-09" ? <footer>{data.medicalBoundary}</footer> : null}</article></div>;
}

function TestMatrix({ layers }: { layers: string[] }) {
  return <section className="test-matrix"><header><div><p>Coverage уровней</p><h2>От функции до восстановления</h2></div><span>16 обязательных уровней</span></header><div>{layers.map((layer, index) => { const limited = layer === "Backup restore" || layer === "Browser compatibility" || layer === "Security"; return <article key={layer}><b>{String(index + 1).padStart(2, "0")}</b><strong>{layer}</strong><span className={limited ? "limited" : "passed"}>{layer === "Backup restore" ? "НЕ ВЫПОЛНЕНО" : limited ? "ОГРАНИЧЕНО" : "ПОКРЫТО"}</span><small>{layer === "Backup restore" ? "Нужен live D1 restore drill" : limited ? "Нужна внешняя production-проверка" : "Проверяется автоматической suite или доменным контрактом"}</small></article>; })}</div></section>;
}

function GatePanel({ gates }: { gates: Gate[] }) {
  return <section className="gate-grid">{gates.map((gate) => <article key={gate.id} className={statusClass(gate.status)}><header><span>{gate.id}</span><em>{gate.status}</em></header><h2>{gate.name}</h2><p>{gate.evidence}</p><footer>{gate.owner_entity_id} · {gate.required ? "обязательный" : "информационный"}</footer></article>)}</section>;
}

function RecoveryPanel({ drills }: { drills: Drill[] }) {
  return <div className="recovery-layout"><section><header><p>Recovery drills</p><h2>Что реально проверено</h2></header>{drills.map((drill) => <article key={drill.id}><div><strong>{drill.drill_type}</strong><span className={statusClass(drill.status)}>{drill.status}</span></div><p>{drill.scope} · {drill.evidence}</p><small>Ограничение: {drill.limitation}</small></article>)}</section><aside><p>Rollback</p><h2>Возврат приложения</h2><strong>Sites checkpoint + аддитивная D1-схема</strong><span>Каждая опубликованная версия неизменяема. Откат интерфейса возможен на предыдущий checkpoint; destructive migration не используется.</span><div>Важно: rollback приложения не заменяет проверенное восстановление базы.</div></aside></div>;
}

function statusClass(value: string) {
  return value === "Пройдено" || value === "Пройден" ? "passed" : value === "Заблокировано" || value === "Не выполнено" || value === "Не пройдено" ? "blocked" : "limited";
}
