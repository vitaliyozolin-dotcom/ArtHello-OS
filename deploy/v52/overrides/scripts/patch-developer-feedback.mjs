import { readFile, writeFile } from 'node:fs/promises';

const root = (process.env.ARTHELLO_PATCH_ROOT || '/app').replace(/\/$/, '');
async function replaceOnce(path, before, after) {
  const source = await readFile(`${root}/${path}`, 'utf8');
  if (source.split(after).length === 2) return;
  if (source.split(before).length !== 2) throw new Error(`Developer feedback patch anchor missing or duplicated: ${path}`);
  await writeFile(`${root}/${path}`, source.replace(before, after));
}
await replaceOnce('lib/access-policy.ts',
  'export const API_RULES: readonly ApiRule[] = [',
  'export const API_RULES: readonly ApiRule[] = [\n  // Every authenticated user may submit/view their own reports; the handler alone grants canonical-owner triage.\n  { prefix: "/api/developer-feedback", read: allRoles, write: allRoles },');
await replaceOnce('app/components/ArtHelloShell.tsx',
  'import { AppIcon } from "./AppIcon";',
  'import { AppIcon } from "./AppIcon";\nimport { DeveloperFeedback } from "./DeveloperFeedback";');
await replaceOnce('app/components/ArtHelloShell.tsx',
  '      </main>',
  '      </main>\n      <DeveloperFeedback moduleId={routedActive} />');
await replaceOnce('db/schema.ts',
  'import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";',
  'import { index, integer, sqliteTable, text, uniqueIndex, index as feedbackIndex, check as feedbackCheck } from "drizzle-orm/sqlite-core";');
const schemaPath = `${root}/db/schema.ts`;
const schema = await readFile(schemaPath, 'utf8');
const addition = await readFile(`${root}/db/developer-feedback-schema.txt`, 'utf8');
if (!schema.includes(addition)) {
  if (schema.includes('export const developerFeedback')) throw new Error('Conflicting developer feedback schema');
  await writeFile(schemaPath, schema + '\n' + addition);
}
console.log('Developer feedback shell and authenticated API policy installed');
