import { asc, eq } from "drizzle-orm";
import { ensureCoreTables, getDb, getSystemDataMode } from "../../../db";
import { entities, financialOperations, hrAccesses, hrCandidates, hrDevelopment, hrEmployees, hrInterviews, hrOnboarding, hrRewards, hrVacancies, organizationBranches, tasks, workflowDocuments } from "../../../db/schema";
import { accessAllowed, candidateFunnel } from "../../../lib/hr";
import { getRequestUser } from "../../../lib/request-user";

const readable = new Set(["OWNER","DIRECTOR","REPRESENTATIVE","HR"]);
export async function GET(request:Request){
  if(!getRequestUser(request)) return Response.json({error:"Требуется вход"},{status:401});
  const role=request.headers.get("x-arthello-role")??"";if(!readable.has(role))return Response.json({error:"Нет доступа к HR-контуру"},{status:403});
  try{
    await ensureCoreTables();const db=getDb(),mode=await getSystemDataMode();
    const [vacancyRows,candidateRows,interviewRows,employeeRows,onboardingRows,developmentRows,rewardRows,accessRows,rawEntityRows,documentRows,allTasks,operationRows,branchRows]=await Promise.all([
      db.select().from(hrVacancies),db.select().from(hrCandidates).orderBy(asc(hrCandidates.createdAt)),db.select().from(hrInterviews).orderBy(asc(hrInterviews.scheduledAt)),
      db.select().from(hrEmployees),db.select().from(hrOnboarding),db.select().from(hrDevelopment).orderBy(asc(hrDevelopment.eventDate)),db.select().from(hrRewards),db.select().from(hrAccesses),
      db.select({id:entities.id,displayName:entities.displayName,status:entities.status,metadata:entities.metadata,sourceSystem:entities.sourceSystem,dataQuality:entities.dataQuality}).from(entities),db.select().from(workflowDocuments),db.select().from(tasks),db.select().from(financialOperations),db.select().from(organizationBranches).where(eq(organizationBranches.status,"Активен")).orderBy(asc(organizationBranches.sortOrder)),
    ]);
    const visible=(...values:string[])=>mode!=="empty"||values.every(value=>!/(^|[-_])(T|TEST)([-_]|$)/i.test(value));
    const vacancies=vacancyRows.filter(x=>visible(x.id,x.positionId,x.sourceType));
    const candidates=candidateRows.filter(x=>visible(x.id,x.entityId,x.vacancyId));
    const interviews=interviewRows.filter(x=>visible(x.id,x.candidateId,x.interviewerEntityId));
    const employees=employeeRows.filter(x=>visible(x.id,x.candidateId,x.contractId,x.positionId));
    const employeeIds=new Set(employees.map(x=>x.id));
    const onboarding=onboardingRows.filter(x=>employeeIds.has(x.employeeId)&&visible(x.id,x.employeeId));
    const development=developmentRows.filter(x=>employeeIds.has(x.employeeId)&&visible(x.id,x.employeeId));
    const rewards=rewardRows.filter(x=>employeeIds.has(x.employeeId)&&visible(x.id,x.employeeId));
    const accesses=accessRows.filter(x=>employeeIds.has(x.employeeId)&&visible(x.id,x.employeeId));
    const entityRows=rawEntityRows.filter(x=>visible(x.id,x.sourceSystem));
    const documents=documentRows.filter(x=>employees.some(e=>e.contractId&&e.contractId===x.id)&&visible(x.id));
    const tasksForEmployees=allTasks.filter(x=>x.sourceType==="Онбординг"&&employeeIds.has(x.sourceId)&&visible(x.sourceId,x.automationKey??""));
    const payroll=operationRows.filter(x=>employeeIds.has(x.counterpartyEntityId)&&visible(x.id,x.counterpartyEntityId,x.sourceSystem,x.sourceRef));
    const branches=branchRows.filter(x=>visible(x.id));
    const entityNames=Object.fromEntries(entityRows.map(x=>[x.id,x.displayName]));
    const employeeProfiles=Object.fromEntries(entityRows.filter(x=>employees.some(employee=>employee.id===x.id)).map(x=>{let metadata:Record<string,unknown>={};try{metadata=JSON.parse(x.metadata) as Record<string,unknown>}catch{}return[x.id,{...metadata,sourceSystem:x.sourceSystem,dataQuality:x.dataQuality}]}));
    const chainEmployee=employees.find(employee=>employee.candidateId&&candidates.some(candidate=>candidate.id===employee.candidateId))??employees.find(employee=>employee.contractId||onboarding.some(item=>item.employeeId===employee.id)||accesses.some(item=>item.employeeId===employee.id)||development.some(item=>item.employeeId===employee.id)||payroll.some(item=>item.counterpartyEntityId===employee.id));
    const chainCandidate=(chainEmployee?.candidateId?candidates.find(candidate=>candidate.id===chainEmployee.candidateId):undefined)??candidates[0];
    const chainVacancy=chainCandidate?vacancies.find(vacancy=>vacancy.id===chainCandidate.vacancyId):undefined;
    const chainInterview=chainCandidate?interviews.find(interview=>interview.candidateId===chainCandidate.id):undefined;
    const linkedEmployee=chainEmployee??(chainCandidate?employees.find(employee=>employee.candidateId===chainCandidate.id):undefined);
    const chainAccess=linkedEmployee?accesses.find(access=>access.employeeId===linkedEmployee.id):undefined;
    const chainOnboarding=linkedEmployee?onboarding.find(item=>item.employeeId===linkedEmployee.id):undefined;
    const chainPayroll=linkedEmployee?payroll.find(item=>item.counterpartyEntityId===linkedEmployee.id):undefined;
    const chainEvaluation=linkedEmployee?development.find(item=>item.employeeId===linkedEmployee.id):undefined;
    return Response.json({vacancies,candidates,interviews,employees,onboarding,development,rewards,accesses,entityNames,employeeProfiles,branches,
      documents,tasks:tasksForEmployees,payroll,funnel:candidateFunnel(candidates),
      summary:{openVacancies:vacancies.filter(x=>x.status==="В работе").length,candidates:candidates.length,activeEmployees:employees.filter(x=>x.status==="Работает").length,revokedAccesses:accesses.filter(x=>!accessAllowed(employees.find(e=>e.id===x.employeeId)?.status??"",x.status)).length},
      chain:{vacancyId:chainVacancy?.id??"",candidateId:chainCandidate?.id??"",interviewId:chainInterview?.id??"",employeeId:linkedEmployee?.id??"",contractId:linkedEmployee?.contractId??"",positionId:linkedEmployee?.positionId??"",accessId:chainAccess?.id??"",onboardingId:chainOnboarding?.id??"",payrollId:chainPayroll?.id??"",evaluationId:chainEvaluation?.id??""},
      boundary:"Карточка сотрудника создаётся только в «Команде» — вручную или контролируемым импортом. Импорт не выдаёт доступы: сотрудник появляется в «Настройки → Пользователи» со статусом «Доступ не выдан»."});
  }catch(error){return Response.json({error:error instanceof Error&&error.message.includes("D1 binding")?"HR-база ещё не подключена":"Не удалось загрузить HR"},{status:503})}
}
