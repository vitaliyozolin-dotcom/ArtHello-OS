import { createHash } from "node:crypto";
import type { AuthRole, BusinessScope } from "./access-policy.js";

export const PEOPLE_ACCESS_ACTIONS = ["PROVISION", "UPDATE", "OFFBOARD"] as const;
export type PeopleAccessAction = (typeof PEOPLE_ACCESS_ACTIONS)[number];
export const PEOPLE_ACCESS_ASSIGNABLE_ROLES = ["accountant", "viewer"] as const;
export type PeopleAccessAssignableRole = (typeof PEOPLE_ACCESS_ASSIGNABLE_ROLES)[number];

export interface EmployeeAccessRecord {
  id: string;
  fullName: string;
  status: string | null;
  employeeKind: string | null;
  employeeType: string | null;
  classificationStatus: string | null;
  branchCrmId: string | null;
  isTestData: boolean;
}

export interface ExistingEmployeeAccess {
  id: string;
  employeeId: string | null;
  login: string;
  role: AuthRole;
  active: boolean;
  scope: BusinessScope;
}

export interface PeopleAccessPlanInput {
  action: PeopleAccessAction;
  login?: string;
  displayName?: string;
  role?: PeopleAccessAssignableRole;
  branchIds?: readonly string[];
  legalEntityIds?: readonly string[];
}

export interface PeopleAccessPlan {
  schemaVersion: 1;
  action: PeopleAccessAction;
  employeeId: string;
  employeeName: string;
  existingAccessId: string | null;
  ready: boolean;
  blockers: string[];
  target: {
    login: string | null;
    loginNormalized: string | null;
    displayName: string;
    role: PeopleAccessAssignableRole | null;
    scope: BusinessScope;
    active: boolean;
  };
  effects: string[];
  forbiddenEffects: string[];
  approvalRequired: true;
  planHash: string;
}

function normalizeIds(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= 128))].sort();
}

export function normalizeAccessLogin(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function personnelBlockers(employee: EmployeeAccessRecord): string[] {
  const blockers: string[] = [];
  if (employee.isTestData) blockers.push("TEST_EMPLOYEE_PROHIBITED");
  if ((employee.status ?? "").toLowerCase() !== "active") blockers.push("EMPLOYEE_NOT_ACTIVE");
  if ((employee.classificationStatus ?? "").toLowerCase() !== "classified") blockers.push("EMPLOYEE_CLASSIFICATION_REQUIRED");
  const kind = (employee.employeeKind ?? "").toLowerCase();
  if (["former_employee", "technical_record", "direction_record", "synthetic_shared_teacher"].includes(kind)) {
    blockers.push("EMPLOYEE_KIND_NOT_ELIGIBLE");
  }
  return blockers;
}

function stablePlanHash(value: Omit<PeopleAccessPlan, "planHash">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildPeopleAccessPlan(
  employee: EmployeeAccessRecord,
  existing: ExistingEmployeeAccess | null,
  input: PeopleAccessPlanInput,
): PeopleAccessPlan {
  const action = input.action;
  const blockers: string[] = [];
  const branchIds = normalizeIds(input.branchIds);
  const legalEntityIds = normalizeIds(input.legalEntityIds);
  const loginNormalized = normalizeAccessLogin(input.login);
  const displayName = (input.displayName ?? employee.fullName).trim() || employee.fullName;
  const role = input.role ?? null;

  if (action === "PROVISION") {
    blockers.push(...personnelBlockers(employee));
    if (existing) blockers.push("ACCESS_ALREADY_LINKED");
  } else {
    if (!existing) blockers.push("LINKED_ACCESS_NOT_FOUND");
    if (existing?.role === "owner") blockers.push("OWNER_ACCESS_IMMUTABLE");
    if (action === "UPDATE") blockers.push(...personnelBlockers(employee));
  }

  if (action !== "OFFBOARD") {
    if (loginNormalized.length < 3 || loginNormalized.length > 80) blockers.push("LOGIN_REQUIRED");
    if (!role || !PEOPLE_ACCESS_ASSIGNABLE_ROLES.includes(role)) blockers.push("ROLE_NOT_ASSIGNABLE");
    if (branchIds.length === 0) blockers.push("BRANCH_SCOPE_REQUIRED");
    if (legalEntityIds.length === 0) blockers.push("LEGAL_ENTITY_SCOPE_REQUIRED");
  }

  const targetScope: BusinessScope = action === "OFFBOARD"
    ? existing?.scope ?? { unrestricted: false, branchIds: [], legalEntityIds: [] }
    : { unrestricted: false, branchIds, legalEntityIds };

  const withoutHash: Omit<PeopleAccessPlan, "planHash"> = {
    schemaVersion: 1,
    action,
    employeeId: employee.id,
    employeeName: employee.fullName,
    existingAccessId: existing?.id ?? null,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    target: {
      login: action === "OFFBOARD" ? existing?.login ?? null : input.login?.trim() || null,
      loginNormalized: action === "OFFBOARD" ? existing?.login.toLowerCase() ?? null : loginNormalized || null,
      displayName,
      role: action === "OFFBOARD" ? (existing?.role === "accountant" || existing?.role === "viewer" ? existing.role : null) : role,
      scope: targetScope,
      active: action !== "OFFBOARD",
    },
    effects: action === "PROVISION"
      ? ["CREATE_PERSONAL_ACCESS", "FORCE_TEMPORARY_PASSWORD_CHANGE", "LINK_ACCESS_TO_EMPLOYEE"]
      : action === "UPDATE"
        ? ["UPDATE_ROLE_AND_SCOPE", "REVOKE_EXISTING_SESSIONS"]
        : ["DEACTIVATE_ACCESS", "REVOKE_EXISTING_SESSIONS"],
    forbiddenEffects: [
      "SEND_INVITATION_AUTOMATICALLY",
      "ASSIGN_OWNER_ROLE",
      "BYPASS_OWNER_CONFIRMATION",
      "RETURN_OR_LOG_PASSWORD",
      "DELETE_EMPLOYEE_OR_ACCESS_HISTORY",
    ],
    approvalRequired: true,
  };
  return { ...withoutHash, planHash: stablePlanHash(withoutHash) };
}

export function summarizePersonnelReadiness(employee: EmployeeAccessRecord, existing: ExistingEmployeeAccess | null) {
  const blockers = personnelBlockers(employee);
  return {
    employeeId: employee.id,
    employeeName: employee.fullName,
    employeeType: employee.employeeType,
    branchCrmId: employee.branchCrmId,
    accessId: existing?.id ?? null,
    accessRole: existing?.role ?? null,
    accessActive: existing?.active ?? false,
    status: blockers.length > 0
      ? "BLOCKED_PERSONNEL_DATA"
      : existing?.active
        ? "ACCESS_ACTIVE"
        : existing
          ? "ACCESS_INACTIVE"
          : "READY_FOR_PROVISIONING_INPUT",
    blockers,
  };
}
