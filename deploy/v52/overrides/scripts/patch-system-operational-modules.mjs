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



