export const prohibitedAiActions=new Set(["change_finance","sign_contract","terminate_employee","assign_penalty","medical_diagnosis","accuse_person","delete_primary_data","grant_critical_access"]);
export function aiActionAllowed(action:string){return!prohibitedAiActions.has(action)}
export function canRunContract(status:string,activeOptOuts:number){return status==="Активен"&&activeOptOuts===0}
export function canRecordHumanDecision(decision:string,evidence:string){return decision.trim().length>=8&&evidence.trim().length>=8}
export function riskRank(severity:string,confidence:number){const base:Record<string,number>={"Критический":400,"Высокий":300,"Средний":200,"Низкий":100};return(base[severity]??0)+Math.max(0,Math.min(100,confidence))}
export function forecastCash(items:Array<{forecastDate:string;direction:string;amountMinor:number;probability:number}>,openingMinor:number){let balance=openingMinor;return[...items].sort((a,b)=>a.forecastDate.localeCompare(b.forecastDate)).map(item=>{const weighted=Math.round(item.amountMinor*item.probability/100);balance+=item.direction==="Поступление"?weighted:-weighted;return{...item,weightedMinor:weighted,balanceMinor:balance,isGap:balance<0}})}
export function safeAverage(values:number[]){return values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):0}
export function marginPercent(revenueMinor:number,costMinor:number){return revenueMinor>0?Math.round(((revenueMinor-costMinor)/revenueMinor)*1000)/10:0}
