import { pool } from "@workspace/db";
import { PostgresAuthStore } from "../lib/security/auth-store.js";
import { hashPassword, validatePasswordPolicy } from "../lib/security/password.js";

const login = process.env.AUTH_BOOTSTRAP_OWNER_LOGIN?.trim() ?? "";
const name = process.env.AUTH_BOOTSTRAP_OWNER_NAME?.trim() ?? "";
const password = process.env.AUTH_BOOTSTRAP_OWNER_PASSWORD ?? "";

async function main(): Promise<void> {
  if (login.length < 3 || !name) throw new Error("AUTH_BOOTSTRAP_OWNER_LOGIN and AUTH_BOOTSTRAP_OWNER_NAME are required");
  const policyError = validatePasswordPolicy(password);
  if (policyError) throw new Error(policyError);
  const store = new PostgresAuthStore();
  await store.createUser({
    login,
    loginNormalized: login.toLowerCase(),
    passwordHash: await hashPassword(password),
    role: "owner",
    name,
    scope: { unrestricted: true, branchIds: [], legalEntityIds: [] },
    mustChangePassword: true,
  });
  process.stdout.write("Owner account created. Remove AUTH_BOOTSTRAP_OWNER_PASSWORD from the environment now.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Owner bootstrap failed"}\n`);
  process.exitCode = 1;
}).finally(() => pool.end());
