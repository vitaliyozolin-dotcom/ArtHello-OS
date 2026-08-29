import fs from "node:fs";

const cssPath = "/app/app/components/SystemWideMobilePolish.css";
let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* ARTHELLO_MOBILE_DESIGN_SYSTEM_V4 */";
if (!css.includes(marker)) css += `
${marker}
:root{--ah-mobile-gutter:20px;--ah-mobile-gap:16px;--ah-mobile-card-radius:22px;--ah-mobile-control-radius:16px}
@media(max-width:720px){
.owner-dashboard-kpis{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;grid-auto-flow:row!important;grid-auto-columns:auto!important;gap:12px!important;width:100%!important;max-width:100%!important;overflow:visible!important}
.owner-dashboard-kpi{display:grid!important;grid-template-columns:42px minmax(0,1fr)!important;align-items:center!important;gap:10px!important;width:100%!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:104px!important;padding:12px!important;border:1px solid var(--ah-system-line)!important;border-radius:16px!important;background:#fff!important;text-align:left!important;overflow:hidden!important}
.owner-dashboard-kpi-icon{display:grid!important;place-items:center!important;width:42px!important;min-width:42px!important;height:42px!important;margin:0!important;border-radius:13px!important}
.owner-dashboard-kpi-icon svg{width:21px!important;height:21px!important}
.owner-dashboard-kpi-copy{display:grid!important;min-width:0!important;gap:2px!important;align-content:center!important}
.owner-dashboard-kpi-copy small,.owner-dashboard-kpi-copy strong,.owner-dashboard-kpi-copy em{display:block!important;max-width:100%!important;margin:0!important;overflow:visible!important;text-overflow:clip!important;white-space:normal!important;overflow-wrap:anywhere!important;font-style:normal!important}
.owner-dashboard-kpi-copy small{font-size:11px!important;line-height:14px!important;color:var(--ah-system-muted)!important}
.owner-dashboard-kpi-copy strong{font-size:22px!important;line-height:26px!important;color:var(--ah-system-text)!important}
.owner-dashboard-kpi-copy em{font-size:10px!important;line-height:13px!important;color:var(--ah-system-muted)!important}
.page{padding-left:var(--ah-mobile-gutter)!important;padding-right:var(--ah-mobile-gutter)!important}
.family-workspace,.contractor-workspace{display:block!important;width:100%!important;min-width:0!important}
.family-workspace>.page,.contractor-workspace>.page{padding-left:var(--ah-mobile-gutter)!important;padding-right:var(--ah-mobile-gutter)!important}
.family-workspace .page>:is(header,section,article,div){max-width:100%;min-width:0;box-sizing:border-box}
.family-workspace .page>:last-child,.contractor-workspace .page>:last-child{border:1px solid var(--ah-system-line)!important;border-radius:var(--ah-mobile-card-radius)!important;background:#fff!important;overflow:hidden!important;margin-top:var(--ah-mobile-gap)!important}
.family-workspace :is([class*=toolbar],[class*=filters],[class*=search-row]){position:relative!important;border-radius:var(--ah-mobile-card-radius)!important;padding:16px!important;background:#fff!important;border:1px solid var(--ah-system-line)!important;overflow:visible!important}
.family-workspace input[placeholder*="Найти семью"]{height:56px!important;padding-left:52px!important;padding-right:16px!important;border-radius:var(--ah-mobile-control-radius)!important;font-size:16px!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"]){position:relative!important;display:block!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"])::before{content:none!important;display:none!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"])>svg{position:absolute!important;left:16px!important;top:50%!important;transform:translateY(-50%)!important;width:22px!important;height:22px!important;opacity:1!important;pointer-events:none!important}
.family-workspace [data-ah-help-target=true]:has(input[placeholder*="Найти семью"])>button[data-ah-help-inline=true].ah-field-icon{display:none!important}
.family-workspace .page>:last-child{padding:22px!important;min-height:300px!important}
.contractor-workspace .page :is(section,article,[class*=card],[class*=panel],[class*=kpi],[class*=stat],[class*=summary],[class*=registry],[class*=register],[class*=toolbar],[class*=empty],[class*=boundary],[class*=notice]){border-radius:var(--ah-mobile-card-radius)!important;box-sizing:border-box!important}
.contractor-workspace .page :is([class*=kpi],[class*=stat],[class*=summary])>*{border-radius:var(--ah-mobile-card-radius)!important}
.finance-period-bar{padding:18px!important;border-radius:var(--ah-mobile-card-radius)!important;gap:16px!important}
.finance-period-bar>div:first-child{gap:6px!important}
.finance-period-bar strong{font-size:22px!important;line-height:1.15!important}
.finance-period-actions{display:grid!important;grid-template-columns:48px minmax(0,1fr) 48px!important;gap:10px!important}
.finance-period-actions>button:not(.finance-current-period){width:48px!important;height:48px!important;padding:0!important;border-radius:var(--ah-mobile-control-radius)!important}
.finance-period-actions label{min-width:0!important}
.finance-period-actions input{width:100%!important;height:48px!important;min-width:0!important;padding:0 14px!important;border-radius:var(--ah-mobile-control-radius)!important;text-align:center!important;font-size:17px!important}
.finance-period-actions .finance-current-period{grid-column:1/-1!important;width:100%!important;min-height:48px!important;border-radius:var(--ah-mobile-control-radius)!important}
}
`;
fs.writeFileSync(cssPath, css, "utf8");

const helpCssPath = "/app/app/components/ContextualHelpSystem.css";
let helpCss = fs.readFileSync(helpCssPath, "utf8");
const helpMarker = "/* ARTHELLO_HELP_VISIBILITY_V4 */";
if (!helpCss.includes(helpMarker)) helpCss += `
${helpMarker}
button[data-ah-help-inline=true].ah-field-icon{visibility:visible!important;clip:auto!important;clip-path:none!important;pointer-events:auto!important}
[data-ah-help-target=true]{position:relative!important;overflow:visible!important}
[data-ah-help-target=true]>button[data-ah-help-inline=true].ah-field-icon{position:absolute!important;left:auto!important;right:12px!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;z-index:40!important;width:26px!important;min-width:26px!important;height:26px!important;opacity:1!important}
@media(max-width:720px){.ah-tour-callout{position:fixed!important;left:12px!important;right:12px!important;bottom:calc(92px + env(safe-area-inset-bottom))!important;top:auto!important;transform:none!important;max-width:none!important}.ah-tour-hole{pointer-events:none!important}}
`;
fs.writeFileSync(helpCssPath, helpCss, "utf8");

console.log("patch-mobile-design-system-v4: applied");