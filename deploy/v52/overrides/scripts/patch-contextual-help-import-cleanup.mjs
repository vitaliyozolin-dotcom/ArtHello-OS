import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../app/components/ContextualHelpSystem.tsx", import.meta.url));
let source = readFileSync(path, "utf8");
const importLine = "  labelRectFor,\n";
if (source.includes(importLine) && !source.slice(source.indexOf("export function ContextualHelpSystem")).includes("labelRectFor(")) {
  source = source.replace(importLine, "");
}
writeFileSync(path, source, "utf8");
console.log("Contextual help import cleanup applied");
