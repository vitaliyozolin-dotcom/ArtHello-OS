import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.AUDIT_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw new Error("AUDIT_ORIGIN must be a loopback HTTP origin");
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

const browser = await chromium.launch({ headless: true });
const results = [];
const violations = [];

try {
  for (const control of controls) {
    const context = await browser.newContext({
      viewport: control,
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "ru-RU",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const response = await page.goto(origin + "/login", {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (!response?.ok()) {
      throw new Error("Login failed at " + control.width + "px");
    }

    await page.locator(".access-card.auth-card").waitFor();
    await page.evaluate(() => document.fonts.ready);

    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const value = node.getBoundingClientRect();
        return {
          x: Math.round(value.x * 100) / 100,
          y: Math.round(value.y * 100) / 100,
          width: Math.round(value.width * 100) / 100,
          height: Math.round(value.height * 100) / 100,
          right: Math.round(value.right * 100) / 100,
          bottom: Math.round(value.bottom * 100) / 100,
        };
      };
      const style = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const value = getComputedStyle(node);
        return {
          fontFamily: value.fontFamily,
          fontSize: value.fontSize,
          lineHeight: value.lineHeight,
          borderRadius: value.borderRadius,
          minHeight: value.minHeight,
          backgroundColor: value.backgroundColor,
          color: value.color,
        };
      };

      return {
        designCode: document.documentElement.dataset.designCode || null,
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        card: rect(".access-card.auth-card"),
        logo: rect(".access-card.auth-card img"),
        heading: rect(".access-card.auth-card h1"),
        input: rect(".access-card.auth-card input"),
        button: rect(".access-card.auth-card button"),
        cardStyle: style(".access-card.auth-card"),
        headingStyle: style(".access-card.auth-card h1"),
        inputStyle: style(".access-card.auth-card input"),
        buttonStyle: style(".access-card.auth-card button"),
      };
    });

    if (metrics.designCode !== "v1") {
      violations.push(control.width + ": missing data-design-code=v1");
    }
    if (
      metrics.documentWidth > control.width + 1 ||
      metrics.bodyWidth > control.width + 1
    ) {
      violations.push(control.width + ": horizontal overflow");
    }
    if (
      !metrics.card ||
      metrics.card.x < -1 ||
      metrics.card.right > control.width + 1
    ) {
      violations.push(control.width + ": login card leaves viewport");
    }

    const file = "/output/login-" + control.width + ".png";
    await page.screenshot({
      path: file,
      fullPage: true,
      animations: "disabled",
    });
    results.push({ ...control, ...metrics, screenshot: file.split("/").at(-1) });
    await context.close();
    console.log("SCHOOL_VISUAL_WIDTH_" + control.width + "=OK");
  }
} finally {
  await browser.close();
}

const manifest = {
  version: "1.0.0",
  capturedAt: new Date().toISOString(),
  origin: "loopback-ssh-tunnel",
  route: "/login",
  controls,
  results,
  violations,
};

await writeFile(
  "/output/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);

if (violations.length) {
  throw new Error("Visual invariants failed: " + violations.join("; "));
}
console.log("SCHOOL_VISUAL_INVARIANTS=OK");
