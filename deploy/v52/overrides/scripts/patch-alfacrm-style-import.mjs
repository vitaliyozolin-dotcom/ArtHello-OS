import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "app/components/AlfaCrmSetupWizard.tsx");
const transientStyles = resolve(process.cwd(), "app/components/AlfaCrmSetupWizard.styles.txt");
let source = readFileSync(target, "utf8");

source = source.replace(/^const ALFA_CRM_STYLES = .*;\n/m, "");
source = source.replace('      <style>{ALFA_CRM_STYLES}</style>\n', "");
const cssImport = 'import "./AlfaCrmSetupWizard.css";\n';
if (!source.includes(cssImport)) {
  const anchor = 'import { createPortal } from "react-dom";\n';
  if (!source.includes(anchor)) throw new Error("AlfaCRM style restore: react-dom import anchor not found");
  source = source.replace(anchor, `${anchor}${cssImport}`);
}
writeFileSync(target, source);
if (existsSync(transientStyles)) unlinkSync(transientStyles);
console.log("AlfaCRM production stylesheet restored; transient Tailwind scan source removed");
