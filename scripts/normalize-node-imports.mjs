import { resolve } from "node:path";
import { normalizeNodeRelativeImports } from "./lib/import-extension-policy.mjs";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  throw new Error("Pass one or more source roots to normalize");
}

for (const root of roots) {
  for (const path of normalizeNodeRelativeImports(resolve(root))) {
    process.stdout.write(`${path}\n`);
  }
}
