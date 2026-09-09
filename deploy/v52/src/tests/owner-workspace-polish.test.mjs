import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("question-mark field helpers cannot be restored by the production pipeline", () => {
  const sources = [
    read("../app/components/ContextualHelpSystem.tsx"),
    read("../app/components/contextualHelpDom.ts"),
    read("../app/components/ContextualHelpSystem.css"),
    read("../app/components/SystemWideMobilePolish.css"),
    read("../scripts/patch-system-foundation.mjs"),
    read("../scripts/patch-help-finance-ux-v3.mjs"),
    read("../scripts/patch-help-finance-ux-v3-fix.mjs"),
    read("../scripts/patch-help-marker-right-edge.mjs"),
    read("../scripts/patch-mobile-design-system-v4.mjs"),
    read("../scripts/patch-mobile-visual-help-followup.mjs"),
    read("../scripts/patch-mobile-canonical-v5.mjs"),
  ].join("\n");

  assert.doesNotMatch(sources, /data-ah-help-inline|fieldMarkers|ah-field-icon|content:"\?"/);
  assert.match(sources, /className="ah-launch"/);
});

test("family search uses one conventional icon and human-facing labels", () => {
  const family = read("../app/components/FamilyWorkspace.tsx");
  assert.match(family, /<AppIcon name="search"\/>/);
  assert.match(family, /placeholder="Найти семью по имени"/);
  assert.doesNotMatch(family, />⌕<|Найти семью по имени или ID/);
  assert.match(family, /recordLabel\("Семья",family\.id\)/);
  assert.match(family, /recordLabel\("Операция",operation\.id\)/);
});

test("dashboard supports dense horizontal layout and direct drag-and-drop", () => {
  const dashboard = read("../app/components/OwnerDashboard.tsx");
  const styles = read("../app/components/OwnerDashboard.module.css");
  assert.match(styles, /grid-auto-flow:\s*row dense/);
  assert.match(styles, /\.sizeCompact\s*\{\s*grid-column:\s*span 4/);
  assert.match(dashboard, /draggable=\{editing\}/);
  assert.match(dashboard, /onDragStart=\{\(event\) => startWidgetDrag/);
  assert.match(dashboard, /onDrop=\{\(event\) => dropWidget/);
  assert.match(dashboard, /taskRecordLabel\(task\.id\)/);
});

test("employee lifecycle is selected explicitly instead of inferred", () => {
  const hr = read("../app/components/HrWorkspace.tsx");
  assert.match(hr, /lifecycleEmployeeId/);
  assert.match(hr, /ariaLabel="Сотрудник для просмотра жизненного цикла"/);
  assert.match(hr, /Сотрудник не выбирается автоматически/);
  assert.doesNotMatch(hr, /find\(x=>x\.id===data\.chain\.employeeId\)/);
});
