import { getAuthenticatedSession } from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authenticated = await getAuthenticatedSession(request);
  if (!authenticated) {
    return Response.json({ error: "Требуется вход" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  return Response.json(authenticated.user, { headers: { "cache-control": "no-store" } });
}
