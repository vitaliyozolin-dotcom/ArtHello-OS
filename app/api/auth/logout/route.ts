import { destroySession } from "../../../../server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const cookie = await destroySession(request);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/login",
      "set-cookie": cookie,
      "cache-control": "no-store",
    },
  });
}
