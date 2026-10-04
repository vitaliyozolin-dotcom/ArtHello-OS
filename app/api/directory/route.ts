import { assertSameOrigin, getSessionUser } from "../../../server/auth";
import { ensureDatabaseReady, getDatabase } from "../../../server/database";
import { DirectoryError, directoryState, manageDirectory } from "../../../server/directory-management.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function actor(request: Request) {
  await ensureDatabaseReady();
  const user = await getSessionUser(request);
  if (!user || !["director", "deputy", "admin"].includes(user.role))
    throw new DirectoryError("Нет прав на управление справочниками", 403);
  return user;
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof DirectoryError ? error.message : "Не удалось сохранить. Обновите список и повторите попытку." },
    { status: error instanceof DirectoryError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: Request) {
  try { await actor(request); return Response.json(getDatabase().withSqlite(directoryState), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (!request.headers.get("origin")) throw new DirectoryError("Не подтверждён источник запроса",403);
    try { assertSameOrigin(request); } catch { throw new DirectoryError("Запрос с другого сайта запрещён",403); }
    const user = await actor(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DirectoryError("Ожидается JSON",415);
    const body = await request.json();
    return Response.json(getDatabase().withSqlite(db => manageDirectory(db, user, body)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
