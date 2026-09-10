import { appendClearedAuthCookies, changePassword } from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
    await changePassword(request, payload.currentPassword, payload.newPassword);
    const headers = new Headers({ "cache-control": "no-store" });
    appendClearedAuthCookies(headers);
    return Response.json({ status: "ok" }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось изменить пароль";
    return Response.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
