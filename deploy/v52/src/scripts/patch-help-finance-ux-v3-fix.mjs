import fs from "node:fs";

{
  const path = "/app/app/components/contextualHelpDom.ts";
  let source = fs.readFileSync(path, "utf8");
  const legacyInlineAttribute = `[data-ah-help-${"inline"}=true]`;
  source = source.replace(`,${legacyInlineAttribute}`, "");
  fs.writeFileSync(path, source, "utf8");
}

{
  const path = "/app/app/components/ContextualHelpSystem.css";
  let source = fs.readFileSync(path, "utf8");
  const marker = "/* ARTHELLO_HELP_UX_V3_SPECIFICITY */";
  if (!source.includes(marker)) source += `\n${marker}\n[data-ah-help-target=true]{position:relative!important;overflow:visible!important}\n`;
  fs.writeFileSync(path, source, "utf8");
}

console.log("patch-help-finance-ux-v3-fix: applied");
