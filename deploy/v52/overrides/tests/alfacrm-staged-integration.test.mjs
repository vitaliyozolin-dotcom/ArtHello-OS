import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = process.cwd();
const route = readFileSync(resolve(root, "app/api/integrations/alfacrm/route.ts"), "utf8");
const wizard = readFileSync(resolve(root, "app/components/AlfaCrmSetupWizard.tsx"), "utf8");
const shell = readFileSync(resolve(root, "app/components/IntegrationWorkspace.tsx"), "utf8");
const css = readFileSync(resolve(root, "app/components/AlfaCrmSetupWizard.css"), "utf8");

test("AlfaCRM uses a dedicated staged wizard instead of the generic all-at-once setup", () => {
  assert.match(shell, /lazy\(\(\) => import\("\.\/AlfaCrmSetupWizard"\)/);
  assert.match(shell, /<Suspense fallback=\{null\}>/);
  assert.match(shell, /wizardId === "INT-T-ALFACRM"/);
  assert.match(shell, /wizardId !== "INT-T-ALFACRM"/);
  assert.match(shell, /wizardId && data\.capabilities\.canManageSetup && currentBankCapability\(wizardId, data\.capabilities\)/);
  assert.match(wizard, /Никакой кнопки «слить всё»/);
  assert.match(wizard, /Сначала только проверяем доступ/);
  assert.match(wizard, /Выберите, какие филиалы вообще участвуют/);
});

test("AlfaCRM transport follows v2api login, branch discovery, read-only and rate limits", () => {
  assert.match(route, /POST|method: "POST"/);
  assert.match(route, /\/v2api\/auth\/login/);
  assert.match(route, /fetchPaged\(session, "branch\/index", \{ is_active: 1 \}\)/);
  assert.doesNotMatch(route, /"0\/branch\/index"/);
  assert.match(route, /X-ALFACRM-TOKEN/);
  assert.match(route, /MIN_REQUEST_INTERVAL_MS = 240/);
  assert.doesNotMatch(route, /\/customer\/create|\/customer\/update|\/customer\/delete|\/pay\/create|\/pay\/update|\/pay\/delete/);
  assert.match(route, /direction: "read_only_inbound"/);
});

test("production writes stay fail-closed until the AlfaCRM release gate is explicitly enabled", () => {
  assert.match(route, /ALFACRM_IMPORT_ENABLED/);
  assert.match(route, /ALFACRM_IMPORT_ENABLED_VALUES/);
  assert.match(route, /if \(!alfaCrmImportEnabled\(\)\)/);
  assert.match(route, /live coverage\/integrity/);
});

test("branch mapping and module dependencies are enforced before imports", () => {
  assert.match(route, /Сначала сопоставьте филиалы/);
  assert.match(route, /Сначала загрузите сотрудников: группы должны сразу связаться с педагогами/);
  assert.match(route, /Сначала загрузите сотрудников и группы/);
  assert.match(route, /Сначала загрузите семьи и детей/);
  assert.match(route, /previewToken/);
  assert.match(route, /Параметры изменились после предпросмотра/);
});

test("family identities stay per AlfaCRM customer and possible matches go to manual review", () => {
  assert.match(route, /shortHash\(`\$\{remoteBranchId\}:student:\$\{studentId\}`\)/);
  assert.match(route, /alfacrm_family_merge_candidates/);
  assert.match(route, /status TEXT NOT NULL DEFAULT 'Ожидает сверки'/);
  assert.match(route, /matchKey/);
});

test("historical lesson and finance reads are bounded by explicit dates", () => {
  assert.match(route, /lesson\/index/);
  assert.match(route, /date_from: params\.dateFrom, date_to: params\.dateTo/);
  assert.match(route, /pay\/index/);
  assert.match(route, /Для занятий выбирайте период не более 370 дней/);
  assert.match(route, /Для первичного финансового импорта выберите дату перехода не старше двух лет/);
  assert.doesNotMatch(route, /INSERT INTO financial_operations/);
  assert.match(wizard, /CRM-движения с выбранной даты/);
  assert.match(wizard, /банковского ДДС/);
});

test("AlfaCRM refund and outflow payment types cannot become receipts just because income is positive", () => {
  assert.match(route, /ALFACRM_OUTFLOW_PAY_TYPE_IDS = new Set\(\["5", "12"\]\)/);
  assert.match(route, /pay_type_id/);
  assert.match(route, /isOutflow \? "Списание" : "Поступление"/);
});

test("staff import never grants access and mobile inputs avoid browser zoom", () => {
  assert.match(route, /'Доступ не выдан'/);
  assert.match(wizard, /Карточки создаются без выдачи доступа/);
  assert.match(css, /font-size:16px/);
  assert.match(css, /max-height:calc\(100dvh - 24px\)/);
  assert.match(css, /overflow-y:auto/);
});