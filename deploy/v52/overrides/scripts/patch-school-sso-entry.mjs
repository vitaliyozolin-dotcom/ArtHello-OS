import { readFile, writeFile } from "node:fs/promises";

const educationPath = "/app/app/components/EducationWorkspace.tsx";
const settingsPath = "/app/app/components/SettingsWorkspace.tsx";
const centralStaffTestPath = "/app/tests/central-staff-access.test.mjs";

async function replaceExact(path, before, after, label) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before))
    throw new Error(`School SSO patch anchor missing: ${label}`);
  const next = source.replace(before, after);
  if (next === source)
    throw new Error(`School SSO patch did not change: ${label}`);
  await writeFile(path, next, "utf8");
}

async function replaceEveryExact(path, before, after, label) {
  const source = await readFile(path, "utf8");
  const count = source.split(before).length - 1;
  if (count < 1)
    throw new Error(`School SSO patch anchor missing: ${label}`);
  const next = source.split(before).join(after);
  if (next.includes(before))
    throw new Error(`School SSO patch left a legacy anchor: ${label}`);
  await writeFile(path, next, "utf8");
  return count;
}

await replaceExact(
  educationPath,
  'const fmt = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });',
  'const fmt = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });\nconst SCHOOL_DIARY_SSO_URL = "https://school-188-225-38-55.sslip.io/auth/central/start";',
  "education SSO constant",
);

await replaceExact(
  educationPath,
  '      actions={canManage ? <div className="ahEducationHeaderActions"><Button variant="secondary" onClick={() => setImportOpen(true)}>Импортировать</Button><Button variant="primary" onClick={() => setEditor(data.programs.length ? "group" : "program")}>{data.programs.length ? "Добавить" : "Создать программу"}</Button></div> : undefined}',
  '      actions={<div className="ahEducationHeaderActions">{workspace === "education" ? <Button variant="secondary" onClick={() => window.location.assign(SCHOOL_DIARY_SSO_URL)}>Открыть дневник</Button> : null}{canManage ? <><Button variant="secondary" onClick={() => setImportOpen(true)}>Импортировать</Button><Button variant="primary" onClick={() => setEditor(data.programs.length ? "group" : "program")}>{data.programs.length ? "Добавить" : "Создать программу"}</Button></> : null}</div>}',
  "education SSO action",
);

const retiredPasswordActions = await replaceEveryExact(
  settingsPath,
  '>Сбросить пароль</button>',
  '>Завершить входы</button>',
  "staff diary session action",
);

await replaceExact(
  settingsPath,
  'title={user.status !== "Активен" ? "Сначала восстановите доступ сотрудника" : "Создать логин и одноразовый временный пароль"}',
  'title={user.status !== "Активен" ? "Сначала восстановите доступ сотрудника" : "Создать временный вход только в ArtHello OS"}',
  "temporary credential clarification",
);

const centralStaffTestSource = await readFile(centralStaffTestPath, "utf8");
const legacyWordingCount = centralStaffTestSource.split("Сбросить пароль").length - 1;
if (legacyWordingCount < 1)
  throw new Error("Central staff test has no legacy password wording to migrate");
const migratedCentralStaffTest = centralStaffTestSource
  .split("Сбросить пароль")
  .join("Завершить входы");
await writeFile(centralStaffTestPath, migratedCentralStaffTest, "utf8");

const settings = await readFile(settingsPath, "utf8");
if (settings.includes("Сбросить пароль"))
  throw new Error("Legacy diary password wording remains in SettingsWorkspace");
if (!settings.includes("Завершить входы"))
  throw new Error("Session termination wording is absent in SettingsWorkspace");

const centralStaffTest = await readFile(centralStaffTestPath, "utf8");
if (!centralStaffTest.includes("Завершить входы"))
  throw new Error("Central staff test did not adopt the passwordless lifecycle");
if (centralStaffTest.includes("Сбросить пароль"))
  throw new Error("Central staff test still requires a diary password action");

console.log(`SCHOOL_SSO_PASSWORD_ACTIONS_RETIRED=${retiredPasswordActions}`);
console.log(`SCHOOL_SSO_TEST_WORDING_MIGRATED=${legacyWordingCount}`);
console.log("SCHOOL_SSO_CENTRAL_STAFF_CONTRACT=PASSWORDLESS");
console.log("SCHOOL_SSO_UI_PATCH=OK");