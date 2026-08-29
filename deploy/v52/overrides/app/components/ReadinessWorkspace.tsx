"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  CompactListCard,
  EmptyState,
  KpiCard,
  PageContainer,
  PageHeader,
  Tabs,
} from "./design-system";
import "./ReadinessWorkspace.ds.css";

type Step = {
  id: string;
  step_order: number;
  step_name: string;
  entity_type: string;
  entity_id: string;
  check_type: string;
  status: string;
  evidence: string;
};

type Scenario = {
  id: string;
  number: number;
  name: string;
  chain: string;
  owner_entity_id: string;
  status: string;
  data_boundary: string;
  evidence: string;
  failure: string;
  last_run_at: string;
  duration_ms: number;
  steps: Step[];
};

type Gate = {
  id: string;
  name: string;
  status: string;
  required: number;
  evidence: string;
  owner_entity_id: string;
  updated_at: string;
};

type Drill = {
  id: string;
  drill_type: string;
  scope: string;
  status: string;
  rpo_minutes: number;
  rto_minutes: number;
  evidence: string;
  limitation: string;
};

type Decision = {
  id: number;
  verdict: string;
  comment: string;
  actor: string;
  created_at: string;
};

type Data = {
  dataMode: "test" | "source_only" | "empty";
  scenarios: Scenario[];
  gates: Gate[];
  runs: Array<{
    id: string;
    status: string;
    passed: number;
    failed: number;
    finished_at: string;
    initiated_by: string;
  }>;
  drills: Drill[];
  decisions: Decision[];
  summary: {
    passedScenarios: number;
    totalScenarios: number;
    passedGates: number;
    totalGates: number;
    productionReady: boolean;
    blockedGateIds: string[];
  };
  testLayers: string[];
  boundary: string;
  medicalBoundary: string;
  productionDecision: string;
};

const roles: Record<string, string> = {
  "Контроль качества": "QUALITY",
  Аналитика: "ANALYTICS",
  Интеграции: "INTEGRATIONS",
  Собственник: "OWNER",
  Директор: "DIRECTOR",
  "Представитель Виталия": "REPRESENTATIVE",
};

const tabs = [
  "Визуальная оболочка",
  "10 сценариев",
  "Матрица проверок",
  "Release gates",
  "Recovery и rollback",
  "Решение представителя",
] as const;
type Tab = (typeof tabs)[number];

const visualGates = [
  ["Айдентика", "Единые токены, AH-монограмма, изумрудный каркас и точечный лаймовый акцент"],
  ["Типографика", "Основной и служебный текст приведены к единой читаемой шкале"],
  ["Навигация", "Разделы, история переходов, хлебные крошки, возврат и недавние маршруты"],
  ["Поиск", "Разделы, семьи, сотрудники, договоры, платежи, задачи и быстрые действия"],
  ["Роли", "Персональные профили и серверные ограничения чувствительных данных"],
  ["Интеграции", "Управляющие действия, журнал, конфликты и контрольные данные"],
  ["Адаптивность", "Самостоятельные desktop, tablet и mobile-композиции без переполнения"],
  ["Производительность", "Ленивая загрузка модулей и контролируемый бюджет основного shell"],
] as const;

export function ReadinessWorkspace({ role, notify }: { role: string; notify: (value: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("Визуальная оболочка");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/readiness", {
        cache: "no-store",
        headers: { "x-arthello-role": roles[role] ?? "" },
      });
      const payload = (await response.json()) as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ошибка");
      setData(payload);
      setError("");
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить готовность");
    } finally {
      setLoading(false);
    }
  }, [role]);

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
      const payload = (await response.json()) as { error?: string; passed?: number; failed?: number };
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
        body: JSON.stringify({
          stage: "Единая визуальная оболочка и UX master-route",
          verdict,
          comment: comment.trim(),
        }),
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

  if (loading) return <section className="ahReadinessStatus">Собираем сквозные доказательства…</section>;
  if (error || !data) {
    return (
      <PageContainer className="ahReadinessDenied">
        <Card>
          <EmptyState
            title="Контур готовности недоступен"
            description={error || "Доступ к приёмке ограничен выбранной ролью."}
            density="compact"
            action={<Button onClick={() => void load()}>Повторить</Button>}
          />
        </Card>
      </PageContainer>
    );
  }

  const scenario = data.scenarios.find((item) => item.id === selected) ?? data.scenarios[0];
  const canRun = ["Собственник", "Директор", "Представитель Виталия", "Контроль качества"].includes(role);
  const hasReadinessData = Boolean(
    data.scenarios.length ||
      data.gates.length ||
      data.runs.length ||
      data.drills.length ||
      data.decisions.length ||
      data.testLayers.length,
  );
  const productionStatus = data.summary.productionReady ? "разрешён" : "запрещён";

  return (
    <PageContainer className="ahReadinessPage">
      <PageHeader
        eyebrow="КОНТРОЛЬ · ДОКАЗАТЕЛЬСТВА · ПРИЁМКА"
        title="Готовность ArtHello OS"
        description="Визуальная проверка, сквозные сценарии, ворота выпуска и восстановление собраны в одном проверяемом контуре."
        actions={
          <Button
            variant="primary"
            disabled={!canRun || busy || !data.scenarios.length}
            onClick={() => void runAll()}
          >
            {busy ? "Проверяем…" : "Запустить проверки"}
          </Button>
        }
      />

      <div className="ahReadinessBoundary">
        <strong>{data.summary.productionReady ? "PRODUCTION ПОДТВЕРЖДЁН" : "PRODUCTION НЕ ПОДТВЕРЖДЁН"}</strong>
        <span>{data.productionDecision || data.boundary}</span>
      </div>

      <div className="ahReadinessKpis">
        <KpiCard
          label="Сценарии"
          value={data.summary.totalScenarios}
          note={data.summary.totalScenarios ? "сохранено в контуре" : "не настроены"}
        />
        <KpiCard
          label="Пройдено"
          value={data.summary.passedScenarios}
          note={data.summary.totalScenarios ? "по последнему запуску" : "результатов пока нет"}
        />
        <KpiCard
          label="Ворота выпуска"
          value={`${data.summary.passedGates}/${data.summary.totalGates}`}
          note={data.summary.totalGates ? "по сохранённым результатам" : "не настроены"}
        />
        <KpiCard
          label="Production"
          value={productionStatus}
          note={`${data.summary.blockedGateIds.length} незакрытых gates`}
          className={data.summary.productionReady ? undefined : "ahReadinessKpiBlocked"}
        />
      </div>

      <div className="ahReadinessTabs">
        <Tabs
          items={tabs.map((item) => ({ id: item, label: item }))}
          value={tab}
          onChange={setTab}
          ariaLabel="Разделы контроля готовности"
        />
      </div>

      {tab === "Визуальная оболочка" ? (
        hasReadinessData ? (
          <VisualHandoff />
        ) : (
          <Card className="ahReadinessPanel">
            <EmptyState
              title="Результаты визуальной проверки не добавлены"
              description="Здесь появятся только сохранённые результаты фактической приёмки интерфейса."
              density="compact"
            />
          </Card>
        )
      ) : null}

      {tab === "10 сценариев" ? (
        scenario ? (
          <ScenarioPanel data={data} scenario={scenario} select={setSelected} />
        ) : (
          <Card className="ahReadinessPanel">
            <EmptyState
              title="Сквозные сценарии не настроены"
              description="После настройки здесь появятся шаги, доказательства и результат каждого маршрута."
              density="compact"
            />
          </Card>
        )
      ) : null}

      {tab === "Матрица проверок" ? (
        data.testLayers.length ? (
          <TestMatrix layers={data.testLayers} />
        ) : (
          <Card className="ahReadinessPanel">
            <EmptyState
              title="Матрица проверок пуста"
              description="Добавьте обязательные уровни тестирования и сохранённые результаты."
              density="compact"
            />
          </Card>
        )
      ) : null}

      {tab === "Release gates" ? (
        data.gates.length ? (
          <GatePanel gates={data.gates} />
        ) : (
          <Card className="ahReadinessPanel">
            <EmptyState
              title="Ворота выпуска не определены"
              description="Без обязательных gates система не может считаться готовой к публикации."
              density="compact"
            />
          </Card>
        )
      ) : null}

      {tab === "Recovery и rollback" ? (
        data.drills.length ? (
          <RecoveryPanel drills={data.drills} />
        ) : (
          <Card className="ahReadinessPanel">
            <EmptyState
              title="Учения восстановления не проводились"
              description="Нужны сохранённые RPO, RTO, контрольные суммы и ограничения."
              density="compact"
            />
          </Card>
        )
      ) : null}

      {tab === "Решение представителя" ? (
        <DecisionPanel
          role={role}
          busy={busy}
          comment={comment}
          decisions={data.decisions}
          onComment={setComment}
          onDecision={decide}
        />
      ) : null}
    </PageContainer>
  );
}

function VisualHandoff() {
  return (
    <div className="ahReadinessVisualLayout">
      <Card className="ahReadinessPanel">
        <PanelHead eyebrow="Внутренние ворота" title="Что собрано и проверяется" meta={`${visualGates.length} пунктов`} />
        <div className="ahReadinessVisualGates">
          {visualGates.map(([name, evidence], index) => (
            <CompactListCard
              key={name}
              index={String(index + 1).padStart(2, "0")}
              title={name}
              description={evidence}
            />
          ))}
        </div>
      </Card>
      <Card className="ahReadinessRoute">
        <p>Маршрут представителя</p>
        <h2>Итоговая проверка</h2>
        <ol>
          <li>Переключить роль и проверить персональный дашборд.</li>
          <li>Открыть разделы из каждой группы меню с первого клика.</li>
          <li>Раскрыть KPI, строку, источник, расчёт и связи.</li>
          <li>Проверить поиск и командную палитру.</li>
          <li>Пройти интеграции, журнал и обработку ошибок.</li>
          <li>Запустить сквозные сценарии.</li>
          <li>Зафиксировать решение в последней вкладке.</li>
        </ol>
        <div>
          <strong>Граница проверки</strong>
          <span>Медицинские данные остаются закрытыми по умолчанию. Внешние системы и секреты проверяются только при наличии разрешённого рабочего подключения.</span>
        </div>
      </Card>
    </div>
  );
}

function ScenarioPanel({
  data,
  scenario,
  select,
}: {
  data: Data;
  scenario: Scenario;
  select: (id: string) => void;
}) {
  return (
    <div className="ahReadinessScenarioLayout">
      <Card className="ahReadinessScenarioList">
        <PanelHead eyebrow="Сквозные маршруты" title="Сценарии" meta={String(data.scenarios.length)} />
        <div>
          {data.scenarios.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={item.id === scenario.id}
              onClick={() => select(item.id)}
            >
              <b>{String(item.number).padStart(2, "0")}</b>
              <span><strong>{item.name}</strong><small>{item.chain}</small></span>
              <em className={statusClass(item.status)}>{item.status}</em>
            </button>
          ))}
        </div>
      </Card>
      <Card className="ahReadinessScenarioDetail">
        <header>
          <div><p>{scenario.id} · {scenario.owner_entity_id}</p><h2>{scenario.name}</h2></div>
          <span className={statusClass(scenario.status)}>{scenario.status}</span>
        </header>
        <p className="ahReadinessScenarioBoundary">{scenario.data_boundary}</p>
        <div className="ahReadinessStepRail">
          {scenario.steps.map((step) => (
            <article key={step.id}>
              <b>{String(step.step_order).padStart(2, "0")}</b>
              <div>
                <strong>{step.step_name}</strong>
                <small>{step.entity_type} · {step.entity_id}</small>
                <em>{step.evidence || "Доказательство пока не сохранено"}</em>
              </div>
              <span className={statusClass(step.status)}>{step.status}</span>
            </article>
          ))}
        </div>
        {scenario.data_boundary === data.medicalBoundary ? <footer>{data.medicalBoundary}</footer> : null}
      </Card>
    </div>
  );
}

function TestMatrix({ layers }: { layers: string[] }) {
  return (
    <Card className="ahReadinessPanel">
      <PanelHead eyebrow="Coverage уровней" title="От функции до восстановления" meta={`${layers.length} уровней`} />
      <div className="ahReadinessMatrix">
        {layers.map((layer, index) => (
          <CompactListCard
            key={layer}
            index={String(index + 1).padStart(2, "0")}
            title={layer}
            description="Статус подтверждается сохранённым результатом соответствующей проверки."
          />
        ))}
      </div>
    </Card>
  );
}

function GatePanel({ gates }: { gates: Gate[] }) {
  return (
    <div className="ahReadinessGateGrid">
      {gates.map((gate) => (
        <Card key={gate.id} className="ahReadinessGate">
          <header><span>{gate.id}</span><em className={statusClass(gate.status)}>{gate.status}</em></header>
          <h2>{gate.name}</h2>
          <p>{gate.evidence || "Доказательство пока не сохранено"}</p>
          <footer>{gate.owner_entity_id} · {gate.required ? "обязательный" : "информационный"}</footer>
        </Card>
      ))}
    </div>
  );
}

function RecoveryPanel({ drills }: { drills: Drill[] }) {
  return (
    <div className="ahReadinessRecoveryLayout">
      <Card className="ahReadinessPanel">
        <PanelHead eyebrow="Recovery drills" title="Что реально проверено" meta={String(drills.length)} />
        <div className="ahReadinessDrillList">
          {drills.map((drill) => (
            <article key={drill.id}>
              <header><strong>{drill.drill_type}</strong><span className={statusClass(drill.status)}>{drill.status}</span></header>
              <p>{drill.scope} · {drill.evidence}</p>
              <dl>
                <div><dt>RPO</dt><dd>{drill.rpo_minutes} мин.</dd></div>
                <div><dt>RTO</dt><dd>{drill.rto_minutes} мин.</dd></div>
              </dl>
              <small>Ограничение: {drill.limitation}</small>
            </article>
          ))}
        </div>
      </Card>
      <Card className="ahReadinessRollback">
        <p>Rollback</p>
        <h2>Возврат приложения</h2>
        <strong>Checkpoint + аддитивная схема данных</strong>
        <span>Каждая опубликованная версия неизменяема. Откат интерфейса выполняется на предыдущий checkpoint без разрушительной миграции.</span>
        <div>Rollback приложения не заменяет проверенное восстановление базы.</div>
      </Card>
    </div>
  );
}

function DecisionPanel({
  role,
  busy,
  comment,
  decisions,
  onComment,
  onDecision,
}: {
  role: string;
  busy: boolean;
  comment: string;
  decisions: Decision[];
  onComment: (value: string) => void;
  onDecision: (verdict: "ПРИНЯТО ПРЕДСТАВИТЕЛЕМ" | "ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ") => Promise<void>;
}) {
  const disabled = role !== "Представитель Виталия" || busy || comment.trim().length < 8;
  return (
    <div className="ahReadinessDecisionLayout">
      <Card className="ahReadinessDecisionForm">
        <p>Контроль собственника</p>
        <h2>Итоговая приёмка визуальной оболочки</h2>
        <div>НЕ ЯВЛЯЕТСЯ РАЗРЕШЕНИЕМ НА PRODUCTION</div>
        <label>
          <span>Комментарий представителя</span>
          <textarea
            value={comment}
            onChange={(event) => onComment(event.target.value)}
            placeholder="Решение и конкретные замечания по рабочей проверке"
          />
        </label>
        {role !== "Представитель Виталия" ? <small>Для решения выберите роль «Представитель Виталия».</small> : null}
        <footer>
          <Button disabled={disabled} onClick={() => void onDecision("ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ")}>Отклонить оболочку</Button>
          <Button variant="primary" disabled={disabled} onClick={() => void onDecision("ПРИНЯТО ПРЕДСТАВИТЕЛЕМ")}>Принять оболочку</Button>
        </footer>
      </Card>
      <Card className="ahReadinessDecisionHistory">
        <PanelHead eyebrow="Append-only" title="История решений" meta={String(decisions.length)} />
        {decisions.length ? (
          <div>
            {decisions.map((item, index) => (
              <CompactListCard
                key={item.id}
                index={String(index + 1).padStart(2, "0")}
                title={item.verdict}
                description={`${item.created_at} · ${item.actor} · ${item.comment || "Без комментария"}`}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Решение не зафиксировано"
            description="Приёмка возможна только после обязательных проверок и содержательного комментария."
            density="compact"
          />
        )}
      </Card>
    </div>
  );
}

function PanelHead({ eyebrow, title, meta }: { eyebrow: string; title: string; meta: string }) {
  return (
    <header className="ahReadinessPanelHead">
      <div><p>{eyebrow}</p><h2>{title}</h2></div>
      <span>{meta}</span>
    </header>
  );
}

function statusClass(value: string) {
  if (value === "Пройдено" || value === "Пройден" || value === "Готово") return "ahReadinessStatusPassed";
  if (value === "Заблокировано" || value === "Не выполнено" || value === "Не пройдено") return "ahReadinessStatusBlocked";
  return "ahReadinessStatusLimited";
}
