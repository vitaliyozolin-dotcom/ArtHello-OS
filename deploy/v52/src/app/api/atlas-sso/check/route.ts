import { env } from "cloudflare:workers";
import { requireCurrentAtlasSsoIdentity, type AtlasSsoIdentity } from "../../../../lib/atlas-sso";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const deny = (status = 403) => Response.json({ ok: false }, { status, headers });

/** Server-to-server read-only check. A local diary session never grants access by itself. */
export async function POST(request: Request) {
  const secret = (env as unknown as { ATLAS_CENTRAL_ACCESS_SECRET?: string }).ATLAS_CENTRAL_ACCESS_SECRET ?? "";
  if (secret.length < 32) return deny(503);
  const timestamp = request.headers.get("x-arthello-timestamp") ?? "";
  const signature = request.headers.get("x-arthello-signature") ?? "";
  const length = request.headers.get("content-length") ?? "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60
    || !/^[0-9a-f]{64}$/.test(signature) || !/^\d{1,4}$/.test(length)
    || Number(length) < 1 || Number(length) > 2048
    || request.headers.get("content-type")?.split(";")[0] !== "application/json"
    || (request.headers.get("content-encoding") ?? "identity") !== "identity") return deny();
  try {
    const reader = request.body?.getReader();
    if (!reader) return deny();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2048) { await reader.cancel(); return deny(413); }
      chunks.push(value);
    }
    if (bytes !== Number(length)) return deny();
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key,
      Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16)),
      new TextEncoder().encode(`${timestamp}.${body}`));
    if (!valid) return deny();
    const payload = JSON.parse(body) as { systemId?: string; branchId?: string; identity?: AtlasSsoIdentity };
    if (payload.systemId !== "SYS-SCHOOL-ATLAS" || payload.branchId !== "BR-ATLAS-SCHOOL" || !payload.identity) return deny();
    await requireCurrentAtlasSsoIdentity(payload.identity.centralUserId, payload.identity);
    return Response.json({ ok: true, systemId: "SYS-SCHOOL-ATLAS", branchId: "BR-ATLAS-SCHOOL" }, { headers });
  } catch { return deny(); }
}
