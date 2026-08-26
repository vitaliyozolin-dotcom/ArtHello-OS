#!/usr/bin/env node

/**
 * ArtHello OS production clean-slate utility.
 *
 * This script never drops tables. It preserves the application schema,
 * branches, systems, and the three explicitly allowlisted people together
 * with their access/authentication records and basic employee/entity cards.
 * Every other application table is emptied.
 *
 * Expected runtime: Node.js 24+ (node:sqlite) with the production volume
 * mounted at /data. Destructive commands additionally require the application
 * to be stopped and an exact confirmation phrase.
 */

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";

const SCRIPT_VERSION = "arthello-production-clean-slate-v2";
const EXECUTE_CONFIRMATION = "CLEAN_SLATE_ARTHELLO_PRODUCTION";
const ROLLBACK_CONFIRMATION = "ROLLBACK_ARTHELLO_PRODUCTION";
const DEFAULT_ROOT = "/data";
const DEFAULT_MAX_DEPTH = 12;
const ARTHELLO_SYSTEM_ID = "SYS-ARTHELLO-OS";

const PEOPLE = Object.freeze([
  Object.freeze({
    key: "owner",
    appUserId: "USR-OWNER",
    authUserId: "AUTH-OWNER",
    employeeId: null,
    name: "Виталий Озолин",
    expectedRole: "Собственник",
    expectedAdministrative: true,
    preserveAppUser: true,
    preserveEmployee: false,
  }),
  Object.freeze({
    key: "gutakovskaya",
    appUserId: "EMP-M-92B042CF",
    authUserId: "EMP-M-92B042CF",
    employeeId: "EMP-M-92B042CF",
    name: "Наталья Гутаковская",
    expectedRole: "Директор",
    expectedAdministrative: null,
    preserveAppUser: true,
    preserveEmployee: true,
  }),
  Object.freeze({
    key: "dmitrieva",
    appUserId: "EMP-M-95A08A4C",
    authUserId: "EMP-M-95A08A4C",
    employeeId: "EMP-M-95A08A4C",
    name: "Наталья Дмитриева",
    expectedRole: "Завуч",
    expectedAdministrative: null,
    preserveAppUser: true,
    preserveEmployee: true,
  }),
]);

const EXPECTED_APP_USER_COUNT = PEOPLE.filter((person) => person.preserveAppUser).length;
const EXPECTED_EMPLOYEE_COUNT = PEOPLE.filter((person) => person.preserveEmployee).length;

const REQUIRED_APP_TABLES = Object.freeze([
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

const PRESERVED_CONFIG_TABLES = new Set([
  "organization_branches",
  "app_systems",
  // Keeps the completed bootstrap-password rotation from being replayed after
  // the reset. This is authentication state, not business/demo data.
  "production_auth_bootstrap_resets",
]);

const FILTERED_IDENTITY_TABLES = new Set([
  "app_users",
  "user_system_access",
  "user_branch_access",
  "entities",
  "hr_employees",
  "hr_accesses",
  "production_auth_credentials",
  "production_auth_sessions",
]);

const INTERNAL_TABLE_NAMES = new Set([
  // Miniflare/D1 metadata is part of the storage engine and must never be
  // treated as application data.
  "_cf_METADATA",
  "_cf_KV",
  "d1_migrations",
  "__drizzle_migrations",
]);

function usage() {
  return `Usage:
  node production-clean-slate.mjs inventory [--root /data] [--db /data/...sqlite]
  node production-clean-slate.mjs backup    [--root /data] [--db /data/...sqlite]
  node production-clean-slate.mjs execute   --confirm ${EXECUTE_CONFIRMATION} [--root /data] [--db ...]
  node production-clean-slate.mjs verify    [--root /data] [--db /data/...sqlite]
  node production-clean-slate.mjs rollback  --confirm ${ROLLBACK_CONFIRMATION} --manifest /data/backups/...json

Destructive commands also require ARTHELLO_APP_STOPPED=1.
The script never prints contacts, password hashes, salts, session tokens, or logins.`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const result = { command, root: DEFAULT_ROOT, db: null, confirm: null, manifest: null };
  if (command === "--help" || command === "-h") {
    result.command = null;
    result.help = true;
  }
  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];
    if (current === "--help" || current === "-h") {
      result.help = true;
      continue;
    }
    if (!["--root", "--db", "--confirm", "--manifest"].includes(current)) {
      throw new Error(`Unknown argument: ${current}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${current}`);
    }
    result[current.slice(2)] = value;
    index += 1;
  }
  return result;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/ё/gu, "е")
    .toLocaleLowerCase("ru-RU");
}

function normalizeLogin(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/u.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function placeholders(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("At least one bound value is required");
  }
  return new Array(count).fill("?").join(",");
}

function isPathInside(rootPath, candidatePath) {
  const rel = relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function assertExistingPathInside(rootPath, candidatePath, label) {
  const [realRoot, realCandidate] = await Promise.all([realpath(rootPath), realpath(candidatePath)]);
  if (!isPathInside(realRoot, realCandidate)) {
    throw new Error(`${label} is outside the permitted data root`);
  }
  return realCandidate;
}

async function hasSqliteHeader(filePath) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return bytesRead === 16 && buffer.toString("utf8") === "SQLite format 3\u0000";
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function walkFiles(rootPath, maxDepth = DEFAULT_MAX_DEPTH) {
  const result = [];
  async function visit(directory, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (/^(backups?|lost\+found)$/iu.test(entry.name)) continue;
        await visit(absolute, depth + 1);
      } else if (entry.isFile()) {
        if (
          /(?:-wal|-shm|-journal|\.manifest\.json)$/iu.test(entry.name) ||
          /\.(?:pre-rollback|failed-restore)-/iu.test(entry.name)
        ) continue;
        result.push(absolute);
      }
    }
  }
  await visit(rootPath, 0);
  return result;
}

function openDatabase(filePath, readOnly) {
  const db = new DatabaseSync(filePath, {
    open: true,
    readOnly,
    enableForeignKeyConstraints: false,
  });
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

function hasRequiredAppSchema(db) {
  const tables = new Set(tableNames(db));
  return REQUIRED_APP_TABLES.every((table) => tables.has(table));
}

async function findAppDatabase(rootPath, explicitDbPath) {
  const realRoot = await realpath(rootPath);
  if (explicitDbPath) {
    const realDb = await assertExistingPathInside(realRoot, resolve(explicitDbPath), "Database path");
    if (!(await hasSqliteHeader(realDb))) throw new Error("Explicit database path is not SQLite");
    const db = openDatabase(realDb, true);
    try {
      if (!hasRequiredAppSchema(db)) throw new Error("Explicit SQLite file is not the ArtHello application database");
    } finally {
      db.close();
    }
    return realDb;
  }

  const files = await walkFiles(realRoot);
  const matches = [];
  for (const filePath of files) {
    if (!(await hasSqliteHeader(filePath))) continue;
    let db;
    try {
      db = openDatabase(filePath, true);
      if (hasRequiredAppSchema(db)) matches.push(await realpath(filePath));
    } catch {
      // Ignore unrelated or temporarily inaccessible SQLite files.
    } finally {
      db?.close();
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ArtHello application database under the data root; found ${matches.length}`);
  }
  return matches[0];
}

function integrityCheck(db) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  const messages = rows.map((row) => String(Object.values(row)[0]));
  if (messages.length !== 1 || messages[0].toLowerCase() !== "ok") {
    throw new Error(`SQLite integrity check failed (${messages.length} finding(s))`);
  }
  return "ok";
}

function foreignKeyCheck(db) {
  const rows = db.prepare("PRAGMA foreign_key_check").all();
  if (rows.length !== 0) {
    throw new Error(`SQLite foreign-key check failed (${rows.length} finding(s))`);
  }
}

function tableColumns(db, tableName) {
  return new Set(
    db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((row) => String(row.name)),
  );
}

function requireColumns(db, tableName, requiredColumns) {
  const columns = tableColumns(db, tableName);
  for (const column of requiredColumns) {
    if (!columns.has(column)) throw new Error(`Required column ${tableName}.${column} is missing`);
  }
}

function isInternalTable(tableName) {
  return tableName.startsWith("sqlite_") || INTERNAL_TABLE_NAMES.has(tableName);
}

function applicationTables(db) {
  return tableNames(db).filter((name) => !isInternalTable(name));
}

function countRows(db, tableName) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get();
  return Number(row.count);
}

function countsByTable(db) {
  return Object.fromEntries(applicationTables(db).map((name) => [name, countRows(db, name)]));
}

function resolveAllowlist(db) {
  requireColumns(db, "app_users", [
    "id",
    "contact",
    "display_name",
    "role",
    "status",
    "is_administrative",
    "access_version",
  ]);
  const appUsers = db
    .prepare(`SELECT id, contact, display_name, role, status,
      is_administrative, access_version FROM app_users ORDER BY id`)
    .all()
    .map((row) => ({
      id: String(row.id),
      contact: String(row.contact),
      displayName: String(row.display_name),
      role: String(row.role),
      status: String(row.status),
      isAdministrative: Number(row.is_administrative),
      accessVersion: Number(row.access_version),
    }));

  const selectedUsers = [];
  for (const person of PEOPLE.filter((candidate) => candidate.preserveAppUser)) {
    if (!person.appUserId) throw new Error(`Allowlisted person ${person.name} has no pinned app_users ID`);
    const idMatches = appUsers.filter((row) => row.id === person.appUserId);
    if (idMatches.length !== 1) {
      throw new Error(`Allowlisted app_users.id=${person.appUserId} must exist exactly once`);
    }
    const match = idMatches[0];
    if (normalizeName(match.displayName) !== normalizeName(person.name)) {
      throw new Error(`Pinned app user ${person.appUserId} does not have the expected display name`);
    }
    const nameMatches = appUsers.filter(
      (row) => normalizeName(row.displayName) === normalizeName(person.name),
    );
    if (nameMatches.length !== 1 || nameMatches[0].id !== person.appUserId) {
      throw new Error(`Allowlisted person ${person.name} is ambiguous in app_users`);
    }
    if (match.role !== person.expectedRole) {
      throw new Error(`Allowlisted app user ${person.appUserId} has an unexpected role`);
    }
    if (match.status !== "Активен") {
      throw new Error(`Allowlisted app user ${person.appUserId} is not active`);
    }
    if (
      person.expectedAdministrative !== null
      && Boolean(match.isAdministrative) !== person.expectedAdministrative
    ) {
      throw new Error(`Allowlisted app user ${person.appUserId} has an unexpected administrative scope`);
    }
    selectedUsers.push({ ...person, ...match });
  }

  const userIds = new Set(selectedUsers.map((row) => row.id));
  if (userIds.size !== EXPECTED_APP_USER_COUNT) throw new Error("Allowlist resolved to duplicate app_users IDs");

  requireColumns(db, "app_systems", ["id", "status"]);
  const artHelloSystems = db
    .prepare("SELECT id, status FROM app_systems WHERE id=?")
    .all(ARTHELLO_SYSTEM_ID);
  if (artHelloSystems.length !== 1 || String(artHelloSystems[0].status) !== "Активна") {
    throw new Error(`Required active application system ${ARTHELLO_SYSTEM_ID} is missing`);
  }

  requireColumns(db, "user_system_access", [
    "user_id",
    "system_id",
    "role",
    "status",
    "access_version",
  ]);
  const accessRows = db
    .prepare(`SELECT user_id, system_id, role, status, access_version
      FROM user_system_access WHERE system_id=? ORDER BY user_id`)
    .all(ARTHELLO_SYSTEM_ID)
    .map((row) => ({
      userId: String(row.user_id),
      systemId: String(row.system_id),
      role: String(row.role),
      status: String(row.status),
      accessVersion: Number(row.access_version),
    }));
  const artHelloGrants = [];
  for (const user of selectedUsers) {
    const matches = accessRows.filter((row) => row.userId === user.id);
    if (matches.length !== 1) {
      throw new Error(`Allowlisted app user ${user.id} must have exactly one ArtHello OS grant`);
    }
    const grant = matches[0];
    if (
      grant.status !== "Активен"
      || grant.role !== user.role
      || grant.accessVersion !== user.accessVersion
    ) {
      throw new Error(`Allowlisted app user ${user.id} has an inconsistent ArtHello OS grant`);
    }
    artHelloGrants.push(grant);
  }

  requireColumns(db, "entities", ["id", "entity_type", "display_name"]);
  const entityRows = db
    .prepare("SELECT id, entity_type, display_name FROM entities ORDER BY id")
    .all()
    .map((row) => ({
      id: String(row.id),
      entityType: String(row.entity_type),
      displayName: String(row.display_name),
    }));
  const employeeTypes = new Set([normalizeName("Сотрудник"), normalizeName("Employee")]);
  const entityIds = new Set();
  const selectedEntities = [];
  for (const person of PEOPLE.filter((candidate) => candidate.preserveEmployee)) {
    if (!person.employeeId) throw new Error(`Allowlisted person ${person.name} has no pinned employee ID`);
    const idMatches = entityRows.filter((row) => row.id === person.employeeId);
    if (idMatches.length !== 1) {
      throw new Error(`Allowlisted employee entity ${person.employeeId} must exist exactly once`);
    }
    const match = idMatches[0];
    if (
      normalizeName(match.displayName) !== normalizeName(person.name)
      || !employeeTypes.has(normalizeName(match.entityType))
    ) {
      throw new Error(`Pinned employee entity ${person.employeeId} does not match the expected person`);
    }
    const nameMatches = entityRows.filter(
      (row) =>
        normalizeName(row.displayName) === normalizeName(person.name)
        && employeeTypes.has(normalizeName(row.entityType)),
    );
    if (nameMatches.length !== 1 || nameMatches[0].id !== person.employeeId) {
      throw new Error(`Allowlisted person ${person.name} is ambiguous in employee entities`);
    }
    entityIds.add(match.id);
    selectedEntities.push(match);
  }
  if (entityIds.size !== EXPECTED_EMPLOYEE_COUNT) {
    throw new Error(`Allowlist must resolve to exactly ${EXPECTED_EMPLOYEE_COUNT} employee entities`);
  }

  requireColumns(db, "hr_employees", ["id"]);
  const employeeRows = db.prepare("SELECT id FROM hr_employees ORDER BY id").all();
  const allEmployeeIds = new Set(employeeRows.map((row) => String(row.id)));
  const employeeIds = new Set();
  for (const person of PEOPLE.filter((candidate) => candidate.preserveEmployee)) {
    if (!person.employeeId || !allEmployeeIds.has(person.employeeId)) {
      throw new Error(`Pinned hr_employees row for ${person.name} is missing`);
    }
    employeeIds.add(person.employeeId);
  }
  if (employeeIds.size !== EXPECTED_EMPLOYEE_COUNT) {
    throw new Error(`Allowlist must resolve to exactly ${EXPECTED_EMPLOYEE_COUNT} hr_employees rows`);
  }

  requireColumns(db, "production_auth_credentials", ["user_id", "login", "display_name"]);
  const credentials = db
    .prepare("SELECT user_id, login, display_name FROM production_auth_credentials ORDER BY user_id")
    .all()
    .map((row) => ({
      userId: String(row.user_id),
      login: String(row.login),
      displayName: String(row.display_name),
    }));
  const credentialUserIds = new Set();
  const credentialCountsByPerson = Object.fromEntries(PEOPLE.map((person) => [person.key, 0]));
  for (const person of PEOPLE.filter((candidate) => candidate.preserveAppUser)) {
    if (!person.authUserId || !person.appUserId) {
      throw new Error(`Allowlisted person ${person.name} has no pinned authentication ID`);
    }
    const matches = credentials.filter((credential) => credential.userId === person.authUserId);
    if (matches.length !== 1) {
      throw new Error(`Allowlisted authentication credential ${person.authUserId} must exist exactly once`);
    }
    const credential = matches[0];
    if (normalizeName(credential.displayName) !== normalizeName(person.name)) {
      throw new Error(`Pinned authentication credential ${person.authUserId} has an unexpected display name`);
    }
    const sameName = credentials.filter(
      (candidate) => normalizeName(candidate.displayName) === normalizeName(person.name),
    );
    if (sameName.length !== 1 || sameName[0].userId !== person.authUserId) {
      throw new Error(`Allowlisted person ${person.name} is ambiguous in authentication credentials`);
    }
    const appUser = selectedUsers.find((candidate) => candidate.id === person.appUserId);
    if (!appUser) throw new Error(`Pinned app user ${person.appUserId} was not resolved`);
    if (normalizeLogin(credential.login) === "") {
      throw new Error(`Authentication login for ${person.authUserId} is empty`);
    }
    if (
      person.key !== "owner"
      && (
        normalizeLogin(appUser.contact) === ""
        || normalizeLogin(credential.login) !== normalizeLogin(appUser.contact)
      )
    ) {
      throw new Error(`Authentication login for ${person.appUserId} does not match the app-user contact`);
    }
    credentialCountsByPerson[person.key] = 1;
    credentialUserIds.add(person.authUserId);
  }
  if (credentialUserIds.size !== EXPECTED_APP_USER_COUNT) {
    throw new Error(`Allowlist must resolve to exactly ${EXPECTED_APP_USER_COUNT} authentication credentials`);
  }

  return {
    users: selectedUsers,
    userIds,
    entities: selectedEntities,
    entityIds,
    employeeIds,
    artHelloGrants,
    credentialUserIds,
    credentialCountsByPerson,
  };
}

function safeAllowlistSummary(resolved) {
  return PEOPLE.map((person) => {
    const user = resolved.users.find((candidate) => candidate.key === person.key);
    const entity = resolved.entities.find(
      (candidate) => normalizeName(candidate.displayName) === normalizeName(person.name),
    );
    return {
      id: user?.id ?? entity?.id ?? null,
      displayName: person.name,
      role: user?.role ?? null,
      status: user?.status ?? null,
      hasAppUser: Boolean(user),
      hasEmployeeEntity: Boolean(entity),
      hasCredential: resolved.credentialCountsByPerson[person.key] === 1,
    };
  });
}

function inspectDatabase(db, dbPath) {
  integrityCheck(db);
  const resolved = resolveAllowlist(db);
  const counts = countsByTable(db);
  return {
    scriptVersion: SCRIPT_VERSION,
    mode: "inventory",
    databaseFile: basename(dbPath),
    integrity: "ok",
    allowlist: safeAllowlistSummary(resolved),
    preservedConfig: {
      branches: counts.organization_branches ?? 0,
      systems: counts.app_systems ?? 0,
    },
    tableCounts: counts,
  };
}

function deleteExcept(db, tableName, columnName, retainedValues) {
  requireColumns(db, tableName, [columnName]);
  const values = [...retainedValues];
  if (values.length === 0) {
    db.exec(`DELETE FROM ${quoteIdentifier(tableName)}`);
    return;
  }
  db.prepare(
    `DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} NOT IN (${placeholders(values.length)})`,
  ).run(...values);
}

function applyCleanSlate(db, resolved) {
  const tables = new Set(applicationTables(db));

  for (const tableName of [...tables].sort()) {
    if (PRESERVED_CONFIG_TABLES.has(tableName)) continue;
    if (FILTERED_IDENTITY_TABLES.has(tableName)) continue;
    if (tableName === "system_runtime_state") continue;
    db.exec(`DELETE FROM ${quoteIdentifier(tableName)}`);
  }

  deleteExcept(db, "app_users", "id", resolved.userIds);
  deleteExcept(db, "user_system_access", "user_id", resolved.userIds);
  deleteExcept(db, "user_branch_access", "user_id", resolved.userIds);
  deleteExcept(db, "entities", "id", resolved.entityIds);
  deleteExcept(db, "hr_employees", "id", resolved.employeeIds);
  deleteExcept(db, "hr_accesses", "employee_id", resolved.employeeIds);

  if (tables.has("production_auth_credentials")) {
    deleteExcept(db, "production_auth_credentials", "user_id", resolved.credentialUserIds);
  }
  if (tables.has("production_auth_sessions")) {
    deleteExcept(db, "production_auth_sessions", "user_id", resolved.credentialUserIds);
  }

  const employeeColumns = tableColumns(db, "hr_employees");
  const assignments = [];
  if (employeeColumns.has("candidate_id")) assignments.push("candidate_id=''");
  if (employeeColumns.has("contract_id")) assignments.push("contract_id=''");
  if (employeeColumns.has("rate_minor")) assignments.push("rate_minor=0");
  if (assignments.length > 0 && resolved.employeeIds.size > 0) {
    const employeeIds = [...resolved.employeeIds];
    db.prepare(
      `UPDATE hr_employees SET ${assignments.join(", ")} WHERE id IN (${placeholders(employeeIds.length)})`,
    ).run(...employeeIds);
  }

  db.exec("DELETE FROM system_runtime_state WHERE state_key <> 'core_schema'");
  db.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('system_data_mode','empty',CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value='empty', updated_at=CURRENT_TIMESTAMP`).run();
  db.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('production_clean_slate',?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value, updated_at=CURRENT_TIMESTAMP`).run(SCRIPT_VERSION);
}

function verifyCleanState(db, dbPath, includeIntegrity = true) {
  if (includeIntegrity) integrityCheck(db);
  const resolved = resolveAllowlist(db);
  const counts = countsByTable(db);

  if (counts.app_users !== EXPECTED_APP_USER_COUNT) {
    throw new Error(`Clean-state invariant failed: app_users must contain exactly ${EXPECTED_APP_USER_COUNT} rows`);
  }
  if (counts.entities !== EXPECTED_EMPLOYEE_COUNT) {
    throw new Error(`Clean-state invariant failed: entities must contain exactly ${EXPECTED_EMPLOYEE_COUNT} rows`);
  }
  if (counts.hr_employees !== EXPECTED_EMPLOYEE_COUNT) {
    throw new Error(`Clean-state invariant failed: hr_employees must contain exactly ${EXPECTED_EMPLOYEE_COUNT} rows`);
  }
  if (counts.production_auth_credentials !== EXPECTED_APP_USER_COUNT) {
    throw new Error(
      `Clean-state invariant failed: production_auth_credentials must contain exactly ${EXPECTED_APP_USER_COUNT} rows`,
    );
  }

  const runtimeRows = db
    .prepare("SELECT state_key, state_value FROM system_runtime_state ORDER BY state_key")
    .all();
  const permittedRuntimeKeys = new Set(["core_schema", "system_data_mode", "production_clean_slate"]);
  const unexpectedRuntimeKeys = runtimeRows.filter((row) => !permittedRuntimeKeys.has(String(row.state_key)));
  if (unexpectedRuntimeKeys.length !== 0) {
    throw new Error(`Clean-state invariant failed: ${unexpectedRuntimeKeys.length} unexpected runtime-state key(s)`);
  }
  const dataMode = runtimeRows.find((row) => row.state_key === "system_data_mode");
  if (!dataMode || dataMode.state_value !== "empty") {
    throw new Error("Clean-state invariant failed: system_data_mode is not empty");
  }

  const tables = applicationTables(db);
  const permittedNonEmpty = new Set([
    ...PRESERVED_CONFIG_TABLES,
    ...FILTERED_IDENTITY_TABLES,
    "system_runtime_state",
  ]);
  const nonEmptyUnexpected = tables.filter((tableName) => !permittedNonEmpty.has(tableName) && counts[tableName] !== 0);
  if (nonEmptyUnexpected.length !== 0) {
    throw new Error(`Clean-state invariant failed: ${nonEmptyUnexpected.length} application table(s) are not empty`);
  }

  const allowedUserIds = resolved.userIds;
  for (const [tableName, columnName] of [
    ["user_system_access", "user_id"],
    ["user_branch_access", "user_id"],
  ]) {
    const rows = db.prepare(`SELECT DISTINCT ${quoteIdentifier(columnName)} AS id FROM ${quoteIdentifier(tableName)}`).all();
    if (rows.some((row) => !allowedUserIds.has(String(row.id)))) {
      throw new Error(`Clean-state invariant failed: ${tableName} references a removed user`);
    }
  }

  const entityRows = db.prepare("SELECT id, display_name FROM entities").all();
  if (entityRows.some((row) => !PEOPLE.some(
    (person) => person.preserveEmployee && normalizeName(person.name) === normalizeName(row.display_name),
  ))) {
    throw new Error("Clean-state invariant failed: entities contains a non-allowlisted person");
  }
  const employeeRows = db.prepare("SELECT id FROM hr_employees").all();
  if (employeeRows.some((row) => !resolved.employeeIds.has(String(row.id)))) {
    throw new Error("Clean-state invariant failed: hr_employees contains a non-allowlisted employee");
  }
  const hrAccessRows = db.prepare("SELECT DISTINCT employee_id AS id FROM hr_accesses").all();
  if (hrAccessRows.some((row) => !resolved.employeeIds.has(String(row.id)))) {
    throw new Error("Clean-state invariant failed: hr_accesses references a removed employee");
  }

  const availableTables = new Set(tables);
  if (availableTables.has("production_auth_credentials")) {
    const rows = db.prepare("SELECT user_id, display_name FROM production_auth_credentials").all();
    if (rows.some((row) => !resolved.credentialUserIds.has(String(row.user_id)))) {
      throw new Error("Clean-state invariant failed: authentication credentials contain a removed user");
    }
  }
  if (availableTables.has("production_auth_sessions")) {
    const rows = db.prepare("SELECT DISTINCT user_id FROM production_auth_sessions").all();
    if (rows.some((row) => !resolved.credentialUserIds.has(String(row.user_id)))) {
      throw new Error("Clean-state invariant failed: authentication sessions contain a removed user");
    }
  }

  const unionOfPeople = new Set([
    ...resolved.users.map((row) => normalizeName(row.displayName)),
    ...resolved.entities.map((row) => normalizeName(row.displayName)),
  ]);
  const expectedUnion = new Set(PEOPLE.map((person) => normalizeName(person.name)));
  if (
    unionOfPeople.size !== expectedUnion.size ||
    [...expectedUnion].some((name) => !unionOfPeople.has(name))
  ) {
    throw new Error("Clean-state invariant failed: app users and employee cards do not form the exact three-person union");
  }

  foreignKeyCheck(db);
  return {
    scriptVersion: SCRIPT_VERSION,
    mode: "verify",
    databaseFile: basename(dbPath),
    integrity: "ok",
    dataMode: "empty",
    allowlist: safeAllowlistSummary(resolved),
    preservedConfig: {
      branches: counts.organization_branches ?? 0,
      systems: counts.app_systems ?? 0,
    },
    retainedRows: Object.fromEntries(
      [...permittedNonEmpty].sort().map((tableName) => [tableName, counts[tableName] ?? 0]),
    ),
    clearedTableCount: tables.filter((tableName) => !permittedNonEmpty.has(tableName)).length,
  };
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

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/gu, "-");
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

async function validateBackup(backupPath, expectedSha256 = null) {
  if (!(await hasSqliteHeader(backupPath))) throw new Error("Backup file is not SQLite");
  const actualSha256 = await sha256File(backupPath);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error("Backup SHA-256 does not match its manifest");
  }
  const db = openDatabase(backupPath, true);
  try {
    integrityCheck(db);
    if (!hasRequiredAppSchema(db)) throw new Error("Backup does not contain the ArtHello application schema");
  } finally {
    db.close();
  }
  return actualSha256;
}

async function createBackup(db, dbPath, rootPath, prefix = "arthello-pre-clean-slate") {
  const backupDirectory = join(rootPath, "backups");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await chmod(backupDirectory, 0o700);
  const timestamp = timestampForFile();
  const backupPath = join(backupDirectory, `${prefix}-${timestamp}.sqlite`);
  await sqliteBackup(db, backupPath);
  await chmod(backupPath, 0o600);
  await syncFile(backupPath);
  const sha256 = await validateBackup(backupPath);

  const manifest = {
    format: "arthello-sqlite-backup-manifest-v1",
    scriptVersion: SCRIPT_VERSION,
    createdAt: new Date().toISOString(),
    sourceDatabaseFile: basename(dbPath),
    backupPath,
    sha256,
    integrity: "ok",
    allowlist: PEOPLE.map((person) => ({
      key: person.key,
      appUserId: person.appUserId,
      authUserId: person.authUserId,
      employeeId: person.employeeId,
      name: person.name,
    })),
  };
  const manifestPath = join(backupDirectory, `${prefix}-${timestamp}.manifest.json`);
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestBody, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(manifestPath, 0o600);
  await syncFile(manifestPath);

  const latestManifestPath = join(backupDirectory, `${prefix}-latest.manifest.json`);
  const latestTemporaryPath = `${latestManifestPath}.tmp-${process.pid}`;
  await writeFile(latestTemporaryPath, manifestBody, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(latestTemporaryPath, 0o600);
  await syncFile(latestTemporaryPath);
  await rename(latestTemporaryPath, latestManifestPath);
  await syncDirectory(backupDirectory);

  return { ...manifest, manifestPath, latestManifestPath };
}

async function loadManifest(rootPath, manifestPath) {
  if (!manifestPath) throw new Error("Rollback requires --manifest");
  const realManifest = await assertExistingPathInside(rootPath, resolve(manifestPath), "Manifest path");
  const manifest = JSON.parse(await readFile(realManifest, "utf8"));
  if (manifest.format !== "arthello-sqlite-backup-manifest-v1") {
    throw new Error("Unsupported backup manifest format");
  }
  if (typeof manifest.backupPath !== "string" || typeof manifest.sha256 !== "string") {
    throw new Error("Backup manifest is incomplete");
  }
  const backupPath = await assertExistingPathInside(rootPath, resolve(manifest.backupPath), "Backup path");
  await validateBackup(backupPath, manifest.sha256);
  return { manifest, manifestPath: realManifest, backupPath };
}

function assertDestructiveAuthorization(actualConfirmation, expectedConfirmation) {
  if (actualConfirmation !== expectedConfirmation) {
    throw new Error(`Exact confirmation phrase required: ${expectedConfirmation}`);
  }
  if (process.env.ARTHELLO_APP_STOPPED !== "1") {
    throw new Error("Destructive command refused: stop the application and set ARTHELLO_APP_STOPPED=1");
  }
}

async function runInventory(rootPath, dbPath) {
  const db = openDatabase(dbPath, true);
  try {
    console.log(JSON.stringify(inspectDatabase(db, dbPath), null, 2));
  } finally {
    db.close();
  }
}

async function runBackup(rootPath, dbPath) {
  const db = openDatabase(dbPath, true);
  try {
    integrityCheck(db);
    resolveAllowlist(db);
    const result = await createBackup(db, dbPath, rootPath);
    console.log(JSON.stringify({
      scriptVersion: SCRIPT_VERSION,
      mode: "backup",
      databaseFile: basename(dbPath),
      integrity: result.integrity,
      backupPath: result.backupPath,
      manifestPath: result.manifestPath,
      sha256: result.sha256,
    }, null, 2));
  } finally {
    db.close();
  }
}

async function runExecute(rootPath, dbPath, confirmation) {
  assertDestructiveAuthorization(confirmation, EXECUTE_CONFIRMATION);
  const db = openDatabase(dbPath, false);
  let transactionOpen = false;
  try {
    integrityCheck(db);
    const resolvedBefore = resolveAllowlist(db);
    const beforeCounts = countsByTable(db);
    const backupResult = await createBackup(db, dbPath, rootPath);

    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const resolvedInsideTransaction = resolveAllowlist(db);
    const beforeIds = [...resolvedBefore.userIds].sort().join("|");
    const transactionIds = [...resolvedInsideTransaction.userIds].sort().join("|");
    if (beforeIds !== transactionIds) throw new Error("Allowlist changed between backup and write transaction");

    applyCleanSlate(db, resolvedInsideTransaction);
    const verifiedInsideTransaction = verifyCleanState(db, dbPath, false);
    db.exec("COMMIT");
    transactionOpen = false;
    db.exec("PRAGMA foreign_keys=ON");

    const verifiedAfterCommit = verifyCleanState(db, dbPath, true);
    const afterCounts = countsByTable(db);
    const deletedRows = Object.fromEntries(
      Object.keys(beforeCounts)
        .sort()
        .map((tableName) => [tableName, Math.max(0, beforeCounts[tableName] - (afterCounts[tableName] ?? 0))])
        .filter(([, count]) => count > 0),
    );

    console.log(JSON.stringify({
      scriptVersion: SCRIPT_VERSION,
      mode: "execute",
      databaseFile: basename(dbPath),
      backupPath: backupResult.backupPath,
      manifestPath: backupResult.manifestPath,
      backupSha256: backupResult.sha256,
      allowlist: verifiedAfterCommit.allowlist,
      deletedRows,
      verification: {
        insideTransaction: verifiedInsideTransaction.integrity,
        afterCommit: verifiedAfterCommit.integrity,
        dataMode: verifiedAfterCommit.dataMode,
      },
    }, null, 2));
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original error; workflow rollback remains available.
      }
    }
    throw error;
  } finally {
    db.close();
  }
}

async function runVerify(dbPath) {
  const db = openDatabase(dbPath, true);
  try {
    console.log(JSON.stringify(verifyCleanState(db, dbPath, true), null, 2));
  } finally {
    db.close();
  }
}

async function moveIfExists(sourcePath, destinationPath) {
  try {
    await stat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  await rename(sourcePath, destinationPath);
  return true;
}

async function runRollback(rootPath, dbPath, confirmation, manifestPath) {
  assertDestructiveAuthorization(confirmation, ROLLBACK_CONFIRMATION);
  const { manifest, backupPath } = await loadManifest(rootPath, manifestPath);

  const currentDb = openDatabase(dbPath, true);
  let safetyBackup;
  try {
    integrityCheck(currentDb);
    safetyBackup = await createBackup(currentDb, dbPath, rootPath, "arthello-pre-rollback");
  } finally {
    currentDb.close();
  }

  const targetDirectory = dirname(dbPath);
  const timestamp = timestampForFile();
  const temporaryPath = join(targetDirectory, `.${basename(dbPath)}.restore-${process.pid}.tmp`);
  const originalPath = join(targetDirectory, `${basename(dbPath)}.pre-rollback-${timestamp}`);
  const staleWalPath = `${dbPath}-wal`;
  const staleShmPath = `${dbPath}-shm`;
  const archivedWalPath = `${originalPath}-wal`;
  const archivedShmPath = `${originalPath}-shm`;

  await copyFile(backupPath, temporaryPath);
  await chmod(temporaryPath, 0o600);
  await syncFile(temporaryPath);

  let originalMoved = false;
  let walMoved = false;
  let shmMoved = false;
  try {
    originalMoved = await moveIfExists(dbPath, originalPath);
    if (!originalMoved) throw new Error("Current application database disappeared before rollback");
    walMoved = await moveIfExists(staleWalPath, archivedWalPath);
    shmMoved = await moveIfExists(staleShmPath, archivedShmPath);
    await rename(temporaryPath, dbPath);
    await syncDirectory(targetDirectory);

    const restoredDb = openDatabase(dbPath, true);
    try {
      integrityCheck(restoredDb);
      if (!hasRequiredAppSchema(restoredDb)) throw new Error("Restored database does not contain the ArtHello schema");
    } finally {
      restoredDb.close();
    }
  } catch (error) {
    const failedRestorePath = `${dbPath}.failed-restore-${timestamp}`;
    await moveIfExists(dbPath, failedRestorePath);
    if (originalMoved) await rename(originalPath, dbPath);
    if (walMoved) await rename(archivedWalPath, staleWalPath);
    if (shmMoved) await rename(archivedShmPath, staleShmPath);
    await syncDirectory(targetDirectory);
    throw error;
  }

  console.log(JSON.stringify({
    scriptVersion: SCRIPT_VERSION,
    mode: "rollback",
    databaseFile: basename(dbPath),
    restoredFrom: backupPath,
    restoredSha256: manifest.sha256,
    previousDatabaseArchivedAt: originalPath,
    safetyBackupPath: safetyBackup.backupPath,
    safetyBackupSha256: safetyBackup.sha256,
    integrity: "ok",
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    console.log(usage());
    return;
  }
  if (!["inventory", "backup", "execute", "verify", "rollback"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}`);
  }

  const rootPath = await realpath(resolve(args.root));
  const dbPath = await findAppDatabase(rootPath, args.db);
  if (args.command === "inventory") return runInventory(rootPath, dbPath);
  if (args.command === "backup") return runBackup(rootPath, dbPath);
  if (args.command === "execute") return runExecute(rootPath, dbPath, args.confirm);
  if (args.command === "verify") return runVerify(dbPath);
  return runRollback(rootPath, dbPath, args.confirm, args.manifest);
}

main().catch((error) => {
  // Errors intentionally avoid serializing database rows or exception objects,
  // which could include personal or authentication data.
  console.error(JSON.stringify({
    scriptVersion: SCRIPT_VERSION,
    status: "failed",
    error: String(error?.message ?? "Unknown error"),
  }));
  process.exitCode = 1;
});
