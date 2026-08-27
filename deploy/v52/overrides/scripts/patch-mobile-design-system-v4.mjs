import fs from "node:fs";

const cssPath = "/app/app/components/SystemWideMobilePolish.css";
let css = fs.readFileSync(cssPath, "utf8");
const marker = "/* ARTHELLO_MOBILE_DESIGN_SYSTEM_V4 */";
if (!css.includes(marker)) css += `
${marker}
:root{--ah-mobile-gutter:20px;--ah-mobile-gap:16px;--ah-mobile-card-radius:22px;--ah-mobile-control-radius:16px}
@media(max-width:720px){
.page{padding-left:var(--ah-mobile-gutter)!important;padding-right:var(--ah-mobile-gutter)!important}
.family-workspace,.contractor-workspace{display:block!important;width:100%!important;min-width:0!important}
.family-workspace>.page,.contractor-workspace>.page{padding-left:var(--ah-mobile-gutter)!important;padding-right:var(--ah-mobile-gutter)!important}
.family-workspace .page>:is(header,section,article,div){max-width:100%;min-width:0;box-sizing:border-box}
.family-workspace .page>:last-child,.contractor-workspace .page>:last-child{border:1px solid var(--ah-system-line)!important;border-radius:var(--ah-mobile-card-radius)!important;background:#fff!important;overflow:hidden!important;margin-top:var(--ah-mobile-gap)!important}
.family-workspace :is([class*=toolbar],[class*=filters],[class*=search-row]){position:relative!important;border-radius:var(--ah-mobile-card-radius)!important;padding:16px!important;background:#fff!important;border:1px solid var(--ah-system-line)!important;overflow:visible!important}
.family-workspace input[placeholder*="Найти семью"]{height:56px!important;padding-left:52px!important;padding-right:52px!important;border-radius:var(--ah-mobile-control-radius)!important;font-size:16px!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"]){position:relative!important;display:block!important}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"])::before{content:"⌕";position:absolute;left:16px;top:50%;transform:translateY(-50%);z-index:5;font-size:28px;line-height:1;color:#171a2b;pointer-events:none}
.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"]) :is(svg,[class*=search],[class*=icon]){opacity:0!important;pointer-events:none!important}
.family-workspace [data-ah-help-target=true]>button[data-ah-help-inline=true].ah-field-icon{left:auto!important;right:14px!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;width:26px!important;min-width:26px!important;height:26px!important;z-index:30!important;opacity:1!important;background:#fff!important}
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