import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const fmt =
  'const fmt = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });';
const legacyAction =
  '      actions={canManage ? <div className="ahEducationHeaderActions"><Button variant="secondary" onClick={() => setImportOpen(true)}>Импортировать</Button><Button variant="primary" onClick={() => setEditor(data.programs.length ? "group" : "program")}>{data.programs.length ? "Добавить" : "Создать программу"}</Button></div> : undefined}';

test("School SSO patch installs once and is a no-op on the second run", () => {
  const fixture = mkdtempSync(join(tmpdir(), "arthello-school-sso-patch-"));
  try {
    writeFixture(fixture, "app/components/EducationWorkspace.tsx", `${fmt}\n${legacyAction}\n`);
    writeFixture(
      fixture,
      "app/components/SettingsWorkspace.tsx",
      '<button>Сбросить пароль</button>\n<div title={user.status !== "Активен" ? "Сначала восстановите доступ сотрудника" : "Создать логин и одноразовый временный пароль"} />\n',
    );
    writeFixture(fixture, "tests/central-staff-access.test.mjs", 'assert.match(source, /Сбросить пароль/);\n');
    for (const relativePath of [
      "lib/school-sso.ts",
      "lib/production-auth.ts",
      "lib/request-security.ts",
      "app/api/school-sso/authorize/route.ts",
      "app/api/school-sso/exchange/route.ts",
    ]) copyFixture(fixture, relativePath);

    const first = runPatch(fixture);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /SCHOOL_SSO_UI_INSTALLS=2/);
    assert.match(first.stdout, /SCHOOL_SSO_PASSWORD_ACTIONS_RETIRED=1/);

    const afterFirst = readFileSync(join(fixture, "app/components/EducationWorkspace.tsx"), "utf8");
    const second = runPatch(fixture);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /SCHOOL_SSO_UI_INSTALLS=0/);
    assert.match(second.stdout, /SCHOOL_SSO_PASSWORD_ACTIONS_RETIRED=0/);
    assert.equal(readFileSync(join(fixture, "app/components/EducationWorkspace.tsx"), "utf8"), afterFirst);
    assert.equal(afterFirst.split("SCHOOL_DIARY_SSO_URL").length - 1, 2);
    assert.equal(afterFirst.split("Открыть дневник").length - 1, 1);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function runPatch(fixture) {
  return spawnSync(process.execPath, [join(projectRoot, "scripts/patch-school-sso-entry.mjs")], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ARTHELLO_PATCH_ROOT: fixture },
  });
}

function writeFixture(root, relativePath, value) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, "utf8");
}

function copyFixture(root, relativePath) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(projectRoot, relativePath), target);
}
