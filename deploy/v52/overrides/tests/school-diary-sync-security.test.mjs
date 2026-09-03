import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  durableSchoolDiaryResult,
  resolveSchoolDiarySyncUrl,
  safeSchoolDiaryActivationLink,
  safeSchoolDiarySyncError,
  SCHOOL_DIARY_ORIGIN,
} from "../lib/school-diary-sync-security.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("diary sync accepts only a fixed HTTPS origin and fixed internal paths", () => {
  assert.equal(
    resolveSchoolDiarySyncUrl(SCHOOL_DIARY_ORIGIN, "/api/internal/staff-sync"),
    `${SCHOOL_DIARY_ORIGIN}/api/internal/staff-sync`,
  );
  assert.equal(
    resolveSchoolDiarySyncUrl("https://diary.example.test", "/api/internal/family-access-sync", "https://diary.example.test"),
    "https://diary.example.test/api/internal/family-access-sync",
  );
  for (const unsafe of [
    "http://school.arthelloteam.ru",
    "https://school.arthelloteam.ru.evil.test",
    "https://school.arthelloteam.ru@evil.test",
    "https://school.arthelloteam.ru/unexpected-path",
    "https://school.arthelloteam.ru?redirect=https://evil.test",
  ]) {
    assert.throws(() => resolveSchoolDiarySyncUrl(unsafe, "/api/internal/staff-sync"), /не прошёл проверку безопасности/);
  }
});

test("staff and family PII sync never follows redirects and has a bounded request", async () => {
  const [staff, family] = await Promise.all([
    read("../lib/staff-access-sync.ts"),
    read("../lib/family-access-sync.ts"),
  ]);
  for (const source of [staff, family]) {
    assert.match(source, /redirect: "error"/);
    assert.match(source, /AbortSignal\.timeout\(SCHOOL_DIARY_TIMEOUT_MS\)/);
    assert.match(source, /resolveSchoolDiarySyncUrl/);
    assert.match(source, /safeSchoolDiarySyncError/);
    assert.match(source, /durableSchoolDiaryResult\(\{ \.\.\.result, activationLink \}/);
    assert.doesNotMatch(source, /result\.error|HTTP \$\{response\.status\}/);
    const durableWriter = source.slice(source.indexOf("async function mark"));
    assert.doesNotMatch(durableWriter, /activationLink/);
  }
  assert.equal(safeSchoolDiarySyncError(new Error("fetch failed for https://secret.internal")), "Защищённое соединение с дневником временно недоступно");
  assert.deepEqual(durableSchoolDiaryResult({
    activationLink: "https://secret.example/token/bearer",
    expiresAt: "2026-09-04T12:00:00Z",
    deliveryStatus: "delivered",
  }, true), {
    expiresAt: "2026-09-04T12:00:00.000Z",
    deliveryStatus: "Доставлено",
    activationPrepared: true,
  });
  assert.equal(JSON.stringify(durableSchoolDiaryResult({ activationLink: "secret-token" })).includes("secret-token"), false);
  assert.equal(
    safeSchoolDiaryActivationLink("https://school.arthelloteam.ru/activate/one-time", `${SCHOOL_DIARY_ORIGIN}/api/internal/staff-sync`),
    "https://school.arthelloteam.ru/activate/one-time",
  );
  assert.equal(safeSchoolDiaryActivationLink("https://evil.test/activate/one-time", `${SCHOOL_DIARY_ORIGIN}/api/internal/staff-sync`), undefined);
});
