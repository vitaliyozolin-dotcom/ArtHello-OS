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

patch("app/components/contextualHelpDom.ts", (input) => {
  let source = input;
  source = replaceText(
    source,
    'return Boolean(element?.closest("[data-ah-help-root]"));',
    'return Boolean(element?.closest("[data-ah-help-root],[data-ah-help-inline]"));',
    "inline help mutation boundary",
  );
  source = replaceText(
    source,
    'if (element.closest("[data-ah-help-root]")) return false;',
    'if (element.closest("[data-ah-help-root],[data-ah-help-inline]")) return false;',
    "inline help rendered boundary",
  );
  source = replaceText(
    source,
    'export function clamp(value: number, min: number, max: number) {',
    `export function inlineHelpTargetFor(element: HTMLElement): HTMLElement | null {\n  const label = labelElementFor(element);\n  if (!label) return null;\n\n  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {\n    const legend = element.closest("fieldset")?.querySelector<HTMLElement>(":scope > legend");\n    if (legend && isRendered(legend)) return legend;\n  }\n\n  for (const child of Array.from(label.children)) {\n    if (!(child instanceof HTMLElement) || child.contains(element)) continue;\n    if (["INPUT", "SELECT", "TEXTAREA", "SMALL", "BUTTON"].includes(child.tagName)) continue;\n    if (cleanText(child.textContent, 80)) return child;\n  }\n  return label;\n}\n\nexport function clamp(value: number, min: number, max: number) {`,
    "inline help target helper",
  );
  return source;
});

patch("app/components/ContextualHelpSystem.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";\n',
    'import { useCallback, useEffect, useMemo, useRef, useState } from "react";\nimport { createPortal } from "react-dom";\n',
    "help portal import",
  );
  source = replaceText(source, "  labelRectFor,\n", "  inlineHelpTargetFor,\n", "help inline target import");
  source = replaceRegex(
    source,
    /  const fieldMarkers = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[context\.fields, hints, tour\]\);/,
    `  const fieldMarkers = useMemo(() => {\n    if (!hints || tour || typeof window === "undefined") return [];\n    const seen = new Set<HTMLElement>();\n    return context.fields.flatMap((field) => {\n      const target = inlineHelpTargetFor(field.element);\n      if (!target || seen.has(target)) return [];\n      seen.add(target);\n      return [{ field, target }];\n    });\n  }, [context.fields, hints, tour]);`,
    "static inline help markers",
  );
  source = replaceText(
    source,
    `      {fieldMarkers.map(({ field, left, top }) => (\n        <button\n          className="ah-field-icon"\n          key={field.id}\n          type="button"\n          style={{ left, top }}\n          aria-label={\`Помощь по полю «\${field.label}»\`}\n          onClick={() => startFieldHelp(field)}\n        >?</button>\n      ))}`,
    `      {fieldMarkers.map(({ field, target }) => createPortal(\n        <button\n          className="ah-field-icon"\n          data-ah-help-inline="true"\n          type="button"\n          aria-label={\`Помощь по полю «\${field.label}»\`}\n          onClick={() => startFieldHelp(field)}\n        />,\n        target,\n        field.id,\n      ))}`,
    "portaled inline help markers",
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

