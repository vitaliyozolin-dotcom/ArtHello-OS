"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type InvitationData = {
  fullName: string;
  position: string;
  branch: string;
  phone: string;
};

type ActivationResult = {
  login: string;
};

export default function InvitePage({ params }:{ params: Promise<{ token:string }> }) {
  const [token,setToken] = useState("");
  const [data,setData] = useState<InvitationData|null>(null);
  const [error,setError] = useState("");
  const [done,setDone] = useState<ActivationResult|null>(null);

  useEffect(()=>{
    let cancelled = false;
    params.then(async ({token:resolvedToken})=>{
      if (cancelled) return;
      setToken(resolvedToken);
      const response = await fetch(`/api/access/invitations/${encodeURIComponent(resolvedToken)}`,{cache:"no-store"});
      const payload = await response.json() as InvitationData & { error?: string };
      if (cancelled) return;
      if(!response.ok) setError(payload.error||"Ссылка недействительна");
      else setData(payload);
    }).catch(()=>{
      if (!cancelled) setError("Ссылка недействительна");
    });
    return ()=>{ cancelled = true; };
  },[params]);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setError("");
    const fd=new FormData(e.currentTarget);
    const password=String(fd.get("password")||"");
    const confirm=String(fd.get("confirm")||"");
    if(password!==confirm){ setError("Пароли не совпадают"); return; }
    const response=await fetch(`/api/access/invitations/${encodeURIComponent(token)}`,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({password}),
    });
    const payload=await response.json() as ActivationResult & { error?: string };
    if(!response.ok){ setError(payload.error||"Не удалось активировать доступ"); return; }
    setDone(payload);
  }

  return <main style={{minHeight:"70vh",display:"grid",placeItems:"center",padding:24,fontFamily:"Inter,system-ui,sans-serif",color:"#171717"}}><section style={{width:"100%",maxWidth:480,border:"1px solid #e6e6e6",borderRadius:20,padding:28,background:"#fff"}}>
    <div style={{fontSize:13,color:"#777",marginBottom:8}}>ArtHello OS</div><h1 style={{fontSize:28,margin:"0 0 10px",letterSpacing:"-.03em"}}>Создание доступа</h1>
    {done ? <><p>Доступ активирован.</p><div style={{padding:14,borderRadius:12,background:"#f5f5f5",marginBottom:18}}><b>Логин</b><div style={{fontSize:20,marginTop:5}}>{done.login}</div></div><Link href="/" style={{display:"block",textAlign:"center",padding:"12px 16px",borderRadius:12,background:"#171717",color:"#fff",textDecoration:"none"}}>Войти в ArtHello OS</Link></> : error && !data ? <div style={{padding:14,borderRadius:12,background:"#fff1f1",color:"#a11"}}>{error}</div> : !data ? <p style={{color:"#777"}}>Проверяем приглашение…</p> : <form onSubmit={submit}>
      <div style={{padding:14,borderRadius:12,background:"#f7f7f7",margin:"16px 0 20px"}}><b>{data.fullName}</b><div style={{fontSize:14,color:"#666",marginTop:5}}>{data.position} · {data.branch}</div><div style={{fontSize:14,color:"#666",marginTop:3}}>{data.phone}</div></div>
      <label style={labelStyle}>Придумайте пароль<input name="password" type="password" minLength={12} required autoComplete="new-password" style={inputStyle}/></label>
      <label style={labelStyle}>Повторите пароль<input name="confirm" type="password" minLength={12} required autoComplete="new-password" style={inputStyle}/></label>
      <div style={{fontSize:13,color:"#777",marginBottom:16}}>Минимум 12 символов. Пароль знаете только вы.</div>
      <button style={{width:"100%",border:0,borderRadius:12,padding:"13px 16px",fontSize:15,fontWeight:650,background:"#171717",color:"#fff",cursor:"pointer"}}>Активировать доступ</button>
      {error && <div style={{marginTop:14,padding:12,borderRadius:10,background:"#fff1f1",color:"#a11"}}>{error}</div>}
    </form>}
  </section></main>;
}

const labelStyle={display:"block",fontSize:13,fontWeight:600,marginBottom:14} as const;
const inputStyle={display:"block",width:"100%",boxSizing:"border-box" as const,marginTop:7,border:"1px solid #d9d9d9",borderRadius:10,padding:"11px 12px",fontSize:16,background:"#fff"};
