import { Router, type Response } from "express";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { logger } from "../lib/logger.js";
import {
  hashPassword,
  validatePasswordPolicy,
} from "../lib/security/password.js";
import {
  buildPeopleAccessPlan,
  normalizeAccessLogin,
  summarizePersonnelReadiness,
  type EmployeeAccessRecord,
  type ExistingEmployeeAccess,
  type PeopleAccessPlanInput,
} from "../lib/security/people-access-policy.js";
import type { AuthRole, BusinessScope } from "../lib/security/access-policy.js";

export const peopleAccessRouter = Router();
const APPLY_CONFIRMATION = "OWNER_APPROVED_APPLY";

type OwnerAuth = {
  tokenHash: string;
  session: { userId: string; role: AuthRole };
};

interface EmployeeRow {
  id: string;
  full_name: string;
  status: string | null;
  employee_kind: string | null;
  employee_type: string | null;
  classification_status: string | null;
  branch_crm_id: string | null;
  is_test_data: boolean | null;
}
interface AccessRow {
  id: string;
  employee_id: string | null;
  login: string;
  role: AuthRole;
  scope_mode: string;
  branch_ids: unknown;
  legal_entity_ids: unknown;
  is_active: boolean;
}
interface ReadinessRow extends EmployeeRow {
  access_id: string | null;
  employee_id: string | null;
  login: string | null;
  role: AuthRole | null;
  scope_mode: string | null;
  branch_ids: unknown;
  legal_entity_ids: unknown;
  is_active: boolean | null;
}

function ownerAuth(res: Response): OwnerAuth | null {
  const auth = res.locals.auth as OwnerAuth | undefined;
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (auth.session.role !== "owner") {
    res.status(403).json({ error: "Недостаточно прав" });
    return null;
  }
  return auth;
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string =>
              typeof item === "string" && item.length > 0 && item.length <= 128,
          ),
        ),
      ]
    : [];
}
function employeeFromRow(row: EmployeeRow): EmployeeAccessRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    status: row.status,
    employeeKind: row.employee_kind,
    employeeType: row.employee_type,
    classificationStatus: row.classification_status,
    branchCrmId: row.branch_crm_id,
    isTestData: row.is_test_data === true,
  };
}
function accessFromRow(
  row: AccessRow | undefined,
): ExistingEmployeeAccess | null {
  if (!row) return null;
  const scope: BusinessScope = {
    unrestricted: row.scope_mode === "unrestricted",
    branchIds: stringIds(row.branch_ids),
    legalEntityIds: stringIds(row.legal_entity_ids),
  };
  return {
    id: row.id,
    employeeId: row.employee_id,
    login: row.login,
    role: row.role,
    active: row.is_active,
    scope,
  };
}

const planInputSchema = z.object({
  employeeId: z.string().uuid(),
  action: z.enum(["PROVISION", "UPDATE", "OFFBOARD"]),
  login: z.string().trim().min(3).max(80).optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["accountant", "viewer"]).optional(),
  branchIds: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  legalEntityIds: z
    .array(z.string().trim().min(1).max(128))
    .max(100)
    .optional(),
});
const applyInputSchema = planInputSchema.extend({
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmation: z.literal(APPLY_CONFIRMATION),
  temporaryPassword: z.string().min(1).max(1024).optional(),
});

async function loadPlanRecords(employeeId: string) {
  const employeeResult = await pool.query<EmployeeRow>(
    `SELECT id, full_name, status, employee_kind, employee_type,
            classification_status, branch_crm_id, is_test_data
       FROM employees WHERE id=$1`,
    [employeeId],
  );
  const employeeRow = employeeResult.rows[0];
  if (!employeeRow) return null;
  const accessResult = await pool.query<AccessRow>(
    `SELECT id, employee_id, login, role, scope_mode, branch_ids,
            legal_entity_ids, is_active
       FROM auth_users WHERE employee_id=$1`,
    [employeeId],
  );
  return {
    employee: employeeFromRow(employeeRow),
    access: accessFromRow(accessResult.rows[0]),
  };
}

peopleAccessRouter.get("/people-access/readiness", async (req, res) => {
  if (!ownerAuth(res)) return;
  const parsed = z
    .object({ limit: z.coerce.number().int().min(1).max(200).default(100) })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректный запрос" });
    return;
  }
  try {
    const result = await pool.query<ReadinessRow>(
      `SELECT e.id, e.full_name, e.status, e.employee_kind, e.employee_type,
              e.classification_status, e.branch_crm_id, e.is_test_data,
              a.id AS access_id, a.employee_id, a.login, a.role, a.scope_mode,
              a.branch_ids, a.legal_entity_ids, a.is_active
         FROM employees e
         LEFT JOIN auth_users a ON a.employee_id=e.id
        WHERE e.is_test_data IS NOT TRUE
        ORDER BY (e.status='active') DESC, e.full_name
        LIMIT $1`,
      [parsed.data.limit],
    );
    const employees = result.rows.map((row) => {
      const access = row.access_id
        ? accessFromRow({
            id: row.access_id,
            employee_id: row.employee_id,
            login: row.login ?? "",
            role: row.role as AuthRole,
            scope_mode: row.scope_mode ?? "restricted",
            branch_ids: row.branch_ids,
            legal_entity_ids: row.legal_entity_ids,
            is_active: row.is_active === true,
          })
        : null;
      return summarizePersonnelReadiness(employeeFromRow(row), access);
    });
    res.json({
      meta: {
        sourceOfTruth: "employees + auth_users",
        applyRequiresOwnerConfirmation: true,
        invitationSendEnabled: false,
      },
      summary: {
        employeesChecked: employees.length,
        activeAccess: employees.filter(
          (item) => item.status === "ACCESS_ACTIVE",
        ).length,
        readyForProvisioningInput: employees.filter(
          (item) => item.status === "READY_FOR_PROVISIONING_INPUT",
        ).length,
        blocked: employees.filter(
          (item) => item.status === "BLOCKED_PERSONNEL_DATA",
        ).length,
      },
      employees,
    });
  } catch (err) {
    logger.error({ err }, "People access readiness failed");
    res.status(503).json({ error: "Контур доступов временно недоступен" });
  }
});

peopleAccessRouter.post("/people-access/plan", async (req, res) => {
  if (!ownerAuth(res)) return;
  const parsed = planInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректный запрос" });
    return;
  }
  try {
    const records = await loadPlanRecords(parsed.data.employeeId);
    if (!records) {
      res.status(404).json({ error: "Сотрудник не найден" });
      return;
    }
    const { employeeId: _employeeId, ...input } = parsed.data;
    const plan = buildPeopleAccessPlan(
      records.employee,
      records.access,
      input as PeopleAccessPlanInput,
    );
    res.json(plan);
  } catch (err) {
    logger.error({ err }, "People access plan failed");
    res.status(503).json({ error: "Не удалось построить план доступа" });
  }
});

peopleAccessRouter.post("/people-access/apply", async (req, res) => {
  const auth = ownerAuth(res);
  if (!auth) return;
  const parsed = applyInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректный запрос" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employeeResult = await client.query<EmployeeRow>(
      `SELECT id, full_name, status, employee_kind, employee_type,
              classification_status, branch_crm_id, is_test_data
         FROM employees WHERE id=$1 FOR UPDATE`,
      [parsed.data.employeeId],
    );
    const employeeRow = employeeResult.rows[0];
    if (!employeeRow) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Сотрудник не найден" });
      return;
    }
    const accessResult = await client.query<AccessRow>(
      `SELECT id, employee_id, login, role, scope_mode, branch_ids,
              legal_entity_ids, is_active
         FROM auth_users WHERE employee_id=$1 FOR UPDATE`,
      [parsed.data.employeeId],
    );
    const existing = accessFromRow(accessResult.rows[0]);
    const {
      employeeId: _employeeId,
      planHash: _planHash,
      confirmation: _confirmation,
      temporaryPassword,
      ...planInput
    } = parsed.data;
    const employee = employeeFromRow(employeeRow);
    const plan = buildPeopleAccessPlan(
      employee,
      existing,
      planInput as PeopleAccessPlanInput,
    );
    if (!plan.ready) {
      await client.query("ROLLBACK");
      res
        .status(409)
        .json({ error: "План доступа заблокирован", blockers: plan.blockers });
      return;
    }
    if (plan.planHash !== parsed.data.planHash) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "План изменился. Постройте его заново.",
        code: "PLAN_HASH_MISMATCH",
      });
      return;
    }

    let accessId: string;
    if (plan.action === "PROVISION") {
      if (!temporaryPassword) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Нужен временный пароль" });
        return;
      }
      const passwordError = validatePasswordPolicy(temporaryPassword);
      if (passwordError) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: passwordError });
        return;
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO auth_users (
           employee_id, login, login_normalized, password_hash, role,
           display_name, scope_mode, branch_ids, legal_entity_ids,
           is_active, must_change_password, password_changed_at,
           created_by_user_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'restricted',$7::jsonb,$8::jsonb,
                   TRUE,TRUE,NOW(),$9,NOW(),NOW()) RETURNING id`,
        [
          employee.id,
          plan.target.login,
          normalizeAccessLogin(plan.target.login ?? undefined),
          await hashPassword(temporaryPassword),
          plan.target.role,
          plan.target.displayName,
          JSON.stringify(plan.target.scope.branchIds),
          JSON.stringify(plan.target.scope.legalEntityIds),
          auth.session.userId,
        ],
      );
      accessId = inserted.rows[0]!.id;
    } else if (plan.action === "UPDATE") {
      accessId = existing!.id;
      await client.query(
        `UPDATE auth_users SET login=$2, login_normalized=$3, role=$4,
           display_name=$5, scope_mode='restricted', branch_ids=$6::jsonb,
           legal_entity_ids=$7::jsonb, is_active=TRUE, updated_at=NOW()
         WHERE id=$1`,
        [
          accessId,
          plan.target.login,
          normalizeAccessLogin(plan.target.login ?? undefined),
          plan.target.role,
          plan.target.displayName,
          JSON.stringify(plan.target.scope.branchIds),
          JSON.stringify(plan.target.scope.legalEntityIds),
        ],
      );
      await client.query(
        `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`,
        [accessId],
      );
    } else {
      accessId = existing!.id;
      await client.query(
        `UPDATE auth_users SET is_active=FALSE, updated_at=NOW() WHERE id=$1`,
        [accessId],
      );
      await client.query(
        `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`,
        [accessId],
      );
    }

    await client.query(
      `INSERT INTO people_access_audit (
         employee_id, auth_user_id, action, plan_hash, outcome,
         requested_by_user_id, evidence, created_at
       ) VALUES ($1,$2,$3,$4,'APPLIED',$5,$6::jsonb,NOW())`,
      [
        employee.id,
        accessId,
        plan.action,
        plan.planHash,
        auth.session.userId,
        JSON.stringify({
          effects: plan.effects,
          targetRole: plan.target.role,
          branchCount: plan.target.scope.branchIds.length,
          legalEntityCount: plan.target.scope.legalEntityIds.length,
        }),
      ],
    );
    await client.query("COMMIT");
    res.json({
      ok: true,
      action: plan.action,
      employeeId: employee.id,
      accessId,
      sessionsRevoked: plan.action !== "PROVISION",
      invitationSent: false,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if ((err as { code?: string }).code === "23505") {
      res
        .status(409)
        .json({ error: "Логин или связь с сотрудником уже существуют" });
      return;
    }
    logger.error({ err }, "People access apply failed");
    res.status(503).json({ error: "Не удалось применить план доступа" });
  } finally {
    client.release();
  }
});
