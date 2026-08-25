import { acceptInvitation, getInvitation } from "../../../../../lib/production-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const invite = await getInvitation(token);
    return Response.json({
      fullName: invite.full_name,
      phone: invite.phone,
      position: invite.position,
      branch: invite.branch,
      role: invite.access_role,
      expiresAt: invite.expires_at,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ссылка недействительна" }, { status: 410 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const payload = await request.json() as { password?: unknown };
    const result = await acceptInvitation(token, payload.password);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось активировать доступ" }, { status: 400 });
  }
}
