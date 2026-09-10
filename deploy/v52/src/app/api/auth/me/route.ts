import { getAuthenticatedRequestContext } from "../../../../lib/production-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAuthenticatedRequestContext(request);
  if (!context) {
    return Response.json(
      { error: "Требуется вход" },
      { status: 401, headers: { "cache-control": "private, no-store, max-age=0" } },
    );
  }
  return Response.json(
    context.auth.user,
    { headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
