import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [tokens, layout, dockerfile, login, designCodePointer] =
  await Promise.all([
    readFile(new URL("../app/design-tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../DESIGN_CODE.md", import.meta.url), "utf8"),
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
  assert.match(designCodePointer, /status этого файла: \`POINTER_ONLY\`/);
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
