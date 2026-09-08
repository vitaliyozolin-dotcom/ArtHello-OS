import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const globalsPath = resolve(process.cwd(), "app/globals.css");
const shellPath = resolve(process.cwd(), "app/components/ShellFoundation.css");
const marker = "/* ARTHELLO_CSS_BUDGET_SHELL_SPLIT */";

const rules = [
  '.test-banner { min-height: 36px; flex: 0 0 36px; display: flex; align-items: center; gap: 12px; padding: 0 25px; background: #eef1cf; color: #536035; font-size: 14px; }',
  '.test-banner strong { padding: 4px 8px; border-radius: 999px; background: var(--lime); color: var(--green); font-size: 14px; letter-spacing: .06em; }',
  '.test-banner button { margin-left: auto; border: 0; border-bottom: 1px solid currentColor; padding: 2px 0; background: transparent; color: var(--green); cursor: pointer; font-size: 14px; }',
];

let globals = readFileSync(globalsPath, "utf8");
let shell = readFileSync(shellPath, "utf8");

for (const rule of rules) {
  const first = globals.indexOf(rule);
  if (first === -1) throw new Error(`CSS budget split: expected global rule is missing: ${rule.slice(0, 48)}`);
  if (globals.indexOf(rule, first + rule.length) !== -1) throw new Error(`CSS budget split: duplicate global rule found: ${rule.slice(0, 48)}`);
  globals = globals.replace(rule, "");
}

if (!shell.includes(marker)) {
  shell = `${shell.trimEnd()}\n\n${marker}\n${rules.join("\n")}\n`;
} else {
  for (const rule of rules) {
    if (!shell.includes(rule)) throw new Error("CSS budget split: marker exists but transferred rule is missing");
  }
}

// Test fixtures contain CSS-like tokens; they must not generate production
// utility rules. Application sources remain in Tailwind's automatic detection.
const excludedTestSource = '@source not "../tests";';
if (!globals.includes(excludedTestSource)) {
  const tailwindImport = '@import "tailwindcss";';
  if (globals.split(tailwindImport).length !== 2) throw new Error("Tailwind import anchor missing or ambiguous");
  globals = globals.replace(tailwindImport, `${tailwindImport}\n${excludedTestSource}`);
}

writeFileSync(globalsPath, globals);
writeFileSync(shellPath, shell);
console.log("CSS budget shell split applied: test banner styles moved out of the global chunk");
