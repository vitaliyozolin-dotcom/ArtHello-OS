import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const system = read("../app/components/SystemWorkspace.tsx");
const systemStyles = read("../app/components/SystemWorkspace.ds.css");
const settings = read("../app/components/SettingsWorkspace.tsx");
const settingsStyles = read("../app/components/SettingsWorkspace.ds.css");
const designSystemStyles = read("../app/components/design-system/design-system.css");

const escapeRegExp = (value) => value.replace(/[.*+?^\$\{\}()|[\]\\]/g, "\\$&");

function importedNames(source, moduleName) {
  const match = source.match(new RegExp(`import\\s*\\{([^{}]*)\\}\\s*from\\s*["']${escapeRegExp(moduleName)}["']`));
  assert.ok(match, `named import from ${moduleName} is missing`);
  return new Set(match[1].split(",").map((name) => name.trim().split(/\\s+as\\s+/)[0]).filter(Boolean));
}

function cssSelectors(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  let boundary = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === "{") {
      const prelude = clean.slice(boundary, index).trim();
      if (prelude && !prelude.startsWith("@")) result.push(...prelude.split(",").map((selector) => selector.trim()).filter(Boolean));
      boundary = index + 1;
    } else if (char === "}") boundary = index + 1;
  }
  return result.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector));
}

test("Wave 10 system modules and settings use shared Design System roles", () => {
  const systemNames = importedNames(system, "./design-system");
  for (const component of ["Button", "Card", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "SearchField", "Tabs"]) assert.ok(systemNames.has(component), `SystemWorkspace must import ${component}`);
  const settingsNames = importedNames(settings, "./design-system");
  for (const component of ["Button", "EmptyState", "Tabs"]) assert.ok(settingsNames.has(component), `SettingsWorkspace must import ${component}`);
  assert.match(system, /import\s*["']\.\/SystemWorkspace\.ds\.css["']/);
  assert.match(settings, /import\s*["']\.\/SettingsWorkspace\.ds\.css["']/);
  assert.match(system, /<PageContainer\b[^>]*className=["']ahSystemPage["']/);
  assert.match(settings, /className=["']ahSettingsLayer["']/);
  assert.match(settings, /className=["']ahSettingsModal["']/);
  assert.match(system, /config\.kpis\.map\([\s\S]*?<KpiCard/);
  assert.match(system, /<SearchField\b/);
  assert.match(system, /<Tabs\b/);
  assert.match(settings, /<Tabs\b/);
});

test("shared Button keeps action icons at control scale", () => {
  assert.match(designSystemStyles, /\.ahButton\s*\{[^}]*display\s*:\s*inline-flex/s);
  assert.match(designSystemStyles, /\.ahButton\s*\{[^}]*align-items\s*:\s*center/s);
  assert.match(designSystemStyles, /\.ahButton\s*\{[^}]*justify-content\s*:\s*center/s);
  assert.match(designSystemStyles, /\.ahButton\s*>\s*svg\s*\{[^}]*width\s*:\s*18px[^}]*height\s*:\s*18px/s);
});

test("Wave 10 keeps every generic system module, tab and action", () => {
  for (const moduleName of ["events", "assets", "quality"]) assert.match(system, new RegExp(`\\b${moduleName}:\\s*emptyConfig`));
  for (const title of ["События", "Имущество", "Качество и обращения"]) assert.match(system, new RegExp(escapeRegExp(title)));
  for (const tab of ["Календарь", "Список", "Объекты", "Помещения", "Обращения", "Корректирующие действия"]) assert.match(system, new RegExp(escapeRegExp(tab)));
  assert.match(system, /onClick=\{createTask\}/);
  assert.match(system, /navigate\("tasks"\)/);
  assert.match(system, /setSelectedId/);
  assert.match(system, /Сбросить поиск/);
  assert.match(system, /Данных пока нет/);
});

test("Wave 10 keeps settings reads, grants and security boundaries", () => {
  assert.match(settings, /fetch\s*\(\s*["']\/api\/settings["']/);
  for (const tab of ["Филиалы", "Пользователи", "Семьи и доступы"]) assert.match(settings, new RegExp(escapeRegExp(tab)));
  for (const action of ["createBranch", "grantFamilyAccess", "resetPassword", "blockUser", "restoreUser", "resetFamilyPassword", "restoreFamilyAccess", "blockFamilyAccess"]) assert.match(settings, new RegExp(`["']${action}["']`));
  for (const field of ["name", "kind", "familyEntityId", "principalEntityId", "role", "login", "contact", "branchIds", "systemIds", "diaryRole"]) assert.match(settings, new RegExp(`name=["']${field}["']`));
  for (const boundary of ["Сотрудники здесь не создаются", "Одноразовая ссылка готова", "Граница систем"]) assert.match(settings, new RegExp(escapeRegExp(boundary), "i"));
  assert.match(settings, /TemporaryCredentialDialog/);
  assert.match(settings, /copyTextWithClipboardApi/);
});

test("Wave 10 removes legacy top-level wrappers and scopes new styles", () => {
  assert.equal(system.includes('className="page system-workspace"'), false);
  assert.equal(system.includes("system-heading"), false);
  assert.equal(system.includes('className="system-kpis"'), false);
  assert.equal(system.includes('className="system-tabs"'), false);
  assert.equal(settings.includes('className="settings-layer"'), false);
  assert.equal(settings.includes('className="settings-modal"'), false);

  for (const [styles, prefix] of [[systemStyles, ".ahSystem"], [settingsStyles, ".ahSettings"]]) {
    assert.doesNotMatch(styles, /!important/i);
    assert.doesNotMatch(styles, /\[\s*class\s*[*^$]\s*=/i);
    assert.doesNotMatch(styles, /display\s*:\s*contents\b/i);
    assert.doesNotMatch(styles, /\bmargin(?:-[a-z-]+)?\s*:\s*-/i);
    const selectors = cssSelectors(styles);
    assert.ok(selectors.length > 0);
    for (const selector of selectors) assert.match(selector, new RegExp(`^${escapeRegExp(prefix)}`), `unscoped selector: ${selector}`);
    assert.match(styles, /overflow-x\s*:\s*auto|overflow\s*:\s*auto/);
  }
});

test("Wave 10 keeps compact typography and contained mobile layouts", () => {
  assert.match(systemStyles, /var\(\s*--ah-registry-kpi-mobile-/);
  assert.match(systemStyles, /var\(\s*--ah-compact-card-title-size/);
  assert.match(systemStyles, /@media\s*\(max-width:\s*720px\)/);
  assert.match(systemStyles, /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
  assert.match(settingsStyles, /var\(\s*--ah-compact-card-title-size/);
  assert.match(settingsStyles, /var\(\s*--ah-compact-card-body-size/);
  assert.match(settingsStyles, /@media\s*\(max-width:\s*720px\)/);
  assert.match(settingsStyles, /max-height\s*:\s*calc\(100dvh\s*-\s*18px\)/);
});

test("Wave 10 production UI contains no fixed acceptance claims", () => {
  const sources = `${system}\n${settings}`;
  assert.doesNotMatch(sources, /CHAIN STATUS\s*·\s*PASS|ГОТОВО К ИТОГОВОЙ ПРОВЕРКЕ|SYNTHETIC TEST/i);
});
