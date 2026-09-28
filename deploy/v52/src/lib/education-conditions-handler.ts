import { env } from 'cloudflare:workers';
import { ensureCoreTables } from '../db';
import { readIdentityIndex } from './entity-identity-db';
import { serializeIdentityMutation } from './entity-identity';
import { getAuthenticatedRequestContext, isCanonicalOwnerContext, verifyAuthenticatedRequestCsrf } from './production-auth';
import { hasTrustedMutationOrigin } from './request-security';
import { educationConditionKey, makeEducationCondition, permitsEnrollment } from './education-conditions';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function handleEducationConditions(request:Request, body?:Record<string,unknown>) {
  try {
    const context=await getAuthenticatedRequestContext(request);
    if(!context) return reply({error:'Требуется вход'},401);
    if(!isCanonicalOwnerContext(context)) return reply({error:'Условия бесплатного обучения подтверждает собственник'},403);
    if(body) {
      const origin=(env as unknown as {ARTHELLO_PUBLIC_ORIGIN?:string}).ARTHELLO_PUBLIC_ORIGIN??'';
      if(!hasTrustedMutationOrigin(request,origin)) return reply({error:'Источник запроса отклонён'},403);
      try {verifyAuthenticatedRequestCsrf(request,context);} catch {return reply({error:'Обновите защитную сессию'},403);}
      if(typeof body.enabled!=='boolean') return reply({error:'Укажите условие обучения'},400);
    }
    const params=new URL(request.url).searchParams;
    const childId=String(body?.childId??params.get('childId')??'');
    const familyId=String(body?.familyId??params.get('familyId')??'');
    if(!childId||childId.length>80||!familyId||familyId.length>80) return reply({error:'Укажите ребёнка и семью'},400);
    return await serializeIdentityMutation(async()=>{
      await ensureCoreTables();
      const index=await readIdentityIndex(env.DB);
      const child=index.cards.find(card=>card.id===childId&&card.entityType==='Ребёнок');
      const family=index.cards.find(card=>card.id===familyId&&card.entityType==='Семья');
      if(!child||!family||index.canonical(childId)!==childId||index.canonical(familyId)!==familyId) return reply({error:'Откройте действующую единую карточку'},409);
      if(child.status!=='Активна'||family.status!=='Активна') return reply({error:'Архивная или неподтверждённая карточка требует отдельной сверки'},409);
      const links=(await env.DB.prepare('SELECT from_entity_id,to_entity_id FROM entity_links WHERE to_entity_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(index.members(childId))).all<{from_entity_id:string;to_entity_id:string}>()).results;
      if(!links.some(link=>index.canonical(link.from_entity_id)===familyId)) return reply({error:'Ребёнок не принадлежит этой семье'},409);
      const sourceCards=index.cards.filter(card=>index.members(childId).includes(card.id));
      const candidates=sourceCards.map(card=>({card,meta:JSON.parse(card.metadata) as Record<string,unknown>}))
        .filter(({meta})=>/^\d+$/.test(String(meta.remoteBranchId??''))&&meta.alfaCustomerId);
      const branches=candidates.map(({card,meta})=>({remoteBranchId:String(meta.remoteBranchId),name:card.scope}));
      const requestedBranch=String(body?.remoteBranchId??params.get('remoteBranchId')??'');
      const selected=requestedBranch?candidates.filter(({meta})=>String(meta.remoteBranchId)===requestedBranch):candidates;
      if(!body&&!requestedBranch&&candidates.length>1) return reply({branches,selectionRequired:true});
      if(selected.length!==1) return reply({error:'Выберите точный филиал ребёнка'},409);
      const {card:sourceCard,meta}=selected[0];
      const remoteBranchId=String(meta.remoteBranchId);
      const raw=await env.DB.prepare("SELECT o.payload FROM alfacrm_current_records c JOIN alfacrm_raw_observations o ON o.id=c.observation_id WHERE c.module='families' AND c.remote_branch_id=? AND c.record_id=? AND c.active=1").bind(remoteBranchId,String(meta.alfaCustomerId)).first<{payload:string}>();
      if(!raw) return reply({error:'Сначала синхронизируйте действующую карточку AlfaCRM'},409);
      if(!['open','active','unverified'].includes(String(meta.customerLifecycle))) return reply({error:'Статус источника требует отдельной сверки'},409);
      const key=educationConditionKey(childId,remoteBranchId);
      const previous=await env.DB.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').bind(key).first<{state_value:string}>();
      const before=JSON.parse(previous?.state_value??'null');
      if(!body) return reply({condition:before,enabled:permitsEnrollment('open',before,childId,remoteBranchId),branch:sourceCard.scope,remoteBranchId,branches});
      const enabled=body.enabled as boolean;
      if(enabled===permitsEnrollment('open',before,childId,remoteBranchId)) return reply({condition:before,enabled,unchanged:true,branch:sourceCard.scope,remoteBranchId,branches});
      const condition=makeEducationCondition({childId,remoteBranchId,enabled,actor:context.actor,now:new Date().toISOString()});
      await env.DB.batch([
        env.DB.prepare('INSERT INTO system_runtime_state(state_key,state_value,updated_at) VALUES(?,?,?) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=excluded.updated_at').bind(key,JSON.stringify(condition),condition.effectiveFrom),
        env.DB.prepare("INSERT INTO audit_events(actor,action,entity_type,entity_id,payload) VALUES(?,'education.conditions_updated','entity',?,?)").bind(context.actor,childId,JSON.stringify({before,after:condition,familyId,financialHistoryChanged:false,accessGranted:false})),
      ]);
      return reply({condition,enabled,branch:sourceCard.scope,remoteBranchId,branches,requiresSync:true});
    });
  } catch {return reply({error:'Условия обучения не сохранены. Повторите после проверки связи.'},503);}
}
