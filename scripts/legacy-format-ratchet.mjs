import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const config = JSON.parse(
  readFileSync(
    new URL("../quality-gates/legacy-format-ratchet.json", import.meta.url),
    "utf8",
  ),
);
const repositoryRoot = new URL("../", import.meta.url);
const extensions = new Set([".css", ".ts", ".tsx"]);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : extensions.has(extname(entry.name))
        ? [path]
        : [];
  });
}

const actual = [];
for (const root of config.roots) {
  for (const path of files(fileURLToPath(new URL(root, repositoryRoot)))) {
    const source = readFileSync(path, "utf8");
    const options = (await resolveConfig(path)) ?? {};
    const formatted = await format(source, { ...options, filepath: path });
    if (source !== formatted)
      actual.push(relative(fileURLToPath(repositoryRoot), path));
  }
}
const allowed = new Set(config.allowedUnformattedFiles);
const regressions = actual.filter((path) => !allowed.has(path));
if (regressions.length > 0) {
  process.stderr.write(
    `Legacy formatting ratchet regressed:\n${regressions.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Legacy formatting ratchet: ${actual.length} known files, 0 regressions.\n`,
);
