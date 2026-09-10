import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "app/components/IntegrationWorkspace.tsx");
let source = readFileSync(target, "utf8");

const cssAnchor = 'import "./IntegrationWorkspace.ds.css";\n';
const alfaImport = 'import { AlfaCrmSetupWizard } from "./AlfaCrmSetupWizard";\n';
if (!source.includes(alfaImport)) {
  if (!source.includes(cssAnchor)) throw new Error("AlfaCRM patch: IntegrationWorkspace CSS anchor not found");
  source = source.replace(cssAnchor, `${alfaImport}${cssAnchor}`);
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
    {wizardId && data.capabilities.canManageSetup && currentBankCapability(wizardId, data.capabilities) && wizardId !== "INT-T-ALFACRM" ? <ConnectionWizard
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
} else {
  source = source.replace(
    '{wizardId && wizardId !== "INT-T-ALFACRM" && data.capabilities.canManageSetup && currentBankCapability(wizardId, data.capabilities) ? <ConnectionWizard',
    '{wizardId && data.capabilities.canManageSetup && currentBankCapability(wizardId, data.capabilities) && wizardId !== "INT-T-ALFACRM" ? <ConnectionWizard',
  );
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

const importGateAnchor = 'const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS"]);';
if (!routeSource.includes("ALFACRM_IMPORT_ENABLED")) {
  routeSource = routeSource.replace(
    importGateAnchor,
    `${importGateAnchor}\nconst ALFACRM_IMPORT_ENABLED_VALUES = new Set(["1", "true", "yes"]);\nconst ALFACRM_OUTFLOW_PAY_TYPE_IDS = new Set(["5", "12"]);`,
  );
}
routeSource = routeSource.replace(
  'if (action === "importModule") return importModule(context, body);',
  'if (action === "importModule") {\n      if (!alfaCrmImportEnabled()) return privateJson({ error: "Импорт в рабочую базу пока закрыт: сначала завершите live coverage/integrity и подтвердите перевыпуск ключа AlfaCRM." }, 409);\n      return importModule(context, body);\n    }',
);

if (!routeSource.includes("function alfaCrmImportEnabled()")) {
  routeSource = routeSource.replace(
    "function moduleCompletionNote(module: ModuleKey) {",
    `function alfaCrmImportEnabled() {\n  const value = (env as unknown as { ALFACRM_IMPORT_ENABLED?: string }).ALFACRM_IMPORT_ENABLED?.trim().toLowerCase() ?? "";\n  return ALFACRM_IMPORT_ENABLED_VALUES.has(value);\n}\n\nfunction moduleCompletionNote(module: ModuleKey) {`,
  );
}

if (!routeSource.includes("alfacrm_family_merge_candidates")) {
  const financeTableClose = `    env.DB.prepare(\`CREATE TABLE IF NOT EXISTS alfacrm_finance_snapshots (
      remote_branch_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      customer_id TEXT NOT NULL DEFAULT '',
      family_entity_id TEXT NOT NULL DEFAULT '',
      operation_date TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      payload_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY(remote_branch_id,payment_id)
    )\`),`;
  const candidateTable = `${financeTableClose}\n    env.DB.prepare(\`CREATE TABLE IF NOT EXISTS alfacrm_family_merge_candidates (\n      remote_branch_id TEXT NOT NULL,\n      customer_id TEXT NOT NULL,\n      family_entity_id TEXT NOT NULL,\n      match_key TEXT NOT NULL,\n      guardian_name TEXT NOT NULL DEFAULT '',\n      phone TEXT NOT NULL DEFAULT '',\n      status TEXT NOT NULL DEFAULT 'Ожидает сверки',\n      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n      PRIMARY KEY(remote_branch_id,customer_id)\n    )\`),`;
  if (!routeSource.includes(financeTableClose)) throw new Error("AlfaCRM patch: finance table anchor not found");
  routeSource = routeSource.replace(financeTableClose, candidateTable);
}

routeSource = routeSource.replace(
  '    const familyIdentity = guardianName || phone ? `${normalizeName(guardianName)}|${phone}` : `student:${studentId}`;\n    const familyHash = await shortHash(`${remoteBranchId}:${familyIdentity}`);',
  '    const matchKey = guardianName || phone ? `${normalizeName(guardianName)}|${phone}` : "";\n    const familyHash = await shortHash(`${remoteBranchId}:student:${studentId}`);',
);
if (!/env\.DB\.prepare\(\s*`INSERT INTO alfacrm_family_merge_candidates\b/.test(routeSource)) {
routeSource = routeSource.replace(
  '    statements.push(\n      entityUpsert(familyId, "Семья", familyName, `family:${remoteBranchId}:${familyHash}`, quality, scope, { ...common, guardianName, phone }, actor),',
  '    if (matchKey) statements.push(env.DB.prepare(`INSERT INTO alfacrm_family_merge_candidates\n      (remote_branch_id,customer_id,family_entity_id,match_key,guardian_name,phone,status,created_at,updated_at)\n      VALUES (?,?,?,?,?,?,\'Ожидает сверки\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)\n      ON CONFLICT(remote_branch_id,customer_id) DO UPDATE SET family_entity_id=excluded.family_entity_id,match_key=excluded.match_key,guardian_name=excluded.guardian_name,phone=excluded.phone,status=\'Ожидает сверки\',updated_at=CURRENT_TIMESTAMP`)\n      .bind(remoteBranchId, studentId, familyId, matchKey, guardianName, phone));\n    statements.push(\n      entityUpsert(familyId, "Семья", familyName, `family:${remoteBranchId}:${familyHash}`, quality, scope, { ...common, guardianName, phone }, actor),',
);
}
routeSource = routeSource.replace(
  '    const phone = normalizePhone(item.phone);\n    const guardianName = scalar(item.legal_name ?? item.payer_name ?? item.parent_name);\n    const familyIdentity = guardianName || phone ? `${normalizeName(guardianName)}|${phone}` : `student:${studentId}`;\n    const familyId = `FAM-A-${await shortHash(`${row.remote_branch_id}:${familyIdentity}`)}`;',
  '    const familyId = `FAM-A-${await shortHash(`${row.remote_branch_id}:student:${studentId}`)}`;',
);
routeSource = routeSource.replace(
  '    const phone = normalizePhone(item.phone);\n    const guardianName = scalar(item.legal_name ?? item.payer_name ?? item.parent_name);\n    const identity = guardianName || phone ? `${normalizeName(guardianName)}|${phone}` : `student:${customerId}`;\n    map.set(`${row.remote_branch_id}:${customerId}`, `FAM-A-${await shortHash(`${row.remote_branch_id}:${identity}`)}`);',
  '    map.set(`${row.remote_branch_id}:${customerId}`, `FAM-A-${await shortHash(`${row.remote_branch_id}:student:${customerId}`)}`);',
);

routeSource = routeSource.replace(
  '    const numeric = direct !== null ? direct : income !== null ? income : outcome !== null ? -Math.abs(outcome) : null;\n    if (!id || !operationDate || numeric === null || operationDate < params.dateFrom || operationDate > params.dateTo) { rejected += 1; continue; }',
  '    const numeric = direct !== null ? direct : income !== null ? income : outcome !== null ? -Math.abs(outcome) : null;\n    const payTypeId = scalar(item.pay_type_id ?? item.payment_type_id);\n    const isOutflow = ALFACRM_OUTFLOW_PAY_TYPE_IDS.has(payTypeId) || (numeric !== null && numeric < 0);\n    if (!id || !operationDate || numeric === null || operationDate < params.dateFrom || operationDate > params.dateTo) { rejected += 1; continue; }',
);
routeSource = routeSource.replace(
  '        numeric >= 0 ? "Поступление" : "Списание",',
  '        isOutflow ? "Списание" : "Поступление",',
);

writeFileSync(routeTarget, routeSource);

const alfaWizardTarget = resolve(process.cwd(), "app/components/AlfaCrmSetupWizard.tsx");
const alfaWizardCssTarget = resolve(process.cwd(), "app/components/AlfaCrmSetupWizard.styles.txt");
let alfaWizardSource = readFileSync(alfaWizardTarget, "utf8");
const alfaWizardCss = readFileSync(alfaWizardCssTarget, "utf8");
const wizardCssImport = 'import "./AlfaCrmSetupWizard.css";\n';
const wizardCssConstant = `const ALFA_CRM_STYLES = ${JSON.stringify(alfaWizardCss)};\n`;
if (alfaWizardSource.includes(wizardCssImport)) {
  alfaWizardSource = alfaWizardSource.replace(wizardCssImport, wizardCssConstant);
}
const wizardRoot = '    <div className="ahIntegrationModalLayer ahAlfaCrmLayer">\n';
const wizardRootWithStyle = `${wizardRoot}      <style>{ALFA_CRM_STYLES}</style>\n`;
if (!alfaWizardSource.includes('<style>{ALFA_CRM_STYLES}</style>')) {
  if (!alfaWizardSource.includes(wizardRoot)) throw new Error("AlfaCRM patch: wizard root anchor not found");
  alfaWizardSource = alfaWizardSource.replace(wizardRoot, wizardRootWithStyle);
}
const effectAnchor = "  useEffect(() => { void load(); }, []);";
const effectReplacement = "  // Initial connector state is intentionally loaded only once when the modal mounts.\n  // eslint-disable-next-line react-hooks/exhaustive-deps\n  useEffect(() => { void load(); }, []);";
if (!alfaWizardSource.includes(effectReplacement)) {
  if (!alfaWizardSource.includes(effectAnchor)) throw new Error("AlfaCRM patch: wizard load effect anchor not found");
  alfaWizardSource = alfaWizardSource.replace(effectAnchor, effectReplacement);
}
writeFileSync(alfaWizardTarget, alfaWizardSource);

console.log("AlfaCRM staged integration shell patched");
