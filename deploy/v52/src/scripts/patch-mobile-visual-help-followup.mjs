import fs from "node:fs";

const appRoot = process.env.ARTHELLO_PATCH_ROOT || "/app";
const target = (relativePath) => `${appRoot}${relativePath}`;

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`patch-mobile-visual-help-followup: missing ${label}`);
  return source.replace(before, after);
}

// Dashboard: real month selector + stable anchors for semantic walkthroughs.
{
  const path = target("/app/components/OwnerDashboard.tsx");
  let source = read(path);
  // Current dashboard owns its period control, help anchors and role-scoped layout.
  // Keep the legacy transformer only for older deployment sources.
  if (!source.includes("const DASHBOARD_STORAGE_PREFIX =")) {
  source = replaceRequired(source,
    '  const [direction, setDirection] = useState("Все типы");\n  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);',
    '  const [direction, setDirection] = useState("Все типы");\n  const [dashboardPeriod, setDashboardPeriod] = useState("");\n  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);', "dashboard period state");
  source = replaceRequired(source,
    '        const response = await fetch("/api/finance", { cache: "no-store", signal: controller.signal });',
    '        const periodQuery = dashboardPeriod ? `?period=${encodeURIComponent(dashboardPeriod)}` : "";\n        const response = await fetch(`/api/finance${periodQuery}`, { cache: "no-store", signal: controller.signal });', "finance request period");
  source = replaceRequired(source,
    '        setFinance(payload);\n        setSelectedId((current) => current || payload.operations[0]?.id || "");',
    '        setFinance(payload);\n        setDashboardPeriod((current) => current || payload.selectedPeriod || payload.monthly.at(-1)?.period || "");\n        setSelectedId((current) => payload.operations.some((operation) => operation.id === current) ? current : payload.operations[0]?.id || "");', "period hydration");
  source = replaceRequired(source, '  }, []);\n\n  const operations = useMemo(() => {', '  }, [dashboardPeriod]);\n\n  const operations = useMemo(() => {', "finance effect dependency");
  source = replaceRequired(source,
    '  const decisions = tasks.slice(0, 5);\n  const chartData = useMemo(() => finance?.monthly ?? [], [finance]);',
    '  const decisions = tasks.slice(0, 5);\n  const availableDashboardPeriods = useMemo(() => {\n    const values = [finance?.selectedPeriod, ...(finance?.monthly.map((item) => item.period) ?? [])].filter((value): value is string => Boolean(value));\n    return [...new Set(values)].sort().reverse();\n  }, [finance]);\n  const chartData = useMemo(() => finance?.monthly ?? [], [finance]);', "available dashboard periods");
  const anchors = [
    ['<div className={`${styles.kpis} owner-dashboard-kpis`}>','<div className={`${styles.kpis} owner-dashboard-kpis`} data-help-block="kpis">'],
    ['<article className={styles.panel}>\n          <header><strong>Сигналы и риски</strong>','<article className={styles.panel} data-help-block="signals">\n          <header><strong>Сигналы и риски</strong>'],
    ['<article className={styles.panel}>\n          <header><strong>Что требует моего решения</strong>','<article className={styles.panel} data-help-block="decisions">\n          <header><strong>Что требует моего решения</strong>'],
    ['<article className={`${styles.panel} ${chartStyles.chartPanel}`}>','<article className={`${styles.panel} ${chartStyles.chartPanel}`} data-help-block="cashflow">'],
    ['<article className={styles.panel}>\n          <header><strong>Ближайшие контрольные точки</strong>','<article className={styles.panel} data-help-block="milestones">\n          <header><strong>Ближайшие контрольные точки</strong>'],
    ['<article className={`${styles.panel} ${styles.registry}`}>','<article className={`${styles.panel} ${styles.registry}`} data-help-block="operations">'],
    ['<aside className={`${styles.panel} ${styles.preview}`} aria-live="polite">','<aside className={`${styles.panel} ${styles.preview}`} aria-live="polite" data-help-block="operation-preview">'],
  ];
  for (const [before, after] of anchors) source = replaceRequired(source, before, after, `help anchor ${after}`);
  source = replaceRequired(source,
    '<button type="button">{finance?.selectedPeriod ? monthLabel(finance.selectedPeriod, "long") : "Период не выбран"}</button>',
    '<label className={styles.periodSelect}><span className="sr-only">Месяц реестра операций</span><select value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value)} aria-label="Месяц реестра операций">{availableDashboardPeriods.length ? availableDashboardPeriods.map((item) => <option key={item} value={item}>{monthLabel(item, "long")}</option>) : <option value={dashboardPeriod}>{dashboardPeriod ? monthLabel(dashboardPeriod, "long") : "Период не выбран"}</option>}</select></label>', "dashboard period control");
  }
  write(path, source);
}

// Semantic, block-by-block guide for the owner dashboard.
{
  const path = target("/app/components/contextualHelpCatalog.ts");
  let source = read(path);
  const marker = 'export function guideFor(profileId: string) {\n  return profileId === "finance" ? FINANCE_GUIDE : null;\n}';
  const replacement = `export const DASHBOARD_GUIDE: HelpGuide = {
  id: "dashboard", title: "Главная",
  intro: "Покажу каждый управленческий блок отдельно: что здесь находится, откуда берутся данные и как с ними работать.",
  steps: [
    { id:"dashboard-kpis", selector:'[data-help-block="kpis"]', title:"Ключевые показатели", text:"Карточки дают быстрый срез денег, задолженности, операций и задач. Значения строятся из фактических данных соответствующих модулей.", can:"Нажать на показатель и перейти к детализации.", cannot:"Делать вывод без проверки периода и источника." },
    { id:"dashboard-signals", selector:'[data-help-block="signals"]', title:"Сигналы и риски", text:"Здесь появляются отклонения и риски из подтверждённых данных финансов, продаж, долгов, процессов и интеграций.", can:"Открыть аналитику, проверить причину и исходную запись.", cannot:"Считать сигнал доказанным фактом без проверки источника." },
    { id:"dashboard-decisions", selector:'[data-help-block="decisions"]', title:"Что требует моего решения", text:"Очередь вопросов, где требуется ваше действие. Записи поступают из задач и связанных рабочих процессов.", can:"Открыть задачу, проверить источник и назначить действие.", cannot:"Закрывать вопрос без результата и связи с исходной записью." },
    { id:"dashboard-cashflow", selector:'[data-help-block="cashflow"]', title:"Денежный поток", text:"График показывает фактические поступления и списания. Это движение денег, а не прибыль по ОПиУ.", can:"Смотреть динамику и переходить в финансовый отчёт.", cannot:"Путать денежный поток с прибылью или прогнозом." },
    { id:"dashboard-milestones", selector:'[data-help-block="milestones"]', title:"Ближайшие контрольные точки", text:"Здесь собираются ближайшие даты и обязательства из задач и процессов.", can:"Перейти в календарь или создать задачу с датой.", cannot:"Считать событие выполненным только потому, что дата наступила." },
    { id:"dashboard-operations", selector:'[data-help-block="operations"]', title:"Реестр операций", text:"Короткий финансовый реестр на главной. Выбор месяца повторно загружает операции выбранного периода.", can:"Выбирать месяц, тип операции, искать запись и открывать финансы.", cannot:"Принимать пустой выбранный месяц за отсутствие данных вообще." },
    { id:"dashboard-operation-preview", selector:'[data-help-block="operation-preview"]', title:"Карточка выбранной операции", text:"Здесь показываются источник, контрагент, назначение, договор и документ выбранной строки.", can:"Открыть полную карточку и проверить первичный источник.", cannot:"Менять смысл исходной операции без фиксируемой корректировки." },
  ],
};
export function guideFor(profileId: string) {
  if (profileId === "finance") return FINANCE_GUIDE;
  if (profileId === "dashboard") return DASHBOARD_GUIDE;
  return null;
}`;
  if (!source.includes("export const DASHBOARD_GUIDE")) {
    source = replaceRequired(source, marker, replacement, "dashboard contextual guide");
  } else if (!source.includes('if (profileId === "dashboard") return DASHBOARD_GUIDE;')) {
    throw new Error("patch-mobile-visual-help-followup: invalid existing dashboard contextual guide");
  }
  write(path, source);
}

// Compact visual delta. Keep this deliberately small: global CSS has a hard build budget.
{
  const path = target("/app/components/SystemWideMobilePolish.css");
  let source = read(path);
  const marker = "/* ARTHELLO_MOBILE_VISUAL_HELP_FOLLOWUP */";
  if (!source.includes(marker)) source += `\n${marker}\n.family-workspace input[placeholder*="Найти семью"]{height:56px!important;padding-left:50px!important;padding-right:50px!important;border-radius:18px!important;font-size:16px!important}.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"]){position:relative!important}.family-workspace :is(label,div):has(>input[placeholder*="Найти семью"])>:is(svg,[class*="icon"]){width:22px!important;height:22px!important;min-width:22px!important}.family-workspace :is([class*="toolbar"],[class*="filters"],[class*="search-row"]){margin-bottom:16px!important;border:1px solid var(--ah-system-line)!important;border-radius:22px!important;background:#fff!important;overflow:visible!important}.family-workspace :is([class*="list"],[class*="table"],[class*="empty"],[class*="registry"]):not([class*="toolbar"]):not([class*="filters"]){border-radius:22px!important}.crm-board{display:flex!important;gap:16px!important;padding:2px 2px 10px!important;scroll-snap-type:x mandatory}.crm-column{flex:0 0 min(82vw,360px)!important;border:1px solid var(--ah-system-line)!important;border-radius:22px!important;background:#fff!important;overflow:hidden!important;scroll-snap-align:start}.crm-column+.crm-column{margin-left:0!important}.contractor-workspace :is(article,section,[class*="card"],[class*="panel"],[class*="kpi"],[class*="registry"],[class*="toolbar"],[class*="notice"],[class*="boundary"]){border-radius:20px!important}.integration-boundary{margin:18px 0!important;border:1px solid var(--ah-system-line)!important;border-radius:20px!important;background:#fff!important;overflow:hidden!important}@media(max-width:720px){.crm-board{gap:14px!important;padding-right:18px!important}.crm-column{min-width:0!important;flex-basis:min(82vw,340px)!important}}\n`;
  write(path, source);
}
console.log("patch-mobile-visual-help-followup: applied");
