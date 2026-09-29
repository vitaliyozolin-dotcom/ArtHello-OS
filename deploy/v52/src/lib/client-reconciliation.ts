export type ReviewCard={id:string;entityType:string;displayName:string;sourceSystem:string;sourceRecordId:string;scope:string;status:string;metadata:string;dataQuality:string;updatedAt:string};
export type ReviewLink={fromEntityId:string;toEntityId:string;relationType:string};
export type ReviewReceipt={version:1;actor:string;at:string;reason:string;signatures:Record<string,string>};
export const REVIEW_KEY='client_reconciliation:v1';
const current=(c:ReviewCard)=>c.status!=='Архив'&&c.status!=='Объединена'&&!c.sourceSystem.startsWith('SYNTHETIC');
export function reviewTargets(cards:ReviewCard[],links:ReviewLink[]) {
 const families=new Set(cards.filter(c=>current(c)&&c.entityType==='Семья').map(c=>c.id));
 const linked=new Set(links.filter(l=>families.has(l.fromEntityId)||families.has(l.toEntityId)).flatMap(l=>[l.fromEntityId,l.toEntityId]));
 return cards.filter(c=>current(c)&&(families.has(c.id)||(['Клиент','Ребёнок'].includes(c.entityType)&&linked.has(c.id)))).sort((a,b)=>a.id.localeCompare(b.id));
}
const name=(s:string)=>s.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
export async function reviewSignature(c:ReviewCard,cards:ReviewCard[],links:ReviewLink[]) {
 let meta:Record<string,unknown>={};try{meta=JSON.parse(c.metadata);}catch{}
 const keys=['remoteBranchId','alfaCustomerId','customerLifecycle','alfaStatusId','alfaStatusName','guardianName','birthDate','localArchive'];
 const source=Object.fromEntries(keys.map(k=>[k,meta[k]??null]));
 const assignments=Array.isArray(meta.branchAssignments)?meta.branchAssignments.map((a:any)=>[a.remoteBranchId,a.scope,a.active,a.alfaStatusId,a.alfaStatusName]).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):[];
 const peers=cards.filter(p=>current(p)&&p.entityType===c.entityType&&name(p.displayName)===name(c.displayName)).map(p=>p.id).sort();
 const relations=links.filter(l=>l.fromEntityId===c.id||l.toEntityId===c.id).map(l=>[l.fromEntityId,l.toEntityId,l.relationType]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return digest([c.id,c.entityType,c.displayName,c.sourceSystem,c.sourceRecordId,c.scope,c.status,source,assignments,peers,relations]);
}
export async function digest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function applyReview<T extends ReviewCard>(cards:T[],links:ReviewLink[],receipt:ReviewReceipt|null){
 if(!receipt||receipt.version!==1||!receipt.actor||!receipt.reason||!Number.isFinite(Date.parse(receipt.at)))return cards;
 return Promise.all(cards.map(async c=>current(c)&&receipt.signatures[c.id]&&receipt.signatures[c.id]===await reviewSignature(c,cards,links)?{...c,dataQuality:'Проверено',ownerReconciled:true}:c));
}
export async function reviewPreview(cards:ReviewCard[],links:ReviewLink[]){
 const targets=reviewTargets(cards,links);const signatures=Object.fromEntries(await Promise.all(targets.map(async c=>[c.id,await reviewSignature({...c,status:'Активна'},cards.map(r=>r.id===c.id?{...r,status:'Активна'}:r),links)])));
 return {targets,signatures,token:await digest(targets.map(c=>[c.id,c.updatedAt,c.metadata,c.status,c.displayName,c.scope])),counts:{families:targets.filter(c=>c.entityType==='Семья').length,children:targets.filter(c=>c.entityType==='Ребёнок').length,representatives:targets.filter(c=>c.entityType==='Клиент').length,distinctChildNames:new Set(targets.filter(c=>c.entityType==='Ребёнок').map(c=>name(c.displayName))).size}};
}
