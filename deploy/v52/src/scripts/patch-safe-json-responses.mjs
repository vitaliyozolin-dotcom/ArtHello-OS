import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one source match, got ${count}`);
  return source.replace(before, after);
}

async function patchFile(path, changes) {
  let source = await readFile(path, "utf8");
  const original = source;
  for (const change of changes) {
    source = replaceOnce(source, change.before, change.after, change.label);
  }
  if (source !== original) await writeFile(path, source, "utf8");
  return source !== original;
}

export async function applyD067(root = process.cwd()) {
  const financePath = join(root, "app/components/FinanceWorkspace.tsx");
  const integrationPath = join(root, "app/components/IntegrationWorkspace.tsx");

  const financeChanged = await patchFile(financePath, [
    {
      label: "finance import",
      before: 'import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";\n',
      after: 'import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";\nimport { readJsonResponse } from "../../lib/response-json";\n',
    },
    {
      label: "finance load response",
      before: '      const payload = await response.json() as FinanceData & { error?: string };',
      after: '      const payload = await readJsonResponse<FinanceData & { error?: string }>(response);',
    },
    {
      label: "finance action response",
      before: '      const payload = await response.json() as { error?: string; reused?: boolean };',
      after: '      const payload = await readJsonResponse<{ error?: string; reused?: boolean }>(response);',
    },
  ]);

  const integrationChanged = await patchFile(integrationPath, [
    {
      label: "integration import",
      before: 'import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";\n',
      after: 'import { humanPeriodLabel, humanTechnicalText, recordLabel, taskRecordLabel } from "../../lib/record-labels";\nimport { readJsonResponse } from "../../lib/response-json";\n',
    },
    {
      label: "integration load response",
      before: '      const payload = await response.json() as Data & { error?: string };',
      after: '      const payload = await readJsonResponse<Data & { error?: string }>(response);',
    },
    {
      label: "integration action response",
      before: '      const payload = await response.json() as ActionPayload;',
      after: '      const payload = await readJsonResponse<ActionPayload>(response);',
    },
  ]);

  return financeChanged || integrationChanged;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log((await applyD067()) ? "D-067 safe JSON responses applied" : "D-067 already present");
}
