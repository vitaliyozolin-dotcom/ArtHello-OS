import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const tokens = read("../app/components/design-system/tokens.css");
const components = read("../app/components/design-system/index.tsx");
const styles = read("../app/components/design-system/design-system.css");
const contractor = read("../app/components/ContractorWorkspace.tsx");
const contractorStyles = read("../app/components/ContractorWorkspace.ds.css");
const access = read("../app/components/AccessWorkspace.tsx");
const owner = read("../app/components/OwnerDashboard.tsx");
const sales = read("../app/components/SalesWorkspace.tsx");
const education = read("../app/components/EducationWorkspace.tsx");
const system = read("../app/components/SystemWorkspace.tsx");
const workflow = read("../app/components/WorkflowWorkspace.tsx");
const settings = read("../app/components/SettingsWorkspace.tsx");
const content = read("../app/components/ContentWorkspace.tsx");
const legal = read("../app/components/LegalWorkspace.tsx");
const accounting = read("../app/components/AccountingWorkspace.tsx");
const shell = read("../app/components/ArtHelloShell.tsx");
const mobilePolish = read("../app/components/SystemWideMobilePolish.css");
const foundationPatch = read("../scripts/patch-system-foundation.mjs");

test("compact card typography is a machine-readable Design System role", () => {
  assert.match(tokens, /--ah-compact-card-title-size:12px/);
  assert.match(tokens, /--ah-compact-card-title-line:15px/);
  assert.match(tokens, /--ah-compact-card-body-size:10px/);
  assert.match(tokens, /--ah-compact-card-body-line:14px/);
  assert.match(tokens, /--ah-compact-card-index-size:9px/);
  assert.match(tokens, /--ah-compact-card-index-line:12px/);
  assert.match(styles, /\[data-ah-compact-card\]/);
  assert.doesNotMatch(styles, /!important/);
  assert.doesNotMatch(styles, /\[class\*=/);
});

test("shared compact cards and compact empty states expose explicit semantics", () => {
  assert.match(components, /export function CompactListCard/);
  assert.match(components, /data-ah-compact-index/);
  assert.match(components, /density\?: "default" \| "compact"/);
  assert.match(components, /data-ah-compact-card=\{density === "compact"/);
  assert.match(components, /designSystemVersion = "1\.2-operational-registry"/);
  assert.equal((access.match(/<CompactListCard/g) ?? []).length, 3);
  assert.match(contractor, /<EmptyState\s+density="compact"\s+title="Подрядчиков пока нет"/);
  assert.match(contractorStyles, /\.ahContractorRegistry > \.ahEmptyState h3 \{\s+font-size: var\(--ah-compact-card-title-size\)/);
  assert.match(contractorStyles, /\.ahContractorRegistry > \.ahEmptyState p \{\s+font-size: var\(--ah-compact-card-body-size\)/);
});

test("audited compact list and embedded-empty roles use the shared semantic marker", () => {
  for (const [name, source] of Object.entries({ access, owner, sales, education, system, workflow, settings, content, shell, contractor, legal, accounting })) {
    assert.match(source, /data-ah-compact-card|density="compact"|<CompactListCard/, `${name} has no compact-card adoption`);
  }
  assert.match(mobilePolish, /\.manual-module-empty[\s\S]*--ah-compact-card-title-size/);
  assert.match(mobilePolish, /\.modal-explanation \{[\s\S]*font-size: 14px/);
});

test("legacy blanket typography cannot override semantic compact roles", () => {
  assert.match(foundationPatch, /design-system\/tokens\.css/);
  assert.match(foundationPatch, /design-system\/design-system\.css/);
  assert.match(foundationPatch, /:not\(\[data-ah-compact-card\], \[data-ah-compact-card\] \*\)/);
  assert.match(foundationPatch, /font-size:14px!important;line-height:1\.45/);
  assert.match(foundationPatch, /font-size:14px!important;line-height:1\.4/);
  assert.match(foundationPatch, /font-size:15px!important/);
});
