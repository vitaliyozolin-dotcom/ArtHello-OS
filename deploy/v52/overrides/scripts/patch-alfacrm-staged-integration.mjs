import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "app/components/IntegrationWorkspace.tsx");
let source = readFileSync(target, "utf8");

const importAnchor = 'import { Button, Card, EmptyState, KpiCard, PageContainer, PageHeader, SearchField, Tabs } from "./design-system";\n';
const alfaImport = 'import { AlfaCrmSetupWizard } from "./AlfaCrmSetupWizard";\n';
if (!source.includes(alfaImport)) {
  if (!source.includes(importAnchor)) throw new Error("AlfaCRM patch: design-system import anchor not found");
  source = source.replace(importAnchor, `${importAnchor}${alfaImport}`);
}

const wizardAnchor = `    {wizardId && data.capabilities.canManageSetup && currentBankCapability(wizardId, data.capabilities) ? <ConnectionWizard
      connection={data.connections.find((item) => item.id === wizardId)}
      existing={data.setups[wizardId]}
      legalEntities={data.legalEntities}
      branches={data.branches}
      busy={busy === \`setup-\${wizardId}\`}
      canManageCredentials={data.capabilities.canManageCredentials}
      bankEgressIp={data.infrastructure.bankEgressIp}
      bankEgressIpConfirmed={data.infrastructure.bankEgressIpConfirmed}
      close={() => setWizardId("")}
      save={async (setup, credential, customerChoiceId) => {
        const result = await action({ action: "saveSetup", setup, ...(credential ? { credential } : {}), ...(customerChoiceId ? { customerChoiceId } : {}) }, \`setup-\${wizardId}\`);
        if (result.ok) setWizardId("");
        return result;
      }}
    /> : null}`;

const stagedWizard = `    {wizardId === "INT-T-ALFACRM" && data.capabilities.canManageSetup ? <AlfaCrmSetupWizard
      roleCode={roleCode}
      close={() => setWizardId("")}
      notify={notify}
    /> : null}
    {wizardId && wizardId !== "INT-T-ALFACRM" && data.capabilities.canManageSetup && currentBankCapability(wizardId, data.capabilities) ? <ConnectionWizard
      connection={data.connections.find((item) => item.id === wizardId)}
      existing={data.setups[wizardId]}
      legalEntities={data.legalEntities}
      branches={data.branches}
      busy={busy === \`setup-\${wizardId}\`}
      canManageCredentials={data.capabilities.canManageCredentials}
      bankEgressIp={data.infrastructure.bankEgressIp}
      bankEgressIpConfirmed={data.infrastructure.bankEgressIpConfirmed}
      close={() => setWizardId("")}
      save={async (setup, credential, customerChoiceId) => {
        const result = await action({ action: "saveSetup", setup, ...(credential ? { credential } : {}), ...(customerChoiceId ? { customerChoiceId } : {}) }, \`setup-\${wizardId}\`);
        if (result.ok) setWizardId("");
        return result;
      }}
    /> : null}`;

if (!source.includes('wizardId === "INT-T-ALFACRM"')) {
  if (!source.includes(wizardAnchor)) throw new Error("AlfaCRM patch: connection wizard anchor not found");
  source = source.replace(wizardAnchor, stagedWizard);
}

const runAnchor = '{canRun ? <button type="button" disabled={busy === `sync-${connection.id}`} onClick={() => void action({ action: "retrySync", connectionId: connection.id }, `sync-${connection.id}`)}>{connection.id === TOCHKA_CONNECTION_ID ? "Загрузить выписки и операции" : connection.id === TBANK_CONNECTION_ID ? "Проверить счета и выписку" : "Запустить синхронизацию"}</button> : null}';
const runReplacement = '{canRun && connection.id !== "INT-T-ALFACRM" ? <button type="button" disabled={busy === `sync-${connection.id}`} onClick={() => void action({ action: "retrySync", connectionId: connection.id }, `sync-${connection.id}`)}>{connection.id === TOCHKA_CONNECTION_ID ? "Загрузить выписки и операции" : connection.id === TBANK_CONNECTION_ID ? "Проверить счета и выписку" : "Запустить синхронизацию"}</button> : null}';
if (!source.includes(runReplacement)) {
  if (!source.includes(runAnchor)) throw new Error("AlfaCRM patch: generic retry button anchor not found");
  source = source.replace(runAnchor, runReplacement);
}

writeFileSync(target, source);
console.log("AlfaCRM staged integration shell patched");
