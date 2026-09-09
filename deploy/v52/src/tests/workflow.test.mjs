import assert from "node:assert/strict";
import test from "node:test";

test("workflow source fixes the ordered lifecycle and completion gates", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../lib/workflow.ts", import.meta.url), "utf8"));
  assert.match(source, /Входящие.*Запланировано.*В работе.*На проверке.*Выполнено/s);
  assert.match(source, /Сначала завершите чек-лист/);
  assert.match(source, /Сначала завершите подзадачи/);
  assert.match(source, /Результат должен согласовать руководитель/);
});

test("stage 3 keeps the contract-expiry automation explicit", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../db/index.ts", import.meta.url), "utf8"));
  assert.match(source, /CONTRACT_EXPIRY:DOG-T-2026-044/);
  assert.match(source, /ROLE:DIRECTOR/);
  assert.match(source, /task\.auto_created/);
});
