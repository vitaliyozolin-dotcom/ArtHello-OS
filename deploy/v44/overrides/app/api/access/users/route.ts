import { createEmployeeAndInvitation, listEmployees, requireAccessAdmin } from "../../../../lib/production-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAccessAdmin(request);
    return Response.json({ users: await listEmployees() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ошибка доступа" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAccessAdmin(request);
    const payload = await request.json() as Record<string, unknown>;
    const origin = new URL(request.url).origin;
    const result = await createEmployeeAndInvitation(payload, origin);
    return Response.json(result, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось создать приглашение" }, { status: 400 });
  }
}
