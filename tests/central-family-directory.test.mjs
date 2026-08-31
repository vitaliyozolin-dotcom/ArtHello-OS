import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("diary accepts central family projections and blocks local duplicates", async () => {
  const [route, sync, login, broker] = await Promise.all([
    readFile(new URL("../app/api/school/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/api/internal/family-access-sync/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../server/identity-broker.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /centralDirectoryActions/);
  assert.match(route, /Дневник принимает подписанную проекцию/);
  assert.match(sync, /syncFamilyProjection/);
  assert.match(sync, /identity_source = 'arthello_os'/);
  assert.match(sync, /createPasswordlessInvitation/);
  assert.match(sync, /requiresPassword: false/);
  assert.match(sync, /loginLink/);
  assert.doesNotMatch(sync, /createCredentialToken/);
  assert.match(login, /Телефон или email/);
  assert.match(login, /Получить код/);
  assert.match(login, /Войти по выданному паролю/);
  assert.match(login, /Сотрудникам не нужен второй пароль/);
  assert.match(broker, /role IN \('parent', 'student'\)/);
});
