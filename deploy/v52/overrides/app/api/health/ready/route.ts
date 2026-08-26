import { env } from "cloudflare:workers";

type D1Statement = {
  first: <T>() => Promise<T | null>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
};

const RESPONSE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  expires: "0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

function response(status: "ok" | "not_ready", httpStatus: number) {
  return new Response(JSON.stringify({ status }), {
    status: httpStatus,
    headers: RESPONSE_HEADERS,
  });
}

export async function GET() {
  try {
    const database = (env as unknown as { DB?: D1Database }).DB;
    if (!database) return response("not_ready", 503);

    const core = await database.prepare(`SELECT state_value
      FROM system_runtime_state
      WHERE state_key='core_schema' AND length(trim(state_value)) > 0`).first<{ state_value: string }>();
    const owner = await database.prepare(`SELECT 1 AS ready
      FROM app_users u
      JOIN user_system_access g
        ON g.user_id=u.id AND g.system_id='SYS-ARTHELLO-OS'
      WHERE u.id='USR-OWNER'
        AND u.status='Активен'
        AND u.role='Собственник'
        AND u.is_administrative=1
        AND g.status='Активен'
        AND g.role='Собственник'`).first<{ ready: number }>();
    const credential = await database.prepare(`SELECT 1 AS ready
      FROM production_auth_credentials
      WHERE user_id='AUTH-OWNER'
        AND length(trim(login)) > 0
        AND length(password_salt) > 0
        AND length(password_hash) > 0`).first<{ ready: number }>();

    return core && owner?.ready === 1 && credential?.ready === 1
      ? response("ok", 200)
      : response("not_ready", 503);
  } catch {
    return response("not_ready", 503);
  }
}
