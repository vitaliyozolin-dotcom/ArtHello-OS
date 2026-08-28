import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  tokens,
  layout,
  dockerfile,
  login,
  designCodePointer,
  schoolApp,
  globals,
  studentTheme,
] = await Promise.all([
    readFile(new URL("../app/design-tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../DESIGN_CODE.md", import.meta.url), "utf8"),
    readFile(new URL("../app/school-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/themes/student.css", import.meta.url), "utf8"),
  ]);

test("approved design-code identity is immutable", () => {
  assert.match(tokens, /Version: 1\.0\.0/);
  assert.match(tokens, /Status: APPROVED/);
  assert.match(tokens, /--brand-500:\s*#e04512;/i);
  assert.match(tokens, /--neutral-50:\s*#f7f8fa;/i);
  assert.match(tokens, /--neutral-0:\s*#ffffff;/i);
  assert.match(tokens, /--neutral-900:\s*#171a1f;/i);
  assert.match(tokens, /--neutral-500:\s*#667085;/i);
  assert.match(tokens, /--neutral-200:\s*#e4e7ec;/i);
  assert.match(tokens, /--font-sans:\s*"Onest"/);
  assert.match(
    tokens,
    /Canonical Design Code SHA-256: cebdc3f3ae76cb50103734c0e6144cef713108b4c6fd9b39de93cf3f8828dd48/,
  );
  assert.match(designCodePointer, /статус этого файла: `POINTER_ONLY`/);
  assert.match(
    designCodePointer,
    /blob\/main\/docs\/design\/school-1-11\/DESIGN_CODE\.md/,
  );
  assert.match(
    designCodePointer,
    /cebdc3f3ae76cb50103734c0e6144cef713108b4c6fd9b39de93cf3f8828dd48/,
  );
});

test("only approved design radii are defined", () => {
  const radiusDefinitions = [
    ...tokens.matchAll(/--ds-radius-[\w-]+:\s*([^;]+);/g),
  ].map((match) => match[1].trim());

  assert.deepEqual(radiusDefinitions, ["8px", "12px", "16px", "20px", "999px"]);
});

test("rollout is explicit and disabled by default", () => {
  assert.match(
    layout,
    /process\.env\.NEXT_PUBLIC_SCHOOL_DESIGN_V1 === "true"/,
  );
  assert.match(layout, /data-design-code=\{designCodeVersion\}/);
  assert.doesNotMatch(layout, /designCodeVersion\s*=\s*"v1"/);
  assert.ok(
    layout.indexOf('import "./design-tokens.css"') <
      layout.indexOf('import "./globals.css"'),
    "tokens must load before legacy styles",
  );
});

test("approved Onest is served as a local preloaded WOFF2", () => {
  const onestFace = globals.match(
    /@font-face\s*\{[\s\S]*?font-family:\s*"Onest";[\s\S]*?\}/,
  )?.[0];

  assert.ok(onestFace, "Onest font-face is required");
  assert.match(
    onestFace,
    /url\("\/fonts\/onest-variable\.woff2"\) format\("woff2-variations"\)/,
  );
  assert.ok(
    onestFace.indexOf("onest-variable.woff2") <
      onestFace.indexOf("onest-variable.ttf"),
    "WOFF2 must be the primary Onest source",
  );
  assert.match(
    layout,
    /\{designCodeVersion \? \([\s\S]*?rel="preload"[\s\S]*?href="\/fonts\/onest-variable\.woff2"[\s\S]*?as="font"[\s\S]*?type="font\/woff2"[\s\S]*?crossOrigin="anonymous"/,
  );
});

test("container build gate is false unless explicitly enabled", () => {
  assert.match(dockerfile, /^ARG NEXT_PUBLIC_SCHOOL_DESIGN_V1=false/m);
  assert.equal(
    (dockerfile.match(/^ARG NEXT_PUBLIC_SCHOOL_DESIGN_V1$/gm) || []).length,
    2,
  );
  assert.equal(
    (dockerfile.match(
      /^ENV NEXT_PUBLIC_SCHOOL_DESIGN_V1=\$NEXT_PUBLIC_SCHOOL_DESIGN_V1$/gm,
    ) || []).length,
    2,
  );
});

test("login follows the approved form contract", () => {
  assert.match(login, /width=\{48\}[\s\S]*height=\{48\}/);
  assert.match(login, /className="auth-error-slot"/);
  assert.match(login, /aria-live="polite"/);
  assert.match(login, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(login, /aria-describedby=\{error \? "login-error" : undefined\}/);
  assert.doesNotMatch(login, /ArtHello OS|Виталий/);

  assert.match(
    tokens,
    /html\[data-design-code="v1"\] \.auth-card \{[\s\S]*?border-radius: var\(--ds-radius-lg\);/,
  );
  assert.match(
    tokens,
    /html\[data-design-code="v1"\] \.auth-field input \{[\s\S]*?height: var\(--control-height-lg\);[\s\S]*?border-radius: var\(--ds-radius-md\);/,
  );
  assert.match(
    tokens,
    /html\[data-design-code="v1"\] \.auth-error-slot \{[\s\S]*?min-height: var\(--text-small-line\);/,
  );
});

test("foundation overrides are scoped to the v1 feature flag", () => {
  assert.match(tokens, /html\[data-design-code="v1"\]/);
  const rollout = tokens.split("Foundation rollout.")[1];
  assert.ok(rollout, "foundation rollout section is required");

  for (const selector of [
    "body",
    ".l0-app",
    ".l0-workspace",
    ".l0-topbar",
    ".page-shell",
    ".content-card",
    ".primary-btn",
    ".ghost-btn",
    ".l0-main",
    ".l0-bottom-nav",
  ]) {
    assert.ok(
      rollout.includes('html[data-design-code="v1"] ' + selector),
      selector + " must remain behind the v1 flag",
    );
  }
});

test("DS-02 tablet shell is fixed at the approved 768–1199 range", () => {
  assert.match(
    tokens,
    /@media \(max-width: 1199px\) and \(min-width: 768px\) \{[\s\S]*?html\[data-design-code="v1"\] \.l0-app \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: var\(--sidebar-compact-width\) minmax\(0, 1fr\);/,
  );
  assert.match(
    tokens,
    /@media \(max-width: 1199px\) and \(min-width: 768px\) \{[\s\S]*?html\[data-design-code="v1"\] \.l0-rail \{[\s\S]*?display: flex;/,
  );
  assert.match(
    tokens,
    /html\[data-design-code="v1"\] \.l0-bottom-nav \{\s*display: none;/,
  );
  assert.match(
    tokens,
    /html\[data-design-code="v1"\] \.l0-nav button > span,[\s\S]*?display: none;/,
  );
  assert.match(schoolApp, /aria-label=\{item\.label\} title=\{item\.label\}/);
  assert.match(schoolApp, /className="rail-context" title=/);
  assert.doesNotMatch(tokens, /!important/);
});

test("DS-03 student theme changes tokens and typography only", () => {
  assert.ok(
    layout.indexOf('import "./design-tokens.css"') <
      layout.indexOf('import "./themes/student.css"') &&
      layout.indexOf('import "./themes/student.css"') <
        layout.indexOf('import "./globals.css"'),
    "student theme tokens must load between approved tokens and legacy styles",
  );
  assert.match(
    studentTheme,
    /html\[data-design-code="v1"\]\[data-theme="student"\] \{/,
  );
  for (const mapping of [
    ["color-page", "neutral-900"],
    ["color-surface", "neutral-800"],
    ["color-surface-muted", "neutral-700"],
    ["color-surface-raised", "neutral-800"],
    ["color-text", "neutral-0"],
    ["color-text-secondary", "neutral-300"],
    ["color-text-muted", "neutral-400"],
    ["color-accent", "brand-500"],
    ["color-accent-hover", "brand-600"],
    ["color-accent-active", "brand-700"],
  ]) {
    assert.match(
      studentTheme,
      new RegExp(`--${mapping[0]}:\\s*var\\(--${mapping[1]}\\);`),
    );
  }
  assert.match(tokens, /--brand-400:\s*#f07142;/i);
  assert.match(
    studentTheme,
    /--student-action:\s*var\(--color-accent-hover\);/,
  );
  assert.match(
    studentTheme,
    /--student-action-strong:\s*var\(--color-accent-hover\);/,
  );
  for (const token of [
    "color-border",
    "color-border-strong",
    "color-accent-soft",
    "color-focus",
    "color-overlay",
  ]) {
    assert.match(studentTheme, new RegExp(`--${token}:\\s*color-mix\\(`));
  }
  assert.match(studentTheme, /--student-font-family:\s*var\(--font-sans\);/);
  assert.match(
    studentTheme,
    /:root \{[\s\S]*?--student-main-background:\s*radial-gradient\([\s\S]*?--student-hero-background:\s*linear-gradient\([\s\S]*?--student-dashboard-hero-image:\s*linear-gradient\([\s\S]*?--student-hero-overlay-mobile:\s*linear-gradient\(/,
    "flag-off student backgrounds must retain their legacy gradients",
  );
  assert.match(
    studentTheme,
    /:root \{[\s\S]*?--student-bottom-nav:\s*rgba\(10, 11, 18, 0\.96\);/,
    "flag-off mobile student navigation must retain its legacy background",
  );
  assert.match(
    studentTheme,
    /html\[data-design-code="v1"\]\[data-theme="student"\] \{[\s\S]*?--student-bottom-nav:\s*color-mix\(in srgb, var\(--neutral-900\) 96%, transparent\);/,
  );
  assert.match(
    globals,
    /\.role-student \.l0-bottom-nav \{[^}]*background:\s*var\(--student-bottom-nav\);/,
  );
  for (const mapping of [
    ["student-main-background", "color-page"],
    ["student-hero-background", "color-surface"],
    ["student-hero-overlay", "student-hero-overlay-06"],
    ["student-hero-overlay-mobile", "student-hero-overlay-30"],
  ]) {
    assert.match(
      studentTheme,
      new RegExp(`--${mapping[0]}:\\s*var\\(--${mapping[1]}\\);`),
    );
  }
  assert.match(
    studentTheme,
    /--student-dashboard-hero-image:\s*url\("\/student-dashboard-hero-v1\.webp"\);/,
  );
  assert.match(
    studentTheme,
    /--student-app-shadow:\s*0 30px 100px color-mix\(in srgb, var\(--neutral-900\) 36%, transparent\);/,
    "DS-03 may recolor but must not reshape the accepted app shadow",
  );
  assert.match(
    studentTheme,
    /html\[data-design-code="v1"\]\[data-theme="student"\] \.role-student \.l0-topbar \{[\s\S]*?border-color: var\(--student-line-08\);[\s\S]*?background: var\(--student-topbar\);[\s\S]*?color: var\(--student-on-dark\);[\s\S]*?\}/,
    "student topbar colors must beat the shared v1 selector",
  );
  for (const selector of [
    ".calendar-toolbar > label",
    ".calendar-week > article",
    ".calendar-lesson",
    ".menu-grid > article",
    ".event-grid > article",
    ".activity-grid > article",
    ".privacy-card",
    ".segmented",
    ".day-switch > button",
    ".lesson-order",
    ".notification-list > article",
  ]) {
    assert.ok(
      studentTheme.includes(".role-student " + selector),
      selector + " must inherit the approved student palette",
    );
  }
  const sharedRouteSurfaceBlock = studentTheme.split(
    "/* Shared route surfaces must inherit the approved dark student palette. */",
  )[1];
  assert.ok(sharedRouteSurfaceBlock, "shared student route surface block is required");
  assert.match(
    sharedRouteSurfaceBlock,
    /\.calendar-toolbar > label,[\s\S]*?\.privacy-card \{[\s\S]*?background: var\(--color-surface\);[\s\S]*?color: var\(--color-text\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.calendar-week > article > header \{[\s\S]*?background: var\(--color-surface-muted\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.eyebrow,[\s\S]*?\.menu-grid dt \{[\s\S]*?color: var\(--brand-400\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.event-date \{[\s\S]*?background: var\(--color-accent-hover\);[\s\S]*?color: var\(--color-text\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /button:focus-visible,[\s\S]*?textarea:focus-visible \{[\s\S]*?outline-color: var\(--brand-400\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.segmented button\.active \{[\s\S]*?background: var\(--color-surface\);[\s\S]*?color: var\(--color-text\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.day-switch > button \{[\s\S]*?background: var\(--color-surface-muted\);[\s\S]*?color: var\(--color-text\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.day-switch > button\.active \{[\s\S]*?border-color: var\(--color-accent\);[\s\S]*?background: var\(--color-surface\);[\s\S]*?color: var\(--color-text\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.lesson-order \{[\s\S]*?background: var\(--color-surface-muted\);[\s\S]*?color: var\(--color-text-secondary\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.notification-list > article\.unread \{[\s\S]*?border-color: var\(--color-accent\);[\s\S]*?background: var\(--color-surface-raised\);[\s\S]*?color: var\(--color-text\);/,
  );
  assert.doesNotMatch(
    sharedRouteSurfaceBlock,
    /(?:^|\n)\s*(?:width|height|min-width|max-width|min-height|max-height|margin|padding|gap|display|position|grid-template|border-radius):/m,
    "DS-03 route surface fixes must not own geometry",
  );
  assert.match(
    schoolApp,
    /root\.dataset\.theme = snapshot\.viewer\.role === "student" \? "student" : "light"/,
  );
  assert.match(
    schoolApp,
    /useLayoutEffect\(\(\) => \{[\s\S]*?root\.dataset\.theme = snapshot\.viewer\.role === "student" \? "student" : "light"/,
    "theme state must be applied before the student shell paints",
  );

  const studentSelector =
    /\.role-student|\.student-(?:hero|dashboard|kicker|hero-copy|launch-grid|quote|day-grid|achievements|score-orbit)|\.launch-(?:orange|violet|cyan|lime)/;
  const studentRules = [...globals.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => studentSelector.test(match[1]))
    .map((match) => `${match[1]} {${match[2]}}`)
    .join("\n");
  assert.doesNotMatch(
    studentRules,
    /(?:color|background(?:-color|-image)?|border-color|box-shadow|font-family):[^;]*(?:#[0-9a-f]{3,8}\b|rgba?\(|\bwhite\b|\bblack\b)/i,
    "student colors must live only in the theme token layer",
  );
  assert.doesNotMatch(studentRules, /Rubik/);
  assert.doesNotMatch(studentRules, /(?:linear|radial)-gradient/i);
  assert.match(
    globals,
    /\.role-student \.status-pill\s*\{\s*border-radius:\s*9px;\s*\}/,
    "DS-03 must preserve the accepted student status-pill geometry",
  );

  const approvedThemeBlock = studentTheme
    .split('html[data-design-code="v1"][data-theme="student"] {')[1]
    ?.split(
      'html[data-design-code="v1"][data-theme="student"] .role-student,',
    )[0];
  assert.ok(approvedThemeBlock, "approved student theme block is required");
  assert.doesNotMatch(
    approvedThemeBlock,
    /(?:^|\n)\s*(?:width|height|min-width|max-width|min-height|max-height|margin|padding|gap|display|position|grid-template|border-radius):/m,
    "student theme must not own geometry",
  );
});
