import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(...relatives) {
  let missing;
  for (const relative of relatives) {
    try {
      return await readFile(new URL(relative, import.meta.url), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing = error;
    }
  }
  throw missing;
}

test("D172 keeps bank facts in Money and acquiring events in Acquiring", async () => {
  const [route, workspace, financeRoute, financeWorkspace] = await Promise.all([
    source("../app/api/acquiring/route.ts"),
    source("../app/components/AcquiringWorkspace.tsx"),
    source("../app/api/finance/route.ts"),
    source("../app/components/FinanceWorkspace.tsx"),
  ]);
  for (const table of ["bankAccounts", "bankTransactions", "bankStatementImports", "integrationConnections"]) {
    assert.doesNotMatch(route, new RegExp(`from\\(${table}\\)|${table}`), table);
    assert.match(financeRoute, new RegExp(`from\\(${table}\\)`), table);
  }
  assert.match(route, /arthello_pay_requests/);
  assert.match(route, /платёжные ссылки, оплаты, возвраты и чеки/);
  assert.doesNotMatch(workspace, /Остаток по счетам|Синхронизация с банками/);
  assert.match(financeWorkspace, /Счета и текущие остатки/);
  assert.match(financeWorkspace, /Банковские операции/);
  assert.match(financeWorkspace, /Синхронизация/);
  assert.match(workspace, />Реестр платежей<\/Button>/);
  assert.match(workspace, />Создать ссылку на оплату<\/Button>/);
  assert.doesNotMatch(workspace, />Новый счёт<\/Button>|>Оплата<\/Button>/);
  assert.match(workspace, /\/api\/pay-sso\/open/);
  assert.match(workspace, /destination === "create-link" \? "invoice" : "payment"/);
  assert.doesNotMatch(workspace, /openPay\("invoice"\)|openPay\("payment"\)/);
});

test("Pay is entered only through central OS SSO and preserves launch action", async () => {
  const [asset, mirror, openRoute, loginRoute, sso] = await Promise.all([
    source("../../public/pay-assets/app.js", "../contract-fixtures/pay-app.js"),
    source("../../../../pay-web/app.js", "../contract-fixtures/pay-app-mirror.js"),
    source("../app/api/pay-sso/open/route.ts"),
    source("../app/api/auth/login/route.ts"),
    source("../lib/pay-sso.ts"),
  ]);
  assert.equal(asset, mirror);
  assert.doesNotMatch(asset, /id="login-form"|performLogin|\/api\/auth\/login/);
  assert.match(asset, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(asset, /currentPayReturnTo/);
  assert.match(asset, /applyLaunchAction/);
  assert.match(asset, /action !== "invoice" && action !== "payment"/);
  assert.match(asset, /if \(action === "invoice"\) \{[\s\S]*?openNewPayment\(\);[\s\S]*?return true;/);
  assert.match(asset, /state\.view = "requests";\s*state\.modal = null;\s*renderShell\(\);/);
  assert.match(asset, /if \(action\.matches\("\.modal-backdrop"\) && raw !== action\) return;/);
  assert.match(asset, /target\.form\?\.id === "create-payment-form"[\s\S]*?state\.modal\[target\.name\] = target\.value;/);
  assert.match(asset, /const requestId = \+\+state\.customerRequestId;/);
  assert.match(asset, /state\.modal !== modal \|\| state\.customerRequestId !== requestId/);
  assert.doesNotMatch(asset, /raw\.closest\("\[data-modal-stop\]"\)/);
  assert.match(openRoute, /continuePath/);
  assert.match(openRoute, /target\.searchParams\.set\("action", payAction\)/);
  assert.match(loginRoute, /Вход в ArtHello Pay выполняется через ArtHello OS/);
  assert.match(loginRoute, /isPayOrigin\(request\)/);
  assert.match(sso, /const CODE_TTL_SECONDS = 60/);
  assert.match(sso, /pay_grant\.access_version AS pay_access_version/);
  assert.match(sso, /used_at=0 AND expires_at>\?/);
});

test("D175 keeps Pay behind Acquiring and preserves the focused family search", async () => {
  const [shell, asset] = await Promise.all([
    source("../app/components/ArtHelloShell.tsx"),
    source("../../public/pay-assets/app.js", "../contract-fixtures/pay-app.js"),
  ]);
  const primaryNav = shell.split("\n").find((line) => line.includes("const primaryNav =")) ?? "";
  const customerLoader = asset.match(/async function loadCustomers[\s\S]*?(?=\nasync function loadWorkspace)/)?.[0] ?? "";

  assert.match(shell, /const externalSystemModuleIds[^\n]+new Set\(\["pay"\]\)/);
  assert.doesNotMatch(primaryNav, /"pay"/);
  assert.match(shell, /availableDashboardModules[\s\S]*?!externalSystemModuleIds\.has\(moduleEntry\.id\)/);
  assert.match(shell, /const favoriteNav = [^\n]+!externalSystemModuleIds\.has\(id\)/);
  assert.match(shell, /const extraNav = [^\n]+!externalSystemModuleIds\.has\(item\.id\)/);
  assert.match(asset, /function refreshCustomerResults\(\)[\s\S]*?\.customer-search-results[\s\S]*?renderCustomerResults\(\)/);
  assert.ok(customerLoader);
  assert.doesNotMatch(customerLoader, /renderShell\(\)/);
  assert.equal((customerLoader.match(/refreshCustomerResults\(\)/g) ?? []).length, 2);
});

test("D176 deployment validates AlfaCRM egress, stable public edge and Pay boundary without secrets", async () => {
  const workflow = await source("./contract-fixtures/deploy-d176.yml");
  assert.match(workflow, /D176: restore AlfaCRM production transport/);
  assert.match(workflow, /ARTHELLO_D176_ALFACRM_EGRESS=VERIFIED/);
  assert.match(workflow, /ARTHELLO_D176_PRODUCTION=VERIFIED/);
  assert.match(workflow, /docker restart --time 20 "\$CADDY_CONTAINER"/);
  assert.match(workflow, /ARTHELLO_D176_EXTERNAL=VERIFIED/);
  assert.match(workflow, /bank_accounts/);
  assert.match(workflow, /balance_minor is not null/);
  assert.match(workflow, /eligiblePayAdministrators/);
  assert.match(workflow, /activePayGrants/);
  assert.match(workflow, /TOCHKA_AUTOSYNC_ENABLED=1/);
  assert.match(workflow, /TOCHKA_AUTOSYNC_ACTIVATION_ID/);
  assert.match(workflow, /activation-volume\.py write/);
  assert.match(workflow, /hasTochkaAutosyncActivation/);
  assert.match(workflow, /runtimeFingerprintSha256/);
  assert.match(workflow, /image-runtime-fingerprint\.jq/);
  assert.match(workflow, /--cap-add FOWNER --cap-add FSETID/);
  assert.match(workflow, /docker exec -i "\$candidate" python3 -I -B -/);
  assert.match(workflow, /docker exec -i -e PUBLIC_URL=/);
  assert.match(workflow, /moneyAcceptanceEnabled:false/);
  assert.match(workflow, /fiscalizationEnabled:false/);
  assert.match(workflow, /refreshCustomerResults/);
  assert.doesNotMatch(workflow, /TOCHKA_TOKEN|PAYMENT_SECRET|FISCALIZATION_SECRET/);
});
