import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  normalizeRuntimeEnv,
  renderCentralRoute,
} from "../../deploy/atlas-runtime-recovery-d185.mjs";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const runtimeFingerprintProjection = (inspect) => {
  const result = spawnSync(
    "jq",
    [
      "-cS",
      "-f",
      fileURLToPath(
        new URL(
          "../../deploy/v52/maintenance/image-runtime-fingerprint.jq",
          import.meta.url,
        ),
      ),
    ],
    { encoding: "utf8", input: JSON.stringify([inspect]) },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

test("Atlas runtime variables are restored without changing unrelated production settings", () => {
  const before = [
    "NODE_ENV=production",
    "RELEASE_SHA=95873e519113e93d9d52ac08166eb46b317e5c6e",
    "ATLAS_PUBLIC_ORIGIN=https://stale.example.invalid",
    "ATLAS_CENTRAL_ACCESS_SECRET_FILE=/wrong/secret",
    "ALFACRM_IMPORT_ENABLED=true",
  ].join("\n");

  const after = normalizeRuntimeEnv(
    before,
    "https://atlas-188-225-38-55.sslip.io",
  );

  assert.equal(
    after,
    [
      "NODE_ENV=production",
      "RELEASE_SHA=95873e519113e93d9d52ac08166eb46b317e5c6e",
      "ALFACRM_IMPORT_ENABLED=true",
      "ATLAS_PUBLIC_ORIGIN=https://atlas-188-225-38-55.sslip.io",
      "ATLAS_CENTRAL_ACCESS_SECRET_FILE=/run/secrets/atlas-central-access-secret",
      "",
    ].join("\n"),
  );
});

test("runtime normalization fails closed on ambiguous or plaintext secret input", () => {
  assert.throws(
    () =>
      normalizeRuntimeEnv(
        "NODE_ENV=production\nNODE_ENV=preview",
        "https://atlas.example",
      ),
    /duplicate runtime variable: NODE_ENV/,
  );
  assert.throws(
    () =>
      normalizeRuntimeEnv(
        "CENTRAL_ACCESS_SECRET=plaintext",
        "https://atlas.example",
      ),
    /plaintext secret environment is not permitted/,
  );
  assert.throws(
    () => normalizeRuntimeEnv("NODE_ENV=production", "http://atlas.example"),
    /Atlas origin must be HTTPS/,
  );
});

test("central route replacement changes only the exact ArtHello upstream", () => {
  const before = [
    "arthello.example { reverse_proxy arthello-direct-34819003014-1:8081 }",
    "pay.example {",
    "  handle /api/* { reverse_proxy arthello-direct-34819003014-1:8081 }",
    "  root * /data/arthello-pay-assets-95873e519113e93d9d52ac08166eb46b317e5c6e",
    "}",
  ].join("\n");

  const after = renderCentralRoute(
    before,
    "arthello-direct-34819003014-1",
    "arthello-direct-35000000000-1",
  );

  assert.equal(after.match(/arthello-direct-35000000000-1:8081/g)?.length, 2);
  assert.doesNotMatch(after, /arthello-direct-34819003014-1:8081/);
  assert.match(
    after,
    /arthello-pay-assets-95873e519113e93d9d52ac08166eb46b317e5c6e/,
  );
  assert.throws(
    () =>
      renderCentralRoute(
        "reverse_proxy arthello-direct-34819003014-1:8081",
        "arthello-direct-34819003014-1",
        "arthello-direct-35000000000-1",
      ),
    /expected at least two exact central upstream references/,
  );
});

test("Atlas runtime fingerprint ignores daemon-local identity but detects runtime drift", () => {
  const runtime = {
    Architecture: "amd64",
    Os: "linux",
    Created: "2026-09-14T00:00:00Z",
    Config: {
      User: "1001:1001",
      Env: ["NODE_ENV=production"],
      Entrypoint: ["docker-entrypoint.sh"],
      Cmd: ["node", "server.js"],
      Labels: {
        "org.opencontainers.image.revision":
          "f856fb3bd098152bb6b02c4d0273c4c9170b130c",
      },
    },
    RootFS: { Type: "layers", Layers: ["sha256:" + "a".repeat(64)] },
  };
  const builder = {
    ...runtime,
    Id: "sha256:" + "b".repeat(64),
    RepoTags: ["atlas-diary:builder"],
    History: [{ CreatedBy: "builder-store" }],
  };
  const gateway = {
    ...runtime,
    Id: "sha256:" + "c".repeat(64),
    RepoTags: ["atlas-diary:gateway"],
    History: [{ CreatedBy: "gateway-store" }],
  };

  assert.equal(
    runtimeFingerprintProjection(builder),
    runtimeFingerprintProjection(gateway),
  );
  assert.notEqual(
    runtimeFingerprintProjection(builder),
    runtimeFingerprintProjection({
      ...gateway,
      Config: { ...gateway.Config, Env: ["NODE_ENV=preview"] },
    }),
  );
});

test("D185 production workflow is manual, protected, Atlas-only and independently verified", () => {
  const workflow = read(".github/workflows/deploy-diaries-d133.yml");
  const release = read("deploy/release-atlas-d185.sh");
  const upgrade = read("deploy/upgrade-atlas-d185.sh");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /DEPLOY D185 TO PRODUCTION/);
  assert.match(workflow, /environment: production-ru/);
  assert.match(
    workflow,
    /runs-on: \[self-hosted, linux, x64, arthello-gateway\]/,
  );
  assert.match(
    workflow,
    /ATLAS_SOURCE_SHA: f856fb3bd098152bb6b02c4d0273c4c9170b130c/,
  );
  assert.match(
    workflow,
    /ATLAS_SOURCE_TREE: e63e28520670527bc12d84abcd45cd8fffe2b876/,
  );
  assert.match(workflow, /Verify exact D185 from an independent network/);
  assert.doesNotMatch(
    workflow,
    /ARTHELLO_RU_SSH_PRIVATE_KEY|school-curriculum-standalone-cutover/,
  );

  for (const marker of [
    "ATLAS_D185_PREDECESSOR=VERIFIED",
    "ATLAS_D185_BACKUP=VERIFIED",
    "ATLAS_D185_CENTRAL_SSO_OPEN=VERIFIED",
    "ATLAS_D185_OWNER_SSO=VERIFIED",
    "ATLAS_D185_ROLLBACK=STARTED",
    "ATLAS_D185_PRODUCTION=VERIFIED",
  ])
    assert.match(release, new RegExp(marker));
  assert.doesNotMatch(release, /docker volume rm/);

  assert.match(workflow, /runtimeFingerprintSha256/);
  assert.match(upgrade, /image-runtime-fingerprint\.jq/);
  assert.match(upgrade, /ATLAS_IMAGE_RUNTIME_FINGERPRINT=VERIFIED/);
  assert.match(upgrade, /ATLAS_IMAGE_ID_REPRESENTATION/);
  assert.doesNotMatch(
    upgrade,
    /test "\$\(docker image inspect "\$image_ref" --format '\{\{\.Id\}\}'\)" = "\$expected_image"/,
  );
  assert.match(
    upgrade,
    /--user 0:0 --security-opt no-new-privileges:true \\\n+  --tmpfs \/tmp:rw,nosuid,nodev,size=32m --volume "\$backups_volume:\/backups:ro"/,
  );
  assert.match(
    upgrade,
    /docker run --rm --network none --read-only --user 0:0 \\\n+  --volume "\$backups_volume:\/backups:ro" --entrypoint sha256sum/,
  );
});
