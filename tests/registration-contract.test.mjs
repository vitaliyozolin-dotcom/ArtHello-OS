import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const routeSource = await readFile(new URL("../app/api/school/route.ts", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../app/school-app.tsx", import.meta.url), "utf8");

test("legacy registration tables remain readable during migration", () => {
  assert.match(schemaSource, /sqliteTable\("account_invitations"/);
  assert.match(schemaSource, /sqliteTable\("registration_requests"/);
  assert.match(routeSource, /family\.registration\.request/);
  assert.match(routeSource, /family\.registration\.approve/);
});

test("invitation tokens are stored as hashes and expire", () => {
  assert.match(routeSource, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(routeSource, /token_hash/);
  assert.match(routeSource, /expires_at/);
  assert.doesNotMatch(schemaSource, /token:\s*text\("token"/);
});

test("local registration is blocked before any mutation", () => {
  assert.match(routeSource, /centralDirectoryActions\.has\(action\)/);
  assert.match(routeSource, /управляются только в ArtHello OS/);
  assert.match(uiSource, /Локальная регистрация отключена/);
});

test("school no longer offers a local student or family creation action", () => {
  assert.doesNotMatch(uiSource, />Добавить ученика<\/button>/);
  assert.match(uiSource, /Выдача доступа перенесена в карточку семьи/);
});
