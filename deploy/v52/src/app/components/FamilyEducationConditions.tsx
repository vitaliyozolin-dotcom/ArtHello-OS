"use client";
import { useEffect, useState } from 'react';
import styles from './FamilyEducationConditions.module.css';
type Branch={remoteBranchId:string;name:string};
type ConditionsResponse={error?:string;enabled?:boolean;branch:string;remoteBranchId:string;branches:Branch[];selectionRequired?:boolean};
export function FamilyEducationConditions({familyId,childId,childName}:{familyId:string;childId:string;childName:string}) {
  const [state,setState]=useState<{enabled:boolean;branch:string;remoteBranchId:string}|null>(null),[branches,setBranches]=useState<Branch[]>([]),[remoteBranchId,setRemoteBranchId]=useState(''),[hidden,setHidden]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;const params=new URLSearchParams({action:'education-conditions',familyId,childId});if(remoteBranchId)params.set('remoteBranchId',remoteBranchId);
    void fetch(`/api/families?${params}`,{cache:'no-store'}).then(async response=>{
      if(response.status===403){if(active)setHidden(true);return;}
      const data=await response.json() as ConditionsResponse;if(!response.ok)throw new Error(data.error||'Условия обучения недоступны');
      if(active){setBranches(data.branches);setState(data.selectionRequired?null:{enabled:data.enabled===true,branch:data.branch,remoteBranchId:data.remoteBranchId});}
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Ошибка связи');});return()=>{active=false;};
  },[familyId,childId,remoteBranchId]);
  async function save(){if(!state)return;setBusy(true);setError('');try{
    const csrf=document.cookie.split(';').map(value=>value.trim()).find(value=>value.startsWith('__Host-arthello_csrf='))?.split('=').slice(1).join('=')??'';
    const response=await fetch('/api/families',{method:'PATCH',headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},body:JSON.stringify({action:'education-conditions',familyId,childId,remoteBranchId:state.remoteBranchId,enabled:!state.enabled})});
    const data=await response.json() as ConditionsResponse;if(!response.ok)throw new Error(data.error||'Условия не сохранены');
    setState({enabled:data.enabled===true,branch:data.branch,remoteBranchId:data.remoteBranchId});
  }catch(reason){setError(reason instanceof Error?reason.message:'Ошибка связи');}finally{setBusy(false);}}
  if(hidden)return null;
  return <details className={styles.conditions} aria-label={`Условия обучения: ${childName}`}><summary>{state?.enabled?"Основное обучение без оплаты":"Условия обучения"}</summary>
    {branches.length>1?<label>Филиал обучения<select aria-label={`Филиал обучения: ${childName}`} disabled={busy} value={remoteBranchId||state?.remoteBranchId||''} onChange={event=>{setRemoteBranchId(event.target.value);setState(null);setError('');}}><option value="">Выберите филиал</option>{branches.map(branch=><option key={branch.remoteBranchId} value={branch.remoteBranchId}>{branch.name}</option>)}</select></label>:null}
    {state?<><p>{state.branch}: {state.enabled?'Учится · основное обучение без оплаты':'По условиям AlfaCRM'}</p>
      <p className={styles.note}>Отдельное решение собственника. Не меняет старые начисления, остатки, питание, дополнительные услуги или доступ. Учебный состав обновляется при следующей синхронизации.</p>
      <button disabled={busy} onClick={()=>void save()}>{busy?'Сохраняем…':state.enabled?'Снять отметку бесплатного обучения':'Подтвердить обучение без оплаты'}</button></>:!error&&!branches.length?<p>Загружаем условия…</p>:null}
    {error?<p role="alert">{error}</p>:null}
  </details>;
}
