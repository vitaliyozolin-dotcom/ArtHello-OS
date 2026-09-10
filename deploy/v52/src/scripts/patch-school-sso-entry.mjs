import { readFile, writeFile } from "node:fs/promises";

const appRoot = (process.env.ARTHELLO_PATCH_ROOT || "/app").replace(/\/$/, "");
const appPath = (relativePath) => `${appRoot}/${relativePath}`;
const educationPath = appPath("app/components/EducationWorkspace.tsx");
const settingsPath = appPath("app/components/SettingsWorkspace.tsx");
const centralStaffTestPath = appPath("tests/central-staff-access.test.mjs");

const educationConstantBefore =
  'const fmt = (value: string) => new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });';
const educationConstantAfter = `${educationConstantBefore}\nconst SCHOOL_DIARY_SSO_URL = "https://school-188-225-38-55.sslip.io/auth/central/start";`;
const educationActionBefore =
  '      actions={canManage ? <div className="ahEducationHeaderActions"><Button variant="secondary" onClick={() => setImportOpen(true)}>Импортировать</Button><Button variant="primary" onClick={() => setEditor(data.programs.length ? "group" : "program")}>{data.programs.length ? "Добавить" : "Создать программу"}</Button></div> : undefined}';
const educationActionAfter =
  '      actions={<div className="ahEducationHeaderActions">{workspace === "education" ? <Button variant="secondary" onClick={() => window.location.assign(SCHOOL_DIARY_SSO_URL)}>Открыть дневник</Button> : null}{canManage ? <><Button variant="secondary" onClick={() => setImportOpen(true)}>Импортировать</Button><Button variant="primary" onClick={() => setEditor(data.programs.length ? "group" : "program")}>{data.programs.length ? "Добавить" : "Создать программу"}</Button></> : null}</div>}';

async function ensureExact(path, before, after, label) {
  const source = await readFile(path, "utf8");
  const installed = source.split(after).length - 1;
  if (installed === 1) return 0;
  if (installed > 1)
    throw new Error(`School SSO patch duplicated canonical block: ${label}`);
  const anchors = source.split(before).length - 1;
  if (anchors !== 1)
    throw new Error(`School SSO patch anchor missing or ambiguous: ${label}`);
  await writeFile(path, source.replace(before, after), "utf8");
  return 1;
}

async function replaceLegacy(path, before, after, label) {
  const source = await readFile(path, "utf8");
  const legacyCount = source.split(before).length - 1;
  if (legacyCount > 0) {
    await writeFile(path, source.split(before).join(after), "utf8");
    return legacyCount;
  }
  if (!source.includes(after))
    throw new Error(`School SSO canonical wording is missing: ${label}`);
  return 0;
}

const installedConstant = await ensureExact(
  educationPath,
  educationConstantBefore,
  educationConstantAfter,
  "education SSO constant",
);
const installedAction = await ensureExact(
  educationPath,
  educationActionBefore,
  educationActionAfter,
  "education SSO action",
);

const retiredPasswordActions = await replaceLegacy(
  settingsPath,
  ">Сбросить пароль</button>",
  ">Завершить входы</button>",
  "staff diary session action",
);
const clarifiedTemporaryAccess = await replaceLegacy(
  settingsPath,
  'title={user.status !== "Активен" ? "Сначала восстановите доступ сотрудника" : "Создать логин и одноразовый временный пароль"}',
  'title={user.status !== "Активен" ? "Сначала восстановите доступ сотрудника" : "Создать временный вход только в ArtHello OS"}',
  "temporary credential clarification",
);
const migratedTestWording = await replaceLegacy(
  centralStaffTestPath,
  "Сбросить пароль",
  "Завершить входы",
  "central staff passwordless wording",
);

const [education, settings, centralStaffTest, broker, authorize, exchange, auth, requestSecurity] =
  await Promise.all([
    readFile(educationPath, "utf8"),
    readFile(settingsPath, "utf8"),
    readFile(centralStaffTestPath, "utf8"),
    readFile(appPath("lib/school-sso.ts"), "utf8"),
    readFile(appPath("app/api/school-sso/authorize/route.ts"), "utf8"),
    readFile(appPath("app/api/school-sso/exchange/route.ts"), "utf8"),
    readFile(appPath("lib/production-auth.ts"), "utf8"),
    readFile(appPath("lib/request-security.ts"), "utf8"),
  ]);

const requireContract = (condition, message) => {
  if (!condition) throw new Error(`School SSO contract failed: ${message}`);
};

requireContract(education.split(educationConstantAfter).length - 1 === 1, "canonical diary URL must appear once");
requireContract(education.split(educationActionAfter).length - 1 === 1, "canonical Education entry must appear once");
requireContract(!settings.includes("Сбросить пароль") && settings.includes("Завершить входы"), "passwordless staff lifecycle wording");
requireContract(!centralStaffTest.includes("Сбросить пароль") && centralStaffTest.includes("Завершить входы"), "passwordless staff test wording");
requireContract(broker.includes("requireCurrentSchoolSsoIdentity") && broker.includes("UPDATE school_sso_codes"), "one-time code and live access validation");
requireContract(
  authorize.includes("requireCurrentSchoolSsoIdentity") &&
    authorize.includes("artHelloPublicOrigin") &&
    authorize.includes("loginRedirect(url, centralOrigin)") &&
    !authorize.includes('new URL("/school-sso/login", url.origin)') &&
    !authorize.includes("fetch("),
  "authorization must use the trusted external central origin and must not self-fetch",
);
requireContract(exchange.includes("exchangeSchoolSsoCode"), "public exchange handler");
requireContract(auth.includes("HttpOnly; Secure; SameSite=Lax"), "cross-site top-level central session");
requireContract(requestSecurity.includes('"/api/school-sso/exchange": "POST"'), "public POST exchange allowlist");

console.log(`SCHOOL_SSO_UI_INSTALLS=${installedConstant + installedAction}`);
console.log(`SCHOOL_SSO_PASSWORD_ACTIONS_RETIRED=${retiredPasswordActions}`);
console.log(`SCHOOL_SSO_TEMPORARY_ACCESS_CLARIFIED=${clarifiedTemporaryAccess}`);
console.log(`SCHOOL_SSO_TEST_WORDING_MIGRATED=${migratedTestWording}`);
console.log("SCHOOL_SSO_CENTRAL_STAFF_CONTRACT=PASSWORDLESS");
console.log("SCHOOL_SSO_UI_PATCH=OK");
