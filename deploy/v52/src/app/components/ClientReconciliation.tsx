'use client';
import {useState} from 'react';
type Preview={token:string;counts:{families:number;children:number;representatives:number;distinctChildNames:number}};
export function ClientReconciliation({onSaved}:{onSaved:()=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[reason,setReason]=useState('');
 async function run(confirm=false){setBusy(true);setMessage('');try{
 const csrf=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-arthello_csrf='))?.split('=').slice(1).join('=')??'';
 const response=await fetch('/api/families?action=client-reconciliation',confirm?{method:'PATCH',headers:{'content-type':'application/json','x-csrf-token':decodeURIComponent(csrf)},body:JSON.stringify({action:'client-reconciliation',token:preview?.token,reason})}:{cache:'no-store'});
 const payload=await response.json() as Preview & {error?:string};if(!response.ok)throw new Error(payload.error??'Сверка недоступна');
 if(confirm){setPreview(null);setMessage(`Сверка подтверждена. Семей: ${payload.counts.families}; карточек детей: ${payload.counts.children}; разных ФИО: ${payload.counts.distinctChildNames}.`);onSaved();}else setPreview(payload);
 }catch(e){setMessage(e instanceof Error?e.message:'Ошибка сверки');}finally{setBusy(false);}}
 return <section aria-label="Окончательная сверка клиентов" className="client-data-rule"><div><strong>Подтверждение текущего состава</strong><p>Собственник подтверждает семьи, детей и представителей. Архив, история, деньги и доступы сохраняются. Повторные карточки не объединяются.</p><button className="secondary-action" disabled={busy} onClick={()=>void run()}>Подготовить подтверждение сверки</button>{preview?<div><p>Семей: {preview.counts.families}. Карточек детей: {preview.counts.children}. Разных ФИО: {preview.counts.distinctChildNames}. Представителей: {preview.counts.representatives}.</p><label>Основание сверки<input aria-label="Основание сверки" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><button className="primary-action" disabled={busy||reason.trim().length<8} onClick={()=>void run(true)}>Подтвердить текущих клиентов как сверенных</button></div>:null}{message?<p role="status">{message}</p>:null}</div></section>;
}
