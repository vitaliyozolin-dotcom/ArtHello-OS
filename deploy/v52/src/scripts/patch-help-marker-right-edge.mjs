import fs from "node:fs";
const path="/app/app/components/SystemWideMobilePolish.css";
let source=fs.readFileSync(path,"utf8");
const marker="/* ARTHELLO_HELP_MARKER_RIGHT_EDGE */";
if(!source.includes(marker)) source+=`\n${marker}\n.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"]){position:relative!important}.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"])>:is(span,i):first-child{position:absolute!important;left:16px!important;top:50%!important;width:22px!important;height:22px!important;display:grid!important;place-items:center!important;transform:translateY(-50%)!important;font-size:21px!important;line-height:1!important;z-index:2!important}.family-workspace input[placeholder*="Найти семью"]{padding-left:50px!important;padding-right:18px!important}\n`;
fs.writeFileSync(path,source);
console.log("patch-help-marker-right-edge: applied");
