import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const integrationsUrl = new URL("../lib/integrations.ts", import.meta.url);
const workspaceUrl = new URL("../app/components/IntegrationWorkspace.tsx", import.meta.url);
const backendMarker = "TOCHKA_MULTI_COMPANY_ACCOUNT_LABELS";
const uiMarker = "TOCHKA_MULTI_COMPANY_SELECTION_STEP";

export function patchTochkaMultiCompanyLabels(source) {
  if (source.includes(backendMarker)) return source;
  const customerCodesBefore = `        const customerCodes = [...new Set(accounts.map(readTochkaCustomerCode).filter(Boolean))];\n        const requested = cleanTochkaCode(requestedCustomerCode);\n`;
  const customerCodesAfter = `        const customerCodes = [...new Set(accounts.map(readTochkaCustomerCode).filter(Boolean))];\n        // ${backendMarker}: distinguish companies without exposing customerCode to the browser.\n        // If ReadCustomerData is unavailable, only masked account suffixes are shown to the owner.\n        const customerChoices = await Promise.all(customerCodes.map(async (code, index) => {\n          const normalizedAccounts = (await Promise.all(\n            accounts\n              .filter((account) => readTochkaCustomerCode(account) === code)\n              .slice(0, 5)\n              .map((account) => normalizeTochkaAccount(account)),\n          )).filter((account): account is TochkaAccountSnapshot => Boolean(account));\n          const masks = normalizedAccounts.map((account) => account.maskedAccount).filter(Boolean);\n          const suffix = masks.length ? " · счета " + masks.join(", ") : "";\n          return { code, name: "Компания " + (index + 1) + suffix };\n        }));\n        const requested = cleanTochkaCode(requestedCustomerCode);\n`;
  const invalidBefore = `            return fail("Выбранная компания не доступна этому ключу Точки", customerCodes.map((code, index) => ({ code, name: "Компания " + (index + 1) })));\n`;
  const invalidAfter = `            return fail("Выбранная компания не доступна этому ключу Точки", customerChoices);\n`;
  const multiBefore = `          return fail("Ключ Точки даёт доступ к нескольким компаниям. Выберите одну.", customerCodes.map((code, index) => ({ code, name: "Компания " + (index + 1) })));\n`;
  const multiAfter = `          return fail("Ключ Точки подтверждён. Выберите компанию для выбранного юрлица.", customerChoices);\n`;
  for (const [before, label] of [
    [customerCodesBefore, "customer code block"],
    [invalidBefore, "invalid selected company block"],
    [multiBefore, "multi-company block"],
  ]) {
    if (!source.includes(before)) throw new Error(`D-064 backend patch target missing: ${label}`);
  }
  return source
    .replace(customerCodesBefore, customerCodesAfter)
    .replace(invalidBefore, invalidAfter)
    .replace(multiBefore, multiAfter);
}

export function patchTochkaMultiCompanyWorkspace(source) {
  if (source.includes(uiMarker)) return source;
  const actionBefore = `      if (!response.ok) {\n        notify(payload.error ?? "Ошибка");\n        return { ok: false, payload };\n      }\n`;
  const actionAfter = `      if (!response.ok) {\n        // ${uiMarker}: company selection is a continuation step, not a failed key.\n        if (payload.customerChoices?.length) notify("Ключ Точки подтверждён. Выберите компанию в этом окне.");\n        else notify(payload.error ?? "Ошибка");\n        return { ok: false, payload };\n      }\n`;
  const stateBefore = `  const [customerChoices, setCustomerChoices] = useState<Array<{ id: string; name: string }>>([]);\n  const [customerChoiceId, setCustomerChoiceId] = useState("");\n  const [readOnlyScopeConfirmed, setReadOnlyScopeConfirmed] = useState(existing?.readOnlyScopeConfirmed ?? false);\n`;
  const stateAfter = `  const [customerChoices, setCustomerChoices] = useState<Array<{ id: string; name: string }>>([]);\n  const [customerChoiceId, setCustomerChoiceId] = useState("");\n  const customerChoiceRef = useRef<HTMLSelectElement>(null);\n  const [readOnlyScopeConfirmed, setReadOnlyScopeConfirmed] = useState(existing?.readOnlyScopeConfirmed ?? false);\n`;
  const resultBefore = `    if (!result.ok && result.payload.customerChoices?.length) {\n      setCustomerChoices(result.payload.customerChoices);\n      setCustomerChoiceId(result.payload.customerChoices[0]?.id ?? "");\n    }\n`;
  const resultAfter = `    if (!result.ok && result.payload.customerChoices?.length) {\n      setCustomerChoices(result.payload.customerChoices);\n      setCustomerChoiceId("");\n      window.requestAnimationFrame(() => {\n        customerChoiceRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });\n        customerChoiceRef.current?.focus();\n      });\n    }\n`;
  const selectBefore = `<select value={customerChoiceId} onChange={(event) => setCustomerChoiceId(event.target.value)} required><option value="">Выберите компанию</option>`;
  const selectAfter = `<select ref={customerChoiceRef} value={customerChoiceId} onChange={(event) => setCustomerChoiceId(event.target.value)} required><option value="">Выберите компанию</option>`;
  const helpBefore = `<small>Показаны только названия компаний. Служебный код не передаётся в браузер и журнал.</small>`;
  const helpAfter = `<small>Если Точка не передаёт название компании, ArtHello OS показывает только безопасные маски её счетов. Служебный customerCode в браузер и журнал не передаётся.</small>`;
  for (const [before, label] of [
    [actionBefore, "action error branch"],
    [stateBefore, "wizard customer state"],
    [resultBefore, "wizard continuation block"],
    [selectBefore, "customer select"],
    [helpBefore, "customer help"],
  ]) {
    if (!source.includes(before)) throw new Error(`D-064 UI patch target missing: ${label}`);
  }
  return source
    .replace(actionBefore, actionAfter)
    .replace(stateBefore, stateAfter)
    .replace(resultBefore, resultAfter)
    .replace(selectBefore, selectAfter)
    .replace(helpBefore, helpAfter);
}

export async function applyTochkaMultiCompanySelection(
  integrationsPath = integrationsUrl,
  workspacePath = workspaceUrl,
) {
  const integrationsSource = await readFile(integrationsPath, "utf8");
  const workspaceSource = await readFile(workspacePath, "utf8");
  const integrationsPatched = patchTochkaMultiCompanyLabels(integrationsSource);
  const workspacePatched = patchTochkaMultiCompanyWorkspace(workspaceSource);
  if (integrationsPatched !== integrationsSource) await writeFile(integrationsPath, integrationsPatched, "utf8");
  if (workspacePatched !== workspaceSource) await writeFile(workspacePath, workspacePatched, "utf8");
  return integrationsPatched !== integrationsSource || workspacePatched !== workspaceSource;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const changed = await applyTochkaMultiCompanySelection();
  console.log(changed ? "D-064 Tochka multi-company selection applied" : "D-064 multi-company selection already present");
}
