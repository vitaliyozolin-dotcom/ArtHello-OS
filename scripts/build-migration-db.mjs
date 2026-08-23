import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const snapshotPath = resolve(
  process.argv[2] || ".migration/legacy-d1-export.json",
);
const outputPath = resolve(
  process.argv[3] || "deploy/bootstrap/school-1-11.sqlite",
);
if (!existsSync(snapshotPath)) throw new Error(`Не найден снимок: ${snapshotPath}`);

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
mkdirSync(dirname(outputPath), { recursive: true });
if (existsSync(outputPath)) rmSync(outputPath);
const db = new DatabaseSync(outputPath);
db.exec("PRAGMA foreign_keys = OFF");

const migrationFiles = [
  "0000_motionless_goblin_queen.sql",
  "0001_white_nighthawk.sql",
  "0002_mature_psylocke.sql",
  "0003_daffy_quentin_quire.sql",
  "0004_phone_auth.sql",
];
const statements = migrationFiles
  .map((filename) => readFileSync(join(process.cwd(), "drizzle", filename), "utf8"))
  .join("\n--> statement-breakpoint\n")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
for (const statement of statements) {
  if (/^(CREATE TABLE|ALTER TABLE) /i.test(statement)) db.exec(statement);
}
for (const statement of statements) {
  if (/^CREATE (?:UNIQUE )?INDEX /i.test(statement)) db.exec(statement);
}

db.exec("BEGIN IMMEDIATE");
try {
  let imported = 0;
  for (const [table, rows] of Object.entries(snapshot.tables || {})) {
    for (const row of rows) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      const quoted = columns.map((column) => `"${column.replaceAll('"', '""')}"`);
      const placeholders = columns.map(() => "?").join(", ");
      db.prepare(
        `INSERT OR REPLACE INTO "${table.replaceAll('"', '""')}" (${quoted.join(", ")}) VALUES (${placeholders})`,
      ).run(...columns.map((column) => row[column] ?? null));
      imported += 1;
    }
  }
  db.exec("COMMIT");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("VACUUM");
  console.log(`Перенесено строк: ${imported}. База: ${outputPath}`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
