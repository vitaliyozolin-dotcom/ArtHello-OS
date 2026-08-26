import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const overrideRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const componentPath = resolve(overrideRoot, "app/components/SettingsWorkspace.tsx");
const cssPath = resolve(overrideRoot, "app/components/ShellFoundation.css");
const [component, css] = await Promise.all([
  readFile(componentPath, "utf8"),
  readFile(cssPath, "utf8"),
]);

test("backup tab is gated to the canonical administrative owner", () => {
  assert.match(component, /data\?\.me\.id === "USR-OWNER" && data\.me\.role === "Собственник" && data\.me\.isAdministrative === true/);
  assert.match(component, /isCanonicalOwner \? \[\.\.\.baseTabs, "Резервные копии"\] : baseTabs/);
  assert.match(component, /tab === "Резервные копии" && isCanonicalOwner/);
});

test("backup UI reads canonical metadata and starts manual copies with CSRF", () => {
  assert.match(component, /fetch\("\/api\/settings\/backups", \{ cache: "no-store" \}\)/);
  assert.match(component, /body: JSON\.stringify\(\{ action: "create" \}\)/);
  assert.match(component, /readClientCookie\("__Host-arthello_csrf"\)/);
  assert.match(component, /response\.status !== 202/);
  assert.match(component, /Создание резервной копии запущено/);
  for (const field of ["lastAutomaticAt", "nextAutomaticAt", "storage.local", "storage.offsite", "point.kind", "point.createdAt", "point.sizeBytes", "point.integrity", "point.compatible"]) {
    assert.ok(component.includes(field), `missing backup metadata field ${field}`);
  }
  assert.match(component, /03:00/);
  assert.match(component, /МСК/);
  assert.match(component, /не меняет версию приложения/);
});

test("restore requires password and exact confirmation, then enters maintenance", () => {
  assert.match(component, /confirmation === "ВОССТАНОВИТЬ"/);
  assert.match(component, /type="password" autoComplete="current-password"/);
  assert.match(component, /action: "restore", backupId: point\.id, confirmation, currentPassword/);
  assert.match(component, /Все данные после выбранной точки будут утрачены/);
  assert.match(component, /система создаст страховочную копию текущего состояния/);
  assert.match(component, /пароли сотрудников будут сброшены/);
  assert.match(component, /Восстановление запущено\./);
  assert.match(component, /fetch\("\/api\/health\/ready", \{ cache: "no-store" \}\)/);
  assert.match(component, /healthReady = payload\?\.status === "ok"/);
  assert.match(component, /getOrCreateBackupIntentKey/);
  assert.match(component, /startMaintenance\(\{ operation: payload\.operation, intentName, intentKey \}\)/);
  assert.match(component, /if \(operationSucceeded\) clearBackupIntentKey\(maintenance\.intentName, maintenance\.intentKey\)/);
  assert.match(component, /уже было завершено и не запускалось повторно/);
  assert.match(component, /activeOperation\.status === "failed"/);
  assert.match(component, /sawHealthOutage/);
  assert.match(component, /sawSessionRevoked/);
  assert.match(component, /response\.status === 401[\s\S]*sawSessionRevoked = true/);
  assert.match(component, /healthReady && \(operationSucceeded \|\| sawSessionRevoked \|\| authenticatedOperationLostAfterRestart\)/);
  assert.match(component, /window\.location\.reload\(\)/);
  assert.match(component, /<RestoreMaintenance \/>/);
  assert.doesNotMatch(component, /(?:localStorage|sessionStorage).*currentPassword/);
  assert.doesNotMatch(component, /console\.(?:log|info|debug).*currentPassword/);
});

test("backup surface deliberately exposes no delete or download actions", () => {
  assert.doesNotMatch(component, /action:\s*["'](?:delete|download)["']/i);
  assert.doesNotMatch(component, />\s*(?:Удалить|Скачать)\s*</i);
});

test("backup and restore layouts have a mobile presentation", () => {
  assert.match(css, /\.backup-workspace\{/);
  assert.match(css, /\.backup-point-row\{/);
  assert.match(css, /\.backup-restore-dialog\{/);
  assert.match(css, /\.backup-maintenance\{/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.backup-overview\{grid-template-columns:1fr\}/);
  assert.match(css, /\.backup-restore-dialog\{width:100vw/);
});
