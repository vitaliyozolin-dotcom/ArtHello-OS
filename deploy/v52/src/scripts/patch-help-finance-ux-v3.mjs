import fs from "node:fs";

const appRoot = (process.env.ARTHELLO_PATCH_ROOT || "/app").replace(/\/$/, "");
const appPath = (relativePath) => `${appRoot}/${relativePath}`;

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value, "utf8"); }
function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1) return source;
  if (second !== -1) throw new Error(`patch-help-finance-ux-v3 failed at ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}
// 3) Give family and contractor modules stable styling scopes.
{
  const path = appPath("app/components/ArtHelloShell.tsx");
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
    '<div className="ahContractorScope"><ContractorWorkspace notify={setNotice} onOpenFinance={() => openModule("finance")} /></div>',
    "contractor Design System scope",
  );
  write(path, source);
}

console.log("FinanceWorkspace Design System override is already installed; legacy period patch skipped");

// 5) Rounded family empty state, contractor blocks and the shared finance period bar.
{
  const path = appPath("app/components/SystemWideMobilePolish.css");
  let source = read(path);
  const marker = "/* ARTHELLO_OPERATIONAL_UX_V3 */";
  if (!source.includes(marker)) source += `\n${marker}\n.family-workspace,.contractor-workspace{display:contents}.family-workspace .page>:last-child{margin-top:16px!important;border:1px solid var(--ah-system-line)!important;border-radius:22px!important;background:#fff!important;overflow:hidden!important}.family-workspace .page>:last-child :is(p,h2,h3,strong,span,button){max-width:100%;overflow-wrap:anywhere}.contractor-workspace .page :is([class*=boundary],[class*=notice],[class*=panel],[class*=registry],[class*=register],[class*=toolbar],[class*=table-wrap],[class*=empty]){border-radius:20px!important;overflow:hidden!important}.contractor-workspace .page :is([class*=kpi],[class*=stat],[class*=summary])>*{border:1px solid var(--ah-system-line)!important;border-radius:18px!important;background:#fff!important;overflow:hidden!important}.finance-period-bar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:18px 0;padding:16px 18px;border:1px solid var(--ah-system-line);border-radius:20px;background:#fff;box-shadow:0 10px 30px rgba(38,43,71,.045)}.finance-period-bar>div:first-child{display:grid;gap:3px}.finance-period-bar span,.finance-period-bar small{color:var(--ah-system-muted)}.finance-period-bar strong{font-size:20px}.finance-period-actions{display:flex;align-items:center;gap:8px}.finance-period-actions button,.finance-period-actions input{min-height:44px;border:1px solid #dde2ed;border-radius:13px;background:#fff;color:var(--ah-system-text);font:inherit}.finance-period-actions button{padding:0 14px}.finance-period-actions input{padding:0 12px}.finance-period-actions .finance-current-period{background:var(--ah-system-accent);border-color:var(--ah-system-accent);color:#fff}@media(max-width:720px){.finance-period-bar{align-items:stretch;flex-direction:column}.finance-period-actions{display:grid;grid-template-columns:44px minmax(0,1fr) 44px}.finance-period-actions label,.finance-period-actions input{width:100%}.finance-period-actions .finance-current-period{grid-column:1/-1}.contractor-workspace .page :is([class*=grid],[class*=kpi],[class*=stats]){gap:12px!important}}\n`;
  write(path, source);
}

console.log("patch-help-finance-ux-v3: applied");
