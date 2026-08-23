import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(process.argv[index], process.argv[index + 1]);
const phoneInput = args.get("--phone") || "";
const displayName = args.get("--name") || "Виталий Озолин";
const origin = (
  args.get("--origin") ||
  process.env.PUBLIC_APP_ORIGIN ||
  "https://school-188-225-47-207.sslip.io"
).replace(/\/$/, "");
let digits = phoneInput.replace(/\D/g, "");
if (digits.length === 11 && digits.startsWith("8"))
  digits = `7${digits.slice(1)}`;
if (digits.length === 10) digits = `7${digits}`;
if (digits.length < 8 || digits.length > 15)
  throw new Error("Передайте корректный телефон через --phone");
const phone = `+${digits}`;
const databasePath = process.env.DATABASE_PATH || "/data/school-1-11.sqlite";
const db = new DatabaseSync(databasePath);
const existing =
  db.prepare("SELECT id FROM users WHERE phone = ?").get(phone) ||
  db
    .prepare(
      "SELECT id FROM users WHERE role = 'director' AND status = 'active' AND phone IS NULL ORDER BY created_at LIMIT 1",
    )
    .get();
const userId = existing?.id || `user-${crypto.randomUUID()}`;
const email = `phone_${digits}@school.local`;
if (existing) {
  db.prepare(
    "UPDATE users SET phone = ?, display_name = ?, role = 'director', status = 'active', password_hash = NULL, password_state = 'reset_required', auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(phone, displayName, userId);
} else {
  db.prepare(
    "INSERT INTO users (id, email, phone, display_name, role, status, password_state) VALUES (?, ?, ?, ?, 'director', 'active', 'pending')",
  ).run(userId, email, phone, displayName);
}
db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
db.prepare(
  "UPDATE credential_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL",
).run(userId);
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
db.prepare(
  "INSERT INTO credential_tokens (id, user_id, token_hash, purpose, created_by_user_id, expires_at) VALUES (?, ?, ?, 'activate', ?, ?)",
).run(
  `credential-${crypto.randomUUID()}`,
  userId,
  tokenHash,
  userId,
  expiresAt,
);
console.log(`${origin}/activate?token=${encodeURIComponent(token)}`);
