"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, useEffect, useState } from "react";

type Employee = { id:string; full_name:string; phone:string; email:string; position:string; branch:string; access_role:string; status:string };
type InviteResult = { invitationUrl:string; smsText:string; expiresAt:number };
type UsersResponse = { users?: Employee[]; error?: string };

const roles = [
  ["administrator","Администратор"],["accountant","Бухгалтер"],["hr","HR"],["teacher","Учитель"],
  ["methodologist","Методист"],["sales","Продажи"],["content","Контент"],["lawyer","Юрист"],
  ["kitchen","Питание"],["medical","Медицина"],["viewer","Просмотр"],
];

export default function AccessSettingsPage() {
  const [users,setUsers] = useState<Employee[]>([]);
  const [error,setError] = useState("");
  const [invite,setInvite] = useState<InviteResult|null>(null);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    let cancelled = false;
    fetch("/api/access/users",{cache:"no-store"})
      .then(async response => ({ response, payload: await response.json() as UsersResponse }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if(!response.ok){ setError(payload.error || "Не удалось загрузить пользователей"); setUsers([]); }
        else setUsers(payload.users || []);
        setLoading(false);
      })
      .catch(()=>{
        if (cancelled) return;
        setError("Не удалось загрузить пользователей");
        setUsers([]);
        setLoading(false);
      });
    return ()=>{ cancelled = true; };
  },[]);

  async function reloadUsers(){
    const response = await fetch("/api/access/users",{cache:"no-store"});
    const payload = await response.json() as UsersResponse;
    if(!response.ok){ setError(payload.error || "Не удалось загрузить пользователей"); setUsers([]); return; }
    setUsers(payload.users || []);
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setError("");
    setInvite(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const response = await fetch("/api/access/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const data = await response.json() as InviteResult & { error?: string };
    if(!response.ok){ setError(data.error || "Не удалось создать приглашение"); return; }
    setInvite(data);
    form.reset();
    await reloadUsers();
  }

  return <main style={{maxWidth:1180,margin:"0 auto",padding:"32px 24px",fontFamily:"Inter,system-ui,sans-serif",color:"#171717"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:24,alignItems:"end",marginBottom:28}}>
      <div><div style={{fontSize:13,color:"#777",marginBottom:7}}>Настройки</div><h1 style={{margin:0,fontSize:32,letterSpacing:"-.03em"}}>Пользователи и доступы</h1><p style={{color:"#6c6c6c",margin:"10px 0 0"}}>Сотрудник получает одноразовую ссылку и сам устанавливает пароль.</p></div>
      <a href="/" style={{color:"#171717",textDecoration:"none",border:"1px solid #ddd",borderRadius:12,padding:"10px 14px"}}>← В систему</a>
    </div>

    <section style={{display:"grid",gridTemplateColumns:"minmax(320px,420px) minmax(0,1fr)",gap:24,alignItems:"start"}}>
      <form onSubmit={submit} style={{border:"1px solid #e7e7e7",borderRadius:18,padding:22,background:"#fff"}}>
        <h2 style={{fontSize:20,margin:"0 0 18px"}}>Выдать доступ</h2>
        <Field name="fullName" label="ФИО" required />
        <Field name="phone" label="Телефон" placeholder="+7 921 000-00-00" required />
        <Field name="email" label="Email" type="email" />
        <Field name="position" label="Должность" required />
        <label style={labelStyle}>Филиал<select name="branch" required style={inputStyle} defaultValue=""><option value="" disabled>Выберите</option><option>Атлас · школа</option><option>Атлас · сад</option><option>1–11</option><option>Небо</option><option>Лиственная</option><option>Управляющая компания</option></select></label>
        <label style={labelStyle}>Роль<select name="role" required style={inputStyle} defaultValue="viewer">{roles.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
        <button style={{width:"100%",border:0,borderRadius:12,padding:"13px 16px",fontSize:15,fontWeight:650,background:"#171717",color:"#fff",cursor:"pointer"}}>Создать приглашение</button>
        {error && <div style={{marginTop:14,padding:12,borderRadius:10,background:"#fff1f1",color:"#a11"}}>{error}</div>}
        {invite && <div style={{marginTop:16,padding:14,borderRadius:12,background:"#f4f7f4"}}><b>Приглашение готово</b><div style={{fontSize:13,color:"#666",marginTop:6}}>Ссылка действует 48 часов и используется один раз.</div><input readOnly value={invite.invitationUrl} style={{...inputStyle,marginTop:10}} onFocus={e=>e.currentTarget.select()} /><button type="button" onClick={()=>navigator.clipboard?.writeText(invite.smsText)} style={{marginTop:8,border:"1px solid #ccc",background:"#fff",borderRadius:10,padding:"9px 12px",cursor:"pointer"}}>Скопировать текст для SMS</button></div>}
      </form>

      <div style={{border:"1px solid #e7e7e7",borderRadius:18,background:"#fff",overflow:"hidden"}}>
        <div style={{padding:"20px 22px",borderBottom:"1px solid #eee",display:"flex",justifyContent:"space-between"}}><b>Сотрудники</b><span style={{color:"#777"}}>{users.length}</span></div>
        {loading ? <div style={{padding:22,color:"#777"}}>Загрузка…</div> : users.length===0 ? <div style={{padding:22,color:"#777"}}>Пока никого нет.</div> : users.map(u=><div key={u.id} style={{padding:"16px 22px",borderBottom:"1px solid #f0f0f0",display:"grid",gridTemplateColumns:"1.5fr 1fr .8fr",gap:16,alignItems:"center"}}><div><b>{u.full_name}</b><div style={{fontSize:13,color:"#777",marginTop:4}}>{u.position} · {u.branch}</div></div><div><div>{u.phone}</div><div style={{fontSize:13,color:"#777",marginTop:4}}>{u.access_role}</div></div><div style={{textAlign:"right"}}><span style={{display:"inline-block",padding:"6px 9px",borderRadius:999,background:u.status==="active"?"#eef8ef":"#fff7e7",fontSize:12}}>{u.status==="active"?"Активен":"Приглашён"}</span></div></div>)}
      </div>
    </section>
  </main>;
}

function Field({name,label,required,type="text",placeholder=""}:{name:string;label:string;required?:boolean;type?:string;placeholder?:string}){
  return <label style={labelStyle}>{label}<input name={name} type={type} required={required} placeholder={placeholder} style={inputStyle}/></label>;
}
const labelStyle = {display:"block",fontSize:13,fontWeight:600,marginBottom:14} as const;
const inputStyle = {display:"block",width:"100%",boxSizing:"border-box" as const,marginTop:7,border:"1px solid #d9d9d9",borderRadius:10,padding:"11px 12px",fontSize:16,background:"#fff"};
