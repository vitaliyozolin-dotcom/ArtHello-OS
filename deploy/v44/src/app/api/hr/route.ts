import { asc } from "drizzle-orm";
import { ensureCoreTables, getDb } from "../../../db";
import { entities, financialOperations, hrAccesses, hrCandidates, hrDevelopment, hrEmployees, hrInterviews, hrOnboarding, hrRewards, hrVacancies, tasks, workflowDocuments } from "../../../db/schema";
import { accessAllowed, candidateFunnel } from "../../../lib/hr";
import { getRequestUser } from "../../../lib/request-user";

const readable = new Set(["OWNER","DIRECTOR","REPRESENTATIVE","HR"]);
export async function GET(request:Request){
  if(!getRequestUser(request)) return Response.json({error:"Требуется вход"},{status:401});
  const role=request.headers.get("x-arthello-role")??"";if(!readable.has(role))return Response.json({error:"Нет доступа к HR-контуру"},{status:403});
  try{
    await ensureCoreTables();const db=getDb();
    const [vacancies,candidates,interviews,employees,onboarding,development,rewards,accesses,entityRows,documents,allTasks,operations]=await Promise.all([
      db.select().from(hrVacancies),db.select().from(hrCandidates).orderBy(asc(hrCandidates.createdAt)),db.select().from(hrInterviews).orderBy(asc(hrInterviews.scheduledAt)),
      db.select().from(hrEmployees),db.select().from(hrOnboarding),db.select().from(hrDevelopment).orderBy(asc(hrDevelopment.eventDate)),db.select().from(hrRewards),db.select().from(hrAccesses),
      db.select({id:entities.id,displayName:entities.displayName,status:entities.status}).from(entities),db.select().from(workflowDocuments),db.select().from(tasks),db.select().from(financialOperations),
    ]);
    const entityNames=Object.fromEntries(entityRows.map(x=>[x.id,x.displayName]));
    return Response.json({vacancies,candidates,interviews,employees,onboarding,development,rewards,accesses,entityNames,
      documents:documents.filter(x=>employees.some(e=>e.contractId===x.id)),tasks:allTasks.filter(x=>x.sourceType==="Онбординг"),
      payroll:operations.filter(x=>x.sourceSystem==="SYNTHETIC_HR_TEST"),funnel:candidateFunnel(candidates),
      summary:{openVacancies:vacancies.filter(x=>x.status==="В работе").length,candidates:candidates.length,activeEmployees:employees.filter(x=>x.status==="Работает").length,revokedAccesses:accesses.filter(x=>!accessAllowed(employees.find(e=>e.id===x.employeeId)?.status??"",x.status)).length},
      chain:{vacancyId:"VAC-T-008",candidateId:"CANDREC-T-008",interviewId:"INTV-T-008",employeeId:"EMP-T-052",contractId:"DOG-EMP-T-052",positionId:"POS-T-TEACHER",accessId:"ACC-TASKS-052",onboardingId:"ONB-T-052-03",payrollId:"FIN-TEST-PAYROLL-052",evaluationId:"DEV-T-052-02"},
      boundary:"Все HR-карточки синтетические. Выплата FIN-TEST-PAYROLL-052 не является строкой реальной зарплатной ведомости; исторические задачи после увольнения не удаляются."});
  }catch(error){return Response.json({error:error instanceof Error&&error.message.includes("D1 binding")?"HR-база ещё не подключена":"Не удалось загрузить HR"},{status:503})}
}
