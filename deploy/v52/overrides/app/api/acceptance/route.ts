import { env } from "cloudflare:workers";
import { ensureCoreTables } from "../../../db";
import { manualEvidence, requiredGatesPassed } from "../../../lib/readiness";
import {
  getAuthenticatedRequestContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../lib/production-auth";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  all: <T>() => Promise<{ results: T[] }>;
  first: <T>() => Promise<T | null>;
};

type AcceptanceEnv = {
  DB: {
    prepare: (query: string) => D1Statement;
    batch: (statements: D1Statement[]) => Promise<unknown[]>;
  };
};

type GateRow = { id: string; name: string; status: string; required: number };
type DecisionRow = { id: number; stage: string; verdict: string; comment: string; actor: string; created_at: string };

const STAGE = "Проверка системы";
const APPROVAL_GATE = "GATE-T-APPROVAL";
const CONFIRMED = "ПОДТВЕРЖДЕНО СОБСТВЕННИКОМ";
const NEEDS_WORK = "ТРЕБУЕТ ДОРАБОТКИ";
const allowedVerdicts = new Set([CONFIRMED, NEEDS_WORK]);
const readers = new Set(["OWNER", "DIRECTOR", "QUALITY"]);
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;
  if (!readers.has(context.apiRole)) return json({ error: "Нет доступа к проверке системы" }, 403);
  try {
    await ensureCoreTables();
    const result = await database().prepare(`SELECT id,stage,verdict,comment,actor,created_at
      FROM acceptance_decisions
      WHERE stage IN (?,?,?) ORDER BY created_at DESC LIMIT 30`)
      .bind(STAGE, "Этап 18 · сквозная проверка и готовность", "Единая визуальная оболочка и UX master-route")
      .all<DecisionRow>();
    return json({ decisions: result.results ?? [] });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const context = await authenticate(request);
  if (context instanceof Response) return context;
  if (context.apiRole !== "OWNER" || !context.auth.user.isSystemOwner) {
    return json({ error: "Итоговое решение может зафиксировать только собственник" }, 403);
  }
  try {
    verifyAuthenticatedRequestCsrf(request, context);
  } catch {
    return json({ error: "Защитная сессия устарела. Войдите заново." }, 403);
  }

  try {
    await ensureCoreTables();
    const body = await request.json() as Record<string, unknown>;
    const verdict = clean(body.verdict, 60);
    if (!allowedVerdicts.has(verdict)) return json({ error: "Некорректное решение" }, 400);
    const evidence = manualEvidence(body.comment);
    if (!evidence.ok) return json({ error: evidence.error }, 400);

    const gateResult = await database().prepare("SELECT id,name,status,required FROM release_gates ORDER BY id")
      .all<GateRow>();
    const gates = gateResult.results ?? [];
    const approvalGate = gates.find((gate) => gate.id === APPROVAL_GATE && Boolean(gate.required));
    const prerequisites = gates.filter((gate) => gate.id !== APPROVAL_GATE);
    const prerequisitesReady = requiredGatesPassed(prerequisites);
    if (verdict === CONFIRMED && (!approvalGate || !prerequisitesReady)) {
      const blocked = prerequisites.filter((gate) => gate.required && gate.status !== "Пройдено").map((gate) => gate.name);
      return json({
        error: approvalGate ? "Сначала завершите все обязательные проверки" : "Обязательная проверка решения собственника не настроена",
        blocked,
      }, 409);
    }

    const createdAt = new Date().toISOString();
    const decisionRef = `ACCEPTANCE-${crypto.randomUUID()}`;
    const gateStatus = verdict === CONFIRMED ? "Пройдено" : "Заблокировано";
    const gateEvidence = verdict === CONFIRMED
      ? "Все обязательные проверки пройдены; выпуск подтверждён собственником"
      : "Собственник вернул систему на доработку";
    const auditPayload = JSON.stringify({ stage: STAGE, verdict, productionReady: verdict === CONFIRMED });
    const writes = verdict === CONFIRMED
      ? [
          database().prepare(`INSERT INTO acceptance_decisions (stage,verdict,comment,actor,created_at)
            SELECT ?,?,?,?,?
            WHERE EXISTS (SELECT 1 FROM release_gates WHERE id=? AND required=1)
              AND NOT EXISTS (SELECT 1 FROM release_gates WHERE required=1 AND id<>? AND status<>'Пройдено')`)
            .bind(STAGE, verdict, evidence.evidence, context.actor, createdAt, APPROVAL_GATE, APPROVAL_GATE),
          database().prepare(`UPDATE release_gates SET status=?,evidence=?,owner_entity_id=?,updated_at=?
            WHERE id=? AND required=1
              AND NOT EXISTS (SELECT 1 FROM release_gates WHERE required=1 AND id<>? AND status<>'Пройдено')`)
            .bind(gateStatus, gateEvidence, "Собственник", createdAt, APPROVAL_GATE, APPROVAL_GATE),
          database().prepare(`INSERT INTO audit_events (actor,action,entity_type,entity_id,payload,created_at)
            SELECT ?,'acceptance.recorded','acceptance',?,?,?
            WHERE EXISTS (SELECT 1 FROM release_gates WHERE id=? AND required=1)
              AND NOT EXISTS (SELECT 1 FROM release_gates WHERE required=1 AND id<>? AND status<>'Пройдено')`)
            .bind(context.actor, decisionRef, auditPayload, createdAt, APPROVAL_GATE, APPROVAL_GATE),
        ]
      : [
          database().prepare(`INSERT INTO acceptance_decisions
            (stage,verdict,comment,actor,created_at) VALUES (?,?,?,?,?)`)
            .bind(STAGE, verdict, evidence.evidence, context.actor, createdAt),
          database().prepare(`UPDATE release_gates SET status=?,evidence=?,owner_entity_id=?,updated_at=?
            WHERE id=?`)
            .bind(gateStatus, gateEvidence, "Собственник", createdAt, APPROVAL_GATE),
          database().prepare(`INSERT INTO audit_events
            (actor,action,entity_type,entity_id,payload,created_at) VALUES (?,'acceptance.recorded','acceptance',?,?,?)`)
            .bind(context.actor, decisionRef, auditPayload, createdAt),
        ];
    const writeResults = await database().batch(writes);
    if (verdict === CONFIRMED) {
      const gateWrite = writeResults[1] as { meta?: { changes?: number } } | undefined;
      const auditWrite = writeResults[2] as { meta?: { changes?: number } } | undefined;
      const confirmed = gateWrite?.meta?.changes === 1 && auditWrite?.meta?.changes === 1;
      if (!confirmed) {
        return json({ error: "Условия выпуска изменились. Повторите проверку перед подтверждением" }, 409);
      }
    }
    const decision = await database().prepare(`SELECT id,stage,verdict,comment,actor,created_at
      FROM acceptance_decisions WHERE actor=? AND created_at=? ORDER BY id DESC LIMIT 1`)
      .bind(context.actor, createdAt).first<DecisionRow>();
    return json({ decision, productionReady: verdict === CONFIRMED }, 201);
  } catch (error) {
    return databaseError(error);
  }
}

async function authenticate(request: Request) {
  try {
    const context = await getAuthenticatedRequestContext(request);
    return context ?? json({ error: "Требуется вход" }, 401);
  } catch {
    return json({ error: "Сервис авторизации временно недоступен" }, 503);
  }
}

function database() {
  return (env as unknown as AcceptanceEnv).DB;
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

function databaseError(error: unknown) {
  console.error("Acceptance storage operation failed", error);
  const message = error instanceof Error ? error.message : "Ошибка базы данных";
  const unavailable = message.includes("no such table") || message.includes("D1 binding");
  return json({ error: unavailable ? "Журнал проверки ещё не подготовлен" : "Не удалось выполнить операцию" }, 503);
}
