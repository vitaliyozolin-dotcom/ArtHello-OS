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

test("acquiring restores legal-entity accounts, balances, operations and sync state", async () => {
  const [route, workspace] = await Promise.all([
    source("../app/api/acquiring/route.ts"),
    source("../app/components/AcquiringWorkspace.tsx"),
  ]);
  for (const table of ["bankAccounts", "bankTransactions", "bankStatementImports", "integrationConnections"]) {
    assert.match(route, new RegExp(`from\\(${table}\\)`), table);
  }
  assert.doesNotMatch(route, /bankAccountsView\s*=\s*\[\]/);
  assert.match(route, /Остатки показаны по счетам юридических лиц/);
  assert.match(route, /приход\|поступ\|вход/);
  assert.match(route, /создание, подписание и отправка исходящих платежей[^\n]+запрещены/);
  assert.match(workspace, />Новый счёт<\/Button>/);
  assert.match(workspace, />Оплата<\/Button>/);
  assert.match(workspace, /\/api\/pay-sso\/open/);
  assert.match(workspace, /searchParams\.set\("action", action\)/);
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
  assert.match(openRoute, /continuePath/);
  assert.match(openRoute, /target\.searchParams\.set\("action", payAction\)/);
  assert.match(loginRoute, /Вход в ArtHello Pay выполняется через ArtHello OS/);
  assert.match(loginRoute, /isPayOrigin\(request\)/);
  assert.match(sso, /const CODE_TTL_SECONDS = 60/);
  assert.match(sso, /pay_grant\.access_version AS pay_access_version/);
  assert.match(sso, /used_at=0 AND expires_at>\?/);
});

test("D168 deployment validates live bank data and Pay boundary without payment secrets", async () => {
  const workflow = await source("../../../../.github/workflows/deploy-arthello-acquiring-pay-d168.yml", "../contract-fixtures/deploy-d168.yml");
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
  assert.doesNotMatch(workflow, /TOCHKA_TOKEN|PAYMENT_SECRET|FISCALIZATION_SECRET/);
});
