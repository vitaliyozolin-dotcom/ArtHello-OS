import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..", "..");
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");
const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);

const parsedManifest = JSON.parse(manifest);
assert.equal(typeof parsedManifest.project_id, "string", "hosting manifest must preserve project_id");

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(typeof workerModule.default?.fetch, "function", "Sites artifact must export default.fetch");

const response = await workerModule.default.fetch(new Request("https://control.example/"));
assert.equal(response.status, 200);
assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
assert.equal(response.headers.get("x-frame-options"), null);
assert.match(
  response.headers.get("content-security-policy") ?? "",
  /frame-ancestors 'self' https:\/\/chatgpt\.com https:\/\/\*\.chatgpt\.com/,
);
assert.match(await response.text(), /Что можно считать правдой сейчас/);

console.log("Sites artifact is valid, owner-control UI is present, and indexing is disabled");
