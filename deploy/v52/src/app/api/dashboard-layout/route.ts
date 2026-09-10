import { eq } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, systemRuntimeState } from "../../../db/schema";
import {
  DASHBOARD_LAYOUT_VERSION,
  dashboardLayoutStateKey,
  validateDashboardLayout,
} from "../../../lib/dashboard-layout";
import {
  getAuthenticatedRequestContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../lib/production-auth";

export const dynamic = "force-dynamic";

const MAX_LAYOUT_BYTES = 4_096;
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
};

export async function GET(request: Request) {
  const authenticated = await authenticate(request);
  if (authenticated instanceof Response) return authenticated;

  try {
    await ensureCoreTables();
    const stateKey = dashboardLayoutStateKey(authenticated.appUserId, authenticated.auth.user.appRole);
    const [stored] = await getDb().select().from(systemRuntimeState)
      .where(eq(systemRuntimeState.stateKey, stateKey)).limit(1);
    if (!stored) return response({ version: DASHBOARD_LAYOUT_VERSION, layout: null });

    const parsed = parseStoredLayout(stored.stateValue, authenticated.auth.user.appRole);
    return response({
      version: DASHBOARD_LAYOUT_VERSION,
      layout: parsed,
      updatedAt: parsed ? stored.updatedAt : undefined,
    });
  } catch {
    return response({ error: "Не удалось загрузить настройку главного экрана" }, 503);
  }
}

export async function PUT(request: Request) {
  const authenticated = await authenticate(request);
  if (authenticated instanceof Response) return authenticated;

  try {
    verifyAuthenticatedRequestCsrf(request, authenticated);
  } catch {
    return response({ error: "Защитная сессия устарела. Войдите заново." }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_LAYOUT_BYTES) return response({ error: "Настройка экрана слишком большая" }, 413);

  let value: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_LAYOUT_BYTES) {
      return response({ error: "Настройка экрана слишком большая" }, 413);
    }
    value = JSON.parse(raw);
  } catch {
    return response({ error: "Некорректный JSON настройки экрана" }, 400);
  }

  const validated = validateDashboardLayout(value, authenticated.auth.user.appRole);
  if (!validated.ok) return response({ error: validated.error }, 400);

  try {
    await ensureCoreTables();
    const db = getDb();
    const stateKey = dashboardLayoutStateKey(authenticated.appUserId, authenticated.auth.user.appRole);
    const updatedAt = new Date().toISOString();
    await db.insert(systemRuntimeState).values({
      stateKey,
      stateValue: JSON.stringify(validated.layout),
      updatedAt,
    }).onConflictDoUpdate({
      target: systemRuntimeState.stateKey,
      set: { stateValue: JSON.stringify(validated.layout), updatedAt },
    });
    await db.insert(auditEvents).values({
      actor: authenticated.actor,
      action: "dashboard.layout_saved",
      entityType: "dashboard_layout",
      entityId: stateKey,
      payload: JSON.stringify({ widgetIds: validated.layout.widgets.map((widget) => widget.id) }),
    });
    return response({ version: DASHBOARD_LAYOUT_VERSION, layout: validated.layout, updatedAt });
  } catch {
    return response({ error: "Не удалось сохранить настройку главного экрана" }, 503);
  }
}

export async function DELETE(request: Request) {
  const authenticated = await authenticate(request);
  if (authenticated instanceof Response) return authenticated;

  try {
    verifyAuthenticatedRequestCsrf(request, authenticated);
    await ensureCoreTables();
    const db = getDb();
    const stateKey = dashboardLayoutStateKey(authenticated.appUserId, authenticated.auth.user.appRole);
    await db.delete(systemRuntimeState).where(eq(systemRuntimeState.stateKey, stateKey));
    await db.insert(auditEvents).values({
      actor: authenticated.actor,
      action: "dashboard.layout_reset",
      entityType: "dashboard_layout",
      entityId: stateKey,
      payload: "{}",
    });
    return response({ version: DASHBOARD_LAYOUT_VERSION, layout: null });
  } catch (error) {
    const csrf = error instanceof Error && error.message.includes("Защитная сессия");
    return response(
      { error: csrf ? "Защитная сессия устарела. Войдите заново." : "Не удалось сбросить настройку главного экрана" },
      csrf ? 403 : 503,
    );
  }
}

async function authenticate(request: Request) {
  try {
    const context = await getAuthenticatedRequestContext(request);
    return context ?? response({ error: "Требуется вход" }, 401);
  } catch {
    return response({ error: "Сервис авторизации временно недоступен" }, 503);
  }
}

function parseStoredLayout(value: string, appRole: string) {
  try {
    const validated = validateDashboardLayout(JSON.parse(value), appRole);
    return validated.ok ? validated.layout : null;
  } catch {
    return null;
  }
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}
