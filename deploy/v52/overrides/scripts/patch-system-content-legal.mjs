import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function target(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function replaceText(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) {
    throw new Error(`System-wide UI patch failed at ${label}: expected exactly one text match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function replaceRegex(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`System-wide UI patch failed at ${label}: expected one regex match, got ${matches.length}`);
  }
  return source.replace(regex, () => replacement);
}

function patch(relativePath, transform) {
  const path = target(relativePath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`System-wide UI patch produced no changes for ${relativePath}`);
  writeFileSync(path, after, "utf8");
}

patch("app/components/ContentWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'export function ContentWorkspace({ role, notify, onTasksChanged, onOpenSales, onOpenFinance, sourceOnly = false }: { role: string; notify: (value: string) => void; onTasksChanged: () => void; onOpenSales: () => void; onOpenFinance: () => void; sourceOnly?: boolean }) {',
    'export function ContentWorkspace({ role, notify, onTasksChanged, onOpenSales, onOpenFinance, onOpenIntegrations, sourceOnly = false }: { role: string; notify: (value: string) => void; onTasksChanged: () => void; onOpenSales: () => void; onOpenFinance: () => void; onOpenIntegrations: () => void; sourceOnly?: boolean }) {',
    "content integration prop",
  );
  source = replaceRegex(
    source,
    /  if \(!sourceOnly && !hasContentData && activeTab !== "studio"\) return <section className="page content-workspace">[\s\S]*?\n  <\/section>;/,
    `  if (!sourceOnly && !hasContentData && activeTab !== "studio") return <section className="page content-workspace operational-empty-workspace">\n    <div className="content-heading"><div><p className="eyebrow">Контент-студия ArtHello</p><h1>Контент и маркетинг</h1><p>Все рабочие разделы доступны сразу. Реальные показатели появятся после подключения каналов или создания первого материала.</p></div><div className="operational-heading-actions"><button onClick={() => setTab("studio")}>Открыть студию</button><button className="secondary" onClick={onOpenIntegrations}>Подключить каналы</button></div></div>\n    <div className="content-boundary"><strong>РАБОЧАЯ СТРУКТУРА</strong><span>Контент-план, публикации, атрибуция и рекомендации остаются доступными при нулевых данных.</span><em>фиктивные показатели не создаются</em></div>\n    <div className="content-kpis"><button onClick={() => setTab("publications")}><span>Охват</span><strong>0</strong><small>каналы не подключены</small></button><button onClick={() => setTab("publications")}><span>Переходы</span><strong>0</strong><small>метрик пока нет</small></button><button onClick={() => setTab("chain")}><span>Заявки → договоры</span><strong>0 → 0</strong><small>атрибуция пуста</small></button><button className="positive" onClick={() => setTab("chain")}><span>Выручка</span><strong>{rubles(0)}</strong><small>нет связанных операций</small></button></div>\n    <div className="content-tabs">{tabs.map((item) => <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "recommendations" ? <b>0</b> : null}</button>)}</div>\n    {activeTab === "overview" ? <div className="operational-empty-grid"><button className="operational-empty-card" onClick={onOpenIntegrations}><span>01</span><strong>Каналы</strong><p>Подключите VK, Telegram, сайт, email, Яндекс или другие утверждённые источники.</p></button><button className="operational-empty-card" onClick={() => setTab("studio")}><span>02</span><strong>Студия</strong><p>Создавайте изображения по описанию и референсу после подключения провайдера.</p></button><button className="operational-empty-card" onClick={() => setTab("plan")}><span>03</span><strong>Контент-план</strong><p>Черновики, согласование, расписание и ответственные остаются в одном процессе.</p></button><button className="operational-empty-card" onClick={() => setTab("publications")}><span>04</span><strong>Публикации</strong><p>Ссылки, форматы и фактические метрики появятся после первого материала.</p></button><button className="operational-empty-card" onClick={() => setTab("chain")}><span>05</span><strong>До выручки</strong><p>Публикация связывается с переходом, лидом, договором и оплатой только по подтверждённым данным.</p></button><button className="operational-empty-card" onClick={() => setTab("recommendations")}><span>06</span><strong>Рекомендации</strong><p>Система не предлагает масштабирование без реальной статистики и атрибуции.</p></button></div> : null}\n    {activeTab === "plan" ? <article className="content-panel"><Head eyebrow="Редакционный ритм" title="Контент-план" aside="0 материалов" /><div className="empty-kanban">{["Черновик", "На согласовании", "Запланировано", "Опубликовано"].map((status) => <article key={status}><header><strong>{status}</strong><span>0</span></header><p>Материалы появятся после подключения канала и назначения автора.</p></article>)}</div></article> : null}\n    {activeTab === "publications" ? <div className="operational-inline-empty"><span>0</span><strong>Публикаций пока нет</strong><p>Подключите канал или подтвердите первую рабочую ссылку на опубликованный материал.</p><button onClick={onOpenIntegrations}>Подключить канал</button></div> : null}\n    {activeTab === "chain" ? <div className="operational-inline-empty"><span>→</span><strong>Атрибуция ещё не собрана</strong><p>Здесь появится маршрут публикация → переход → заявка → договор → платёж. Пустые связи не подменяются тестовыми.</p></div> : null}\n    {activeTab === "recommendations" ? <div className="operational-inline-empty"><span>0</span><strong>Рекомендаций пока нет</strong><p>Рекомендации формируются только после появления фактических публикаций и измеримых результатов.</p></div> : null}\n  </section>;`,
    "content complete empty shell",
  );
  source = replaceText(
    source,
    '{!studioMode && data.accounts.length ? <button onClick={() => setCreateOpen(true)}>+ Материал в план</button> : null}</div>',
    '<div className="operational-heading-actions">{!studioMode && data.accounts.length ? <button onClick={() => setCreateOpen(true)}>+ Материал в план</button> : null}{studioMode ? <button onClick={() => setTab("overview")}>Обзор контента</button> : null}<button className="secondary" onClick={onOpenIntegrations}>Подключить каналы</button></div></div>',
    "content heading actions",
  );
  source = replaceText(
    source,
    '\n\n    {activeTab === "overview" ?',
    '\n    {studioMode ? <div className="content-tabs">{tabs.map((item) => <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "recommendations" ? <b>{data.recommendations.filter((row) => row.status !== "Закрыта").length}</b> : null}</button>)}</div> : null}\n\n    {activeTab === "overview" ?',
    "content studio navigation",
  );
  return source;
});

patch("app/api/legal-actions/route.ts", (input) => {
  let source = input;
  source = replaceText(
    source,
    '    if (action === "createDocumentVersion") return version(actor, body);',
    '    if (action === "createContract") return createContract(actor, body);\n    if (action === "createDocumentVersion") return version(actor, body);',
    "legal create contract action",
  );
  source = replaceText(
    source,
    'async function version(actor: string, body: Record<string, unknown>) {',
    `async function createContract(actor: string, body: Record<string, unknown>) {\n  const partyName = clean(body.partyName, 180);\n  const partyType = clean(body.partyType, 60) || "Контрагент";\n  const contractType = clean(body.contractType, 80) || "Договор";\n  const number = clean(body.number, 80);\n  const validFrom = clean(body.validFrom, 10);\n  const validUntil = clean(body.validUntil, 10);\n  const signedStatus = clean(body.signedStatus, 40) || "Не подписан";\n  const limitRubles = Number(body.limitRubles ?? 0);\n  const closingRequired = body.closingRequired === true || body.closingRequired === "on";\n  if (partyName.length < 3 || number.length < 2 || !/^\\d{4}-\\d{2}-\\d{2}$/.test(validFrom) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(validUntil) || validUntil < validFrom) {\n    return Response.json({ error: "Заполните сторону, номер и корректный срок договора" }, { status: 400 });\n  }\n  if (!Number.isFinite(limitRubles) || limitRubles < 0) return Response.json({ error: "Проверьте сумму или лимит договора" }, { status: 400 });\n  const db = getDb();\n  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();\n  const partyId = \`ENT-\${suffix}\`;\n  const contractId = \`LCON-\${suffix}\`;\n  const referenceDocumentId = \`DOG-\${suffix}\`;\n  await db.insert(entities).values({\n    id: partyId, entityType: partyType, displayName: partyName, status: "Активна", sourceSystem: "MANUAL",\n    sourceRecordId: \`LEGAL:\${partyId}\`, dataQuality: "Ручной ввод · требует проверки", scope: "Юридический контур", metadata: "{}", createdBy: actor,\n  });\n  try {\n    const [contract] = await db.insert(legalContracts).values({\n      id: contractId, referenceDocumentId, contractType, partyType, partyEntityId: partyId, number, signedStatus, validFrom, validUntil,\n      limitMinor: Math.round(limitRubles * 100), spentMinor: 0, status: "На проверке", electronicSignatureStatus: "ЭП не подключена",\n      requisiteStatus: "Требуют проверки", ownerEntityId: "", closingRequired,\n    }).returning();\n    const stableId = \`LGLDOC-\${suffix}\`;\n    await db.insert(legalDocumentItems).values({\n      id: \`\${stableId}-V1\`, stableId, contractId, itemType: "Договор", title: \`\${contractType} № \${number}\`, version: 1,\n      required: true, signedStatus, status: "На проверке", dueDate: validUntil, reference: "Ручной ввод",\n    });\n    await audit(actor, "legal.contract_created", "legal_contract", contractId, { partyId, number, contractType });\n    return Response.json({ contract }, { status: 201 });\n  } catch (error) {\n    await db.delete(entities).where(eq(entities.id, partyId));\n    throw error;\n  }\n}\n\nasync function version(actor: string, body: Record<string, unknown>) {`,
    "legal contract create implementation",
  );
  return source;
});

patch("app/components/LegalWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(source, 'import {useCallback,useEffect,useState}from"react";', 'import {FormEvent,useCallback,useEffect,useState}from"react";', "legal form event import");
  source = replaceText(
    source,
    'export function LegalWorkspace({role,notify,onTasksChanged,focusId}:{role:string;notify:(v:string)=>void;onTasksChanged:()=>void;focusId?:string})',
    'export function LegalWorkspace({role,notify,onTasksChanged,onOpenIntegrations,focusId}:{role:string;notify:(v:string)=>void;onTasksChanged:()=>void;onOpenIntegrations:()=>void;focusId?:string})',
    "legal integration prop",
  );
  source = replaceText(
    source,
    '[busy,setBusy]=useState("");',
    '[busy,setBusy]=useState(""),[createOpen,setCreateOpen]=useState(false);',
    "legal create modal state",
  );
  source = replaceRegex(
    source,
    /async function action\(body:Record<string,unknown>,key:string\)\{[\s\S]*?\}if\(loading\)/,
    `async function action(body:Record<string,unknown>,key:string){setBusy(key);try{const r=await fetch("/api/legal-actions",{method:"POST",headers:{"content-type":"application/json","x-arthello-role":codes[role]??""},body:JSON.stringify(body)}),p=await r.json() as{error?:string;reused?:boolean};if(!r.ok)throw new Error(p.error??"Ошибка");notify(p.reused?"Результат уже существует":"Юридическое действие сохранено");await load();onTasksChanged();return true}catch(e){notify(e instanceof Error?e.message:"Ошибка");return false}finally{setBusy("")}}if(loading)`,
    "legal action result",
  );
  source = replaceRegex(
    source,
    /if\(!data\.contracts\.length&&!data\.documents\.length&&!data\.checks\.length&&!data\.zones\.length\)return <section className="page legal-workspace">[\s\S]*?<\/section>;/,
    `if(!data.contracts.length&&!data.documents.length&&!data.checks.length&&!data.zones.length)return <><section className="page legal-workspace operational-empty-workspace"><div className="legal-heading"><div><p className="eyebrow">Документы и обязательства</p><h1>Юридический контур</h1><p>Реестр, версии, контроль сроков, ответственность и сквозная цепочка доступны до появления первого договора.</p></div><div className="legal-heading-actions"><button onClick={()=>setCreateOpen(true)}>+ Договор</button><button className="secondary" onClick={onOpenIntegrations}>Подключить ЭДО</button></div></div><div className="legal-boundary"><strong>РАБОЧАЯ СТРУКТУРА</strong><span>Пустой реестр не скрывает юридические процессы. Электронная подпись и ЭДО включаются только после реального подключения.</span></div><div className="legal-kpis"><button onClick={()=>setTab("Реестр")}><span>Договоры</span><strong>0</strong><small>реестр пуст</small></button><button onClick={()=>setTab("Контроль")}><span>Истекают</span><strong>0</strong><small>нет сроков</small></button><button className="warn" onClick={()=>setTab("Документы")}><span>Нет обязательных</span><strong>0</strong><small>нет комплектов</small></button><button onClick={()=>setTab("Контроль")}><span>Открытые сигналы</span><strong>0</strong><small>нет проверок</small></button></div><div className="legal-tabs">{tabs.map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div>{tab==="Реестр"?<div className="operational-inline-empty"><span>0</span><strong>Договоров пока нет</strong><p>Создайте первую карточку договора вручную. Система назначит рабочие ID и сохранит запись со статусом «На проверке».</p><button onClick={()=>setCreateOpen(true)}>Добавить договор</button></div>:null}{tab==="Документы"?<div className="operational-inline-empty"><span>v1</span><strong>Версий и приложений пока нет</strong><p>После создания договора здесь появятся основной документ, приложения, акты, согласия и закрывающие документы.</p></div>:null}{tab==="Контроль"?<div className="operational-inline-empty"><span>0</span><strong>Сигналов контроля пока нет</strong><p>Сроки, неподписанные документы, лимиты и комплектность проверяются только по сохранённым договорам.</p></div>:null}{tab==="Ответственность"?<div className="operational-inline-empty"><span>0</span><strong>Зоны ответственности не назначены</strong><p>Владельцы обязательств появятся после создания договора и распределения ролей.</p></div>:null}{tab==="Сквозная цепочка"?<div className="operational-inline-empty"><span>→</span><strong>Сквозная цепочка ещё не собрана</strong><p>Сторона → договор → документ → обязательство → сигнал → решение. Пустые этапы не подменяются фиктивными.</p></div>:null}</section>{createOpen?<ContractModal busy={busy==="create-contract"} close={()=>setCreateOpen(false)} save={async body=>{const ok=await action({...body,action:"createContract"},"create-contract");if(ok){setCreateOpen(false);setTab("Реестр")}}}/>:null}</>;`,
    "legal complete empty shell",
  );
  source = replaceText(
    source,
    '<div className="legal-heading"><div><p className="eyebrow">Этап 9 · документы до обязательства</p><h1>Юридический контур</h1><p>Договоры, версии, сроки, лимиты и закрывающие документы с доказательными сигналами.</p></div><span>ЭП: не подключена</span></div>',
    '<div className="legal-heading"><div><p className="eyebrow">Документы до обязательства</p><h1>Юридический контур</h1><p>Договоры, версии, сроки, лимиты и закрывающие документы с доказательными сигналами.</p></div><div className="legal-heading-actions"><button onClick={()=>setCreateOpen(true)}>+ Договор</button><button className="secondary" onClick={onOpenIntegrations}>ЭДО и подпись</button></div></div>',
    "legal working heading actions",
  );
  source = replaceText(
    source,
    '</section>}\nfunction Head',
    '{createOpen?<ContractModal busy={busy==="create-contract"} close={()=>setCreateOpen(false)} save={async body=>{const ok=await action({...body,action:"createContract"},"create-contract");if(ok){setCreateOpen(false);setTab("Реестр")}}}/>:null}</section>}\nfunction ContractModal({busy,close,save}:{busy:boolean;close:()=>void;save:(body:Record<string,unknown>)=>Promise<void>}){function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();void save(Object.fromEntries(new FormData(event.currentTarget).entries()))}return <div className="modal-layer legal-create-layer"><button className="drawer-scrim" type="button" onClick={close} aria-label="Закрыть форму"/><form className="task-modal legal-create-modal" onSubmit={submit}><div className="drawer-head"><div><p>Юридический контур</p><h2>Добавить договор</h2></div><button type="button" onClick={close}>×</button></div><div className="legal-create-grid"><label><span>Сторона договора *</span><input name="partyName" required minLength={3} placeholder="Наименование организации или ФИО"/></label><label><span>Тип стороны</span><select name="partyType" defaultValue="Контрагент"><option>Контрагент</option><option>Клиент</option><option>Сотрудник</option><option>Подрядчик</option><option>Поставщик</option><option>Арендодатель</option></select></label><label><span>Тип договора</span><select name="contractType" defaultValue="Договор"><option>Договор</option><option>Клиентский договор</option><option>Трудовой договор</option><option>Договор поставки</option><option>Договор подряда</option><option>Договор аренды</option></select></label><label><span>Номер *</span><input name="number" required minLength={2} placeholder="Например, 14/26"/></label><label><span>Действует с *</span><input type="date" name="validFrom" required/></label><label><span>Действует до *</span><input type="date" name="validUntil" required/></label><label><span>Сумма или лимит, ₽</span><input type="number" min="0" step="0.01" name="limitRubles" defaultValue="0"/></label><label><span>Подпись</span><select name="signedStatus" defaultValue="Не подписан"><option>Не подписан</option><option>Подписан</option><option>На согласовании</option></select></label></div><label className="legal-closing-check"><input type="checkbox" name="closingRequired"/><span>Требуются закрывающие документы</span></label><div className="access-separation"><strong>Ручной ввод требует проверки</strong><span>Система создаст сторону, договор и версию v1. Электронная подпись и реквизиты не считаются подтверждёнными до отдельной сверки.</span></div><div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy}>{busy?"Сохраняем…":"Сохранить договор"}</button></div></form></div>}\nfunction Head',
    "legal modal render and helper",
  );
  return source;
});

console.log("System-wide patch content_legal applied");
