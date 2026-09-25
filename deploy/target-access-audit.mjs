import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { AtlasOwnerAccessHttpClient } from "./activate-atlas-owner-access.mjs";

const TARGET_DISPLAY_NAME_SHA256 = "4edb1dc0f3a13ed7463b08ecf08dd55d091e94f73aa47c13ed6fce6f5c22f250";
const CENTRAL_SYSTEM_ID = "SYS-ARTHELLO-OS";
const ATLAS_SYSTEM_ID = "SYS-SCHOOL-ATLAS";
const SCHOOL_SYSTEM_ID = "SYS-SCHOOL-1-11";

function fail(code) {
  const error = new Error(code);
  error.name = "TargetAccessAuditError";
  throw error;
}

function normalizedName(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function nameHash(value) {
  return createHash("sha256").update(normalizedName(value), "utf8").digest("hex");
}

function activeGrant(grant) {
  return grant?.status === "Активен";
}

export function summarizeTargetAccess(settings, targetHash = TARGET_DISPLAY_NAME_SHA256) {
  const users = Array.isArray(settings?.users) ? settings.users : [];
  const grants = Array.isArray(settings?.systemGrants) ? settings.systemGrants : [];
  const matches = users.filter((user) => nameHash(user?.displayName) === targetHash);
  const unique = [...new Map(matches.map((user) => [user.id, user])).values()];
  if (unique.length !== 1) fail("TARGET_ACCOUNT_AMBIGUOUS");

  const user = unique[0];
  const userGrants = grants.filter((grant) => grant?.userId === user.id);
  const bySystem = Object.fromEntries(userGrants.map((grant) => [grant.systemId, grant]));
  const allowedModules = Array.isArray(user.allowedModules) ? user.allowedModules : [];
  const accountActive = user.status === "Активен";
  const clientsAssigned = allowedModules.includes("clients");
  const familyRoleEligible = ["Директор", "Администратор", "Продажи"].includes(user.role);
  const studentRoleEligible = ["Директор", "Администратор"].includes(user.role);
  const administrative = user.isAdministrative === true;

  const central = bySystem[CENTRAL_SYSTEM_ID];
  const atlas = bySystem[ATLAS_SYSTEM_ID];
  const school = bySystem[SCHOOL_SYSTEM_ID];

  return {
    schemaVersion: 1,
    accountMatches: unique.length,
    accountActive,
    administrative,
    role: typeof user.role === "string" ? user.role : "",
    clientsAssigned,
    familyCardEdit: accountActive && clientsAssigned && familyRoleEligible,
    studentCardEdit: accountActive && clientsAssigned && studentRoleEligible,
    familyDiaryAccessManagement: accountActive && administrative && clientsAssigned && familyRoleEligible,
    central: {
      active: activeGrant(central),
      role: typeof central?.role === "string" ? central.role : "",
    },
    atlasDiary: {
      active: activeGrant(atlas),
      role: typeof atlas?.role === "string" ? atlas.role : "",
      loginMode: typeof atlas?.lastSyncStatus === "string" ? atlas.lastSyncStatus : "",
    },
    schoolDiary: {
      active: activeGrant(school),
      role: typeof school?.role === "string" ? school.role : "",
      syncStatus: typeof school?.lastSyncStatus === "string" ? school.lastSyncStatus : "",
    },
    productionMutations: false,
  };
}

export async function auditTargetAccess(client) {
  let loggedIn = false;
  let primaryError;
  try {
    const login = await client.login();
    loggedIn = true;
    if (login?.userId !== "USR-OWNER" || login?.isSystemOwner !== true || login?.mustChangePassword !== false) {
      fail("CANONICAL_OWNER_REQUIRED");
    }
    const settings = await client.settings();
    if (settings?.canManage !== true || !Array.isArray(settings?.users) || !Array.isArray(settings?.systemGrants)) {
      fail("SETTINGS_ACCESS_UNCONFIRMED");
    }
    return summarizeTargetAccess(settings);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (loggedIn) {
      try {
        await client.logoutAll();
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
      }
    }
  }
}

async function main() {
  const client = new AtlasOwnerAccessHttpClient(
    process.env.ARTHELLO_OWNER_LOGIN ?? "",
    process.env.ARTHELLO_OWNER_PASSWORD ?? "",
  );
  const result = await auditTargetAccess(client);
  process.stdout.write("TARGET_ACCESS_AUDIT=" + JSON.stringify(result) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "TARGET_ACCESS_AUDIT_FAILED";
    process.stderr.write("TARGET_ACCESS_AUDIT_BLOCKED=" + code + "\n");
    process.exitCode = 2;
  });
}
