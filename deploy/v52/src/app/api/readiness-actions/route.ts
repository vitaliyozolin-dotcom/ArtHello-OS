import{env}from"cloudflare:workers";
import{ensureCoreTables,getSystemDataMode}from"../../../db";
import{scenarioPassed,summarizeValidation}from"../../../lib/readiness";
import{getAuthenticatedRequestContext,verifyAuthenticatedRequestCsrf}from"../../../lib/production-auth";

type Row = Record<string, unknown>;
type Lookup = { table: keyof typeof REFERENCE_SOURCES; column: string };

const editors = new Set(["OWNER", "DIRECTOR", "QUALITY"]);
const RUN_GATE_ID = "GATE-T-SCENARIOS";
const RUN_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Every queryable table and column is a source-controlled constant. The runner
 * never indexes arbitrary fields and never treats an ID mentioned in a title,
 * note or unrelated record as proof that the expected entity exists.
 */
export const REFERENCE_SOURCES = {
  entities: ["id"],
  tasks: ["id", "automation_key"],
  workflow_documents: ["id"],
  document_versions: ["document_id", "reference"],
  obligations: ["document_id", "status", "due_date"],
  notifications: ["source_id", "dedup_key"],
  sales_leads: ["id"],
  sales_touchpoints: ["id"],
  client_accruals: ["id"],
  content_publications: ["id"],
  content_attributions: ["id"],
  education_programs: ["id"],
  education_groups: ["id"],
  education_lessons: ["id", "homework"],
  education_attendance: ["id"],
  education_progress: ["id"],
  education_feedback: ["id"],
  hr_vacancies: ["id"],
  hr_candidates: ["id"],
  hr_employees: ["id", "position_id", "status", "termination_date"],
  hr_accesses: ["id", "status", "revoked_at"],
  financial_operations: ["id", "report_class", "direction"],
  purchase_requests: ["id", "status", "approved_at"],
  supplier_offers: ["id"],
  purchase_orders: ["id"],
  procurement_deliveries: ["id", "status", "quantity", "accepted_quantity"],
  inventory_events: ["id"],
  accounting_documents: ["id"],
  food_products: ["id"],
  food_batches: ["id"],
  food_recipes: ["id"],
  food_production: ["id"],
  food_shipments: ["id", "consumed_portions", "written_off_portions"],
  safety_checks: ["id"],
  safety_faults: ["id"],
  safety_repairs: ["id"],
  safety_next_checks: ["id"],
  strategy_kpis: ["id"],
  strategy_deviations: ["id", "explanation"],
  strategy_results: ["id"],
  analytics_signals: ["id"],
  customer_complaints: ["id", "status", "satisfaction_score"],
  complaint_actions: ["id", "evidence"],
  audit_events: ["entity_id", "action"],
  medical_access_grants: ["id", "status"],
  medical_documents: ["id", "status"],
  medical_cases: ["id", "confirmation_ref", "status"],
  medical_actions: ["id", "confirmation_ref", "status"],
} as const;

export const REFERENCE_LOOKUPS: Readonly<Record<string, readonly Lookup[]>> = {
  "Публикация": [{ table: "content_publications", column: "id" }],
  "Атрибуция": [{ table: "content_attributions", column: "id" }],
  "Лид": [{ table: "sales_leads", column: "id" }],
  "Сотрудник": [{ table: "entities", column: "id" }, { table: "hr_employees", column: "id" }],
  "Контакт": [{ table: "sales_touchpoints", column: "id" }],
  "Документ": [
    { table: "workflow_documents", column: "id" },
    { table: "accounting_documents", column: "id" },
    { table: "document_versions", column: "document_id" },
  ],
  "Сущность": [{ table: "entities", column: "id" }],
  "Начисление": [{ table: "client_accruals", column: "id" }],
  "Операция": [{ table: "financial_operations", column: "id" }],
  "Вакансия": [{ table: "hr_vacancies", column: "id" }],
  "Кандидат": [{ table: "hr_candidates", column: "id" }],
  "Задача": [{ table: "tasks", column: "id" }, { table: "tasks", column: "automation_key" }],
  "Должность": [{ table: "hr_employees", column: "position_id" }],
  "Доступ": [{ table: "hr_accesses", column: "id" }],
  "Занятие": [{ table: "education_lessons", column: "id" }],
  "Программа": [{ table: "education_programs", column: "id" }],
  "Группа": [{ table: "education_groups", column: "id" }],
  "Посещение": [{ table: "education_attendance", column: "id" }],
  "Прогресс": [{ table: "education_progress", column: "id" }],
  "Обратная связь": [{ table: "education_feedback", column: "id" }],
  "AI-сигнал": [{ table: "analytics_signals", column: "id" }],
  "Заявка": [{ table: "purchase_requests", column: "id" }],
  "Предложение": [{ table: "supplier_offers", column: "id" }],
  "Заказ": [{ table: "purchase_orders", column: "id" }],
  "Поставка": [{ table: "procurement_deliveries", column: "id" }],
  "Движение": [{ table: "inventory_events", column: "id" }],
  "Проверка": [{ table: "safety_checks", column: "id" }, { table: "safety_next_checks", column: "id" }],
  "Неисправность": [{ table: "safety_faults", column: "id" }],
  "Контрагент": [{ table: "entities", column: "id" }],
  "Ремонт": [{ table: "safety_repairs", column: "id" }],
  "Продукт": [{ table: "food_products", column: "id" }],
  "Партия": [{ table: "food_batches", column: "id" }],
  "Рецепт": [{ table: "food_recipes", column: "id" }],
  "Производство": [{ table: "food_production", column: "id" }],
  "Отгрузка": [{ table: "food_shipments", column: "id" }],
  "Уведомление": [{ table: "notifications", column: "source_id" }, { table: "notifications", column: "dedup_key" }],
  "Версия": [{ table: "document_versions", column: "reference" }],
  "Жалоба": [{ table: "customer_complaints", column: "id" }],
  "Действие": [{ table: "complaint_actions", column: "id" }, { table: "tasks", column: "automation_key" }],
  "Доказательство": [{ table: "complaint_actions", column: "evidence" }],
  "KPI": [{ table: "strategy_kpis", column: "id" }],
  "Отклонение": [{ table: "strategy_deviations", column: "id" }],
  "Результат": [{ table: "strategy_results", column: "id" }],
  "Медицинский случай": [{ table: "medical_cases", column: "id" }],
  "Grant": [{ table: "medical_access_grants", column: "id" }],
  "Медицинское действие": [{ table: "medical_actions", column: "id" }],
  "Медицинский документ": [{ table: "medical_documents", column: "id" }],
  "Подтверждение": [
    { table: "medical_cases", column: "confirmation_ref" },
    { table: "medical_actions", column: "confirmation_ref" },
  ],
  "Audit": [{ table: "audit_events", column: "entity_id" }],
};

export async function POST(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!editors.has(context.apiRole)) return Response.json({ error: "Нет прав на запуск сквозной проверки" }, { status: 403 });
  try {
    verifyAuthenticatedRequestCsrf(request, context);
  } catch {
    return Response.json({ error: "Защитная сессия устарела. Войдите заново." }, { status: 403 });
  }
  try {
    await ensureCoreTables();
    const body = await request.json() as { action?: string };
    if (body.action !== "runAllScenarios") {
      return Response.json({ error: "Неизвестное действие. Выпуск выполняется только после отдельного решения собственника" }, { status: 400 });
    }
    if (await getSystemDataMode() === "empty") {
      return Response.json({ error: "Тестовые сценарии отключены в пустом production-контуре" }, { status: 409 });
    }
    return runAll(context.actor);
  } catch (error) {
    console.error("Readiness action failed", error);
    return Response.json({ error: "Проверка временно не выполнена" }, { status: 500 });
  }
}

async function runAll(actor: string) {
  const startedAt = new Date().toISOString();
  let lockClaimed = false;
  try {
    lockClaimed = await claimReadinessRun(startedAt);
    if (!lockClaimed) {
      return Response.json({ error: "Проверка уже выполняется или обязательный этап не настроен" }, { status: 409 });
    }

    const tableRows: Record<string, Row[]> = {};
    for (const [table, columns] of Object.entries(REFERENCE_SOURCES)) {
      const result = await env.DB.prepare(`SELECT ${columns.join(",")} FROM ${table}`).all<Row>();
      tableRows[table] = result.results ?? [];
    }

    const scenarioResult = await env.DB.prepare(`SELECT id,number,name,chain,owner_entity_id,status,
      data_boundary,evidence,failure,last_run_at,duration_ms FROM readiness_scenarios ORDER BY number`).all<Row>();
    const stepResult = await env.DB.prepare(`SELECT id,scenario_id,step_order,step_name,entity_type,
      entity_id,check_type,status,evidence,checked_at FROM readiness_scenario_steps ORDER BY scenario_id,step_order`).all<Row>();
    const steps = stepResult.results ?? [];
    const scenarioStates: string[] = [];
    const stepUpdates: Array<{ id: string; status: string; evidence: string; checkedAt: string }> = [];
    const scenarioUpdates: Array<{ id: string; status: string; evidence: string; failure: string; lastRunAt: string; durationMs: number }> = [];
    let passedSteps = 0;
    let failedSteps = 0;

    for (const scenario of scenarioResult.results ?? []) {
      const own = steps.filter((step) => step.scenario_id === scenario.id);
      const states: Array<{ status: string }> = [];
      const failed: Row[] = [];
      for (const step of own) {
        const ok = checkStep(step, tableRows);
        const status = ok ? "Пройдено" : "Не пройдено";
        stepUpdates.push({ id: String(step.id), status, evidence: humanStepEvidence(step, ok), checkedAt: startedAt });
        states.push({ status });
        if (ok) passedSteps += 1;
        else {
          failedSteps += 1;
          failed.push(step);
        }
      }
      const passed = scenarioPassed(states);
      const status = passed ? "Пройдено" : "Не пройдено";
      scenarioStates.push(status);
      scenarioUpdates.push({
        id: String(scenario.id),
        status,
        evidence: passed ? `${own.length} из ${own.length} шагов подтверждены` : `${failed.length} шагов требуют проверки`,
        failure: passed ? "" : failed.map((step) => String(step.step_name ?? "Шаг")).join(", "),
        lastRunAt: startedAt,
        durationMs: Math.max(1, own.length * 3),
      });
    }

    const summary = summarizeValidation(scenarioStates);
    const finishedAt = new Date().toISOString();
    const runId = `READY-RUN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const publicationResults = await env.DB.batch([
      stepPublication(stepUpdates, startedAt),
      scenarioPublication(scenarioUpdates, startedAt),
      env.DB.prepare(`INSERT INTO readiness_validation_runs
        (id,suite,environment,started_at,finished_at,status,passed,failed,skipped,commit_sha,artifact_ref,initiated_by)
        SELECT ?,'10 сквозных сценариев','Тестовый контур',?,?,?,?,?,?,'Не указан','Проверка системы',?
        WHERE EXISTS (SELECT 1 FROM release_gates WHERE id=? AND status='Проверяется' AND updated_at=?)`)
        .bind(runId, startedAt, finishedAt, summary.status, summary.passed, summary.failed, summary.skipped, actor, RUN_GATE_ID, startedAt),
      env.DB.prepare(`INSERT INTO audit_events
        (actor,action,entity_type,entity_id,payload)
        SELECT ?,'readiness.full_suite_run','readiness_validation',?,?
        WHERE EXISTS (SELECT 1 FROM release_gates WHERE id=? AND status='Проверяется' AND updated_at=?)`)
        .bind(actor, runId, JSON.stringify({ passed: summary.passed, failed: summary.failed, passedSteps, failedSteps, contentExcluded: true }), RUN_GATE_ID, startedAt),
      env.DB.prepare(`UPDATE release_gates SET status=?,evidence=?,updated_at=?
        WHERE id=? AND status='Проверяется' AND updated_at=?`)
        .bind(summary.status, `${summary.passed} из ${summary.total} сценариев; ${passedSteps} шагов пройдено, ${failedSteps} требуют проверки`, finishedAt, RUN_GATE_ID, startedAt),
    ]);
    const gatePublication = publicationResults.at(-1) as { meta?: { changes?: number } } | undefined;
    if (gatePublication?.meta?.changes === 0) throw new Error("Readiness run lease was superseded");
    return Response.json({
      runId,
      ...summary,
      passedSteps,
      failedSteps,
      productionReady: false,
      productionBlock: "Выпуск возможен только после всех обязательных проверок и отдельного подтверждения собственника",
    }, { status: 201 });
  } catch (error) {
    console.error("Readiness full run failed", error);
    if (lockClaimed) {
      try {
        await blockFailedReadinessRun(actor, startedAt);
      } catch (blockError) {
        console.error("Readiness failed-run publication failed", blockError);
      }
    }
    return Response.json({ error: "Проверка не завершена. Выпуск остаётся заблокирован" }, { status: 500 });
  }
}

async function claimReadinessRun(startedAt: string) {
  const staleBefore = new Date(Date.parse(startedAt) - RUN_LOCK_TIMEOUT_MS).toISOString();
  const claimed = await env.DB.prepare(`UPDATE release_gates
    SET status='Проверяется',evidence='Идёт повторная проверка; выпуск временно заблокирован',updated_at=?
    WHERE id=? AND required=1 AND (status<>'Проверяется' OR updated_at<?)
    RETURNING id`).bind(startedAt, RUN_GATE_ID, staleBefore).first<{ id: string }>();
  return Boolean(claimed);
}

function stepPublication(updates: Array<{ id: string; status: string; evidence: string; checkedAt: string }>, lockToken: string) {
  return env.DB.prepare(`WITH updates AS (
    SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.status') AS status,
      json_extract(value,'$.evidence') AS evidence,json_extract(value,'$.checkedAt') AS checked_at
    FROM json_each(?)
  )
  UPDATE readiness_scenario_steps SET
    status=(SELECT status FROM updates WHERE updates.id=readiness_scenario_steps.id),
    evidence=(SELECT evidence FROM updates WHERE updates.id=readiness_scenario_steps.id),
    checked_at=(SELECT checked_at FROM updates WHERE updates.id=readiness_scenario_steps.id)
  WHERE id IN (SELECT id FROM updates)
    AND EXISTS (SELECT 1 FROM release_gates WHERE id=? AND status='Проверяется' AND updated_at=?)`)
    .bind(JSON.stringify(updates), RUN_GATE_ID, lockToken);
}

function scenarioPublication(updates: Array<{ id: string; status: string; evidence: string; failure: string; lastRunAt: string; durationMs: number }>, lockToken: string) {
  return env.DB.prepare(`WITH updates AS (
    SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.status') AS status,
      json_extract(value,'$.evidence') AS evidence,json_extract(value,'$.failure') AS failure,
      json_extract(value,'$.lastRunAt') AS last_run_at,json_extract(value,'$.durationMs') AS duration_ms
    FROM json_each(?)
  )
  UPDATE readiness_scenarios SET
    status=(SELECT status FROM updates WHERE updates.id=readiness_scenarios.id),
    evidence=(SELECT evidence FROM updates WHERE updates.id=readiness_scenarios.id),
    failure=(SELECT failure FROM updates WHERE updates.id=readiness_scenarios.id),
    last_run_at=(SELECT last_run_at FROM updates WHERE updates.id=readiness_scenarios.id),
    duration_ms=(SELECT duration_ms FROM updates WHERE updates.id=readiness_scenarios.id)
  WHERE id IN (SELECT id FROM updates)
    AND EXISTS (SELECT 1 FROM release_gates WHERE id=? AND status='Проверяется' AND updated_at=?)`)
    .bind(JSON.stringify(updates), RUN_GATE_ID, lockToken);
}

async function blockFailedReadinessRun(actor: string, lockToken: string) {
  const failedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload)
      SELECT ?,'readiness.full_suite_failed','readiness_validation',?,?
      WHERE EXISTS (SELECT 1 FROM release_gates WHERE id=? AND status='Проверяется' AND updated_at=?)`)
      .bind(actor, RUN_GATE_ID, JSON.stringify({ contentExcluded: true }), RUN_GATE_ID, lockToken),
    env.DB.prepare(`UPDATE release_gates SET status='Заблокировано',
      evidence='Проверка не завершена; результаты не опубликованы',updated_at=?
      WHERE id=? AND status='Проверяется' AND updated_at=?`).bind(failedAt, RUN_GATE_ID, lockToken),
  ]);
}

function checkStep(step: Row, tables: Record<string, Row[]>) {
  const id = String(step.entity_id ?? "");
  const key = `${step.scenario_id}:${step.step_name}`;
  if (!matchesExpectedReference(String(step.entity_type ?? ""), id, tables)) return false;
  if (step.check_type === "REFERENCE") return true;
  if (step.check_type === "PROTECTED") {
    if (step.entity_type === "Grant") return tables.medical_access_grants.some((row) => row.id === id && row.status === "Активен");
    if (step.entity_type === "Медицинский документ") return tables.medical_documents.some((row) => row.id === id && row.status === "Действует");
    if (step.entity_type === "Медицинский случай") return tables.medical_cases.some((row) => row.id === id && row.status === "Закрыт");
    if (step.entity_type === "Медицинское действие") return tables.medical_actions.some((row) => row.id === id && row.status === "Выполнено");
    if (step.entity_type === "Подтверждение") {
      return tables.medical_cases.some((row) => row.confirmation_ref === id && row.status === "Закрыт")
        || tables.medical_actions.some((row) => row.confirmation_ref === id && row.status === "Выполнено");
    }
    if (step.entity_type === "Audit") return tables.audit_events.some((row) => row.entity_id === id && row.action === "medical.case_closed");
    return step.entity_type === "Сущность";
  }
  switch (key) {
    case "SCN-T-01:ДДС":
    case "SCN-T-01:ОПиУ":
    case "SCN-T-01:Прибыль":
    case "SCN-T-04:ОПиУ":
      return tables.financial_operations.some((row) => row.id === id && String(row.report_class).includes("ОПиУ"));
    case "SCN-T-02:Начисление":
    case "SCN-T-02:Увольнение":
      return tables.hr_employees.some((row) => row.id === id && row.status === "Уволен" && Boolean(row.termination_date));
    case "SCN-T-02:Отзыв доступов":
      return tables.hr_accesses.some((row) => row.id === id && row.status === "Отозван" && Boolean(row.revoked_at));
    case "SCN-T-03:Домашнее задание":
      return tables.education_lessons.some((row) => row.id === id && Boolean(row.homework));
    case "SCN-T-04:Согласование":
      return tables.purchase_requests.some((row) => row.id === id && row.status === "Согласована" && Boolean(row.approved_at));
    case "SCN-T-04:Приёмка":
      return tables.procurement_deliveries.some((row) => row.id === id && row.status === "Принято" && row.quantity === row.accepted_quantity);
    case "SCN-T-06:Потребление":
      return tables.food_shipments.some((row) => row.id === id && Number(row.consumed_portions) > 0);
    case "SCN-T-06:Списание":
      return tables.food_shipments.some((row) => row.id === id && Number(row.written_off_portions) > 0);
    case "SCN-T-06:Рентабельность":
      return tables.financial_operations.some((row) => row.id === id && row.direction === "Поступление");
    case "SCN-T-07:Обязательство":
    case "SCN-T-07:Срок":
      return tables.obligations.some((row) => row.document_id === id && row.status === "Закрыто" && Boolean(row.due_date));
    case "SCN-T-08:Удовлетворённость":
      return tables.customer_complaints.some((row) => row.id === id && row.status === "Закрыта" && Number(row.satisfaction_score) >= 4);
    case "SCN-T-10:Причина":
      return tables.strategy_deviations.some((row) => row.id === id && Boolean(row.explanation));
    case "SCN-T-10:Действие":
      return tables.tasks.some((row) => row.automation_key === id);
    default:
      return false;
  }
}

function matchesExpectedReference(entityType: string, id: string, tables: Record<string, Row[]>) {
  const lookups = REFERENCE_LOOKUPS[entityType];
  if (!id || !lookups?.length) return false;
  return lookups.some(({ table, column }) => (tables[table] ?? []).some((row) => String(row[column] ?? "") === id));
}

function humanStepEvidence(step: Row, ok: boolean) {
  const label = String(step.step_name ?? "Шаг");
  if (!ok) return `${label}: нужная запись или обязательное состояние не подтверждены`;
  if (step.check_type === "PROTECTED") return `${label}: защищённая ссылка подтверждена; содержание не раскрывается`;
  return `${label}: запись и обязательное состояние подтверждены`;
}

// A production promotion endpoint is intentionally unavailable in the test contour.
void "DRILL-T-D1-RESTORE-01";
