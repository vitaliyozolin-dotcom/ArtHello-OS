export function contractUtilization(limitMinor:number,spentMinor:number){return limitMinor>0?Math.round(spentMinor/limitMinor*100):0}
export function nextLegalVersion(version:number){if(!Number.isInteger(version)||version<1)throw new Error("Invalid document version");return version+1}
export function missingRequired(rows:Array<{required:boolean;status:string}>){return rows.filter(x=>x.required&&x.status==="Отсутствует").length}
export function isCautiousSignal(signalType:string,evidence:string){return !/(виновен|мошенник|нарушитель)/i.test(`${signalType} ${evidence}`)}
