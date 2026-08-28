#!/usr/bin/env node

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.env.VISUAL_DATA_ROOT ?? "/data";
const password = process.env.VISUAL_TEMP_PASSWORD ?? "";
const systemId = "SYS-ARTHELLO-OS";
const ownerId = "USR-OWNER";
const authOwnerId = "AUTH-OWNER";

if (password.length < 12 || password.length > 256) {
  throw new Error("VISUAL_TEMP_PASSWORD must contain between 12 and 256 characters");
}

async function hasSqliteHeader(filePath) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.toString("utf8") === "SQLite format 3\0";
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function filesBelow(directory, depth = 0) {
  if (depth > 12) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(absolute, depth + 1));
    if (entry.isFile() && !/(?:-wal|-shm|-journal)$/u.test(entry.name)) result.push(absolute);
  }
  return result;
}

function tableNames(database) {
  return new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)));
}

async function findDatabase() {
  const realRoot = await realpath(root);
  const matches = [];
  for (const filePath of await filesBelow(realRoot)) {
    if (!(await hasSqliteHeader(filePath))) continue;
    let database;
    try {
      database = new DatabaseSync(filePath, { open: true, readOnly: true, enableForeignKeyConstraints: false });
      const tables = tableNames(database);
      if (["system_runtime_state", "app_users", "app_systems", "user_system_access"].every((name) => tables.has(name))) {
        matches.push(await realpath(filePath));
      }
    } catch {
      // Ignore Miniflare metadata databases and unrelated SQLite files.
    } finally {
      database?.close();
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one ArtHello database; found ${matches.length}`);
  return matches[0];
}

const databasePath = await findDatabase();
const database = new DatabaseSync(databasePath, { open: true, readOnly: false, enableForeignKeyConstraints: false });
database.exec("PRAGMA busy_timeout=5000");

try {
  const salt = randomBytes(16).toString("base64url");
  const passwordHash = pbkdf2Sync(password, salt, 310_000, 32, "sha256").toString("base64url");
  const now = Math.floor(Date.now() / 1000);

  database.exec(`
    CREATE TABLE IF NOT EXISTS production_auth_credentials (
      user_id TEXT PRIMARY KEY NOT NULL,
      login TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      temporary_password_expires_at INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_auth_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      access_version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    BEGIN IMMEDIATE;
  `);

  database.prepare(`INSERT INTO app_systems
    (id,system_key,name,description,status,sort_order,created_at,updated_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      system_key=excluded.system_key,name=excluded.name,description=excluded.description,
      status=excluded.status,sort_order=excluded.sort_order,updated_at=CURRENT_TIMESTAMP`)
    .run(systemId, "arthello-os", "ArtHello OS", "Изолированный визуальный контур", "Активна", 1);

  database.prepare(`INSERT INTO app_users
    (id,contact_type,contact,display_name,role,is_administrative,status,invitation_status,
      access_version,invited_by,invited_at,activated_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      contact_type=excluded.contact_type,contact=excluded.contact,display_name=excluded.display_name,
      role=excluded.role,is_administrative=excluded.is_administrative,status=excluded.status,
      invitation_status=excluded.invitation_status,access_version=excluded.access_version,
      invited_by=excluded.invited_by,activated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
    .run(ownerId, "email", "owner@visual.invalid", "Владелец", "Собственник", 1, "Активен", "Активирован", 1, "visual-acceptance");

  database.prepare("DELETE FROM user_system_access WHERE user_id=? AND system_id=?").run(ownerId, systemId);
  database.prepare(`INSERT INTO user_system_access
    (user_id,system_id,role,status,access_version,last_sync_status,last_synced_at,granted_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(ownerId, systemId, "Собственник", "Активен", 1, "Не требуется", "", "visual-acceptance");

  database.prepare("DELETE FROM production_auth_sessions").run();
  database.prepare("DELETE FROM production_auth_credentials").run();
  database.prepare(`INSERT INTO production_auth_credentials
    (user_id,login,display_name,role,password_salt,password_hash,must_change_password,
      temporary_password_expires_at,failed_attempts,locked_until,updated_at)
    VALUES (?,?,?,?,?,?,1,0,0,0,?)`)
    .run(authOwnerId, "owner", "Владелец", "owner", salt, passwordHash, now);

  database.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES ('system_data_mode','empty',CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value='empty',updated_at=CURRENT_TIMESTAMP`).run();

  database.exec("COMMIT");
  const integrity = database.prepare("PRAGMA integrity_check").all().map((row) => String(Object.values(row)[0]));
  if (integrity.length !== 1 || integrity[0].toLowerCase() !== "ok") throw new Error("Fixture database integrity check failed");
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  console.log("ARTHELLO_VISUAL_FIXTURE=READY mode=empty identities=1");
} catch (error) {
  try { database.exec("ROLLBACK"); } catch {}
  throw error;
} finally {
  database.close();
}
