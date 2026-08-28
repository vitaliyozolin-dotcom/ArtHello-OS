import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.AUDIT_ORIGIN;
const password = process.env.AUDIT_PASSWORD;
const runId = process.env.AUDIT_RUN_ID;
const candidateSha = process.env.CANDIDATE_SHA;

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

const controls = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 960 },
  { width: 1440, height: 1000 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1200 },
];

const roles = [
  { id: "director", route: "/management" },
  { id: "teacher", route: "/journal" },
  { id: "parent", route: "/homework" },
  { id: "student", route: "/schedule" },
];

const allowedRadii = new Set([0, 8, 12, 16, 20, 999]);
const results = [];
const violations = [];
const round = (value) => Math.round(value * 100) / 100;
const numeric = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? round(parsed) : null;
};

function addViolation(role, width, severity, code, selector, expected, actual) {
  violations.push({ role, width, severity, code, selector, expected, actual });
}

function expectNumber({ role, width, code, selector, expected, actual, tolerance = 0.6, severity = "P1" }) {
  if (actual === null || Math.abs(actual - expected) > tolerance) {
    addViolation(role, width, severity, code, selector, expected, actual);
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
  });
  return context;
}

const browser = await chromium.launch({ headless: true });

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
          railContextText: one(".rail-context > span"),
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

      const appFont = metrics.app.style?.fontFamily || "";
      if (!appFont.toLowerCase().includes("onest")) {
        addViolation(role.id, width, "P0", "APP_FONT", ".l0-app", "Onest", appFont);
      }
      if (role.id === "student" && metrics.theme !== "student") {
        addViolation(role.id, width, "P0", "STUDENT_THEME_TOKEN", "html", "student", metrics.theme);
      }

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
        selector: ".l0-main",
        expected: shellMode === "phone" ? 16 : width >= 1600 ? 32 : 24,
        actual: numeric(metrics.main.style?.paddingLeft),
        severity: "P0",
      });
      expectNumber({
        role: role.id,
        width,
        code: "PAGE_PADDING_RIGHT",
        selector: ".l0-main",
        expected: shellMode === "phone" ? 16 : width >= 1600 ? 32 : 24,
        actual: numeric(metrics.main.style?.paddingRight),
        severity: "P0",
      });

      if (shellMode === "tablet") {
        for (const item of [metrics.railBrandText, metrics.railNavText, metrics.railContextText]) {
          if (item.rect && item.style?.display !== "none") {
            addViolation(role.id, width, "P0", "TABLET_RAIL_LABEL", item.selector, "hidden", "visible");
          }
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
      if (metrics.pageRoot.rect && metrics.pageRoot.rect.width > 1841) {
        addViolation(role.id, width, "P1", "CONTENT_MAX_WIDTH", ".l0-main > *", "<=1840", metrics.pageRoot.rect.width);
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
        focus,
        screenshot,
      });
      await context.close();
      console.log("SCHOOL_AUTHORIZED_VISUAL_" + role.id.toUpperCase() + "_" + width + "=CAPTURED");
    }
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
  version: "1.0.0",
  capturedAt: new Date().toISOString(),
  candidateSha,
  sourceOfTruth: "School 1–11 design code 1.0.0, approved 2026-08-27",
  origin: "loopback-ssh-tunnel",
  fixture: "candidate bootstrap, wiped and reseeded with synthetic data",
  credentialsStored: false,
  controls,
  roles: roles.map(({ id, route }) => ({ id, route })),
  captures: results.length,
  compliant: violations.length === 0,
  severityCounts,
  results,
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
console.log("SCHOOL_AUTHORIZED_VISUAL_CAPTURE=OK count=" + results.length);
console.log("SCHOOL_AUTHORIZED_VISUAL_VIOLATIONS=" + violations.length);
