import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

const methods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

export function normalizePath(path) {
  return path
    .replace(/:([A-Za-z0-9_]+)/g, "{param}")
    .replace(/\{[^}]+\}/g, "{param}");
}

export function collectExpressRoutes(stack, result = []) {
  for (const layer of stack ?? []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        result.push(
          `${method.toUpperCase()} ${normalizePath(String(layer.route.path))}`,
        );
      }
    } else if (layer.handle?.stack) {
      collectExpressRoutes(layer.handle.stack, result);
    }
  }
  return [...new Set(result)].sort();
}

export function collectOpenApiRoutes(document) {
  const result = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      if (methods.has(method))
        result.push(`${method.toUpperCase()} ${normalizePath(path)}`);
    }
  }
  return [...new Set(result)].sort();
}

export function compareContracts(runtime, spec, inventory) {
  const runtimeSet = new Set(runtime);
  const specSet = new Set(spec);
  const inventorySet = new Set(inventory.map(({ route }) => route));
  return {
    unexplainedRuntime: runtime.filter(
      (route) => !specSet.has(route) && !inventorySet.has(route),
    ),
    staleSpec: spec.filter((route) => !runtimeSet.has(route)),
    staleInventory: [...inventorySet].filter(
      (route) => !runtimeSet.has(route) || specSet.has(route),
    ),
  };
}

async function main() {
  const [{ default: app }, specSource, inventorySource] = await Promise.all([
    import("../artifacts/api-server/src/app.ts"),
    readFile(new URL("../lib/api-spec/openapi.yaml", import.meta.url), "utf8"),
    readFile(
      new URL("../quality-gates/contract-server-only.json", import.meta.url),
      "utf8",
    ),
  ]);
  const runtime = collectExpressRoutes(app.router?.stack);
  const spec = collectOpenApiRoutes(YAML.parse(specSource));

  if (process.argv.includes("--refresh-inventory")) {
    const entries = runtime
      .filter((route) => !spec.includes(route))
      .map((route) => ({ route, disposition: "document-in-openapi" }));
    await writeFile(
      new URL("../quality-gates/contract-server-only.json", import.meta.url),
      `${JSON.stringify({ schema_version: 1, entries }, null, 2)}\n`,
    );
    return;
  }

  const inventory = JSON.parse(inventorySource).entries ?? [];
  const drift = compareContracts(runtime, spec, inventory);
  const report = {
    runtime: runtime.length,
    openapi: spec.length,
    inventory: inventory.length,
    ...drift,
  };
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0) {
    await writeFile(
      process.argv[reportIndex + 1],
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(drift).some((items) => items.length > 0))
    process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
