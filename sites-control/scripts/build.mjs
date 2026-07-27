import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const controlRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(controlRoot, "..");
const distRoot = resolve(projectRoot, "dist");

const [htmlSource, css, javascript, hostingSource, workerTemplate] =
  await Promise.all([
    readFile(resolve(controlRoot, "index.html"), "utf8"),
    readFile(resolve(controlRoot, "styles.css"), "utf8"),
    readFile(resolve(controlRoot, "main.js"), "utf8"),
    readFile(resolve(projectRoot, ".openai/hosting.json"), "utf8"),
    readFile(resolve(controlRoot, "server/worker.template.js"), "utf8"),
  ]);

JSON.parse(hostingSource);

const page = htmlSource
  .replace(
    '<link rel="stylesheet" href="/styles.css" />',
    `<style>${css}</style>`,
  )
  .replace(
    '<script type="module" src="/main.js"></script>',
    `<script type="module">${javascript}</script>`,
  );

const worker = workerTemplate.replace(
  "__ARTHELLO_PAGE__",
  JSON.stringify(page),
);
if (worker.includes("__ARTHELLO_PAGE__")) {
  throw new Error("Worker page placeholder was not replaced exactly once");
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(resolve(distRoot, "server"), { recursive: true });
await mkdir(resolve(distRoot, ".openai"), { recursive: true });
await Promise.all([
  writeFile(resolve(distRoot, "server/index.js"), worker, "utf8"),
  writeFile(resolve(distRoot, ".openai/hosting.json"), hostingSource, "utf8"),
  cp(
    resolve(projectRoot, ".openai/drizzle"),
    resolve(distRoot, ".openai/drizzle"),
    { recursive: true },
  ),
]);

console.log(`Built owner-only Sites control artifact at ${distRoot}`);
