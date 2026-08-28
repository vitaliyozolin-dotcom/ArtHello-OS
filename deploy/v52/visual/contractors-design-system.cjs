const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const fs = require("node:fs");
const path = require("node:path");

const baselineUrl = process.env.BASELINE_URL;
const pilotUrl = process.env.PILOT_URL;
const tempPassword = process.env.TEMP_PASSWORD;
const permanentPassword = process.env.PERMANENT_PASSWORD;
const output = process.env.VISUAL_OUTPUT || "/screens";
const viewports = [[375, 812], [390, 844], [430, 932], [768, 1024], [1440, 900], [2560, 1440]];
const disableMotion = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}";
const manifest = [];

function persist() {
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
}

async function visible(locator) {
  try { return await locator.isVisible(); } catch { return false; }
}

async function establishAuth(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('input[name="login"]').waitFor({ state: "visible", timeout: 30000 });
  await page.locator('input[name="login"]').fill("owner");
  await page.locator('input[name="password"]').fill(tempPassword);
  await page.locator("form button").click();

  await page.waitForFunction(() => {
    const shown = (element) => Boolean(element && element.getClientRects().length);
    return shown(document.querySelector('input[name="currentPassword"]')) || !shown(document.querySelector('input[name="login"]'));
  }, null, { timeout: 30000 });

  if (await visible(page.locator('input[name="currentPassword"]'))) {
    await page.locator('input[name="currentPassword"]').fill(tempPassword);
    await page.locator('input[name="newPassword"]').fill(permanentPassword);
    await page.locator('input[name="confirmation"]').fill(permanentPassword);
    await page.locator("form button").click();
    await page.waitForFunction(() => {
      const current = document.querySelector('input[name="currentPassword"]');
      return !current || !current.getClientRects().length;
    }, null, { timeout: 30000 });

    if (await visible(page.locator('input[name="login"]'))) {
      await page.locator('input[name="login"]').fill("owner");
      await page.locator('input[name="password"]').fill(permanentPassword);
      await page.locator("form button").click();
    }
  }

  await page.waitForFunction(() => {
    const shown = (element) => Boolean(element && element.getClientRects().length);
    return !shown(document.querySelector('input[name="login"]')) && !shown(document.querySelector('input[name="currentPassword"]'));
  }, null, { timeout: 30000 });
  await page.goto(`${base}/#contractors`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Подрядчики", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

async function stablePage(browser, base, storageState, viewport, route) {
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, storageState });
  const page = await context.newPage();
  await page.goto(`${base}/#${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.addStyleTag({ content: disableMotion });
  await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  return { context, page };
}

async function captureContractors(browser, base, storageState, label, viewport) {
  const { context, page } = await stablePage(browser, base, storageState, viewport, "contractors");
  await page.getByRole("heading", { name: "Подрядчики", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  const fileBase = `${label}-contractors-${viewport[0]}x${viewport[1]}`;
  await page.screenshot({ path: path.join(output, `${fileBase}-full.png`), fullPage: true });
  await page.screenshot({ path: path.join(output, `${fileBase}-viewport.png`), fullPage: false });
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const pageElement = document.querySelector(".ahContractorPage");
    const header = document.querySelector(".ahContractorPage .ahPageHeader");
    const title = header?.querySelector("h1");
    const eyebrow = header?.querySelector("small");
    const action = header?.querySelector(".ahButton");
    const source = document.querySelector(".ahContractorSource");
    const sourceLabel = source?.querySelector("strong");
    const sourceBody = source?.querySelector("span");
    const kpiGrid = document.querySelector(".ahContractorKpis");
    const kpis = [...document.querySelectorAll(".ahContractorKpis > .ahKpiCard")];
    const firstKpi = kpis[0];
    const kpiLabel = firstKpi?.querySelector("small");
    const kpiValue = firstKpi?.querySelector("strong");
    const kpiNote = firstKpi?.querySelector(".ahKpiCopy > span");
    const search = document.querySelector(".ahContractorToolbar .ahSearchField input");
    const pageBox = pageElement?.getBoundingClientRect();
    const sourceBox = source?.getBoundingClientRect();
    const searchIcon = document.querySelector(".ahContractorToolbar .ahSearchIcon svg")?.getBoundingClientRect();
    const emptyTitle = document.querySelector(".ahContractorRegistry .ahEmptyState h3");
    const emptyText = document.querySelector(".ahContractorRegistry .ahEmptyState p");
    const mobileList = document.querySelector(".ahContractorMobileList");
    const table = document.querySelector(".ahContractorTableWrap");
    const kpiColumns = kpiGrid ? getComputedStyle(kpiGrid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    const style = (element) => element ? getComputedStyle(element) : null;
    const pageStyle = style(pageElement);
    const actionStyle = style(action);
    const sourceStyle = style(source);
    const kpiGridStyle = style(kpiGrid);
    const kpiStyle = style(firstKpi);
    const searchStyle = style(search);
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
      pageLeft: pageBox?.left ?? null,
      pageRight: pageBox?.right ?? null,
      sourceLeft: sourceBox?.left ?? null,
      sourceRight: sourceBox?.right ?? null,
      kpiCount: kpis.length,
      kpiColumns,
      pageDisplay: pageStyle?.display ?? null,
      pagePaddingLeft: pageStyle?.paddingLeft ?? null,
      pageGap: pageStyle?.rowGap ?? null,
      titleFontSize: style(title)?.fontSize ?? null,
      eyebrowFontSize: style(eyebrow)?.fontSize ?? null,
      actionMinHeight: actionStyle?.minHeight ?? null,
      actionRadius: actionStyle?.borderRadius ?? null,
      actionFontSize: actionStyle?.fontSize ?? null,
      sourceRadius: sourceStyle?.borderRadius ?? null,
      sourcePaddingTop: sourceStyle?.paddingTop ?? null,
      sourcePaddingLeft: sourceStyle?.paddingLeft ?? null,
      sourceLabelFontSize: style(sourceLabel)?.fontSize ?? null,
      sourceBodyFontSize: style(sourceBody)?.fontSize ?? null,
      kpiGap: kpiGridStyle?.rowGap ?? null,
      kpiMinHeight: kpiStyle?.minHeight ?? null,
      kpiRadius: kpiStyle?.borderRadius ?? null,
      kpiPaddingTop: kpiStyle?.paddingTop ?? null,
      kpiPaddingLeft: kpiStyle?.paddingLeft ?? null,
      kpiLabelFontSize: style(kpiLabel)?.fontSize ?? null,
      kpiValueFontSize: style(kpiValue)?.fontSize ?? null,
      kpiNoteFontSize: style(kpiNote)?.fontSize ?? null,
      searchHeight: searchStyle?.height ?? null,
      searchRadius: searchStyle?.borderRadius ?? null,
      searchPaddingLeft: searchStyle?.paddingLeft ?? null,
      searchFontSize: searchStyle?.fontSize ?? null,
      searchIconWidth: searchIcon?.width ?? 0,
      searchIconHeight: searchIcon?.height ?? 0,
      emptyTitleBorder: emptyTitle ? getComputedStyle(emptyTitle).borderWidth : null,
      emptyTextBorder: emptyText ? getComputedStyle(emptyText).borderWidth : null,
      mobileListDisplay: mobileList ? getComputedStyle(mobileList).display : null,
      tableDisplay: table ? getComputedStyle(table).display : null,
      designSystem: Boolean(document.querySelector(".ahContractorPage")),
    };
  });
  await context.close();
  return { label, route: "contractors", width: viewport[0], height: viewport[1], ...metrics };
}

async function captureAccessReference(browser, base, storageState, viewport) {
  const { context, page } = await stablePage(browser, base, storageState, viewport, "access");
  await page.getByRole("heading", { name: "Доступы", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  const file = `pilot-access-reference-${viewport[0]}x${viewport[1]}.png`;
  await page.screenshot({ path: path.join(output, file), fullPage: false });
  const metrics = await page.evaluate(() => {
    const title = [...document.querySelectorAll("h1")].find((element) => element.textContent?.trim() === "Доступы");
    const workspace = title?.closest("section");
    const header = title?.closest("header");
    const eyebrow = header?.querySelector("p");
    const action = header?.querySelector("button");
    const boundary = [...(workspace?.children ?? [])].find((element) => element.querySelector(":scope > span")?.textContent?.trim() === "Рабочий контур доступа");
    const boundaryLabel = boundary?.querySelector(":scope > span");
    const boundaryBody = boundary?.querySelector(":scope > p");
    const metric = [...(workspace?.querySelectorAll("button") ?? [])].find((button) => button.querySelector(":scope > span")?.textContent?.trim() === "Активные" && button.querySelector(":scope > strong"));
    const kpiGrid = metric?.parentElement;
    const kpiLabel = metric?.querySelector(":scope > span");
    const kpiValue = metric?.querySelector(":scope > strong");
    const kpiNote = metric?.querySelector(":scope > small");
    const search = workspace?.querySelector('input[placeholder="Найти по имени, роли или контакту"]');
    const style = (element) => element ? getComputedStyle(element) : null;
    const workspaceStyle = style(workspace);
    const actionStyle = style(action);
    const boundaryStyle = style(boundary);
    const kpiGridStyle = style(kpiGrid);
    const kpiStyle = style(metric);
    const searchStyle = style(search);
    return {
      pageDisplay: workspaceStyle?.display ?? null,
      pagePaddingLeft: workspaceStyle?.paddingLeft ?? null,
      pageGap: workspaceStyle?.rowGap ?? null,
      titleFontSize: style(title)?.fontSize ?? null,
      eyebrowFontSize: style(eyebrow)?.fontSize ?? null,
      actionMinHeight: actionStyle?.minHeight ?? null,
      actionRadius: actionStyle?.borderRadius ?? null,
      actionFontSize: actionStyle?.fontSize ?? null,
      sourceRadius: boundaryStyle?.borderRadius ?? null,
      sourcePaddingTop: boundaryStyle?.paddingTop ?? null,
      sourcePaddingLeft: boundaryStyle?.paddingLeft ?? null,
      sourceLabelFontSize: style(boundaryLabel)?.fontSize ?? null,
      sourceBodyFontSize: style(boundaryBody)?.fontSize ?? null,
      kpiGap: kpiGridStyle?.rowGap ?? null,
      kpiMinHeight: kpiStyle?.minHeight ?? null,
      kpiRadius: kpiStyle?.borderRadius ?? null,
      kpiPaddingTop: kpiStyle?.paddingTop ?? null,
      kpiPaddingLeft: kpiStyle?.paddingLeft ?? null,
      kpiLabelFontSize: style(kpiLabel)?.fontSize ?? null,
      kpiValueFontSize: style(kpiValue)?.fontSize ?? null,
      kpiNoteFontSize: style(kpiNote)?.fontSize ?? null,
      searchHeight: searchStyle?.height ?? null,
      searchRadius: searchStyle?.borderRadius ?? null,
      searchPaddingLeft: searchStyle?.paddingLeft ?? null,
      searchFontSize: searchStyle?.fontSize ?? null,
    };
  });
  await context.close();
  return { label: "pilot", route: "access-reference", width: viewport[0], height: viewport[1], file, ...metrics };
}

function assertSameMobileCanon(contractors, access) {
  const keys = [
    "pageDisplay", "pagePaddingLeft", "pageGap", "titleFontSize", "eyebrowFontSize",
    "actionMinHeight", "actionRadius", "actionFontSize",
    "sourceRadius", "sourcePaddingTop", "sourcePaddingLeft", "sourceLabelFontSize", "sourceBodyFontSize",
    "kpiGap", "kpiMinHeight", "kpiRadius", "kpiPaddingTop", "kpiPaddingLeft",
    "kpiLabelFontSize", "kpiValueFontSize", "kpiNoteFontSize",
    "searchHeight", "searchRadius", "searchPaddingLeft", "searchFontSize",
  ];
  for (const key of keys) {
    if (contractors[key] !== access[key]) throw new Error(`Mobile Access canon mismatch for ${key}: contractors=${contractors[key]} access=${access[key]}`);
  }
}

async function captureEducationAfterContractors(browser, base, storageState, label, viewport) {
  const { context, page } = await stablePage(browser, base, storageState, viewport, "contractors");
  await page.getByRole("heading", { name: "Подрядчики", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await page.goto(`${base}/#education`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.addStyleTag({ content: disableMotion });
  await page.getByRole("heading", { name: "Обучение", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1000);
  const file = `${label}-education-after-contractors-${viewport[0]}x${viewport[1]}.png`;
  await page.screenshot({ path: path.join(output, file), fullPage: false });
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  await context.close();
  return { label, route: "education-after-contractors", width: viewport[0], height: viewport[1], file, ...metrics };
}

function diffPng(aPath, bPath, outPath, pixelmatch) {
  const a = PNG.sync.read(fs.readFileSync(aPath));
  const b = PNG.sync.read(fs.readFileSync(bPath));
  if (a.width !== b.width || a.height !== b.height) throw new Error(`PNG dimensions differ: ${aPath} vs ${bPath}`);
  const diff = new PNG({ width: a.width, height: a.height });
  const pixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12, includeAA: false });
  fs.writeFileSync(outPath, PNG.sync.write(diff));
  return { pixels, ratio: pixels / (a.width * a.height), width: a.width, height: a.height };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const pixelmatch = (await import("pixelmatch")).default;
  const browser = await chromium.launch({ headless: true });
  try {
    const baselineState = await establishAuth(browser, baselineUrl);
    const pilotState = await establishAuth(browser, pilotUrl);
    const pilotContractors = new Map();

    for (const viewport of viewports) {
      manifest.push(await captureContractors(browser, baselineUrl, baselineState, "baseline", viewport));
      const pilot = await captureContractors(browser, pilotUrl, pilotState, "pilot", viewport);
      manifest.push(pilot);
      pilotContractors.set(viewport.join("x"), pilot);
      persist();

      if (pilot.horizontalOverflow) throw new Error(`Pilot horizontal overflow at ${viewport.join("x")}`);
      if (!pilot.designSystem || pilot.kpiCount !== 4) throw new Error(`Pilot Design System structure missing at ${viewport.join("x")}`);
      const expectedColumns = viewport[0] <= 1024 ? 2 : 4;
      if (pilot.kpiColumns !== expectedColumns) throw new Error(`Pilot KPI columns ${pilot.kpiColumns}, expected ${expectedColumns} at ${viewport.join("x")}`);
      if (pilot.searchIconWidth !== 0 || pilot.searchIconHeight !== 0) throw new Error(`Pilot contractor search icon must be absent at ${viewport.join("x")}`);
      if (pilot.emptyTitleBorder !== "0px" || pilot.emptyTextBorder !== "0px") throw new Error(`Pilot empty-state text has a border at ${viewport.join("x")}`);
      if (pilot.pageLeft < -1 || pilot.pageRight > pilot.clientWidth + 1 || pilot.sourceLeft < -1 || pilot.sourceRight > pilot.clientWidth + 1) throw new Error(`Pilot content exceeds viewport at ${viewport.join("x")}`);
    }

    for (const viewport of [[390, 844], [1440, 900]]) {
      const access = await captureAccessReference(browser, pilotUrl, pilotState, viewport);
      manifest.push(access);
      if (viewport[0] <= 720) assertSameMobileCanon(pilotContractors.get(viewport.join("x")), access);
      persist();
    }

    for (const viewport of [[390, 844], [1440, 900]]) {
      const baseline = await captureEducationAfterContractors(browser, baselineUrl, baselineState, "baseline", viewport);
      const pilot = await captureEducationAfterContractors(browser, pilotUrl, pilotState, "pilot", viewport);
      manifest.push(baseline, pilot);
      if (baseline.horizontalOverflow || pilot.horizontalOverflow) throw new Error(`Education overflow at ${viewport.join("x")}`);
      const baselinePath = path.join(output, baseline.file);
      const pilotPath = path.join(output, pilot.file);
      const diffPath = path.join(output, `diff-education-after-contractors-${viewport[0]}x${viewport[1]}.png`);
      const diff = diffPng(baselinePath, pilotPath, diffPath, pixelmatch);
      manifest.push({ route: "education-diff", width: viewport[0], height: viewport[1], file: path.basename(diffPath), ...diff });
      persist();
      if (diff.ratio > 0.03) throw new Error(`Unrelated Education visual diff ${(diff.ratio * 100).toFixed(2)}% exceeds 3% at ${viewport.join("x")}`);
    }
  } finally {
    await browser.close();
    persist();
  }
})().catch((error) => { console.error(error); process.exit(1); });
