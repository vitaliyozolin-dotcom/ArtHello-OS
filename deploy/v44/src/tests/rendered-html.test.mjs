import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the ArtHello OS identity and removes the operational demo banner", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../app/components/ArtHelloShell.tsx", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../data/test-snapshot.ts", import.meta.url), "utf8");
  assert.match(layout, /title:\s*["']ArtHello OS["']/);
  assert.match(layout, /<html lang=["']ru["']/);
  assert.match(shell, /Выбрать филиал/);
  assert.match(shell, /SettingsWorkspace/);
  assert.doesNotMatch(shell, /<div className=\{`test-banner/);
  assert.match(snapshot, /Персональные данные не перенесены/);
  assert.doesNotMatch(`${layout}\n${shell}\n${snapshot}`, /Starter Project|codex-preview/);
});
