import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const controlRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(controlRoot, "..");
const distRoot = resolve(projectRoot, "dist");

const [htmlSource, css, javascript, hostingSource] = await Promise.all([
  readFile(resolve(controlRoot, "index.html"), "utf8"),
  readFile(resolve(controlRoot, "styles.css"), "utf8"),
  readFile(resolve(controlRoot, "main.js"), "utf8"),
  readFile(resolve(projectRoot, ".openai/hosting.json"), "utf8"),
]);

JSON.parse(hostingSource);

const page = htmlSource
  .replace('<link rel="stylesheet" href="/styles.css" />', `<style>${css}</style>`)
  .replace('<script type="module" src="/main.js"></script>', `<script type="module">${javascript}</script>`);

const worker = `const page = ${JSON.stringify(page)};

const securityHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
};

export default {
  async fetch(request, env, ctx) {
    void env;
    void ctx;
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json(
        { status: "ok", surface: "arthello-os-control", dataMode: "sanitized-audit" },
        { headers: { "cache-control": "no-store", "x-robots-tag": securityHeaders["x-robots-tag"] } },
      );
    }

    if (url.pathname !== "/") {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": securityHeaders["x-robots-tag"] },
      });
    }

    return new Response(page, { headers: securityHeaders });
  },
};
`;

await rm(distRoot, { recursive: true, force: true });
await mkdir(resolve(distRoot, "server"), { recursive: true });
await mkdir(resolve(distRoot, ".openai"), { recursive: true });
await Promise.all([
  writeFile(resolve(distRoot, "server/index.js"), worker, "utf8"),
  writeFile(resolve(distRoot, ".openai/hosting.json"), hostingSource, "utf8"),
]);

console.log(`Built sanitized Sites control artifact at ${distRoot}`);
