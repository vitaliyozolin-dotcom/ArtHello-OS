import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, value) {
  fs.writeFileSync(path, value);
}

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`patch-mobile-visual-help-followup: missing ${label}`);
  return source.replace(before, after);
}

// 1) Dashboard: real period selector + stable help anchors for semantic walkthroughs.
{
  const path = "/app/app/components/OwnerDashboard.tsx";
  let source = read(path);

  source = replaceRequired(
    source,
    '  const [direction, setDirection] = useState("Все типы");\n  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);',
    '  const [direction, setDirection] = useState("Все типы");\n  const [dashboardPeriod, setDashboardPeriod] = useState("");\n  const [activeChartIndex, setActiveChartIndex] = useState<number | null>(null);',
    "dashboard period state",
  );

  source = replaceRequired(
    source,
    '        const response = await fetch("/api/finance", { cache: "no-store", signal: controller.signal });',
    '        const periodQuery = dashboardPeriod ? `?period=${encodeURIComponent(dashboardPeriod)}` : "";\n        const response = await fetch(`/api/finance${periodQuery}`, { cache: "no-store", signal: controller.signal });',
    "finance request period",
  );

  source = replaceRequired(
    source,
    '        setFinance(payload);\n        setSelectedId((current) => current || payload.operations[0]?.id || "");',
    '        setFinance(payload);\n        setDashboardPeriod((current) => current || payload.selectedPeriod || payload.monthly.at(-1)?.period || "");\n        setSelectedId((current) => payload.operations.some((operation) => operation.id === current) ? current : payload.operations[0]?.id || "");',
    "period hydration",
  );

  source = replaceRequired(
    source,
    '  }, []);\n\n  const operations = useMemo(() => {',
    '  }, [dashboardPeriod]);\n\n  const operations = useMemo(() => {',
    "finance effect dependency",
  );

  source = replaceRequired(
    source,
    '  const decisions = tasks.slice(0, 5);\n  const chartData = useMemo(() => finance?.monthly ?? [], [finance]);',
    '  const decisions = tasks.slice(0, 5);\n  const availableDashboardPeriods = useMemo(() => {\n    const values = [finance?.selectedPeriod, ...(finance?.monthly.map((item) => item.period) ?? [])].filter((value): value is string => Boolean(value));\n    return [...new Set(values)].sort().reverse();\n  }, [finance]);\n  const chartData = useMemo(() => finance?.monthly ?? [], [finance]);',
    "available dashboard periods",
  );

  source = replaceRequired(
    source,
    '<div className={styles.kpis}>',
    '<div className={styles.kpis} data-help-block="kpis">',
    "dashboard KPI help anchor",
  );

  source = replaceRequired(
    source,
    '<article className={styles.panel}>\n          <header><strong>Сигналы и риски</strong>',
    '<article className={styles.panel} data-help-block="signals">\n          <header><strong>Сигналы и риски</strong>',
    "signals help anchor",
  );

  source = replaceRequired(
    source,
    '<article className={styles.panel}>\n          <header><strong>Что требует моего решения</strong>',
    '<article className={styles.panel} data-help-block="decisions">\n          <header><strong>Что требует моего решения</strong>',
    "decisions help anchor",
  );

  source = replaceRequired(
    source,
    '<article className={`${styles.panel} ${chartStyles.chartPanel}`}>',
    '<article className={`${styles.panel} ${chartStyles.chartPanel}`} data-help-block="cashflow">',
    "cashflow help anchor",
  );

  source = replaceRequired(
    source,
    '<article className={styles.panel}>\n          <header><strong>Ближайшие контрольные точки</strong>',
    '<article className={styles.panel} data-help-block="milestones">\n          <header><strong>Ближайшие контрольные точки</strong>',
    "milestones help anchor",
  );

  source = replaceRequired(
    source,
    '<article className={`${styles.panel} ${styles.registry}`}>',
    '<article className={`${styles.panel} ${styles.registry}`} data-help-block="operations">',
    "operations help anchor",
  );

  source = replaceRequired(
    source,
    '<aside className={`${styles.panel} ${styles.preview}`} aria-live="polite">',
    '<aside className={`${styles.panel} ${styles.preview}`} aria-live="polite" data-help-block="operation-preview">',
    "operation preview help anchor",
  );

  source = replaceRequired(
    source,
    '<button type="button">{finance?.selectedPeriod ? monthLabel(finance.selectedPeriod, "long") : "Период не выбран"}</button>',
    '<label className={styles.periodSelect}><span className="sr-only">Месяц реестра операций</span><select value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value)} aria-label="Месяц реестра операций">{availableDashboardPeriods.length ? availableDashboardPeriods.map((item) => <option key={item} value={item}>{monthLabel(item, "long")}</option>) : <option value={dashboardPeriod}>{dashboardPeriod ? monthLabel(dashboardPeriod, "long") : "Период не выбран"}</option>}</select></label>',
    "dashboard period control",
  );

  write(path, source);
}

// 2) Semantic, block-by-block guide for the owner dashboard.
{
  const path = "/app/app/components/contextualHelpCatalog.ts";
  let source = read(path);
  const marker = 'export function guideFor(profileId: string) {\n  return profileId === "finance" ? FINANCE_GUIDE : null;\n}';
  const replacement = `export const DASHBOARD_GUIDE: HelpGuide = {
  id: "dashboard",
  title: "Главная",
  intro: "Покажу каждый управленческий блок отдельно: что здесь находится, откуда берутся данные и как с ними работать.",
  steps: [
    {
      id: "dashboard-kpis",
      selector: '[data-help-block="kpis"]',
      title: "Ключевые показатели",
      text: "Карточки дают быстрый срез денег, задолженности, операций и задач. Значения строятся из фактических данных соответствующих модулей, а не из демонстрационных цифр.",
      can: "Нажать на показатель и перейти в раздел, из которого он рассчитан, чтобы проверить детализацию.",
      cannot: "Делать вывод по одной цифре без проверки периода и источника данных.",
    },
    {
      id: "dashboard-signals",
      selector: '[data-help-block="signals"]',
      title: "Сигналы и риски",
      text: "Здесь появляются отклонения и риски, которые система обнаружила в подтверждённых данных: финансы, продажи, долги, процессы и интеграции. Если данных нет, блок честно остаётся пустым.",
      can: "Открыть аналитику, проверить причину сигнала и перейти к исходной записи.",
      cannot: "Считать сигнал доказанным фактом без проверки источника и контекста.",
    },
    {
      id: "dashboard-decisions",
      selector: '[data-help-block="decisions"]',
      title: "Что требует моего решения",
      text: "Это очередь вопросов, где требуется ваше действие или управленческое решение. Записи поступают из задач и связанных рабочих процессов, а не создаются декоративно.",
      can: "Открыть задачу, проверить источник, назначить действие или создать новую задачу.",
      cannot: "Закрывать вопрос без результата или терять связь с исходной записью.",
    },
    {
      id: "dashboard-cashflow",
      selector: '[data-help-block="cashflow"]',
      title: "Денежный поток",
      text: "График показывает фактические поступления и списания по сохранённым финансовым операциям. Это движение денег, а не прибыль по ОПиУ.",
      can: "Смотреть динамику, провалы и переходить в финансовый отчёт для детализации.",
      cannot: "Путать денежный поток с прибылью или использовать прогноз как факт.",
    },
    {
      id: "dashboard-milestones",
      selector: '[data-help-block="milestones"]',
      title: "Ближайшие контрольные точки",
      text: "Здесь собираются ближайшие даты и обязательства из задач и процессов. Блок нужен, чтобы не пропустить событие, срок или зависимость.",
      can: "Перейти в календарь или создать задачу с датой.",
      cannot: "Считать событие выполненным только потому, что дата наступила.",
    },
    {
      id: "dashboard-operations",
      selector: '[data-help-block="operations"]',
      title: "Реестр операций",
      text: "Это короткий финансовый реестр прямо на главной. Месяц выбирается здесь, после чего данные заново загружаются из финансового контура для выбранного периода.",
      can: "Выбирать месяц, тип операции, искать запись и открывать финансовый раздел.",
      cannot: "Ожидать операции за другой месяц, если выбран текущий период, или принимать пустой месяц за отсутствие данных вообще.",
    },
    {
      id: "dashboard-operation-preview",
      selector: '[data-help-block="operation-preview"]',
      title: "Карточка выбранной операции",
      text: "После выбора строки здесь показываются источник, контрагент, назначение, договор и документ. Полная карточка сохраняет происхождение операции и её связи.",
      can: "Открыть полную карточку и проверить первичный источник и связи.",
      cannot: "Менять смысл исходной операции без фиксируемой корректировки и истории.",
    },
  ],
};

export function guideFor(profileId: string) {
  if (profileId === "finance") return FINANCE_GUIDE;
  if (profileId === "dashboard") return DASHBOARD_GUIDE;
  return null;
}`;
  source = replaceRequired(source, marker, replacement, "dashboard contextual guide");
  write(path, source);
}

// 3) Visual system follow-up: family search, funnel columns, contractors and integrations.
{
  const path = "/app/app/components/SystemWideMobilePolish.css";
  let source = read(path);
  const marker = "/* ARTHELLO_MOBILE_VISUAL_HELP_FOLLOWUP */";
  if (!source.includes(marker)) {
    source += `\n\n${marker}

/* Help markers are always attached to the right side of the field label/control. */
.ah-field-icon {
  width: 24px !important;
  min-width: 24px !important;
  height: 24px !important;
  font-size: 13px !important;
  opacity: .92 !important;
}

.family-workspace input[placeholder*="Найти семью"] {
  height: 56px !important;
  padding-left: 50px !important;
  padding-right: 50px !important;
  border-radius: 18px !important;
  font-size: 16px !important;
}

.family-workspace :is(label, div):has(> input[placeholder*="Найти семью"]) {
  position: relative !important;
}

.family-workspace :is(label, div):has(> input[placeholder*="Найти семью"]) > svg,
.family-workspace :is(label, div):has(> input[placeholder*="Найти семью"]) > [class*="icon"] {
  width: 22px !important;
  height: 22px !important;
  min-width: 22px !important;
}

.family-workspace :is([class*="toolbar"], [class*="filters"], [class*="search-row"]) {
  margin-bottom: 16px !important;
  border: 1px solid var(--ah-system-line) !important;
  border-radius: 22px !important;
  background: #fff !important;
  box-shadow: 0 10px 32px rgba(38, 43, 71, .045) !important;
  overflow: visible !important;
}

.family-workspace :is([class*="list"], [class*="table"], [class*="empty"], [class*="registry"]):not([class*="toolbar"]):not([class*="filters"]) {
  border-radius: 22px !important;
}

/* Sales funnel: cards are independent stages, not joined table columns. */
.crm-board {
  display: flex !important;
  gap: 16px !important;
  padding: 2px 2px 10px !important;
  scroll-snap-type: x mandatory;
}

.crm-column {
  flex: 0 0 min(82vw, 360px) !important;
  border: 1px solid var(--ah-system-line) !important;
  border-radius: 22px !important;
  background: #fff !important;
  box-shadow: 0 10px 28px rgba(38, 43, 71, .045) !important;
  overflow: hidden !important;
  scroll-snap-align: start;
}

.crm-column + .crm-column {
  margin-left: 0 !important;
}

/* Contractor contour follows the same rounded visual language. */
.contractor-workspace :is(article, section, [class*="card"], [class*="panel"], [class*="kpi"], [class*="registry"], [class*="toolbar"], [class*="notice"], [class*="boundary"]) {
  border-radius: 20px !important;
}

.contractor-workspace :is([class*="kpi"], [class*="registry"], [class*="panel"], [class*="toolbar"]) {
  overflow: hidden !important;
}

/* Integration boundary is its own card and never touches the catalog above. */
.integration-boundary {
  margin-top: 18px !important;
  margin-bottom: 18px !important;
  border: 1px solid var(--ah-system-line) !important;
  border-radius: 20px !important;
  background: #fff !important;
  box-shadow: 0 10px 32px rgba(38, 43, 71, .045) !important;
  overflow: hidden !important;
}

@media (max-width: 720px) {
  .ah-field-icon {
    width: 24px !important;
    min-width: 24px !important;
    height: 24px !important;
    font-size: 13px !important;
  }

  .crm-board {
    gap: 14px !important;
    padding-right: 18px !important;
  }

  .crm-column {
    min-width: 0 !important;
    flex-basis: min(82vw, 340px) !important;
  }

  .family-workspace :is([class*="toolbar"], [class*="filters"], [class*="search-row"]) {
    margin-bottom: 16px !important;
  }
}
`;
  }
  write(path, source);
}

console.log("patch-mobile-visual-help-followup: applied");
