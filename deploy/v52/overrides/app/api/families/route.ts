import { asc, eq, inArray, or } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { auditEvents, clientAccruals, clientLifecycles, educationGroups, educationStudents, entities, entityLinks, financialOperations, legalContracts, legalDocumentItems, salesLeads, salesStageEvents, salesTouchpoints } from "../../../db/schema";
import { getRequestUser } from "../../../lib/request-user";

export async function GET(request:Request){
  const actor=getRequestUser(request);if(!actor)return Response.json({error:"Требуется вход"},{status:401});
  try{
    await ensureCoreTables();const id=new URL(request.url).searchParams.get("id")?.trim()||"";if(!id)return Response.json({error:"Укажите семью"},{status:400});const db=getDb();
    const[family]=await db.select().from(entities).where(eq(entities.id,id)).limit(1);if(!family||family.entityType!=="Семья")return Response.json({error:"Семья не найдена"},{status:404});
    const links=await db.select().from(entityLinks).where(or(eq(entityLinks.fromEntityId,id),eq(entityLinks.toEntityId,id)));const memberIds=[...new Set(links.map(link=>link.fromEntityId===id?link.toEntityId:link.fromEntityId))];
    const members=memberIds.length?await db.select().from(entities).where(inArray(entities.id,memberIds)):[];
    const[operations,students,groups,leads,lifecycles,accruals,contracts,familyCandidates]=await Promise.all([
      db.select().from(financialOperations).where(eq(financialOperations.counterpartyEntityId,id)).orderBy(asc(financialOperations.operationDate)),
      db.select().from(educationStudents).where(eq(educationStudents.familyEntityId,id)),db.select().from(educationGroups),
      db.select().from(salesLeads).where(eq(salesLeads.familyEntityId,id)),
      db.select().from(clientLifecycles).where(eq(clientLifecycles.familyEntityId,id)),
      db.select().from(clientAccruals).where(eq(clientAccruals.familyEntityId,id)),
      db.select().from(legalContracts).where(eq(legalContracts.partyEntityId,id)),
      db.select({id:entities.id,displayName:entities.displayName,status:entities.status}).from(entities).where(eq(entities.entityType,"Семья")),
    ]);
    const duplicate=familyCandidates.find(candidate=>candidate.id!==family.id&&candidate.status!=="Объединена"&&normalizeEntityName(candidate.displayName)===normalizeEntityName(family.displayName));
    const leadIds=leads.map(lead=>lead.id),contractIds=contracts.map(contract=>contract.id);
    const[touchpoints,stageEvents,contractDocuments]=await Promise.all([
      leadIds.length?db.select().from(salesTouchpoints).where(inArray(salesTouchpoints.leadId,leadIds)):[],
      leadIds.length?db.select().from(salesStageEvents).where(inArray(salesStageEvents.leadId,leadIds)):[],
      contractIds.length?db.select().from(legalDocumentItems).where(inArray(legalDocumentItems.contractId,contractIds)):[],
    ]);
    const relatedIds=[...new Set(leads.flatMap(lead=>[lead.managerEntityId,lead.childEntityId,lead.serviceEntityId]).filter(Boolean))],relatedEntities=relatedIds.length?await db.select({id:entities.id,displayName:entities.displayName}).from(entities).where(inArray(entities.id,relatedIds)):[];
    const groupMap=new Map(groups.map(group=>[group.id,group]));
    return Response.json({family:{...family,dataQuality:familyDataState(family,Boolean(duplicate)),profile:metadata(family.metadata)},hasDuplicate:Boolean(duplicate),members:members.filter(member=>["Клиент","Ребёнок"].includes(member.entityType)).map(member=>({...member,profile:metadata(member.metadata),relation:links.find(link=>link.fromEntityId===member.id||link.toEntityId===member.id)?.relationType??""})),operations,students:students.map(student=>({...student,group:groupMap.get(student.groupId)??null})),relationship:{leads,touchpoints,stageEvents,lifecycles,accruals,contracts,contractDocuments,entityNames:Object.fromEntries(relatedEntities.map(entity=>[entity.id,entity.displayName]))}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Не удалось загрузить семью"},{status:500})}
}

export async function POST(request:Request){
  const actor=getRequestUser(request);if(!actor)return Response.json({error:"Требуется вход"},{status:401});
  try{
    await ensureCoreTables();const body=await request.json() as Record<string,unknown>,values=familyValues(body);if("error" in values)return Response.json({error:values.error},{status:400});const db=getDb();await assertOperationIds(values.operationIds);
    const familyCandidates=await db.select().from(entities).where(eq(entities.entityType,"Семья")),duplicate=familyCandidates.find(candidate=>candidate.status!=="Объединена"&&normalizeEntityName(candidate.displayName)===normalizeEntityName(values.familyName));if(duplicate)return Response.json({error:`Возможный дубль: ${duplicate.displayName} · ${duplicate.id}`},{status:409});
    const token=crypto.randomUUID().slice(0,8).toUpperCase(),familyId=`FAM-M-${token}`,parentId=`CLI-M-${crypto.randomUUID().slice(0,8).toUpperCase()}`,childId=`CHD-M-${crypto.randomUUID().slice(0,8).toUpperCase()}`,now=new Date().toISOString();
    await db.insert(entities).values([
      {id:familyId,entityType:"Семья",displayName:values.familyName,status:"Активна",sourceSystem:"MANUAL",sourceRecordId:`MANUAL:${familyId}`,dataQuality:"Проверено",scope:values.branch,metadata:JSON.stringify({...values.familyOther,branch:values.branch,address:values.address,familyManager:values.familyManager,contractNumber:values.contractNumber,billingPlan:values.billingPlan,financialNote:values.financialNote,tags:values.tags,note:values.note}),createdBy:actor,updatedAt:now},
      {id:parentId,entityType:"Клиент",displayName:values.parentName,status:"Активна",sourceSystem:"MANUAL",sourceRecordId:`MANUAL:${parentId}`,dataQuality:"Проверено",scope:values.branch,metadata:JSON.stringify({...values.parentOther,phone:values.parentPhone,email:values.parentEmail,relation:values.parentRelation}),createdBy:actor,updatedAt:now},
      {id:childId,entityType:"Ребёнок",displayName:values.childName,status:"Активна",sourceSystem:"MANUAL",sourceRecordId:`MANUAL:${childId}`,dataQuality:"Проверено",scope:values.branch,metadata:JSON.stringify({...values.childOther,birthDate:values.birthDate,className:values.className,groupName:values.groupName,coreActivities:values.coreActivities,extraActivities:values.extraActivities}),createdBy:actor,updatedAt:now},
    ]);
    await db.insert(entityLinks).values([{fromEntityId:familyId,toEntityId:parentId,relationType:"Клиентская карточка семьи",createdBy:actor},{fromEntityId:familyId,toEntityId:childId,relationType:"Семья → ребёнок",createdBy:actor}]);
    const linkResult=await syncFamilyOperationalLinks(actor,familyId,childId,values.operationIds,values.groupName);
    await audit(actor,"family.created","entity",familyId,{source:"MANUAL",provenance:"Создано вручную",quality:"Проверено",status:"Активна",access:"not_granted",parentId,childId,...linkResult});
    return Response.json({familyId},{status:201});
  }catch(error){const message=error instanceof Error?error.message:"Не удалось создать семью";return Response.json({error:message},{status:message.startsWith("Финансовые операции не найдены")?400:500})}
}

export async function PATCH(request:Request){
  const actor=getRequestUser(request);if(!actor)return Response.json({error:"Требуется вход"},{status:401});
  try{
    await ensureCoreTables();const body=await request.json() as Record<string,unknown>,familyId=clean(body.familyId,80),parentId=clean(body.parentId,80),childId=clean(body.childId,80),values=familyValues(body);if(!familyId||!parentId||!childId)return Response.json({error:"Не хватает связей семьи"},{status:400});if("error" in values)return Response.json({error:values.error},{status:400});const db=getDb(),now=new Date().toISOString();await assertOperationIds(values.operationIds);
    const[currentFamily]=await db.select().from(entities).where(eq(entities.id,familyId)).limit(1);if(!currentFamily||currentFamily.entityType!=="Семья")return Response.json({error:"Семья не найдена"},{status:404});
    const familyCandidates=await db.select({id:entities.id,displayName:entities.displayName,status:entities.status}).from(entities).where(eq(entities.entityType,"Семья")),duplicate=familyCandidates.find(candidate=>candidate.id!==familyId&&candidate.status!=="Объединена"&&normalizeEntityName(candidate.displayName)===normalizeEntityName(values.familyName));
    const sourceConfirmed=body.sourceConfirmed===true,isManual=currentFamily.sourceSystem==="MANUAL",quality=duplicate?"Требует сверки":isManual?"Проверено":sourceConfirmed?"Проверено":currentFamily.dataQuality,status=currentFamily.status==="Архив"?"Архив":isManual||quality==="Проверено"?"Активна":"На проверке";
    await db.update(entities).set({displayName:values.familyName,status,dataQuality:quality,scope:values.branch,metadata:JSON.stringify({...values.familyOther,branch:values.branch,address:values.address,familyManager:values.familyManager,contractNumber:values.contractNumber,billingPlan:values.billingPlan,financialNote:values.financialNote,tags:values.tags,note:values.note}),updatedAt:now}).where(eq(entities.id,familyId));
    await db.update(entities).set({displayName:values.parentName,status,dataQuality:quality,scope:values.branch,metadata:JSON.stringify({...values.parentOther,phone:values.parentPhone,email:values.parentEmail,relation:values.parentRelation}),updatedAt:now}).where(eq(entities.id,parentId));
    await db.update(entities).set({displayName:values.childName,status,dataQuality:quality,scope:values.branch,metadata:JSON.stringify({...values.childOther,birthDate:values.birthDate,className:values.className,groupName:values.groupName,coreActivities:values.coreActivities,extraActivities:values.extraActivities}),updatedAt:now}).where(eq(entities.id,childId));
    const linkResult=await syncFamilyOperationalLinks(actor,familyId,childId,values.operationIds,values.groupName);
    await audit(actor,"family.updated","entity",familyId,{quality,status,sourceConfirmed,duplicateId:duplicate?.id??"",branch:values.branch,parentId,childId,...linkResult});return Response.json({familyId,quality,status});
  }catch(error){const message=error instanceof Error?error.message:"Не удалось обновить семью";return Response.json({error:message},{status:message.startsWith("Финансовые операции не найдены")?400:500})}
}

function familyValues(body:Record<string,unknown>){const familyName=clean(body.familyName,160),branch=clean(body.branch,120),address=clean(body.address,240),familyManager=clean(body.familyManager,160),contractNumber=clean(body.contractNumber,120),billingPlan=clean(body.billingPlan,160),financialNote=clean(body.financialNote,600),tags=clean(body.tags,300),note=clean(body.note,800),parentName=clean(body.parentName,160),parentPhone=clean(body.parentPhone,80),parentEmail=clean(body.parentEmail,160),parentRelation=clean(body.parentRelation,60)||"Родитель / представитель",childName=clean(body.childName,160),birthDate=clean(body.birthDate,20),className=clean(body.className,80),groupName=clean(body.groupName,80),coreActivities=clean(body.coreActivities,500),extraActivities=clean(body.extraActivities,500),operationIds=parseIds(body.operationIds),familyOther=parseExtra(body.familyOther),parentOther=parseExtra(body.parentOther),childOther=parseExtra(body.childOther);if(familyName.length<3||branch.length<2||parentName.length<3||childName.length<3)return{error:"Укажите семью, филиал, родителя и ребёнка"}as const;return{familyName,branch,address,familyManager,contractNumber,billingPlan,financialNote,tags,note,parentName,parentPhone,parentEmail,parentRelation,childName,birthDate,className,groupName,coreActivities,extraActivities,operationIds,familyOther,parentOther,childOther}}
function metadata(value:string):Record<string,unknown>{try{const parsed=JSON.parse(value);return parsed&&typeof parsed==="object"?parsed as Record<string,unknown>:{} }catch{return{}}}
function clean(value:unknown,max:number){return typeof value==="string"?value.trim().slice(0,max):""}
function normalizeEntityName(value:string){return value.toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/gi,"")}
function familyDataState(family:{sourceSystem:string;dataQuality:string},hasDuplicate:boolean){if(hasDuplicate)return"Требует сверки";if(family.sourceSystem==="MANUAL"&&family.dataQuality!=="Требует сверки")return"Создано вручную";return family.dataQuality}
function parseIds(value:unknown){return [...new Set(clean(value,4000).split(/[\s,;]+/).map(item=>item.trim()).filter(Boolean))].slice(0,100)}
function parseExtra(value:unknown){const result:Record<string,string>={};for(const line of clean(value,5000).split("\n")){const separator=line.indexOf(":");if(separator<1)continue;const key=line.slice(0,separator).trim().slice(0,80),entry=line.slice(separator+1).trim().slice(0,500);if(key)result[key]=entry}return result}
async function assertOperationIds(operationIds:string[]){if(!operationIds.length)return;const rows=await getDb().select({id:financialOperations.id}).from(financialOperations).where(inArray(financialOperations.id,operationIds)),found=new Set(rows.map(row=>row.id)),missing=operationIds.filter(id=>!found.has(id));if(missing.length)throw new Error(`Финансовые операции не найдены: ${missing.join(", ")}`)}
async function syncFamilyOperationalLinks(actor:string,familyId:string,childId:string,operationIds:string[],groupName:string){
  const db=getDb(),currentlyLinked=await db.select({id:financialOperations.id,counterpartyEntityId:financialOperations.counterpartyEntityId}).from(financialOperations).where(eq(financialOperations.counterpartyEntityId,familyId)),requested=operationIds.length?await db.select({id:financialOperations.id,counterpartyEntityId:financialOperations.counterpartyEntityId}).from(financialOperations).where(inArray(financialOperations.id,operationIds)):[],found=new Set(requested.map(row=>row.id)),missing=operationIds.filter(id=>!found.has(id));
  if(missing.length)throw new Error(`Финансовые операции не найдены: ${missing.join(", ")}`);
  const removed=currentlyLinked.map(row=>row.id).filter(id=>!found.has(id));if(removed.length)await db.update(financialOperations).set({counterpartyEntityId:"",updatedAt:new Date().toISOString()}).where(inArray(financialOperations.id,removed));
  if(operationIds.length)await db.update(financialOperations).set({counterpartyEntityId:familyId,updatedAt:new Date().toISOString()}).where(inArray(financialOperations.id,operationIds));
  if(removed.length||operationIds.length)await audit(actor,"family.finance_links_updated","entity",familyId,{before:currentlyLinked.map(row=>row.id),after:operationIds,reassignedFrom:Object.fromEntries(requested.filter(row=>row.counterpartyEntityId&&row.counterpartyEntityId!==familyId).map(row=>[row.id,row.counterpartyEntityId]))});
  const[matchingGroup]=groupName?await db.select().from(educationGroups).where(eq(educationGroups.name,groupName)).limit(1):[],[student]=await db.select().from(educationStudents).where(eq(educationStudents.familyEntityId,familyId)).limit(1);if(student&&matchingGroup)await db.update(educationStudents).set({childEntityId:childId,groupId:matchingGroup.id,status:"Активен"}).where(eq(educationStudents.id,student.id));else if(!student&&matchingGroup)await db.insert(educationStudents).values({id:`STU-M-${crypto.randomUUID().slice(0,8).toUpperCase()}`,childEntityId:childId,familyEntityId:familyId,groupId:matchingGroup.id,cabinetStatus:"Доступ не выдан",status:"На проверке"});
  return{operationIds,groupId:matchingGroup?.id??"",groupMatched:Boolean(matchingGroup)}
}
async function audit(actor:string,action:string,entityType:string,entityId:string,payload:unknown){await getDb().insert(auditEvents).values({actor,action,entityType,entityId,payload:JSON.stringify(payload)})}
