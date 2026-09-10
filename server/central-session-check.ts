import { createHmac } from "node:crypto";
import { institution } from "../lib/institution.mjs";

export async function centralStaffSessionIsCurrent(identity: {
  centralUserId: string | null; accessVersion: number; role: string;
}) {
  const secret = process.env.CENTRAL_ACCESS_SECRET?.trim() ?? "";
  if (!identity.centralUserId || !Number.isSafeInteger(identity.accessVersion) || identity.accessVersion < 1 || secret.length < 32) return false;
  try {
    const origin = new URL(process.env.ARTHELLO_PUBLIC_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return false;
    const body = JSON.stringify({ systemId: institution.systemId, branchId: institution.branchId, identity });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(new URL("/api/atlas-sso/check", origin), {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json", "content-length": String(Buffer.byteLength(body)),
        "x-arthello-timestamp": timestamp,
        "x-arthello-signature": createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
      }, body,
    });
    if (!response.ok) return false;
    const result = await response.json() as { ok?: boolean; systemId?: string; branchId?: string };
    return result.ok === true && result.systemId === institution.systemId && result.branchId === institution.branchId;
  } catch { return false; }
}
