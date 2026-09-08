import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const generatedApi = resolve(
  import.meta.dirname,
  "../lib/api-zod/src/generated/api.ts",
);
const zodSpecifier = ["zo", "d"].join("");
const rootImport = `import * as zod from '${zodSpecifier}';`;
const v4Import = `import * as zod from '${zodSpecifier}/v4';`;
const source = readFileSync(generatedApi, "utf8");
const occurrences = source.split(rootImport).length - 1;

if (occurrences !== 1 || source.includes(v4Import)) {
  throw new Error(
    `Expected exactly one generated root Zod import and no existing v4 import; found root=${occurrences}, v4=${source.includes(v4Import)}`,
  );
}

writeFileSync(generatedApi, source.replace(rootImport, v4Import));
