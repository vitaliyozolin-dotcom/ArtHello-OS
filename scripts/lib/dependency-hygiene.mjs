import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const RUNTIME_SPECIFIER =
  /(?:^|\n)\s*(?!import\s+type\b)(?:import(?:[\s\S]*?\sfrom\s*)?|export\s+(?!type\b)[\s\S]*?\sfrom\s*)["']([^"']+)["']/g;

function packageName(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return null;
  }
  if (specifier.startsWith("node:")) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (SOURCE_EXTENSION.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

export function findMisclassifiedRuntimeDependencies(packageDirectory) {
  const directory = packageDirectory instanceof URL
    ? fileURLToPath(packageDirectory)
    : packageDirectory;
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const runtimeDeclarations = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const developmentDeclarations = new Set(Object.keys(manifest.devDependencies ?? {}));
  const runtimeImports = new Set();

  for (const file of sourceFiles(join(directory, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(RUNTIME_SPECIFIER)) {
      const dependency = packageName(match[1]);
      if (dependency) runtimeImports.add(dependency);
    }
  }

  return [...runtimeImports]
    .filter(
      (dependency) =>
        developmentDeclarations.has(dependency) &&
        !runtimeDeclarations.has(dependency),
    )
    .sort();
}
