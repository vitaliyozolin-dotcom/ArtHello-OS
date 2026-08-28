import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.AUDIT_ORIGIN;
const password = process.env.AUDIT_PASSWORD;
const runId = process.env.AUDIT_RUN_ID;
const side = process.env.AUDIT_SIDE;
const auditSha = process.env.AUDIT_SHA;
const auditImageId = process.env.AUDIT_IMAGE_ID;
const seedDate = process.env.AUDIT_SEED_DATE;

if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw new Error("AUDIT_ORIGIN must be a loopback HTTP origin");
}
if (!password || !/^[A-Za-z0-9_-]{32,}$/.test(password)) {
  throw new Error("AUDIT_PASSWORD is invalid");
}
if (!runId || !/^[0-9]+$/.test(runId)) {
  throw new Error("AUDIT_RUN_ID is invalid");
}
if (!new Set(["base", "candidate"]).has(side)) {
  throw new Error("AUDIT_SIDE must be base or candidate");
}
if (!auditSha || !/^[a-f0-9]{40}$/.test(auditSha)) {
  throw new Error("AUDIT_SHA is invalid");
}
if (!auditImageId || !/^sha256:[a-f0-9]{64}$/.test(auditImageId)) {
  throw new Error("AUDIT_IMAGE_ID is invalid");
}
if (!seedDate || !/^\d{4}-\d{2}-\d{2}$/.test(seedDate)) {
  throw new Error("AUDIT_SEED_DATE is invalid");
}

const roles = [
  { id: "director" },
  { id: "teacher" },
  { id: "parent" },
  { id: "student" },
];
const probes = [
  { id: "director-management", role: "director", route: "/management", state: "default" },
  { id: "teacher-journal", role: "teacher", route: "/journal", state: "default" },
  { id: "teacher-journal-modal", role: "teacher", route: "/journal", state: "grade-modal" },
  { id: "parent-homework", role: "parent", route: "/homework", state: "default" },
  { id: "parent-ranking", role: "parent", route: "/people", state: "ranking" },
  { id: "student-schedule", role: "student", route: "/schedule", state: "first-weekday" },
];
const controls = [
  { width: 390, height: 844 },
  { width: 1440, height: 1000 },
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function createContext(browser, viewport) {
  return browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    reducedMotion: "reduce",
  });
}

async function isolateContext(context) {
  const blockedExternalRequests = [];
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    let allowed = false;
    try {
      const parsed = new URL(requestUrl);
      allowed = parsed.origin === origin || parsed.protocol === "data:" || parsed.protocol === "blob:";
    } catch {
      allowed = false;
    }
    if (allowed) await route.continue();
    else {
      blockedExternalRequests.push(requestUrl);
      await route.abort("blockedbyclient");
    }
  });
  return blockedExternalRequests;
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

const ownedRootSelector = ".l0-stage, .gate-stage, .modal-backdrop, .l0-toast";

async function captureOwnedDom(page) {
  return page.evaluate((selector) => {
    const roots = [...document.querySelectorAll(selector)].filter(
      (node) => !node.parentElement?.closest(selector),
    );
    if (!roots.length) throw new Error("No app-owned root found");
    return roots.map((root) => {
      const clone = root.cloneNode(true);
      for (const element of [clone, ...clone.querySelectorAll("*")]) {
        const attributes = [...element.attributes]
          .map((attribute) => [attribute.name, attribute.value])
          .sort(([left], [right]) => left.localeCompare(right));
        for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
        for (const [name, value] of attributes) element.setAttribute(name, value);
      }
      return clone.outerHTML;
    }).join("\n");
  }, ownedRootSelector);
}

async function captureOwnedGeometry(page) {
  return page.evaluate((selector) => {
    const roots = [...document.querySelectorAll(selector)].filter(
      (node) => !node.parentElement?.closest(selector),
    );
    if (!roots.length) throw new Error("No app-owned root found");
    const rounded = (value) => Math.round(value * 100) / 100;
    return roots.flatMap((root, rootIndex) => {
      const nodes = [root, ...root.querySelectorAll("*")];
      return nodes
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        })
        .map((node, nodeIndex) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            rootIndex,
            nodeIndex,
            tag: node.tagName.toLowerCase(),
            id: node.id,
            className: typeof node.className === "string" ? node.className : "",
            rect: {
              x: rounded(rect.x),
              y: rounded(rect.y),
              width: rounded(rect.width),
              height: rounded(rect.height),
              right: rounded(rect.right),
              bottom: rounded(rect.bottom),
            },
            box: {
              clientWidth: node.clientWidth,
              clientHeight: node.clientHeight,
              scrollWidth: node.scrollWidth,
              scrollHeight: node.scrollHeight,
            },
            style: {
              display: style.display,
              position: style.position,
              boxSizing: style.boxSizing,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              color: style.color,
              backgroundColor: style.backgroundColor,
              borderColor: style.borderColor,
              borderRadius: style.borderRadius,
              borderWidth: style.borderWidth,
              padding: style.padding,
              margin: style.margin,
              gap: style.gap,
              opacity: style.opacity,
              overflow: style.overflow,
              transform: style.transform,
            },
          };
        });
    });
  }, ownedRootSelector);
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const role of roles) {
    const loginContext = await createContext(browser, { width: 1280, height: 960 });
    const loginExternalRequests = await isolateContext(loginContext);
    const loginPage = await loginContext.newPage();
    const loginResponse = await loginPage.goto(origin + "/login", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    if (!loginResponse?.ok()) throw new Error("Login page failed for " + role.id);
    await loginPage.locator('input[name="login"]').fill(
      "authorized-visual-" + runId + "-" + role.id + "@invalid.local",
    );
    await loginPage.locator('input[name="password"]').fill(password);
    await loginPage.locator('button[type="submit"]').click();
    await loginPage.locator(".l0-app").waitFor({ state: "visible", timeout: 30_000 });
    const loginRole = await loginPage.evaluate(async () => {
      const response = await fetch("/api/school", { cache: "no-store" });
      if (!response.ok) throw new Error("Authenticated snapshot request failed");
      return (await response.json()).viewer?.role ?? null;
    });
    if (loginRole !== role.id) throw new Error("Login role mismatch for " + role.id);
    const cookies = await loginContext.cookies(origin);
    if (!cookies.some((cookie) => cookie.name === "school_session")) {
      throw new Error("Session cookie missing for " + role.id);
    }
    if (loginExternalRequests.length) {
      throw new Error("External request attempted during login: " + JSON.stringify(loginExternalRequests));
    }
    await loginContext.close();

    for (const probe of probes.filter((item) => item.role === role.id)) {
      for (const control of controls) {
      const context = await createContext(browser, control);
      const externalRequests = await isolateContext(context);
      await context.addCookies(cookies);
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      const response = await page.goto(origin + probe.route, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      if (!response?.ok()) {
        throw new Error(`${probe.id} ${probe.route} failed at ${control.width}px`);
      }
      await page.locator(".l0-app").waitFor({ state: "visible", timeout: 30_000 });
      await page.locator(".page-shell, .management-page").first().waitFor({
        state: "visible",
        timeout: 30_000,
      });

      if (probe.state === "first-weekday") {
        const firstDay = page.locator(".day-switch > button").first();
        await firstDay.waitFor({ state: "visible", timeout: 30_000 });
        await firstDay.click();
      }
      if (probe.state === "grade-modal") {
        await page.getByRole("button", { name: "Новая оценка" }).click();
        await page.locator(".action-modal").waitFor({ state: "visible", timeout: 30_000 });
      }
      await settle(page);

      const runtime = await page.evaluate(async (probeId) => {
        const response = await fetch("/api/school", { cache: "no-store" });
        if (!response.ok) throw new Error("Role snapshot request failed");
        const payload = await response.json();
        const ownedRoots = [...document.querySelectorAll(
          ".l0-stage, .gate-stage, .modal-backdrop, .l0-toast",
        )].filter((node) => !node.parentElement?.closest(
          ".l0-stage, .gate-stage, .modal-backdrop, .l0-toast",
        )).length;
        const anchors = {
          directorManagementRows: document.querySelectorAll(".admin-table-row").length,
          directorLegacyTitles: document.querySelectorAll(
            ".admin-table-row strong[title], .admin-table-row small[title], .admin-table-row > span[title]",
          ).length,
          journalRows: document.querySelectorAll(".journal-row").length,
          journalLegacyTitles: document.querySelectorAll(".journal-row strong[title]").length,
          rankingBoards: document.querySelectorAll(
            '.ranking-tabs[aria-label="Показатель рейтинга"]',
          ).length,
          rankingButtons: document.querySelectorAll(".ranking-tabs > button").length,
          rankingTypedButtons: document.querySelectorAll(".ranking-tabs > button[type]").length,
          genericTabButtons: document.querySelectorAll(".tab-row > button").length,
          genericTypedButtons: document.querySelectorAll(".tab-row > button[type]").length,
          modalBackdrops: document.querySelectorAll(".modal-backdrop").length,
          modalDialogs: document.querySelectorAll(".action-modal[role=dialog]").length,
        };
        return {
          role: payload.viewer?.role ?? null,
          designCode: document.documentElement.dataset.designCode ?? null,
          helpButtons: document.querySelectorAll("[data-help-button], .help-button").length,
          tabRoles: document.querySelectorAll('[role="tab"], [role="tablist"], [role="tabpanel"]').length,
          ownedRoots,
          probeId,
          anchors,
        };
      }, probe.id);
      if (runtime.role !== role.id) throw new Error("Route role mismatch for " + role.id);
      if (runtime.designCode !== null) throw new Error("A design marker is active while flag is off");
      if (runtime.helpButtons !== 0) throw new Error("Flag-off HelpButton must not render");
      if (runtime.tabRoles !== 0) throw new Error("Flag-off tabs must preserve legacy semantics");
      const anchors = runtime.anchors;
      if (probe.id === "director-management" && (
        anchors.directorManagementRows === 0 || anchors.directorLegacyTitles !== 0
      )) throw new Error("Director management legacy title anchors are invalid");
      if (probe.id.startsWith("teacher-journal") && (
        anchors.journalRows === 0 ||
        anchors.journalLegacyTitles !== 0 ||
        anchors.genericTabButtons === 0 ||
        anchors.genericTypedButtons !== 0
      )) throw new Error("Teacher journal legacy anchors are invalid");
      if (probe.id === "teacher-journal-modal" && (
        anchors.modalBackdrops !== 1 || anchors.modalDialogs !== 1 || runtime.ownedRoots !== 2
      )) throw new Error("Modal root is missing from the capture surface");
      if (probe.id !== "teacher-journal-modal" && runtime.ownedRoots !== 1) {
        throw new Error("Unexpected app-owned root inventory");
      }
      if (probe.id === "parent-homework" && (
        anchors.genericTabButtons === 0 || anchors.genericTypedButtons !== 0
      )) throw new Error("Parent homework legacy tab anchors are invalid");
      if (probe.id === "parent-ranking" && (
        anchors.rankingBoards !== 1 ||
        anchors.rankingButtons === 0 ||
        anchors.rankingTypedButtons !== 0
      )) throw new Error("Ranking legacy ARIA/type anchors are invalid");
      if (probe.id === "student-schedule" && (
        anchors.genericTabButtons === 0 || anchors.genericTypedButtons !== 0
      )) throw new Error("Student schedule legacy tab anchors are invalid");
      if (consoleErrors.length || pageErrors.length) {
        throw new Error(
          `Browser errors for ${role.id} ${control.width}: ` +
            JSON.stringify({ consoleErrors, pageErrors }),
        );
      }
      if (externalRequests.length) {
        throw new Error("External request attempted: " + JSON.stringify(externalRequests));
      }

      const filename = `${probe.id}-${control.width}`;
      const screenshotPath = `/output/${filename}.png`;
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        animations: "disabled",
      });

      const appHtml = await captureOwnedDom(page);
      const ariaSnapshot = await page.locator("body").ariaSnapshot();
      const geometry = await captureOwnedGeometry(page);

      const geometryText = JSON.stringify(geometry, null, 2) + "\n";
      await writeFile(`/output/${filename}.geometry.json`, geometryText, "utf8");
      await writeFile(`/output/${filename}.dom.html`, appHtml + "\n", "utf8");
      await writeFile(`/output/${filename}.aria.yml`, ariaSnapshot + "\n", "utf8");
      const screenshot = await readFile(screenshotPath);
      results.push({
        probe: probe.id,
        role: role.id,
        route: probe.route,
        state: probe.state,
        width: control.width,
        height: control.height,
        screenshot: `${filename}.png`,
        screenshotSha256: sha256(screenshot),
        geometry: `${filename}.geometry.json`,
        geometrySha256: sha256(geometryText),
        dom: `${filename}.dom.html`,
        domSha256: sha256(appHtml + "\n"),
        aria: `${filename}.aria.yml`,
        ariaSha256: sha256(ariaSnapshot + "\n"),
        fullPageHeight: await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
        designCode: runtime.designCode,
        helpButtons: runtime.helpButtons,
        tabRoles: runtime.tabRoles,
        ownedRoots: runtime.ownedRoots,
        anchors: runtime.anchors,
        consoleErrors,
        pageErrors,
        externalRequests,
      });
      console.log(`SCHOOL_FLAG_OFF_${side.toUpperCase()}_${role.id.toUpperCase()}_${control.width}=CAPTURED`);
      await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

if (results.length !== probes.length * controls.length) {
  throw new Error("Flag-off capture matrix is incomplete");
}
await writeFile(
  "/output/manifest.json",
  JSON.stringify(
    {
      version: "1.0.0",
      runId,
      side,
      auditSha,
      auditImageId,
      seedDate,
      flagValue: false,
      origin: "loopback-ssh-tunnel",
      roles,
      probes,
      controls,
      captures: results.length,
      results,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
console.log(`SCHOOL_FLAG_OFF_${side.toUpperCase()}_CAPTURE=OK count=${results.length}`);
