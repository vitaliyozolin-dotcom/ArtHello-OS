import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmod,
  cp,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifySchoolSource } from "../verify-school-source.mjs";

test("materialized School source matches the reviewed canonical tree hashes", async () => {
  const results = await verifySchoolSource();
  assert.deepEqual(
    results.map(({ version }) => version),
    ["v44", "v52"],
  );
});

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function fixture(t) {
  const repositoryRoot = await mkdtemp(
    path.join(os.tmpdir(), "school-source-test-"),
  );
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  for (const name of ["school-source-manifest.json", "v44/src", "v52/src"]) {
    await cp(
      path.join(root, "deploy", name),
      path.join(repositoryRoot, "deploy", name),
      { recursive: true },
    );
  }
  return repositoryRoot;
}

test("checkout read/write permissions do not change source identity", async (t) => {
  const repositoryRoot = await fixture(t);
  const directory = path.join(repositoryRoot, "deploy/v52/src");
  const file = path.join(directory, "package.json");
  await chmod(directory, 0o770);
  await chmod(file, 0o600);
  assert.equal((await verifySchoolSource({ repositoryRoot })).length, 2);
  await chmod(directory, 0o775);
  await chmod(file, 0o664);
  assert.equal((await verifySchoolSource({ repositoryRoot })).length, 2);
});

for (const change of [
  "content",
  "extra file",
  "missing file",
  "executable bit",
]) {
  test(`source identity rejects a changed ${change}`, async (t) => {
    const repositoryRoot = await fixture(t);
    const file = path.join(repositoryRoot, "deploy/v52/src/package.json");
    if (change === "content") await writeFile(file, "{}\n");
    if (change === "extra file")
      await writeFile(`${file}.unexpected`, "unreviewed\n");
    if (change === "missing file") await rm(file);
    if (change === "executable bit")
      await chmod(file, (await stat(file)).mode | 0o111);
    await assert.rejects(
      verifySchoolSource({ repositoryRoot }),
      /v52 materialized source mismatch/,
    );
  });
}

test("source identity refuses unsupported manifest canonicalization", async (t) => {
  const repositoryRoot = await fixture(t);
  const file = path.join(repositoryRoot, "deploy/school-source-manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.canonicalTar.mode = "0777";
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(
    verifySchoolSource({ repositoryRoot }),
    /Unsupported school source canonicalization/,
  );
});
