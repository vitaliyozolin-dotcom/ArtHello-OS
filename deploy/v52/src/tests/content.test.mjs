import assert from "node:assert/strict";
import test from "node:test";
import { contentSummary, evidenceBasedRanking, publicationRates } from "../lib/content.ts";
import { readFile } from "node:fs/promises";

test("content rates preserve the full funnel", () => {
  const rates = publicationRates({ id: "P1", reach: 1000, views: 800, reactions: 100, clicks: 40, leads: 4, contracts: 1, revenueMinor: 4600000 });
  assert.deepEqual(rates, { engagementPercent: 10, clickPercent: 5, leadPercent: 10, contractPercent: 25 });
});

test("content summary includes business outcomes", () => {
  const summary = contentSummary([
    { id: "P1", reach: 100, views: 90, reactions: 10, clicks: 5, leads: 1, contracts: 1, revenueMinor: 4600000 },
    { id: "P2", reach: 200, views: 180, reactions: 20, clicks: 10, leads: 2, contracts: 0, revenueMinor: 0 },
  ]);
  assert.equal(summary.views, 270);
  assert.equal(summary.revenueMinor, 4600000);
});

test("revenue outranks vanity reach", () => {
  const ranked = evidenceBasedRanking([
    { id: "viral", reach: 100000, views: 90000, reactions: 9000, clicks: 10, leads: 0, contracts: 0, revenueMinor: 0 },
    { id: "business", reach: 1000, views: 900, reactions: 50, clicks: 40, leads: 4, contracts: 1, revenueMinor: 4600000 },
  ]);
  assert.equal(ranked[0].id, "business");
});

test("content workspace exposes all-channel analytics, best formats and selectable AI providers", async () => {
  const [workspace, shell, route] = await Promise.all([
    readFile(new URL("../app/components/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ArtHelloShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/content-generate/route.ts", import.meta.url), "utf8"),
  ]);
  for (const label of ["Статистика каналов", "Посты и короткие видео", "Оценка деятельности", "Google Gemini", "Recraft"]) assert.match(workspace, new RegExp(label));
  assert.doesNotMatch(shell, /<ContentWorkspace sourceOnly/);
  assert.match(route, /provider !== "openai"/);
});
