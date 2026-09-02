import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  INLINE_HELP_SUPPRESSION_SELECTOR,
  inlineHelpAllowed,
} from "../app/components/contextualHelpPolicy.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("inline help is suppressed inside an explicitly clean dashboard zone", () => {
  const selectors = [];
  const dashboardField = {
    closest(selector) {
      selectors.push(selector);
      return { dataset: { ahInlineHelp: "off" } };
    },
  };
  const regularFormField = { closest: () => null };

  assert.equal(inlineHelpAllowed(dashboardField), false);
  assert.equal(inlineHelpAllowed(regularFormField), true);
  assert.deepEqual(selectors, [INLINE_HELP_SUPPRESSION_SELECTOR]);
});

test("the main dashboard opts out of small markers without disabling guided help", () => {
  const dashboard = read("../app/components/OwnerDashboard.tsx");
  const helpSystem = read("../app/components/ContextualHelpSystem.tsx");

  assert.match(dashboard, /owner-home-dashboard[^>]+data-ah-inline-help="off"/);
  assert.match(helpSystem, /if \(!inlineHelpAllowed\(field\.element\)\) return \[\];/);
  assert.match(helpSystem, /className="ah-launch"/);
  assert.match(dashboard, /data-help-block="kpis"/);
});
