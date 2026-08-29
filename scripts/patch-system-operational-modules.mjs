import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function target(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function replaceText(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) {
    throw new Error(`Operational modules patch failed at ${label}: expected exactly one text match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function replaceRegex(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`Operational modules patch failed at ${label}: expected one regex match, got ${matches.length}`);
  }
  return source.replace(regex, () => replacement);
}

function patch(relativePath, transform) {
  const path = target(relativePath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`Operational modules patch produced no changes for ${relativePath}`);
  writeFileSync(path, after, "utf8");
}

patch("app/components/SafetyWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    '"use client";import{useCallback,useEffect,useState}from"react";',
    '"use client";import{FormEvent,useCallback,useEffect,useState}from"react";import{createPortal}from"react-dom";',
    "safety form and portal imports",
  );
  source = replaceText(
    source,
    '[busy,setBusy]=useState("");',
    '[busy,setBusy]=useState(""),[incidentOpen,setIncidentOpen]=useState(false),[repairId,setRepairId]=useState("");',
    "safety dialog state",
  );
  source = replaceRegex(
    source,
    /async function action\(body:Record<string,unknown>,key:string\)\{[\s\S]*?\}if\(loading\)/,
    `async function action(body:Record<string,unknown>,key:string){setBusy(key);try{const r=await fetch("/api/safety-actions",{method:"POST",headers:{"content-type":"application/json","x-arthello-role":roles[role]??""},body:JSON.stringify(body)}),p=await r.json()as{error?:string;reused?:boolean};if(!r.ok)throw new Error(p.error??"Ошибка");notify(p.reused?"Действие уже существует":"Запись безопасности сохранена");await load();onTasksChanged();return true}catch(e){notify(e instanceof Error?e.message:"Ошибка");return false}finally{setBusy("")}}if(loading)`,
    "safety action result",
  );
  source = replaceRegex(
    source,
    /if\(!data\.systems\.length&&!data\.equipment\.length&&!data\.checks\.length&&!data\.faults\.length&&!data\.incidents\.length&&!data\.repairs\.length&&!data\.guardShifts\.length\)return <section className="page safety-workspace">[\s\S]*?<\/section>;/,
    `if(!data.systems.length&&!data.equipment.length&&!data.checks.length&&!data.faults.length&&!data.incidents.length&&!data.repairs.length&&!data.guardShifts.length)return <section className="page safety-workspace operational-empty-workspace"><div className="safety-heading"><div><p className="eyebrow">Безопасность и контроль</p><h1>Безопасность объектов</h1><p>Системы, оборудование, проверки, инциденты, ремонты и документы остаются доступными до первой записи.</p></div><button disabled>+ Зафиксировать инцидент</button></div><div className="safety-boundary"><strong>РАБОЧАЯ СТРУКТУРА</strong><span>Сначала добавьте объект, систему и оборудование. Пустой контур не создаёт фиктивные проверки или инциденты.</span></div><div className="safety-kpis"><button onClick={()=>setTab("Системы и оборудование")}><span>Системы</span><strong>0</strong><small>нет оборудования</small></button><button onClick={()=>setTab("Проверки и неисправности")}><span>Готовность проверок</span><strong>0%</strong><small>нет плана</small></button><button onClick={()=>setTab("Проверки и неисправности")}><span>Неисправности</span><strong>0</strong><small>нет сигналов</small></button><button onClick={()=>setTab("Ремонты и документы")}><span>Нет актов</span><strong>0</strong><small>ремонтов нет</small></button></div><div className="safety-tabs">{tabs.map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div>{tab==="Контур"?<div className="operational-empty-grid"><article className="operational-empty-card"><span>01</span><strong>Карта систем</strong><p>Объект, тип системы, схема, журнал и ответственный.</p></article><article className="operational-empty-card"><span>02</span><strong>Контроль после ремонта</strong><p>Неисправность закрывается только с рабочим актом и следующей проверкой.</p></article></div>:null}{tab==="Системы и оборудование"?<div className="operational-inline-empty"><span>0</span><strong>Систем и оборудования пока нет</strong><p>Добавьте реальные инженерные и охранные системы с объектом и ответственным.</p></div>:null}{tab==="Проверки и неисправности"?<div className="operational-inline-empty"><span>0</span><strong>Проверки не назначены</strong><p>План, результат, доказательство, неисправность, SLA и задача появятся после настройки оборудования.</p></div>:null}{tab==="Инциденты и охрана"?<div className="operational-inline-empty"><span>0</span><strong>Инцидентов и смен пока нет</strong><p>События фиксируются только по существующей системе и объекту.</p></div>:null}{tab==="Ремонты и документы"?<div className="operational-inline-empty"><span>0</span><strong>Ремонтов пока нет</strong><p>Подрядчик, результат, акт, оплата и следующая проверка образуют обязательную цепочку.</p></div>:null}</section>;`,
    "safety complete empty shell",
  );
  source = replaceText(
    source,
    '<div className="safety-heading"><div><p className="eyebrow">Этап 12 · управляемый риск</p><h1>Безопасность объектов</h1><p>Инженерные системы, проверки, неисправности и ремонт — с доказательством до акта и оплаты.</p></div><button onClick={()=>void action({action:"recordIncident",systemId:"SAFE-SYS-T-ACS-01",objectEntityId:"OBJ-T-002",category:"СКУД",severity:"Средняя",description:"Тестовое событие: дверь удерживалась открытой дольше контрольного интервала"},"incident")}>+ Зафиксировать инцидент</button></div>',
    '<div className="safety-heading"><div><p className="eyebrow">Управляемый риск</p><h1>Безопасность объектов</h1><p>Инженерные системы, проверки, неисправности и ремонт — с доказательством до акта и оплаты.</p></div><button disabled={!data.systems.length} onClick={()=>setIncidentOpen(true)}>+ Зафиксировать инцидент</button></div>',
    "safety incident action",
  );
  source = replaceText(source, '<div className="safety-boundary"><strong>ТЕСТОВЫЙ КОНТУР</strong><span>{data.boundary}</span></div>', '<div className="safety-boundary"><strong>РАБОЧИЙ КОНТУР</strong><span>{data.boundary}</span></div>', "safety production boundary");
  source = replaceText(source, 'scheduledAt:"2026-08-29"', 'scheduledAt:new Date(Date.now()+7*86400000).toISOString().slice(0,10)', "safety dynamic check date");
  source = replaceText(
    source,
    '<button disabled={busy===x.id}onClick={()=>void action({action:"completeRepair",repairId:x.id,result:"Диагностика завершена, контрольный тест оборудования пройден",actDocumentId:"ACT-SAFE-T-032"},x.id)}>Завершить с актом</button>',
    '<button disabled={busy===x.id}onClick={()=>setRepairId(x.id)}>Завершить с актом</button>',
    "safety repair modal",
  );
  source = replaceText(
    source,
    '</section>}\nfunction Head',
    '{incidentOpen?<SafetyIncidentModal systems={data.systems} busy={busy==="incident"} close={()=>setIncidentOpen(false)} save={async body=>{const ok=await action({action:"recordIncident",...body},"incident");if(ok){setIncidentOpen(false);setTab("Инциденты и охрана")}}}/>:null}{repairId?<SafetyRepairModal repairId={repairId} entities={Object.entries(data.entityNames)} busy={busy===repairId} close={()=>setRepairId("")} save={async body=>{const ok=await action({action:"completeRepair",repairId,...body},repairId);if(ok)setRepairId("")}}/>:null}</section>}\nfunction SafetyIncidentModal({systems,busy,close,save}:{systems:Data["systems"];busy:boolean;close:()=>void;save:(body:Record<string,unknown>)=>Promise<void>}){const[systemId,setSystemId]=useState(systems[0]?.id??"");const system=systems.find(item=>item.id===systemId);function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);void save({systemId,objectEntityId:system?.objectEntityId??"",category:String(form.get("category")??""),severity:String(form.get("severity")??""),description:String(form.get("description")??"")})}return createPortal(<div className="modal-layer safety-modal-layer"><button className="drawer-scrim" type="button" onClick={close} aria-label="Закрыть форму"/><form className="task-modal safety-modal" onSubmit={submit}><div className="drawer-head"><div><p>Безопасность объектов</p><h2>Зафиксировать инцидент</h2></div><button type="button" onClick={close}>×</button></div><label><span>Система *</span><select value={systemId} onChange={event=>setSystemId(event.target.value)} required>{systems.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="safety-form-grid"><label><span>Категория</span><input name="category" required defaultValue={system?.systemType||"Наблюдение"}/></label><label><span>Важность</span><select name="severity" defaultValue="Средняя"><option>Низкая</option><option>Средняя</option><option>Высокая</option><option>Критичная</option></select></label></div><label><span>Что произошло *</span><textarea name="description" required minLength={8} placeholder="Только проверяемые факты без предположений"/></label><div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy||!systemId}>{busy?"Сохраняем…":"Сохранить инцидент"}</button></div></form></div>,document.body)}\nfunction SafetyRepairModal({repairId,entities,busy,close,save}:{repairId:string;entities:Array<[string,string]>;busy:boolean;close:()=>void;save:(body:Record<string,unknown>)=>Promise<void>}){const[responsibleEntityId,setResponsibleEntityId]=useState("");function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);void save({result:String(form.get("result")??""),actDocumentId:String(form.get("actDocumentId")??""),responsibleEntityId})}return createPortal(<div className="modal-layer safety-modal-layer"><button className="drawer-scrim" type="button" onClick={close} aria-label="Закрыть форму"/><form className="task-modal safety-modal" onSubmit={submit}><div className="drawer-head"><div><p>{repairId}</p><h2>Завершить ремонт</h2></div><button type="button" onClick={close}>×</button></div><label><span>Результат работ *</span><textarea name="result" required minLength={8} placeholder="Что сделано и как проверена работоспособность"/></label><label><span>Рабочий акт *</span><input name="actDocumentId" required minLength={5} placeholder="Номер или ID фактического акта"/></label><label><span>Ответственный за следующую проверку *</span><select value={responsibleEntityId} onChange={event=>setResponsibleEntityId(event.target.value)} required><option value="">Выберите сотрудника</option>{entities.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy||!responsibleEntityId}>{busy?"Сохраняем…":"Завершить и назначить проверку"}</button></div></form></div>,document.body)}\nfunction Head',
    "safety modals",
  );
  return source;
});

patch("app/components/MedicalWorkspace.tsx", (input) => {
  let source = input;
  source = replaceRegex(
    source,
    /if\(!data\.documents\.length&&!data\.restrictions\.length&&!data\.cases\.length&&!data\.incidents\.length&&!data\.actions\.length\)return <section className="page medical-workspace">[\s\S]*?<\/section>;/,
    `if(!data.documents.length&&!data.restrictions.length&&!data.cases.length&&!data.incidents.length&&!data.actions.length)return <section className="page medical-workspace operational-empty-workspace"><div className="medical-heading"><div><p className="eyebrow">Специальный допуск</p><h1>Медицинское сопровождение</h1><p>Контроль, документы, ограничения, случаи, действия и аудит доступны только отдельной медицинской роли.</p></div><span>Минимизация данных</span></div><div className="medical-boundary"><strong>ЗАЩИЩЁННАЯ ЗОНА</strong><span>Пустой контур не раскрывает персональные или косвенные медицинские сведения.</span></div><div className="medical-kpis"><button onClick={()=>setTab("Документы")}><span>Документы</span><strong>0</strong><small>нет записей</small></button><button onClick={()=>setTab("Ограничения")}><span>Ограничения</span><strong>0</strong><small>нет режимов</small></button><button onClick={()=>setTab("Случаи и действия")}><span>Открытые случаи</span><strong>0</strong><small>нет действий</small></button><button onClick={()=>setTab("Аудит просмотров")}><span>Контроль доступа</span><strong>100%</strong><small>просмотр фиксируется</small></button></div><div className="medical-tabs">{tabs.map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div>{tab==="Контроль"?<div className="operational-empty-grid"><article className="operational-empty-card"><span>01</span><strong>Отдельный допуск</strong><p>Руководитель без медицинской роли не видит записи.</p></article><article className="operational-empty-card"><span>02</span><strong>Аудит каждого просмотра</strong><p>Фиксируются пользователь, время, область и цель.</p></article><article className="operational-empty-card"><span>03</span><strong>Минимум раскрытия</strong><p>В другие контуры передаётся только разрешённый режим действия.</p></article></div>:null}{tab==="Документы"?<div className="operational-inline-empty"><span>0</span><strong>Медицинских документов пока нет</strong><p>Новые сведения появляются только после защищённого ввода и подтверждения.</p></div>:null}{tab==="Ограничения"?<div className="operational-inline-empty"><span>0</span><strong>Ограничений пока нет</strong><p>Раздел хранит только необходимый режим и срок, а не избыточный диагноз.</p></div>:null}{tab==="Случаи и действия"?<div className="operational-inline-empty"><span>0</span><strong>Случаев и действий пока нет</strong><p>Каждое действие имеет срок, ответственного, результат и подтверждение.</p></div>:null}{tab==="Аудит просмотров"?<div className="operational-inline-empty"><span>0</span><strong>История действий пока пуста</strong><p>Этот и последующие просмотры фиксируются в защищённом аудите.</p></div>:null}</section>;`,
    "medical complete empty shell",
  );
  source = replaceText(
    source,
    '<div className="medical-heading"><div><p className="eyebrow">Этап 13 · специальный допуск</p><h1>Медицинское сопровождение</h1><p>Минимально необходимые сведения, отдельные права и аудит каждого просмотра.</p></div><span>MEDICAL_FULL_SYNTHETIC</span></div>',
    '<div className="medical-heading"><div><p className="eyebrow">Специальный допуск</p><h1>Медицинское сопровождение</h1><p>Минимально необходимые сведения, отдельные права и аудит каждого просмотра.</p></div><span>Минимизация данных</span></div>',
    "medical production heading",
  );
  source = replaceText(source, '<div className="medical-boundary"><strong>ЗАЩИЩЁННАЯ ЗОНА · ТЕСТ</strong><span>{data.boundary}</span></div>', '<div className="medical-boundary"><strong>ЗАЩИЩЁННАЯ ЗОНА</strong><span>{data.boundary}</span></div>', "medical production boundary");
  source = replaceText(source, 'confirmationRef:"MED-CONF-T-021-02"', 'confirmationRef:`MED-CONF:${a.id}:${new Date().toISOString()}`', "medical action confirmation");
  source = replaceText(source, 'confirmationRef:"MED-CONF-T-CASE-021"', 'confirmationRef:`MED-CONF:${x.id}:${new Date().toISOString()}`', "medical case confirmation");
  return source;
});

patch("app/components/StrategyWorkspace.tsx", (input) => {
  let source = input;
  source = replaceRegex(
    source,
    /if\(!data\.goals\.length&&!data\.kpis\.length&&!data\.initiatives\.length&&!data\.projects\.length&&!data\.events\.length\)return <section className="page strategy-workspace">[\s\S]*?<\/section>;/,
    `if(!data.goals.length&&!data.kpis.length&&!data.initiatives.length&&!data.projects.length&&!data.events.length)return <section className="page strategy-workspace operational-empty-workspace"><div className="strategy-heading"><div><p className="eyebrow">Цели и проекты</p><h1>Проекты и стратегия</h1><p>Календарь, проекты, цели, KPI, прогнозы, отклонения и решения доступны до первой записи.</p></div><button disabled>+ Событие</button></div><div className="strategy-boundary"><strong>РАБОЧАЯ СТРУКТУРА</strong><span>Система не создаёт цели, показатели или результаты автоматически. Все значения должны иметь владельца и источник.</span></div><div className="strategy-kpis"><button onClick={()=>setTab("Цели и инициативы")}><span>Цели</span><strong>0</strong><small>не созданы</small></button><button onClick={()=>setTab("Проекты")}><span>Проекты</span><strong>0</strong><small>нет инициатив</small></button><button onClick={()=>setTab("KPI и прогноз")}><span>KPI в норме</span><strong>0/0</strong><small>нет показателей</small></button><button onClick={()=>setTab("Календарь")}><span>События</span><strong>0</strong><small>календарь пуст</small></button></div><div className="strategy-tabs">{tabs.map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div>{tab==="Календарь"?<div className="operational-inline-empty"><span>0</span><strong>Событий пока нет</strong><p>После создания проекта здесь появятся план, бюджет, участники, факт и обратная связь.</p></div>:null}{tab==="Проекты"?<div className="operational-inline-empty"><span>0</span><strong>Проекты пока не созданы</strong><p>Проект связывается с целью, инициативой, владельцем, бюджетом, сроком и измеримым результатом.</p></div>:null}{tab==="Цели и инициативы"?<div className="operational-inline-empty"><span>0</span><strong>Целей и инициатив пока нет</strong><p>Начните с определения результата, периода, владельца и критерия успеха.</p></div>:null}{tab==="KPI и прогноз"?<div className="operational-inline-empty"><span>0</span><strong>KPI пока не определены</strong><p>Цель, факт, прогноз и отклонение должны иметь формулу и рабочий источник.</p></div>:null}{tab==="Отклонения и решения"?<div className="operational-inline-empty"><span>0</span><strong>Отклонений и решений пока нет</strong><p>Корректирующее действие появляется только после фактического отклонения и объяснения.</p></div>:null}</section>;`,
    "strategy complete empty shell",
  );
  source = replaceText(
    source,
    '<div className="strategy-heading"><div><p className="eyebrow">Этап 15 · от цели до решения</p><h1>Проекты и стратегия</h1><p>Цели, KPI, инициативы, задачи, бюджеты, события и результаты в одной управленческой цепочке.</p></div><button disabled={busy==="event"}onClick={()=>void action({action:"createEvent",projectId:"STR-PRJ-T-014",title:"Разбор результатов пилота с владельцами"},"event")}>+ Событие</button></div>',
    '<div className="strategy-heading"><div><p className="eyebrow">От цели до решения</p><h1>Проекты и стратегия</h1><p>Цели, KPI, инициативы, задачи, бюджеты, события и результаты в одной управленческой цепочке.</p></div><button disabled={busy==="event"||!data.projects.length}onClick={()=>void action({action:"createEvent",projectId:data.projects[0]?.id,title:"Разбор результатов проекта с владельцами"},"event")}>+ Событие</button></div>',
    "strategy working event",
  );
  source = replaceText(source, '<div className="strategy-boundary"><strong>ТЕСТОВАЯ СТРАТЕГИЯ</strong><span>{data.boundary}</span></div>', '<div className="strategy-boundary"><strong>РАБОЧАЯ СТРАТЕГИЯ</strong><span>{data.boundary}</span></div>', "strategy production boundary");
  return source;
});

console.log("System-wide operational modules patch applied");



