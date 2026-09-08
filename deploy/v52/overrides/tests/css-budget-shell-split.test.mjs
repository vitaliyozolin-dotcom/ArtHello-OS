import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = process.cwd();
const globals = readFileSync(resolve(root, "app/globals.css"), "utf8");
const shell = readFileSync(resolve(root, "app/components/ShellFoundation.css"), "utf8");

test("shell-only banner base rules leave global CSS without changing the visual rule set", () => {
  assert.doesNotMatch(globals, /\.test-banner \{ min-height: 36px;/);
  assert.doesNotMatch(globals, /\.test-banner strong \{ padding: 4px 8px;/);
  assert.doesNotMatch(globals, /\.test-banner button \{ margin-left: auto;/);
  assert.match(shell, /ARTHELLO_CSS_BUDGET_SHELL_SPLIT/);
  assert.match(shell, /\.test-banner \{ min-height: 36px;/);
  assert.match(shell, /\.test-banner strong \{ padding: 4px 8px;/);
  assert.match(shell, /\.test-banner button \{ margin-left: auto;/);
});


test("production Tailwind scanning excludes test fixtures while retaining app sources", () => {
  assert.match(globals, /@source not "\.\.\/tests";/);
  assert.match(globals, /@import "tailwindcss";/);
  assert.doesNotMatch(globals, /@source not "\.\.\/app";/);
});
