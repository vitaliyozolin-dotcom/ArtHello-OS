"use client";

import { useCallback, useEffect, useState } from "react";
import { humanTechnicalText } from "../../lib/record-labels";
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
    prerequisitesReady: boolean;
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
  "Условия выпуска",
  "Восстановление",
  "Решение собственника",
] as const;
type Tab = (typeof tabs)[number];

const visualGates = [
  ["Айдентика", "Единые стили, монограмма ArtHello, изумрудный каркас и точечный лаймовый акцент"],
  ["Типографика", "Основной и служебный текст приведены к единой читаемой шкале"],
  ["Навигация", "Разделы, история переходов, хлебные крошки, возврат и недавние маршруты"],
  ["Поиск", "Разделы, семьи, сотрудники, договоры, платежи, задачи и быстрые действия"],
  ["Роли", "Персональные профили и системные ограничения чувствительных данных"],
  ["Интеграции", "Управляющие действия, журнал, конфликты и контрольные данные"],
  ["Адаптивность", "Самостоятельные композиции для компьютера, планшета и телефона без переполнения"],
  ["Производительность", "Отложенная загрузка разделов и контролируемый объём основной оболочки"],
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
        headers: {
          "content-type": "application/json",
          "x-arthello-role": roles[role] ?? "",
          "x-csrf-token": readClientCookie("__Host-arthello_csrf"),
        },
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

  async function decide(verdict: "ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ" | "ТРЕБУЕТ ДОРАБОТКИ") {
    if (role !== "Собственник") return;
    if (comment.trim().length < 8) {
      notify("Добавьте конкретный комментарий — минимум 8 символов");
      return;
    }
    if (verdict === "ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ" && !data?.summary.prerequisitesReady) {
      notify("Сначала завершите все обязательные проверки");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/acceptance", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": readClientCookie("__Host-arthello_csrf"),
        },
        body: JSON.stringify({
          verdict,
          comment: comment.trim(),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Решение не сохранено");
      setComment("");
      notify(verdict === "ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ" ? "Выпуск подтверждён собственником" : "Система возвращена на доработку");
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
            description={error || "Доступ к проверке системы ограничен выбранной ролью."}
            density="compact"
            action={<Button onClick={() => void load()}>Повторить</Button>}
          />
        </Card>
      </PageContainer>
    );
  }

  const scenario = data.scenarios.find((item) => item.id === selected) ?? data.scenarios[0];
  const canRun = ["Собственник", "Директор", "Контроль качества"].includes(role);
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
        eyebrow="КОНТРОЛЬ · ДОКАЗАТЕЛЬСТВА · РЕШЕНИЕ"
        title="Проверка системы"
        description="Показывает, какие функции, права, данные и процедуры восстановления реально проверены перед рабочим выпуском."
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
        <strong>{data.summary.productionReady ? "РАБОЧИЙ ВЫПУСК ПОДТВЕРЖДЁН" : "РАБОЧИЙ ВЫПУСК НЕ ПОДТВЕРЖДЁН"}</strong>
        <span>{data.productionDecision || data.boundary}</span>
      </div>

      <Card className="ahReadinessPurpose">
        <strong>Зачем это нужно</strong>
        <span>Здесь собственник видит незакрытые проверки и принимает итоговое решение только после подтверждённых результатов. Раздел не создаёт данные и не выдаёт разрешение автоматически.</span>
      </Card>

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
          label="Обязательные проверки"
          value={`${data.summary.passedGates}/${data.summary.totalGates}`}
          note={data.summary.totalGates ? "по сохранённым результатам" : "не настроены"}
        />
        <KpiCard
          label="Рабочий выпуск"
          value={productionStatus}
          note={`${data.summary.blockedGateIds.length} незакрытых проверок`}
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
              description="Здесь появятся только сохранённые результаты фактической проверки интерфейса."
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

      {tab === "Условия выпуска" ? (
        data.gates.length ? (
          <GatePanel gates={data.gates} />
        ) : (
          <Card className="ahReadinessPanel">
            <EmptyState
              title="Обязательные проверки не определены"
              description="Без обязательных проверок система не может считаться готовой к публикации."
              density="compact"
            />
          </Card>
        )
      ) : null}

      {tab === "Восстановление" ? (
        data.drills.length ? (
          <RecoveryPanel drills={data.drills} />
        ) : (
          <Card className="ahReadinessPanel">
            <EmptyState
              title="Учения восстановления не проводились"
              description="Нужны сохранённые допустимые потери данных, время восстановления, контрольные суммы и ограничения."
              density="compact"
            />
          </Card>
        )
      ) : null}

      {tab === "Решение собственника" ? (
        <DecisionPanel
          role={role}
          busy={busy}
          comment={comment}
          decisions={data.decisions}
          prerequisitesReady={data.summary.prerequisitesReady}
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
        <PanelHead eyebrow="Внутренние проверки" title="Что собрано и проверяется" meta={`${visualGates.length} пунктов`} />
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
        <p>Маршрут собственника</p>
        <h2>Итоговая проверка</h2>
        <ol>
          <li>Переключить роль и проверить персональный дашборд.</li>
          <li>Открыть разделы из каждой группы меню с первого клика.</li>
          <li>Раскрыть показатель, строку, источник, расчёт и связи.</li>
          <li>Проверить поиск и командную палитру.</li>
          <li>Пройти интеграции, журнал и обработку ошибок.</li>
          <li>Запустить сквозные сценарии.</li>
          <li>После закрытия обязательных проверок зафиксировать решение собственника.</li>
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
              <b>№{String(item.number).padStart(2, "0")}</b>
              <span><strong>{humanEvidence(item.name)}</strong><small>{humanEvidence(item.chain)}</small></span>
              <em className={statusClass(item.status)}>{item.status}</em>
            </button>
          ))}
        </div>
      </Card>
      <Card className="ahReadinessScenarioDetail">
        <header>
          <div><p>Сценарий №{scenario.number} · ответственный назначен</p><h2>{humanEvidence(scenario.name)}</h2></div>
          <span className={statusClass(scenario.status)}>{scenario.status}</span>
        </header>
        <p className="ahReadinessScenarioBoundary">{humanEvidence(scenario.data_boundary)}</p>
        <div className="ahReadinessStepRail">
          {scenario.steps.map((step) => (
            <article key={step.id}>
              <b>{String(step.step_order).padStart(2, "0")}</b>
              <div>
                <strong>{humanEvidence(step.step_name)}</strong>
                <small>{humanEntityType(step.entity_type)} · проверяемая запись</small>
                <em>{humanEvidence(step.evidence) || "Доказательство пока не сохранено"}</em>
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
      <PanelHead eyebrow="Покрытие проверками" title="От функции до восстановления" meta={`${layers.length} уровней`} />
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
      {gates.map((gate, index) => (
        <Card key={gate.id} className="ahReadinessGate">
          <header><span>Проверка №{index + 1}</span><em className={statusClass(gate.status)}>{gate.status}</em></header>
          <h2>{gate.name}</h2>
          <p>{humanEvidence(gate.evidence) || "Доказательство пока не сохранено"}</p>
          <footer>Ответственный назначен · {gate.required ? "обязательная" : "информационная"}</footer>
        </Card>
      ))}
    </div>
  );
}

function RecoveryPanel({ drills }: { drills: Drill[] }) {
  return (
    <div className="ahReadinessRecoveryLayout">
      <Card className="ahReadinessPanel">
        <PanelHead eyebrow="Учения по восстановлению" title="Что реально проверено" meta={String(drills.length)} />
        <div className="ahReadinessDrillList">
          {drills.map((drill) => (
            <article key={drill.id}>
              <header><strong>{humanEvidence(drill.drill_type)}</strong><span className={statusClass(drill.status)}>{drill.status}</span></header>
              <p>{humanEvidence(drill.scope)} · {humanEvidence(drill.evidence)}</p>
              <dl>
                <div><dt>Допустимая потеря данных</dt><dd>{drill.rpo_minutes} мин.</dd></div>
                <div><dt>Время восстановления</dt><dd>{drill.rto_minutes} мин.</dd></div>
              </dl>
              <small>Ограничение: {humanEvidence(drill.limitation)}</small>
            </article>
          ))}
        </div>
      </Card>
      <Card className="ahReadinessRollback">
        <p>Возврат версии</p>
        <h2>Возврат приложения</h2>
        <strong>Контрольная версия и безопасное расширение данных</strong>
        <span>Каждая опубликованная версия неизменяема. Интерфейс возвращается к предыдущей контрольной версии без разрушительного изменения базы.</span>
        <div>Возврат приложения не заменяет проверенное восстановление базы.</div>
      </Card>
    </div>
  );
}

function DecisionPanel({
  role,
  busy,
  comment,
  decisions,
  prerequisitesReady,
  onComment,
  onDecision,
}: {
  role: string;
  busy: boolean;
  comment: string;
  decisions: Decision[];
  prerequisitesReady: boolean;
  onComment: (value: string) => void;
  onDecision: (verdict: "ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ" | "ТРЕБУЕТ ДОРАБОТКИ") => Promise<void>;
}) {
  const disabled = role !== "Собственник" || busy || comment.trim().length < 8;
  return (
    <div className="ahReadinessDecisionLayout">
      <Card className="ahReadinessDecisionForm">
        <p>Контроль собственника</p>
        <h2>Итоговое решение по проверке системы</h2>
        <div>{prerequisitesReady ? "ОБЯЗАТЕЛЬНЫЕ ПРОВЕРКИ ПРОЙДЕНЫ" : "ВЫПУСК ПОКА ЗАБЛОКИРОВАН"}</div>
        <label>
          <span>Комментарий собственника</span>
          <textarea
            value={comment}
            onChange={(event) => onComment(event.target.value)}
            placeholder="Что проверено или что именно нужно доработать"
          />
        </label>
        {role !== "Собственник" ? <small>Итоговое решение доступно только собственнику.</small> : !prerequisitesReady ? <small>Подтверждение станет доступно после всех обязательных проверок. Вернуть на доработку можно сейчас.</small> : null}
        <footer>
          <Button disabled={disabled} onClick={() => void onDecision("ТРЕБУЕТ ДОРАБОТКИ")}>Вернуть на доработку</Button>
          <Button variant="primary" disabled={disabled || !prerequisitesReady} onClick={() => void onDecision("ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ")}>Подтвердить выпуск</Button>
        </footer>
      </Card>
      <Card className="ahReadinessDecisionHistory">
        <PanelHead eyebrow="История без перезаписи" title="История решений" meta={String(decisions.length)} />
        {decisions.length ? (
          <div>
            {decisions.map((item, index) => (
              <CompactListCard
                key={item.id}
                index={String(index + 1).padStart(2, "0")}
                title={humanVerdict(item.verdict)}
                description={`${formatDateTime(item.created_at)} · решение записано · ${item.comment || "Без комментария"}`}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Решение не зафиксировано"
            description="Подтверждение возможно только после обязательных проверок и содержательного комментария собственника."
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

function humanEntityType(value: string) {
  if (value === "Grant") return "Разрешение доступа";
  if (value === "Audit") return "Журнал действий";
  if (value === "AI-сигнал") return "Аналитический сигнал";
  if (value === "KPI") return "Показатель";
  return value;
}

function humanEvidence(value: string) {
  if (/CONTROL:EVIDENCE(?::|$)/i.test(value.trim())) return "Нужно добавить проверяемое доказательство вручную";
  return humanTechnicalText(value)
    .replace(/\s{2,}/g, " ")
    .trim();
}

function humanVerdict(value: string) {
  if (value === "ПРИНЯТО ПРЕДСТАВИТЕЛЕМ") return "Историческое решение: принято представителем";
  if (value === "ОТКЛОНЕНО ПРЕДСТАВИТЕЛЕМ") return "Историческое решение: возвращено на доработку";
  return value;
}

function formatDateTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(timestamp))
    : "Дата не указана";
}

function readClientCookie(name: string) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!item) return "";
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ""; }
}
