import { ensureCoreTables, getSystemDataMode } from "../../../db";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    return Response.json({ systemDataMode: await getSystemDataMode() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { systemDataMode: "unknown", error: "Не удалось подтвердить режим данных" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
