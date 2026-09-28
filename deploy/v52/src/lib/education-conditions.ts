export type EducationCondition = { version: 1; childId: string; remoteBranchId: string; enrollment: 'active' | 'source'; tuition: 'exempt' | 'source'; scope: 'tuition_only'; actor: string; effectiveFrom: string };
export function educationConditionKey(childId: string, remoteBranchId: string) {
  return `education_conditions:${childId}:${remoteBranchId}`;
}
export function makeEducationCondition(input: {childId: string; remoteBranchId: string; enabled: boolean; actor: string; now: string}): EducationCondition {
  if (!input.childId || !/^[0-9]+$/.test(input.remoteBranchId) || !input.actor || !Number.isFinite(Date.parse(input.now))) throw new Error('INVALID_EDUCATION_CONDITION');
  return {version:1,childId:input.childId,remoteBranchId:input.remoteBranchId,enrollment:input.enabled?'active':'source',tuition:input.enabled?'exempt':'source',scope:'tuition_only',actor:input.actor,effectiveFrom:input.now};
}
export function permitsEnrollment(lifecycle: string, value: unknown, childId: string, remoteBranchId: string) {
  if (['active','unverified'].includes(lifecycle)) return true;
  if (lifecycle !== 'open' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const condition = value as Partial<EducationCondition>;
  return condition.version===1 && condition.childId===childId && condition.remoteBranchId===remoteBranchId
    && condition.enrollment==='active' && condition.tuition==='exempt' && condition.scope==='tuition_only'
    && typeof condition.actor==='string' && condition.actor.length>0
    && typeof condition.effectiveFrom==='string' && Number.isFinite(Date.parse(condition.effectiveFrom));
}
