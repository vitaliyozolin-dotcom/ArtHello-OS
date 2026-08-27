import fs from "node:fs";
const path="/app/app/components/ContractorWorkspace.tsx";
let source=fs.readFileSync(path,"utf8");
if(!source.includes('from "./design-system"')){
  source=source.replace(/^("use client";\s*)?/,(m)=>`${m}import { Card, EmptyState, KpiCard, PageContainer, PageHeader, SearchField } from "./design-system";\n`);
}
source=source.replace(/<main className="page contractor-workspace">/g,'<PageContainer className="contractor-workspace">').replace(/<main className="page">/g,'<PageContainer className="contractor-workspace">').replace(/<\/main>\s*;?\s*$/m,'</PageContainer>;');
source=source.replace(/<header className="page-header">([\s\S]*?)<\/header>/m,(full,inner)=>{
  const title=(inner.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)||[])[1]?.replace(/<[^>]+>/g,"").trim()||"Подрядчики";
  const description=(inner.match(/<p[^>]*>([\s\S]*?)<\/p>/)||[])[1]?.replace(/<[^>]+>/g,"").trim();
  return `<PageHeader title=${JSON.stringify(title)}${description?` description=${JSON.stringify(description)}`:""} />`;
});
source=source.replace(/<section className="contractor-kpis">([\s\S]*?)<\/section>/m,(full,inner)=>`<section className="contractor-kpis ahContractorKpis">${inner.replace(/<article([^>]*)>([\s\S]*?)<\/article>/g,'<Card$1>$2</Card>')}</section>`);
source=source.replace(/<div className="contractor-empty">\s*<strong>([\s\S]*?)<\/strong>\s*<span>([\s\S]*?)<\/span>\s*<\/div>/m,(_,title,description)=>`<Card className="ahContractorEmpty"><EmptyState title=${JSON.stringify(title.replace(/<[^>]+>/g,"").trim())} description=${JSON.stringify(description.replace(/<[^>]+>/g,"").trim())} /></Card>`);
source=source.replace(/<input([^>]*placeholder="[^"]*подряд[^"]*"[^>]*)\/>/i,(full,attrs)=>{
 const ph=(attrs.match(/placeholder="([^"]*)"/)||[])[1]||"Найти подрядчика";
 const value=(attrs.match(/value=\{([^}]+)\}/)||[])[1]||"query";
 const handler=(attrs.match(/onChange=\{\(event\) => ([^}]+)\}/)||[])[1];
 return handler?`<SearchField label="Поиск подрядчика" placeholder=${JSON.stringify(ph)} value={${value}} onChange={(value) => ${handler.replace(/event\.target\.value/g,"value")}} icon={<span aria-hidden="true">⌕</span>} />`:full;
});
fs.writeFileSync(path,source,"utf8");
console.log("patch-contractors-design-system-pilot: applied");
