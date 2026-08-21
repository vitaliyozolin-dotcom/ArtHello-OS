import app from "./app";
import { logger } from "./lib/logger";
import { startBankingPolling } from "./lib/banking/registry.js";
import { runMigrations } from "./lib/migrate.js";
import { assertSecuritySchemaReady } from "./lib/security/security-schema-gate.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await runMigrations();
  await assertSecuritySchemaReady();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startBankingPolling();
  });
}

void startServer().catch((err) => {
  logger.error(
    { err },
    "Server startup aborted because required initialization failed",
  );
  process.exit(1);
});
