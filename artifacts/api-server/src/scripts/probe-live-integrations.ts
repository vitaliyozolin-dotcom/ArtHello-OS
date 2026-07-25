import { SerializedRequestQueue } from "../lib/serialized-request-queue.js";

type JsonObject = Record<string, unknown>;

const alphaQueue = new SerializedRequestQueue({ minIntervalMs: 300 });
const entityNames = [
  "customer",
  "group",
  "teacher",
  "subject",
  "pay",
  "lesson",
] as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{
  status: number;
  json: unknown;
}> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // The probe reports only status/shape; upstream text is never returned.
  }
  return { status: response.status, json };
}

function listItems(json: unknown): JsonObject[] {
  if (Array.isArray(json)) {
    return json.filter(
      (item): item is JsonObject =>
        !!item && typeof item === "object" && !Array.isArray(item),
    );
  }
  const object = asObject(json);
  if (!object) return [];
  for (const key of ["items", "data", "result", "records"]) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is JsonObject =>
          !!item && typeof item === "object" && !Array.isArray(item),
      );
    }
  }
  return [];
}

function numericMeta(json: unknown): {
  total: number | null;
  count: number | null;
} {
  const object = asObject(json);
  return {
    total: typeof object?.["total"] === "number"
      ? object["total"]
      : null,
    count: typeof object?.["count"] === "number"
      ? object["count"]
      : null,
  };
}

async function probeAlfaCrm(): Promise<JsonObject> {
  const domain = process.env.ALFACRM_DOMAIN?.trim();
  const email = process.env.ALFACRM_EMAIL?.trim();
  const apiKey = process.env.ALFACRM_API_KEY?.trim();
  if (!domain || !email || !apiKey) {
    return { configured: false, authOk: false };
  }

  const timeoutMs = positiveInteger(
    process.env.PROBE_REQUEST_TIMEOUT_MS,
    12_000,
  );
  const baseUrl = `https://${domain}/v2api`;
  let auth: Awaited<ReturnType<typeof fetchJson>>;
  try {
    auth = await alphaQueue.run(() =>
      fetchJson(
        `${baseUrl}/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, api_key: apiKey }),
        },
        timeoutMs,
      )
    );
  } catch {
    return {
      configured: true,
      authOk: false,
      status: "network_unavailable",
    };
  }
  const token = asObject(auth.json)?.["token"];
  if (auth.status !== 200 || typeof token !== "string" || !token) {
    return {
      configured: true,
      authOk: false,
      httpStatus: auth.status,
    };
  }

  let branchesResponse: Awaited<ReturnType<typeof fetchJson>>;
  try {
    branchesResponse = await alphaQueue.run(() =>
      fetchJson(
        `${baseUrl}/0/branch/index`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-ALFACRM-TOKEN": token,
          },
          body: JSON.stringify({ page: 0, count: 100 }),
        },
        timeoutMs,
      )
    );
  } catch {
    return {
      configured: true,
      authOk: true,
      status: "branch_inventory_network_unavailable",
    };
  }

  const branchIds = listItems(branchesResponse.json)
    .map((item) => item["id"])
    .filter(
      (id): id is string | number =>
        typeof id === "string" || typeof id === "number",
    );
  const maxBranches = positiveInteger(
    process.env.PROBE_MAX_BRANCHES,
    branchIds.length || 1,
  );
  const selectedBranchIds = branchIds.slice(0, maxBranches);
  const coverage: Record<string, JsonObject> = {};
  let consecutiveNetworkFailures = 0;
  let circuitOpen = false;

  for (const [branchIndex, branchId] of selectedBranchIds.entries()) {
    const branchCoverage: Record<string, unknown> = {};
    for (const entityName of entityNames) {
      if (consecutiveNetworkFailures >= 2) {
        circuitOpen = true;
        break;
      }
      try {
        const result = await alphaQueue.run(() =>
          fetchJson(
            `${baseUrl}/${branchId}/${entityName}/index`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-ALFACRM-TOKEN": token,
              },
              body: JSON.stringify({ page: 0, count: 1 }),
            },
            timeoutMs,
          )
        );
        consecutiveNetworkFailures = 0;
        branchCoverage[entityName] = {
          httpStatus: result.status,
          ...numericMeta(result.json),
          sampleReceived: listItems(result.json).length > 0,
        };
      } catch {
        consecutiveNetworkFailures += 1;
        branchCoverage[entityName] = {
          status: "network_unavailable",
        };
      }
    }
    coverage[`branch_${branchIndex + 1}`] = branchCoverage;
    if (circuitOpen) break;
  }

  return {
    configured: true,
    authOk: true,
    branchCount: branchIds.length,
    branchInventoryHttpStatus: branchesResponse.status,
    checkedBranchCount: Object.keys(coverage).length,
    circuitOpen,
    coverage,
  };
}

async function probeTochka(): Promise<JsonObject> {
  const clientId = process.env.PROBE_TOCHKA_CLIENT_ID?.trim();
  const clientSecret = process.env.PROBE_TOCHKA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { configured: false, serviceTokenOk: false };
  }
  const timeoutMs = positiveInteger(
    process.env.PROBE_REQUEST_TIMEOUT_MS,
    12_000,
  );
  try {
    const tokenResult = await fetchJson(
      "https://enter.tochka.com/connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: "accounts balances customers statements",
        }),
      },
      timeoutMs,
    );
    const tokenObject = asObject(tokenResult.json);
    const serviceToken = tokenObject?.["access_token"];
    const serviceTokenOk =
      tokenResult.status === 200 &&
      typeof serviceToken === "string" &&
      !!serviceToken;
    if (!serviceTokenOk) {
      return {
        configured: true,
        serviceTokenOk: false,
        tokenHttpStatus: tokenResult.status,
      };
    }

    const accounts = await fetchJson(
      "https://enter.tochka.com/uapi/open-banking/v1.0/accounts",
      {
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
    return {
      configured: true,
      serviceTokenOk: true,
      tokenHttpStatus: tokenResult.status,
      accountsHttpStatus: accounts.status,
      hybridAuthorizationRequired:
        accounts.status === 401 || accounts.status === 403,
      consentCreated: false,
      paymentActionAttempted: false,
    };
  } catch {
    return {
      configured: true,
      serviceTokenOk: false,
      status: "network_unavailable",
    };
  }
}

const result = {
  mode: "live_read_only",
  checkedAt: new Date().toISOString(),
  secretsPersisted: false,
  personalDataReturned: false,
  alfaCrm: await probeAlfaCrm(),
  tochka: await probeTochka(),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(0);
