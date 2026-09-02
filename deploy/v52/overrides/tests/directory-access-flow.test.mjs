import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("team is the employee directory and supports controlled manual and file entry", async () => {
  const [workspace, actions] = await Promise.all([
    read("../app/components/HrWorkspace.tsx"),
    read("../app/api/hr-actions/route.ts"),
  ]);
  for (const action of ["createEmployee", "updateEmployee", "importEmployees"]) {
    assert.match(actions, new RegExp(action));
    assert.match(workspace, new RegExp(action));
  }
  assert.match(workspace, /Импортировать/);
  assert.match(workspace, /Добавить сотрудника/);
  assert.match(actions, /accessStatus:\s*"Доступ не выдан"/);
});

test("settings users are a full-width access view of team employees", async () => {
  const [workspace, api, styles] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
    read("../app/components/ShellFoundation.css"),
  ]);
  assert.match(api, /loadEmployeeAccessDirectory/);
  assert.match(api, /employeeId/);
  assert.match(api, /hasAccess:\s*false/);
  assert.match(workspace, /access-users-full/);
  assert.match(workspace, /Выдать доступ/);
  assert.match(styles, /\.access-users-full\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(workspace, /Создать пользователя/);
});

test("temporary staff credentials are disclosed once without replacing access assignment", async () => {
  const [workspace, styles] = await Promise.all([
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/components/ShellFoundation.css"),
  ]);
  assert.match(workspace, /\/api\/settings\/temporary-credential/);
  assert.match(workspace, /"x-csrf-token": readClientCookie\("__Host-arthello_csrf"\)/);
  assert.match(workspace, /temporaryPassword/);
  assert.match(workspace, /После закрытия пароль больше не показывается/);
  assert.match(workspace, /Скопировать всё/);
  assert.match(workspace, /copyTextSynchronously\(value\) \|\| await copyTextWithClipboardApi\(value\)/);
  assert.match(workspace, /setSelectionRange\(0, value\.length\)/);
  assert.match(workspace, /document\.execCommand\("copy"\)/);
  assert.match(workspace, /Скопировано ✓/);
  assert.match(workspace, /aria-live="polite"/);
  assert.equal(workspace.match(/navigator\.clipboard\.writeText/g)?.length, 1);
  assert.match(workspace, /action: "inviteUser"/);
  assert.match(workspace, /Подтвердить и выдать доступ/);
  assert.match(styles, /\.temporary-credential-layer\{/);
  assert.match(styles, /\.temporary-password\{/);
});

test("families enter through clients, trust manual creation and keep external review separate from access", async () => {
  const [workspace, familyApi, settingsApi] = await Promise.all([
    read("../app/components/FamilyWorkspace.tsx"),
    read("../app/api/families/route.ts"),
    read("../app/api/settings/route.ts"),
  ]);
  for (const field of ["branch", "operationIds", "className", "groupName", "coreActivities", "extraActivities", "familyOther"]) {
    assert.match(workspace, new RegExp(`name=\\"${field}\\"`));
    assert.match(familyApi, new RegExp(field));
  }
  assert.match(workspace, /Импорт из AlfaCRM/);
  assert.match(workspace, /Семья вручную/);
  assert.match(workspace, /Ручную карточку подтверждает автор при сохранении/);
  assert.match(workspace, /name="sourceConfirmed"/);
  assert.doesNotMatch(workspace, /name="confirmed"|После создания — обязательная проверка|Создать на проверку/);
  assert.match(familyApi, /status:"Активна",sourceSystem:"MANUAL"[\s\S]*?dataQuality:"Проверено"/);
  assert.match(familyApi, /sourceConfirmed=body\.sourceConfirmed===true/);
  assert.match(familyApi, /family\.finance_links_updated/);
  assert.match(settingsApi, /familyNeedsReview\(family\)/);
  assert.match(settingsApi, /Сначала завершите сверку внешнего источника или конфликта/);
});

test("employee identity owns contact, multi-branch affiliation and contract navigation", async () => {
  const [workspace, hrApi, settings, settingsApi] = await Promise.all([
    read("../app/components/HrWorkspace.tsx"),
    read("../app/api/hr-actions/route.ts"),
    read("../app/components/SettingsWorkspace.tsx"),
    read("../app/api/settings/route.ts"),
  ]);
  assert.match(workspace, /name="branchIds"/);
  assert.match(workspace, /Открыть в документах/);
  assert.match(hrApi, /branchIds:values\.branchIds/);
  assert.match(settingsApi, /employeeBranchIds/);
  assert.match(settings, /input readOnly value=\{user\.contact\}/);
  assert.match(settings, /type="hidden" name="contact"/);
  assert.match(settings, /можно сузить доступ/);
});

test("family card is a clickable cross-domain relationship graph", async () => {
  const [workspace, familyApi] = await Promise.all([
    read("../app/components/FamilyWorkspace.tsx"),
    read("../app/api/families/route.ts"),
  ]);
  for (const label of ["Продажи · источник", "Дети и обучение", "Договор и документы", "Начисления и оплаты"]) assert.match(workspace, new RegExp(label));
  for (const table of ["salesLeads", "salesTouchpoints", "salesStageEvents", "clientLifecycles", "clientAccruals", "legalContracts", "legalDocumentItems"]) assert.match(familyApi, new RegExp(table));
  assert.match(workspace, /family-network-canvas/);
  assert.match(workspace, /daysBetween/);
});

test("family opens its regular card first and keeps relationships behind a tab", async () => {
  const [workspace, styles, editorStyles, shell, education] = await Promise.all([
    read("../app/components/FamilyWorkspace.tsx"),
    read("../app/components/FamilyWorkspace.css"),
    read("../app/components/DirectoryWorkspace.css"),
    read("../app/components/ArtHelloShell.tsx"),
    read("../app/components/EducationWorkspace.tsx"),
  ]);
  assert.match(workspace, /useState<"Карточка"\|"Связи">\("Карточка"\)/);
  assert.match(workspace, /Карточка семьи/);
  assert.match(workspace, /groupId\|\|detail\.students/);
  assert.match(shell, /EducationWorkspace[\s\S]+focusId=/);
  assert.match(education, /Открыт класс \/ группа/);
  assert.match(education, /visibleLessons/);
  assert.match(workspace, /createPortal\(<div className="modal-layer family-network-layer"/);
  assert.match(workspace, /createPortal\(<div className="modal-layer family-editor-layer"/);
  assert.match(styles, /\.family-network-layer\{align-items:flex-end;[^}]+safe-area-inset-top/);
  assert.match(styles, /max-height:calc\(100dvh/);
  assert.match(editorStyles, /\.family-editor-layer\{align-items:flex-end;[^}]+safe-area-inset-top/);
});

test("legacy access controls resolve to the shared UI font token", async () => {
  const tokens = await read("../app/design-tokens.css");
  assert.match(tokens, /--font-sans:\s*var\(--font-ui\)/);
});
