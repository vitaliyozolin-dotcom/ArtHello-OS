export type ScenarioStepState={status:string};
export type ReleaseGateState={status:string;required:boolean|number};

const passedStates=new Set(["Пройдено","Пройден"]);

export function scenarioPassed(steps:ScenarioStepState[]){
  return steps.length>0&&steps.every(step=>passedStates.has(step.status));
}

export function requiredGatesPassed(gates:ReleaseGateState[]){
  const required=gates.filter(gate=>Boolean(gate.required));
  return required.length>0&&required.every(gate=>passedStates.has(gate.status));
}

export function canPromoteToProduction(gates:ReleaseGateState[],explicitApproval:boolean){
  return explicitApproval&&requiredGatesPassed(gates);
}

export function compareRecordSets(before:string[],after:string[]){
  const normalize=(rows:string[])=>[...rows].map(value=>value.trim()).filter(Boolean).sort();
  const left=normalize(before),right=normalize(after);
  return{sameCount:left.length===right.length,sameOrder:left.every((value,index)=>value===right[index]),beforeCount:left.length,afterCount:right.length};
}

export function summarizeValidation(statuses:string[]){
  const passed=statuses.filter(status=>passedStates.has(status)).length;
  const failed=statuses.filter(status=>status==="Ошибка"||status==="Не пройдено").length;
  return{passed,failed,skipped:statuses.length-passed-failed,total:statuses.length,status:failed===0&&passed===statuses.length&&statuses.length>0?"Пройдено":"Не пройдено"};
}
