const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const baselineUpstream = process.env.BASELINE_UPSTREAM;
const pilotUpstream = process.env.PILOT_UPSTREAM;
const baselineUrl = "http://localhost:18081";
const pilotUrl = "http://localhost:18082";
const tempPassword = process.env.TEMP_PASSWORD;
const permanentPassword = process.env.PERMANENT_PASSWORD;
const output = process.env.VISUAL_OUTPUT || "/screens";
const viewports = [[375, 812], [390, 844], [430, 932], [768, 1024], [1440, 900], [2560, 1440]];
const disableMotion = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}";
const manifest = [];
const expectedPngCount = 88;

const waveRoutes = {
  legal: {
    heading: "Юридический контур",
    root: ".ahLegalPage",
    legacy: ".legal-workspace",
    endpoint: /\/api\/legal(?:\?.*)?$/,
    kpis: ".ahLegalKpis > .ahKpiCard",
    kpiGrid: ".ahLegalKpis",
    tabs: ".ahLegalTabs .ahTabs",
    table: ".ahLegalRegistryTable",
    empty: ".ahLegalPage .ahEmptyState",
    modal: ".ahLegalCreateModal",
    modalTrigger: /^\+\s*Договор$/,
    modalFields: ["partyName", "partyType", "contractType", "number", "validFrom", "validUntil", "limitRubles", "signedStatus", "closingRequired"],
  },
  accounting: {
    heading: "Бухгалтерия и первичка",
    root: ".ahAccountingPage",
    legacy: ".accounting-workspace",
    endpoint: /\/api\/accounting(?:\?.*)?$/,
    kpis: ".ahAccountingKpis > .ahKpiCard",
    kpiGrid: ".ahAccountingKpis",
    tabs: ".ahAccountingTabs .ahTabs",
    table: ".ahAccountingTable",
    empty: ".ahAccountingPage .ahEmptyState",
    modal: ".ahAccountingModal",
    modalTrigger: /^\+\s*(?:Добавить|Принять) документ$/,
    modalFields: ["documentType", "number", "documentDate", "amountRub", "counterpartyEntityId", "contractId"],
  },
};

const emptyLegal = {
  contracts: [], documents: [], zones: [], checks: [], entityNames: {}, tasks: [],
  summary: { contracts: 0, unsigned: 0, expiring: 0, openSignals: 0, missingRequired: 0 },
  chain: { partyId: "", contractId: "", documentId: "", appendixId: "", actId: "", zoneId: "", signalId: "" },
  boundary: "Пустой реестр не скрывает юридические процессы и не подменяется демонстрационными договорами.",
};

const populatedLegal = {
  contracts: [{
    id: "LCON-VISUAL-001", referenceDocumentId: "DOG-VISUAL-001", contractType: "Договор подряда", partyType: "Подрядчик",
    partyEntityId: "ENT-VISUAL-LEGAL-001", number: "VIS-01/26", signedStatus: "Не подписан", validFrom: "2026-08-01",
    validUntil: "2026-09-30", limitMinor: 24000000, spentMinor: 12300000, status: "На проверке",
    electronicSignatureStatus: "ЭП не подключена", requisiteStatus: "Требуют проверки", ownerEntityId: "ENT-VISUAL-OWNER",
    closingRequired: true, utilization: 51,
  }],
  documents: [{
    id: "LGLDOC-VISUAL-001-V1", stableId: "LGLDOC-VISUAL-001", contractId: "LCON-VISUAL-001", itemType: "Договор",
    title: "Договор подряда № VIS-01/26", version: 1, required: true, signedStatus: "Не подписан", status: "На проверке",
    dueDate: "2026-09-30", reference: "Синтетический visual fixture",
  }],
  zones: [{ id: "LZONE-VISUAL-001", contractId: "LCON-VISUAL-001", zone: "Приёмка работ", responsibleEntityId: "ENT-VISUAL-OWNER", scope: "Результат, акт и срок", status: "Активна" }],
  checks: [{
    id: "LSIG-VISUAL-001", contractId: "LCON-VISUAL-001", signalType: "Нет закрывающего документа", severity: "Средняя",
    evidence: "Для визуальной проверки отсутствует синтетический акт.", recommendation: "Сверить комплектность", status: "Открыт",
    relatedTaskId: null, resolution: "",
  }],
  entityNames: { "ENT-VISUAL-LEGAL-001": "Синтетический подрядчик", "ENT-VISUAL-OWNER": "Владелец visual fixture" },
  tasks: [],
  summary: { contracts: 1, unsigned: 1, expiring: 1, openSignals: 1, missingRequired: 1 },
  chain: { partyId: "ENT-VISUAL-LEGAL-001", contractId: "LCON-VISUAL-001", documentId: "LGLDOC-VISUAL-001", appendixId: "APP-VISUAL-001", actId: "ACT-VISUAL-001", zoneId: "LZONE-VISUAL-001", signalId: "LSIG-VISUAL-001" },
  boundary: "Только синтетические записи visual gate; рабочие данные не используются.",
};

const emptyAccounting = {
  documents: [], links: [], checks: [], exports: [], integrations: [], entityNames: {}, counterparties: [], operations: {},
  summary: { documents: 0, linked: 0, unsigned: 0, incomplete: 0, totalMinor: 0 }, chain: {},
  boundary: "Пустой реестр не создаёт документы, оплаты или выгрузки автоматически.",
};

const populatedAccounting = {
  documents: [{
    id: "ADOC-VISUAL-001", documentType: "Счёт", number: "VIS-ACC-01", documentDate: "2026-08-27",
    counterpartyEntityId: "ENT-VISUAL-ACC-001", contractId: "LCON-VISUAL-001", amountMinor: 12300000, vatMinor: 0,
    paymentOperationId: "OP-VISUAL-001", fileRef: "visual://invoice", signatureStatus: "На проверке", edoStatus: "Не подключён",
    sourceType: "MANUAL", status: "На проверке",
  }],
  links: [{ id: "ALINK-VISUAL-001", fromDocumentId: "ADOC-VISUAL-001", toDocumentId: "OP-VISUAL-001", relationType: "Основание оплаты", evidence: "Синтетический visual fixture" }],
  checks: [{
    id: "ACHECK-VISUAL-001", operationId: "OP-VISUAL-001", contractId: "LCON-VISUAL-001", requiredTypes: ["Счёт", "Акт"],
    missingTypes: ["Акт"], ownerEntityId: "ENT-VISUAL-OWNER", status: "Не комплектно", relatedTaskId: null,
    checkedAt: "2026-08-28T09:00:00.000Z",
  }],
  exports: [{ id: "AEXP-VISUAL-001", exportType: "Реестр первички", period: "2026-08", documentCount: 1, amountMinor: 12300000, status: "Подготовлен", fileRef: "visual://export", createdBy: "visual-gate", createdAt: "2026-08-28T09:00:00.000Z" }],
  integrations: [{ id: "AINT-VISUAL-001", system: "1С", mode: "Ручная выгрузка", status: "Не подключена", truth: "Передача не выполняется", lastSuccessAt: "", nextAttemptAt: "", recordCount: 0, error: "" }],
  entityNames: { "ENT-VISUAL-ACC-001": "Синтетический контрагент", "ENT-VISUAL-OWNER": "Владелец visual fixture" },
  counterparties: [{ id: "ENT-VISUAL-ACC-001", displayName: "Синтетический контрагент", entityType: "Контрагент" }],
  operations: { "OP-VISUAL-001": { amountMinor: 12300000, counterpartyEntityId: "ENT-VISUAL-ACC-001", operationDate: "2026-08-28", sourceSystem: "VISUAL_FIXTURE" } },
  summary: { documents: 1, linked: 1, unsigned: 1, incomplete: 1, totalMinor: 12300000 },
  chain: { invoiceId: "ADOC-VISUAL-001", actId: "ACT-VISUAL-001", contractId: "LCON-VISUAL-001", paymentId: "OP-VISUAL-001" },
  boundary: "Только синтетические записи visual gate; рабочие данные не используются.",
};

const waveFixtures = {
  legal: { empty: emptyLegal, populated: populatedLegal },
  accounting: { empty: emptyAccounting, populated: populatedAccounting },
};

function persist() {
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function startLoopbackProxy(upstream, port) {
  const upstreamUrl = new URL(upstream);
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const target = new URL(request.url || "/", upstreamUrl);
      const headers = { ...request.headers, host: upstreamUrl.host };
      delete headers.connection;
      const forwarded = http.request(target, { method: request.method, headers }, (received) => {
        response.writeHead(received.statusCode || 502, received.headers);
        received.pipe(response);
      });
      forwarded.on("error", (error) => {
        if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`Visual proxy error: ${error.message}`);
      });
      request.pipe(forwarded);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function visible(locator) {
  try { return await locator.isVisible(); } catch { return false; }
}

async function establishAuth(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('input[name="login"]').waitFor({ state: "visible", timeout: 30000 });
  await page.locator('input[name="login"]').fill("owner");
  await page.locator('input[name="password"]').fill(tempPassword);
  await page.locator("form button").click();

  const firstLogin = await page.waitForFunction(() => {
    const shown = (element) => Boolean(element && element.getClientRects().length);
    const error = document.querySelector(".auth-error");
    if (shown(error) && error.textContent?.trim()) return { state: "error", message: error.textContent.trim() };
    if (shown(document.querySelector('input[name="currentPassword"]'))) return { state: "password-change" };
    if (!shown(document.querySelector('input[name="login"]'))) return { state: "authenticated" };
    return null;
  }, null, { timeout: 30000 });
  const firstLoginResult = await firstLogin.jsonValue();
  if (firstLoginResult.state === "error") throw new Error(`Initial authentication failed: ${firstLoginResult.message}`);

  if (await visible(page.locator('input[name="currentPassword"]'))) {
    await page.locator('input[name="currentPassword"]').fill(tempPassword);
    await page.locator('input[name="newPassword"]').fill(permanentPassword);
    await page.locator('input[name="confirmation"]').fill(permanentPassword);
    await page.locator("form button").click();
    const passwordChange = await page.waitForFunction(() => {
      const shown = (element) => Boolean(element && element.getClientRects().length);
      const error = document.querySelector(".auth-error");
      if (shown(error) && error.textContent?.trim()) return { state: "error", message: error.textContent.trim() };
      const current = document.querySelector('input[name="currentPassword"]');
      if (!shown(current)) return { state: "complete" };
      return null;
    }, null, { timeout: 30000 });
    const passwordChangeResult = await passwordChange.jsonValue();
    if (passwordChangeResult.state === "error") throw new Error(`Password change failed: ${passwordChangeResult.message}`);

    if (await visible(page.locator('input[name="login"]'))) {
      await page.locator('input[name="login"]').fill("owner");
      await page.locator('input[name="password"]').fill(permanentPassword);
      await page.locator("form button").click();
    }
  }

  const finalLogin = await page.waitForFunction(() => {
    const shown = (element) => Boolean(element && element.getClientRects().length);
    const error = document.querySelector(".auth-error");
    if (shown(error) && error.textContent?.trim()) return { state: "error", message: error.textContent.trim() };
    if (!shown(document.querySelector('input[name="login"]')) && !shown(document.querySelector('input[name="currentPassword"]'))) {
      return { state: "authenticated" };
    }
    return null;
  }, null, { timeout: 30000 });
  const finalLoginResult = await finalLogin.jsonValue();
  if (finalLoginResult.state === "error") throw new Error(`Final authentication failed: ${finalLoginResult.message}`);
  await page.goto(`${base}/#contractors`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Подрядчики", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

async function stablePage(browser, base, storageState, viewport, route, apiFixture) {
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, storageState, serviceWorkers: "block" });
  if (apiFixture) {
    await context.route(apiFixture.endpoint, async (requestRoute) => {
      await requestRoute.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(apiFixture.payload),
      });
    });
  }
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
    const description = header?.querySelector(".ahPageHeaderCopy > p");
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
    const registry = document.querySelector(".ahContractorRegistry");
    const toolbar = document.querySelector(".ahContractorToolbar");
    const search = document.querySelector(".ahContractorToolbar .ahSearchField input");
    const count = document.querySelector(".ahContractorCount");
    const pageBox = pageElement?.getBoundingClientRect();
    const sourceBox = source?.getBoundingClientRect();
    const registryBox = registry?.getBoundingClientRect();
    const toolbarBox = toolbar?.getBoundingClientRect();
    const searchIcon = document.querySelector(".ahContractorToolbar .ahSearchIcon svg")?.getBoundingClientRect();
    const emptyState = document.querySelector(".ahContractorRegistry .ahEmptyState");
    const emptyBox = emptyState?.getBoundingClientRect();
    const emptyTitle = emptyState?.querySelector("h3");
    const emptyText = emptyState?.querySelector("p");
    const emptyAction = emptyState?.querySelector(".ahButton");
    const mobileList = document.querySelector(".ahContractorMobileList");
    const table = document.querySelector(".ahContractorTableWrap");
    const kpiColumns = kpiGrid ? getComputedStyle(kpiGrid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    const style = (element) => element ? getComputedStyle(element) : null;
    const pageStyle = style(pageElement);
    const actionStyle = style(action);
    const sourceStyle = style(source);
    const kpiGridStyle = style(kpiGrid);
    const kpiStyle = style(firstKpi);
    const registryStyle = style(registry);
    const toolbarStyle = style(toolbar);
    const searchStyle = style(search);
    const countStyle = style(count);
    const emptyStyle = style(emptyState);
    const emptyTitleStyle = style(emptyTitle);
    const emptyTextStyle = style(emptyText);
    const emptyActionStyle = style(emptyAction);
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
      descriptionFontSize: style(description)?.fontSize ?? null,
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
      registryHeight: registryBox?.height ?? null,
      registryRadius: registryStyle?.borderRadius ?? null,
      toolbarHeight: toolbarBox?.height ?? null,
      toolbarGap: toolbarStyle?.rowGap ?? null,
      toolbarPaddingTop: toolbarStyle?.paddingTop ?? null,
      toolbarPaddingLeft: toolbarStyle?.paddingLeft ?? null,
      searchHeight: searchStyle?.height ?? null,
      searchRadius: searchStyle?.borderRadius ?? null,
      searchPaddingLeft: searchStyle?.paddingLeft ?? null,
      searchFontSize: searchStyle?.fontSize ?? null,
      countFontSize: countStyle?.fontSize ?? null,
      countLineHeight: countStyle?.lineHeight ?? null,
      searchIconWidth: searchIcon?.width ?? 0,
      searchIconHeight: searchIcon?.height ?? 0,
      emptyHeight: emptyBox?.height ?? null,
      emptyGap: emptyStyle?.rowGap ?? null,
      emptyMinHeight: emptyStyle?.minHeight ?? null,
      emptyPaddingTop: emptyStyle?.paddingTop ?? null,
      emptyPaddingLeft: emptyStyle?.paddingLeft ?? null,
      emptyTitleFontSize: emptyTitleStyle?.fontSize ?? null,
      emptyTitleLineHeight: emptyTitleStyle?.lineHeight ?? null,
      emptyTextFontSize: emptyTextStyle?.fontSize ?? null,
      emptyTextLineHeight: emptyTextStyle?.lineHeight ?? null,
      emptyActionMinHeight: emptyActionStyle?.minHeight ?? null,
      emptyActionRadius: emptyActionStyle?.borderRadius ?? null,
      emptyActionPaddingLeft: emptyActionStyle?.paddingLeft ?? null,
      emptyActionFontSize: emptyActionStyle?.fontSize ?? null,
      emptyTitleBorder: emptyTitleStyle?.borderWidth ?? null,
      emptyTextBorder: emptyTextStyle?.borderWidth ?? null,
      mobileListDisplay: mobileList ? getComputedStyle(mobileList).display : null,
      tableDisplay: table ? getComputedStyle(table).display : null,
      legacyContractorScope: Boolean(pageElement?.closest(".contractor-workspace")),
      designSystem: Boolean(document.querySelector(".ahContractorPage")),
    };
  });
  await context.close();
  return { label, route: "contractors", width: viewport[0], height: viewport[1], ...metrics };
}

async function verifyWaveModal(page, config) {
  const trigger = page.getByRole("button", { name: config.modalTrigger }).first();
  if (await trigger.count() !== 1) throw new Error(`${config.heading}: create action is missing or ambiguous`);
  await trigger.click();
  const modal = page.locator(config.modal).first();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  for (const field of config.modalFields) {
    const input = modal.locator(`[name="${field}"]`).first();
    if (await input.count() !== 1 || !await input.isVisible()) throw new Error(`${config.heading}: modal field ${field} is not visible`);
  }
  const cancel = page.getByRole("button", { name: "Отмена", exact: true }).last();
  if (await cancel.count()) await cancel.click();
  else await page.getByRole("button", { name: "Закрыть форму", exact: true }).click();
  await modal.waitFor({ state: "hidden", timeout: 10000 });
  return true;
}

async function verifyWaveTabs(page, config) {
  const tabs = page.locator(config.tabs).getByRole("tab");
  const count = await tabs.count();
  if (count !== 5) throw new Error(`${config.heading}: ${count} tabs, expected 5`);
  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);
    await tab.click();
    await page.waitForFunction(({ selector, selectedIndex }) => {
      const items = document.querySelectorAll(`${selector} [role="tab"]`);
      return items[selectedIndex]?.getAttribute("aria-selected") === "true";
    }, { selector: config.tabs, selectedIndex: index }, { timeout: 5000 });
  }
  await tabs.first().click();
  return true;
}

async function captureWaveRoute(browser, base, storageState, label, viewport, routeName, mode) {
  const config = waveRoutes[routeName];
  const apiFixture = { endpoint: config.endpoint, payload: waveFixtures[routeName][mode] };
  const { context, page } = await stablePage(browser, base, storageState, viewport, routeName, apiFixture);
  await page.getByRole("heading", { name: config.heading, exact: true }).waitFor({ state: "visible", timeout: 30000 });
  if (label === "pilot") {
    await page.locator(config.root).waitFor({ state: "visible", timeout: 30000 });
    if (mode === "empty") await page.locator(config.empty).first().waitFor({ state: "visible", timeout: 30000 });
    else await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 4, config.kpis, { timeout: 30000 });
  }
  const tabsVerified = label === "pilot" && mode === "empty" && viewport[0] === 390
    ? await verifyWaveTabs(page, config)
    : null;

  const fileBase = `${label}-${routeName}-${mode}-${viewport[0]}x${viewport[1]}`;
  const files = [`${fileBase}-full.png`];
  await page.screenshot({ path: path.join(output, files[0]), fullPage: true });
  if (mode === "empty") {
    files.push(`${fileBase}-viewport.png`);
    await page.screenshot({ path: path.join(output, files[1]), fullPage: false });
  }

  const metrics = await page.evaluate((selectors) => {
    const documentRoot = document.documentElement;
    const pageElement = document.querySelector(selectors.root);
    const header = pageElement?.querySelector(".ahPageHeader");
    const title = header?.querySelector("h1");
    const eyebrow = header?.querySelector(".ahPageHeaderCopy > small");
    const description = header?.querySelector(".ahPageHeaderCopy > p");
    const action = header?.querySelector(".ahPageHeaderActions .ahButton");
    const emptyState = pageElement?.querySelector(".ahEmptyState");
    const emptyTitle = emptyState?.querySelector("h3");
    const emptyText = emptyState?.querySelector("p");
    const kpiGrid = pageElement?.querySelector(selectors.kpiGrid);
    const kpis = [...(pageElement?.querySelectorAll(selectors.kpis) ?? [])];
    const firstKpi = kpis[0];
    const kpiLabel = firstKpi?.querySelector("small");
    const kpiValue = firstKpi?.querySelector("strong");
    const kpiNote = firstKpi?.querySelector(".ahKpiCopy > span");
    const tabs = pageElement?.querySelector(selectors.tabs);
    const table = pageElement?.querySelector(selectors.table);
    const tableRow = table?.querySelector("tbody tr, .ahLegalRegistryRow");
    const style = (element) => element ? getComputedStyle(element) : null;
    const box = (element) => element?.getBoundingClientRect();
    const pageBox = box(pageElement);
    const tabsBox = box(tabs);
    const tableBox = box(table);
    const pageStyle = style(pageElement);
    const actionStyle = style(action);
    const kpiGridStyle = style(kpiGrid);
    const kpiStyle = style(firstKpi);
    const tabsStyle = style(tabs);
    const tableStyle = style(table);
    return {
      clientWidth: documentRoot.clientWidth,
      scrollWidth: documentRoot.scrollWidth,
      horizontalOverflow: documentRoot.scrollWidth > documentRoot.clientWidth + 1,
      designSystem: Boolean(pageElement),
      legacyScope: Boolean(document.querySelector(selectors.legacy)),
      titleText: title?.textContent?.trim() ?? null,
      pageLeft: pageBox?.left ?? null,
      pageRight: pageBox?.right ?? null,
      pageDisplay: pageStyle?.display ?? null,
      pagePaddingLeft: pageStyle?.paddingLeft ?? null,
      pageGap: pageStyle?.rowGap ?? null,
      titleFontSize: style(title)?.fontSize ?? null,
      eyebrowFontSize: style(eyebrow)?.fontSize ?? null,
      descriptionFontSize: style(description)?.fontSize ?? null,
      actionMinHeight: actionStyle?.minHeight ?? null,
      actionRadius: actionStyle?.borderRadius ?? null,
      actionFontSize: actionStyle?.fontSize ?? null,
      emptyCount: pageElement?.querySelectorAll(".ahEmptyState").length ?? 0,
      emptyTitleFontSize: style(emptyTitle)?.fontSize ?? null,
      emptyTitleLineHeight: style(emptyTitle)?.lineHeight ?? null,
      emptyTitleFontWeight: style(emptyTitle)?.fontWeight ?? null,
      emptyTextFontSize: style(emptyText)?.fontSize ?? null,
      emptyTextLineHeight: style(emptyText)?.lineHeight ?? null,
      emptyTextFontWeight: style(emptyText)?.fontWeight ?? null,
      kpiCount: kpis.length,
      kpiColumns: kpiGridStyle ? kpiGridStyle.gridTemplateColumns.split(" ").filter(Boolean).length : 0,
      kpiMinHeight: kpiStyle?.minHeight ?? null,
      kpiRadius: kpiStyle?.borderRadius ?? null,
      kpiPaddingTop: kpiStyle?.paddingTop ?? null,
      kpiPaddingLeft: kpiStyle?.paddingLeft ?? null,
      kpiLabelFontSize: style(kpiLabel)?.fontSize ?? null,
      kpiValueFontSize: style(kpiValue)?.fontSize ?? null,
      kpiNoteFontSize: style(kpiNote)?.fontSize ?? null,
      tabsPresent: Boolean(tabs),
      tabsContained: Boolean(tabsBox && tabsBox.left >= -1 && tabsBox.right <= documentRoot.clientWidth + 1),
      tabsOverflowX: tabsStyle?.overflowX ?? null,
      tabsClientWidth: tabs?.clientWidth ?? null,
      tabsScrollWidth: tabs?.scrollWidth ?? null,
      tablePresent: Boolean(table),
      tableContained: Boolean(tableBox && tableBox.left >= -1 && tableBox.right <= documentRoot.clientWidth + 1),
      tableOverflowX: tableStyle?.overflowX ?? null,
      tableCardMode: style(tableRow)?.display === "grid",
      tableClientWidth: table?.clientWidth ?? null,
      tableScrollWidth: table?.scrollWidth ?? null,
    };
  }, {
    root: config.root,
    legacy: config.legacy,
    kpis: config.kpis,
    kpiGrid: config.kpiGrid,
    tabs: config.tabs,
    table: config.table,
  });

  const modalVerified = label === "pilot" && mode === "populated" ? await verifyWaveModal(page, config) : null;
  await context.close();
  return { label, route: routeName, mode, width: viewport[0], height: viewport[1], files, tabsVerified, modalVerified, ...metrics };
}

function assertWaveIdentity(metrics) {
  const config = waveRoutes[metrics.route];
  if (!metrics.designSystem || metrics.titleText !== config.heading) throw new Error(`${metrics.route}: exact Design System root/heading missing at ${metrics.width}x${metrics.height}`);
  if (metrics.legacyScope) throw new Error(`${metrics.route}: legacy wrapper is still active at ${metrics.width}x${metrics.height}`);
  if (metrics.horizontalOverflow || metrics.pageLeft < -1 || metrics.pageRight > metrics.clientWidth + 1) throw new Error(`${metrics.route}: content exceeds viewport at ${metrics.width}x${metrics.height}`);
  if (!metrics.tabsPresent || !metrics.tabsContained || !["auto", "scroll"].includes(metrics.tabsOverflowX)) throw new Error(`${metrics.route}: tabs are not contained in an internal scroll area at ${metrics.width}x${metrics.height}`);
}

function assertWaveEmptyTypography(metrics) {
  const expected = {
    emptyTitleFontSize: "12px",
    emptyTitleLineHeight: "15px",
    emptyTitleFontWeight: "500",
    emptyTextFontSize: "10px",
    emptyTextLineHeight: "14px",
    emptyTextFontWeight: "400",
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => metrics[key] !== value)
    .map(([key, value]) => `${key}: ${metrics[key]} expected=${value}`);
  if (!metrics.emptyCount || mismatches.length) throw new Error(`${metrics.route}: compact empty-state typography mismatch at ${metrics.width}x${metrics.height}\n${mismatches.join("\n")}`);
}

function assertWaveKpiGeometry(metrics) {
  const mobile = metrics.width <= 720;
  const expected = mobile ? {
    kpiMinHeight: "84px", kpiRadius: "13px", kpiPaddingTop: "11px", kpiPaddingLeft: "12px",
    kpiLabelFontSize: "11px", kpiValueFontSize: "26px", kpiNoteFontSize: "11px",
  } : {
    kpiMinHeight: "98px", kpiRadius: "16px", kpiPaddingTop: "16px", kpiPaddingLeft: "16px",
    kpiLabelFontSize: "13px", kpiValueFontSize: "24px", kpiNoteFontSize: "12px",
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => metrics[key] !== value)
    .map(([key, value]) => `${key}: ${metrics[key]} expected=${value}`);
  if (mismatches.length) throw new Error(`${metrics.route}: registry KPI token mismatch at ${metrics.width}x${metrics.height}\n${mismatches.join("\n")}`);
}

function assertWaveMobileHeaderGeometry(metrics) {
  if (metrics.width > 720) return;
  const expected = {
    pageGap: "16px",
    titleFontSize: "32px",
    eyebrowFontSize: "11px",
    descriptionFontSize: "15px",
    actionMinHeight: "44px",
    actionRadius: "11px",
    actionFontSize: "14px",
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => metrics[key] !== value)
    .map(([key, value]) => `${key}: ${metrics[key]} expected=${value}`);
  if (mismatches.length) throw new Error(`${metrics.route}: approved mobile PageHeader mismatch at ${metrics.width}x${metrics.height}\n${mismatches.join("\n")}`);
}

function assertWaveStructure(metrics) {
  assertWaveIdentity(metrics);
  if (metrics.kpiCount !== 4) throw new Error(`${metrics.route}: ${metrics.kpiCount} KPI cards, expected 4 at ${metrics.width}x${metrics.height}`);
  const expectedColumns = metrics.width <= 1024 ? 2 : 4;
  if (metrics.kpiColumns !== expectedColumns) throw new Error(`${metrics.route}: ${metrics.kpiColumns} KPI columns, expected ${expectedColumns} at ${metrics.width}x${metrics.height}`);
  assertWaveMobileHeaderGeometry(metrics);
  assertWaveKpiGeometry(metrics);
}

function assertWavePopulated(metrics) {
  assertWaveStructure(metrics);
  if (!metrics.tablePresent || !metrics.tableContained) throw new Error(`${metrics.route}: registry table is not contained at ${metrics.width}x${metrics.height}`);
  if (metrics.width <= 720) {
    if (!metrics.tableCardMode || metrics.tableOverflowX !== "visible") throw new Error(`${metrics.route}: mobile registry is not rendered as contained cards at ${metrics.width}x${metrics.height}`);
  } else if (!["auto", "scroll"].includes(metrics.tableOverflowX)) {
    throw new Error(`${metrics.route}: desktop registry lacks contained horizontal scrolling at ${metrics.width}x${metrics.height}`);
  }
  if (!metrics.modalVerified) throw new Error(`${metrics.route}: create modal contract did not pass at ${metrics.width}x${metrics.height}`);
}

function assertWaveMobileCanon(metrics, access) {
  const keys = [
    "pageDisplay", "pagePaddingLeft", "pageGap", "titleFontSize", "eyebrowFontSize", "descriptionFontSize",
    "actionMinHeight", "actionRadius", "actionFontSize",
  ];
  const mismatches = keys
    .filter((key) => metrics[key] !== access[key])
    .map((key) => `${key}: ${metrics.route}=${metrics[key]} access=${access[key]}`);
  if (mismatches.length) throw new Error(`${metrics.route}: mobile Access PageHeader canon mismatch\n${mismatches.join("\n")}`);
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
    const description = header?.querySelector("span");
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
    const compactCard = workspace?.querySelector("[data-ah-compact-card]");
    const compactIndex = compactCard?.querySelector("[data-ah-compact-index]");
    const compactTitle = compactCard?.querySelector("[data-ah-compact-title], strong");
    const compactBody = compactCard?.querySelector("[data-ah-compact-body], small");
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
      descriptionFontSize: style(description)?.fontSize ?? null,
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
      compactIndexFontSize: style(compactIndex)?.fontSize ?? null,
      compactTitleFontSize: style(compactTitle)?.fontSize ?? null,
      compactTitleLineHeight: style(compactTitle)?.lineHeight ?? null,
      compactBodyFontSize: style(compactBody)?.fontSize ?? null,
      compactBodyLineHeight: style(compactBody)?.lineHeight ?? null,
    };
  });
  await context.close();
  return { label: "pilot", route: "access-reference", width: viewport[0], height: viewport[1], file, ...metrics };
}

function assertSameMobileCanon(contractors, access) {
  const keys = [
    "pageDisplay", "pagePaddingLeft", "pageGap", "titleFontSize", "eyebrowFontSize", "descriptionFontSize",
    "actionMinHeight", "actionRadius", "actionFontSize",
    "sourceRadius", "sourcePaddingTop", "sourcePaddingLeft", "sourceLabelFontSize", "sourceBodyFontSize",
    "kpiGap",
  ];
  const mismatches = keys
    .filter((key) => contractors[key] !== access[key])
    .map((key) => `${key}: contractors=${contractors[key]} access=${access[key]}`);
  if (mismatches.length > 0) {
    throw new Error(`Mobile Access canon mismatches:\n${mismatches.join("\n")}`);
  }
}

function assertCompactCardTypography(contractors, access) {
  const expected = {
    compactIndexFontSize: "9px",
    compactTitleFontSize: "12px",
    compactTitleLineHeight: "15px",
    compactBodyFontSize: "10px",
    compactBodyLineHeight: "14px",
  };
  const accessMismatches = Object.entries(expected)
    .filter(([key, value]) => access[key] !== value)
    .map(([key, value]) => `${key}: access=${access[key]} expected=${value}`);
  const contractorExpected = {
    emptyTitleFontSize: "12px",
    emptyTitleLineHeight: "15px",
    emptyTextFontSize: "10px",
    emptyTextLineHeight: "14px",
  };
  const contractorMismatches = Object.entries(contractorExpected)
    .filter(([key, value]) => contractors[key] !== value)
    .map(([key, value]) => `${key}: contractors=${contractors[key]} expected=${value}`);
  const mismatches = [...accessMismatches, ...contractorMismatches];
  if (mismatches.length > 0) {
    throw new Error(`Compact card typography mismatches:\n${mismatches.join("\n")}`);
  }
}

function assertCompactMobileContractorKpis(contractors) {
  const expected = {
    kpiMinHeight: "84px",
    kpiRadius: "13px",
    kpiPaddingTop: "11px",
    kpiPaddingLeft: "12px",
    kpiLabelFontSize: "11px",
    kpiValueFontSize: "26px",
    kpiNoteFontSize: "11px",
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => contractors[key] !== value)
    .map(([key, value]) => `${key}: contractors=${contractors[key]} expected=${value}`);
  if (mismatches.length > 0) {
    throw new Error(`Compact mobile contractor KPI mismatches:\n${mismatches.join("\n")}`);
  }
}

function assertCompactMobileContractorRegistry(contractors) {
  const expected = {
    registryRadius: "14px",
    toolbarGap: "8px",
    toolbarPaddingTop: "11px",
    toolbarPaddingLeft: "11px",
    searchHeight: "40px",
    searchRadius: "9px",
    searchPaddingLeft: "11px",
    searchFontSize: "16px",
    countFontSize: "11px",
    countLineHeight: "14px",
    emptyGap: "10px",
    emptyMinHeight: "126px",
    emptyPaddingTop: "24px",
    emptyPaddingLeft: "16px",
    emptyTitleFontSize: "12px",
    emptyTitleLineHeight: "15px",
    emptyTextFontSize: "10px",
    emptyTextLineHeight: "14px",
    emptyActionMinHeight: "44px",
    emptyActionRadius: "13px",
    emptyActionPaddingLeft: "14px",
    emptyActionFontSize: "14px",
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => contractors[key] !== value)
    .map(([key, value]) => `${key}: contractors=${contractors[key]} expected=${value}`);
  if (mismatches.length > 0) {
    throw new Error(`Compact mobile contractor registry mismatches:\n${mismatches.join("\n")}`);
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
  if (!baselineUpstream || !pilotUpstream) throw new Error("Visual upstream URLs are required");
  fs.mkdirSync(output, { recursive: true });
  const pixelmatch = (await import("pixelmatch")).default;
  const proxies = await Promise.all([
    startLoopbackProxy(baselineUpstream, 18081),
    startLoopbackProxy(pilotUpstream, 18082),
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const baselineState = await establishAuth(browser, baselineUrl);
    const pilotState = await establishAuth(browser, pilotUrl);
    const pilotContractors = new Map();
    const pilotWaveEmpty = new Map();

    for (const viewport of viewports) {
      manifest.push(await captureContractors(browser, baselineUrl, baselineState, "baseline", viewport));
      const pilot = await captureContractors(browser, pilotUrl, pilotState, "pilot", viewport);
      manifest.push(pilot);
      pilotContractors.set(viewport.join("x"), pilot);
      persist();

      if (pilot.horizontalOverflow) throw new Error(`Pilot horizontal overflow at ${viewport.join("x")}`);
      if (!pilot.designSystem || pilot.kpiCount !== 4) throw new Error(`Pilot Design System structure missing at ${viewport.join("x")}`);
      if (pilot.legacyContractorScope) throw new Error(`Legacy contractor-workspace scope is still active at ${viewport.join("x")}`);
      const expectedColumns = viewport[0] <= 1024 ? 2 : 4;
      if (pilot.kpiColumns !== expectedColumns) throw new Error(`Pilot KPI columns ${pilot.kpiColumns}, expected ${expectedColumns} at ${viewport.join("x")}`);
      if (pilot.searchIconWidth !== 0 || pilot.searchIconHeight !== 0) throw new Error(`Pilot contractor search icon must be absent at ${viewport.join("x")}`);
      if (pilot.emptyTitleBorder !== "0px" || pilot.emptyTextBorder !== "0px") throw new Error(`Pilot empty-state text has a border at ${viewport.join("x")}`);
      if (pilot.pageLeft < -1 || pilot.pageRight > pilot.clientWidth + 1 || pilot.sourceLeft < -1 || pilot.sourceRight > pilot.clientWidth + 1) throw new Error(`Pilot content exceeds viewport at ${viewport.join("x")}`);
    }

    for (const routeName of Object.keys(waveRoutes)) {
      for (const viewport of viewports) {
        manifest.push(await captureWaveRoute(browser, baselineUrl, baselineState, "baseline", viewport, routeName, "empty"));
        const pilot = await captureWaveRoute(browser, pilotUrl, pilotState, "pilot", viewport, routeName, "empty");
        manifest.push(pilot);
        pilotWaveEmpty.set(`${routeName}-${viewport.join("x")}`, pilot);
        persist();
        assertWaveStructure(pilot);
        assertWaveEmptyTypography(pilot);
        if (viewport[0] === 390 && !pilot.tabsVerified) throw new Error(`${routeName}: tab interaction contract did not pass`);
      }
    }

    for (const routeName of Object.keys(waveRoutes)) {
      for (const viewport of [[390, 844], [1440, 900]]) {
        manifest.push(await captureWaveRoute(browser, baselineUrl, baselineState, "baseline", viewport, routeName, "populated"));
        const pilot = await captureWaveRoute(browser, pilotUrl, pilotState, "pilot", viewport, routeName, "populated");
        manifest.push(pilot);
        persist();
        assertWavePopulated(pilot);
      }
    }

    for (const viewport of [[390, 844], [1440, 900]]) {
      const access = await captureAccessReference(browser, pilotUrl, pilotState, viewport);
      manifest.push(access);
      persist();
      const contractors = pilotContractors.get(viewport.join("x"));
      assertCompactCardTypography(contractors, access);
      if (viewport[0] <= 720) {
        assertSameMobileCanon(contractors, access);
        assertCompactMobileContractorKpis(contractors);
        assertCompactMobileContractorRegistry(contractors);
        for (const routeName of Object.keys(waveRoutes)) {
          const wave = pilotWaveEmpty.get(`${routeName}-${viewport.join("x")}`);
          if (!wave) throw new Error(`${routeName}: missing ${viewport.join("x")} empty-state metrics`);
          assertWaveMobileCanon(wave, access);
        }
      }
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

    const pngCount = fs.readdirSync(output).filter((file) => file.endsWith(".png")).length;
    if (pngCount !== expectedPngCount) throw new Error(`Visual gate produced ${pngCount} PNG files, expected ${expectedPngCount}`);
  } finally {
    await browser.close();
    await Promise.all(proxies.map(closeServer));
    persist();
  }
})().catch((error) => { console.error(error); process.exit(1); });
