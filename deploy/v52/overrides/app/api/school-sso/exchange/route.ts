import { exchangeSchoolSsoCode } from "../../../../lib/school-sso";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      code?: unknown;
      codeVerifier?: unknown;
    };
    const exchanged = await exchangeSchoolSsoCode(
      body.code,
      body.codeVerifier,
    );
    return Response.json(
      {
        ok: true,
        identity: exchanged.identity,
        returnTo: exchanged.returnTo,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Код входа недействителен";
    return Response.json(
      { error: message },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
}
