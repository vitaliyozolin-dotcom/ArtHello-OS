#!/usr/bin/env node

/**
 * Encrypted, fail-closed SQLite backups for ArtHello OS production.
 *
 * The public summaries and the external audit log intentionally contain no
 * filesystem paths, database rows, actor identifiers, logins, or other PII.
 * Node.js 24+ is required for node:sqlite's online backup API.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";

export const BACKUP_MANIFEST_FORMAT = "arthello-sqlite-backup-manifest-v2";
export const BACKUP_OPERATION_FORMAT = "arthello-backup-operation-v1";
export const BACKUP_KINDS = Object.freeze([
  "manual",
  "automatic",
  "monthly",
  "pre_deploy",
  "pre_restore",
]);

export const REQUIRED_ARTHELLO_TABLES = Object.freeze([
  "system_runtime_state",
  "organization_branches",
  "app_users",
  "app_systems",
  "user_system_access",
  "user_branch_access",
  "entities",
  "hr_employees",
  "hr_accesses",
  "production_auth_credentials",
  "production_auth_sessions",
]);

export const BACKUP_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
  MISSING_ENCRYPTION_KEY: "MISSING_ENCRYPTION_KEY",
  INVALID_ENCRYPTION_KEY: "INVALID_ENCRYPTION_KEY",
  ROOTS_OVERLAP: "ROOTS_OVERLAP",
  DATA_ROOT_UNAVAILABLE: "DATA_ROOT_UNAVAILABLE",
  DATABASE_NOT_FOUND: "DATABASE_NOT_FOUND",
  DATABASE_AMBIGUOUS: "DATABASE_AMBIGUOUS",
  DATABASE_UNINSPECTABLE: "DATABASE_UNINSPECTABLE",
  DATABASE_FIXTURE_MISMATCH: "DATABASE_FIXTURE_MISMATCH",
  SOURCE_INTEGRITY_FAILED: "SOURCE_INTEGRITY_FAILED",
  INVALID_BACKUP_KIND: "INVALID_BACKUP_KIND",
  INVALID_BACKUP_ID: "INVALID_BACKUP_ID",
  BACKUP_NOT_FOUND: "BACKUP_NOT_FOUND",
  INVALID_MANIFEST: "INVALID_MANIFEST",
  BACKUP_CHECKSUM_MISMATCH: "BACKUP_CHECKSUM_MISMATCH",
  BACKUP_DECRYPTION_FAILED: "BACKUP_DECRYPTION_FAILED",
  BACKUP_KEY_UNAVAILABLE: "BACKUP_KEY_UNAVAILABLE",
  BACKUP_UNVERIFIED: "BACKUP_UNVERIFIED",
  BACKUP_INCOMPATIBLE: "BACKUP_INCOMPATIBLE",
  APPLICATION_NOT_STOPPED: "APPLICATION_NOT_STOPPED",
  OWNER_CREDENTIAL_INVALID: "OWNER_CREDENTIAL_INVALID",
  OWNER_ACCESS_INVALID: "OWNER_ACCESS_INVALID",
  RESTORE_FAILED: "RESTORE_FAILED",
  RESTORE_ROLLBACK_FAILED: "RESTORE_ROLLBACK_FAILED",
  RESTORE_RECOVERY_REQUIRED: "RESTORE_RECOVERY_REQUIRED",
  INVALID_SAFETY_BACKUP: "INVALID_SAFETY_BACKUP",
  LOCK_RECOVERY_REQUIRED: "LOCK_RECOVERY_REQUIRED",
  OPERATION_LOCKED: "OPERATION_LOCKED",
  AUDIT_WRITE_FAILED: "AUDIT_WRITE_FAILED",
});

const DEFAULT_DATA_ROOT = "/data";
const DEFAULT_BACKUP_ROOT = "/backups";
const DEFAULT_TEMP_ROOT = "/tmp/arthello-backup-work";
const DEFAULT_DAILY_RETENTION_DAYS = 30;
const DEFAULT_MONTHLY_RETENTION_MONTHS = 12;
const DEFAULT_MAX_SCAN_DEPTH = 20;
const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
const PROCESS_INSTANCE_ID = randomUUID();
const OPERATIONS_FILE = "operations.ndjson";
const LOCK_FILE = ".backup-manager.lock";
const LOCK_QUARANTINE_FILE = ".backup-manager.quarantine";
const OWNER_AUTH_ID = "AUTH-OWNER";
const OWNER_APP_USER_ID = "USR-OWNER";
const ARTHELLO_SYSTEM_ID = "SYS-ARTHELLO-OS";
const OWNER_ROLE = "Собственник";
const ACTIVE_STATUS = "Активен";
const SQLITE_HEADER = "SQLite format 3\u0000";
const BACKUP_ID_PATTERN = /^arthello-(manual|automatic|monthly|pre_deploy|pre_restore)-\d{8}T\d{9}Z-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,199}$/u;
const OWNER_CREDENTIAL_COLUMNS = Object.freeze([
  "user_id",
  "login",
  "display_name",
  "role",
  "password_salt",
  "password_hash",
  "must_change_password",
  "temporary_password_expires_at",
  "failed_attempts",
  "locked_until",
  "updated_at",
]);

export class BackupManagerError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "BackupManagerError";
    this.code = code;
  }
}

function managerError(code, message, cause = undefined) {
  return new BackupManagerError(code, message, cause ? { cause } : undefined);
}

function normalizeError(error, code, message) {
  return error instanceof BackupManagerError ? error : managerError(code, message, error);
}

function failureCode(error) {
  return error instanceof BackupManagerError ? error.code : BACKUP_ERROR_CODES.RESTORE_FAILED;
}

function parseInteger(value, fallback, label, minimum = 0) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, `${label} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function parseEncryptionKey(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_ENCRYPTION_KEY, "Backup encryption key must be exactly 32 bytes");
    }
    return Buffer.from(value);
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw managerError(BACKUP_ERROR_CODES.MISSING_ENCRYPTION_KEY, "Backup encryption key is required");
  }
  const encoded = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_ENCRYPTION_KEY, "Backup encryption key must be canonical base64");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_ENCRYPTION_KEY, "Backup encryption key must decode to exactly 32 bytes");
  }
  return key;
}

function safeToken(value, label) {
  const token = String(value ?? "").trim();
  if (!SAFE_TOKEN_PATTERN.test(token)) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, `${label} is missing or invalid`);
  }
  return token;
}

function isPathInside(rootPath, candidatePath) {
  const rel = relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertSeparateRoots(dataRoot, backupRoot) {
  if (isPathInside(dataRoot, backupRoot) || isPathInside(backupRoot, dataRoot)) {
    throw managerError(
      BACKUP_ERROR_CODES.ROOTS_OVERLAP,
      "Data root and backup root must be separate, non-overlapping directories",
    );
  }
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/u.test(value)) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Unsafe SQLite identifier");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function openDatabase(filePath, readOnly) {
  const db = new DatabaseSync(filePath, {
    open: true,
    readOnly,
    enableForeignKeyConstraints: false,
  });
  db.exec("PRAGMA busy_timeout=5000");
  if (readOnly) db.exec("PRAGMA query_only=ON");
  return db;
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

function hasRequiredSchema(db, requiredTables) {
  const available = new Set(tableNames(db));
  return requiredTables.every((tableName) => available.has(tableName));
}

function tableColumns(db, tableName) {
  return db
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all()
    .map((row) => String(row.name));
}

function requireColumns(db, tableName, requiredColumns, code = BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED) {
  const available = new Set(tableColumns(db, tableName));
  for (const column of requiredColumns) {
    if (!available.has(column)) {
      throw managerError(code, "ArtHello database is missing required security columns");
    }
  }
}

function runIntegrityCheck(db, code = BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  const messages = rows.map((row) => String(Object.values(row)[0] ?? ""));
  if (messages.length !== 1 || messages[0].toLowerCase() !== "ok") {
    throw managerError(code, "SQLite integrity check failed");
  }
  const foreignKeyFindings = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFindings.length !== 0) {
    throw managerError(code, "SQLite foreign-key check failed");
  }
}

function readCoreSchemaVersion(db) {
  requireColumns(db, "system_runtime_state", ["state_key", "state_value"]);
  const rows = db
    .prepare("SELECT state_value FROM system_runtime_state WHERE state_key='core_schema'")
    .all();
  if (rows.length !== 1) {
    throw managerError(BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED, "Core schema version is missing or ambiguous");
  }
  const value = String(rows[0].state_value ?? "").trim();
  if (value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw managerError(BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED, "Core schema version is invalid");
  }
  return value;
}

function validateCanonicalOwnerAccess(db) {
  requireColumns(db, "app_users", ["id", "role", "status", "is_administrative", "access_version"], BACKUP_ERROR_CODES.OWNER_ACCESS_INVALID);
  requireColumns(db, "user_system_access", ["user_id", "system_id", "role", "status", "access_version"], BACKUP_ERROR_CODES.OWNER_ACCESS_INVALID);
  const users = db.prepare(`SELECT id,role,status,is_administrative,access_version
    FROM app_users WHERE id=?`).all(OWNER_APP_USER_ID);
  const grants = db.prepare(`SELECT user_id,system_id,role,status,access_version
    FROM user_system_access WHERE user_id=? AND system_id=?`).all(OWNER_APP_USER_ID, ARTHELLO_SYSTEM_ID);
  if (users.length !== 1 || grants.length !== 1) {
    throw managerError(BACKUP_ERROR_CODES.OWNER_ACCESS_INVALID, "Canonical owner access is missing or ambiguous");
  }
  const user = users[0];
  const grant = grants[0];
  if (
    String(user.id) !== OWNER_APP_USER_ID
    || String(user.role) !== OWNER_ROLE
    || String(user.status) !== ACTIVE_STATUS
    || Number(user.is_administrative) !== 1
    || String(grant.user_id) !== OWNER_APP_USER_ID
    || String(grant.system_id) !== ARTHELLO_SYSTEM_ID
    || String(grant.role) !== OWNER_ROLE
    || String(grant.status) !== ACTIVE_STATUS
    || Number(user.access_version) !== Number(grant.access_version)
  ) {
    throw managerError(BACKUP_ERROR_CODES.OWNER_ACCESS_INVALID, "Canonical owner access is not active and consistent");
  }
}

function captureOwnerCredential(db) {
  requireColumns(
    db,
    "production_auth_credentials",
    OWNER_CREDENTIAL_COLUMNS,
    BACKUP_ERROR_CODES.OWNER_CREDENTIAL_INVALID,
  );
  const rows = db.prepare(`SELECT ${OWNER_CREDENTIAL_COLUMNS.map(quoteIdentifier).join(",")}
    FROM production_auth_credentials WHERE user_id=?`).all(OWNER_AUTH_ID);
  if (rows.length !== 1) {
    throw managerError(BACKUP_ERROR_CODES.OWNER_CREDENTIAL_INVALID, "Canonical owner credential is missing or ambiguous");
  }
  const credential = Object.fromEntries(OWNER_CREDENTIAL_COLUMNS.map((column) => [column, rows[0][column]]));
  for (const column of ["login", "role", "password_salt", "password_hash"]) {
    if (typeof credential[column] !== "string" || credential[column].length === 0) {
      throw managerError(BACKUP_ERROR_CODES.OWNER_CREDENTIAL_INVALID, "Canonical owner credential is incomplete");
    }
  }
  return credential;
}

function restoreOwnerCredentialAndRevokeSessions(db, credential) {
  requireColumns(
    db,
    "production_auth_credentials",
    OWNER_CREDENTIAL_COLUMNS,
    BACKUP_ERROR_CODES.OWNER_CREDENTIAL_INVALID,
  );
  requireColumns(db, "production_auth_sessions", ["user_id"], BACKUP_ERROR_CODES.OWNER_CREDENTIAL_INVALID);
  const columns = OWNER_CREDENTIAL_COLUMNS.map(quoteIdentifier).join(",");
  const placeholders = OWNER_CREDENTIAL_COLUMNS.map(() => "?").join(",");
  const updates = OWNER_CREDENTIAL_COLUMNS
    .filter((column) => column !== "user_id")
    .map((column) => `${quoteIdentifier(column)}=excluded.${quoteIdentifier(column)}`)
    .join(",");
  db.prepare("DELETE FROM production_auth_credentials WHERE login=? AND user_id<>?")
    .run(credential.login, OWNER_AUTH_ID);
  db.prepare(`INSERT INTO production_auth_credentials (${columns}) VALUES (${placeholders})
    ON CONFLICT(user_id) DO UPDATE SET ${updates}`)
    .run(...OWNER_CREDENTIAL_COLUMNS.map((column) => credential[column]));
  // Authentication is a current security plane, not historical business
  // data. Old employee password hashes must never be resurrected by a data
  // restore; the owner can issue fresh temporary credentials afterwards.
  db.prepare("DELETE FROM production_auth_credentials WHERE user_id<>?").run(OWNER_AUTH_ID);
  db.exec("DELETE FROM production_auth_sessions");
}

function assertNoSessions(db) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM production_auth_sessions").get();
  if (Number(row?.count ?? -1) !== 0) {
    throw managerError(BACKUP_ERROR_CODES.OWNER_CREDENTIAL_INVALID, "Restored authentication sessions were not revoked");
  }
}

async function hasSqliteHeader(filePath, { strict = false } = {}) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, 16, 0);
    return bytesRead === 16 && header.toString("utf8") === SQLITE_HEADER;
  } catch (error) {
    if (strict) {
      throw managerError(
        BACKUP_ERROR_CODES.DATABASE_UNINSPECTABLE,
        "A data-root file could not be inspected safely",
        error,
      );
    }
    return false;
  } finally {
    await handle?.close();
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function syncFile(filePath) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath) {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeSqliteWorkFiles(filePath) {
  let firstError = null;
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`, `${filePath}-journal`]) {
    try {
      await safeUnlink(candidate);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertRegularFile(filePath, code, message) {
  let details;
  try {
    details = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw managerError(code, message);
    throw normalizeError(error, code, message);
  }
  if (!details.isFile() || details.isSymbolicLink()) throw managerError(code, message);
  return details;
}

function excludedDirectoryName(name) {
  return /^(?:backups?|archives?|archived|snapshots?|lost\+found)$/iu.test(name);
}

function excludedDatabaseFileName(name) {
  return (
    /(?:-wal|-shm|-journal)$/iu.test(name)
    || /\.manifest\.json$/iu.test(name)
    || /\.ndjson$/iu.test(name)
    || /(?:^|[._-])(?:backup|archive|archived|rollback|pre-restore|failed-restore|restore)(?:[._-]|$)/iu.test(name)
    || /\.sqlite\.enc$/iu.test(name)
  );
}

async function walkDataFiles(rootPath, backupRootPath, maxDepth) {
  const files = [];
  async function visit(directoryPath, depth) {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw managerError(BACKUP_ERROR_CODES.DATABASE_UNINSPECTABLE, "Data root cannot be inspected completely", error);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const candidate = join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (excludedDirectoryName(entry.name) || isPathInside(backupRootPath, candidate)) continue;
        if (depth >= maxDepth) {
          throw managerError(BACKUP_ERROR_CODES.DATABASE_UNINSPECTABLE, "Data-root scan depth was exceeded");
        }
        await visit(candidate, depth + 1);
      } else if (entry.isFile() && !excludedDatabaseFileName(entry.name)) {
        files.push(candidate);
      }
    }
  }
  await visit(rootPath, 0);
  return files;
}

function utcFileTimestamp(date) {
  return date.toISOString().replace(/[-:.]/gu, "");
}

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validateCoreSchemaToken(value, label = "Core schema version") {
  const token = String(value ?? "").trim();
  if (token.length === 0 || token.length > 256 || /[\u0000-\u001f\u007f]/u.test(token)) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, `${label} is invalid`);
  }
  return token;
}

function parseSupportedCoreSchemaVersions(value) {
  if (value === undefined || value === null || value === "") return null;
  let values = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        values = JSON.parse(trimmed);
      } catch (error) {
        throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Supported core-schema allowlist is invalid JSON", error);
      }
    } else {
      values = trimmed.split(",");
    }
  }
  if (!Array.isArray(values) && !(values instanceof Set)) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Supported core-schema allowlist must be a list");
  }
  const normalized = [...values].map((item) => validateCoreSchemaToken(item, "Supported core schema version"));
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Supported core-schema allowlist is empty or duplicated");
  }
  return Object.freeze(normalized);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function manifestWithoutAuthentication(manifest) {
  const { authentication: _authentication, ...unsigned } = manifest;
  return unsigned;
}

function signManifest(manifest, signingKey) {
  return createHmac("sha256", signingKey)
    .update("arthello-backup-manifest-v2\u0000", "utf8")
    .update(canonicalJson(manifestWithoutAuthentication(manifest)), "utf8")
    .digest("hex");
}

function decodeManifestBase64(value, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest encryption metadata is invalid");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedLength || decoded.toString("base64") !== value) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest encryption metadata is invalid");
  }
  return decoded;
}

function parseManifest(raw) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest is not valid JSON", error);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest is invalid");
  }
  if (manifest.format !== BACKUP_MANIFEST_FORMAT || manifest.manifestVersion !== 2) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest version is unsupported");
  }
  if (!BACKUP_ID_PATTERN.test(manifest.backupId) || !BACKUP_KINDS.includes(manifest.kind)) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest identity is invalid");
  }
  if (!validDate(manifest.createdAt)) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest timestamp is invalid");
  }
  if (
    typeof manifest.coreSchemaVersion !== "string"
    || manifest.coreSchemaVersion.length === 0
    || manifest.coreSchemaVersion.length > 256
    || /[\u0000-\u001f\u007f]/u.test(manifest.coreSchemaVersion)
    || typeof manifest.applicationRevision !== "string"
    || !SAFE_TOKEN_PATTERN.test(manifest.applicationRevision)
  ) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest compatibility metadata is invalid");
  }
  if (
    !manifest.encrypted
    || manifest.encrypted.fileName !== `${manifest.backupId}.sqlite.enc`
    || !Number.isSafeInteger(manifest.encrypted.sizeBytes)
    || manifest.encrypted.sizeBytes < 1
    || !SHA256_PATTERN.test(manifest.encrypted.sha256)
  ) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest ciphertext metadata is invalid");
  }
  if (
    !manifest.plaintext
    || !Number.isSafeInteger(manifest.plaintext.sizeBytes)
    || manifest.plaintext.sizeBytes < 1
    || !SHA256_PATTERN.test(manifest.plaintext.sha256)
    || manifest.plaintext.integrityCheck !== "ok"
  ) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest SQLite metadata is invalid");
  }
  if (
    !manifest.encryption
    || manifest.encryption.algorithm !== "aes-256-gcm"
    || typeof manifest.encryption.keyId !== "string"
    || !SAFE_TOKEN_PATTERN.test(manifest.encryption.keyId)
    || manifest.encryption.aad !== "manifest-v2:backupId:kind"
  ) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest encryption metadata is invalid");
  }
  decodeManifestBase64(manifest.encryption.iv, 12);
  decodeManifestBase64(manifest.encryption.tag, 16);
  if (
    !manifest.authentication
    || manifest.authentication.algorithm !== "hmac-sha256"
    || manifest.authentication.keyId !== manifest.encryption.keyId
    || !SHA256_PATTERN.test(manifest.authentication.value)
  ) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest authentication metadata is invalid");
  }
  return manifest;
}

function backupSummary(manifest, verified, compatible, extra = {}) {
  return {
    id: manifest.backupId,
    kind: manifest.kind,
    createdAt: manifest.createdAt,
    sizeBytes: manifest.encrypted.sizeBytes,
    sha256: manifest.encrypted.sha256,
    coreSchemaVersion: manifest.coreSchemaVersion,
    applicationRevision: manifest.applicationRevision,
    verified,
    compatible,
    ...extra,
  };
}

function encryptionAad(manifestOrIdentity) {
  return Buffer.from(
    `${BACKUP_MANIFEST_FORMAT}\n${manifestOrIdentity.backupId}\n${manifestOrIdentity.kind}`,
    "utf8",
  );
}

async function encryptFile(inputPath, outputPath, key, iv, identity) {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(encryptionAad(identity));
  try {
    await pipeline(
      createReadStream(inputPath),
      cipher,
      createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
    );
    return cipher.getAuthTag();
  } catch (error) {
    await safeUnlink(outputPath).catch(() => {});
    throw normalizeError(error, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Backup encryption failed");
  }
}

async function decryptFile(inputPath, outputPath, key, manifest) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    decodeManifestBase64(manifest.encryption.iv, 12),
  );
  decipher.setAAD(encryptionAad(manifest));
  decipher.setAuthTag(decodeManifestBase64(manifest.encryption.tag, 16));
  try {
    await pipeline(
      createReadStream(inputPath),
      decipher,
      createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await safeUnlink(outputPath).catch(() => {});
    throw managerError(BACKUP_ERROR_CODES.BACKUP_DECRYPTION_FAILED, "Encrypted backup authentication failed", error);
  }
}

async function writeAtomicJson(directoryPath, finalName, temporaryName, value) {
  const temporaryPath = join(directoryPath, temporaryName);
  const finalPath = join(directoryPath, finalName);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, finalPath);
    await syncDirectory(directoryPath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await safeUnlink(temporaryPath).catch(() => {});
    throw error;
  }
  return finalPath;
}

async function processStartTime(pid) {
  if (!Number.isInteger(pid) || pid < 1) return { state: "missing", value: null };
  try {
    // `/proc/self` is authoritative even in executors whose reported Node PID
    // and mounted proc namespace differ. Production containers normally have
    // a matching namespace, so foreign PIDs still use their explicit path.
    const body = await readFile(pid === process.pid ? "/proc/self/stat" : `/proc/${pid}/stat`, "utf8");
    const commandEnd = body.lastIndexOf(")");
    if (commandEnd < 0) return { state: "unknown", value: null };
    // Fields after the command start at proc field 3; starttime is field 22.
    const fields = body.slice(commandEnd + 1).trim().split(/\s+/u);
    const value = fields[19];
    if (!/^[0-9]+$/u.test(value ?? "")) return { state: "unknown", value: null };
    return { state: "known", value };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing", value: null };
    return { state: "unknown", value: null };
  }
}

export class ProductionBackupManager {
  constructor(options = {}) {
    this.dataRoot = resolve(options.dataRoot ?? process.env.ARTHELLO_DATA_ROOT ?? DEFAULT_DATA_ROOT);
    this.backupRoot = resolve(options.backupRoot ?? process.env.ARTHELLO_BACKUP_ROOT ?? DEFAULT_BACKUP_ROOT);
    this.tempRoot = resolve(options.tempRoot ?? process.env.ARTHELLO_BACKUP_TEMP_ROOT ?? DEFAULT_TEMP_ROOT);
    assertSeparateRoots(this.dataRoot, this.backupRoot);
    assertSeparateRoots(this.dataRoot, this.tempRoot);
    assertSeparateRoots(this.backupRoot, this.tempRoot);

    this.databaseFixturePath = options.databaseFixturePath
      ?? process.env.ARTHELLO_DATABASE_FIXTURE_PATH
      ?? null;
    if (this.databaseFixturePath) this.databaseFixturePath = resolve(this.databaseFixturePath);

    this.encryptionKey = parseEncryptionKey(
      options.encryptionKey ?? process.env.ARTHELLO_BACKUP_ENCRYPTION_KEY,
    );
    const derivedKeyId = `sha256-${createHash("sha256").update(this.encryptionKey).digest("hex").slice(0, 16)}`;
    this.encryptionKeyId = safeToken(
      options.encryptionKeyId ?? process.env.ARTHELLO_BACKUP_KEY_ID ?? derivedKeyId,
      "Backup encryption key ID",
    );
    this.manifestSigningKey = Buffer.from(hkdfSync(
      "sha256",
      this.encryptionKey,
      Buffer.from("arthello-backup-manifest-v2", "utf8"),
      Buffer.from("metadata-authentication", "utf8"),
      32,
    ));
    this.configuredSupportedCoreSchemaVersions = parseSupportedCoreSchemaVersions(
      options.supportedCoreSchemaVersions ?? process.env.ARTHELLO_SUPPORTED_CORE_SCHEMA_VERSIONS,
    );
    this.applicationRevision = safeToken(
      options.applicationRevision
        ?? process.env.ARTHELLO_APPLICATION_REVISION
        ?? "unversioned",
      "Application revision",
    );
    this.dailyRetentionDays = parseInteger(
      options.dailyRetentionDays ?? process.env.ARTHELLO_BACKUP_DAILY_DAYS,
      DEFAULT_DAILY_RETENTION_DAYS,
      "Daily retention days",
      1,
    );
    this.monthlyRetentionMonths = parseInteger(
      options.monthlyRetentionMonths ?? process.env.ARTHELLO_BACKUP_MONTHLY_MONTHS,
      DEFAULT_MONTHLY_RETENTION_MONTHS,
      "Monthly retention months",
      1,
    );
    this.maxScanDepth = parseInteger(options.maxScanDepth, DEFAULT_MAX_SCAN_DEPTH, "Maximum scan depth", 1);
    this.lockStaleMs = parseInteger(options.lockStaleMs, DEFAULT_LOCK_STALE_MS, "Lock stale duration", 1);
    this.lockInstanceId = safeToken(options.lockInstanceId ?? PROCESS_INSTANCE_ID, "Backup lock instance ID");
    this.lockHostname = safeToken(options.lockHostname ?? process.env.HOSTNAME ?? "unknown-host", "Backup lock hostname");
    this.requiredTables = Object.freeze([...(options.requiredTables ?? REQUIRED_ARTHELLO_TABLES)]);
    this.isApplicationStopped = options.isApplicationStopped
      ?? (() => process.env.ARTHELLO_APP_STOPPED === "1");
    this.now = options.now ?? (() => new Date());
    this.hooks = options.hooks ?? {};
    this.operationTail = Promise.resolve();
    this.lockQuarantined = false;
  }

  async ensureRoots() {
    let dataRoot;
    try {
      dataRoot = await realpath(this.dataRoot);
    } catch (error) {
      throw managerError(BACKUP_ERROR_CODES.DATA_ROOT_UNAVAILABLE, "Production data root is unavailable", error);
    }
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.tempRoot, { recursive: true, mode: 0o700 });
    await chmod(this.backupRoot, 0o700);
    await chmod(this.tempRoot, 0o700);
    const backupRoot = await realpath(this.backupRoot);
    const tempRoot = await realpath(this.tempRoot);
    assertSeparateRoots(dataRoot, backupRoot);
    assertSeparateRoots(dataRoot, tempRoot);
    assertSeparateRoots(backupRoot, tempRoot);
    return { dataRoot, backupRoot, tempRoot };
  }

  async discoverDatabase() {
    const { dataRoot, backupRoot } = await this.ensureRoots();
    const files = await walkDataFiles(dataRoot, backupRoot, this.maxScanDepth);
    const matches = [];
    for (const filePath of files) {
      if (!(await hasSqliteHeader(filePath, { strict: true }))) continue;
      let db;
      try {
        db = openDatabase(filePath, true);
        if (hasRequiredSchema(db, this.requiredTables)) matches.push(await realpath(filePath));
      } catch (error) {
        throw managerError(
          BACKUP_ERROR_CODES.DATABASE_UNINSPECTABLE,
          "A SQLite file in the data root could not be inspected safely",
          error,
        );
      } finally {
        db?.close();
      }
    }
    if (matches.length === 0) {
      throw managerError(BACKUP_ERROR_CODES.DATABASE_NOT_FOUND, "ArtHello production database was not found");
    }
    if (matches.length !== 1) {
      throw managerError(BACKUP_ERROR_CODES.DATABASE_AMBIGUOUS, "More than one ArtHello production database was found");
    }
    if (this.databaseFixturePath) {
      let fixturePath;
      try {
        fixturePath = await realpath(this.databaseFixturePath);
      } catch (error) {
        throw managerError(BACKUP_ERROR_CODES.DATABASE_FIXTURE_MISMATCH, "Database fixture path is unavailable", error);
      }
      if (!isPathInside(dataRoot, fixturePath) || fixturePath !== matches[0]) {
        throw managerError(
          BACKUP_ERROR_CODES.DATABASE_FIXTURE_MISMATCH,
          "Database fixture path does not match the unique discovered ArtHello database",
        );
      }
    }
    return matches[0];
  }

  async create(kind, options = {}) {
    return this.withExclusive(`create:${kind}`, () => this.createUnlocked(kind, options));
  }

  async list({ verifyFiles = true } = {}) {
    return this.listUnlocked({ verifyFiles });
  }

  async applyRetention() {
    return this.withExclusive("retention", () => this.applyRetentionUnlocked());
  }

  async verify(backupId) {
    return this.withExclusive(`verify:${backupId}`, () => this.verifyUnlocked(backupId));
  }

  async verifyUnlocked(backupId) {
    if (!BACKUP_ID_PATTERN.test(String(backupId ?? ""))) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_ID, "Backup identity is invalid");
    }
    const { tempRoot } = await this.ensureRoots();
    const databasePath = await this.discoverDatabase();
    let currentDb;
    let currentCoreSchemaVersion;
    try {
      currentDb = openDatabase(databasePath, true);
      runIntegrityCheck(currentDb);
      currentCoreSchemaVersion = readCoreSchemaVersion(currentDb);
    } finally {
      currentDb?.close();
    }
    const manifest = await this.loadManifest(backupId);
    if (!this.supportedCoreSchemaVersions(currentCoreSchemaVersion).has(manifest.coreSchemaVersion)) {
      throw managerError(
        BACKUP_ERROR_CODES.BACKUP_INCOMPATIBLE,
        "Backup core schema is incompatible with the running application",
      );
    }
    const temporaryPath = join(tempRoot, `.${manifest.backupId}.decrypt-${randomUUID()}.tmp`);
    try {
      await this.decryptAndValidate(manifest, temporaryPath);
      return backupSummary(manifest, true, true, { verification: "full" });
    } finally {
      await removeSqliteWorkFiles(temporaryPath);
    }
  }

  async restore(backupId) {
    this.assertApplicationStopped();
    return this.withExclusive(
      `restore:${backupId}`,
      () => this.restoreUnlocked(backupId),
      { requireApplicationStopped: true },
    );
  }

  async restoreSafetyBackup(backupId) {
    this.assertApplicationStopped();
    return this.withExclusive(
      `restore-safety:${backupId}`,
      () => this.restoreUnlocked(backupId, { existingSafetyBackup: true }),
      { requireApplicationStopped: true },
    );
  }

  async startupPreflight() {
    this.assertApplicationStopped();
    return this.withExclusive(
      "startup-preflight",
      async () => {
        const databasePath = await this.discoverDatabase();
        let db;
        try {
          db = openDatabase(databasePath, true);
          runIntegrityCheck(db);
          if (!hasRequiredSchema(db, this.requiredTables)) {
            throw managerError(BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED, "Production database schema is incomplete");
          }
          const coreSchemaVersion = readCoreSchemaVersion(db);
          validateCanonicalOwnerAccess(db);
          captureOwnerCredential(db);
          return {
            status: "ready",
            coreSchemaVersion,
            recoveryStatus: "clean",
          };
        } finally {
          db?.close();
        }
      },
      { requireApplicationStopped: true },
    );
  }

  async operations({ limit = 100 } = {}) {
    const boundedLimit = parseInteger(limit, 100, "Operation history limit", 1);
    const { backupRoot } = await this.ensureRoots();
    let body;
    try {
      body = await readFile(join(backupRoot, OPERATIONS_FILE), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw managerError(BACKUP_ERROR_CODES.AUDIT_WRITE_FAILED, "Backup operation history is unavailable", error);
    }
    const safe = [];
    for (const line of body.split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line);
        if (row?.format !== BACKUP_OPERATION_FORMAT || typeof row.timestamp !== "string") continue;
        safe.push({
          timestamp: row.timestamp,
          operationId: typeof row.operationId === "string" ? row.operationId : null,
          operation: typeof row.operation === "string" ? row.operation : null,
          phase: typeof row.phase === "string" ? row.phase : null,
          backupId: BACKUP_ID_PATTERN.test(row.backupId ?? "") ? row.backupId : null,
          safetyBackupId: BACKUP_ID_PATTERN.test(row.safetyBackupId ?? "") ? row.safetyBackupId : null,
          kind: BACKUP_KINDS.includes(row.kind) ? row.kind : null,
          failureCode: typeof row.failureCode === "string" ? row.failureCode : null,
          filesystemRollback: typeof row.filesystemRollback === "string" ? row.filesystemRollback : null,
          recoveryArchiveCount: Number.isSafeInteger(row.recoveryArchiveCount) ? row.recoveryArchiveCount : null,
        });
      } catch {
        // A partial final line must not expose raw content to callers.
      }
    }
    return safe.slice(-boundedLimit);
  }

  async withExclusive(label, operation, { requireApplicationStopped = false } = {}) {
    const run = async () => {
      const { backupRoot } = await this.ensureRoots();
      await this.assertNoLockQuarantine(backupRoot);
      const lock = await this.acquireLock(backupRoot, label);
      let result;
      let operationError = null;
      try {
        if (requireApplicationStopped) this.assertApplicationStopped();
        await this.cleanupStaleBackupTemps(backupRoot);
        await this.cleanupSafeRestoreArtifacts();
        result = await operation();
      } catch (error) {
        operationError = error;
      }
      try {
        await this.releaseLock(backupRoot, lock);
      } catch (releaseError) {
        await this.quarantineManager(backupRoot, {
          operation: "lock_release",
          failureCode: failureCode(releaseError),
        });
        if (operationError) throw operationError;
        if (result?.commitStatus === "committed") {
          return {
            ...result,
            auditStatus: "degraded",
            lockStatus: "degraded",
            recoveryStatus: "operator_action_required",
          };
        }
        throw releaseError;
      }
      if (operationError) throw operationError;
      return result;
    };
    const result = this.operationTail.then(run, run);
    this.operationTail = result.catch(() => {});
    return result;
  }

  async assertNoLockQuarantine(backupRoot) {
    if (this.lockQuarantined) {
      throw managerError(
        BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
        "Backup lock cleanup requires operator reconciliation",
      );
    }
    try {
      await lstat(join(backupRoot, LOCK_QUARANTINE_FILE));
      this.lockQuarantined = true;
      throw managerError(
        BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
        "Backup lock cleanup requires operator reconciliation",
      );
    } catch (error) {
      if (error?.code === "ENOENT") return;
      if (error instanceof BackupManagerError) throw error;
      throw managerError(
        BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
        "Backup lock quarantine state cannot be verified",
        error,
      );
    }
  }

  async quarantineManager(backupRoot, { operation, failureCode: code }) {
    this.lockQuarantined = true;
    const quarantinePath = join(backupRoot, LOCK_QUARANTINE_FILE);
    let handle;
    try {
      await this.hooks.beforeQuarantinePersist?.();
      handle = await open(quarantinePath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        format: "arthello-backup-quarantine-v1",
        createdAt: this.currentDate().toISOString(),
        reason: String(operation).slice(0, 80),
        failureCode: typeof code === "string" ? code.slice(0, 80) : BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
      })}\n`, "utf8");
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDirectory(backupRoot);
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") {
        // In-memory quarantine still fails this process closed. The owned lock
        // pathname is deliberately left untouched when its cleanup is unknown.
      }
    }
    await this.appendOperation({
      operationId: randomUUID(),
      operation: "lock_reconcile",
      phase: "operator_action_required",
      failureCode: BACKUP_ERROR_CODES.LOCK_RECOVERY_REQUIRED,
      filesystemRollback: "lock_quarantined",
    }).catch(() => {});
  }

  async acquireLock(backupRoot, label) {
    const lockPath = join(backupRoot, LOCK_FILE);
    const ownerProcess = await processStartTime(process.pid);
    if (ownerProcess.state !== "known") {
      throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Backup process identity cannot be verified");
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomUUID();
      let handle;
      try {
        handle = await open(lockPath, "wx", 0o600);
        const record = {
          format: "arthello-backup-lock-v1",
          token,
          pid: process.pid,
          processStartTime: ownerProcess.value,
          instanceId: this.lockInstanceId,
          hostname: this.lockHostname,
          createdAt: this.currentDate().toISOString(),
          operation: String(label).slice(0, 120),
        };
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.chmod(0o600);
        await handle.sync();
        await handle.close();
        await syncDirectory(backupRoot);
        const lock = { path: lockPath, token, heartbeat: null };
        const heartbeatMs = Math.max(1_000, Math.min(60_000, Math.floor(this.lockStaleMs / 3)));
        lock.heartbeat = setInterval(() => {
          void this.refreshLockLease(lock);
        }, heartbeatMs);
        lock.heartbeat.unref?.();
        return lock;
      } catch (error) {
        await handle?.close().catch(() => {});
        if (error?.code !== "EEXIST" || attempt === 1) {
          throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Another backup operation is in progress", error);
        }
        let details;
        try {
          details = await stat(lockPath);
        } catch (inspectionError) {
          throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Backup operation lock cannot be verified", inspectionError);
        }
        let existing = null;
        try {
          existing = JSON.parse(await readFile(lockPath, "utf8"));
        } catch {
          // A malformed/partially-written lock remains fail-closed until its
          // durable lease expires; it must not block backups forever.
        }
        const age = Date.now() - details.mtimeMs;
        const validRecord = existing?.format === "arthello-backup-lock-v1"
          && typeof existing?.token === "string"
          && Number.isInteger(existing?.pid)
          && typeof existing?.processStartTime === "string"
          && /^[0-9]+$/u.test(existing.processStartTime)
          && typeof existing?.instanceId === "string"
          && typeof existing?.hostname === "string";
        let definitelyDead = false;
        if (validRecord && existing.hostname === this.lockHostname) {
          const observedProcess = await processStartTime(existing.pid);
          definitelyDead = observedProcess.state === "missing"
            || (observedProcess.state === "known" && observedProcess.value !== existing.processStartTime);
        }
        const leaseExpired = age >= this.lockStaleMs;
        if (age < 0 || (validRecord ? !definitelyDead : !leaseExpired)) {
          throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Another backup operation is in progress");
        }
        // A valid foreign-container lock is never stolen solely because its
        // heartbeat is old: synchronous SQLite work can delay the JS event
        // loop. Automatic recovery is allowed only when an exact process
        // identity on the same container hostname is provably gone. Deployment
        // archives foreign locks only after Docker proves no volume user exists.
        const stalePath = join(backupRoot, `.backup-manager.lock.stale-${randomUUID()}`);
        await rename(lockPath, stalePath);
        await safeUnlink(stalePath);
        await syncDirectory(backupRoot);
      }
    }
    throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Another backup operation is in progress");
  }

  async refreshLockLease(lock) {
    try {
      const record = JSON.parse(await readFile(lock.path, "utf8"));
      if (record?.token !== lock.token) return;
      const now = new Date();
      await utimes(lock.path, now, now);
    } catch {
      // releaseLock performs the authoritative ownership check. Heartbeats are
      // best-effort because a synchronous SQLite integrity check can delay JS.
    }
  }

  async releaseLock(backupRoot, lock) {
    if (lock.heartbeat) clearInterval(lock.heartbeat);
    let record;
    try {
      await this.hooks.beforeLockReleaseRead?.();
      record = JSON.parse(await readFile(lock.path, "utf8"));
    } catch (error) {
      throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Backup operation lock ownership was lost", error);
    }
    if (record?.token !== lock.token) {
      throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Backup operation lock ownership was lost");
    }
    try {
      await this.hooks.beforeLockReleaseUnlink?.();
      await unlink(lock.path);
    } catch (error) {
      throw managerError(BACKUP_ERROR_CODES.OPERATION_LOCKED, "Backup operation lock ownership was lost", error);
    }
    try {
      await this.hooks.afterLockUnlink?.();
      await syncDirectory(backupRoot);
    } catch {
      // The operation result is already known and the owned lock pathname is
      // gone. A directory-fsync outage may make the lock reappear after a
      // crash, but that fails future mutations closed; it must not turn a
      // committed create/restore into a false operation failure.
    }
  }

  async cleanupStaleBackupTemps(backupRoot) {
    const entries = await readdir(backupRoot, { withFileTypes: true });
    let changed = false;
    for (const entry of entries) {
      if (
        entry.isFile()
        && /^\.(?:arthello-.*\.(?:plaintext|encrypted|decrypt)|manifest)-.*\.tmp(?:-(?:wal|shm|journal))?$/u.test(entry.name)
      ) {
        await safeUnlink(join(backupRoot, entry.name));
        changed = true;
      }
    }
    if (changed) await syncDirectory(backupRoot);
  }

  async cleanupSafeRestoreArtifacts() {
    let databasePath;
    try {
      databasePath = await this.discoverDatabase();
    } catch (error) {
      // Never guess which hidden SQLite file should become canonical when the
      // unique live database itself cannot be proved.
      if (error?.code === BACKUP_ERROR_CODES.DATABASE_NOT_FOUND) return;
      throw error;
    }
    const directoryPath = dirname(databasePath);
    const databaseName = basename(databasePath).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const candidatePattern = new RegExp(`^\\.${databaseName}\\.restore-[0-9a-f-]{36}\\.tmp$`, "u");
    const rollbackPattern = new RegExp(`^\\.${databaseName}\\.rollback-[0-9a-f-]{36}$`, "u");
    const entries = await readdir(directoryPath, { withFileTypes: true });
    if (!entries.some((entry) => candidatePattern.test(entry.name) || rollbackPattern.test(entry.name))) return;
    let liveDb;
    try {
      liveDb = openDatabase(databasePath, true);
      runIntegrityCheck(liveDb);
      if (!hasRequiredSchema(liveDb, this.requiredTables)) {
        throw managerError(BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED, "Canonical live database schema is incomplete");
      }
    } finally {
      liveDb?.close();
    }
    let removedCandidates = 0;
    let removedDuplicateArchives = 0;
    let divergentArchives = 0;
    const liveStat = await stat(databasePath);
    let liveSha256 = null;
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const artifactPath = join(directoryPath, entry.name);
      if (candidatePattern.test(entry.name)) {
        // If databasePath exists, an unrenamed candidate can never be required
        // for filesystem rollback. A renamed candidate no longer has this name.
        await removeSqliteWorkFiles(artifactPath);
        removedCandidates += 1;
        continue;
      }
      if (!rollbackPattern.test(entry.name)) continue;
      const artifactStat = await stat(artifactPath);
      let duplicate = artifactStat.dev === liveStat.dev && artifactStat.ino === liveStat.ino;
      if (!duplicate) {
        liveSha256 ??= await sha256File(databasePath);
        duplicate = await sha256File(artifactPath) === liveSha256;
      }
      if (duplicate) {
        await safeUnlink(artifactPath);
        removedDuplicateArchives += 1;
      } else {
        divergentArchives += 1;
      }
      // A divergent archive may be the only pre-crash rollback inode. It is
      // deliberately retained for operator recovery rather than guessed away.
    }
    if (removedCandidates || removedDuplicateArchives) {
      await syncDirectory(directoryPath);
    }
    if (removedCandidates || removedDuplicateArchives || divergentArchives) {
      await this.appendOperation({
        operationId: randomUUID(),
        operation: "restore_reconcile",
        phase: divergentArchives ? "operator_action_required" : "safe_cleanup",
        removedCandidates,
        removedDuplicateArchives,
        recoveryArchiveCount: divergentArchives,
        failureCode: divergentArchives ? BACKUP_ERROR_CODES.RESTORE_RECOVERY_REQUIRED : null,
      });
    }
    if (divergentArchives) {
      throw managerError(
        BACKUP_ERROR_CODES.RESTORE_RECOVERY_REQUIRED,
        "Interrupted restore requires operator reconciliation before new backup mutations",
      );
    }
  }

  currentDate() {
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Clock returned an invalid timestamp");
    }
    return new Date(date.getTime());
  }

  supportedCoreSchemaVersions(currentCoreSchemaVersion) {
    return new Set(
      this.configuredSupportedCoreSchemaVersions
        ?? [validateCoreSchemaToken(currentCoreSchemaVersion)],
    );
  }

  makeBackupId(kind, createdAt) {
    return `arthello-${kind}-${utcFileTimestamp(createdAt)}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }

  async appendOperation(fields) {
    const { backupRoot } = await this.ensureRoots();
    const record = {
      format: BACKUP_OPERATION_FORMAT,
      timestamp: this.currentDate().toISOString(),
      ...fields,
    };
    const line = `${JSON.stringify(record)}\n`;
    let handle;
    try {
      handle = await open(join(backupRoot, OPERATIONS_FILE), "a", 0o600);
      await handle.chmod(0o600);
      await handle.writeFile(line, "utf8");
      await handle.sync();
    } catch (error) {
      throw managerError(BACKUP_ERROR_CODES.AUDIT_WRITE_FAILED, "External backup audit log is unavailable", error);
    } finally {
      await handle?.close();
    }
  }

  async validateDatabaseFile(filePath, { expectedSha256 = null, expectedCoreSchemaVersion = null, requireOwner = false } = {}) {
    const details = await assertRegularFile(
      filePath,
      BACKUP_ERROR_CODES.BACKUP_UNVERIFIED,
      "SQLite backup file is unavailable",
    );
    if (!(await hasSqliteHeader(filePath))) {
      throw managerError(BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Decrypted backup is not a SQLite database");
    }
    const sha256 = await sha256File(filePath);
    if (expectedSha256 && sha256 !== expectedSha256) {
      throw managerError(BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH, "Decrypted backup checksum does not match its manifest");
    }
    let db;
    try {
      db = openDatabase(filePath, true);
      runIntegrityCheck(db, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED);
      if (!hasRequiredSchema(db, this.requiredTables)) {
        throw managerError(BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Backup does not contain the ArtHello application schema");
      }
      const coreSchemaVersion = readCoreSchemaVersion(db);
      if (expectedCoreSchemaVersion && coreSchemaVersion !== expectedCoreSchemaVersion) {
        throw managerError(BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Backup core schema does not match its manifest");
      }
      if (requireOwner) {
        validateCanonicalOwnerAccess(db);
        captureOwnerCredential(db);
        assertNoSessions(db);
      }
      return { sha256, sizeBytes: details.size, coreSchemaVersion };
    } catch (error) {
      throw normalizeError(error, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "SQLite backup validation failed");
    } finally {
      db?.close();
    }
  }

  async createUnlocked(kind, { skipRetention = false, expectedDatabasePath = null } = {}) {
    if (!BACKUP_KINDS.includes(kind)) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_KIND, "Unsupported backup kind");
    }
    const { backupRoot, tempRoot } = await this.ensureRoots();
    const databasePath = await this.discoverDatabase();
    if (expectedDatabasePath && databasePath !== expectedDatabasePath) {
      throw managerError(BACKUP_ERROR_CODES.DATABASE_AMBIGUOUS, "Production database changed during the operation");
    }
    const createdAt = this.currentDate();
    const backupId = this.makeBackupId(kind, createdAt);
    const operationId = randomUUID();
    const plaintextPath = join(tempRoot, `.${backupId}.plaintext-${randomUUID()}.tmp`);
    const encryptedTemporaryPath = join(backupRoot, `.${backupId}.encrypted-${randomUUID()}.tmp`);
    const encryptedName = `${backupId}.sqlite.enc`;
    const encryptedPath = join(backupRoot, encryptedName);
    const manifestName = `${backupId}.manifest.json`;
    const manifestTemporaryName = `.manifest-${backupId}-${randomUUID()}.tmp`;
    let committed = false;
    let committedResult = null;

    await this.appendOperation({ operationId, operation: "create", phase: "started", backupId, kind });
    try {
      if (await pathExists(encryptedPath)) {
        throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_ID, "Generated backup identity already exists");
      }
      let source;
      let coreSchemaVersion;
      try {
        source = openDatabase(databasePath, true);
        runIntegrityCheck(source);
        if (!hasRequiredSchema(source, this.requiredTables)) {
          throw managerError(BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED, "Source is not the ArtHello application database");
        }
        coreSchemaVersion = readCoreSchemaVersion(source);
        await sqliteBackup(source, plaintextPath);
      } finally {
        source?.close();
      }
      await chmod(plaintextPath, 0o600);
      await syncFile(plaintextPath);
      const plaintext = await this.validateDatabaseFile(plaintextPath, { expectedCoreSchemaVersion: coreSchemaVersion });

      const iv = randomBytes(12);
      const tag = await encryptFile(
        plaintextPath,
        encryptedTemporaryPath,
        this.encryptionKey,
        iv,
        { backupId, kind },
      );
      await chmod(encryptedTemporaryPath, 0o600);
      await syncFile(encryptedTemporaryPath);
      const encryptedDetails = await stat(encryptedTemporaryPath);
      const encryptedSha256 = await sha256File(encryptedTemporaryPath);
      // No durable artifact is committed until the transient plaintext and
      // all SQLite sidecars have been removed successfully.
      await removeSqliteWorkFiles(plaintextPath);
      await rename(encryptedTemporaryPath, encryptedPath);
      await chmod(encryptedPath, 0o600);
      await syncDirectory(backupRoot);

      const manifest = {
        format: BACKUP_MANIFEST_FORMAT,
        manifestVersion: 2,
        backupId,
        kind,
        createdAt: createdAt.toISOString(),
        coreSchemaVersion,
        applicationRevision: this.applicationRevision,
        encrypted: {
          fileName: encryptedName,
          sizeBytes: encryptedDetails.size,
          sha256: encryptedSha256,
        },
        plaintext: {
          sizeBytes: plaintext.sizeBytes,
          sha256: plaintext.sha256,
          integrityCheck: "ok",
        },
        encryption: {
          algorithm: "aes-256-gcm",
          keyId: this.encryptionKeyId,
          iv: iv.toString("base64"),
          tag: tag.toString("base64"),
          aad: "manifest-v2:backupId:kind",
        },
      };
      manifest.authentication = {
        algorithm: "hmac-sha256",
        keyId: this.encryptionKeyId,
        value: signManifest(manifest, this.manifestSigningKey),
      };
      await writeAtomicJson(backupRoot, manifestName, manifestTemporaryName, manifest);
      committed = true;
      const summary = backupSummary(
        manifest,
        true,
        this.supportedCoreSchemaVersions(coreSchemaVersion).has(coreSchemaVersion),
      );
      let auditStatus = "recorded";
      try {
        await this.hooks.beforeCreateSuccessAudit?.({ backupId });
        await this.appendOperation({ operationId, operation: "create", phase: "succeeded", backupId, kind });
      } catch {
        // The manifest rename above is the durable create commit point. An
        // audit outage after it must never turn a committed backup into a
        // reported failure (which would invite duplicate retries).
        auditStatus = "degraded";
      }

      if (!skipRetention) {
        try {
          await this.applyRetentionUnlocked();
        } catch (retentionError) {
          await this.appendOperation({
            operationId,
            operation: "retention",
            phase: "failed",
            failureCode: failureCode(retentionError),
          }).catch(() => {});
        }
      }
      committedResult = { ...summary, commitStatus: "committed", auditStatus };
      return committedResult;
    } catch (error) {
      if (!committed) {
        await safeUnlink(encryptedPath).catch(() => {});
        await safeUnlink(join(backupRoot, manifestName)).catch(() => {});
        await syncDirectory(backupRoot).catch(() => {});
      }
      await this.appendOperation({
        operationId,
        operation: "create",
        phase: "failed",
        backupId,
        kind,
        failureCode: failureCode(error),
      }).catch(() => {});
      throw normalizeError(error, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Backup creation failed");
    } finally {
      // Plaintext is transient only and is removed on every success/error path.
      // It was already removed strictly before the durable manifest commit;
      // this second pass catches sidecars that appeared during cleanup. A
      // secondary post-commit cleanup outage must quarantine future mutations,
      // but must not report the already-durable backup as failed.
      let cleanupError = null;
      try {
        await this.hooks.beforeCreateFinalCleanup?.({ backupId, committed });
        await removeSqliteWorkFiles(plaintextPath);
      } catch (error) {
        cleanupError = error;
      }
      await safeUnlink(encryptedTemporaryPath).catch((error) => { cleanupError ??= error; });
      await safeUnlink(join(backupRoot, manifestTemporaryName)).catch((error) => { cleanupError ??= error; });
      await syncDirectory(backupRoot).catch((error) => { cleanupError ??= error; });
      if (cleanupError) {
        if (!committed) throw cleanupError;
        await this.quarantineManager(backupRoot, {
          operation: "create_cleanup",
          failureCode: failureCode(cleanupError),
        });
        if (committedResult) {
          committedResult.auditStatus = "degraded";
          committedResult.cleanupStatus = "degraded";
          committedResult.recoveryStatus = "operator_action_required";
        }
      }
    }
  }

  async loadManifest(backupId) {
    if (!BACKUP_ID_PATTERN.test(String(backupId ?? ""))) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_ID, "Backup identity is invalid");
    }
    const { backupRoot } = await this.ensureRoots();
    const manifestPath = join(backupRoot, `${backupId}.manifest.json`);
    await assertRegularFile(manifestPath, BACKUP_ERROR_CODES.BACKUP_NOT_FOUND, "Backup was not found");
    let manifest;
    try {
      manifest = parseManifest(await readFile(manifestPath, "utf8"));
    } catch (error) {
      throw normalizeError(error, BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest is invalid");
    }
    if (manifest.backupId !== backupId) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest identity does not match its filename");
    }
    if (manifest.authentication.keyId !== this.encryptionKeyId) {
      throw managerError(BACKUP_ERROR_CODES.BACKUP_KEY_UNAVAILABLE, "Required manifest authentication key is unavailable");
    }
    const expectedSignature = Buffer.from(signManifest(manifest, this.manifestSigningKey), "hex");
    const actualSignature = Buffer.from(manifest.authentication.value, "hex");
    if (
      expectedSignature.length !== actualSignature.length
      || !timingSafeEqual(expectedSignature, actualSignature)
    ) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_MANIFEST, "Backup manifest authentication failed");
    }
    return manifest;
  }

  async decryptAndValidate(manifest, plaintextDestination) {
    const { backupRoot } = await this.ensureRoots();
    if (manifest.encryption.keyId !== this.encryptionKeyId) {
      throw managerError(BACKUP_ERROR_CODES.BACKUP_KEY_UNAVAILABLE, "Required backup encryption key is unavailable");
    }
    const encryptedPath = join(backupRoot, manifest.encrypted.fileName);
    const details = await assertRegularFile(
      encryptedPath,
      BACKUP_ERROR_CODES.BACKUP_NOT_FOUND,
      "Encrypted backup file was not found",
    );
    if (details.size !== manifest.encrypted.sizeBytes) {
      throw managerError(BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH, "Encrypted backup size does not match its manifest");
    }
    const encryptedSha256 = await sha256File(encryptedPath);
    if (encryptedSha256 !== manifest.encrypted.sha256) {
      throw managerError(BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH, "Encrypted backup checksum does not match its manifest");
    }
    try {
      await decryptFile(encryptedPath, plaintextDestination, this.encryptionKey, manifest);
      await chmod(plaintextDestination, 0o600);
      await syncFile(plaintextDestination);
      const validation = await this.validateDatabaseFile(plaintextDestination, {
        expectedSha256: manifest.plaintext.sha256,
        expectedCoreSchemaVersion: manifest.coreSchemaVersion,
      });
      if (validation.sizeBytes !== manifest.plaintext.sizeBytes) {
        throw managerError(BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH, "Decrypted backup size does not match its manifest");
      }
      return validation;
    } catch (error) {
      await removeSqliteWorkFiles(plaintextDestination);
      throw normalizeError(error, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Backup verification failed");
    }
  }

  async listUnlocked({ verifyFiles }) {
    const { backupRoot, tempRoot } = await this.ensureRoots();
    const databasePath = await this.discoverDatabase();
    let currentDb;
    let currentCoreSchemaVersion;
    try {
      currentDb = openDatabase(databasePath, true);
      runIntegrityCheck(currentDb);
      currentCoreSchemaVersion = readCoreSchemaVersion(currentDb);
    } finally {
      currentDb?.close();
    }
    const supportedCoreSchemaVersions = this.supportedCoreSchemaVersions(currentCoreSchemaVersion);
    const entries = await readdir(backupRoot, { withFileTypes: true });
    const manifestNames = entries
      .filter((entry) => entry.isFile() && /^arthello-.*\.manifest\.json$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const summaries = [];
    for (const name of manifestNames) {
      const candidateId = name.slice(0, -".manifest.json".length);
      if (!BACKUP_ID_PATTERN.test(candidateId)) continue;
      let manifest;
      try {
        manifest = await this.loadManifest(candidateId);
      } catch {
        // Invalid filenames/manifests are not echoed because they may contain
        // attacker-controlled text. Valid manifests remain visible below.
        continue;
      }
      if (!verifyFiles) {
        try {
          const encryptedPath = join(backupRoot, manifest.encrypted.fileName);
          const details = await assertRegularFile(
            encryptedPath,
            BACKUP_ERROR_CODES.BACKUP_NOT_FOUND,
            "Encrypted backup file was not found",
          );
          if (details.size !== manifest.encrypted.sizeBytes) {
            throw managerError(BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH, "Encrypted backup size does not match its manifest");
          }
          if (await sha256File(encryptedPath) !== manifest.encrypted.sha256) {
            throw managerError(BACKUP_ERROR_CODES.BACKUP_CHECKSUM_MISMATCH, "Encrypted backup checksum does not match its manifest");
          }
          summaries.push(backupSummary(
            manifest,
            true,
            supportedCoreSchemaVersions.has(manifest.coreSchemaVersion),
            { verification: "ciphertext" },
          ));
        } catch (error) {
          summaries.push(backupSummary(manifest, false, false, { failureCode: failureCode(error) }));
        }
        continue;
      }
      const temporaryPath = join(tempRoot, `.${manifest.backupId}.decrypt-${randomUUID()}.tmp`);
      try {
        await this.decryptAndValidate(manifest, temporaryPath);
        summaries.push(backupSummary(
          manifest,
          true,
          supportedCoreSchemaVersions.has(manifest.coreSchemaVersion),
        ));
      } catch (error) {
        summaries.push(backupSummary(manifest, false, false, { failureCode: failureCode(error) }));
      } finally {
        await removeSqliteWorkFiles(temporaryPath);
      }
    }
    return summaries.sort((left, right) => {
      const byDate = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      return byDate || right.id.localeCompare(left.id);
    });
  }

  async applyRetentionUnlocked() {
    // HMAC-authenticated metadata plus ciphertext size/SHA is sufficient for
    // retention decisions. Full decrypt + SQLite checks remain target-only in
    // verify()/restore() and periodic restore drills.
    const backups = await this.listUnlocked({ verifyFiles: false });
    const now = this.currentDate();
    const dailyCutoff = now.getTime() - this.dailyRetentionDays * 24 * 60 * 60 * 1000;
    const retainedMonthly = new Set();
    const deleteIds = [];
    const eligible = backups
      .filter((item) => item.verified && item.kind !== "manual")
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    for (const item of eligible) {
      const created = new Date(item.createdAt);
      const monthKey = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, "0")}`;
      if (item.kind === "monthly") {
        const expiresAt = new Date(created);
        expiresAt.setUTCMonth(expiresAt.getUTCMonth() + this.monthlyRetentionMonths);
        if (
          created.getTime() <= now.getTime()
          && now.getTime() < expiresAt.getTime()
          && !retainedMonthly.has(monthKey)
        ) {
          retainedMonthly.add(monthKey);
          continue;
        }
        if (created.getTime() > now.getTime()) continue;
        deleteIds.push(item.id);
        continue;
      }
      if (created.getTime() >= dailyCutoff || created.getTime() > now.getTime()) continue;
      deleteIds.push(item.id);
    }

    const { backupRoot } = await this.ensureRoots();
    const operationId = randomUUID();
    for (const backupId of deleteIds) {
      const manifest = await this.loadManifest(backupId);
      if (manifest.kind === "manual") continue;
      await this.appendOperation({ operationId, operation: "retention_delete", phase: "started", backupId, kind: manifest.kind });
      await safeUnlink(join(backupRoot, manifest.encrypted.fileName));
      await safeUnlink(join(backupRoot, `${backupId}.manifest.json`));
      await syncDirectory(backupRoot);
      await this.appendOperation({ operationId, operation: "retention_delete", phase: "succeeded", backupId, kind: manifest.kind });
    }
    return { deletedIds: deleteIds };
  }

  assertApplicationStopped() {
    let stopped = false;
    try {
      stopped = this.isApplicationStopped() === true;
    } catch {
      stopped = false;
    }
    if (!stopped) {
      throw managerError(
        BACKUP_ERROR_CODES.APPLICATION_NOT_STOPPED,
        "Restore refused: the ArtHello application must be stopped",
      );
    }
  }

  prepareRestoreCandidate(candidatePath, currentCredential, expectedCoreSchemaVersion) {
    let candidate;
    let transactionOpen = false;
    try {
      candidate = openDatabase(candidatePath, false);
      runIntegrityCheck(candidate, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED);
      if (!hasRequiredSchema(candidate, this.requiredTables)) {
        throw managerError(BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Restore candidate is not an ArtHello database");
      }
      if (readCoreSchemaVersion(candidate) !== expectedCoreSchemaVersion) {
        throw managerError(BACKUP_ERROR_CODES.BACKUP_INCOMPATIBLE, "Backup core schema is incompatible with the running application");
      }
      candidate.exec("PRAGMA journal_mode=DELETE");
      candidate.exec("PRAGMA synchronous=FULL");
      candidate.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      restoreOwnerCredentialAndRevokeSessions(candidate, currentCredential);
      validateCanonicalOwnerAccess(candidate);
      captureOwnerCredential(candidate);
      assertNoSessions(candidate);
      candidate.exec("COMMIT");
      transactionOpen = false;
      runIntegrityCheck(candidate, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED);
    } catch (error) {
      if (transactionOpen) {
        try {
          candidate?.exec("ROLLBACK");
        } catch {
          // Preserve the original validation error.
        }
      }
      throw normalizeError(error, BACKUP_ERROR_CODES.BACKUP_UNVERIFIED, "Restore candidate preparation failed");
    } finally {
      candidate?.close();
    }
  }

  async restoreFilesystemOriginal(state) {
    const {
      databasePath,
      archivedDatabasePath,
      archiveCreated,
      atomicReplaced,
      targetDirectory,
    } = state;
    if (!archiveCreated) return "not_required";
    if (!atomicReplaced) {
      await safeUnlink(archivedDatabasePath);
      state.archiveCreated = false;
      await syncDirectory(targetDirectory);
      return "not_required";
    }
    await safeUnlink(`${databasePath}-wal`).catch(() => {});
    await safeUnlink(`${databasePath}-shm`).catch(() => {});
    // POSIX rename over the live path is atomic: the pathname always resolves
    // to either the prepared candidate or the rollback inode.
    await rename(archivedDatabasePath, databasePath);
    state.archiveCreated = false;
    state.atomicReplaced = false;
    await syncDirectory(targetDirectory);
    let db;
    try {
      db = openDatabase(databasePath, true);
      runIntegrityCheck(db);
      validateCanonicalOwnerAccess(db);
      captureOwnerCredential(db);
    } finally {
      db?.close();
    }
    return "succeeded";
  }

  async checkpointCurrentDatabaseForAtomicReplace(databasePath) {
    let db;
    try {
      db = openDatabase(databasePath, false);
      runIntegrityCheck(db);
      validateCanonicalOwnerAccess(db);
      captureOwnerCredential(db);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const modeRow = db.prepare("PRAGMA journal_mode=DELETE").get();
      const mode = String(Object.values(modeRow ?? {})[0] ?? "").toLowerCase();
      if (mode !== "delete") {
        throw managerError(BACKUP_ERROR_CODES.RESTORE_FAILED, "Current database could not enter rollback-safe journal mode");
      }
      runIntegrityCheck(db);
    } finally {
      db?.close();
    }
    await syncFile(databasePath);
    await safeUnlink(`${databasePath}-wal`).catch(() => {});
    await safeUnlink(`${databasePath}-shm`).catch(() => {});
    await syncDirectory(dirname(databasePath));
  }

  async createRollbackArchive(databasePath, archivePath) {
    try {
      await link(databasePath, archivePath);
    } catch (error) {
      if (!["EPERM", "EOPNOTSUPP", "ENOTSUP", "EXDEV", "EMLINK"].includes(error?.code)) throw error;
      await copyFile(databasePath, archivePath, 0);
      await chmod(archivePath, 0o600);
    }
    await syncFile(archivePath);
    await syncDirectory(dirname(databasePath));
  }

  async restoreUnlocked(backupId, { existingSafetyBackup = false } = {}) {
    this.assertApplicationStopped();
    if (!BACKUP_ID_PATTERN.test(String(backupId ?? ""))) {
      throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_ID, "Backup identity is invalid");
    }
    const auditOperation = existingSafetyBackup ? "safety_restore" : "restore";
    const operationId = randomUUID();
    await this.appendOperation({
      operationId,
      operation: auditOperation,
      phase: "started",
      backupId,
      safetyBackupId: existingSafetyBackup ? backupId : null,
    });

    let candidatePath = null;
    let safetyBackup = null;
    let filesystemState = null;
    try {
      const databasePath = await this.discoverDatabase();
      const targetDirectory = dirname(databasePath);
      const currentDbName = basename(databasePath);
      let currentDb;
      let currentCoreSchemaVersion;
      let currentCredential;
      try {
        currentDb = openDatabase(databasePath, true);
        runIntegrityCheck(currentDb);
        if (!hasRequiredSchema(currentDb, this.requiredTables)) {
          throw managerError(BACKUP_ERROR_CODES.SOURCE_INTEGRITY_FAILED, "Current database is not the ArtHello database");
        }
        currentCoreSchemaVersion = readCoreSchemaVersion(currentDb);
        validateCanonicalOwnerAccess(currentDb);
        currentCredential = captureOwnerCredential(currentDb);
      } finally {
        currentDb?.close();
      }

      const manifest = await this.loadManifest(backupId);
      if (
        existingSafetyBackup
        && (manifest.kind !== "pre_restore" || manifest.applicationRevision !== this.applicationRevision)
      ) {
        throw managerError(
          BACKUP_ERROR_CODES.INVALID_SAFETY_BACKUP,
          "Safety rollback requires a pre-restore point created by this application revision",
        );
      }
      candidatePath = join(targetDirectory, `.${currentDbName}.restore-${randomUUID()}.tmp`);
      await this.decryptAndValidate(manifest, candidatePath);
      // An existing safety point was created from the live database by this
      // exact application revision immediately before the original restore.
      // The failed application start may have partially migrated the restored
      // target, so its now-current core version is not an authoritative
      // compatibility baseline for rolling that safety point back. An
      // explicitly configured allowlist remains authoritative when present.
      const compatible = existingSafetyBackup && this.configuredSupportedCoreSchemaVersions === null
        ? true
        : this.supportedCoreSchemaVersions(currentCoreSchemaVersion).has(manifest.coreSchemaVersion);
      if (!compatible) {
        throw managerError(
          BACKUP_ERROR_CODES.BACKUP_INCOMPATIBLE,
          "Backup core schema is incompatible with the running application",
        );
      }

      if (!existingSafetyBackup) {
        // This is mandatory and occurs after selected-backup verification but
        // before the first mutation of the production database filesystem.
        safetyBackup = await this.createUnlocked("pre_restore", {
          skipRetention: true,
          expectedDatabasePath: databasePath,
        });
      }
      const auditSafetyBackupId = existingSafetyBackup ? backupId : safetyBackup.id;

      this.prepareRestoreCandidate(candidatePath, currentCredential, manifest.coreSchemaVersion);
      await chmod(candidatePath, 0o600);
      await syncFile(candidatePath);
      await this.validateDatabaseFile(candidatePath, {
        expectedCoreSchemaVersion: manifest.coreSchemaVersion,
        requireOwner: true,
      });

      await this.hooks.beforeAtomicReplace?.({ backupId });
      const archiveToken = randomUUID();
      filesystemState = {
        databasePath,
        targetDirectory,
        archivedDatabasePath: join(targetDirectory, `.${currentDbName}.rollback-${archiveToken}`),
        archiveCreated: false,
        atomicReplaced: false,
      };
      await this.checkpointCurrentDatabaseForAtomicReplace(databasePath);
      await this.createRollbackArchive(databasePath, filesystemState.archivedDatabasePath);
      filesystemState.archiveCreated = true;
      await this.hooks.beforeAtomicRename?.({ backupId });
      // Atomic replace: databasePath is never absent, even if the process or
      // host dies at the exact commit boundary.
      await rename(candidatePath, databasePath);
      candidatePath = null;
      filesystemState.atomicReplaced = true;
      await syncDirectory(targetDirectory);
      await this.hooks.afterAtomicReplace?.({ backupId });

      await this.validateDatabaseFile(databasePath, {
        expectedCoreSchemaVersion: manifest.coreSchemaVersion,
        requireOwner: true,
      });

      // This record is fail-closed while the rollback inode still exists. If
      // it cannot be fsynced, the catch path atomically restores the original.
      await this.appendOperation({
        operationId,
        operation: auditOperation,
        phase: "commit_ready",
        backupId,
        safetyBackupId: auditSafetyBackupId,
        filesystemRollback: "available",
      });

      await safeUnlink(filesystemState.archivedDatabasePath);
      // Unlink is the point after which filesystem rollback is no longer
      // available. Record that immediately: a subsequent directory-fsync
      // outage must never enter the failure path and falsely claim that the
      // already-live, validated target was rolled back.
      filesystemState.archiveCreated = false;
      let cleanupAuditStatus = "recorded";
      try {
        await this.hooks.afterRollbackArchiveUnlink?.({ backupId });
        await syncDirectory(targetDirectory);
      } catch {
        // A crash may make the old archive reappear if the unlink was not
        // durably synced; startup reconciliation will then retain a divergent
        // inode for operator review. The committed live DB remains valid.
        cleanupAuditStatus = "degraded";
      }

      const restoredAt = this.currentDate().toISOString();
      let auditStatus = cleanupAuditStatus;
      try {
        await this.hooks.beforeRestoreSuccessAudit?.({ backupId });
        await this.appendOperation({
          operationId,
          operation: auditOperation,
          phase: "succeeded",
          backupId,
          safetyBackupId: auditSafetyBackupId,
          filesystemRollback: "not_required",
        });
      } catch {
        // The rollback inode is already durably removed: the data commit is
        // final. Report the audit degradation without claiming restore failed.
        auditStatus = "degraded";
      }
      if (!existingSafetyBackup) {
        try {
          await this.applyRetentionUnlocked();
        } catch (retentionError) {
          await this.appendOperation({
            operationId,
            operation: "retention",
            phase: "failed",
            failureCode: failureCode(retentionError),
          }).catch(() => {});
        }
      }
      return {
        backupId,
        safetyBackupId: safetyBackup?.id ?? null,
        restoreMode: existingSafetyBackup ? "existing_safety" : "standard",
        restoredAt,
        verified: true,
        coreSchemaVersion: manifest.coreSchemaVersion,
        applicationRevision: manifest.applicationRevision,
        commitStatus: "committed",
        auditStatus,
      };
    } catch (error) {
      let rollbackStatus = "not_required";
      let rollbackError = null;
      if (filesystemState?.archiveCreated) {
        try {
          rollbackStatus = await this.restoreFilesystemOriginal(filesystemState);
        } catch (failure) {
          rollbackStatus = "failed";
          rollbackError = failure;
        }
      }
      await this.appendOperation({
        operationId,
        operation: auditOperation,
        phase: "failed",
        backupId,
        safetyBackupId: existingSafetyBackup ? backupId : (safetyBackup?.id ?? null),
        failureCode: rollbackError ? BACKUP_ERROR_CODES.RESTORE_ROLLBACK_FAILED : failureCode(error),
        filesystemRollback: rollbackStatus,
      }).catch(() => {});
      if (rollbackError) {
        throw managerError(
          BACKUP_ERROR_CODES.RESTORE_ROLLBACK_FAILED,
          "Restore failed and filesystem rollback could not be verified",
          rollbackError,
        );
      }
      throw normalizeError(error, BACKUP_ERROR_CODES.RESTORE_FAILED, "Restore failed");
    } finally {
      if (candidatePath) await removeSqliteWorkFiles(candidatePath);
    }
  }
}

export function createProductionBackupManager(options = {}) {
  return new ProductionBackupManager(options);
}

export async function createProductionBackup(kind, options = {}) {
  return createProductionBackupManager(options).create(kind);
}

export async function listProductionBackups(options = {}) {
  return createProductionBackupManager(options).list();
}

export async function restoreProductionBackup(backupId, options = {}) {
  return createProductionBackupManager(options).restore(backupId);
}

export async function restoreProductionSafetyBackup(backupId, options = {}) {
  return createProductionBackupManager(options).restoreSafetyBackup(backupId);
}

export async function verifyProductionBackup(backupId, options = {}) {
  return createProductionBackupManager(options).verify(backupId);
}

function cliUsage() {
  return `Usage:
  node production/backup-manager.mjs create manual|automatic|monthly|pre_deploy|pre_restore
  node production/backup-manager.mjs create-no-retention pre_deploy
  node production/backup-manager.mjs list
  node production/backup-manager.mjs verify <backup-id>
  node production/backup-manager.mjs restore <backup-id>
  node production/backup-manager.mjs retention

Required: ARTHELLO_BACKUP_ENCRYPTION_KEY (canonical base64, 32 bytes).
Restore additionally requires ARTHELLO_APP_STOPPED=1.`;
}

async function runCli(argv) {
  const [command, argument, ...extra] = argv;
  if (!command || command === "--help" || command === "-h") {
    console.log(cliUsage());
    return;
  }
  if (extra.length !== 0) {
    throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Too many command arguments");
  }
  const manager = createProductionBackupManager();
  if (command === "create") {
    if (!argument) throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_KIND, "Backup kind is required");
    console.log(JSON.stringify(await manager.create(argument)));
    return;
  }
  if (command === "create-no-retention") {
    if (argument !== "pre_deploy") {
      throw managerError(
        BACKUP_ERROR_CODES.INVALID_BACKUP_KIND,
        "Retention bypass is permitted only for a pre_deploy backup",
      );
    }
    console.log(JSON.stringify(await manager.create("pre_deploy", { skipRetention: true })));
    return;
  }
  if (command === "list") {
    if (argument) throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "List does not accept an argument");
    console.log(JSON.stringify({ backups: await manager.list() }));
    return;
  }
  if (command === "restore") {
    if (!argument) throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_ID, "Backup identity is required");
    console.log(JSON.stringify(await manager.restore(argument)));
    return;
  }
  if (command === "verify") {
    if (!argument) throw managerError(BACKUP_ERROR_CODES.INVALID_BACKUP_ID, "Backup identity is required");
    console.log(JSON.stringify(await manager.verify(argument)));
    return;
  }
  if (command === "retention") {
    if (argument) throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Retention does not accept an argument");
    console.log(JSON.stringify(await manager.applyRetention()));
    return;
  }
  throw managerError(BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Unknown backup-manager command");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2)).catch((error) => {
    const safe = normalizeError(error, BACKUP_ERROR_CODES.INVALID_CONFIGURATION, "Backup operation failed");
    console.error(JSON.stringify({ status: "failed", code: safe.code, message: safe.message }));
    process.exitCode = 1;
  });
}
