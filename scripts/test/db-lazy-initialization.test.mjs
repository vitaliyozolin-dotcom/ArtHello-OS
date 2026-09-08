import assert from "node:assert/strict";
import test from "node:test";

test("database module imports without DATABASE_URL and fails closed on first use", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const database = await import(
      `../../lib/db/src/index.ts?lazy=${Date.now()}`
    );

    assert.throws(
      () => database.createDb(process.env),
      /DATABASE_URL must be set/,
    );
    assert.throws(() => database.pool.connect(), /DATABASE_URL must be set/);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});
