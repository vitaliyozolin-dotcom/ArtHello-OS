import assert from "node:assert/strict";
import test from "node:test";

test("AlphaCRM imports without tenant env and rejects missing or blank tenants before network use", async (t) => {
  const previousDomain = process.env.ALFACRM_DOMAIN;
  delete process.env.ALFACRM_DOMAIN;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network use without an explicit tenant");
  });

  try {
    const client = await import(
      `../../artifacts/api-server/src/lib/alphaCrmClient.ts?lazy=${Date.now()}`
    );

    assert.equal(client.getBranchCandidates().length > 0, true);
    assert.equal(fetchMock.mock.callCount(), 0);

    for (const [label, domain] of [
      ["missing", undefined],
      ["empty", ""],
      ["whitespace", " \t\n "],
    ]) {
      await t.test(label, async () => {
        if (domain === undefined) {
          delete process.env.ALFACRM_DOMAIN;
        } else {
          process.env.ALFACRM_DOMAIN = domain;
        }
        assert.throws(() => client.createAlphaCrmConfig(), /ALFACRM_DOMAIN is required/);
        await assert.rejects(client.authenticate(), /ALFACRM_DOMAIN is required/);
        await assert.rejects(client.crmPost("0/branch/index"), /ALFACRM_DOMAIN is required/);
        assert.equal(fetchMock.mock.callCount(), 0);
      });
    }
  } finally {
    if (previousDomain === undefined) {
      delete process.env.ALFACRM_DOMAIN;
    } else {
      process.env.ALFACRM_DOMAIN = previousDomain;
    }
  }
});

test("AlphaCRM config trims the explicit tenant without mutating its input", async () => {
  const { createAlphaCrmConfig } = await import(
    "../../artifacts/api-server/src/lib/alphaCrmClient.ts"
  );
  const env = Object.freeze({
    ALFACRM_DOMAIN: " \tcrm.example.test\n ",
    ALFACRM_EMAIL: "fixture@example.test",
    ALFACRM_API_KEY: "synthetic-test-key",
  });

  assert.deepEqual(createAlphaCrmConfig(env), {
    domain: "crm.example.test",
    email: "fixture@example.test",
    apiKey: "synthetic-test-key",
    baseUrl: "https://crm.example.test/v2api",
  });
  assert.equal(env.ALFACRM_DOMAIN, " \tcrm.example.test\n ");
});
