import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const assets = resolve(import.meta.dirname, "../dist/client/assets");
const files = readdirSync(assets);

test("initial ArtHello shell stays below the client JavaScript budget", () => {
  const file = files.find((name) => name.startsWith("ArtHelloShell-") && name.endsWith(".js"));
  assert.ok(file, "ArtHelloShell client chunk is missing");
  assert.ok(statSync(resolve(assets, file)).size <= 100_000, `${file} exceeds the 100 kB uncompressed budget`);
});

test("global visual system stays below the CSS budget", () => {
  const file = files.find((name) => name.startsWith("index-") && name.endsWith(".css"));
  assert.ok(file, "global CSS bundle is missing");
  assert.ok(statSync(resolve(assets, file)).size <= 250_000, `${file} exceeds the 250 kB uncompressed budget`);
});
