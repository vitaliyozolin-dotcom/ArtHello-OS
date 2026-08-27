import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value, "utf8"); }
function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) throw new Error(`patch-help-finance-ux-v3 failed at ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}
function replaceRegex(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) throw new Error(`patch-help-finance-ux-v3 failed at ${label}: ${matches.length} matches`);
  return source.replace(regex, replacement);
}

// 1) The foundation already portals field-help icons. Mark their real target,
// close the mobile keyboard and stop the disorienting smooth-centre zoom effect.
{
  const path = "/app/app/components/ContextualHelpSystem.tsx";
  let source = read(path);
  source = replaceOnce(
    source,
    '  const startFieldHelp = useCallback((field: HelpField) => {\n    const activeTab = selectedTabLabel();',
    '  const startFieldHelp = useCallback((field: HelpField) => {\n    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();\n    field.element.blur();\n    const activeTab = selectedTabLabel();',
    "close mobile keyboard before field help",
  );
  source = replaceOnce(
    source,
    '      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;\n      element.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center", inline: "nearest" });\n      timers.push(window.setTimeout(measure, reduced ? 30 : 300));',
    '      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;\n      const rect = element.getBoundingClientRect();\n      if (rect.top < 96 || rect.bottom > viewportHeight - 150) {\n        element.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });\n      }\n      timers.push(window.setTimeout(measure, 80));',
    "stable help scroll",
  );
  const markerBlock = `  const fieldMarkers = useMemo(() => {\n    if (!hints || tour || typeof window === "undefined") return [];\n    const seen = new Set<HTMLElement>();\n    return context.fields.flatMap((field) => {\n      const target = inlineHelpTargetFor(field.element);\n      if (!target || seen.has(target)) return [];\n      seen.add(target);\n      return [{ field, target }];\n    });\n  }, [context.fields, hints, tour]);`;
  source = replaceOnce(
    source,
    markerBlock,
    `${markerBlock}\n\n  useEffect(() => {\n    const targets = new Set(fieldMarkers.map(({ target }) => target));\n    targets.forEach((target) => { target.dataset.ahHelpTarget = "true"; });\n    return () => targets.forEach((target) => { delete target.dataset.ahHelpTarget; });\n  }, [fieldMarkers]);`,
    "mark actual field-help targets",
  );
  write(path, source);
}

// 2) Predictable right-edge icon and a mobile bottom sheet that does not hide behind the keyboard.
{
  const path = "/app/app/components/ContextualHelpSystem.css";
  let source = read(path);
  const marker = "/* ARTHELLO_HELP_UX_V3 */";
  if (!source.includes(marker)) source += `\n${marker}\n[data-ah-help-target=true]{position:relative!important;overflow:visible!important}[data-ah-help-target=true]>button[data-ah-help-inline=true].ah-field-icon{position:absolute!important;inset:50% 12px auto auto!important;left:auto!important;right:12px!important;top:50%!important;bottom:auto!important;width:24px!important;min-width:24px!important;height:24px!important;margin:0!important;padding:0!important;transform:translateY(-50%)!important;z-index:20!important;opacity:.95!important;display:grid!important;place-items:center!important}[data-ah-help-target=true]>:is(input:not([type=checkbox]):not([type=radio]),select,textarea,[role=combobox]){padding-right:50px!important}@media(max-width:720px){.ah-tour-callout{left:12px!important;right:12px!important;top:auto!important;bottom:calc(96px + env(safe-area-inset-bottom))!important;width:auto!important;max-height:min(56dvh,520px)!important;overflow:auto!important}.ah-tour-hole{border-radius:18px}.ah-tour-blocker{touch-action:none}}\n`;
  write(path, source);
}

// 3) Give family and contractor modules stable styling scopes.
{
  const path = "/app/app/components/ArtHelloShell.tsx";
  let source = read(path);
  source = replaceOnce(
    source,
    '<FamilyWorkspace notify={setNotice} onOpenIntegrations={() => openModule("integrations")} onNavigate={(module, focusId) => openModule(module, focusId)} />',
    '<div className="family-workspace"><FamilyWorkspace notify={setNotice} onOpenIntegrations={() => openModule("integrations")} onNavigate={(module, focusId) => openModule(module, focusId)} /></div>',
    "family style scope",
  );
  source = replaceOnce(
    source,
    '<ContractorWorkspace notify={setNotice} onOpenFinance={() => openModule("finance")} />',
    '<div className="contractor-workspace"><ContractorWorkspace notify={setNotice} onOpenFinance={() => openModule("finance")} /></div>',
    "contractor style scope",
  );
  write(path, source);
}

// 4) Finance: one visible Moscow-time period control shared by Register, Cash Flow,
// P&L, plan/forecast and debts. It accepts months even when no rows exist yet.
{
  const path = "/app/app/components/FinanceWorkspace.tsx";
  let source = read(path);
  source = replaceOnce(
    source,
    'const currentPeriod = () => new Date().toISOString().slice(0, 7);',
    `const currentPeriod = () => {\n  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit" }).formatToParts(new Date());\n  const year = parts.find((part) => part.type === "year")?.value ?? "";\n  const month = parts.find((part) => part.type === "month")?.value ?? "";\n  return year && month ? \`${year}-\${month}\` : new Date().toISOString().slice(0, 7);\n};`,
    "Moscow current finance period",
  );
  source = replaceOnce(
    source,
    '  const operationCloseRef = useRef<HTMLButtonElement>(null);\n\n  const closeOperation = useCallback(() => {',
    `  const operationCloseRef = useRef<HTMLButtonElement>(null);\n\n  const movePeriod = useCallback((delta: number) => {\n    setPeriod((value) => {\n      const base = /^\\d{4}-\\d{2}$/.test(value) ? value : currentPeriod();\n      const [year, month] = base.split("-").map(Number);\n      const date = new Date(Date.UTC(year, month - 1 + delta, 1));\n      return \`${date.getUTCFullYear()}-\${String(date.getUTCMonth() + 1).padStart(2, "0")}\`;\n    });\n  }, []);\n\n  const closeOperation = useCallback(() => {`,
    "period navigation helper",
  );
  source = replaceRegex(
    source,
    /\n  const availablePeriods = \[\.\.\.new Set\([\s\S]*?\n  const operationCorrections =/,
    '\n  const operationCorrections =',
    "remove hidden period list",
  );
  source = replaceOnce(
    source,
    '      </div>\n\n      <div className="finance-kpis">',
    `      </div>\n\n      <section className="finance-period-bar" data-help-block="finance-period" aria-label="Отчётный период">\n        <div><span>Отчётный период</span><strong>{periodLabel(period)}</strong><small>Один месяц для Реестра, ДДС, ОПиУ, план‑факта и долгов</small></div>\n        <div className="finance-period-actions">\n          <button type="button" onClick={() => movePeriod(-1)} aria-label="Предыдущий месяц">←</button>\n          <label><span className="sr-only">Выбрать месяц</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Выбрать отчётный месяц" /></label>\n          <button type="button" onClick={() => movePeriod(1)} aria-label="Следующий месяц">→</button>\n          <button className="finance-current-period" type="button" onClick={() => setPeriod(currentPeriod())}>Текущий месяц</button>\n        </div>\n      </section>\n\n      <div className="finance-kpis">`,
    "visible finance period bar",
  );
  source = replaceOnce(
    source,
    '        <label><span>Период</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{availablePeriods.map((value) => <option key={value} value={value}>{periodLabel(value)}</option>)}</select></label>\n',
    '',
    "remove period from hidden tab strip",
  );
  write(path, source);
}

// 5) Rounded family empty state, contractor blocks and the shared finance period bar.
{
  const path = "/app/app/components/SystemWideMobilePolish.css";
  let source = read(path);
  const marker = "/* ARTHELLO_OPERATIONAL_UX_V3 */";
  if (!source.includes(marker)) source += `\n${marker}\n.family-workspace,.contractor-workspace{display:contents}.family-workspace .page>:last-child{margin-top:16px!important;border:1px solid var(--ah-system-line)!important;border-radius:22px!important;background:#fff!important;overflow:hidden!important}.family-workspace .page>:last-child :is(p,h2,h3,strong,span,button){max-width:100%;overflow-wrap:anywhere}.contractor-workspace .page :is([class*=boundary],[class*=notice],[class*=panel],[class*=registry],[class*=register],[class*=toolbar],[class*=table-wrap],[class*=empty]){border-radius:20px!important;overflow:hidden!important}.contractor-workspace .page :is([class*=kpi],[class*=stat],[class*=summary])>*{border:1px solid var(--ah-system-line)!important;border-radius:18px!important;background:#fff!important;overflow:hidden!important}.finance-period-bar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:18px 0;padding:16px 18px;border:1px solid var(--ah-system-line);border-radius:20px;background:#fff;box-shadow:0 10px 30px rgba(38,43,71,.045)}.finance-period-bar>div:first-child{display:grid;gap:3px}.finance-period-bar span,.finance-period-bar small{color:var(--ah-system-muted)}.finance-period-bar strong{font-size:20px}.finance-period-actions{display:flex;align-items:center;gap:8px}.finance-period-actions button,.finance-period-actions input{min-height:44px;border:1px solid #dde2ed;border-radius:13px;background:#fff;color:var(--ah-system-text);font:inherit}.finance-period-actions button{padding:0 14px}.finance-period-actions input{padding:0 12px}.finance-period-actions .finance-current-period{background:var(--ah-system-accent);border-color:var(--ah-system-accent);color:#fff}@media(max-width:720px){.finance-period-bar{align-items:stretch;flex-direction:column}.finance-period-actions{display:grid;grid-template-columns:44px minmax(0,1fr) 44px}.finance-period-actions label,.finance-period-actions input{width:100%}.finance-period-actions .finance-current-period{grid-column:1/-1}.contractor-workspace .page :is([class*=grid],[class*=kpi],[class*=stats]){gap:12px!important}}\n`;
  write(path, source);
}

console.log("patch-help-finance-ux-v3: applied");
