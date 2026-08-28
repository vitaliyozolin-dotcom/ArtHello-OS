import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.AUDIT_ORIGIN;
const password = process.env.AUDIT_PASSWORD;
const runId = process.env.AUDIT_RUN_ID;
const candidateSha = process.env.CANDIDATE_SHA;
const candidateImageId = process.env.CANDIDATE_IMAGE_ID;

if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw new Error("AUDIT_ORIGIN must be a loopback HTTP origin");
}
if (!password || !/^[A-Za-z0-9_-]{32,}$/.test(password)) {
  throw new Error("AUDIT_PASSWORD is invalid");
}
if (!runId || !/^[0-9]+$/.test(runId)) {
  throw new Error("AUDIT_RUN_ID is invalid");
}
if (!candidateSha || !/^[a-f0-9]{40}$/.test(candidateSha)) {
  throw new Error("CANDIDATE_SHA is invalid");
}
if (!candidateImageId || !/^sha256:[a-f0-9]{64}$/.test(candidateImageId)) {
  throw new Error("CANDIDATE_IMAGE_ID is invalid");
}

const defaultControls = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 960 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1200 },
];
const boundaryWidths = process.env.AUDIT_WIDTHS;
if (boundaryWidths && boundaryWidths !== "767,768,800,801,1199,1200") {
  throw new Error("AUDIT_WIDTHS must be the approved DS-02 boundary matrix");
}
const controls = boundaryWidths
  ? boundaryWidths.split(",").map((value) => {
      const width = Number.parseInt(value, 10);
      return { width, height: width <= 801 ? 1024 : 960 };
    })
  : defaultControls;

const roles = [
  { id: "director", route: "/management" },
  { id: "teacher", route: "/journal" },
  { id: "parent", route: "/homework" },
  { id: "student", route: "/schedule" },
];

const studentRouteControls = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];
const studentRoutes = [
  { id: "home", route: "/", anchor: ".student-dashboard", heading: null },
  { id: "schedule", route: "/schedule", anchor: ".study-panel.schedule-editor", heading: "Расписание" },
  { id: "journal", route: "/journal", anchor: ".study-panel", heading: "Журнал" },
  { id: "homework", route: "/homework", anchor: ".study-panel", heading: "Домашние задания" },
  { id: "calendar", route: "/calendar", anchor: ".calendar-toolbar", heading: "Календарь школы" },
  { id: "school", route: "/school", anchor: ".compact-tabs", heading: "Школа" },
  { id: "profile", route: "/profile", anchor: ".profile-head", heading: null },
];
const studentThemeExpected = {
  "--color-page": "#171a1f",
  "--color-surface": "#1d2939",
  "--color-surface-muted": "#344054",
  "--color-surface-raised": "#1d2939",
  "--color-text": "#ffffff",
  "--color-text-secondary": "#d0d5dd",
  "--color-text-muted": "#98a2b3",
  "--color-border": "color-mix(in srgb, #ffffff 10%, transparent)",
  "--color-border-strong": "color-mix(in srgb, #ffffff 16%, transparent)",
  "--color-accent": "#e04512",
  "--color-accent-hover": "#c4380d",
  "--color-accent-active": "#a82e0a",
  "--color-accent-soft": "color-mix(in srgb, #e04512 16%, transparent)",
  "--color-focus": "color-mix(in srgb, #e04512 32%, transparent)",
  "--color-overlay": "color-mix(in srgb, #171a1f 72%, transparent)",
};

const allowedRadii = new Set([0, 8, 12, 16, 20, 999]);
const results = [];
const studentRouteResults = [];
const violations = [];
const round = (value) => Math.round(value * 100) / 100;
const numeric = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? round(parsed) : null;
};

function addViolation(role, width, severity, code, selector, expected, actual, route = null) {
  violations.push({
    role,
    width,
    severity,
    code,
    selector,
    expected,
    actual,
    ...(route ? { route } : {}),
  });
}

function expectNumber({ role, width, code, selector, expected, actual, tolerance = 0.6, severity = "P1" }) {
  if (actual === null || Math.abs(actual - expected) > tolerance) {
    addViolation(role, width, severity, code, selector, expected, actual);
  }
}

async function collectDs03Metrics(page) {
  return page.evaluate((expectedTokens) => {
    const firstFamily = (value) =>
      value
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase();
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none";
    document.body.append(probe);
    const resolveColor = (value) => {
      probe.style.color = "";
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const themeTokens = Object.fromEntries(
      Object.entries(expectedTokens).map(([token, expected]) => [
        token,
        {
          specified: rootStyle.getPropertyValue(token).trim(),
          actual: resolveColor(`var(${token})`),
          expected: resolveColor(expected),
        },
      ]),
    );
    const background = (selector) => {
      const node = document.querySelector(selector);
      return node ? resolveColor(getComputedStyle(node).backgroundColor) : null;
    };
    const surfaces = {
      app: {
        selector: ".l0-app",
        actual: background(".l0-app"),
        expected: resolveColor("#171a1f"),
      },
      rail: {
        selector: ".l0-rail",
        actual: background(".l0-rail"),
        expected: resolveColor("#171a1f"),
      },
      workspace: {
        selector: ".l0-workspace",
        actual: background(".l0-workspace"),
        expected: resolveColor("#171a1f"),
      },
      main: {
        selector: ".l0-main",
        actual: background(".l0-main"),
        expected: resolveColor("#171a1f"),
      },
      topbar: {
        selector: ".l0-topbar",
        actual: background(".l0-topbar"),
        expected: resolveColor(
          "color-mix(in srgb, #171a1f 94%, transparent)",
        ),
      },
    };
    const approvedRouteSurfaceColors = [
      "#171a1f",
      "#1d2939",
      "#344054",
      "#e04512",
    ].map(resolveColor);
    const transparent = resolveColor("transparent");
    const effectiveBackground = (node) => {
      let current = node;
      while (current) {
        const value = resolveColor(getComputedStyle(current).backgroundColor);
        if (value !== transparent) return value;
        current = current.parentElement;
      }
      return transparent;
    };
    const routeSurfaceSelector = [
      ".content-card",
      ".student-hero",
      ".student-launch-grid > button",
      ".student-quote",
      ".student-achievements",
      ".achievement-grid > article",
      ".schedule-toolbar",
      ".journal-head",
      ".calendar-week > article",
      ".calendar-week > article > header",
      ".calendar-lesson",
      ".menu-grid > article",
      ".subscription-grid > article",
      ".privacy-card",
    ].join(", ");
    const routeSurfaces = [...document.querySelectorAll(routeSurfaceSelector)]
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
      .map((node, index) => ({
        selector:
          node.tagName.toLowerCase() +
          (typeof node.className === "string" && node.className.trim()
            ? "." + node.className.trim().split(/\s+/).join(".")
            : "") +
          "[route-surface=" +
          index +
          "]",
        actual: effectiveBackground(node),
      }));
    probe.remove();

    const app = document.querySelector(".l0-app");
    const appFont = app ? getComputedStyle(app).fontFamily : "";
    const visibleFontMismatches = [...document.querySelectorAll(".l0-app, .l0-app *")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          firstFamily(style.fontFamily) !== "onest"
        );
      })
      .slice(0, 20)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        className:
          typeof node.className === "string" ? node.className.slice(0, 120) : "",
        fontFamily: getComputedStyle(node).fontFamily,
      }));
    const onestFaces = [...document.fonts]
      .filter(
        (face) =>
          face.family.replace(/^["']|["']$/g, "").toLowerCase() === "onest",
      )
      .map((face) => ({
        family: face.family,
        status: face.status,
        weight: face.weight,
        style: face.style,
      }));
    const preloadNode = [...document.querySelectorAll('link[rel~="preload"]')].find(
      (node) => {
        try {
          return new URL(node.href, location.href).pathname ===
            "/fonts/onest-variable.woff2";
        } catch {
          return false;
        }
      },
    );
    const resourcePaths = performance
      .getEntriesByType("resource")
      .map((entry) => {
        try {
          return new URL(entry.name, location.href).pathname;
        } catch {
          return entry.name;
        }
      });

    return {
      appFont,
      appFirstFamily: firstFamily(appFont),
      visibleFontMismatches,
      fontChecks: {
        regular: document.fonts.check('400 16px "Onest"', "Школа 1–11"),
        bold: document.fonts.check('700 16px "Onest"', "Школа 1–11"),
      },
      onestFaces,
      preload: preloadNode
        ? {
            as: preloadNode.getAttribute("as"),
            type: preloadNode.getAttribute("type"),
            crossOrigin:
              preloadNode.getAttribute("crossorigin") ?? preloadNode.crossOrigin,
          }
        : null,
      resources: {
        woff2: resourcePaths.filter(
          (path) => path === "/fonts/onest-variable.woff2",
        ),
        ttf: resourcePaths.filter((path) => path === "/fonts/onest-variable.ttf"),
        rubik: resourcePaths.filter((path) => /\/fonts\/rubik-.*\.woff2$/.test(path)),
      },
      theme: document.documentElement.dataset.theme || null,
      themeBeforeShell: window.__schoolThemeBeforeShell ?? null,
      themeTokens,
      surfaces,
      approvedRouteSurfaceColors,
      routeSurfaces,
    };
  }, studentThemeExpected);
}

function enforceDs03({ role, width, route, metrics }) {
  const violation = (code, selector, expected, actual) =>
    addViolation(role, width, "P0", code, selector, expected, actual, route);

  if (metrics.appFirstFamily !== "onest") {
    violation("APP_FONT", ".l0-app", "Onest first", metrics.appFont);
  }
  if (metrics.visibleFontMismatches.length) {
    violation(
      "VISIBLE_FONT_FIRST_FAMILY",
      ".l0-app visible descendants",
      "Onest first",
      metrics.visibleFontMismatches,
    );
  }
  const onestLoaded = metrics.onestFaces.some((face) => face.status === "loaded");
  if (!metrics.fontChecks.regular || !metrics.fontChecks.bold || !onestLoaded) {
    violation(
      "FONT_READY",
      "document.fonts",
      "Onest 400/700 checked and loaded",
      { checks: metrics.fontChecks, faces: metrics.onestFaces },
    );
  }
  if (
    !metrics.preload ||
    metrics.preload.as !== "font" ||
    metrics.preload.type !== "font/woff2" ||
    metrics.preload.crossOrigin !== "anonymous"
  ) {
    violation(
      "FONT_PRELOAD",
      'link[rel="preload"]',
      { as: "font", type: "font/woff2", crossOrigin: "anonymous" },
      metrics.preload,
    );
  }
  if (!metrics.resources.woff2.length) {
    violation(
      "FONT_WOFF2_RESOURCE",
      "performance resources",
      "/fonts/onest-variable.woff2",
      metrics.resources,
    );
  }
  if (metrics.resources.ttf.length || metrics.resources.rubik.length) {
    violation(
      "FONT_TTF_FALLBACK",
      "performance resources",
      "no Onest TTF or Rubik fallback",
      metrics.resources,
    );
  }

  if (role === "student") {
    if (metrics.theme !== "student") {
      violation("STUDENT_THEME_TOKEN", "html", "student", metrics.theme);
    }
    if (metrics.themeBeforeShell?.length) {
      violation(
        "STUDENT_THEME_PREPAINT",
        "html/.role-student",
        "student before visible shell",
        metrics.themeBeforeShell,
      );
    }
    for (const [token, value] of Object.entries(metrics.themeTokens)) {
      if (!value.specified || value.actual !== value.expected) {
        violation("STUDENT_THEME_VALUE", token, value.expected, value);
      }
    }
    for (const value of Object.values(metrics.surfaces)) {
      if (value.actual !== null && value.actual !== value.expected) {
        violation(
          "STUDENT_THEME_SURFACE",
          value.selector,
          value.expected,
          value.actual,
        );
      }
    }
    for (const value of metrics.routeSurfaces) {
      if (!metrics.approvedRouteSurfaceColors.includes(value.actual)) {
        violation(
          "STUDENT_THEME_SURFACE",
          value.selector,
          metrics.approvedRouteSurfaceColors,
          value.actual,
        );
      }
    }
  } else if (metrics.theme !== "light") {
    violation("NON_STUDENT_THEME_TOKEN", "html", "light", metrics.theme);
  }
}

async function createContext(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "ru-RU",
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    window.__schoolAuditCLS = 0;
    window.__schoolThemeBeforeShell = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__schoolAuditCLS += entry.value;
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      window.__schoolAuditCLS = null;
    }
    try {
      const themeObserver = new MutationObserver(() => {
        const studentShell = document.querySelector(".role-student");
        const theme = document.documentElement?.dataset.theme ?? null;
        if (studentShell && theme !== "student") {
          window.__schoolThemeBeforeShell.push(theme);
        }
      });
      themeObserver.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    } catch {
      window.__schoolThemeBeforeShell = ["observer-error"];
    }
  });
  return context;
}

const browser = await chromium.launch({ headless: true });
let studentCookies = null;

try {
  for (const role of roles) {
    const loginContext = await createContext(browser, { width: 1280, height: 960 });
    const loginPage = await loginContext.newPage();
    const loginResponse = await loginPage.goto(origin + "/login", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (!loginResponse?.ok()) throw new Error("Login page failed for " + role.id);
    await loginPage.locator('input[name="login"]').fill(
      "authorized-visual-" + runId + "-" + role.id + "@invalid.local",
    );
    await loginPage.locator('input[name="password"]').fill(password);
    await loginPage.locator('button[type="submit"]').click();
    await loginPage.locator(".l0-app").waitFor({ state: "visible", timeout: 30000 });
    const authenticatedRole = await loginPage.evaluate(async () => {
      const response = await fetch("/api/school", { cache: "no-store" });
      if (!response.ok) throw new Error("Authenticated snapshot request failed");
      const payload = await response.json();
      return payload.viewer?.role ?? null;
    });
    if (authenticatedRole !== role.id) {
      throw new Error("Authenticated role mismatch for " + role.id);
    }
    const cookies = await loginContext.cookies(origin);
    if (!cookies.some((cookie) => cookie.name === "school_session")) {
      throw new Error("Session cookie missing for " + role.id);
    }
    if (role.id === "student") studentCookies = cookies;
    await loginContext.close();

    for (const control of controls) {
      const context = await createContext(browser, control);
      await context.addCookies(cookies);
      const page = await context.newPage();
      const response = await page.goto(origin + role.route, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      if (!response?.ok()) {
        throw new Error(role.id + " route failed at " + control.width + "px");
      }
      await page.locator(".l0-app").waitFor({ state: "visible", timeout: 30000 });
      await page.locator(".page-shell, .management-page").first().waitFor({
        state: "visible",
        timeout: 30000,
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);

      const routeRole = await page.evaluate(async () => {
        const response = await fetch("/api/school", { cache: "no-store" });
        if (!response.ok) throw new Error("Role snapshot request failed");
        const payload = await response.json();
        return payload.viewer?.role ?? null;
      });
      if (routeRole !== role.id) {
        throw new Error("Route role mismatch for " + role.id);
      }

      const metrics = await page.evaluate(() => {
        const rounded = (value) => Math.round(value * 100) / 100;
        const rect = (node) => {
          if (!node) return null;
          const value = node.getBoundingClientRect();
          return {
            x: rounded(value.x),
            y: rounded(value.y),
            width: rounded(value.width),
            height: rounded(value.height),
            right: rounded(value.right),
            bottom: rounded(value.bottom),
          };
        };
        const style = (node) => {
          if (!node) return null;
          const value = getComputedStyle(node);
          return {
            display: value.display,
            position: value.position,
            fontFamily: value.fontFamily,
            fontSize: value.fontSize,
            fontWeight: value.fontWeight,
            lineHeight: value.lineHeight,
            borderRadius: value.borderRadius,
            borderWidth: value.borderWidth,
            boxShadow: value.boxShadow,
            minHeight: value.minHeight,
            paddingTop: value.paddingTop,
            paddingRight: value.paddingRight,
            paddingBottom: value.paddingBottom,
            paddingLeft: value.paddingLeft,
            gap: value.gap,
            backgroundColor: value.backgroundColor,
            color: value.color,
            overflowX: value.overflowX,
            visibility: value.visibility,
          };
        };
        const one = (selector) => {
          const node = document.querySelector(selector);
          return { selector, rect: rect(node), style: style(node) };
        };
        const samples = (selectors, limit = 16) => {
          const nodes = [...document.querySelectorAll(selectors)]
            .filter((node) => {
              const value = node.getBoundingClientRect();
              const computed = getComputedStyle(node);
              return value.width > 0 && value.height > 0 && computed.display !== "none";
            })
            .slice(0, limit);
          return nodes.map((node) => ({
            tag: node.tagName.toLowerCase(),
            className: typeof node.className === "string" ? node.className.slice(0, 120) : "",
            rect: rect(node),
            style: style(node),
          }));
        };

        const visibleElements = [...document.querySelectorAll("body *")].filter((node) => {
          const value = node.getBoundingClientRect();
          const computed = getComputedStyle(node);
          return value.width > 0 && value.height > 0 && computed.display !== "none" && computed.visibility !== "hidden";
        });
        const fontSizeHistogram = {};
        const radiusHistogram = {};
        for (const node of visibleElements) {
          const computed = getComputedStyle(node);
          const fontSize = computed.fontSize;
          const radius = computed.borderRadius;
          if (fontSize !== "0px") fontSizeHistogram[fontSize] = (fontSizeHistogram[fontSize] || 0) + 1;
          if (radius !== "0px") radiusHistogram[radius] = (radiusHistogram[radius] || 0) + 1;
        }

        const touchTargets = samples(
          "button, a[href], input, select, textarea, [role='button']",
          120,
        );
        const tooSmallTouchTargets = touchTargets.filter(
          (item) => item.rect.width < 44 || item.rect.height < 44,
        );

        return {
          hrefPath: location.pathname,
          designCode: document.documentElement.dataset.designCode || null,
          theme: document.documentElement.dataset.theme || null,
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          cls: window.__schoolAuditCLS,
          html: one("html"),
          body: one("body"),
          app: one(".l0-app"),
          rail: one(".l0-rail"),
          railLogo: one(".l0-brand img"),
          railBrandText: one(".l0-brand > span"),
          railNavText: one(".l0-nav button span"),
          railContextText: one(".rail-context > span:last-child"),
          railTooltips: [...document.querySelectorAll(".l0-brand, .l0-nav button, .rail-context")].map((node) => ({
            tag: node.tagName.toLowerCase(),
            title: node.getAttribute("title") || "",
            ariaLabel: node.getAttribute("aria-label") || "",
          })),
          workspace: one(".l0-workspace"),
          topbar: one(".l0-topbar"),
          mobileLogo: one(".mobile-brand img"),
          main: one(".l0-main"),
          pageRoot: one(".l0-main > *"),
          pageShell: one(".page-shell"),
          h1: one(".page-heading h1"),
          h2: one(".section-title h2"),
          primaryButton: one(".primary-btn"),
          bottomNav: one(".l0-bottom-nav"),
          helpPresent: Boolean(
            document.querySelector("[data-help-button], [aria-label*='Помощ'], [title*='Помощ']"),
          ),
          cards: samples(
            ".content-card, .metric-card, .admin-readiness, .admin-table, .journal-table, .homework-item, .lesson-line",
            24,
          ),
          routeComponents: samples(
            ".admin-readiness, .admin-table-head, .admin-table-row, .tab-row button, .journal-table, .journal-head, .journal-row, .homework-item, .subject-badge, .day-switch button, .lesson-line, .lesson-edit",
            40,
          ),
          touchTargetCount: touchTargets.length,
          tooSmallTouchTargets,
          fontSizeHistogram,
          radiusHistogram,
        };
      });

      const ds03Metrics = await collectDs03Metrics(page);

      await page.locator("body").press("Tab");
      const focus = await page.evaluate(() => {
        const node = document.activeElement;
        if (!node || node === document.body) return null;
        const value = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          className: typeof node.className === "string" ? node.className.slice(0, 120) : "",
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          outlineStyle: value.outlineStyle,
          outlineWidth: value.outlineWidth,
          boxShadow: value.boxShadow,
        };
      });

      const width = control.width;
      const shellMode = width <= 767 ? "phone" : width < 1200 ? "tablet" : "desktop";
      if (metrics.designCode !== "v1") {
        addViolation(role.id, width, "P0", "DESIGN_CODE_FLAG", "html", "v1", metrics.designCode);
      }
      if (metrics.hrefPath !== role.route) {
        addViolation(role.id, width, "P0", "ROUTE", "location.pathname", role.route, metrics.hrefPath);
      }
      if (metrics.documentWidth > width + 1 || metrics.bodyWidth > width + 1) {
        addViolation(
          role.id,
          width,
          "P0",
          "HORIZONTAL_OVERFLOW",
          "html/body",
          "<= " + width,
          Math.max(metrics.documentWidth, metrics.bodyWidth),
        );
      }

      enforceDs03({
        role: role.id,
        width,
        route: role.route,
        metrics: ds03Metrics,
      });

      const railVisible = metrics.rail.rect && metrics.rail.style?.display !== "none";
      const bottomVisible = metrics.bottomNav.rect && metrics.bottomNav.style?.display !== "none";
      if (shellMode === "phone") {
        if (railVisible) addViolation(role.id, width, "P0", "PHONE_RAIL", ".l0-rail", "hidden", "visible");
        if (!bottomVisible) addViolation(role.id, width, "P0", "PHONE_NAV", ".l0-bottom-nav", "visible", "hidden");
        if (bottomVisible) {
          expectNumber({ role: role.id, width, code: "PHONE_NAV_HEIGHT", selector: ".l0-bottom-nav", expected: 64, actual: metrics.bottomNav.rect.height, severity: "P0" });
        }
      } else {
        if (!railVisible) addViolation(role.id, width, "P0", "RAIL_VISIBLE", ".l0-rail", "visible", "hidden");
        if (bottomVisible) addViolation(role.id, width, "P0", "DESKTOP_NAV", ".l0-bottom-nav", "hidden", "visible");
        if (railVisible) {
          expectNumber({
            role: role.id,
            width,
            code: shellMode === "tablet" ? "TABLET_RAIL_WIDTH" : "DESKTOP_RAIL_WIDTH",
            selector: ".l0-rail",
            expected: shellMode === "tablet" ? 80 : 256,
            actual: metrics.rail.rect.width,
            severity: "P0",
          });
        }
      }

      expectNumber({
        role: role.id,
        width,
        code: "TOPBAR_HEIGHT",
        selector: ".l0-topbar",
        expected: shellMode === "phone" ? 64 : 72,
        actual: metrics.topbar.rect?.height ?? null,
        severity: "P0",
      });
      expectNumber({
        role: role.id,
        width,
        code: "PAGE_PADDING_LEFT",
        selector: ".page-shell",
        expected: shellMode === "phone" ? 16 : width >= 1600 ? 32 : 24,
        actual: numeric(metrics.pageShell.style?.paddingLeft),
        severity: "P0",
      });
      expectNumber({
        role: role.id,
        width,
        code: "PAGE_PADDING_RIGHT",
        selector: ".page-shell",
        expected: shellMode === "phone" ? 16 : width >= 1600 ? 32 : 24,
        actual: numeric(metrics.pageShell.style?.paddingRight),
        severity: "P0",
      });

      if (shellMode === "tablet" && railVisible) {
        for (const item of [metrics.railBrandText, metrics.railNavText, metrics.railContextText]) {
          if (item.rect && item.style?.display !== "none") {
            addViolation(role.id, width, "P0", "TABLET_RAIL_LABEL", item.selector, "hidden", "visible");
          }
        }
        const invalidTooltip = metrics.railTooltips.find(
          (item) => !item.title.trim() || (item.tag === "button" && item.ariaLabel !== item.title),
        );
        if (invalidTooltip) {
          addViolation(role.id, width, "P0", "TABLET_RAIL_TOOLTIP", ".l0-rail", "title and matching button aria-label", invalidTooltip);
        }
      }

      const expectedLogo = 32;
      const logo = shellMode === "phone" ? metrics.mobileLogo : metrics.railLogo;
      expectNumber({ role: role.id, width, code: "HEADER_LOGO_WIDTH", selector: logo.selector, expected: expectedLogo, actual: logo.rect?.width ?? null });
      expectNumber({ role: role.id, width, code: "HEADER_LOGO_HEIGHT", selector: logo.selector, expected: expectedLogo, actual: logo.rect?.height ?? null });

      expectNumber({ role: role.id, width, code: "H1_SIZE", selector: ".page-heading h1", expected: 32, actual: numeric(metrics.h1.style?.fontSize) });
      expectNumber({ role: role.id, width, code: "H1_LINE_HEIGHT", selector: ".page-heading h1", expected: 40, actual: numeric(metrics.h1.style?.lineHeight) });
      expectNumber({ role: role.id, width, code: "H1_WEIGHT", selector: ".page-heading h1", expected: 700, actual: numeric(metrics.h1.style?.fontWeight), tolerance: 0 });
      if (metrics.h2.rect) {
        expectNumber({ role: role.id, width, code: "H2_SIZE", selector: ".section-title h2", expected: 24, actual: numeric(metrics.h2.style?.fontSize) });
        expectNumber({ role: role.id, width, code: "H2_LINE_HEIGHT", selector: ".section-title h2", expected: 32, actual: numeric(metrics.h2.style?.lineHeight) });
      }

      if (metrics.primaryButton.rect) {
        expectNumber({ role: role.id, width, code: "PRIMARY_HEIGHT", selector: ".primary-btn", expected: 44, actual: metrics.primaryButton.rect.height });
        expectNumber({ role: role.id, width, code: "PRIMARY_RADIUS", selector: ".primary-btn", expected: 12, actual: numeric(metrics.primaryButton.style?.borderRadius) });
        const buttonFont = numeric(metrics.primaryButton.style?.fontSize);
        if (buttonFont === null || buttonFont < 14) {
          addViolation(role.id, width, "P1", "PRIMARY_FONT", ".primary-btn", ">=14", buttonFont);
        }
      }

      for (const card of metrics.cards) {
        const radius = numeric(card.style?.borderRadius);
        if (radius !== null && !allowedRadii.has(radius)) {
          addViolation(role.id, width, "P1", "RANDOM_RADIUS", "." + card.className.split(/\s+/).join("."), [...allowedRadii], radius);
        }
        if (card.className.split(/\s+/).includes("content-card")) {
          expectNumber({ role: role.id, width, code: "CARD_RADIUS", selector: ".content-card", expected: 16, actual: radius });
          expectNumber({
            role: role.id,
            width,
            code: "CARD_PADDING",
            selector: ".content-card",
            expected: shellMode === "phone" ? 16 : 24,
            actual: numeric(card.style?.paddingLeft),
          });
        }
      }

      if (metrics.tooSmallTouchTargets.length) {
        addViolation(
          role.id,
          width,
          "P1",
          "TOUCH_TARGETS",
          "interactive controls",
          "all >=44x44",
          metrics.tooSmallTouchTargets.map((item) => ({
            tag: item.tag,
            className: item.className,
            width: item.rect.width,
            height: item.rect.height,
          })),
        );
      }
      if (metrics.cls !== null && metrics.cls > 0.02) {
        addViolation(role.id, width, "P1", "CLS", "document", "<=0.02", round(metrics.cls));
      }
      if (!metrics.helpPresent) {
        addViolation(role.id, width, "P1", "HELP_BUTTON", "global help", "present", "missing");
      }
      if (!focus || ((focus.outlineStyle === "none" || focus.outlineWidth === "0px") && focus.boxShadow === "none")) {
        addViolation(role.id, width, "P1", "FOCUS_RING", "first keyboard target", "visible", focus);
      }
      if (metrics.pageShell.rect && metrics.pageShell.rect.width > 1841) {
        addViolation(role.id, width, "P1", "CONTENT_MAX_WIDTH", ".page-shell", "<=1840", metrics.pageShell.rect.width);
      }

      const screenshot = role.id + "-" + width + ".png";
      await page.screenshot({
        path: "/output/" + screenshot,
        fullPage: true,
        animations: "disabled",
      });
      results.push({
        role: role.id,
        route: role.route,
        ...control,
        shellMode,
        metrics,
        ds03: ds03Metrics,
        focus,
        screenshot,
      });
      await context.close();
      console.log("SCHOOL_AUTHORIZED_VISUAL_" + role.id.toUpperCase() + "_" + width + "=CAPTURED");
    }
  }

  if (!studentCookies) {
    throw new Error("Student session was not captured for route audit");
  }
  for (const control of studentRouteControls) {
    const context = await createContext(browser, control);
    await context.addCookies(studentCookies);
    const page = await context.newPage();
    const response = await page.goto(origin + "/", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (!response?.ok()) {
      throw new Error("Student route audit entry failed at " + control.width + "px");
    }
    await page
      .locator('html[data-design-code="v1"][data-theme="student"] .role-student')
      .waitFor({ state: "visible", timeout: 30000 });
    const routeRole = await page.evaluate(async () => {
      const response = await fetch("/api/school", { cache: "no-store" });
      if (!response.ok) throw new Error("Student route snapshot request failed");
      const payload = await response.json();
      return payload.viewer?.role ?? null;
    });
    if (routeRole !== "student") {
      throw new Error("Student route audit role mismatch");
    }

    for (const route of studentRoutes) {
      await page.evaluate(() => {
        window.__schoolAuditCLS = 0;
      });
      await page.evaluate((path) => {
        history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, route.route);
      await page.waitForURL((url) => url.pathname === route.route, {
        timeout: 30000,
      });
      const routeAnchor = page.locator(route.anchor).first();
      await routeAnchor.waitFor({ state: "visible", timeout: 30000 });
      const routeHeading = route.heading
        ? page.getByRole("heading", { name: route.heading, exact: true }).first()
        : null;
      if (routeHeading) {
        await routeHeading.waitFor({ state: "visible", timeout: 30000 });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);

      const routeMetrics = {
        ...(await page.evaluate(() => ({
          hrefPath: location.pathname,
          designCode: document.documentElement.dataset.designCode || null,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          cls: window.__schoolAuditCLS,
        }))),
        anchorPresent: await routeAnchor.isVisible(),
        headingPresent: routeHeading ? await routeHeading.isVisible() : true,
      };
      const ds03Metrics = await collectDs03Metrics(page);
      const width = control.width;

      if (routeMetrics.designCode !== "v1") {
        addViolation(
          "student",
          width,
          "P0",
          "DESIGN_CODE_FLAG",
          "html",
          "v1",
          routeMetrics.designCode,
          route.route,
        );
      }
      if (routeMetrics.hrefPath !== route.route) {
        addViolation(
          "student",
          width,
          "P0",
          "STUDENT_ROUTE",
          "location.pathname",
          route.route,
          routeMetrics.hrefPath,
          route.route,
        );
      }
      if (!routeMetrics.anchorPresent) {
        addViolation(
          "student",
          width,
          "P0",
          "STUDENT_ROUTE_ANCHOR",
          route.anchor,
          "present",
          "missing",
          route.route,
        );
      }
      if (!routeMetrics.headingPresent) {
        addViolation(
          "student",
          width,
          "P0",
          "STUDENT_ROUTE_HEADING",
          "h1",
          route.heading,
          "missing",
          route.route,
        );
      }
      if (
        routeMetrics.documentWidth > width + 1 ||
        routeMetrics.bodyWidth > width + 1
      ) {
        addViolation(
          "student",
          width,
          "P0",
          "HORIZONTAL_OVERFLOW",
          "html/body",
          "<= " + width,
          Math.max(routeMetrics.documentWidth, routeMetrics.bodyWidth),
          route.route,
        );
      }
      if (routeMetrics.cls !== null && routeMetrics.cls > 0.02) {
        addViolation(
          "student",
          width,
          "P1",
          "CLS",
          "document",
          "<=0.02",
          round(routeMetrics.cls),
          route.route,
        );
      }
      enforceDs03({
        role: "student",
        width,
        route: route.route,
        metrics: ds03Metrics,
      });

      const screenshot =
        "student-route-" + route.id + "-" + control.width + ".png";
      await page.screenshot({
        path: "/output/" + screenshot,
        fullPage: true,
        animations: "disabled",
      });
      studentRouteResults.push({
        role: "student",
        route: route.route,
        routeId: route.id,
        ...control,
        metrics: routeMetrics,
        ds03: ds03Metrics,
        screenshot,
      });
      console.log(
        "SCHOOL_DS03_ROUTE_" +
          route.id.toUpperCase() +
          "_" +
          control.width +
          "=CAPTURED",
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const severityCounts = violations.reduce(
  (counts, violation) => {
    counts[violation.severity] = (counts[violation.severity] || 0) + 1;
    return counts;
  },
  {},
);
const manifest = {
  version: "1.1.0",
  capturedAt: new Date().toISOString(),
  candidateSha,
  candidateImageId,
  sourceOfTruth: "School 1–11 design code 1.0.0, approved 2026-08-27",
  origin: "loopback-ssh-tunnel",
  fixture: "empty schema from candidate migrations, seeded with synthetic data",
  credentialsStored: false,
  controls,
  roles: roles.map(({ id, route }) => ({ id, route })),
  studentRouteControls,
  studentRoutes: studentRoutes.map(({ id, route, anchor, heading }) => ({
    id,
    route,
    anchor,
    heading,
  })),
  boundaryCaptures: results.length,
  studentRouteCaptures: studentRouteResults.length,
  captures: results.length + studentRouteResults.length,
  compliant: violations.length === 0,
  severityCounts,
  results: [...results, ...studentRouteResults],
  violations,
};

await writeFile(
  "/output/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);

if (results.length !== roles.length * controls.length) {
  throw new Error("Authorized visual capture matrix is incomplete");
}
if (studentRouteResults.length !== studentRoutes.length * studentRouteControls.length) {
  throw new Error("DS-03 student route capture matrix is incomplete");
}
console.log(
  "SCHOOL_AUTHORIZED_VISUAL_CAPTURE=OK count=" +
    (results.length + studentRouteResults.length),
);
console.log("SCHOOL_AUTHORIZED_VISUAL_VIOLATIONS=" + violations.length);
