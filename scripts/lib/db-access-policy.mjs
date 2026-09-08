import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist"]);

export const LEGACY_POOL_QUERY_BASELINE = Object.freeze({
  "artifacts/api-server/src/lib/security/access-audit.ts": 1,
  "artifacts/api-server/src/lib/security/auth-store.ts": 15,
  "artifacts/api-server/src/routes/audit.ts": 14,
  "artifacts/api-server/src/routes/educational-module.ts": 15,
  "artifacts/api-server/src/routes/employees-module.ts": 16,
  "artifacts/api-server/src/routes/evotor.ts": 8,
  "artifacts/api-server/src/routes/front-office-smsvizitka.ts": 3,
  "artifacts/api-server/src/routes/people-access.ts": 3,
});

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

export function findDbAccessViolations(
  root,
  baseline = LEGACY_POOL_QUERY_BASELINE,
) {
  const violations = [];
  const actualPoolQueries = new Map();
  for (const path of sourceFiles(root)) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    const source = readFileSync(path, "utf8");
    if (!relativePath.includes("/src/")) continue;

    const poolQueryCount = source.match(/\bpool\.query\b/g)?.length ?? 0;
    actualPoolQueries.set(relativePath, poolQueryCount);
    const allowedCount = baseline[relativePath] ?? 0;
    if (poolQueryCount > allowedCount) {
      violations.push(
        `${relativePath}: pool.query ${poolQueryCount} > ${allowedCount}`,
      );
    }

    if (
      !relativePath.startsWith("scripts/") &&
      /(?:@electric-sql\/pglite|\bnew\s+PGlite\b)/.test(source)
    ) {
      violations.push(`${relativePath}: PGlite is restricted to scripts/`);
    }
  }
  for (const [relativePath, allowedCount] of Object.entries(baseline)) {
    const actualCount = actualPoolQueries.get(relativePath) ?? 0;
    if (actualCount < allowedCount) {
      violations.push(
        `${relativePath}: baseline ${allowedCount} > actual ${actualCount}`,
      );
    }
  }
  return violations.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const violations = findDbAccessViolations(root);
  if (violations.length) {
    console.error(`Database access policy failed:\n${violations.join("\n")}`);
    process.exit(1);
  }
  console.log(
    `Database access policy: no new pool.query usage; ${Object.keys(LEGACY_POOL_QUERY_BASELINE).length} legacy files ratcheted; PGlite confined to scripts/.`,
  );
}
