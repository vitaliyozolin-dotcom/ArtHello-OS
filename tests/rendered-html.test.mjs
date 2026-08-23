import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function renderRoute(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the production school title", async () => {
  const response = await renderRoute();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), /<title>Школа 1–11<\/title>/i);
});

for (const pathname of [
  "/",
  "/calendar",
  "/schedule",
  "/programs",
  "/journal",
  "/homework",
  "/people",
  "/school",
  "/messages",
  "/management",
  "/profile",
]) {
  test(`direct route ${pathname} renders successfully`, async () => {
    const response = await renderRoute(pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(await response.text(), /<title>Школа 1–11<\/title>/i);
  });
}

test("visible prototype controls do not use alert-based fake actions", async () => {
  const source = await readFile(new URL("../app/school-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.alert\s*\(/);
  assert.doesNotMatch(source, /Демонстрационный выход/);
});
