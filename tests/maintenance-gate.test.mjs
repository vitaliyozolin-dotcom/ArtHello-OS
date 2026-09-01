import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SCHOOL_DEPLOY_READ_ONLY_CODE,
  SCHOOL_DEPLOY_READ_ONLY_MARKER,
  SCHOOL_DEPLOY_RETRY_AFTER_SECONDS,
  schoolDeployReadOnlyHeaders,
  schoolDeployReadOnlyPayload,
  schoolDeployReadOnlyState,
} from "../lib/maintenance-gate.mjs";
const proxySource = await readFile(
  new URL("../proxy.ts", import.meta.url),
  "utf8",
);

const writerPaths = [
  ["GET", "/api/school"],
  ["POST", "/api/school"],
  ["POST", "/api/auth/activate"],
  ["POST", "/api/auth/login"],
  ["GET", "/api/auth/logout"],
  ["GET", "/api/auth/passwordless/magic"],
  ["POST", "/api/auth/passwordless/request"],
  ["POST", "/api/auth/passwordless/verify"],
  ["POST", "/api/internal/family-access-sync"],
  ["POST", "/api/internal/staff-sync"],
  ["GET", "/auth/central/callback"],
  ["GET", "/auth/central/start"],
];

async function withTemporaryMarker(run) {
  const directory = await mkdtemp(join(tmpdir(), "school-maintenance-"));
  const markerPath = join(directory, ".school-deploy-read-only");
  const previous = process.env.SCHOOL_DEPLOY_READ_ONLY_FILE;
  process.env.SCHOOL_DEPLOY_READ_ONLY_FILE = markerPath;
  try {
    await run(markerPath);
  } finally {
    if (previous === undefined)
      delete process.env.SCHOOL_DEPLOY_READ_ONLY_FILE;
    else process.env.SCHOOL_DEPLOY_READ_ONLY_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("maintenance marker lookup is dependency-free and fails closed", async () => {
  assert.equal(
    SCHOOL_DEPLOY_READ_ONLY_MARKER,
    "/data/.school-deploy-read-only",
  );
  await withTemporaryMarker(async (markerPath) => {
    assert.deepEqual(schoolDeployReadOnlyState(), {
      active: false,
      markerPath,
      reason: "marker_absent",
    });
    await writeFile(markerPath, "release=test\n", "utf8");
    assert.deepEqual(schoolDeployReadOnlyState(), {
      active: true,
      markerPath,
      reason: "marker_present",
    });
    await rm(markerPath);
    await mkdir(markerPath);
    assert.equal(schoolDeployReadOnlyState().active, true);
  });
  assert.deepEqual(
    schoolDeployReadOnlyState({ SCHOOL_DEPLOY_READ_ONLY_FILE: "relative" }),
    {
      active: true,
      markerPath: "relative",
      reason: "invalid_marker_path",
    },
  );
  assert.equal(
    schoolDeployReadOnlyState({
      SCHOOL_DEPLOY_READ_ONLY_FILE: "/path-with-null-\0",
    }).active,
    true,
  );
});

test("proxy matcher centrally covers every production HTTP writer", () => {
  assert.match(
    proxySource,
    /matcher:\s*\["\/api\/:path\*",\s*"\/auth\/central\/:path\*"\]/,
  );
  assert.match(
    proxySource,
    /request\.nextUrl\.pathname === HEALTH_PATH[\s\S]*?NextResponse\.next\(\)/,
  );
  for (const [, path] of writerPaths) {
    assert.equal(
      path.startsWith("/api/") || path.startsWith("/auth/central/"),
      true,
      `${path} must remain inside the maintenance proxy matcher`,
    );
  }
});

test("gate exposes the exact non-cacheable deployment response contract", () => {
  assert.equal(SCHOOL_DEPLOY_READ_ONLY_CODE, "deployment_read_only");
  assert.equal(SCHOOL_DEPLOY_RETRY_AFTER_SECONDS, "30");
  assert.deepEqual(schoolDeployReadOnlyPayload(), {
    error: "Система временно работает в режиме обслуживания",
    code: "deployment_read_only",
  });
  assert.deepEqual(schoolDeployReadOnlyHeaders(), {
    "cache-control": "no-store",
    "retry-after": "30",
  });
  assert.match(proxySource, /status:\s*503/);
  assert.match(proxySource, /schoolDeployReadOnlyPayload\(\)/);
  assert.match(proxySource, /schoolDeployReadOnlyHeaders\(\)/);
});

test("the gate disappears with the marker", async () => {
  await withTemporaryMarker(async (markerPath) => {
    await writeFile(markerPath, "release=test\n", "utf8");
    assert.equal(schoolDeployReadOnlyState().active, true);
    await rm(markerPath);
    assert.equal(schoolDeployReadOnlyState().active, false);
  });
});
