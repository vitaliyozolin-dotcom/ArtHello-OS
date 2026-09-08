import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SPECIFIER =
  /((?:import|export)(?:\s+type)?[\s\S]*?from\s*["']|import\(\s*["'])(\.{1,2}\/[^"']+)(["'])/g;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : SOURCE_EXTENSIONS.has(extname(entry.name))
        ? [path]
        : [];
  });
}

export function normalizeNodeRelativeImports(directory) {
  const changed = [];
  for (const path of sourceFiles(directory)) {
    const before = readFileSync(path, "utf8");
    const after = before.replace(
      SPECIFIER,
      (whole, prefix, specifier, quote) =>
        /\.(?:js|json|node)$/.test(specifier)
          ? whole
          : `${prefix}${specifier}.js${quote}`,
    );
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(path);
    }
  }
  return changed;
}
