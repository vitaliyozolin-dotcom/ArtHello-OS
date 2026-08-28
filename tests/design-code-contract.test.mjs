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
  mobilePolish,
] = await Promise.all([
    readFile(new URL("../app/design-tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../DESIGN_CODE.md", import.meta.url), "utf8"),
    readFile(new URL("../app/school-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/themes/student.css", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-polish.css", import.meta.url), "utf8"),
  ]);

const sourceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

const ruleBody = (css, selector) => {
  const selectorIndex = css.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `Missing CSS selector: ${selector}`);
  const open = css.indexOf("{", selectorIndex + selector.length);
  const close = css.indexOf("}", open + 1);
  assert.ok(open > selectorIndex && close > open, `Incomplete CSS rule: ${selector}`);
  return css.slice(open + 1, close);
};

const exactRuleBody = (css, selector) => {
  const marker = `${selector} {`;
  const selectorIndex = css.indexOf(marker);
  assert.notEqual(selectorIndex, -1, `Missing exact CSS selector: ${selector}`);
  const open = selectorIndex + marker.length - 1;
  const close = css.indexOf("}", open + 1);
  assert.ok(close > open, `Incomplete CSS rule: ${selector}`);
  return css.slice(open + 1, close);
};

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
  assert.match(
    studentTheme,
    /--student-accent:\s*var\(--color-accent-hover\);/,
  );
  assert.match(studentTheme, /--student-highlight:\s*var\(--brand-400\);/);
  assert.match(
    studentTheme,
    /--student-highlight-text:\s*var\(--success-50\);/,
  );
  assert.match(
    studentTheme,
    /--student-achievement:\s*var\(--success-50\);/,
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
    /\.eyebrow,[\s\S]*?\.menu-grid dt,[\s\S]*?\.text-action \{[\s\S]*?color: var\(--brand-400\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.event-date \{[\s\S]*?background: var\(--color-accent-hover\);[\s\S]*?color: var\(--color-text\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.compact-tabs > button\.active \{[\s\S]*?border-color: var\(--brand-400\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /button:focus-visible,[\s\S]*?textarea:focus-visible \{[\s\S]*?outline-color: var\(--brand-400\);/,
  );
  assert.match(
    sharedRouteSurfaceBlock,
    /\.privacy-card > span \{[\s\S]*?background: color-mix\(in srgb, var\(--success-500\) 14%, transparent\);[\s\S]*?color: var\(--success-50\);/,
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

test("DS-04 Tabs use one accessible keyboard implementation", () => {
  const tabsSource = sourceBetween(schoolApp, "type TabOption", "const helpPageLabels");

  assert.match(tabsSource, /disabled\?: boolean/);
  assert.match(tabsSource, /className=\{className \?\? "tab-row"\}/);
  assert.match(tabsSource, /role=\{designCodeV1 \? "tablist" : undefined\}/);
  assert.match(tabsSource, /role=\{designCodeV1 \? "tab" : undefined\}/);
  assert.match(tabsSource, /aria-selected=\{designCodeV1 \? value === option\.id : undefined\}/);
  assert.match(tabsSource, /aria-controls=\{designCodeV1 && value === option\.id/);
  assert.match(tabsSource, /tabIndex=\{designCodeV1 \? \(value === option\.id \? 0 : -1\) : undefined\}/);
  assert.match(tabsSource, /disabled=\{option\.disabled\}/);
  assert.match(tabsSource, /enabledIndices/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.match(tabsSource, new RegExp(`"${key}"`));
  assert.match(tabsSource, /event\.preventDefault\(\)/);
  assert.match(tabsSource, /requestAnimationFrame\(\(\) => tabs\?\.\[nextIndex\]\?\.focus\(\)\)/);
  assert.match(tabsSource, /role="tabpanel"/);
  assert.match(tabsSource, /aria-labelledby=\{`\$\{tabsId\}-tab-\$\{value\}`\}/);

  assert.equal((schoolApp.match(/<Tabs\b/g) || []).length, 5);
  assert.equal((schoolApp.match(/<TabPanel\b/g) || []).length, 5);
  for (const id of ["ranking-metric", "study-view", "calendar-view", "school-life", "registration-mode"]) {
    assert.match(schoolApp, new RegExp(`id="${id}"`));
    assert.match(schoolApp, new RegExp(`tabsId="${id}"`));
  }
  for (const legacyClass of ["ranking-tabs", "segmented", "tab-row compact-tabs", "registration-tabs"]) {
    assert.match(schoolApp, new RegExp(`className="${legacyClass}"`));
  }

  const tabButtonRule = ruleBody(tokens, 'html[data-design-code="v1"] :is(\n  .tab-row,\n  .ranking-tabs,\n  .registration-tabs,\n  .segmented\n) > button');
  assert.match(tabButtonRule, /min-height:\s*var\(--control-height-md\);/);
  assert.match(tabButtonRule, /border-radius:\s*var\(--ds-radius-md\);/);
  assert.match(tabButtonRule, /font-size:\s*var\(--text-small-size\);/);
  assert.match(tokens, /> button:hover:not\(:disabled\):not\(\.active\)/);
  assert.match(tokens, /> button:is\(\.active, \[aria-selected="true"\]\)/);
  assert.match(tokens, /> button:disabled/);
});

test("DS-04 HelpButton is contextual, accessible, and modal-safe", () => {
  const helpSource = sourceBetween(schoolApp, "const helpPageLabels", "function NavIcon");

  for (const view of ["home", "calendar", "schedule", "programs", "journal", "homework", "people", "school", "messages", "management", "profile"]) {
    assert.match(helpSource, new RegExp(`\\b${view}:`));
  }
  assert.match(helpSource, /data-help-button/);
  assert.match(helpSource, /aria-label="Помощь по текущей странице"/);
  assert.match(helpSource, /aria-expanded=\{open\}/);
  assert.match(helpSource, /aria-controls=\{open \? panelId : undefined\}/);
  assert.match(helpSource, /role="dialog"/);
  assert.match(helpSource, /aria-labelledby=\{titleId\}/);
  assert.match(helpSource, /event\.key === "Escape"/);
  assert.match(helpSource, /triggerRef\.current\?\.focus\(\)/);
  assert.match(helpSource, /selectedStudentName/);
  assert.match(helpSource, /modalTitles\[action\]/);
  assert.match(helpSource, /createPortal\(content, portalTarget\)/);
  assert.match(helpSource, /document\.querySelector<HTMLElement>\("\.action-modal"\)/);
  assert.match(helpSource, /portalTargetKey === overlayKey/);
  assert.match(schoolApp, /designCodeV1 \? <HelpButton/);
  assert.match(schoolApp, /generatedInvite \? "family\.invite\.create" : undefined/);

  const helpRoot = ruleBody(tokens, 'html[data-design-code="v1"] .help-button-root');
  assert.match(helpRoot, /position:\s*fixed;/);
  const helpButton = exactRuleBody(tokens, 'html[data-design-code="v1"] .help-button');
  assert.match(helpButton, /width:\s*var\(--control-height-md\);/);
  assert.match(helpButton, /height:\s*var\(--control-height-md\);/);
  assert.match(helpButton, /border-radius:\s*var\(--ds-radius-md\);/);
  const helpPanel = ruleBody(tokens, 'html[data-design-code="v1"] .help-panel');
  assert.match(helpPanel, /max-height:/);
  assert.match(helpPanel, /overflow-y:\s*auto;/);
  assert.match(tokens, /bottom:\s*calc\(var\(--mobile-nav-height\) \+ env\(safe-area-inset-bottom, 0px\) \+ var\(--space-3\)\);/);
  assert.match(tokens, /padding-bottom:\s*calc\(var\(--space-20\) \+ var\(--space-4\)\);/);
});

test("DS-04 typography and logo use the approved roles", () => {
  const h1 = ruleBody(tokens, 'html[data-design-code="v1"] .page-heading h1');
  assert.match(h1, /font-size:\s*var\(--text-h1-size\);/);
  assert.match(h1, /line-height:\s*var\(--text-h1-line\);/);
  assert.match(h1, /font-weight:\s*var\(--font-weight-bold\);/);

  const h2 = ruleBody(tokens, 'html[data-design-code="v1"] .section-title h2');
  assert.match(h2, /font-size:\s*var\(--text-h2-size\);/);
  assert.match(h2, /line-height:\s*var\(--text-h2-line\);/);
  assert.match(h2, /font-weight:\s*var\(--font-weight-bold\);/);

  const pageCopy = ruleBody(tokens, 'html[data-design-code="v1"] .page-heading > div > p');
  assert.match(pageCopy, /font-size:\s*var\(--text-body-size\);/);
  assert.match(pageCopy, /line-height:\s*var\(--text-body-line\);/);
  assert.match(tokens, /font-variant-numeric:\s*tabular-nums;/);

  const logo = ruleBody(tokens, 'html[data-design-code="v1"] .l0-brand img,\nhtml[data-design-code="v1"] .mobile-brand img');
  assert.match(logo, /width:\s*32px;/);
  assert.match(logo, /height:\s*32px;/);
  assert.match(logo, /border-radius:\s*0;/);
  assert.match(logo, /box-shadow:\s*none;/);
  assert.match(schoolApp, /width=\{44\} height=\{44\}/);
  assert.match(schoolApp, /width=\{36\} height=\{36\}/);
});

test("DS-04 buttons have stable approved states and hit areas", () => {
  const buttons = ruleBody(tokens, 'html[data-design-code="v1"] .primary-btn,\nhtml[data-design-code="v1"] .ghost-btn,\nhtml[data-design-code="v1"] .text-action,\nhtml[data-design-code="v1"] .journal-row > button');
  for (const declaration of [
    /height:\s*var\(--control-height-md\);/,
    /border-radius:\s*var\(--ds-radius-md\);/,
    /padding-inline:\s*var\(--space-4\);/,
    /font-size:\s*var\(--text-small-size\);/,
    /font-weight:\s*var\(--font-weight-semibold\);/,
    /line-height:\s*var\(--text-small-line\);/,
  ]) assert.match(buttons, declaration);

  for (const state of [
    ".primary-btn:hover:not(:disabled)",
    ".primary-btn:active:not(:disabled)",
    ".ghost-btn:hover:not(:disabled)",
    ".ghost-btn:active:not(:disabled)",
    '[aria-busy="true"]',
    ".is-loading",
    ".danger-btn",
  ]) assert.ok(tokens.includes(state), `Missing button state: ${state}`);
  assert.match(tokens, /\.page-heading > \.primary-btn:has\(svg\)[\s\S]*?height:\s*var\(--control-height-md\);[\s\S]*?font-size:\s*var\(--text-small-size\);/);
  assert.match(tokens, /\.page-heading > \.primary-btn:has\(svg\) svg[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;/);
  assert.match(tokens, /\.notification-button,[\s\S]*?\.top-avatar[\s\S]*?width:\s*var\(--control-height-md\);[\s\S]*?height:\s*var\(--control-height-md\);/);
  assert.match(tokens, /\.top-avatar \.l0-avatar-sm[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/);
  assert.match(mobilePolish, /\.page-heading > \.primary-btn:has\(svg\)[\s\S]*?font-size:\s*0;/);
});

test("DS-04 cards and tables share approved geometry", () => {
  const cards = ruleBody(tokens, 'html[data-design-code="v1"] :is(\n  .content-card,\n  .metric-card,\n  .homework-item,');
  assert.match(cards, /border:\s*1px solid var\(--color-border\);/);
  assert.match(cards, /border-radius:\s*var\(--ds-radius-lg\);/);
  assert.match(cards, /background:\s*var\(--color-surface\);/);
  assert.match(cards, /box-shadow:\s*var\(--shadow-sm\);/);
  assert.match(tokens, /:is\(\.content-card, \.metric-card\)[\s\S]*?padding:\s*var\(--card-padding\);/);
  assert.match(tokens, /@media \(max-width: 767px\)[\s\S]*?:is\(\.content-card, \.metric-card\)[\s\S]*?padding:\s*var\(--card-padding-compact\);/);
  assert.match(tokens, /\.admin-readiness[\s\S]*?border-radius:\s*var\(--ds-radius-xl\);/);
  assert.match(tokens, /\.menu-grid > article\.featured[\s\S]*?box-shadow:\s*var\(--featured-card-shadow\);/);
  assert.match(tokens, /\.metric-button:hover[\s\S]*?transform:\s*none;/);

  const journal = ruleBody(tokens, 'html[data-design-code="v1"] .journal-table');
  assert.match(journal, /border-radius:\s*var\(--ds-radius-lg\);/);
  assert.match(journal, /overflow-x:\s*auto;/);
  assert.match(tokens, /:is\(\.journal-head, \.admin-table-head\)[\s\S]*?min-height:\s*var\(--table-head-height\);/);
  assert.match(tokens, /:is\(\.journal-row, \.admin-table-row\)[\s\S]*?min-height:\s*var\(--table-row-height\);/);
  assert.match(tokens, /:is\(\.journal-head, \.journal-row\)[\s\S]*?grid-template-columns:/);
  assert.match(tokens, /\.journal-row > b[\s\S]*?text-align:\s*right;[\s\S]*?tabular-nums;/);
  assert.match(tokens, /\.admin-table-row > :last-child[\s\S]*?text-align:\s*center;/);
  assert.match(tokens, /@media \(max-width: 800px\)[\s\S]*?\.admin-table[\s\S]*?overflow-x:\s*auto;/);
  assert.match(tokens, /text-overflow:\s*ellipsis;/);
  assert.match(schoolApp, /<strong title=\{student\.fullName\}>\{student\.fullName\}<\/strong>/);
  assert.match(schoolApp, /<small title=\{email\}>\{email\}<\/small>/);
});

test("DS-04 registered visual debt is tokenized without flag-off drift", () => {
  for (const [token, legacy] of [
    ["status-neutral-background", "#f0efeb"],
    ["status-success-background", "#e4f5ec"],
    ["status-warning-background", "#fff0d2"],
    ["status-danger-background", "#ffe8e8"],
    ["status-info-background", "#e5f2fa"],
    ["capacity-track-background", "#eeeae3"],
    ["featured-card-border", "#efc6b4"],
    ["warning-state-background", "#fff1d6"],
  ]) assert.match(tokens, new RegExp(`--${token}:\\s*${legacy};`, "i"));

  for (const reference of [
    "var(--status-neutral-background)",
    "var(--status-success-background)",
    "var(--status-warning-background)",
    "var(--status-danger-background)",
    "var(--status-info-background)",
    "var(--capacity-track-background)",
    "var(--capacity-track-fill)",
    "var(--featured-card-shadow)",
    "var(--warning-state-background)",
    "var(--warning-state-text)",
  ]) assert.ok(globals.includes(reference), `Missing semantic alias: ${reference}`);

  assert.doesNotMatch(globals, /#(?:f0efeb|e4f5ec|fff0d2|ffe8e8|e5f2fa|eeeae3|efc6b4|fff1d6)\b/i);
  assert.match(tokens, /--capacity-track-background:\s*var\(--color-surface-muted\);/);
  assert.match(tokens, /--capacity-track-fill:\s*var\(--color-accent\);/);
  assert.match(tokens, /--featured-card-shadow:\s*var\(--shadow-sm\);/);
  assert.match(tokens, /--warning-state-icon:\s*var\(--warning-500\);/);
  assert.doesNotMatch(ruleBody(tokens, 'html[data-design-code="v1"]'), /--warning-state-(?:text|icon|background):[^;]*(?:brand|danger)/);
});

test("DS-04 student theme owns colors, not component geometry", () => {
  const v1StudentRules = [...studentTheme.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].includes('html[data-design-code="v1"][data-theme="student"]'));
  assert.ok(v1StudentRules.length > 10);
  for (const [, selector, body] of v1StudentRules) {
    assert.doesNotMatch(
      body,
      /(?:^|;)\s*(?:width|height|min-width|max-width|min-height|max-height|margin|padding|gap|display|position|inset|grid-template|flex|border-radius|transform)\s*:/m,
      `Student theme must not own geometry: ${selector.trim()}`,
    );
  }
  assert.match(studentTheme, /> button\[aria-selected="true"\][\s\S]*?background:\s*var\(--student-action\);/);
  assert.match(studentTheme, /--featured-card-shadow:\s*var\(--shadow-sm\);/);
  assert.match(studentTheme, /--status-warning-background:\s*color-mix\(/);
});

test("DS-04 remains inert when the feature flag is off", () => {
  assert.match(schoolApp, /const designCodeV1 = process\.env\.NEXT_PUBLIC_SCHOOL_DESIGN_V1 === "true";/);
  assert.match(schoolApp, /width=\{44\} height=\{44\}/);
  assert.match(schoolApp, /width=\{36\} height=\{36\}/);
  assert.match(schoolApp, /designCodeV1 \? <HelpButton[\s\S]*?: null/);
  assert.match(schoolApp, /className=\{className \?\? "tab-row"\}/);
  assert.match(schoolApp, /aria-label=\{designCodeV1 \? ariaLabel : undefined\}/);
  assert.match(schoolApp, /if \(!designCodeV1\) return <>\{children\}<\/>;/);

  const ds04 = tokens.split("DS-04 — shared component contract.")[1];
  assert.ok(ds04, "DS-04 component layer is required");
  assert.doesNotMatch(ds04, /(?:^|\n)\.[a-z][^{\n]*\{/i, "DS-04 component rules must remain v1-scoped");
  assert.match(tokens, /--featured-card-shadow:\s*0 14px 35px rgba\(232, 68, 18, 0\.07\);/);
  assert.match(tokens, /--capacity-track-fill:\s*var\(--orange\);/);
  assert.doesNotMatch(tokens, /!important/);
});
