import { createSchoolSsoUrl } from "../../../../server/school-sso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function loginRedirect(request: Request) {
  const target = new URL("/login", request.url);
  const returnTo = `${new URL(request.url).pathname}${new URL(request.url).search}`;
  target.searchParams.set("returnTo", returnTo);
  return Response.redirect(target, 303);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const target = await createSchoolSsoUrl(
      request,
      url.searchParams.get("returnTo"),
    );
    return new Response(null, {
      status: 303,
      headers: {
        location: target,
        "cache-control": "no-store",
        pragma: "no-cache",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Требуется вход")) return loginRedirect(request);
    const target = new URL("/", request.url);
    target.searchParams.set("schoolAccess", "failed");
    return Response.redirect(target, 303);
  }
}
