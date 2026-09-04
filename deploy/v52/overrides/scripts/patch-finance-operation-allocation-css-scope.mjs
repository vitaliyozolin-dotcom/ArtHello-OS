import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const financeCssUrl = new URL("../app/components/FinanceWorkspace.ds.css", import.meta.url);
const marker = "D069_FINANCE_OPERATION_ALLOCATION";
const scopeMarker = "D069_FINANCE_OPERATION_ALLOCATION_SCOPED";

export function scopeD069FinanceCss(source) {
  if (source.includes(scopeMarker)) return source;
  const markerIndex = source.indexOf(`/* ${marker} */`);
  if (markerIndex < 0) throw new Error("D-069 CSS block is missing");
  const before = source.slice(0, markerIndex);
  let block = source.slice(markerIndex);
  block = block.replace(
    /(^[ \t]*|,[ \t]*)(\.(?:operation-classification|finance-table)[^{,\n]*)/gm,
    (_match, prefix, selector) => `${prefix}.ahFinancePage ${selector}`,
  );
  block = block.replace(
    `/* ${marker} */`,
    `/* ${marker} */\n/* ${scopeMarker} */`,
  );
  return before + block;
}

export async function applyD069FinanceCssScope() {
  const source = await readFile(financeCssUrl, "utf8");
  const patched = scopeD069FinanceCss(source);
  if (patched === source) return false;
  await writeFile(financeCssUrl, patched, "utf8");
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log((await applyD069FinanceCssScope()) ? "D-069 finance CSS scoped" : "D-069 finance CSS already scoped");
}
