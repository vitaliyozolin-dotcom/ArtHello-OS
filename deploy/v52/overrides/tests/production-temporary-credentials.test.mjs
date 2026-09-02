import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("production temporary credentials are one-time, expiring and access-bound", async () => {
  const [auth, route, me, login, password, logout, proxy, gate, shell, runtime] = await Promise.all([
    read("../lib/production-auth.ts"),
    read("../app/api/settings/temporary-credential/route.ts"),
    read("../app/api/auth/me/route.ts"),
    read("../app/api/auth/login/route.ts"),
    read("../app/api/auth/password/route.ts"),
    read("../app/api/auth/logout/route.ts"),
    read("../proxy.ts"),
    read("../app/components/ProductionAuthGate.tsx"),
    read("../app/components/ArtHelloShell.tsx"),
    read("../production/runtime-server.mjs"),
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
  assert.match(login, /ensureCoreTables/);
  assert.match(login, /ensureBootstrapOwnerAccess/);
  assert.match(login, /appendAuthCookies/);
  assert.match(password, /verifyAuthenticatedRequestCsrf/);
  assert.match(password, /appendClearedAuthCookies/);
  assert.match(logout, /verifyAuthenticatedRequestCsrf/);
  assert.match(logout, /appendClearedAuthCookies/);
  assert.match(proxy, /context\.auth\.user\.mustChangePassword/);
  assert.match(proxy, /headers\.set\("x-arthello-role", context\.apiRole\)/);
  assert.match(proxy, /if \(!isAuthSessionAction && !canAccessApi\(context\.auth\.user, pathname, request\.method\)\)/);
  assert.match(proxy, /from "\.\/lib\/access-policy"/);
  assert.match(proxy, /headers\.set\("x-arthello-system-owner", context\.auth\.user\.isSystemOwner \? "1" : "0"\)/);
  assert.doesNotMatch(proxy, /ROLE_CODES/);
  assert.match(gate, /placeholder="Телефон или email"/);
  assert.doesNotMatch(gate, /defaultValue="owner"/);
  assert.match(gate, /fetchWithTimeout\("\/api\/auth\/logout"/);
  assert.match(gate, /clearUserDashboardLayouts/);
  assert.match(gate, /finally \{\s*setBusy\(false\)/);
  assert.match(gate, /Выйти и войти другим пользователем/);
  assert.match(shell, /useProductionAuthActions/);
  assert.match(shell, /Выйти из ArtHello OS/);
  assert.match(runtime, /ARTHELLO_PUBLIC_ORIGIN/);
  assert.doesNotMatch(runtime, /\/api\/auth\/(?:login|password|logout)/);
});
