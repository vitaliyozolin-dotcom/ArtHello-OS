import fs from "node:fs";

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) throw new Error(`patch-help-finance-ux-v3-fix failed at ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

{
  const path = "/app/app/components/contextualHelpDom.ts";
  let source = fs.readFileSync(path, "utf8");
  source = replaceOnce(
    source,
    '  return Boolean(element?.closest("[data-ah-help-root]"));',
    '  return Boolean(element?.closest("[data-ah-help-root],[data-ah-help-inline=true]"));',
    "inline portal belongs to help system",
  );
  source = replaceOnce(
    source,
    '  if (element.closest("[data-ah-help-root]")) return false;',
    '  if (isInsideHelp(element)) return false;',
    "exclude portal controls from page scan",
  );
  fs.writeFileSync(path, source, "utf8");
}

{
  const path = "/app/app/components/ContextualHelpSystem.css";
  let source = fs.readFileSync(path, "utf8");
  const marker = "/* ARTHELLO_HELP_UX_V3_SPECIFICITY */";
  if (!source.includes(marker)) source += `\n${marker}\n[data-ah-help-target=true]{position:relative!important;overflow:visible!important}[data-ah-help-target=true]>button[data-ah-help-inline=true].ah-field-icon{position:absolute!important;inset:50% 12px auto auto!important;left:auto!important;right:12px!important;top:50%!important;bottom:auto!important;width:24px!important;min-width:24px!important;height:24px!important;margin:0!important;padding:0!important;transform:translateY(-50%)!important;z-index:20!important;opacity:.95!important;display:grid!important;place-items:center!important}\n`;
  fs.writeFileSync(path, source, "utf8");
}

console.log("patch-help-finance-ux-v3-fix: applied");
