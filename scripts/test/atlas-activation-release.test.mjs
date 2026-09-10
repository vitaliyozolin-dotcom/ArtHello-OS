import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/deploy-atlas-d122.yml",
  "utf8",
);
const release = readFileSync("deploy/activate-atlas-d122.sh", "utf8");

test("Atlas production job is main-quality and protected-environment gated", () => {
  assert.match(workflow, /workflow_run:\n[\s\S]*workflows: \[Quality gates\]/);
  assert.match(workflow, /environment: production-ru/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(
    workflow,
    /github\.event\.workflow_run\.conclusion == 'success'/,
  );
  assert.match(
    workflow,
    /startsWith\(github\.event\.workflow_run\.head_commit\.message, 'D122: guarded Atlas activation'\)/,
  );
  assert.match(
    workflow,
    /runs-on: \[self-hosted, linux, x64, arthello-gateway\]/,
  );
});

test("Atlas source and observed central runtime are immutable pins", () => {
  for (const value of [
    "987abd5951dc4832e2c071d8744051c518bae42e",
    "1dccbd1fea14838bde0319014f7509b572b06061",
    "9909bd54d31244627477bd60c3b8e7cc6cd84758902943e54eb555206c4a1142",
    "sha256:34402014063a05c81754716f46b3f9059297f1d21d37da7e5f00b1eb8f7fdd46",
    "ff8559254faaedade63a9ee7567a45686d08c13a",
  ]) {
    assert.match(workflow + release, new RegExp(value));
  }
  assert.match(release, /require_main\n/);
  assert.ok((release.match(/require_main/g) ?? []).length >= 4);
});

test("central and Atlas secrets stay file-mounted in Docker configuration", () => {
  assert.doesNotMatch(release, /-e\s+ATLAS_CENTRAL_ACCESS_SECRET=/);
  assert.doesNotMatch(release, /-e\s+CENTRAL_ACCESS_SECRET=/);
  assert.match(
    release,
    /ATLAS_CENTRAL_ACCESS_SECRET_FILE=\/run\/secrets\/atlas-central-access-secret/,
  );
  assert.match(
    release,
    /type=bind,src=\$atlas_key,dst=\/run\/secrets\/atlas-central-access-secret,readonly/,
  );
  assert.match(
    release,
    /export CENTRAL_ACCESS_SECRET="\$\(cat \/run\/secrets\/atlas-central-access-secret\)"/,
  );
  assert.match(release, /! cmp -s "\$atlas_key" "\$central_key"/);
});

test("route publication is compare-and-swap and rollback restores the original route", () => {
  assert.match(release, /before_sha="\$\(sha256sum "\$routes_before"/);
  assert.match(release, /test "\$\(sha256sum \/data\/external-routes\.caddy/);
  assert.match(release, /mv "\$NEW_ROUTE" \/data\/external-routes\.caddy/);
  assert.match(release, /if \[ "\$route_changed" -eq 1 \]/);
  assert.match(release, /cp '\$route_recovery' \/data\/external-routes\.caddy/);
  assert.match(release, /docker start "\$expected_live_id"/);
});

test("public acceptance covers central, School, Atlas and the SSO redirect", () => {
  assert.match(release, /"\$central_origin\/api\/health"/);
  assert.match(release, /"\$school_origin\/api\/health"/);
  assert.match(release, /"\$atlas_origin\/api\/health"/);
  assert.match(release, /test "\$open_status" = 303/);
  assert.match(release, /location: \$atlas_origin\/auth\/central\/start/);
  assert.match(release, /naturalBrowserAcceptance:false/);
});
