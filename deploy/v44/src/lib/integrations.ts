export type ConnectionFacts={authStatus:string;verifiedTransfer:boolean;lastSuccessAt:string;isEnabled:boolean;status?:string};

export function connectionState(facts:ConnectionFacts){
  if(facts.status==="На паузе"||!facts.isEnabled&&facts.status==="На паузе")return{state:"paused",label:"На паузе",connected:false};
  if(!facts.verifiedTransfer)return{state:facts.authStatus.includes("активна")?"unverified":"disconnected",label:facts.authStatus.includes("активна")?"Требует проверки передачи":"Не подключён",connected:false};
  if(!facts.lastSuccessAt)return{state:"unverified",label:"Передача не подтверждена",connected:false};
  if(facts.isEnabled)return{state:"connected",label:"Подключён и проверен",connected:true};
  return{state:"snapshot",label:"Проверенный снимок",connected:false};
}

export function credentialState(authStatus:string,expiresAt:string,now="2026-08-21"){
  if(!expiresAt){if(authStatus.toLowerCase().includes("активна"))return"valid";return authStatus.toLowerCase().includes("не требуется")?"not-required":"missing"}
  const days=Math.ceil((Date.parse(`${expiresAt}T00:00:00Z`)-Date.parse(`${now}T00:00:00Z`))/86400000);
  if(days<0)return"expired";if(days<=14)return"expiring";return"valid";
}

export function validateRunCounts(received:number,accepted:number,rejected:number,errors:number,conflicts:number){
  if([received,accepted,rejected,errors,conflicts].some(value=>!Number.isInteger(value)||value<0))return false;
  return accepted+rejected<=received&&(received===0||errors<=received)&&conflicts<=received;
}

export function retryDecision(facts:ConnectionFacts){
  if(facts.status==="На паузе")return{allowed:false,reason:"Интеграция на паузе"};
  if(!facts.verifiedTransfer||!facts.authStatus.includes("активна"))return{allowed:false,reason:"Нет проверенной авторизации и передачи"};
  return{allowed:true,reason:"Можно запустить контролируемый повтор"};
}

export function canResolveConflict(resolution:string,evidence:string){return resolution.trim().length>=8&&evidence.trim().length>=8}
