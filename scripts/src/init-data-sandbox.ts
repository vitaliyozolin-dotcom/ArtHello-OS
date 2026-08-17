import { seedOwnerConfirmedMasterData } from "./arthello-master-data.js";
import {
  openSandboxDatabase,
  sandboxTableCount,
} from "./sandbox-db.js";

const { database, migrationsApplied } = await openSandboxDatabase();
try {
  const seeded = await seedOwnerConfirmedMasterData(database);
  process.stdout.write(
    `${JSON.stringify({
      mode: "isolated_local_postgresql_compatible",
      migrationsApplied,
      tableCount: await sandboxTableCount(database),
      seeded,
      productionConnected: false,
      secretsPersisted: false,
    }, null, 2)}\n`,
  );
} finally {
  await database.close();
}
