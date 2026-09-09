import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("small question markers are removed globally without disabling guided help", () => {
  const dashboard = read("../app/components/OwnerDashboard.tsx");
  const helpSystem = read("../app/components/ContextualHelpSystem.tsx");
  const helpDom = read("../app/components/contextualHelpDom.ts");
  const helpStyles = read("../app/components/ContextualHelpSystem.css");
  const helpBuildPatch = read("../scripts/patch-help-finance-ux-v3.mjs");

  assert.match(helpSystem, /className="ah-launch"/);
  assert.match(dashboard, /data-help-block="kpis"/);
  assert.doesNotMatch(`${helpSystem}\n${helpDom}\n${helpStyles}\n${helpBuildPatch}`, /data-ah-help-inline|fieldMarkers|ah-field-icon|content:"\?"/);
});
