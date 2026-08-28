import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const origin = process.env.AUDIT_ORIGIN;
const password = process.env.AUDIT_PASSWORD;
const runId = process.env.AUDIT_RUN_ID;
const runAttempt = process.env.AUDIT_RUN_ATTEMPT;
const seedDate = process.env.AUDIT_SEED_DATE;
const controlSha = process.env.AUDIT_CONTROL_SHA;
const baseSha = process.env.AUDIT_BASE_SHA;
const baseImageId = process.env.AUDIT_BASE_IMAGE_ID;
const candidateSha = process.env.AUDIT_CANDIDATE_SHA;
const candidateImageId = process.env.AUDIT_CANDIDATE_IMAGE_ID;
const handshakeToken = process.env.AUDIT_HANDSHAKE_TOKEN;
const exchangeDir = process.env.AUDIT_EXCHANGE_DIR;
const outputRoot = process.env.AUDIT_OUTPUT_ROOT;

if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw new Error("AUDIT_ORIGIN must be a loopback HTTP origin");
}
if (!password || !/^[A-Za-z0-9_-]{32,}$/.test(password)) {
  throw new Error("AUDIT_PASSWORD is invalid");
}
if (!runId || !/^[0-9]+$/.test(runId)) {
  throw new Error("AUDIT_RUN_ID is invalid");
}
if (!runAttempt || !/^[1-9][0-9]*$/.test(runAttempt)) {
  throw new Error("AUDIT_RUN_ATTEMPT is invalid");
}
if (!controlSha || !/^[a-f0-9]{40}$/.test(controlSha)) {
  throw new Error("AUDIT_CONTROL_SHA is invalid");
}
for (const [name, value] of [
  ["AUDIT_BASE_SHA", baseSha],
  ["AUDIT_CANDIDATE_SHA", candidateSha],
]) {
  if (!value || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
}
for (const [name, value] of [
  ["AUDIT_BASE_IMAGE_ID", baseImageId],
  ["AUDIT_CANDIDATE_IMAGE_ID", candidateImageId],
]) {
  if (!value || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
}
if (!seedDate || !/^\d{4}-\d{2}-\d{2}$/.test(seedDate)) {
  throw new Error("AUDIT_SEED_DATE is invalid");
}
if (!handshakeToken || !/^[a-f0-9]{64}$/.test(handshakeToken)) {
  throw new Error("AUDIT_HANDSHAKE_TOKEN is invalid");
}
if (exchangeDir !== "/exchange" || outputRoot !== "/output") {
  throw new Error("Audit exchange/output mounts are not the reviewed paths");
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
const variantMetadata = {
  base: { auditSha: baseSha, auditImageId: baseImageId },
  candidate: { auditSha: candidateSha, auditImageId: candidateImageId },
};
const expectedSides = ["base", "candidate"];
const rendererProfile = "deterministic-cpu-serial-raster-v1";
const rendererArgs = [
  "--disable-gpu-rasterization",
  "--disable-oop-rasterization",
  "--disable-partial-raster",
  "--num-raster-threads=1",
  "--disable-skia-runtime-opts",
  "--disable-gpu-compositing",
];
const screenshotProtocol = {
  warmupFrames: 1,
  evidenceFrames: 2,
  evidenceByteIdentical: true,
  retries: 0,
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has the wrong schema`);
  }
}

async function writeMarker(filename, payload) {
  const destination = join(exchangeDir, filename);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(payload) + "\n", {
    encoding: "utf8",
    flag: "wx",
    // The exchange tree is owned by the dedicated non-root audit identity.
    mode: 0o644,
  });
  await rename(temporary, destination);
}

async function waitForRequest(side, browserSessionId) {
  const requestPath = join(exchangeDir, `request-${side}.json`);
  const deadline = Date.now() + 45 * 60 * 1000;
  let text;
  while (Date.now() < deadline) {
    try {
      text = await readFile(requestPath, "utf8");
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await sleep(250);
    }
  }
  if (text === undefined) throw new Error(`Timed out waiting for ${side} capture request`);

  const request = JSON.parse(text);
  assertExactKeys(request, [
    "version",
    "runId",
    "runAttempt",
    "controlSha",
    "token",
    "browserSessionId",
    "side",
    "auditSha",
    "auditImageId",
    "seedDate",
  ], `${side} capture request`);
  const expected = variantMetadata[side];
  if (
    request.version !== "1.0.0" ||
    request.runId !== runId ||
    request.runAttempt !== runAttempt ||
    request.controlSha !== controlSha ||
    request.token !== handshakeToken ||
    request.browserSessionId !== browserSessionId ||
    request.side !== side ||
    request.auditSha !== expected.auditSha ||
    request.auditImageId !== expected.auditImageId ||
    request.seedDate !== seedDate
  ) {
    throw new Error(`${side} capture request provenance failed`);
  }
  return request;
}

async function createContext(browser, viewport) {
  return browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    reducedMotion: "reduce",
    serviceWorkers: "block",
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
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
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

async function captureVariant(
  browser,
  side,
  auditSha,
  auditImageId,
  browserSessionId,
  browserVersion,
) {
  const outputDir = join(outputRoot, side);
  await mkdir(outputDir, { recursive: false }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  if ((await readdir(outputDir)).length !== 0) {
    throw new Error(`${side} output directory is not empty`);
  }
  const results = [];

  for (const role of roles) {
    let cookies;
    const loginContext = await createContext(browser, { width: 1280, height: 960 });
    try {
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
      cookies = await loginContext.cookies(origin);
      if (!cookies.some((cookie) => cookie.name === "school_session")) {
        throw new Error("Session cookie missing for " + role.id);
      }
      if (loginExternalRequests.length) {
        throw new Error(
          "External request attempted during login: " + JSON.stringify(loginExternalRequests),
        );
      }
    } finally {
      await loginContext.close();
    }

    for (const probe of probes.filter((item) => item.role === role.id)) {
      for (const control of controls) {
        const context = await createContext(browser, control);
        try {
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
              tabRoles: document.querySelectorAll(
                '[role="tab"], [role="tablist"], [role="tabpanel"]',
              ).length,
              ownedRoots,
              probeId,
              anchors,
            };
          }, probe.id);
          if (runtime.role !== role.id) throw new Error("Route role mismatch for " + role.id);
          if (runtime.designCode !== null) {
            throw new Error("A design marker is active while flag is off");
          }
          if (runtime.helpButtons !== 0) throw new Error("Flag-off HelpButton must not render");
          if (runtime.tabRoles !== 0) {
            throw new Error("Flag-off tabs must preserve legacy semantics");
          }
          const anchors = runtime.anchors;
          if (probe.id === "director-management" && (
            anchors.directorManagementRows !== 16 || anchors.directorLegacyTitles !== 0
          )) throw new Error("Director management legacy title anchors are invalid");
          if (probe.id.startsWith("teacher-journal") && (
            anchors.journalRows !== 6 ||
            anchors.journalLegacyTitles !== 0 ||
            anchors.genericTabButtons !== 5 ||
            anchors.genericTypedButtons !== 0
          )) throw new Error("Teacher journal legacy anchors are invalid");
          if (probe.id === "teacher-journal-modal" && (
            anchors.modalBackdrops !== 1 || anchors.modalDialogs !== 1 || runtime.ownedRoots !== 2
          )) throw new Error("Modal root is missing from the capture surface");
          if (probe.id !== "teacher-journal-modal" && runtime.ownedRoots !== 1) {
            throw new Error("Unexpected app-owned root inventory");
          }
          if (probe.id === "parent-homework" && (
            anchors.genericTabButtons !== 5 || anchors.genericTypedButtons !== 0
          )) throw new Error("Parent homework legacy tab anchors are invalid");
          if (probe.id === "parent-ranking" && (
            anchors.rankingBoards !== 1 ||
            anchors.rankingButtons !== 3 ||
            anchors.rankingTypedButtons !== 0
          )) throw new Error("Ranking legacy ARIA/type anchors are invalid");
          if (probe.id === "student-schedule" && (
            anchors.genericTabButtons !== 5 || anchors.genericTypedButtons !== 0
          )) throw new Error("Student schedule legacy tab anchors are invalid");

          const filename = `${probe.id}-${control.width}`;
          const screenshotPath = join(outputDir, `${filename}.png`);
          const fullPageHeight = await page.evaluate(
            () => Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight,
            ),
          );
          if (!Number.isInteger(fullPageHeight) || fullPageHeight < 1 || fullPageHeight > 10000) {
            throw new Error(`Unsafe full-page height: ${fullPageHeight}`);
          }
          const screenshotOptions = {
            fullPage: true,
            animations: "disabled",
            type: "png",
          };
          const warmupScreenshot = await page.screenshot(screenshotOptions);
          const screenshot = await page.screenshot(screenshotOptions);
          const verificationScreenshot = await page.screenshot(screenshotOptions);
          if (!screenshot.equals(verificationScreenshot)) {
            throw new Error(
              `Consecutive evidence screenshots differ for ${probe.id} at ${control.width}px`,
            );
          }
          await writeFile(screenshotPath, screenshot);
          const appHtml = await captureOwnedDom(page);
          const ariaSnapshot = await page.locator("body").ariaSnapshot();
          const geometry = await captureOwnedGeometry(page);
          if (consoleErrors.length || pageErrors.length) {
            throw new Error(
              `Browser errors for ${role.id} ${control.width}: ` +
                JSON.stringify({ consoleErrors, pageErrors }),
            );
          }
          if (externalRequests.length) {
            throw new Error("External request attempted: " + JSON.stringify(externalRequests));
          }

          const geometryText = JSON.stringify(geometry, null, 2) + "\n";
          await writeFile(join(outputDir, `${filename}.geometry.json`), geometryText, "utf8");
          await writeFile(join(outputDir, `${filename}.dom.html`), appHtml + "\n", "utf8");
          await writeFile(join(outputDir, `${filename}.aria.yml`), ariaSnapshot + "\n", "utf8");
          results.push({
            probe: probe.id,
            role: role.id,
            route: probe.route,
            state: probe.state,
            width: control.width,
            height: control.height,
            screenshot: `${filename}.png`,
            screenshotSha256: sha256(screenshot),
            warmupScreenshotSha256: sha256(warmupScreenshot),
            verificationScreenshotSha256: sha256(verificationScreenshot),
            screenshotAttempts: 3,
            geometry: `${filename}.geometry.json`,
            geometrySha256: sha256(geometryText),
            dom: `${filename}.dom.html`,
            domSha256: sha256(appHtml + "\n"),
            aria: `${filename}.aria.yml`,
            ariaSha256: sha256(ariaSnapshot + "\n"),
            fullPageHeight,
            designCode: runtime.designCode,
            helpButtons: runtime.helpButtons,
            tabRoles: runtime.tabRoles,
            ownedRoots: runtime.ownedRoots,
            anchors: runtime.anchors,
            consoleErrors,
            pageErrors,
            externalRequests,
          });
          console.log(
            `SCHOOL_FLAG_OFF_${side.toUpperCase()}_${role.id.toUpperCase()}_${control.width}=CAPTURED`,
          );
        } finally {
          await context.close();
        }
      }
    }
  }

  if (results.length !== probes.length * controls.length) {
    throw new Error("Flag-off capture matrix is incomplete");
  }
  await writeFile(
    join(outputDir, "manifest.json"),
    JSON.stringify(
      {
        version: "1.3.0",
        runId,
        runAttempt,
        side,
        auditSha,
        auditImageId,
        seedDate,
        flagValue: false,
        origin: "loopback-unix-socket",
        browserSessionId,
        browserVersion,
        rendererProfile,
        rendererArgs,
        screenshotProtocol,
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
  return results.length;
}

const expectedOwner = `${runId}|${runAttempt}|${controlSha}`;
const actualOwner = (await readFile(join(exchangeDir, "owner"), "utf8")).trim();
if (actualOwner !== expectedOwner) throw new Error("Browser exchange ownership failed");

const browserSessionId = randomUUID();
let browser;
try {
  browser = await chromium.launch({ headless: true, args: rendererArgs });
  const browserVersion = await browser.version();
  if (!/^\d+(?:\.\d+){1,3}$/.test(browserVersion)) {
    throw new Error("Chromium version provenance is invalid");
  }
  const browserCdp = await browser.newBrowserCDPSession();
  const commandLine = await browserCdp.send("Browser.getBrowserCommandLine");
  await browserCdp.detach();
  if (!Array.isArray(commandLine.arguments)) {
    throw new Error("Chromium command line provenance is unavailable");
  }
  for (const argument of rendererArgs) {
    if (!commandLine.arguments.includes(argument)) {
      throw new Error(`Required Chromium renderer argument is absent: ${argument}`);
    }
  }
  await writeMarker("ready.json", {
    version: "1.0.0",
    runId,
    runAttempt,
    controlSha,
    token: handshakeToken,
    browserSessionId,
    state: "ready",
    expectedSides,
  });
  console.log(`SCHOOL_FLAG_OFF_SINGLE_BROWSER=READY session=${browserSessionId}`);

  for (const side of expectedSides) {
    const request = await waitForRequest(side, browserSessionId);
    const captures = await captureVariant(
      browser,
      side,
      request.auditSha,
      request.auditImageId,
      browserSessionId,
      browserVersion,
    );
    await writeMarker(`captured-${side}.json`, {
      version: "1.0.0",
      runId,
      runAttempt,
      controlSha,
      token: handshakeToken,
      browserSessionId,
      state: "captured",
      side,
      auditSha: request.auditSha,
      auditImageId: request.auditImageId,
      captures,
    });
  }

  await writeMarker("complete.json", {
    version: "1.0.0",
    runId,
    runAttempt,
    controlSha,
    token: handshakeToken,
    browserSessionId,
    state: "complete",
    sides: expectedSides,
  });
  console.log(`SCHOOL_FLAG_OFF_SINGLE_BROWSER=COMPLETE session=${browserSessionId}`);
} catch (error) {
  try {
    await writeMarker("failed.json", {
      version: "1.0.0",
      runId,
      runAttempt,
      controlSha,
      browserSessionId,
      state: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // The primary error and container exit remain the fail-closed signal.
  }
  throw error;
} finally {
  if (browser) await browser.close();
}
