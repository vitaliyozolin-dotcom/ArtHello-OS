import { requiresAssignedReadScope } from "../../../lib/section-read-scope";
import { canAccessApi } from "../../../lib/access-policy";
import { env } from "cloudflare:workers";
import { ensureCoreTables, getSystemDataMode } from "../../../db";
import { canPromoteToProduction, prerequisiteGatesPassed } from "../../../lib/readiness";
import { getAuthenticatedRequestContext } from "../../../lib/production-auth";

type Row = Record<string, unknown>;

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return Response.json({ error: "Сервис авторизации временно недоступен" }, { status: 503 });
  }
  if (!context) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!canAccessApi(context.auth.user, "/api/readiness", "GET")) return Response.json({ error: "Нет доступа к контуру готовности" }, { status: 403 });

  try {
    await ensureCoreTables();
    const scopedRead=requiresAssignedReadScope(context.auth.user,"/api/readiness");
    const dataMode = await getSystemDataMode();
    if (dataMode === "empty" || scopedRead) {
      return Response.json({
        dataMode,
        scenarios: [],
        gates: [],
        runs: [],
        drills: [],
        decisions: [],
        summary: {
          passedScenarios: 0,
          totalScenarios: 0,
          passedGates: 0,
          totalGates: 0,
          prerequisitesReady: false,
          productionReady: false,
          blockedGateIds: [],
        },
        testLayers: [],
        boundary: scopedRead ? "Раздел открыт. Общие сценарии, журналы и решения скрыты: у этих записей ещё нет подтверждённой области доступа по филиалам." : "Сценарии готовности ещё не настроены.",
        medicalBoundary: "Медицинские сведения не используются в проверках готовности.",
        productionDecision: scopedRead ? "Общие проверки и решения скрыты: область доступа к этим записям ещё не назначена." : "Решение о выпуске ещё не сформировано.",
      });
    }

    const [scenarioRows, stepRows, gates, runs, drills, decisions] = await Promise.all([
      all(`SELECT id,number,name,chain,owner_entity_id,status,data_boundary,evidence,failure,last_run_at,duration_ms
        FROM readiness_scenarios ORDER BY number`),
      all(`SELECT id,scenario_id,step_order,step_name,entity_type,entity_id,check_type,status,evidence,checked_at
        FROM readiness_scenario_steps ORDER BY scenario_id,step_order`),
      all("SELECT id,name,status,required,evidence,owner_entity_id,updated_at FROM release_gates ORDER BY id"),
      all(`SELECT id,suite,environment,started_at,finished_at,status,passed,failed,skipped,initiated_by
        FROM readiness_validation_runs ORDER BY finished_at DESC LIMIT 20`),
      all(`SELECT id,drill_type,scope,started_at,finished_at,status,rpo_minutes,rto_minutes,evidence,limitation
        FROM recovery_drills ORDER BY id`),
      all(`SELECT id,stage,verdict,comment,actor,created_at FROM acceptance_decisions
        WHERE stage IN ('Проверка системы','Этап 18 · сквозная проверка и готовность','Единая визуальная оболочка и UX master-route')
        ORDER BY created_at DESC LIMIT 30`),
    ]);
    const scenarios = scenarioRows.map((scenario) => ({
      ...scenario,
      steps: stepRows.filter((step) => step.scenario_id === scenario.id).map((step) => {
        if (step.check_type !== "PROTECTED") return step;
        const publicStep = { ...step };
        delete publicStep.entity_id;
        return { ...publicStep, protected_reference_withheld: true };
      }),
    }));
    const passed = scenarios.filter((scenario) => scenario.status === "Пройдено").length;
    const required = gates.filter((gate) => Boolean(gate.required));
    const blocked = required.filter((gate) => gate.status !== "Пройдено");
    const prerequisitesReady = prerequisiteGatesPassed(gates.map((gate) => ({
      id: String(gate.id),
      status: String(gate.status),
      required: Boolean(gate.required),
    })));
    const ownerApproval = gates.some((gate) => gate.id === "GATE-T-APPROVAL" && Boolean(gate.required) && gate.status === "Пройдено");
    const productionReady = canPromoteToProduction(
      gates.filter((gate) => gate.id !== "GATE-T-APPROVAL").map((gate) => ({
        id: String(gate.id),
        status: String(gate.status),
        required: Boolean(gate.required),
      })),
      ownerApproval,
    );

    return Response.json({
      dataMode,
      scenarios,
      gates,
      runs,
      drills,
      decisions,
      summary: {
        passedScenarios: passed,
        totalScenarios: scenarios.length,
        passedGates: required.length - blocked.length,
        totalGates: required.length,
        prerequisitesReady,
        productionReady,
        blockedGateIds: blocked.map((gate) => gate.id),
      },
      testLayers: ["Модульные", "Проверки обмена данными", "Интеграционные", "База данных", "Изменения базы", "Права доступа", "Происхождение данных", "Сверка", "Сквозные", "Визуальные", "Доступность", "Производительность", "Безопасность", "Восстановление", "Возврат версии", "Совместимость браузеров"],
      boundary: "Проверка системы показывает, какие реальные технические и рабочие проверки пройдены перед выпуском. Она не заменяет решение собственника.",
      medicalBoundary: "Медицинское содержание исключено: проверяется только наличие разрешённой защищённой ссылки и факт аудита.",
      productionDecision: productionReady
        ? "Все обязательные проверки пройдены, выпуск подтверждён собственником."
        : prerequisitesReady
          ? "Обязательные проверки пройдены; требуется отдельное подтверждение собственника."
          : "Выпуск заблокирован, пока не пройдены все обязательные проверки.",
    });
  } catch (error) {
    console.error("Readiness data load failed", error);
    return Response.json({ error: error instanceof Error && error.message.includes("D1 binding") ? "База готовности ещё не подключена" : "Не удалось загрузить готовность" }, { status: 503 });
  }
}

async function all(sql: string) {
  const result = await env.DB.prepare(sql).all<Row>();
  return result.results ?? [];
}
