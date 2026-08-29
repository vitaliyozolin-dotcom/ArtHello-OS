import fs from "node:fs";

function stripLegacyBlocks(source, markers) {
  for (const marker of markers) {
    const token = `/* ${marker} */`;
    const start = source.indexOf(token);
    if (start === -1) continue;
    const next = source.indexOf("/* ARTHELLO_", start + token.length);
    source = source.slice(0, start).trimEnd() + "\n" + (next === -1 ? "" : source.slice(next));
  }
  return source.trimEnd() + "\n";
}

const polishPath = "/app/app/components/SystemWideMobilePolish.css";
let polish = fs.readFileSync(polishPath, "utf8");
polish = stripLegacyBlocks(polish, [
  "ARTHELLO_MOBILE_VISUAL_HELP_FOLLOWUP",
  "ARTHELLO_OPERATIONAL_UX_V3",
  "ARTHELLO_MOBILE_DESIGN_SYSTEM_V4",
  "ARTHELLO_HELP_MARKER_RIGHT_EDGE",
]);

polish += `
/* ARTHELLO_MOBILE_CANONICAL_V5 */
:root{--ah-mobile-gutter:20px;--ah-mobile-gap:16px;--ah-mobile-card-radius:22px;--ah-mobile-control-radius:16px;--ah-mobile-control-height:48px}
@media(max-width:720px){
.page{width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;padding-left:var(--ah-mobile-gutter)!important;padding-right:var(--ah-mobile-gutter)!important;margin-left:0!important;margin-right:0!important}
.page>*{max-width:100%!important;min-width:0!important;box-sizing:border-box!important}
.safety-boundary,.safety-kpis>*,.operational-empty-card,.operational-inline-empty,.family-workspace .page>:last-child,.contractor-workspace .page>:last-child{border-radius:var(--ah-mobile-card-radius)!important}
[data-help-block="kpis"]{width:100%!important;max-width:100%!important;margin-inline:0!important;padding-inline:0!important;gap:12px!important;scroll-padding-left:0!important;box-sizing:border-box!important}
[data-help-block="kpis"]>*{min-width:0!important;border-radius:var(--ah-mobile-card-radius)!important;padding:18px!important;box-sizing:border-box!important}
[data-help-block="kpis"]>button{display:grid!important;grid-template-columns:42px minmax(0,1fr)!important;align-items:center!important;column-gap:14px!important;text-align:left!important}
[data-help-block="kpis"]>button>span:first-child{width:42px!important;min-width:42px!important;height:42px!important;margin:0!important}
[data-help-block="kpis"]>button>span:last-child{display:grid!important;min-width:0!important;gap:3px!important;padding:0!important;margin:0!important}
[data-help-block="kpis"] :is(strong,span,p,small,em){max-width:100%!important;min-width:0!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:normal!important;word-break:normal!important}
.owner-dashboard-kpis{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important;overflow:visible!important}
.owner-dashboard-kpi{width:100%!important;min-width:0!important;min-height:104px!important;height:auto!important;max-height:none!important;padding:16px!important;display:grid!important;grid-template-columns:42px minmax(0,1fr)!important;align-items:center!important;column-gap:14px!important;text-align:left!important}
.owner-dashboard-kpi-icon{width:42px!important;min-width:42px!important;height:42px!important;margin:0!important}
.owner-dashboard-kpi-copy{display:grid!important;position:static!important;min-width:0!important;gap:3px!important;padding:0!important;margin:0!important;opacity:1!important;visibility:visible!important}
.owner-dashboard-kpi-copy strong{font-size:22px!important;line-height:26px!important;color:var(--ah-system-text)!important}
.owner-dashboard-kpi-copy em{font-size:10px!important;line-height:13px!important;color:var(--ah-system-muted)!important}
.family-workspace,.contractor-workspace{display:block!important;width:100%!important;max-width:100%!important;min-width:0!important}
.family-workspace>.page,.contractor-workspace>.page{padding-left:var(--ah-mobile-gutter)!important;padding-right:var(--ah-mobile-gutter)!important}
.family-workspace :is([class*=toolbar],[class*=filters],[class*=search-row]){position:relative!important;overflow:visible!important;margin-bottom:var(--ah-mobile-gap)!important;padding:16px!important;border:1px solid var(--ah-system-line)!important;border-radius:var(--ah-mobile-card-radius)!important;background:#fff!important}
.family-workspace input[placeholder*="Найти семью"]{width:100%!important;height:56px!important;padding-left:52px!important;padding-right:16px!important;border-radius:var(--ah-mobile-control-radius)!important;font-size:16px!important;box-sizing:border-box!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"]){position:relative!important;display:block!important;width:100%!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"])::before{content:none!important;display:none!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"])>svg{position:absolute!important;left:16px!important;top:50%!important;transform:translateY(-50%)!important;width:22px!important;height:22px!important;opacity:1!important;pointer-events:none!important}
.family-workspace label:has(>input[placeholder*="Найти семью"])>span:first-child{position:absolute!important;left:16px!important;top:50%!important;transform:translateY(-50%)!important;width:22px!important;height:22px!important;display:block!important;font-size:0!important;line-height:0!important;color:#171a2b!important;z-index:2!important;pointer-events:none!important}
.family-workspace label:has(>input[placeholder*="Найти семью"])>span:first-child::before{content:""!important;display:block!important;position:absolute!important;left:2px!important;top:2px!important;width:12px!important;height:12px!important;border:2px solid currentColor!important;border-radius:50%!important;box-sizing:border-box!important}
.family-workspace label:has(>input[placeholder*="Найти семью"])>span:first-child::after{content:""!important;display:block!important;position:absolute!important;left:12px!important;top:13px!important;width:7px!important;height:2px!important;border-radius:999px!important;background:currentColor!important;transform:rotate(45deg)!important;transform-origin:left center!important}
.family-workspace label:has(>input[placeholder*="Найти семью"])>span:first-child>button[data-ah-help-inline=true].ah-field-icon{display:none!important}
.family-workspace [data-ah-help-target=true]>button[data-ah-help-inline=true].ah-field-icon{position:absolute!important;left:auto!important;right:14px!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;width:28px!important;min-width:28px!important;height:28px!important;margin:0!important;padding:0!important;z-index:30!important;opacity:1!important;visibility:visible!important;background:#fff!important}
.family-workspace [data-ah-help-target=true]:has(input[placeholder*="Найти семью"])>input[placeholder*="Найти семью"]{padding-right:16px!important}
.family-workspace [data-ah-help-target=true]:has(input[placeholder*="Найти семью"])>button[data-ah-help-inline=true].ah-field-icon{display:none!important}
.family-workspace .page>:last-child{margin-top:var(--ah-mobile-gap)!important;padding:22px!important;min-height:280px!important;border:1px solid var(--ah-system-line)!important;background:#fff!important;overflow:hidden!important}
.contractor-workspace .page>:last-child{margin-top:var(--ah-mobile-gap)!important;padding:20px!important;border:1px solid var(--ah-system-line)!important;background:#fff!important;overflow:hidden!important}
.contractor-workspace .page>:last-child>*{border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;border-radius:0!important}
.contractor-workspace .page>:last-child :is(h1,h2,h3,h4,p,strong,span){max-width:100%!important;overflow-wrap:anywhere!important}
.contractor-workspace .page>:last-child button:empty,.contractor-workspace .page>:last-child div:empty{display:none!important}
.safety-boundary,.safety-kpis>*,.operational-empty-card,.operational-inline-empty{border:1px solid var(--ah-system-line)!important;background:#fff!important;overflow:hidden!important}
.safety-kpis{gap:12px!important}
.finance-period-bar{display:grid!important;grid-template-columns:1fr!important;gap:10px!important;margin:12px 0 16px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
.finance-period-bar>div:first-child{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important}
.finance-period-bar>div:first-child span{font-size:14px!important;font-weight:700!important;color:var(--ah-system-muted)!important}
.finance-period-bar>div:first-child strong,.finance-period-bar>div:first-child small{display:none!important}
.finance-period-actions{display:grid!important;grid-template-columns:48px minmax(0,1fr) 48px!important;gap:10px!important;align-items:center!important;width:100%!important}
.finance-period-actions>button:not(.finance-current-period){width:48px!important;height:var(--ah-mobile-control-height)!important;padding:0!important;border:1px solid var(--ah-system-line)!important;border-radius:var(--ah-mobile-control-radius)!important;background:#fff!important}
.finance-period-actions label{min-width:0!important;width:100%!important}
.finance-period-actions input{width:100%!important;min-width:0!important;height:var(--ah-mobile-control-height)!important;padding:0 12px!important;border:1px solid var(--ah-system-line)!important;border-radius:var(--ah-mobile-control-radius)!important;background:#fff!important;text-align:center!important;font-size:17px!important;box-sizing:border-box!important}
.finance-period-actions .finance-current-period{grid-column:1/-1!important;min-height:42px!important;width:100%!important;padding:0 14px!important;border-radius:var(--ah-mobile-control-radius)!important;font-size:15px!important}
}
`;
fs.writeFileSync(polishPath, polish, "utf8");

const helpPath = "/app/app/components/ContextualHelpSystem.css";
let help = fs.readFileSync(helpPath, "utf8");
help = stripLegacyBlocks(help, ["ARTHELLO_HELP_UX_V3","ARTHELLO_HELP_VISIBILITY_V4"]);
help += `
/* ARTHELLO_HELP_CANONICAL_V5 */
[data-ah-help-target=true]{position:relative!important;overflow:visible!important}
[data-ah-help-target=true]>button[data-ah-help-inline=true].ah-field-icon{position:absolute!important;left:auto!important;right:12px!important;top:50%!important;bottom:auto!important;width:26px!important;min-width:26px!important;height:26px!important;margin:0!important;padding:0!important;transform:translateY(-50%)!important;z-index:40!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important}
[data-ah-help-target=true]>:is(input:not([type=checkbox]):not([type=radio]),select,textarea,[role=combobox]){padding-right:50px!important}
@media(max-width:720px){.ah-tour-callout{position:fixed!important;left:12px!important;right:12px!important;top:auto!important;bottom:calc(92px + env(safe-area-inset-bottom))!important;width:auto!important;max-width:none!important;max-height:min(56dvh,520px)!important;overflow:auto!important;transform:none!important}.ah-tour-hole{pointer-events:none!important;border-radius:18px!important}}
`;
fs.writeFileSync(helpPath, help, "utf8");
console.log("patch-mobile-canonical-v5: legacy mobile layers removed; canonical system applied");
