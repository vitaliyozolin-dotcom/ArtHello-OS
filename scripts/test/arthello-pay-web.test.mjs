import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const index = read("pay-web/index.html");
const app = read("pay-web/app.js");
const css = read("pay-web/styles.css");
const caddy = read("deploy/Caddyfile");
const dockerfile = read("deploy/Dockerfile");
const apiApp = read("artifacts/api-server/src/app.ts");
const accessPolicy = read(
  "artifacts/api-server/src/lib/security/access-policy.ts",
);

test("ArtHello Pay has an isolated static web shell", () => {
  assert.match(index, /<title>ArtHello Pay<\/title>/);
  assert.match(index, /href="\/styles\.css"/);
  assert.match(index, /src="\/app\.js"/);
  assert.match(dockerfile, /COPY pay-web \/srv\/pay/);
});

test("ArtHello Pay uses the approved host convention and same-origin API proxy", () => {
  assert.match(caddy, /\{\$ARTHELLO_PAY_HOST:pay-188-225-38-55\.sslip\.io\}/);
  assert.match(caddy, /root \* \/srv\/pay/);
  assert.match(caddy, /@api path \/api\/\*/);
  assert.match(caddy, /reverse_proxy @api api:8080/);
});

test("operator UI never calls banking routes", () => {
  assert.doesNotMatch(app, /\/api\/banking/);
  assert.match(app, /\/api\/payments\/catalog/);
  assert.match(app, /\/api\/payments\/customers/);
  assert.match(app, /\/api\/payments\/obligations/);
  assert.match(app, /\/api\/payments\/requests/);
});

test("public payment link is bearer-scoped and stable", () => {
  assert.match(app, /\/p\/\$\{encodeURIComponent\(request\.paymentLinkId\)\}/);
  assert.match(apiApp, /\/payments\\\/public\\\/AH-/);
  assert.match(app, /\/api\/payments\/public\//);
});

test("payment operator catalog access stays scoped and banking remains excluded", () => {
  assert.match(accessPolicy, /\/payments\\\/catalog/);
  assert.match(accessPolicy, /\/payments\\\/customers/);
  assert.doesNotMatch(
    accessPolicy.match(/const PAYMENT_OPERATOR_ROUTES[\s\S]*?\];/)?.[0] ?? "",
    /banking/,
  );
});

test("ArtHello Pay follows the ArtHello design tokens and has a mobile layout", () => {
  assert.match(css, /--ah-bg:\s*#f6f7fc/i);
  assert.match(css, /--ah-primary:\s*#5b52f5/i);
  assert.match(css, /border-radius:\s*22px/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /\.mobile-bottom-nav/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
