import assert from "node:assert/strict";
import test from "node:test";

test("AlphaCRM client imports without tenant env and fails closed before network use", async () => {
  const previousDomain = process.env.ALFACRM_DOMAIN;
  delete process.env.ALFACRM_DOMAIN;

  try {
    const client = await import(
      `../../artifacts/api-server/src/lib/alphaCrmClient.ts?lazy=${Date.now()}`
    );

    assert.equal(client.getBranchCandidates().length > 0, true);
    await assert.rejects(client.authenticate(), /ALFACRM_DOMAIN is required/);
  } finally {
    if (previousDomain === undefined) {
      delete process.env.ALFACRM_DOMAIN;
    } else {
      process.env.ALFACRM_DOMAIN = previousDomain;
    }
  }
});
