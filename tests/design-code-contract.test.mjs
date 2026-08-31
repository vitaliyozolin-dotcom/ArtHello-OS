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

const sourceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const normalizeCss = (value) => value.replace(/\s+/g, " ").trim();

const findBlockEnd = (source, openIndex, end) => {
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let index = openIndex + 1; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  assert.fail(`Unclosed CSS block near: ${source.slice(Math.max(0, openIndex - 80), openIndex + 80)}`);
};

const parseCssRules = (css) => {
  const source = stripCssComments(css);
  const rules = [];

  const parseRange = (start, end, atRules = []) => {
    let cursor = start;
    while (cursor < end) {
      while (cursor < end && /\s|;/.test(source[cursor])) cursor += 1;
      if (cursor >= end) break;

      let open = cursor;
      let quote = null;
      let escaped = false;
      let parentheses = 0;
      let brackets = 0;
      for (; open < end; open += 1) {
        const character = source[open];
        if (quote) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === quote) quote = null;
          continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === "(") parentheses += 1;
        else if (character === ")") parentheses -= 1;
        else if (character === "[") brackets += 1;
        else if (character === "]") brackets -= 1;
        else if (character === "{" && parentheses === 0 && brackets === 0) break;
        else if (character === ";" && parentheses === 0 && brackets === 0) {
          cursor = open + 1;
          break;
        }
      }
      if (cursor === open + 1) continue;
      if (open >= end) break;

      const header = normalizeCss(source.slice(cursor, open));
      const close = findBlockEnd(source, open, end);
      const body = source.slice(open + 1, close);
      if (/^@(media|supports|layer|container|document|keyframes)\b/i.test(header)) {
        parseRange(open + 1, close, [...atRules, header]);
      } else {
        rules.push({ selector: header, body, atRules });
      }
      cursor = close + 1;
    }
  };

  parseRange(0, source.length);
  return rules;
};

const splitSelectorList = (selector) => {
  const selectors = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(normalizeCss(selector.slice(start, index)));
      start = index + 1;
    }
  }
  selectors.push(normalizeCss(selector.slice(start)));
  return selectors.filter(Boolean);
};

const declarationEntries = (body) => {
  const entries = [];
  let start = 0;
  let parentheses = 0;
  let quote = null;
  let escaped = false;
  const segments = [];
  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if ((character === ";" || index === body.length) && parentheses === 0) {
      segments.push(body.slice(start, index));
      start = index + 1;
    }
  }
  for (const segment of segments) {
    const colon = segment.indexOf(":");
    if (colon < 0) continue;
    const property = normalizeCss(segment.slice(0, colon));
    const value = normalizeCss(segment.slice(colon + 1));
    if (property) entries.push([property, value]);
  }
  return entries;
};

const exactRule = (css, selector, { atRule, topLevel = false, declarations = {} } = {}) => {
  const wanted = normalizeCss(selector);
  const matches = parseCssRules(css).filter((rule) =>
    rule.selector === wanted
      && (!topLevel || rule.atRules.length === 0)
      && (!atRule || rule.atRules.some((item) => normalizeCss(item) === normalizeCss(atRule)))
      && Object.entries(declarations).every(([property, expected]) =>
        declarationEntries(rule.body)
          .filter(([name]) => name === property)
          .some(([, value]) => value === normalizeCss(expected)),
      ),
  );
  assert.equal(
    matches.length,
    1,
    `Expected one exact CSS rule for ${wanted}${topLevel ? " at top level" : ""}${atRule ? ` inside ${atRule}` : ""}${Object.keys(declarations).length ? ` with ${JSON.stringify(declarations)}` : ""}, found ${matches.length}`,
  );
  return matches[0];
};

const declarationValues = (rule, property) => declarationEntries(rule.body)
  .filter(([name]) => name === property)
  .map(([, value]) => value);

const assertDeclaration = (rule, property, expected) => {
  const values = declarationValues(rule, property);
  assert.ok(
    values.includes(normalizeCss(expected)),
    `${rule.selector} must declare ${property}: ${expected}; found ${values.join(", ") || "nothing"}`,
  );
};

const assertDeclarations = (rule, expected) => {
  for (const [property, value] of Object.entries(expected)) assertDeclaration(rule, property, value);
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

test("CSS contract helpers ignore comments and require an exact selector", () => {
  const sample = `
    /* .target { padding: 999px; } */
    .target:hover { padding: 8px; }
    @media (max-width: 10px) { .target { padding: 4px; } }
    .target { padding: 16px; }
  `;
  const target = exactRule(sample, ".target", { topLevel: true });
  assertDeclarations(target, { padding: "16px" });
  const compactTarget = exactRule(sample, ".target", { atRule: "@media (max-width: 10px)" });
  assertDeclarations(compactTarget, { padding: "4px" });
});

test("DS-04 Tabs have one keyboard contract and one stable shared panel id", () => {
  const tabsSource = sourceBetween(schoolApp, "type TabOption", "const helpPageLabels");
  const normalizedTabs = normalizeCss(tabsSource);

  for (const fragment of [
    "disabled?: boolean",
    'role={designCodeV1 ? "tablist" : undefined}',
    'role={designCodeV1 ? "tab" : undefined}',
    "aria-selected={designCodeV1 ? value === option.id : undefined}",
    'aria-controls={designCodeV1 ? `${id}-panel` : undefined}',
    "const rovingIndex = selectedEnabledIndex >= 0 ? selectedEnabledIndex : (enabledIndices[0] ?? -1)",
    "tabIndex={designCodeV1 ? (index === rovingIndex ? 0 : -1) : undefined}",
    "disabled={option.disabled}",
    "const enabledIndices = options.flatMap",
    "moveIndex(index, 1)",
    "moveIndex(index, -1)",
    "enabledIndices[0]",
    "enabledIndices.at(-1)",
    'event.key === "ArrowRight"',
    'event.key === "ArrowLeft"',
    'event.key === "Home"',
    'event.key === "End"',
    "event.preventDefault()",
    "requestAnimationFrame(() => tabs?.[nextIndex]?.focus())",
    'id={`${tabsId}-panel`}',
    'role="tabpanel"',
    'aria-labelledby={`${tabsId}-tab-${value}`}',
  ]) assert.ok(normalizedTabs.includes(fragment), `Missing Tabs contract fragment: ${fragment}`);
  assert.ok(!normalizedTabs.includes("${option.id}-panel"), "Every tab must control the same stable panel id");
  assert.ok(!normalizedTabs.includes("${value}-panel"), "The panel id must not change when the selected tab changes");

  assert.equal((schoolApp.match(/<Tabs\b/g) ?? []).length, 5);
  assert.equal((schoolApp.match(/<TabPanel\b/g) ?? []).length, 5);
  for (const id of ["ranking-metric", "study-view", "calendar-view", "school-life", "registration-mode"]) {
    assert.ok(schoolApp.includes(`id="${id}"`), `Missing shared Tabs id: ${id}`);
    assert.ok(schoolApp.includes(`tabsId="${id}"`), `Missing matching TabPanel id: ${id}`);
  }

  const tabSelector = `html[data-design-code="v1"] :is(
    .tab-row,
    .ranking-tabs,
    .registration-tabs,
    .segmented
  ) > button`;
  assertDeclarations(exactRule(tokens, tabSelector, { topLevel: true }), {
    "min-height": "var(--control-height-md)",
    "border-radius": "var(--ds-radius-md)",
    "font-size": "var(--text-small-size)",
    "line-height": "var(--text-small-line)",
  });
  for (const suffix of [
    ":hover:not(:disabled):not(.active)",
    ':is(.active, [aria-selected="true"])',
    ":disabled",
  ]) exactRule(tokens, `${tabSelector}${suffix}`, { topLevel: true });
});

test("DS-04 HelpButton closes with its action and stays inside the active overlay", () => {
  const helpContract = sourceBetween(schoolApp, "const helpPageLabels", "function NavIcon");
  const normalizedHelp = normalizeCss(helpContract);
  const dialogRefContract = normalizeCss(sourceBetween(schoolApp, "function useDialogRef", "function ActionModal"));

  for (const view of ["home", "calendar", "schedule", "programs", "journal", "homework", "people", "school", "messages", "management", "profile"]) {
    assert.ok(helpContract.includes(`${view}:`), `Missing HelpButton page context: ${view}`);
  }
  for (const fragment of [
    "const frame = requestAnimationFrame(() => { setOpen(false); if (action)",
    "return () => cancelAnimationFrame(frame)",
    "overlayLabel?: string",
    "const contextLabel = overlayLabel",
    "portalTarget?.isConnected",
    "portalTarget.dataset.helpOverlay === overlayKey",
    "createPortal(content, activePortalTarget)",
    'aria-label="Помощь по текущей странице"',
    "aria-expanded={open}",
    "aria-controls={open ? panelId : undefined}",
    'role="dialog"',
    "aria-labelledby={titleId}",
    'event.key === "Escape"',
    "triggerRef.current?.focus()",
  ]) assert.ok(normalizedHelp.includes(fragment), `Missing HelpButton contract fragment: ${fragment}`);
  assert.ok(schoolApp.includes('const helpOverlayKey = modal ? "action-form" : generatedInvite ? "invite-result" : undefined;'));
  assert.ok(schoolApp.includes("const helpOverlayLabel = modal"));
  assert.ok(schoolApp.includes("helpOverlayLabel={helpOverlayLabel}"));
  for (const fragment of [
    "helpTargetRef(node)",
    'event.key === "Escape"',
    'event.key !== "Tab"',
    'dialog.querySelectorAll<HTMLElement>',
    'dialog.addEventListener("keydown", onKeyDown)',
  ]) assert.ok(dialogRefContract.includes(fragment), `Dialog callback ref is incomplete: ${fragment}`);
  assert.equal((schoolApp.match(/const dialogRef = useDialogRef\(helpTargetRef, close\);/g) ?? []).length, 2, "Both overlays must register their real portal target");
  assert.equal((schoolApp.match(/ref=\{dialogRef\}/g) ?? []).length, 2, "Both overlay roots must use the callback ref");
  assert.ok(schoolApp.includes('data-help-overlay={designCodeV1 ? "action-form" : undefined}'), "Action form must identify its Help portal target only in v1");
  assert.ok(schoolApp.includes('data-help-overlay={designCodeV1 ? "invite-result" : undefined}'), "Invite result must identify its Help portal target only in v1");
  assert.ok(schoolApp.includes('aria-labelledby={designCodeV1 ? "invite-result-title" : undefined}'), "Invite result dialog must have a v1 accessible name");
  assert.ok(schoolApp.includes('id={designCodeV1 ? "invite-result-title" : undefined}'), "Invite result heading must preserve flag-off DOM");
  assert.ok(schoolApp.includes("requestedTarget?.isConnected ? requestedTarget : fallbackTarget"), "Focus restore must reject detached targets");
  assert.ok(!schoolApp.includes('document.querySelector<HTMLElement>(".action-modal")'), "Help must not guess a global overlay target");

  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .help-button-root', { topLevel: true }), {
    position: "fixed",
    right: "var(--space-6)",
    bottom: "var(--space-6)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .help-button', { topLevel: true }), {
    width: "var(--control-height-md)",
    height: "var(--control-height-md)",
    "border-radius": "var(--ds-radius-md)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .help-panel', { topLevel: true }), {
    "max-height": "min(480px, calc(100svh - 144px))",
    "overflow-y": "auto",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .help-button-root', { atRule: "@media (max-width: 767px)" }), {
    bottom: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px) + var(--space-3))",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .l0-app:has(.messages-shell) > .help-button-root', { topLevel: true }), {
    right: "calc(var(--space-20) + var(--space-20) + var(--space-3))",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .l0-app:has(.messages-shell) > .help-button-root', { atRule: "@media (max-width: 800px)" }), {
    right: "calc(var(--space-16) + var(--space-3))",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .action-modal > .help-button-root', { topLevel: true }), {
    position: "absolute",
    top: "var(--space-5)",
    right: "calc(var(--space-6) + var(--control-height-md) + var(--space-3))",
    bottom: "auto",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .action-modal > .help-button-root .help-panel', { topLevel: true }), {
    position: "fixed",
    top: "var(--space-4)",
    right: "var(--space-4)",
    bottom: "auto",
    "max-height": "calc(50svh - var(--space-4))",
  });

  const marker = tokens.indexOf("DS-04 — shared component contract.");
  const ds04Start = marker < 0 ? -1 : tokens.indexOf("*/", marker) + 2;
  assert.ok(marker >= 0 && ds04Start > 1, "DS-04 component layer is required");
  const pageShellPadding = parseCssRules(tokens.slice(ds04Start))
    .filter((rule) => splitSelectorList(rule.selector).some((selector) => selector.includes(".page-shell")))
    .flatMap((rule) => declarationEntries(rule.body))
    .filter(([property]) => property === "padding-bottom");
  assert.deepEqual(pageShellPadding, [], "HelpButton must not reserve page padding or make layouts jump");
});

test("DS-04 typography, logo, fields, and status pill use exact approved roles", () => {
  const root = exactRule(tokens, ":root", { topLevel: true });
  assertDeclarations(root, {
    "--text-h3-size": "20px",
    "--text-h3-line": "28px",
    "--text-body-size": "16px",
    "--text-body-line": "24px",
    "--text-small-size": "14px",
    "--text-small-line": "20px",
    "--text-caption-size": "12px",
    "--text-caption-line": "16px",
    "--ds-radius-pill": "999px",
  });

  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .page-heading h1', { topLevel: true }), {
    "font-size": "var(--text-h1-size)",
    "font-weight": "var(--font-weight-bold)",
    "line-height": "var(--text-h1-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.l0-app, .gate-stage) h1', { topLevel: true }), {
    "font-size": "var(--text-h1-size)",
    "font-weight": "var(--font-weight-bold)",
    "line-height": "var(--text-h1-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .section-title h2', { topLevel: true }), {
    "font-size": "var(--text-h2-size)",
    "font-weight": "var(--font-weight-bold)",
    "line-height": "var(--text-h2-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.l0-app, .gate-stage, .modal-backdrop) h3', { topLevel: true }), {
    "font-size": "var(--text-h3-size)",
    "font-weight": "var(--font-weight-semibold)",
    "line-height": "var(--text-h3-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.l0-app, .gate-stage, .modal-backdrop) :is(input, select, textarea)', { topLevel: true }), {
    "font-size": "var(--text-body-size)",
    "font-weight": "var(--font-weight-regular)",
    "line-height": "var(--text-body-line)",
  });
  const sharedInteractiveText = `html[data-design-code="v1"] :is(.gate-stage, .modal-backdrop) :is(button, a[href]),
    html[data-design-code="v1"] .l0-app :is(button, a[href]):not(.l0-bottom-nav button)`;
  assertDeclarations(exactRule(tokens, sharedInteractiveText, { topLevel: true }), {
    "font-size": "var(--text-small-size)",
    "font-weight": "var(--font-weight-semibold)",
    "line-height": "var(--text-small-line)",
  });
  assert.ok(sharedInteractiveText.includes(":not(.l0-bottom-nav button)"), "DS-04 typography must not resize the accepted 64px shell navigation");
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.l0-app, .gate-stage, .modal-backdrop) :is(p, li, dd)', { topLevel: true }), {
    "font-size": "var(--text-body-size)",
    "font-weight": "var(--font-weight-regular)",
    "line-height": "var(--text-body-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.l0-app, .gate-stage, .modal-backdrop) :is(small, cite)', { topLevel: true }), {
    "font-size": "var(--text-small-size)",
    "font-weight": "var(--font-weight-regular)",
    "line-height": "var(--text-small-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.l0-app, .gate-stage, .modal-backdrop) :is(dt, em, .eyebrow, .item-overline, .status-pill)', { topLevel: true }), {
    "font-size": "var(--text-caption-size)",
    "font-weight": "var(--font-weight-medium)",
    "line-height": "var(--text-caption-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .event-compact-list button > span:is(:first-child, :nth-child(2)) strong', { topLevel: true }), {
    "font-size": "var(--text-body-size)",
    "font-weight": "var(--font-weight-semibold)",
    "line-height": "var(--text-body-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .event-compact-list button > span:is(:first-child, :nth-child(2)) small', { topLevel: true }), {
    "font-size": "var(--text-small-size)",
    "font-weight": "var(--font-weight-regular)",
    "line-height": "var(--text-small-line)",
    "text-transform": "none",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .status-pill', { topLevel: true }), {
    "border-radius": "var(--ds-radius-pill)",
    "font-size": "var(--text-caption-size)",
    "line-height": "var(--text-caption-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.action-modal h2, .child-profile h2, .missing-invite h2)', { topLevel: true }), {
    "font-size": "var(--text-h3-size)",
    "font-weight": "var(--font-weight-semibold)",
    "line-height": "var(--text-h3-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .l0-app .l0-brand strong', { topLevel: true }), {
    "font-size": "18px",
    "font-weight": "var(--font-weight-semibold)",
    "line-height": "24px",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .mobile-brand strong', { topLevel: true }), {
    "font-size": "18px",
    "font-weight": "var(--font-weight-semibold)",
    "line-height": "24px",
  });

  const logoSelector = `html[data-design-code="v1"] .l0-brand img,
    html[data-design-code="v1"] .mobile-brand img`;
  assertDeclarations(exactRule(tokens, logoSelector, { topLevel: true }), {
    width: "32px",
    height: "32px",
    "border-radius": "0",
    "box-shadow": "none",
  });
  assert.ok(schoolApp.includes("width={44} height={44}"), "Flag-off desktop logo intrinsic size must stay intact");
  assert.ok(schoolApp.includes("width={36} height={36}"), "Flag-off mobile logo intrinsic size must stay intact");

  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .form-field', { topLevel: true }), {
    gap: "var(--space-2)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .form-error-slot', { topLevel: true }), {
    "min-height": "calc(var(--text-small-line) + var(--space-5))",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .form-error-slot > .form-error', { topLevel: true }), {
    padding: "var(--space-2) var(--space-3)",
    "border-radius": "var(--ds-radius-md)",
    background: "var(--danger-50)",
    color: "var(--danger-500)",
    "font-size": "var(--text-small-size)",
    "line-height": "var(--text-small-line)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .form-field :is(input, select, textarea):disabled', { topLevel: true }), {
    background: "var(--color-surface-muted)",
    color: "var(--color-text-secondary)",
    cursor: "not-allowed",
  });

  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .action-modal', { topLevel: true }), {
    width: "min(640px, 100%)",
    "max-height": "88vh",
    "border-radius": "var(--ds-radius-xl)",
    "grid-template-rows": "auto minmax(0, 1fr)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .modal-backdrop', { topLevel: true }), {
    padding: "var(--space-5)",
    "align-items": "center",
    "justify-content": "center",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .modal-backdrop', { atRule: "@media (max-width: 767px)" }), {
    padding: "0",
    "align-items": "end",
    "justify-content": "center",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .action-modal form', { topLevel: true }), {
    overflow: "hidden",
    display: "grid",
    "grid-template-rows": "minmax(0, 1fr) auto",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .action-modal .form-grid', { topLevel: true }), {
    padding: "var(--space-6)",
    "overflow-y": "auto",
  });
});

test("DS-04 buttons expose real busy state and a width-stable label grid", () => {
  const buttonSelector = `html[data-design-code="v1"] .primary-btn,
    html[data-design-code="v1"] .ghost-btn,
    html[data-design-code="v1"] .text-action,
    html[data-design-code="v1"] .journal-row > button`;
  assertDeclarations(exactRule(tokens, buttonSelector, { topLevel: true }), {
    height: "var(--control-height-md)",
    "min-height": "var(--control-height-md)",
    "border-radius": "var(--ds-radius-md)",
    "padding-inline": "var(--space-4)",
    "font-size": "var(--text-small-size)",
    "font-weight": "var(--font-weight-semibold)",
    "line-height": "var(--text-small-line)",
  });
  for (const selector of [
    'html[data-design-code="v1"] .primary-btn:hover:not(:disabled)',
    'html[data-design-code="v1"] .primary-btn:active:not(:disabled)',
    'html[data-design-code="v1"] .ghost-btn:hover:not(:disabled)',
    'html[data-design-code="v1"] .ghost-btn:active:not(:disabled)',
    'html[data-design-code="v1"] .danger-btn:hover:not(:disabled)',
    'html[data-design-code="v1"] .danger-btn:active:not(:disabled)',
  ]) exactRule(tokens, selector, { topLevel: true });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.teacher-action-grid button, .student-launch-grid button):hover', { topLevel: true }), {
    transform: "none",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .student-launch-grid button', { topLevel: true }), {
    "border-radius": "var(--ds-radius-md)",
    "box-shadow": "var(--shadow-sm)",
  });

  const reducedMotionSelector = `html[data-design-code="v1"] :is(
    .primary-btn,
    .ghost-btn,
    .text-action,
    .tab-row > button,
    .ranking-tabs > button,
    .registration-tabs > button,
    .segmented > button,
    .teacher-action-grid button,
    .student-launch-grid button
  )`;
  assertDeclarations(exactRule(tokens, reducedMotionSelector, { atRule: "@media (prefers-reduced-motion: reduce)" }), {
    transition: "none",
  });

  const busySelector = `html[data-design-code="v1"] :is(.primary-btn, .ghost-btn, .danger-btn)[aria-busy="true"],
    html[data-design-code="v1"] :is(.primary-btn, .ghost-btn, .danger-btn).is-loading`;
  assertDeclarations(exactRule(tokens, busySelector, { topLevel: true }), {
    cursor: "progress",
    "pointer-events": "none",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .button-label-stack', { topLevel: true }), {
    display: "inline-grid",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .button-label-stack > span', { topLevel: true }), {
    "grid-area": "1 / 1",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .button-label-stack > .is-hidden', { topLevel: true }), {
    visibility: "hidden",
  });

  const stableLabel = normalizeCss(sourceBetween(schoolApp, "function StableStateLabel", "function HelpButton"));
  for (const fragment of [
    "if (!designCodeV1) return <>{labels[state]}</>",
    'className="button-label-stack"',
    'aria-live="polite"',
    "Object.entries(labels)",
    'className={cn(state !== labelState && "is-hidden")}',
    "aria-hidden={state !== labelState}",
    '<StableStateLabel state={busy ? "busy" : "idle"} labels={{ idle, busy: busyText }} />',
  ]) assert.ok(stableLabel.includes(fragment), `StableButtonLabel is incomplete: ${fragment}`);

  const actionModal = sourceBetween(schoolApp, "function ActionModal", "function RegistrationGate");
  const registrationGate = sourceBetween(schoolApp, "function RegistrationGate", "function InviteResultModal");
  assert.equal((actionModal.match(/aria-busy=\{designCodeV1 \? busy : undefined\}/g) ?? []).length, 2);
  assert.ok(actionModal.includes("<StableButtonLabel busy={busy}"));
  assert.equal((registrationGate.match(/aria-busy=\{designCodeV1 \? busy : undefined\}/g) ?? []).length, 2);
  assert.equal((registrationGate.match(/<StableButtonLabel\b/g) ?? []).length, 2);
  assert.ok(schoolApp.includes("aria-busy={designCodeV1 ? sending : undefined}"), "Message submit must expose its real sending state");
  assert.ok(schoolApp.includes("aria-busy={designCodeV1 ? copying : undefined}"), "Copy submit must expose its real copying state");
  assert.ok(schoolApp.includes('<StableStateLabel state={copying ? "busy" : copied ? "success" : "idle"}'));
});

test("DS-04 applies the full shared card inventory at 24px and 16px", () => {
  const root = exactRule(tokens, ":root", { topLevel: true });
  assertDeclarations(root, {
    "--card-padding": "24px",
    "--card-padding-compact": "16px",
  });
  const cardSelector = `html[data-design-code="v1"] :is(
    .content-card,
    .metric-card,
    .homework-item,
    .feature-card,
    .comment-list > article,
    .menu-grid > article,
    .event-grid > article,
    .activity-grid > article,
    .subscription-grid > article,
    .teacher-action-grid > button,
    .admin-actions > button,
    .staff-card,
    .achievement-grid > article,
    .grade-item,
    .program-grid > button,
    .student-directory > button,
    .class-grid > .class-card
  )`;
  assertDeclarations(exactRule(tokens, cardSelector, { topLevel: true }), {
    border: "1px solid var(--color-border)",
    "border-radius": "var(--ds-radius-lg)",
    padding: "var(--card-padding)",
    background: "var(--color-surface)",
    "box-shadow": "var(--shadow-sm)",
  });
  assertDeclarations(exactRule(tokens, cardSelector, { atRule: "@media (max-width: 767px)" }), {
    padding: "var(--card-padding-compact)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .admin-readiness', { topLevel: true }), {
    "border-radius": "var(--ds-radius-xl)",
    "box-shadow": "var(--shadow-sm)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .menu-grid > article.featured', { topLevel: true }), {
    "border-color": "var(--featured-card-border)",
    "box-shadow": "var(--featured-card-shadow)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .metric-button:hover', { topLevel: true }), {
    transform: "none",
  });
});

test("DS-04 gives both visual tables a complete ARIA table contract", () => {
  const root = exactRule(tokens, ":root", { topLevel: true });
  assertDeclarations(root, {
    "--table-head-height": "44px",
    "--table-row-height": "56px",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.journal-table, .admin-table)', { topLevel: true }), {
    border: "1px solid var(--color-border)",
    "border-radius": "var(--ds-radius-lg)",
    "table-layout": "fixed",
    "overflow-x": "auto",
    background: "var(--color-surface)",
    "box-shadow": "var(--shadow-sm)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.journal-head, .admin-table-head)', {
    topLevel: true,
    declarations: { "min-height": "var(--table-head-height)" },
  }), {
    "min-height": "var(--table-head-height)",
    "border-radius": "0",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.journal-row, .admin-table-row)', { topLevel: true }), {
    "min-height": "var(--table-row-height)",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] :is(.journal-head, .journal-row)', { topLevel: true }), {
    "min-width": "690px",
    "grid-template-columns": "minmax(230px, 1.2fr) 90px minmax(160px, 0.8fr) 85px",
  });
  assertDeclarations(exactRule(tokens, 'html[data-design-code="v1"] .admin-table', { atRule: "@media (max-width: 800px)" }), {
    display: "block",
    "overflow-x": "auto",
  });

  const journal = sourceBetween(schoolApp, "function StudyPage", "function CalendarPage");
  const admin = sourceBetween(schoolApp, "function AdminManagement", "const modalTitles");
  for (const [name, source] of [["journal", journal], ["admin", admin]]) {
    assert.ok(source.includes('role={designCodeV1 ? "table" : undefined}'), `${name} is missing role=table`);
    assert.ok(source.includes("aria-colcount={designCodeV1 ? 4 : undefined}"), `${name} is missing aria-colcount=4`);
    assert.equal((source.match(/role=\{designCodeV1 \? "row" : undefined\}/g) ?? []).length, 2, `${name} needs header and body row roles`);
    assert.equal((source.match(/role=\{designCodeV1 \? "columnheader" : undefined\}/g) ?? []).length, 4, `${name} needs four column headers`);
  }
  assert.equal((journal.match(/role=\{designCodeV1 \? "cell" : undefined\}/g) ?? []).length, 3, "Journal has three direct cells plus TableActionCell");
  assert.ok(journal.includes("<TableActionCell>"));
  assert.equal((admin.match(/role=\{designCodeV1 \? "cell" : undefined\}/g) ?? []).length, 4, "Admin rows need four cells");
  const tableAction = normalizeCss(sourceBetween(schoolApp, "function TableActionCell", "function SectionTitle"));
  assert.ok(tableAction.includes("if (!designCodeV1) return <>{children}</>;"));
  assert.ok(tableAction.includes('className="table-action-cell" role="cell"'));
});

test("DS-04 semantic debt preserves every flag-off pair and remaps every v1 pair", () => {
  const legacyRoot = exactRule(tokens, ":root", { topLevel: true });
  const legacyPairs = {
    "--status-neutral-text": "#66645e",
    "--status-neutral-background": "#f0efeb",
    "--status-neutral-border": "transparent",
    "--status-success-text": "#19724e",
    "--status-success-background": "#e4f5ec",
    "--status-success-border": "transparent",
    "--status-warning-text": "#91600f",
    "--status-warning-background": "#fff0d2",
    "--status-warning-border": "transparent",
    "--status-danger-text": "#aa3535",
    "--status-danger-background": "#ffe8e8",
    "--status-danger-border": "transparent",
    "--status-info-text": "#286c99",
    "--status-info-background": "#e5f2fa",
    "--status-info-border": "transparent",
    "--capacity-track-background": "#eeeae3",
    "--capacity-track-fill": "var(--orange)",
    "--featured-card-border": "#efc6b4",
    "--featured-card-shadow": "0 14px 35px rgba(232, 68, 18, 0.07)",
    "--warning-state-text": "#88682c",
    "--warning-state-icon": "var(--amber)",
    "--warning-state-background": "#fff1d6",
    "--warning-state-border": "transparent",
    "--danger-state-text": "var(--danger)",
    "--danger-state-icon": "var(--danger)",
    "--danger-state-background": "#ffe9e9",
    "--info-state-text": "var(--blue)",
    "--info-state-icon": "var(--blue)",
    "--info-state-background": "#e8f3fa",
  };
  assertDeclarations(legacyRoot, legacyPairs);

  const v1Root = exactRule(tokens, 'html[data-design-code="v1"]', { topLevel: true });
  assertDeclarations(v1Root, {
    "--status-neutral-text": "var(--color-text)",
    "--status-neutral-background": "var(--color-surface-muted)",
    "--status-neutral-border": "var(--color-border-strong)",
    "--status-success-text": "var(--color-text)",
    "--status-success-background": "var(--success-50)",
    "--status-success-border": "var(--success-500)",
    "--status-warning-text": "var(--color-text)",
    "--status-warning-background": "var(--warning-50)",
    "--status-warning-border": "var(--warning-500)",
    "--status-danger-text": "var(--color-text)",
    "--status-danger-background": "var(--danger-50)",
    "--status-danger-border": "var(--danger-500)",
    "--status-info-text": "var(--color-text)",
    "--status-info-background": "var(--info-50)",
    "--status-info-border": "var(--info-500)",
    "--capacity-track-background": "var(--color-surface-muted)",
    "--capacity-track-fill": "var(--color-accent)",
    "--featured-card-border": "var(--color-border-strong)",
    "--featured-card-shadow": "var(--shadow-sm)",
    "--warning-state-text": "var(--color-text)",
    "--warning-state-icon": "var(--warning-500)",
    "--warning-state-background": "var(--warning-50)",
    "--warning-state-border": "var(--warning-500)",
    "--danger-state-text": "var(--color-text)",
    "--danger-state-icon": "var(--danger-500)",
    "--danger-state-background": "var(--danger-50)",
    "--info-state-text": "var(--color-text)",
    "--info-state-icon": "var(--info-500)",
    "--info-state-background": "var(--info-50)",
  });

  const globalsWithoutComments = stripCssComments(globals).toLowerCase();
  for (const token of [
    "--status-neutral-text", "--status-neutral-background",
    "--status-success-text", "--status-success-background",
    "--status-warning-text", "--status-warning-background",
    "--status-danger-text", "--status-danger-background",
    "--status-info-text", "--status-info-background",
    "--capacity-track-background", "--capacity-track-fill",
    "--featured-card-border", "--featured-card-shadow",
    "--warning-state-text", "--warning-state-icon", "--warning-state-background",
    "--danger-state-icon", "--danger-state-background",
    "--info-state-icon", "--info-state-background",
  ]) {
    assert.ok(globalsWithoutComments.includes(`var(${token})`), `globals.css must consume semantic alias ${token}`);
  }
  for (const raw of [
    "#66645e", "#f0efeb", "#19724e", "#e4f5ec", "#91600f", "#fff0d2",
    "#aa3535", "#ffe8e8", "#286c99", "#e5f2fa", "#eeeae3", "#efc6b4",
    "#88682c", "#fff1d6", "#ffe9e9", "#e8f3fa",
  ]) assert.ok(!globalsWithoutComments.includes(raw), `Raw semantic debt remains in globals.css: ${raw}`);
  assert.ok(!normalizeCss(globalsWithoutComments).includes("0 14px 35px rgba(232, 68, 18, 0.07)"));
});

test("DS-04 student theme is v1-scoped and cannot own component geometry", () => {
  const studentRules = parseCssRules(studentTheme);
  const v1StudentRules = studentRules.filter((rule) =>
    splitSelectorList(rule.selector).some((selector) => selector.startsWith('html[data-design-code="v1"][data-theme="student"]')),
  );
  assert.ok(v1StudentRules.length > 10, "Approved student theme rules are required");

  const forbiddenGeometry = /^(?:width|height|min-width|max-width|min-height|max-height|inline-size|block-size|min-inline-size|max-inline-size|min-block-size|max-block-size|aspect-ratio|box-sizing|margin(?:-.+)?|padding(?:-.+)?|gap|row-gap|column-gap|display|visibility|position|inset(?:-.+)?|top|right|bottom|left|z-index|grid(?:-.+)?|flex(?:-.+)?|align(?:-.+)?|justify(?:-.+)?|place(?:-.+)?|order|overflow(?:-.+)?|overscroll-behavior(?:-.+)?|transform|translate|rotate|scale|object-fit|object-position|float|clear|columns|column-count|column-width|contain|content-visibility|clip|clip-path|pointer-events)$/;
  for (const rule of v1StudentRules) {
    for (const selector of splitSelectorList(rule.selector)) {
      assert.ok(
        selector.startsWith('html[data-design-code="v1"][data-theme="student"]'),
        `Student selector escaped its feature/theme boundary: ${selector}`,
      );
    }
    for (const [property, value] of declarationEntries(rule.body)) {
      const ownsBorderGeometry = property === "border"
        || (property.startsWith("border-") && property !== "border-color" && !property.endsWith("-color"));
      assert.ok(!forbiddenGeometry.test(property) && !ownsBorderGeometry, `Student theme owns ${property} in ${rule.selector}`);
      assert.ok(!/(?:#[0-9a-f]{3,8}\b|rgba?\(|(?:linear|radial)-gradient\()/i.test(value), `Raw student color in ${property}: ${value}`);
    }
  }
  assertDeclarations(exactRule(studentTheme, 'html[data-design-code="v1"][data-theme="student"]', { topLevel: true }), {
    "--featured-card-shadow": "var(--shadow-sm)",
    "--status-warning-border": "var(--warning-500)",
    "--student-font-family": "var(--font-sans)",
  });
  const studentActiveTabs = `html[data-design-code="v1"][data-theme="student"] .role-student :is(
    .tab-row,
    .ranking-tabs,
    .segmented
  ) > button[aria-selected="true"]`;
  assertDeclarations(exactRule(studentTheme, studentActiveTabs, { topLevel: true }), {
    background: "var(--student-action)",
    color: "var(--student-on-dark)",
  });
});

test("DS-04 stays merge-blocking and inert when its feature flag is off", () => {
  assert.ok(schoolApp.includes('const designCodeV1 = process.env.NEXT_PUBLIC_SCHOOL_DESIGN_V1 === "true";'));
  assert.ok(schoolApp.includes("if (!designCodeV1) return <>{children}</>;"), "TabPanel flag-off markup must remain unchanged");
  assert.ok(schoolApp.includes("if (!designCodeV1) return <>{labels[state]}</>;"), "Stable label flag-off markup must remain unchanged");
  assert.ok(schoolApp.includes("if (!designCodeV1) return <>{children}</>;"), "TableActionCell flag-off markup must remain unchanged");
  assert.ok(schoolApp.includes("{designCodeV1 ? <HelpButton"), "HelpButton must not render flag-off");
  for (const fragment of [
    'role={designCodeV1 ? "tablist" : undefined}',
    'role={designCodeV1 ? "tab" : undefined}',
    'aria-label={designCodeV1 ? ariaLabel : legacyAriaLabel}',
    'type={designCodeV1 ? "button" : legacyButtonType}',
    'role={designCodeV1 ? "table" : undefined}',
    "aria-colcount={designCodeV1 ? 4 : undefined}",
    "width={44} height={44}",
    "width={36} height={36}",
  ]) assert.ok(schoolApp.includes(fragment), `Feature-off guard is missing: ${fragment}`);
  assert.ok(
    schoolApp.includes('legacyAriaLabel="Показатель рейтинга"'),
    "The legacy ranking aria-label must survive flag-off",
  );
  assert.ok(
    schoolApp.includes('legacyButtonType="button"'),
    "The legacy registration tab button type must survive flag-off",
  );
  for (const fragment of [
    "title={designCodeV1 ? student.fullName : undefined}",
    "title={designCodeV1 ? user.displayName : undefined}",
    "title={designCodeV1 ? email : undefined}",
    "title={designCodeV1 ? child?.fullName : undefined}",
  ]) assert.ok(schoolApp.includes(fragment), `Flag-off title leaked from v1: ${fragment}`);

  const marker = tokens.indexOf("DS-04 — shared component contract.");
  const ds04Start = marker < 0 ? -1 : tokens.indexOf("*/", marker) + 2;
  assert.ok(marker >= 0 && ds04Start > 1, "DS-04 component layer is required");
  for (const rule of parseCssRules(tokens.slice(ds04Start))) {
    for (const selector of splitSelectorList(rule.selector)) {
      assert.ok(selector.startsWith('html[data-design-code="v1"]'), `Unscoped DS-04 selector: ${selector}`);
    }
  }
  assert.ok(!stripCssComments(tokens).includes("!important"), "DS-04 must not win the cascade with !important");
});
