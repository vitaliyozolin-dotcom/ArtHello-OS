import assert from "node:assert/strict";
import test from "node:test";
import { runDiarySmoke } from "../../deploy/diary-directory-smoke.mjs";

test("smoke refuses a public destination before sending synthetic pupil data", async () => {
  let calls = 0;
  await assert.rejects(
    runDiarySmoke({
      origin: "https://school.example",
      systemId: "SYS-SCHOOL-1-11",
      branchId: "BR-SCHOOL",
      secret: "s".repeat(40),
      fetch: async () => {
        calls++;
      },
    }),
    /isolated/,
  );
  assert.equal(calls, 0);
});

test("smoke fails closed when unsigned writes are accepted", async () => {
  await assert.rejects(
    runDiarySmoke({
      origin: "http://127.0.0.1:3000",
      systemId: "SYS-SCHOOL-1-11",
      branchId: "BR-SCHOOL",
      secret: "s".repeat(40),
      fetch: async () => Response.json({}),
    }),
    /unsigned/,
  );
});
