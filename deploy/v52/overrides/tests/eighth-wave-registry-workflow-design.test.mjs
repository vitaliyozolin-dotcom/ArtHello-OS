import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const registry = read("../app/components/RegistryWorkspace.tsx");
const registryStyles = read("../app/components/RegistryWorkspace.ds.css");
const workflow = read("../app/components/WorkflowWorkspace.tsx");
const workflowStyles = read("../app/components/WorkflowWorkspace.ds.css");

const escapeRegExp = (value) => value.replace(/[.*+?^\$\{\}()|[\]\\]/g, "\\$&");

function importedNames(source, moduleName) {
  const match = source.match(new RegExp(`import\\s*\\{([^{}]*)\\}\\s*from\\s*["']${escapeRegExp(moduleName)}["']`));
  assert.ok(match, `named import from ${moduleName} is missing`);
  return new Set(match[1].split(",").map((name) => name.trim().split(/\\s+as\\s+/)[0]).filter(Boolean));
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function cssSelectors(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  let boundary = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === "{") {
      const prelude = clean.slice(boundary, index).trim();
      if (prelude && !prelude.startsWith("@")) {
        result.push(...prelude.split(",").map((selector) => selector.trim()).filter(Boolean));
      }
      boundary = index + 1;
    } else if (char === "}") {
      boundary = index + 1;
    }
  }
  return result.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector));
}

test("Wave 8 registry and workflow use the shared Design System shell", () => {
  for (const [name, source, className, stylesheet] of [
    ["RegistryWorkspace", registry, "ahRegistryPage", "RegistryWorkspace.ds.css"],
    ["WorkflowWorkspace", workflow, "ahWorkflowPage", "WorkflowWorkspace.ds.css"],
  ]) {
    const names = importedNames(source, "./design-system");
    for (const component of ["Button", "Card", "EmptyState", "KpiCard", "PageContainer", "PageHeader", "SearchField", "Tabs"]) {
      assert.ok(names.has(component), `${name} must import ${component}`);
    }
    assert.match(source, new RegExp(`import\\s*["']\\./${escapeRegExp(stylesheet)}["']`));
    assert.match(source, new RegExp(`<PageContainer\\b[^>]*className=["']${className}["']`));
    assert.equal(occurrences(source, /<KpiCard\b/g), 4);
    assert.equal(occurrences(source, /<Tabs\b/g), 1);
    assert.equal(occurrences(source, /<SearchField\b/g), 1);
  }
});

test("Wave 8 keeps the registry filters, honest states and entity operations", () => {
  assert.match(registry, /fetch\s*\(\s*`\/api\/entities\?\$\{params\}`/);
  for (const endpoint of ["/api/entity-detail", "/api/entity-relations", "/api/entity-documents", "/api/entity-merge"]) {
    assert.match(registry, new RegExp(escapeRegExp(endpoint)));
  }
  for (const action of ["create", "edit", "relation", "document", "merge"]) {
    assert.match(registry, new RegExp(`["']${action}["']`));
  }
  for (const field of ["entityType", "displayName", "scope", "dataQuality", "status", "toEntityId", "relationType", "documentType", "duplicateId", "reason"]) {
    assert.match(registry, new RegExp(`name=["']${field}["']`));
  }
  for (const state of ["Карточки не найдены", "Реестр временно недоступен", "Загружаем реестр"]) {
    assert.match(registry, new RegExp(escapeRegExp(state)));
  }
  assert.match(registry, /createPortal\s*\(/);
});

test("Wave 8 keeps all workflow views, reads and mutations", () => {
  for (const tab of ["Моя очередь", "Доска процесса", "Уведомления", "Документы"]) {
    assert.match(workflow, new RegExp(escapeRegExp(tab)));
  }
  for (const endpoint of ["/api/work-items", "/api/notifications", "/api/task-actions", "/api/tasks", "/api/workflow-documents"]) {
    assert.match(workflow, new RegExp(escapeRegExp(endpoint)));
  }
  for (const action of ["checklist_toggle", "checklist_add", "watcher", "approval", "comment"]) {
    assert.match(workflow, new RegExp(`action:\\s*["']${action}["']`));
  }
  for (const field of ["title", "description", "assigneeEntityId", "dueDate", "kind", "priority", "recurrenceRule", "sourceType", "requiresApproval"]) {
    assert.match(workflow, new RegExp(`name=["']${field}["']`));
  }
  for (const state of ["Задач не найдено", "Процессы временно недоступны", "Загружаем процессы"]) {
    assert.match(workflow, new RegExp(escapeRegExp(state)));
  }
  assert.match(workflow, /import\s*\{\s*createPortal\s*\}\s*from\s*["\']react-dom["\']/);
  assert.equal(occurrences(workflow, /createPortal\s*\(/g), 3, "task detail and both workflow forms must be portaled");
  for (const className of ["ahWorkflowDialogLayer", "ahWorkflowDialog", "ahWorkflowModalLayer", "ahWorkflowModal"]) {
    assert.match(workflow, new RegExp(`className=["\'][^"\']*${className}`));
  }
});

test("Wave 8 is isolated from both legacy top-level shells", () => {
  for (const legacy of ['className="page registry-page"', "registry-heading", 'className="registry-kpis"', 'className="registry-type-strip"']) {
    assert.equal(registry.includes(legacy), false, `Registry still contains ${legacy}`);
  }
  for (const legacy of ['className="page workflow-page"', "workflow-heading", 'className="workflow-kpis"', 'className="workflow-viewbar"']) {
    assert.equal(workflow.includes(legacy), false, `Workflow still contains ${legacy}`);
  }

  for (const [styles, prefix] of [[registryStyles, ".ahRegistry"], [workflowStyles, ".ahWorkflow"]]) {
    assert.doesNotMatch(styles, /!important/i);
    assert.doesNotMatch(styles, /\[\s*class\s*[*^$]\s*=/i);
    assert.doesNotMatch(styles, /display\s*:\s*contents\b/i);
    assert.doesNotMatch(styles, /\bmargin(?:-[a-z-]+)?\s*:\s*-/i);
    const selectors = cssSelectors(styles);
    assert.ok(selectors.length > 0);
    for (const selector of selectors) assert.match(selector, new RegExp(`^${escapeRegExp(prefix)}`), `unscoped selector: ${selector}`);
    assert.match(styles, /var\(\s*--ah-registry-kpi-mobile-/);
    assert.match(styles, /overflow-x\s*:\s*auto/);
  }
});

test("Wave 8 keeps mobile tables inside contained cards", () => {
  for (const styles of [registryStyles, workflowStyles]) {
    assert.match(styles, /@media\s*\(max-width:\s*720px\)/);
    assert.match(styles, /tbody\s+tr\s*\{[\s\S]*?display\s*:\s*grid/);
    assert.match(styles, /overflow-x\s*:\s*visible/);
  }
});

test("Wave 8 production UI contains no fixed acceptance claims", () => {
  const sources = `${registry}\n${workflow}`;
  assert.doesNotMatch(sources, /CHAIN STATUS\s*·\s*PASS|ГОТОВО К ИТОГОВОЙ ПРОВЕРКЕ|SYNTHETIC TEST/i);
});
