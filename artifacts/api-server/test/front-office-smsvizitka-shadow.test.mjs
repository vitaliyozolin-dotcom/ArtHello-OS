import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(
  new URL("../src/routes/front-office-smsvizitka.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(
  new URL("../src/routes/index.ts", import.meta.url),
  "utf8",
);
const uiSource = readFileSync(
  new URL(
    "../../alpha-crm-sync/src/features/front-office/channel-inbox-workspace.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("SMS-Vizitka adapter is mounted and fail-closed", () => {
  assert.match(indexSource, /smsVizitkaShadowRouter/);
  assert.match(routeSource, /SMSVIZITKA_SHADOW_ENABLED/);
  assert.match(routeSource, /SMSVIZITKA_WEBHOOK_TOKEN/);
  assert.match(routeSource, /FRONT_OFFICE_PHONE_MATCH_SECRET/);
  assert.match(routeSource, /timingSafeEqual/);
  assert.match(routeSource, /status\(423\)/);
  assert.match(routeSource, /status\(401\)/);
});

test("SHADOW adapter deduplicates events and never exposes outbound send", () => {
  assert.match(routeSource, /ON CONFLICT \(hash\) DO NOTHING/);
  assert.match(routeSource, /payload\.action === 4/);
  assert.doesNotMatch(routeSource, /send-sms/);
  assert.doesNotMatch(routeSource, /message_type[^\n]*outgoing/i);
  assert.match(routeSource, /outboundEnabled: false/);
});

test("phone matching avoids exposing the full number in the inbox", () => {
  assert.match(routeSource, /createHmac\("sha256"/);
  assert.match(routeSource, /contact_point_masked/);
  assert.doesNotMatch(routeSource, /SELECT[^;]*number[^;]*FROM raw_events/is);
});

test("Front Office UI clearly blocks customer replies in SHADOW", () => {
  assert.match(uiSource, /SHADOW/);
  assert.match(uiSource, /OUTBOUND OFF/);
  assert.match(uiSource, /Ответ клиенту будет включён только после теста/);
  assert.doesNotMatch(uiSource, /sendChannelMessage|sendMessage|send-sms/);
});
