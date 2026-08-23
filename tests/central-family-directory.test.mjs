import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("diary accepts central family projections and blocks local duplicates", async () => {
  const [route, sync, login, auth] = await Promise.all([
    readFile(new URL("../app/api/school/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/family-access-sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/auth.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /centralDirectoryActions/);
  assert.match(route, /Дневник принимает подписанную проекцию/);
  assert.match(sync, /syncFamilyProjection/);
  assert.match(sync, /identity_source = 'arthello_os'/);
  assert.match(login, /Телефон или email/);
  assert.match(auth, /lower\(email\)/);
});
