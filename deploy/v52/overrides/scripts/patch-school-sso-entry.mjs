import { readFile, writeFile } from "node:fs/promises";

const educationPath = "/app/app/components/EducationWorkspace.tsx";
const settingsPath = "/app/app/components/SettingsWorkspace.tsx";

async function replaceExact(path, before, after, label) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before))
    throw new Error(`School SSO patch anchor missing: ${label}`);
  const next = source.replace(before, after);
  if (next === source)
    throw new Error(`School SSO patch did not change: ${label}`);
  await writeFile(path, next, "utf8");
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

await replaceExact(
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

console.log("SCHOOL_SSO_UI_PATCH=OK");
