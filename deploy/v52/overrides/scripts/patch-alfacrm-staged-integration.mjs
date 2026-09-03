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

const routeTarget = resolve(process.cwd(), "app/api/integrations/alfacrm/route.ts");
let routeSource = readFileSync(routeTarget, "utf8");
const nextModuleRuleDisable = "/* eslint-disable @next/next/no-assign-module-variable */\n";
if (!routeSource.startsWith(nextModuleRuleDisable)) routeSource = `${nextModuleRuleDisable}${routeSource}`;
routeSource = routeSource.replace(
  'const items = await fetchPaged(session, "0/branch/index", {});',
  'const items = await fetchPaged(session, "branch/index", { is_active: 1 });',
);
routeSource = routeSource.replace(
  "async function canonicalizeGroups(rows: FetchedRecord[], state: AlfaState, localBranches: LocalBranch[], actor: string) {",
  "async function canonicalizeGroups(rows: FetchedRecord[], state: AlfaState, localBranches: LocalBranch[]) {",
);
routeSource = routeSource.replace(
  "canonicalizeGroups(rows, state, localBranches, context.actor)",
  "canonicalizeGroups(rows, state, localBranches)",
);
writeFileSync(routeTarget, routeSource);

const alfaWizardTarget = resolve(process.cwd(), "app/components/AlfaCrmSetupWizard.tsx");
let alfaWizardSource = readFileSync(alfaWizardTarget, "utf8");
const effectAnchor = "  useEffect(() => { void load(); }, []);";
const effectReplacement = "  // Initial connector state is intentionally loaded only once when the modal mounts.\n  // eslint-disable-next-line react-hooks/exhaustive-deps\n  useEffect(() => { void load(); }, []);";
if (!alfaWizardSource.includes(effectReplacement)) {
  if (!alfaWizardSource.includes(effectAnchor)) throw new Error("AlfaCRM patch: wizard load effect anchor not found");
  alfaWizardSource = alfaWizardSource.replace(effectAnchor, effectReplacement);
}
writeFileSync(alfaWizardTarget, alfaWizardSource);

console.log("AlfaCRM staged integration shell patched");
