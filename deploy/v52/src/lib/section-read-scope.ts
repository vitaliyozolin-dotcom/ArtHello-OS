import { canAccessApi } from "./access-policy.ts";
import type { AccessPolicyContext } from "./access-policy.ts";

export type BranchRow = { id: string; name: string; status: string };
export type SectionReadScope = { branches: readonly BranchRow[]; branchIds: ReadonlySet<string>; allowsBranch: (value: unknown) => boolean };

/** Preserve existing role read models; newly checked reads need separate row proof. */
export function requiresAssignedReadScope(user: AccessPolicyContext, pathname: string) {
  return !canAccessApi({ ...user, allowedModules: undefined }, pathname, "GET");
}

export function assignedActiveBranchScope(
  user: { isAdministrative?: boolean },
  branchRows: readonly BranchRow[],
  grants: readonly { branchId: string }[],
): SectionReadScope {
  const active = branchRows.filter((row) => row.status === "Активен");
  const granted = new Set(grants.map((row) => row.branchId));
  const branches = active.filter((row) => user.isAdministrative || granted.has(row.id));
  const branchIds = new Set(branches.map((row) => row.id));
  const knownBranchIds = new Set(branchRows.map((row) => row.id));
  return {
    branches,
    branchIds,
    allowsBranch(value) {
      if (typeof value !== "string" || !value.trim()) return false;
      const reference = value.trim();
      if (knownBranchIds.has(reference)) return branchIds.has(reference);
      // Names are accepted only when they identify one active catalogue entry.
      const matches = active.filter((row) => row.name === reference);
      return matches.length === 1 && branchIds.has(matches[0].id);
    },
  };
}
