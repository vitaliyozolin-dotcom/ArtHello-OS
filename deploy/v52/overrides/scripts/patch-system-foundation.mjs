import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function target(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function replaceText(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1) return source;
  if (second !== -1) {
    throw new Error(`System-wide UI patch failed at ${label}: expected exactly one text match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function patch(relativePath, transform) {
  const path = target(relativePath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`System-wide UI patch already applied for ${relativePath}`);
    return;
  }
  writeFileSync(path, after, "utf8");
}

patch("app/components/ArtHelloShell.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'import "./ContentModern.css";\n',
    'import "./ContentModern.css";\nimport "./design-system/tokens.css";\nimport "./design-system/design-system.css";\nimport "./SystemWideMobilePolish.css";\n',
    "global design system and mobile polish imports",
  );
  source = replaceText(
    source,
    '<ContentWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenSales={() => openModule("sales")} onOpenFinance={() => openModule("finance")} />',
    '<ContentWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenSales={() => openModule("sales")} onOpenFinance={() => openModule("finance")} onOpenIntegrations={() => openModule("integrations")} />',
    "content integration navigation",
  );
  source = replaceText(
    source,
    '<AnalyticsWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />',
    '<AnalyticsWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenIntegrations={() => openModule("integrations")} />',
    "analytics integration navigation",
  );
  return source;
});

if (readFileSync(target("app/components/HrWorkspace.tsx"), "utf8").includes('className="ahHrPage"')) {
  console.log("HrWorkspace Design System override already owns its dialog portals");
} else patch("app/components/HrWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'import { SoftSelect } from "./SoftSelect";\n',
    'import { SoftSelect } from "./SoftSelect";\nimport { createPortal } from "react-dom";\n',
    "HR portal import",
  );
  source = replaceText(
    source,
    '  return <div className="modal-layer staff-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть"/><form className="task-modal staff-modal" onSubmit={save}>',
    '  return createPortal(<div className="modal-layer staff-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть"/><form className="task-modal staff-modal" onSubmit={save}>',
    "employee modal portal start",
  );
  source = replaceText(
    source,
    '</div><div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy==="save-employee"}>{busy==="save-employee"?"Сохраняем…":"Сохранить сотрудника"}</button></div></form></div>\n}',
    '</div><div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={busy==="save-employee"}>{busy==="save-employee"?"Сохраняем…":"Сохранить сотрудника"}</button></div></form></div>, document.body)\n}',
    "employee modal portal end",
  );
  source = replaceText(
    source,
    '  return <div className="modal-layer staff-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть"/><section className="task-modal staff-modal import-staff-modal">',
    '  return createPortal(<div className="modal-layer staff-modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть"/><section className="task-modal staff-modal import-staff-modal">',
    "employee import portal start",
  );
  source = replaceText(
    source,
    '</div><div className="modal-actions"><button onClick={close}>Отмена</button><button disabled={!rows.length||busy==="import-employees"} onClick={()=>void submit(rows)}>{busy==="import-employees"?"Импортируем…":"Импортировать на проверку"}</button></div></section></div>\n}',
    '</div><div className="modal-actions"><button onClick={close}>Отмена</button><button disabled={!rows.length||busy==="import-employees"} onClick={()=>void submit(rows)}>{busy==="import-employees"?"Импортируем…":"Импортировать на проверку"}</button></div></section></div>, document.body)\n}',
    "employee import portal end",
  );
  return source;
});

patch("app/components/SalesWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";\n',
    'import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";\nimport { createPortal } from "react-dom";\n',
    "sales portal import",
  );
  source = replaceText(
    source,
    '  return <div className="lead-create-layer"><button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть создание лида" /><form className="lead-create-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="lead-create-title">',
    '  return createPortal(<div className="lead-create-layer"><button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть создание лида" /><form className="lead-create-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="lead-create-title">',
    "lead create portal start",
  );
  source = replaceText(
    source,
    '</footer></form></div>;\n}\n\nfunction PanelHead',
    '</footer></form></div>, document.body);\n}\n\nfunction PanelHead',
    "lead create portal end",
  );
  source = replaceText(
    source,
    '  return <div className="sales-drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть карточку" /><aside className="sales-drawer">',
    '  return createPortal(<div className="sales-drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть карточку" /><aside className="sales-drawer">',
    "lead drawer portal start",
  );
  source = replaceText(
    source,
    '</div></aside></div>;\n}',
    '</div></aside></div>, document.body);\n}',
    "lead drawer portal end",
  );
  return source;
});

patch("app/globals.css", (input) => {
  let source = input;
  source = replaceText(
    source,
    '.content-frame [class$="-workspace"] :where(p,span,small,em,strong,dt,dd,time,label,button,input,select,textarea,th,td){font-size:14px!important;line-height:1.45}',
    '.content-frame [class$="-workspace"] :where(p,span,small,em,strong,dt,dd,time,label,button,input,select,textarea,th,td):not([data-ah-compact-card], [data-ah-compact-card] *){font-size:14px!important;line-height:1.45}',
    "legacy workspace 14px blanket",
  );
  source = replaceText(
    source,
    '.analytics-workspace :where(strong,span,small,em,p,dt,dd,button,select),.readiness-workspace :where(strong,span,small,em,p,dt,dd,button,select),.integration-workspace :where(strong,span,small,em,p,dt,dd,button,select){font-size:14px!important;line-height:1.4}',
    '.analytics-workspace :where(strong,span,small,em,p,dt,dd,button,select):not([data-ah-compact-card], [data-ah-compact-card] *),.readiness-workspace :where(strong,span,small,em,p,dt,dd,button,select):not([data-ah-compact-card], [data-ah-compact-card] *),.integration-workspace :where(strong,span,small,em,p,dt,dd,button,select):not([data-ah-compact-card], [data-ah-compact-card] *){font-size:14px!important;line-height:1.4}',
    "legacy specialist workspace 14px blanket",
  );
  source = replaceText(
    source,
    '.content-frame [class$="-workspace"] :where(p,span,small,em,dt,dd,time,label,button,input,select,textarea,th,td){font-size:15px!important}',
    '.content-frame [class$="-workspace"] :where(p,span,small,em,dt,dd,time,label,button,input,select,textarea,th,td):not([data-ah-compact-card], [data-ah-compact-card] *){font-size:15px!important}',
    "legacy desktop workspace 15px blanket",
  );
  return source;
});

console.log("System-wide patch foundation applied");
