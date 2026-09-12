import {
  ArtHelloPayError,
  cancelPayRequest,
  createPayObligation,
  createPayRequest,
  listPayCatalog,
  listPayObligations,
  listPayRequests,
  previewPayRequest,
  publicPayRequest,
  requireArtHelloPayContext,
  searchPayCustomers,
} from "../../../../lib/arthello-pay";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "private, no-store, max-age=0" };
const publicNoStore = {
  "cache-control": "public, no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
};

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function pathSegments(context: RouteContext) {
  const params = await context.params;
  return Array.isArray(params.path) ? params.path : [];
}

function json(data: unknown, status = 200, headers = noStore) {
  return Response.json(data, { status, headers });
}

function errorResponse(error: unknown, isPublic = false) {
  if (error instanceof ArtHelloPayError) {
    return json({ error: error.message }, error.status, isPublic ? publicNoStore : noStore);
  }
  console.error("ArtHello Pay route failed", error);
  return json(
    { error: "ArtHello Pay временно недоступен" },
    503,
    isPublic ? publicNoStore : noStore,
  );
}

async function bodyObject(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new ArtHelloPayError("Требуется application/json", 415);
  }
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtHelloPayError("Некорректный запрос");
  }
  return value as Record<string, unknown>;
}

export async function GET(request: Request, context: RouteContext) {
  const parts = await pathSegments(context);
  const isPublic = parts[0] === "public";
  try {
    if (parts.length === 2 && parts[0] === "public") {
      return json(await publicPayRequest(parts[1] ?? ""), 200, publicNoStore);
    }

    const auth = await requireArtHelloPayContext(request);
    if (parts.length === 1 && parts[0] === "catalog") {
      return json(await listPayCatalog(auth));
    }
    if (parts.length === 1 && parts[0] === "obligations") {
      return json(await listPayObligations(auth));
    }
    if (parts.length === 1 && parts[0] === "requests") {
      return json(await listPayRequests(auth));
    }
    if (parts.length === 1 && parts[0] === "customers") {
      const url = new URL(request.url);
      return json(
        await searchPayCustomers(
          auth,
          url.searchParams.get("branchCrmId")?.trim() ?? "",
          url.searchParams.get("q")?.trim() ?? "",
        ),
      );
    }
    return json({ error: "Маршрут ArtHello Pay не найден" }, 404);
  } catch (error) {
    return errorResponse(error, isPublic);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const parts = await pathSegments(context);
  try {
    const auth = await requireArtHelloPayContext(request, true);
    if (parts.length === 1 && parts[0] === "obligations") {
      return json(await createPayObligation(auth, await bodyObject(request)), 201);
    }
    if (
      parts.length === 4 &&
      parts[0] === "obligations" &&
      parts[2] === "requests" &&
      parts[3] === "preview"
    ) {
      return json(await previewPayRequest(auth, parts[1] ?? ""));
    }
    if (
      parts.length === 3 &&
      parts[0] === "obligations" &&
      parts[2] === "requests"
    ) {
      return json(
        await createPayRequest(
          auth,
          parts[1] ?? "",
          request.headers.get("idempotency-key"),
        ),
        201,
      );
    }
    if (
      parts.length === 3 &&
      parts[0] === "requests" &&
      parts[2] === "cancel"
    ) {
      return json(await cancelPayRequest(auth, parts[1] ?? ""));
    }
    return json({ error: "Маршрут ArtHello Pay не найден" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
