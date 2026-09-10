import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Git preserves executable identity, not checkout read/write permissions.
const canonicalMode = "u+rwX,go+rX,go-w";
const generatedExcludes = ["./tsconfig.tsbuildinfo", "./.wrangler"];

export async function verifySchoolSource({ repositoryRoot = root } = {}) {
  const manifest = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "deploy", "school-source-manifest.json"),
      "utf8",
    ),
  );
  const canonical = manifest.canonicalTar;
  if (
    manifest.schemaVersion !== 3 ||
    canonical?.owner !== 0 ||
    canonical?.group !== 0 ||
    canonical?.mtime !== "UTC 1970-01-01" ||
    canonical?.numericOwner !== true ||
    canonical?.mode !== canonicalMode ||
    JSON.stringify(canonical?.generatedExcludes) !==
      JSON.stringify(generatedExcludes)
  ) {
    throw new Error("Unsupported school source canonicalization");
  }
  const results = [];

  for (const version of ["v44", "v52"]) {
    const entry = manifest[version];
    if (!entry?.materializedTreeSha256) {
      throw new Error(
        `Missing ${version}.materializedTreeSha256 in school source manifest`,
      );
    }

    const archive = spawnSync(
      "tar",
      [
        "--sort=name",
        "--mtime=UTC 1970-01-01",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        `--mode=${canonicalMode}`,
        ...generatedExcludes.map((name) => `--exclude=${name}`),
        "-cf",
        "-",
        "-C",
        path.join(repositoryRoot, "deploy", version, "src"),
        ".",
      ],
      { encoding: null, maxBuffer: 64 * 1024 * 1024 },
    );
    if (archive.status !== 0) {
      throw new Error(
        `Unable to create canonical ${version} source tar: ${archive.stderr}`,
      );
    }

    const actual = createHash("sha256").update(archive.stdout).digest("hex");
    if (actual !== entry.materializedTreeSha256) {
      throw new Error(
        `${version} materialized source mismatch: expected ${entry.materializedTreeSha256}, got ${actual}`,
      );
    }
    results.push({ version, materializedTreeSha256: actual });
  }

  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = await verifySchoolSource();
  for (const result of results) {
    console.log(`${result.version}: ${result.materializedTreeSha256}`);
  }
}
