import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const buildScript = resolve(import.meta.dirname, "../scripts/build.mjs");
const stylesheetMarker = '<link rel="stylesheet" href="/styles.css" />';
const scriptMarker = '<script type="module" src="/main.js"></script>';

async function runFixtureBuild(html) {
  const projectRoot = await mkdtemp(resolve(tmpdir(), "arthello-sites-build-"));
  const controlRoot = resolve(projectRoot, "sites-control");

  await Promise.all([
    mkdir(resolve(controlRoot, "scripts"), { recursive: true }),
    mkdir(resolve(projectRoot, ".openai"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(buildScript, resolve(controlRoot, "scripts/build.mjs")),
    writeFile(resolve(controlRoot, "index.html"), html, "utf8"),
    writeFile(
      resolve(controlRoot, "styles.css"),
      "body { color: black; }",
      "utf8",
    ),
    writeFile(
      resolve(controlRoot, "main.js"),
      "document.body.dataset.ready = 'true';",
      "utf8",
    ),
    writeFile(resolve(projectRoot, ".openai/hosting.json"), "{}", "utf8"),
  ]);

  try {
    return spawnSync(
      process.execPath,
      [resolve(controlRoot, "scripts/build.mjs")],
      {
        cwd: projectRoot,
        encoding: "utf8",
      },
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("Sites build fails when the stylesheet marker is missing", async () => {
  const result = await runFixtureBuild(
    `<html><body>${scriptMarker}</body></html>`,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stylesheet marker/i);
});

test("Sites build fails when the script marker is missing", async () => {
  const result = await runFixtureBuild(
    `<html><head>${stylesheetMarker}</head><body></body></html>`,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /script marker/i);
});
