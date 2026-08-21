import {
  bankConnectorsTable,
  db,
  pool,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  isBankConfigEnvelope,
  sealBankConnectorConfig,
} from "../lib/banking/config-vault.js";

const CONFIRM_ENV = "BANK_CONFIG_MIGRATION_CONFIRM";
const BACKUP_ENV = "BANK_CONFIG_MIGRATION_BACKUP_ID";

async function main(): Promise<void> {
  if (process.env[CONFIRM_ENV] !== "ENCRYPT_EXISTING_CONFIGS") {
    throw new Error(
      `${CONFIRM_ENV}=ENCRYPT_EXISTING_CONFIGS is required`,
    );
  }
  if (!process.env[BACKUP_ENV]?.trim()) {
    throw new Error(
      `${BACKUP_ENV} must identify a verified backup or snapshot`,
    );
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(bankConnectorsTable);
    let encrypted = 0;
    let empty = 0;
    let alreadyEncrypted = 0;

    for (const row of rows) {
      if (isBankConfigEnvelope(row.config)) {
        alreadyEncrypted += 1;
        continue;
      }
      const config =
        row.config &&
        typeof row.config === "object" &&
        !Array.isArray(row.config)
          ? (row.config as Record<string, unknown>)
          : {};
      if (Object.keys(config).length === 0) {
        empty += 1;
        continue;
      }

      await tx
        .update(bankConnectorsTable)
        .set({
          config: sealBankConnectorConfig(row.id, config),
          updatedAt: new Date(),
        })
        .where(eq(bankConnectorsTable.id, row.id));
      encrypted += 1;
    }

    return {
      total: rows.length,
      encrypted,
      empty,
      alreadyEncrypted,
    };
  });

  console.log(
    JSON.stringify({
      status: "ok",
      backupId: process.env[BACKUP_ENV],
      ...result,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Bank config migration failed",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
