import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("production temporary credentials are one-time, expiring and access-bound", async () => {
  const [auth, route, me, proxy, gate] = await Promise.all([
    read("../lib/production-auth.ts"),
    read("../app/api/settings/temporary-credential/route.ts"),
    read("../app/api/auth/me/route.ts"),
    read("../proxy.ts"),
    read("../app/components/ProductionAuthGate.tsx"),
  ]);

  assert.match(auth, /TEMPORARY_PASSWORD_TTL_SECONDS = 48 \* 60 \* 60/);
  assert.match(auth, /PBKDF2_ITERATIONS = 310_000/);
  assert.match(auth, /password_hash TEXT NOT NULL/);
  assert.doesNotMatch(auth, /temporary_password\s+TEXT/);
  assert.match(auth, /DELETE FROM production_auth_sessions WHERE user_id=\?/);
  assert.match(auth, /credentialLoginMatchesAccess/);
  assert.match(auth, /access\.app_role !== access\.grant_role/);
  assert.match(auth, /!API_ROLE_BY_GRANT\[access\.grant_role\]/);
  assert.match(auth, /access\.app_user_id === "USR-OWNER"/);

  assert.match(route, /isCanonicalOwnerContext/);
  assert.match(route, /verifyAuthenticatedRequestCsrf/);
  assert.match(route, /cache-control.*private, no-store/);
  assert.match(me, /getAuthenticatedRequestContext/);
  assert.match(proxy, /context\.auth\.user\.mustChangePassword/);
  assert.match(proxy, /headers\.set\("x-arthello-role", context\.apiRole\)/);
  assert.match(proxy, /if \(!canAccessApi\(context\.apiRole, pathname, request\.method\)\)/);
  assert.match(proxy, /const API_RULES/);
  assert.match(proxy, /if \(role === "OWNER"\) return true/);
  assert.match(proxy, /if \(!rule\) return false/);
  assert.doesNotMatch(proxy, /ROLE_CODES/);
  assert.match(gate, /placeholder="Телефон или email"/);
  assert.doesNotMatch(gate, /defaultValue="owner"/);
});
