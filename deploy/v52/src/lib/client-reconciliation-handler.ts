import { env } from 'cloudflare:workers';
import { ensureCoreTables } from '../db';
import { serializeIdentityMutation } from './entity-identity';
import { getAuthenticatedRequestContext,isCanonicalOwnerContext,verifyAuthenticatedRequestCsrf } from './production-auth';
import { hasTrustedMutationOrigin } from './request-security';
import { REVIEW_KEY,applyReview,reviewPreview } from './client-reconciliation';
import type { ReviewCard,ReviewLink,ReviewReceipt } from './client-reconciliation';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function readClientReview(){
 const cards=(await env.DB.prepare('SELECT id,entity_type AS entityType,display_name AS displayName,source_system AS sourceSystem,source_record_id AS sourceRecordId,scope,status,metadata,data_quality AS dataQuality,updated_at AS updatedAt FROM entities').all<ReviewCard>()).results;
 const links=(await env.DB.prepare('SELECT from_entity_id AS fromEntityId,to_entity_id AS toEntityId,relation_type AS relationType FROM entity_links').all<ReviewLink>()).results;
 const raw=await env.DB.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').bind(REVIEW_KEY).first<{state_value:string}>();
 const receipt:ReviewReceipt|null=raw?JSON.parse(raw.state_value):null;
 return {cards,links,receipt};
}
export async function reviewedCards<T extends ReviewCard>(cards:T[]){const state=await readClientReview();const all=await applyReview(state.cards,state.links,state.receipt);const byId=new Map(all.map(c=>[c.id,c]));return cards.map(c=>({...c,...(byId.get(c.id)??{})}));}
export async function handleClientReconciliation(request:Request,body?:Record<string,unknown>){
 try{
 const context=await getAuthenticatedRequestContext(request);if(!context)return reply({error:'Требуется вход'},401);
 if(!isCanonicalOwnerContext(context))return reply({error:'Итоговую сверку подтверждает собственник'},403);
 if(body){if(!hasTrustedMutationOrigin(request,(env as unknown as {ARTHELLO_PUBLIC_ORIGIN?:string}).ARTHELLO_PUBLIC_ORIGIN??''))return reply({error:'Источник запроса отклонён'},403);try{verifyAuthenticatedRequestCsrf(request,context);}catch{return reply({error:'Обновите защитную сессию'},403);}}
 return await serializeIdentityMutation(async()=>{
 await ensureCoreTables();const state=await readClientReview();const preview=await reviewPreview(state.cards,state.links);
 if(!body)return reply({token:preview.token,counts:preview.counts,lastConfirmedAt:state.receipt?.at??null});
 const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(reason.length<8||reason.length>500)return reply({error:'Укажите основание окончательной сверки'},400);
 if(body.token!==preview.token||!preview.targets.length)return reply({error:'Состав изменился. Повторите предпросмотр сверки.'},409);
 const at=new Date().toISOString();const receipt:ReviewReceipt={version:1,actor:context.actor,at,reason,signatures:preview.signatures};
 const expected=JSON.stringify(preview.targets.map(c=>({id:c.id,updatedAt:c.updatedAt,metadata:c.metadata,status:c.status,displayName:c.displayName,scope:c.scope})));
 const guard=env.DB.prepare(`INSERT INTO system_runtime_state(state_key,state_value,updated_at) VALUES(?,CASE WHEN (SELECT count(*) FROM json_each(?) j JOIN entities e ON e.id=json_extract(j.value,'$.id') WHERE e.updated_at=json_extract(j.value,'$.updatedAt') AND e.metadata=json_extract(j.value,'$.metadata') AND e.status=json_extract(j.value,'$.status') AND e.display_name=json_extract(j.value,'$.displayName') AND e.scope=json_extract(j.value,'$.scope'))=? THEN ? ELSE NULL END,?) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=excluded.updated_at`).bind(REVIEW_KEY,expected,preview.targets.length,JSON.stringify(receipt),at);
 await env.DB.batch([guard,
 env.DB.prepare("UPDATE entities SET status='Активна',data_quality='Проверено',updated_at=? WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND status NOT IN ('Архив','Объединена')").bind(at,expected),
 ...preview.targets.map(c=>env.DB.prepare("INSERT INTO audit_events(actor,action,entity_type,entity_id,payload) VALUES(?,'client.owner_reconciled','entity',?,?)").bind(context.actor,c.id,JSON.stringify({reason,at,before:{status:c.status,dataQuality:c.dataQuality},after:{status:'Активна',dataQuality:'Проверено'},scope:'client_identity_and_roster',financialVerification:false,identityMerged:false,accessGranted:false})))
 ]);
 return reply({confirmed:true,counts:preview.counts,at});
 });
 }catch{return reply({error:'Подтверждение не сохранено. Обновите состав и повторите.'},503);}
}
