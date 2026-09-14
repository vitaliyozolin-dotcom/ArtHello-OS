#!/usr/bin/env node
// D184 keeps the D183 runtime/route transformation and changes only image provenance.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ATLAS_ORIGIN_KEY = "ATLAS_PUBLIC_ORIGIN";
const ATLAS_SECRET_FILE_KEY = "ATLAS_CENTRAL_ACCESS_SECRET_FILE";
const ATLAS_SECRET_FILE = "/run/secrets/atlas-central-access-secret";
const FORBIDDEN_PLAINTEXT_KEYS = new Set([
  "ARTHELLO_BOOTSTRAP_PASSWORD",
  "ATLAS_CENTRAL_ACCESS_SECRET",
  "CENTRAL_ACCESS_SECRET",
  "INTEGRATION_CREDENTIALS_KEY",
  "OPENAI_API_KEY",
  "PASSWORDLESS_PEPPER",
]);

function assertAtlasOrigin(atlasOrigin) {
  let parsed;
  try {
    parsed = new URL(atlasOrigin);
  } catch {
    throw new Error("Atlas origin must be HTTPS");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== atlasOrigin ||
    parsed.pathname !== "/"
  ) {
    throw new Error("Atlas origin must be HTTPS");
  }
}

export function normalizeRuntimeEnv(raw, atlasOrigin) {
  assertAtlasOrigin(atlasOrigin);
  const retained = [];
  const seen = new Set();
  for (const sourceLine of raw.split(/\n/)) {
    const line = sourceLine.endsWith("\r")
      ? sourceLine.slice(0, -1)
      : sourceLine;
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("malformed runtime variable");
    const key = line.slice(0, separator);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key))
      throw new Error(`invalid runtime variable: ${key}`);
    if (seen.has(key)) throw new Error(`duplicate runtime variable: ${key}`);
    seen.add(key);
    if (FORBIDDEN_PLAINTEXT_KEYS.has(key)) {
      throw new Error("plaintext secret environment is not permitted");
    }
    if (key !== ATLAS_ORIGIN_KEY && key !== ATLAS_SECRET_FILE_KEY)
      retained.push(line);
  }
  retained.push(`${ATLAS_ORIGIN_KEY}=${atlasOrigin}`);
  retained.push(`${ATLAS_SECRET_FILE_KEY}=${ATLAS_SECRET_FILE}`);
  return `${retained.join("\n")}\n`;
}

function assertUpstream(value) {
  if (!/^arthello-direct-[1-9][0-9]*-[1-9][0-9]*$/.test(value)) {
    throw new Error(`invalid ArtHello upstream: ${value}`);
  }
}

export function renderCentralRoute(raw, oldUpstream, newUpstream) {
  assertUpstream(oldUpstream);
  assertUpstream(newUpstream);
  if (oldUpstream === newUpstream)
    throw new Error("central upstreams must differ");
  const oldTarget = `${oldUpstream}:8081`;
  const newTarget = `${newUpstream}:8081`;
  const oldCount = raw.split(oldTarget).length - 1;
  if (oldCount < 2)
    throw new Error("expected at least two exact central upstream references");
  if (raw.includes(newTarget))
    throw new Error("new central upstream already exists");
  const active = new Set(
    raw.match(/arthello-direct-[1-9][0-9]*-[1-9][0-9]*:8081/g) ?? [],
  );
  if (active.size !== 1 || !active.has(oldTarget))
    throw new Error("ambiguous active central upstream");
  const rendered = raw.replaceAll(oldTarget, newTarget);
  if (rendered.includes(oldTarget))
    throw new Error("old central upstream remained after rendering");
  if (rendered.split(newTarget).length - 1 !== oldCount)
    throw new Error("central route replacement count changed");
  return rendered;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) throw new Error(`missing ${name}`);
  return args[index + 1];
}

function main(args) {
  const [command, ...options] = args;
  const input = option(options, "--input");
  const output = option(options, "--output");
  const raw = readFileSync(input, "utf8");
  if (command === "env") {
    writeFileSync(
      output,
      normalizeRuntimeEnv(raw, option(options, "--atlas-origin")),
      { mode: 0o600 },
    );
    return;
  }
  if (command === "route") {
    writeFileSync(
      output,
      renderCentralRoute(
        raw,
        option(options, "--old-upstream"),
        option(options, "--new-upstream"),
      ),
      { mode: 0o600 },
    );
    return;
  }
  throw new Error("expected env or route command");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
