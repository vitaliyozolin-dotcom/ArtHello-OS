"use client";
import { useEffect, useState } from 'react';
export function FamilyEducationConditions({familyId,childId,childName}:{familyId:string;childId:string;childName:string}) {
  const [state,setState]=useState<{enabled:boolean;branch:string}|null>(null),[hidden,setHidden]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;const params=new URLSearchParams({action:'education-conditions',familyId,childId});
    void fetch(`/api/families?${params}`,{cache:'no-store'}).then(async response=>{
      if(response.status===403){if(active)setHidden(true);return;}
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Условия обучения недоступны');
      if(active)setState({enabled:data.enabled===true,branch:data.branch});
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Ошибка связи');});return()=>{active=false;};
  },[familyId,childId]);
  async function save(){if(!state)return;setBusy(true);setError('');try{
    const csrf=document.cookie.split(';').map(value=>value.trim()).find(value=>value.startsWith('__Host-arthello_csrf='))?.split('=').slice(1).join('=')??'';
    const response=await fetch('/api/families',{method:'PATCH',headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},body:JSON.stringify({action:'education-conditions',familyId,childId,enabled:!state.enabled})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Условия не сохранены');
    setState({enabled:data.enabled===true,branch:data.branch});
  }catch(reason){setError(reason instanceof Error?reason.message:'Ошибка связи');}finally{setBusy(false);}}
  if(hidden)return null;
  return <section aria-label={`Условия обучения: ${childName}`}><header><span>Условия обучения · {childName}</span></header>
    {state?<><p>{state.branch}: {state.enabled?'Учится · основное обучение без оплаты':'Условия по источнику; бесплатное обучение не подтверждено'}</p>
      <p>Отдельное решение собственника. Не меняет старые начисления, остатки, питание, дополнительные услуги или доступ. Учебный состав обновляется при следующей синхронизации.</p>
      <button disabled={busy} onClick={()=>void save()}>{busy?'Сохраняем…':state.enabled?'Снять отметку бесплатного обучения':'Подтвердить обучение без оплаты'}</button></>:!error?<p>Загружаем условия…</p>:null}
    {error?<p role="alert">{error}</p>:null}
  </section>;
}
