import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.DATABASE_PATH || "/data/school-1-11.sqlite";
const backupDir = process.env.BACKUP_DIR || "/backups";
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = `${backupDir}/school-1-11-${stamp}.sqlite`;
if (!target.startsWith(`${backupDir}/`))
  throw new Error("Некорректный каталог резервной копии");
const escaped = target.replace(/'/g, "''");
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA wal_checkpoint(FULL)");
db.exec(`VACUUM INTO '${escaped}'`);
console.log(target);
