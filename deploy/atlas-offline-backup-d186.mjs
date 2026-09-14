#!/usr/bin/env node
import { backup, DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0"))
    throw new Error(`${label} must be an absolute path`);
  return resolve(value);
}

function directorySnapshot(path, label) {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be a real directory`);
  return stat;
}

function fileSnapshot(path, { optional = false } = {}) {
  let stat;
  try {
    stat = lstatSync(path, { bigint: true });
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("backup source must be a regular file");
  if (!optional && stat.size <= 0n) throw new Error("backup source is empty");
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function sameSnapshot(left, right) {
  if (left === null || right === null) return left === right;
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function fsyncPath(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export async function createOfflineAtlasBackup({
  sourcePath,
  workspacePath,
  destinationPath,
}) {
  const source = requireAbsolutePath(sourcePath, "sourcePath");
  const workspace = requireAbsolutePath(workspacePath, "workspacePath");
  const destination = requireAbsolutePath(destinationPath, "destinationPath");
  const sourceWal = `${source}-wal`;
  const workspaceWal = `${workspace}-wal`;
  const staging = `${destination}.building`;
  const allPaths = [
    source,
    sourceWal,
    workspace,
    workspaceWal,
    destination,
    staging,
  ];
  if (new Set(allPaths).size !== allPaths.length)
    throw new Error("backup paths must be distinct");

  directorySnapshot(dirname(source), "source directory");
  directorySnapshot(dirname(workspace), "workspace directory");
  directorySnapshot(dirname(destination), "destination directory");
  if (existsSync(workspace) || existsSync(workspaceWal))
    throw new Error("backup workspace already exists");
  if (existsSync(destination))
    throw new Error("backup destination already exists");
  if (existsSync(staging))
    throw new Error("backup staging destination already exists");

  const mainBefore = fileSnapshot(source);
  const walBefore = fileSnapshot(sourceWal, { optional: true });
  copyFileSync(source, workspace, constants.COPYFILE_EXCL);
  if (walBefore) copyFileSync(sourceWal, workspaceWal, constants.COPYFILE_EXCL);
  const mainAfter = fileSnapshot(source);
  const walAfter = fileSnapshot(sourceWal, { optional: true });
  if (
    !sameSnapshot(mainBefore, mainAfter) ||
    !sameSnapshot(walBefore, walAfter)
  )
    throw new Error("backup source changed during snapshot");

  const snapshot = new DatabaseSync(workspace);
  try {
    const integrity = snapshot
      .prepare("PRAGMA integrity_check")
      .get()?.integrity_check;
    if (integrity !== "ok") throw new Error("snapshot integrity check failed");
    await backup(snapshot, staging);
  } finally {
    snapshot.close();
  }

  const standalone = new DatabaseSync(staging);
  let journalMode;
  try {
    journalMode = standalone
      .prepare("PRAGMA journal_mode=DELETE")
      .get()?.journal_mode;
    if (journalMode !== "delete")
      throw new Error("backup journal mode is not standalone");
    const integrity = standalone
      .prepare("PRAGMA integrity_check")
      .get()?.integrity_check;
    if (integrity !== "ok") throw new Error("backup integrity check failed");
  } finally {
    standalone.close();
  }

  chmodSync(staging, 0o444);
  fsyncPath(staging);
  linkSync(staging, destination);
  unlinkSync(staging);
  fsyncPath(dirname(destination));
  return {
    integrity: "ok",
    journalMode,
    walIncluded: walBefore !== null,
  };
}

async function main() {
  const [sourcePath, workspacePath, destinationPath, ...extra] =
    process.argv.slice(2);
  if (
    extra.length !== 0 ||
    sourcePath !== "/data/atlas-school.sqlite" ||
    workspacePath !== "/work/atlas-school.sqlite" ||
    !/^\/backups\/pre-d186-[1-9][0-9]*-1\.sqlite$/.test(destinationPath ?? "")
  )
    throw new Error("invalid Atlas backup invocation");
  const result = await createOfflineAtlasBackup({
    sourcePath,
    workspacePath,
    destinationPath,
  });
  process.stdout.write(
    `ATLAS_OFFLINE_BACKUP=VERIFIED wal=${result.walIncluded ? "included" : "absent"}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write("ATLAS_OFFLINE_BACKUP=FAILED\n");
    process.exitCode = 1;
  });
}
