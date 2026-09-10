import { pathToFileURL } from "node:url";

const CENTRAL_ORIGIN = "https://arthello-188-225-38-55.sslip.io";
const ATLAS_ORIGIN = "https://atlas-188-225-38-55.sslip.io";
const OWNER_ID = "USR-OWNER";
const ATLAS_SYSTEM_ID = "SYS-SCHOOL-ATLAS";

function fail(code) {
  throw new Error(code);
}

function ownerFromSettings(value) {
  const me = value?.me;
  if (
    value?.canManage !== true ||
    me?.id !== OWNER_ID ||
    me?.role !== "Собственник" ||
    me?.isAdministrative !== true ||
    me?.status !== "Активен" ||
    !Number.isSafeInteger(Number(me?.accessVersion)) ||
    Number(me.accessVersion) < 1 ||
    typeof me.updatedAt !== "string" ||
    !me.updatedAt
  ) fail("CANONICAL_OWNER_REQUIRED");
  return me;
}

function exactAtlasGrant(value, owner) {
  const grants = Array.isArray(value?.systemGrants)
    ? value.systemGrants.filter(
        (grant) => grant?.userId === OWNER_ID && grant?.systemId === ATLAS_SYSTEM_ID,
      )
    : [];
  if (grants.length > 1) fail("ATLAS_OWNER_GRANT_AMBIGUOUS");
  if (!grants.length) return null;
  const grant = grants[0];
  if (
    grant.role !== "director" ||
    grant.status !== "Активен" ||
    Number(grant.accessVersion) !== Number(owner.accessVersion)
  ) fail("ATLAS_OWNER_GRANT_CONFLICT");
  return grant;
}

export async function activateAtlasOwnerAccess(client) {
  let primaryError;
  try {
    const authenticated = await client.login();
    if (
      authenticated?.userId !== OWNER_ID ||
      authenticated?.isSystemOwner !== true ||
      authenticated?.mustChangePassword !== false
    ) fail("CANONICAL_OWNER_REQUIRED");

    let current = await client.settings();
    let owner = ownerFromSettings(current);
    let mutation = "already-active";
    if (!exactAtlasGrant(current, owner)) {
      const response = await client.saveOwnerAtlasAccess({
        action: "saveOwnerDiaryAccess",
        systemId: ATLAS_SYSTEM_ID,
        enabled: true,
        diaryRole: "director",
        expectedAccessVersion: Number(owner.accessVersion),
        expectedUpdatedAt: owner.updatedAt,
      });
      if (
        response?.diaryAccess?.enabled !== true ||
        response?.diaryAccess?.role !== "director"
      ) fail("ATLAS_OWNER_GRANT_NOT_CONFIRMED");
      mutation = "created";
      current = await client.settings();
      owner = ownerFromSettings(current);
      if (!exactAtlasGrant(current, owner)) fail("ATLAS_OWNER_GRANT_NOT_CONFIRMED");
    }

    const sso = await client.verifyAtlasSso(owner);
    if (
      sso?.role !== "director" ||
      sso?.school !== "Школа Атлас" ||
      sso?.redirectChainVerified !== true
    ) fail("ATLAS_SSO_NOT_VERIFIED");
    return {
      status: "accepted",
      mutation,
      ownerGrant: "director",
      atlasSso: "verified",
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await client.logoutAll();
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
}

class HostCookieJar {
  constructor() {
    this.hosts = new Map();
  }

  absorb(url, headers) {
    const host = new URL(url).hostname;
    const values = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];
    const jar = this.hosts.get(host) ?? new Map();
    for (const raw of values) {
      const first = raw.split(";", 1)[0];
      const separator = first.indexOf("=");
      if (separator <= 0) continue;
      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1);
      if (/Max-Age=0/i.test(raw) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    this.hosts.set(host, jar);
  }

  header(url) {
    const jar = this.hosts.get(new URL(url).hostname);
    return jar ? [...jar].map(([name, value]) => `${name}=${value}`).join("; ") : "";
  }

  value(origin, name) {
    return this.hosts.get(new URL(origin).hostname)?.get(name) ?? "";
  }
}

export class AtlasOwnerAccessHttpClient {
  constructor(login, password) {
    if (!login || login.length > 320 || typeof password !== "string" || password.length < 12 || password.length > 512)
      fail("OWNER_CREDENTIALS_INVALID");
    this.loginValue = login;
    this.passwordValue = password;
    this.jar = new HostCookieJar();
    this.csrf = "";
  }

  checkedUrl(input) {
    const url = new URL(input);
    if (
      ![CENTRAL_ORIGIN, ATLAS_ORIGIN].includes(url.origin) ||
      url.username ||
      url.password ||
      url.protocol !== "https:"
    ) fail("REQUEST_TARGET_INVALID");
    return url;
  }

  async request(urlInput, options = {}) {
    const url = this.checkedUrl(urlInput);
    const headers = new Headers(options.headers ?? {});
    const cookie = this.jar.header(url);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(url, {
      ...options,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    this.jar.absorb(url, response.headers);
    return response;
  }

  async json(method, origin, path, body) {
    if (!path.startsWith("/") || path.startsWith("//")) fail("REQUEST_PATH_INVALID");
    const headers = new Headers({ accept: "application/json", origin });
    let data;
    if (body !== undefined) {
      data = JSON.stringify(body);
      headers.set("content-type", "application/json");
      if (this.csrf) headers.set("x-csrf-token", this.csrf);
    }
    const response = await this.request(origin + path, { method, headers, body: data });
    const raw = await response.text();
    if (raw.length > 1024 * 1024) fail("RESPONSE_TOO_LARGE");
    let payload;
    try { payload = JSON.parse(raw); } catch { fail("RESPONSE_INVALID"); }
    if (!response.ok) fail(`HTTP_${response.status}`);
    return payload;
  }

  async login() {
    const result = await this.json("POST", CENTRAL_ORIGIN, "/api/auth/login", {
      login: this.loginValue,
      password: this.passwordValue,
    });
    this.passwordValue = "";
    this.loginValue = "";
    this.csrf = this.jar.value(CENTRAL_ORIGIN, "__Host-arthello_csrf");
    if (!this.csrf) fail("AUTH_CSRF_MISSING");
    return result;
  }

  settings() {
    return this.json("GET", CENTRAL_ORIGIN, "/api/settings");
  }

  saveOwnerAtlasAccess(body) {
    return this.json("POST", CENTRAL_ORIGIN, "/api/settings", body);
  }

  async verifyAtlasSso(owner) {
    let url = new URL("/auth/central/start", ATLAS_ORIGIN);
    const observed = [];
    let finalResponse;
    for (let step = 0; step < 8; step += 1) {
      observed.push(`${url.origin}${url.pathname}`);
      const response = await this.request(url, { method: "GET" });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        finalResponse = response;
        break;
      }
      const location = response.headers.get("location");
      if (!location) fail("ATLAS_SSO_REDIRECT_INVALID");
      url = this.checkedUrl(new URL(location, url));
    }
    const expected = [
      `${ATLAS_ORIGIN}/auth/central/start`,
      `${CENTRAL_ORIGIN}/api/atlas-sso/authorize`,
      `${ATLAS_ORIGIN}/auth/central/callback`,
      `${ATLAS_ORIGIN}/`,
    ];
    if (JSON.stringify(observed) !== JSON.stringify(expected) || finalResponse?.status !== 200)
      fail("ATLAS_SSO_REDIRECT_CHAIN_INVALID");

    const snapshot = await this.json("GET", ATLAS_ORIGIN, "/api/school");
    if (
      snapshot?.school?.name !== "Школа Атлас" ||
      snapshot?.viewer?.role !== "director" ||
      snapshot?.viewer?.displayName !== owner.displayName
    ) fail("ATLAS_SSO_IDENTITY_INVALID");
    return { role: "director", school: "Школа Атлас", redirectChainVerified: true };
  }

  async logoutAll() {
    let failure = false;
    try {
      const response = await this.request(`${ATLAS_ORIGIN}/api/auth/logout`, { method: "GET" });
      if (response.status !== 303) failure = true;
    } catch { failure = true; }
    if (this.csrf) {
      try {
        const response = await this.request(`${CENTRAL_ORIGIN}/api/auth/logout`, {
          method: "POST",
          headers: { origin: CENTRAL_ORIGIN, "x-csrf-token": this.csrf },
        });
        if (!response.ok) failure = true;
      } catch { failure = true; }
    }
    this.csrf = "";
    if (failure) fail("SESSION_CLEANUP_FAILED");
  }
}

async function main() {
  if (process.env.ATLAS_OWNER_ACCESS_APPLY !== "1") fail("APPLY_CONFIRMATION_REQUIRED");
  const client = new AtlasOwnerAccessHttpClient(
    process.env.ARTHELLO_OWNER_LOGIN ?? "",
    process.env.ARTHELLO_OWNER_PASSWORD ?? "",
  );
  const result = await activateAtlasOwnerAccess(client);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "ATLAS_OWNER_ACCESS_FAILED";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
