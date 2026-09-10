import { ensureCoreTables, getSystemDataMode } from "../../../db";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request: Request) {
  if (!getRequestUser(request)) return Response.json({ error: "Требуется вход" }, { status: 401 });
  try {
    await ensureCoreTables();
    return Response.json({ systemDataMode: await getSystemDataMode() });
  } catch {
    return Response.json({ systemDataMode: "test" });
  }
}
