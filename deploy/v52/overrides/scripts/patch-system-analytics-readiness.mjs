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

patch("app/components/AnalyticsWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'export function AnalyticsWorkspace({role,notify,onTasksChanged}:{role:string;notify:(value:string)=>void;onTasksChanged:()=>void})',
    'export function AnalyticsWorkspace({role,notify,onTasksChanged,onOpenIntegrations}:{role:string;notify:(value:string)=>void;onTasksChanged:()=>void;onOpenIntegrations:()=>void})',
    "analytics integration prop",
  );
  source = replaceRegex(
    source,
    /if\(!data\.contracts\.length\)return <section className="page analytics-workspace">[\s\S]*?<\/section>;/,
    `if(!data.contracts.length)return <section className="page analytics-workspace operational-empty-workspace"><div className="analytics-heading"><div><p className="eyebrow">Факты, прогнозы и решения</p><h1>Аналитика и ИИ</h1><p>Все аналитические разделы доступны сразу. Метрики и сигналы заполняются только из сохранённых рабочих источников.</p></div><div className="analytics-heading-actions"><button onClick={onOpenIntegrations}>Подключить источники</button></div></div><div className="analytics-boundary"><strong>НЕТ ИСХОДНЫХ ДАННЫХ</strong><span>Нулевые значения не заменяются модельными или демонстрационными. Формулы, контракты и решения появятся после настройки источников.</span></div><div className="analytics-heroes"><Hero label="Чистый поток" value={rub(0)} note="нет операций" tone="neutral"/><Hero label="Минимум прогноза" value={rub(0)} note="нет календаря" tone="neutral"/><Hero label="Семьи высокого риска" value="0" note="нет клиентских данных" tone="neutral"/><Hero label="Качество данных" value="0" note="нет сверок" tone="neutral"/><Hero label="Live-источники" value="0" note="нет подтверждённой передачи" tone="neutral"/></div><div className="analytics-tabs">{tabs.map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}</button>)}</div>{tab==="Обзор"?<div className="operational-empty-grid"><button className="operational-empty-card" onClick={onOpenIntegrations}><span>01</span><strong>Источники</strong><p>Подключите финансы, продажи, обучение, HR, безопасность и другие рабочие контуры.</p></button><button className="operational-empty-card" onClick={()=>setTab("Метрики")}><span>02</span><strong>Словарь метрик</strong><p>Каждый показатель будет иметь определение, формулу, владельца и свежесть.</p></button><button className="operational-empty-card" onClick={()=>setTab("AI-контракты")}><span>03</span><strong>AI-контракты</strong><p>Модельный процесс не запускается без зафиксированных границ, пользы и условия отключения.</p></button><button className="operational-empty-card" onClick={()=>setTab("Решения и отказ")}><span>04</span><strong>Решения человека</strong><p>История запусков, решений и отказов хранится отдельно от бизнес-факта.</p></button></div>:null}{tab==="Деньги"?<div className="operational-empty-grid"><div className="operational-empty-card"><span>ДДС</span><strong>Поступления и списания</strong><p>График появится после загрузки финансовых операций.</p></div><div className="operational-empty-card"><span>ПЛАН</span><strong>Прогноз остатка</strong><p>Вероятностный сценарий строится только по сохранённому платёжному календарю.</p></div></div>:null}{tab==="Сигналы"?<div className="operational-inline-empty"><span>0</span><strong>Сигналов пока нет</strong><p>Риск или рекомендация появятся только с доказательством, источником и ответственным человеком.</p></div>:null}{tab==="AI-контракты"?<div className="operational-inline-empty"><span>AI</span><strong>AI-контракты не созданы</strong><p>Сначала определите входные данные, разрешённые действия, стоимость, метрику пользы, отказ и автоотключение.</p></div>:null}{tab==="Решения и отказ"?<div className="operational-inline-empty"><span>0</span><strong>Запусков и решений пока нет</strong><p>Раздел останется пустым, пока человек не запустит утверждённый сценарий.</p></div>:null}{tab==="Метрики"?(data.metricDefinitions.length?<div className="metric-dictionary"><header><span>Метрика</span><span>Определение и формула</span><span>Источник</span><span>Свежесть / качество</span></header>{data.metricDefinitions.map(item=><article key={item.id}><span><strong>{item.name}</strong><small>{item.id} · {item.category} · {item.unit}</small></span><span><strong>{item.definition}</strong><small>{item.formula} · grain: {item.grain}</small></span><span><strong>{item.sourceTables}</strong><small>{item.ownerEntityId}</small></span><span><strong>{item.freshness}</strong><small>{item.sourceQuality}</small></span></article>)}</div>:<div className="operational-inline-empty"><span>0</span><strong>Словарь метрик пуст</strong><p>Определения появятся после утверждения показателей и их источников.</p></div>):null}</section>;`,
    "analytics complete empty shell",
  );
  return source;
});

patch("app/components/ReadinessWorkspace.tsx", (input) => {
  return replaceRegex(
    input,
    /  if \(!data\.scenarios\.length\) \{[\s\S]*?\n  \}\n\n  const scenario =/,
    `  if (!data.scenarios.length) {\n    return <section className="page readiness-workspace operational-empty-workspace">\n      <header className="readiness-heading"><div><p className="eyebrow">Контроль готовности</p><h1>Готовность ArtHello OS</h1><p>Визуальная проверка, сценарии, ворота выпуска и восстановление остаются доступными до первой приёмки.</p></div><div><span className="readiness-release">НЕТ СОХРАНЁННЫХ ПРОВЕРОК</span><button disabled>Запустить проверки</button></div></header>\n      <div className="readiness-alert"><strong>PRODUCTION НЕ ПОДТВЕРЖДЁН</strong><span>Пустой контур не считается пройденной проверкой. Результаты появятся только после фактического запуска.</span></div>\n      <div className="readiness-kpis"><article><span>Сценарии</span><strong>0</strong><small>не настроены</small></article><article><span>Пройдено</span><strong>0</strong><small>нет результатов</small></article><article><span>Ворота выпуска</span><strong>0/0</strong><small>не настроены</small></article><article className="blocked"><span>Production</span><strong>запрещён</strong><small>нет доказательств</small></article></div>\n      <nav className="readiness-tabs">{tabs.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>\n      {tab === "Визуальная оболочка" ? <div className="operational-empty-grid">{visualGates.map(([name, evidence], index) => <article className="operational-empty-card" key={name}><span>{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong><p>{evidence}</p><small>Ожидает проверки</small></article>)}</div> : null}\n      {tab === "10 сценариев" ? <div className="operational-inline-empty"><span>0</span><strong>Сквозные сценарии не настроены</strong><p>После настройки здесь появятся шаги, доказательства и результат каждого маршрута.</p></div> : null}\n      {tab === "Матрица проверок" ? <div className="operational-inline-empty"><span>0</span><strong>Матрица проверок пуста</strong><p>Добавьте уровни тестирования и сохранённые результаты.</p></div> : null}\n      {tab === "Release gates" ? <div className="operational-inline-empty"><span>0</span><strong>Ворота выпуска не определены</strong><p>Без обязательных gates система не может считаться готовой к публикации.</p></div> : null}\n      {tab === "Recovery и rollback" ? <div className="operational-inline-empty"><span>0</span><strong>Учения восстановления не проводились</strong><p>Нужны сохранённые RPO, RTO, контрольные суммы и ограничения.</p></div> : null}\n      {tab === "Решение представителя" ? <div className="operational-inline-empty"><span>—</span><strong>Решение не зафиксировано</strong><p>Приёмка возможна только после прохождения обязательных проверок и содержательного комментария.</p></div> : null}\n    </section>;\n  }\n\n  const scenario =`,
    "readiness complete empty shell",
  );
});

console.log("System-wide patch analytics_readiness applied");
