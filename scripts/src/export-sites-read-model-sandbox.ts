import { createHash } from "node:crypto";
import {
  decimalToMinorUnits,
  minorUnitsToLegacyNumber,
  nullableDecimalToMinorUnits,
} from "./money-minor.js";
import { openSandboxDatabase } from "./sandbox-db.js";

type JsonRow = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return new Date(value).toISOString();
  return new Date().toISOString();
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableId(...parts: unknown[]): string {
  return createHash("sha256")
    .update(parts.map((value) => String(value ?? "")).join("|"))
    .digest("hex");
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizedLabel(value: unknown): string {
  return text(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function groupKind(name: unknown): {
  unitKind: "class_candidate" | "group_or_unclassified";
  classificationStatus: "source_name_explicit" | "not_explicit";
} {
  return /\bкласс(?:а|у|ом|е|ы|ов)?\b/i.test(normalizedLabel(name))
    ? {
        unitKind: "class_candidate",
        classificationStatus: "source_name_explicit",
      }
    : {
        unitKind: "group_or_unclassified",
        classificationStatus: "not_explicit",
      };
}

function lessonCategory(lessonTypeName: unknown): {
  category: "extra_candidate" | "base_or_unclassified";
  classificationStatus:
    "source_lesson_type_keyword_needs_review" | "not_explicit";
} {
  const sourceLabel = normalizedLabel(lessonTypeName);
  return /\b(доп|дополнитель|индивидуал|круж|клуб)\w*/i.test(sourceLabel)
    ? {
        category: "extra_candidate",
        classificationStatus: "source_lesson_type_keyword_needs_review",
      }
    : {
        category: "base_or_unclassified",
        classificationStatus: "not_explicit",
      };
}

if (process.env.ARTHELLO_ALLOW_PII_EXPORT !== "owner_authorized") {
  throw new Error("Owner-authorized PII export flag is required");
}
if (process.stdout.isTTY) {
  throw new Error(
    "PII read-model export must be redirected to a protected file",
  );
}

const { database } = await openSandboxDatabase();
try {
  const exportedAt = new Date().toISOString();
  const employees = (
    await database.query<{
      id: string;
      full_name: string;
      primary_role: string | null;
      classification_status: string | null;
      updated_at: string | Date | null;
    }>(
      `SELECT
         id,
         full_name,
         primary_role,
         classification_status,
         updated_at
       FROM employees
       WHERE is_test_data IS NOT TRUE
       ORDER BY full_name`,
    )
  ).rows.map((row) => ({
    id: row.id,
    full_name: row.full_name,
    primary_role: row.primary_role,
    classification_status: row.classification_status ?? "needs_review",
    source_kind: "owner_provided_payroll_roster",
    updated_at: iso(row.updated_at),
  }));

  const payrollRows = (
    await database.query<{
      employee_id: string;
      period_month: string | Date;
      legal_entity_name: string | null;
      accrued_amount: string;
      paid_amount: string;
      accrual_rows: number;
      payment_rows: number;
    }>(
      `WITH movements AS (
         SELECT
           employee_id,
           payroll_period_id,
           amount AS accrued_amount,
           0::numeric AS paid_amount,
           1 AS accrual_rows,
           0 AS payment_rows
         FROM salary_accruals
         WHERE employee_id IS NOT NULL
         UNION ALL
         SELECT
           employee_id,
           payroll_period_id,
           0::numeric AS accrued_amount,
           amount AS paid_amount,
           0 AS accrual_rows,
           1 AS payment_rows
         FROM payroll_payments
         WHERE employee_id IS NOT NULL
       )
       SELECT
         movement.employee_id,
         period.period_month,
         legal_entity.legal_name AS legal_entity_name,
         SUM(movement.accrued_amount)::text AS accrued_amount,
         SUM(movement.paid_amount)::text AS paid_amount,
         SUM(movement.accrual_rows)::int AS accrual_rows,
         SUM(movement.payment_rows)::int AS payment_rows
       FROM movements AS movement
       JOIN payroll_periods AS period
         ON period.id = movement.payroll_period_id
       LEFT JOIN legal_entities AS legal_entity
         ON legal_entity.id = period.legal_entity_id
       GROUP BY
         movement.employee_id,
         period.period_month,
         legal_entity.legal_name
       ORDER BY period.period_month DESC, movement.employee_id`,
    )
  ).rows.map((row) => {
    const periodMonth = iso(row.period_month).slice(0, 10);
    const accruedAmountMinor = decimalToMinorUnits(row.accrued_amount);
    const paidAmountMinor = decimalToMinorUnits(row.paid_amount);
    return {
      id: stableId(row.employee_id, periodMonth, row.legal_entity_name),
      employee_id: row.employee_id,
      period_month: periodMonth,
      accrued_amount: minorUnitsToLegacyNumber(accruedAmountMinor),
      paid_amount: minorUnitsToLegacyNumber(paidAmountMinor),
      accrued_amount_minor: accruedAmountMinor,
      paid_amount_minor: paidAmountMinor,
      accrual_rows: Number(row.accrual_rows),
      payment_rows: Number(row.payment_rows),
      evidence_status: "imported_unverified",
      legal_entity_name: row.legal_entity_name,
      updated_at: exportedAt,
    };
  });

  const payrollComponents = (
    await database.query<{
      id: string;
      employee_id: string;
      period_month: string | Date;
      legal_entity_name: string | null;
      component_key: string;
      accrual_type: string;
      amount: string;
      calculation_evidence: Record<string, unknown> | null;
    }>(
      `SELECT
         accrual.id,
         accrual.employee_id,
         period.period_month,
         legal_entity.legal_name AS legal_entity_name,
         accrual.component_key,
         accrual.accrual_type,
         accrual.amount::text,
         accrual.calculation_evidence
       FROM salary_accruals AS accrual
       JOIN payroll_periods AS period
         ON period.id = accrual.payroll_period_id
       LEFT JOIN legal_entities AS legal_entity
         ON legal_entity.id = period.legal_entity_id
       WHERE accrual.employee_id IS NOT NULL
       ORDER BY period.period_month DESC, accrual.employee_id, accrual.id`,
    )
  ).rows.map((row) => {
    const amountMinor = decimalToMinorUnits(row.amount);
    return {
      id: row.id,
      employee_id: row.employee_id,
      period_month: iso(row.period_month).slice(0, 10),
      legal_entity_name: row.legal_entity_name,
      component_key: row.component_key,
      source_label: row.accrual_type,
      amount: minorUnitsToLegacyNumber(amountMinor),
      amount_minor: amountMinor,
      quantity: nullableNumberValue(row.calculation_evidence?.["quantity"]),
      source_sheet: text(row.calculation_evidence?.["sourceSheet"]) || null,
      formula_present: row.calculation_evidence?.["formulaPresent"] ? 1 : 0,
      evidence_status: "imported_unverified",
      rule_activated: 0,
      updated_at: exportedAt,
    };
  });

  const payrollPayments = (
    await database.query<{
      id: string;
      employee_id: string;
      period_month: string | Date | null;
      legal_entity_name: string | null;
      payment_date: string | Date | null;
      amount: string;
      payment_kind: string | null;
      status: string;
    }>(
      `SELECT
         payment.id,
         payment.employee_id,
         period.period_month,
         legal_entity.legal_name AS legal_entity_name,
         payment.payment_date,
         payment.amount::text,
         payment.payment_kind,
         payment.status
       FROM payroll_payments AS payment
       LEFT JOIN payroll_periods AS period
         ON period.id = payment.payroll_period_id
       LEFT JOIN legal_entities AS legal_entity
         ON legal_entity.id = period.legal_entity_id
       WHERE payment.employee_id IS NOT NULL
       ORDER BY
         period.period_month DESC,
         payment.payment_date DESC,
         payment.id`,
    )
  ).rows.map((row) => {
    const amountMinor = decimalToMinorUnits(row.amount);
    return {
      id: row.id,
      employee_id: row.employee_id,
      period_month: row.period_month
        ? iso(row.period_month).slice(0, 10)
        : null,
      legal_entity_name: row.legal_entity_name,
      payment_date: row.payment_date
        ? iso(row.payment_date).slice(0, 10)
        : null,
      amount: minorUnitsToLegacyNumber(amountMinor),
      amount_minor: amountMinor,
      payment_kind: row.payment_kind,
      evidence_status: row.status,
      updated_at: exportedAt,
    };
  });

  const paymentHeader =
    (
      await database.query<{ payload: { values?: unknown[] } }>(
        `SELECT raw.payload
       FROM source_raw_records AS raw
       WHERE raw.source_system = 'google_sheets'
         AND raw.record_locator LIKE 'ВЫПЛАТЫ!%'
       ORDER BY raw.record_locator
       LIMIT 1`,
      )
    ).rows[0]?.payload.values ?? [];
  const normalizedHeader = paymentHeader.map((value) =>
    text(value).toLocaleLowerCase("ru-RU"),
  );
  const paymentNameIndex = normalizedHeader.indexOf("фио");

  const unresolvedPayments = (
    await database.query<{
      id: string;
      period_month: string | Date | null;
      amount: string;
      evidence: Record<string, unknown> | null;
      payload: { values?: unknown[] };
    }>(
      `SELECT
         payment.id,
         period.period_month,
         payment.amount::text,
         payment.evidence,
         raw.payload
       FROM payroll_payments AS payment
       LEFT JOIN payroll_periods AS period
         ON period.id = payment.payroll_period_id
       JOIN source_raw_records AS raw
         ON raw.id = payment.source_raw_record_id
       WHERE payment.employee_id IS NULL
       ORDER BY period.period_month, payment.id`,
    )
  ).rows.map((row) => {
    const amountMinor = decimalToMinorUnits(row.amount);
    return {
      id: `payment:${row.id}`,
      source_type: "payment",
      source_label:
        paymentNameIndex >= 0
          ? text(row.payload.values?.[paymentNameIndex]) || "Не указано"
          : "Не указано",
      source_role: null,
      period_month: row.period_month
        ? iso(row.period_month).slice(0, 10)
        : null,
      amount: minorUnitsToLegacyNumber(amountMinor),
      amount_minor: amountMinor,
      reason: text(row.evidence?.["identityMatch"]) || "not_found",
      updated_at: exportedAt,
    };
  });

  const unresolvedAccruals = (
    await database.query<{
      id: string;
      source_name: string | null;
      source_role: string | null;
      match_status: string;
      period_month: string | Date | null;
      amount: string;
    }>(
      `SELECT
         accrual.id,
         identity.source_name,
         identity.source_role,
         identity.match_status,
         period.period_month,
         accrual.amount::text
       FROM salary_accruals AS accrual
       LEFT JOIN employee_external_identities AS identity
         ON identity.id = accrual.employee_external_identity_id
       LEFT JOIN payroll_periods AS period
         ON period.id = accrual.payroll_period_id
       WHERE accrual.employee_id IS NULL
       ORDER BY period.period_month, accrual.id`,
    )
  ).rows.map((row) => {
    const amountMinor = decimalToMinorUnits(row.amount);
    return {
      id: `accrual:${row.id}`,
      source_type: "accrual",
      source_label: row.source_name ?? "Не указано",
      source_role: row.source_role,
      period_month: row.period_month
        ? iso(row.period_month).slice(0, 10)
        : null,
      amount: minorUnitsToLegacyNumber(amountMinor),
      amount_minor: amountMinor,
      reason: row.match_status,
      updated_at: exportedAt,
    };
  });

  const latestAlpha = (
    await database.query<{
      id: string;
      mode: string;
      status: string;
      finished_at: string | Date | null;
      entities_requested: number | null;
      entities_succeeded: number | null;
      entities_failed: number | null;
      total_fetched: number | null;
      scope_runs: number;
      incomplete_scopes: number;
    }>(
      `SELECT
         batch.id,
         batch.mode,
         batch.status,
         batch.finished_at,
         batch.entities_requested,
         batch.entities_succeeded,
         batch.entities_failed,
         batch.total_fetched,
         (
           SELECT COUNT(*)::int
           FROM alpha_sync_scope_runs scope
           WHERE scope.sync_batch_id = batch.id
         ) AS scope_runs,
         (
           SELECT COUNT(*)::int
           FROM alpha_sync_scope_runs scope
           WHERE scope.sync_batch_id = batch.id
             AND scope.status <> 'completed'
         ) AS incomplete_scopes
       FROM alpha_sync_batches batch
       ORDER BY batch.started_at DESC
       LIMIT 1`,
    )
  ).rows[0];
  const allowVerifiedPayrollWithPartialAlfaAggregate =
    process.env.ARTHELLO_ALLOW_PARTIAL_ALFA_AGGREGATE ===
    "owner_authorized_payroll_only";
  const alphaScopeInventoryComplete =
    latestAlpha?.mode === "full_sandbox_read_only" &&
    latestAlpha.status === "completed" &&
    Number(latestAlpha.entities_requested ?? 0) > 0 &&
    Number(latestAlpha.entities_succeeded ?? 0) ===
      Number(latestAlpha.entities_requested ?? 0) &&
    Number(latestAlpha.entities_failed ?? 0) === 0 &&
    Number(latestAlpha.scope_runs ?? 0) ===
      Number(latestAlpha.entities_requested ?? 0) &&
    Number(latestAlpha.incomplete_scopes ?? 0) === 0;
  const skipAlphaOperationalRows =
    allowVerifiedPayrollWithPartialAlfaAggregate &&
    !alphaScopeInventoryComplete;

  const branches = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          name: string | null;
          record_state: string;
          legal_entity_name: string | null;
          mapping_status: string | null;
          synced_at: string | Date | null;
        }>(
          `SELECT
         branch.crm_id AS id,
         branch.name,
         branch.record_state,
         legal_entity.legal_name AS legal_entity_name,
         assignment.mapping_status,
         branch.synced_at
       FROM crm_branches AS branch
       LEFT JOIN branch_legal_entity_assignments AS assignment
         ON assignment.branch_crm_id = branch.crm_id
       LEFT JOIN legal_entities AS legal_entity
         ON legal_entity.id = assignment.legal_entity_id
       ORDER BY branch.name, branch.crm_id`,
        )
      ).rows.map((row) => ({
        id: row.id,
        name: row.name,
        record_state: row.record_state,
        legal_entity_name: row.legal_entity_name,
        legal_entity_status: row.mapping_status ?? "unresolved",
        updated_at: iso(row.synced_at),
      }));

  const students = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          branch_id: string | null;
          branch_name: string | null;
          full_name: string | null;
          study_status: string | null;
          record_state: string;
          group_count: number;
          payment_count: number;
          lesson_count: number;
          synced_at: string | Date | null;
        }>(
          `SELECT
         student.crm_id AS id,
         student.branch_crm_id AS branch_id,
         branch.name AS branch_name,
         student.full_name,
         student.status AS study_status,
         student.record_state,
         COUNT(DISTINCT membership.id) FILTER (
           WHERE membership.record_state = 'current'
         )::int AS group_count,
         COUNT(DISTINCT payment.id) FILTER (
           WHERE payment.record_state = 'current'
         )::int AS payment_count,
         COUNT(DISTINCT attendance.id) FILTER (
           WHERE attendance.record_state = 'current'
         )::int AS lesson_count,
         student.synced_at
       FROM crm_students AS student
       LEFT JOIN crm_branches AS branch
         ON branch.crm_id = student.branch_crm_id
       LEFT JOIN crm_group_memberships AS membership
         ON membership.branch_crm_id = student.branch_crm_id
        AND membership.student_crm_id = student.crm_id
       LEFT JOIN crm_payments AS payment
         ON payment.branch_crm_id = student.branch_crm_id
        AND payment.student_crm_id = student.crm_id
       LEFT JOIN crm_attendance AS attendance
         ON attendance.branch_crm_id = student.branch_crm_id
        AND attendance.student_crm_id = student.crm_id
       GROUP BY student.id, branch.name
       ORDER BY student.full_name, student.crm_id`,
        )
      ).rows.map((row) => ({
        id: stableId("student", row.branch_id, row.id),
        source_id: row.id,
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        full_name: row.full_name,
        study_status: row.study_status,
        record_state: row.record_state,
        group_count: Number(row.group_count),
        payment_count: Number(row.payment_count),
        lesson_count: Number(row.lesson_count),
        updated_at: iso(row.synced_at),
      }));

  const families = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          left_student_id: string;
          left_student_name: string | null;
          right_student_id: string;
          right_student_name: string | null;
          branch_name: string | null;
          confidence: string;
          status: string;
          reason_codes: unknown;
          updated_at: string | Date;
        }>(
          `SELECT
         candidate.id,
         candidate.left_student_crm_id AS left_student_id,
         left_student.full_name AS left_student_name,
         candidate.right_student_crm_id AS right_student_id,
         right_student.full_name AS right_student_name,
         CASE
           WHEN candidate.branch_crm_id IS NOT NULL THEN branch.name
           WHEN left_branch.name IS NOT NULL
             AND right_branch.name IS NOT NULL
             THEN left_branch.name || ' ↔ ' || right_branch.name
           ELSE 'Несколько филиалов'
         END AS branch_name,
         candidate.confidence::text,
         candidate.status,
         candidate.reason_codes,
         candidate.updated_at
       FROM family_merge_candidates AS candidate
       LEFT JOIN crm_students AS left_student
         ON left_student.branch_crm_id = candidate.left_student_branch_crm_id
        AND left_student.crm_id = candidate.left_student_crm_id
       LEFT JOIN crm_students AS right_student
         ON right_student.branch_crm_id = candidate.right_student_branch_crm_id
        AND right_student.crm_id = candidate.right_student_crm_id
       LEFT JOIN crm_branches AS branch
         ON branch.crm_id = candidate.branch_crm_id
       LEFT JOIN crm_branches AS left_branch
         ON left_branch.crm_id = candidate.left_student_branch_crm_id
       LEFT JOIN crm_branches AS right_branch
         ON right_branch.crm_id = candidate.right_student_branch_crm_id
       ORDER BY candidate.updated_at DESC`,
        )
      ).rows.map((row) => ({
        id: row.id,
        left_student_id: row.left_student_id,
        left_student_name: row.left_student_name,
        right_student_id: row.right_student_id,
        right_student_name: row.right_student_name,
        branch_name: row.branch_name,
        confidence: numberValue(row.confidence),
        status: row.status,
        reason_codes_json: JSON.stringify(row.reason_codes ?? []),
        updated_at: iso(row.updated_at),
      }));

  const groups = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          branch_id: string | null;
          branch_name: string | null;
          name: string | null;
          lifecycle_status: string | null;
          record_state: string;
          student_count: number;
          lesson_count: number;
          synced_at: string | Date | null;
        }>(
          `SELECT
         crm_group.crm_id AS id,
         crm_group.branch_crm_id AS branch_id,
         branch.name AS branch_name,
         crm_group.name,
         crm_group.lifecycle_status,
         crm_group.record_state,
         COUNT(DISTINCT membership.id) FILTER (
           WHERE membership.record_state = 'current'
         )::int AS student_count,
         COUNT(DISTINCT lesson.id) FILTER (
           WHERE lesson.record_state = 'current'
         )::int AS lesson_count,
         crm_group.synced_at
       FROM crm_groups AS crm_group
       LEFT JOIN crm_branches AS branch
         ON branch.crm_id = crm_group.branch_crm_id
       LEFT JOIN crm_group_memberships AS membership
         ON membership.branch_crm_id = crm_group.branch_crm_id
        AND membership.group_crm_id = crm_group.crm_id
       LEFT JOIN crm_lessons AS lesson
         ON lesson.branch_crm_id = crm_group.branch_crm_id
        AND COALESCE(
          NULLIF(lesson.group_crm_id, ''),
          lesson.raw->'group_ids'->>0
        ) = crm_group.crm_id
       GROUP BY crm_group.id, branch.name
       ORDER BY crm_group.name, crm_group.crm_id`,
        )
      ).rows.map((row) => {
        const classification = groupKind(row.name);
        return {
          id: stableId("group", row.branch_id, row.id),
          source_id: row.id,
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          name: row.name,
          lifecycle_status: row.lifecycle_status,
          record_state: row.record_state,
          student_count: Number(row.student_count),
          lesson_count: Number(row.lesson_count),
          unit_kind: classification.unitKind,
          classification_status: classification.classificationStatus,
          updated_at: iso(row.synced_at),
        };
      });

  const employeeIdsByName = new Map<string, string[]>();
  for (const employee of employees) {
    const key = normalizedLabel(employee.full_name);
    if (!key) continue;
    const ids = employeeIdsByName.get(key) ?? [];
    ids.push(employee.id);
    employeeIdsByName.set(key, ids);
  }

  const teachers = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          branch_id: string | null;
          branch_name: string | null;
          full_name: string | null;
          status: string | null;
          record_state: string;
          lesson_count: number;
          rate_rule_count: number;
          working_hour_rule_count: number;
          synced_at: string | Date | null;
        }>(
          `SELECT
         teacher.crm_id AS id,
         teacher.branch_crm_id AS branch_id,
         branch.name AS branch_name,
         teacher.full_name,
         teacher.status,
         teacher.record_state,
         COUNT(DISTINCT lesson.id) FILTER (
           WHERE lesson.record_state = 'current'
         )::int AS lesson_count,
         COUNT(DISTINCT rate.id) FILTER (
           WHERE rate.record_state = 'current'
         )::int AS rate_rule_count,
         COUNT(DISTINCT working_hour.id) FILTER (
           WHERE working_hour.record_state = 'current'
         )::int AS working_hour_rule_count,
         teacher.synced_at
       FROM crm_teachers AS teacher
       LEFT JOIN crm_branches AS branch
         ON branch.crm_id = teacher.branch_crm_id
       LEFT JOIN crm_lessons AS lesson
         ON lesson.branch_crm_id = teacher.branch_crm_id
        AND COALESCE(
          NULLIF(lesson.teacher_crm_id, ''),
          lesson.raw->'teacher_ids'->>0
        ) = teacher.crm_id
       LEFT JOIN crm_reference_records AS rate
         ON rate.branch_crm_id = teacher.branch_crm_id
        AND rate.reference_type = 'teacher_rates'
        AND rate.raw->>'teacher_id' = teacher.crm_id
       LEFT JOIN crm_reference_records AS working_hour
         ON working_hour.branch_crm_id = teacher.branch_crm_id
        AND working_hour.reference_type = 'teacher_working_hours'
        AND working_hour.raw->>'teacher_id' = teacher.crm_id
       GROUP BY teacher.id, branch.name
       ORDER BY teacher.full_name, teacher.crm_id`,
        )
      ).rows.map((row) => {
        const employeeCandidates = row.full_name
          ? (employeeIdsByName.get(normalizedLabel(row.full_name)) ?? [])
          : [];
        return {
          id: stableId("teacher", row.branch_id, row.id),
          source_id: row.id,
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          full_name: row.full_name,
          teacher_status: row.status,
          record_state: row.record_state,
          lesson_count: Number(row.lesson_count),
          rate_rule_count: Number(row.rate_rule_count),
          working_hour_rule_count: Number(row.working_hour_rule_count),
          payroll_employee_id_candidate:
            employeeCandidates.length === 1 ? employeeCandidates[0] : null,
          payroll_match_status:
            employeeCandidates.length === 1
              ? "exact_name_candidate_requires_review"
              : employeeCandidates.length > 1
                ? "ambiguous_name"
                : "not_found",
          updated_at: iso(row.synced_at),
        };
      });

  const teacherNames = new Map(
    teachers.map((teacher) => [
      `${teacher.branch_id ?? ""}\u0000${teacher.source_id}`,
      teacher.full_name,
    ]),
  );
  const teacherRates = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          branch_id: string;
          branch_name: string | null;
          raw: Record<string, unknown>;
          record_state: string;
          synced_at: string | Date | null;
        }>(
          `SELECT
         rate.crm_id AS id,
         rate.branch_crm_id AS branch_id,
         branch.name AS branch_name,
         rate.raw,
         rate.record_state,
         rate.synced_at
       FROM crm_reference_records AS rate
       LEFT JOIN crm_branches AS branch
         ON branch.crm_id = rate.branch_crm_id
       WHERE rate.reference_type = 'teacher_rates'
       ORDER BY rate.branch_crm_id, rate.crm_id`,
        )
      ).rows.map((row) => {
        const teacherId = text(row.raw?.["teacher_id"]) || null;
        const rateAmountMinor = nullableDecimalToMinorUnits(row.raw?.["rate"]);
        return {
          id: stableId("teacher_rate", row.branch_id, row.id),
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          teacher_id: teacherId,
          teacher_name: teacherId
            ? (teacherNames.get(`${row.branch_id}\u0000${teacherId}`) ?? null)
            : null,
          rate_amount:
            rateAmountMinor === null
              ? null
              : minorUnitsToLegacyNumber(rateAmountMinor),
          rate_amount_minor: rateAmountMinor,
          rate_type: text(row.raw?.["type"]) || null,
          valid_from: text(row.raw?.["b_date"]) || null,
          valid_to: text(row.raw?.["e_date"]) || null,
          conditions_json: JSON.stringify({
            attendance: row.raw?.["condition_attend"] ?? null,
            countFrom: row.raw?.["count_from"] ?? null,
            countTo: row.raw?.["count_to"] ?? null,
            duration: row.raw?.["duration"] ?? null,
            proportional: row.raw?.["is_proportional"] ?? null,
            multiRate: row.raw?.["is_multirate"] ?? null,
            lessonTypeIds: row.raw?.["lesson_type_ids"] ?? [],
            subjectIds: row.raw?.["subject_ids"] ?? [],
            reasonIds: row.raw?.["reason_ids"] ?? [],
          }),
          evidence_status: "alfacrm_source_rule_unverified",
          record_state: row.record_state,
          updated_at: iso(row.synced_at),
        };
      });

  const lessons = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          branch_id: string | null;
          branch_name: string | null;
          group_id: string | null;
          group_name: string | null;
          teacher_name: string | null;
          lesson_type_name: string | null;
          subject_name: string | null;
          lesson_date: string | Date | null;
          title: string | null;
          record_state: string;
          attendance_count: number;
          synced_at: string | Date | null;
        }>(
          `SELECT
         lesson.crm_id AS id,
         lesson.branch_crm_id AS branch_id,
         branch.name AS branch_name,
         COALESCE(
           NULLIF(lesson.group_crm_id, ''),
           lesson.raw->'group_ids'->>0
         ) AS group_id,
         crm_group.name AS group_name,
         teacher.full_name AS teacher_name,
         COALESCE(
           NULLIF(lesson.raw->>'lesson_type_name', ''),
           lesson_type.name
         ) AS lesson_type_name,
         subject.name AS subject_name,
         lesson.lesson_date,
         lesson.title,
         lesson.record_state,
         COUNT(attendance.id) FILTER (
           WHERE attendance.record_state = 'current'
         )::int AS attendance_count,
         lesson.synced_at
       FROM crm_lessons AS lesson
       LEFT JOIN crm_branches AS branch
         ON branch.crm_id = lesson.branch_crm_id
       LEFT JOIN crm_groups AS crm_group
         ON crm_group.branch_crm_id = lesson.branch_crm_id
        AND crm_group.crm_id = COALESCE(
          NULLIF(lesson.group_crm_id, ''),
          lesson.raw->'group_ids'->>0
        )
       LEFT JOIN crm_teachers AS teacher
         ON teacher.branch_crm_id = lesson.branch_crm_id
        AND teacher.crm_id = COALESCE(
           NULLIF(lesson.teacher_crm_id, ''),
           lesson.raw->'teacher_ids'->>0
         )
       LEFT JOIN crm_reference_records AS lesson_type
         ON lesson_type.branch_crm_id = lesson.branch_crm_id
        AND lesson_type.reference_type = 'lesson_types'
        AND lesson_type.crm_id = lesson.raw->>'lesson_type_id'
       LEFT JOIN crm_reference_records AS subject
         ON subject.branch_crm_id = lesson.branch_crm_id
        AND subject.reference_type = 'subjects'
        AND subject.crm_id = lesson.raw->>'subject_id'
       LEFT JOIN crm_attendance AS attendance
         ON attendance.branch_crm_id = lesson.branch_crm_id
        AND attendance.lesson_crm_id = lesson.crm_id
       GROUP BY
         lesson.id,
         branch.name,
         crm_group.name,
         teacher.full_name,
         lesson_type.name,
         subject.name
       ORDER BY lesson.lesson_date DESC, lesson.crm_id`,
        )
      ).rows.map((row) => {
        const classification = lessonCategory(row.lesson_type_name);
        return {
          id: stableId("lesson", row.branch_id, row.id),
          source_id: row.id,
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          group_id: row.group_id,
          group_name: row.group_name,
          teacher_name: row.teacher_name,
          lesson_type_name: row.lesson_type_name,
          subject_name: row.subject_name,
          lesson_category: classification.category,
          classification_status: classification.classificationStatus,
          lesson_date: row.lesson_date ? iso(row.lesson_date) : null,
          title: row.title,
          record_state: row.record_state,
          attendance_count: Number(row.attendance_count),
          updated_at: iso(row.synced_at),
        };
      });

  const payments = skipAlphaOperationalRows
    ? []
    : (
        await database.query<{
          id: string;
          branch_id: string | null;
          branch_name: string | null;
          student_id: string | null;
          student_name: string | null;
          amount: string | null;
          payment_date: string | Date | null;
          payment_type: string | null;
          record_state: string;
          synced_at: string | Date | null;
        }>(
          `SELECT
         payment.crm_id AS id,
         payment.branch_crm_id AS branch_id,
         branch.name AS branch_name,
         payment.student_crm_id AS student_id,
         student.full_name AS student_name,
         payment.amount::text,
         payment.payment_date,
         payment.type AS payment_type,
         payment.record_state,
         payment.synced_at
       FROM crm_payments AS payment
       LEFT JOIN crm_branches AS branch
         ON branch.crm_id = payment.branch_crm_id
       LEFT JOIN crm_students AS student
         ON student.branch_crm_id = payment.branch_crm_id
        AND student.crm_id = payment.student_crm_id
       ORDER BY payment.payment_date DESC, payment.crm_id`,
        )
      ).rows.map((row) => {
        const amountMinor = nullableDecimalToMinorUnits(row.amount);
        return {
          id: stableId("payment", row.branch_id, row.id),
          source_id: row.id,
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          student_id: row.student_id,
          student_name: row.student_name,
          amount:
            amountMinor === null ? null : minorUnitsToLegacyNumber(amountMinor),
          amount_minor: amountMinor,
          payment_date: row.payment_date
            ? iso(row.payment_date).slice(0, 10)
            : null,
          payment_type: row.payment_type,
          record_state: row.record_state,
          updated_at: iso(row.synced_at),
        };
      });

  const alphaQuality = latestAlpha
    ? (
        await database.query<{
          incomplete_scopes: number;
          memberships_without_student: number;
          memberships_without_group: number;
          attendance_without_student: number;
          attendance_without_lesson: number;
          tariffs_without_student: number;
          family_candidates_without_student: number;
          family_candidates_with_same_identity: number;
        }>(
          `SELECT
             (
               SELECT COUNT(*)::int
               FROM alpha_sync_scope_runs
               WHERE sync_batch_id = $1
                 AND status <> 'completed'
             ) AS incomplete_scopes,
             (
               SELECT COUNT(*)::int
               FROM crm_group_memberships membership
               LEFT JOIN crm_students student
                 ON student.branch_crm_id = membership.branch_crm_id
                AND student.crm_id = membership.student_crm_id
               WHERE student.id IS NULL
             ) AS memberships_without_student,
             (
               SELECT COUNT(*)::int
               FROM crm_group_memberships membership
               LEFT JOIN crm_groups crm_group
                 ON crm_group.branch_crm_id = membership.branch_crm_id
                AND crm_group.crm_id = membership.group_crm_id
               WHERE crm_group.id IS NULL
             ) AS memberships_without_group,
             (
               SELECT COUNT(*)::int
               FROM crm_attendance attendance
               LEFT JOIN crm_students student
                 ON student.branch_crm_id = attendance.branch_crm_id
                AND student.crm_id = attendance.student_crm_id
               WHERE student.id IS NULL
             ) AS attendance_without_student,
             (
               SELECT COUNT(*)::int
               FROM crm_attendance attendance
               LEFT JOIN crm_lessons lesson
                 ON lesson.branch_crm_id = attendance.branch_crm_id
                AND lesson.crm_id = attendance.lesson_crm_id
               WHERE lesson.id IS NULL
             ) AS attendance_without_lesson,
             (
               SELECT COUNT(*)::int
               FROM crm_customer_tariffs tariff
               LEFT JOIN crm_students student
                 ON student.branch_crm_id = tariff.branch_crm_id
                AND student.crm_id = tariff.customer_crm_id
               WHERE student.id IS NULL
             ) AS tariffs_without_student,
             (
               SELECT COUNT(*)::int
               FROM family_merge_candidates candidate
               LEFT JOIN crm_students left_student
                 ON left_student.branch_crm_id =
                      candidate.left_student_branch_crm_id
                AND left_student.crm_id = candidate.left_student_crm_id
               LEFT JOIN crm_students right_student
                 ON right_student.branch_crm_id =
                      candidate.right_student_branch_crm_id
                AND right_student.crm_id = candidate.right_student_crm_id
               WHERE left_student.id IS NULL OR right_student.id IS NULL
             ) AS family_candidates_without_student,
             (
               SELECT COUNT(*)::int
               FROM family_merge_candidates
               WHERE left_student_branch_crm_id =
                       right_student_branch_crm_id
                 AND left_student_crm_id = right_student_crm_id
             ) AS family_candidates_with_same_identity`,
          [latestAlpha.id],
        )
      ).rows[0]
    : undefined;
  const alphaAggregateCounts = skipAlphaOperationalRows
    ? (
        await database.query<{
          branches: number;
          students: number;
          family_candidates: number;
          groups: number;
          teachers: number;
          teacher_rates: number;
          lessons: number;
          payments: number;
        }>(
          `SELECT
             (
               SELECT COUNT(*)::int
               FROM crm_branches
               WHERE record_state = 'current'
             ) AS branches,
             (
               SELECT COUNT(*)::int
               FROM crm_students
               WHERE record_state = 'current'
             ) AS students,
             (
               SELECT COUNT(*)::int
               FROM family_merge_candidates
               WHERE status = 'pending_review'
             ) AS family_candidates,
             (
               SELECT COUNT(*)::int
               FROM crm_groups
               WHERE record_state = 'current'
             ) AS groups,
             (
               SELECT COUNT(*)::int
               FROM crm_teachers
               WHERE record_state = 'current'
             ) AS teachers,
             (
               SELECT COUNT(*)::int
               FROM crm_reference_records
               WHERE reference_type = 'teacher_rates'
                 AND record_state = 'current'
             ) AS teacher_rates,
             (
               SELECT COUNT(*)::int
               FROM crm_lessons
               WHERE record_state = 'current'
             ) AS lessons,
             (
               SELECT COUNT(*)::int
               FROM crm_payments
               WHERE record_state = 'current'
             ) AS payments`,
        )
      ).rows[0]
    : {
        branches: branches.filter((row) => row.record_state === "current")
          .length,
        students: students.filter((row) => row.record_state === "current")
          .length,
        family_candidates: families.filter(
          (row) => row.status === "pending_review",
        ).length,
        groups: groups.filter((row) => row.record_state === "current").length,
        teachers: teachers.filter((row) => row.record_state === "current")
          .length,
        teacher_rates: teacherRates.filter(
          (row) => row.record_state === "current",
        ).length,
        lessons: lessons.filter((row) => row.record_state === "current").length,
        payments: payments.filter((row) => row.record_state === "current")
          .length,
      };
  const hasAlphaData =
    Number(alphaAggregateCounts?.branches ?? 0) +
      Number(alphaAggregateCounts?.students ?? 0) +
      Number(alphaAggregateCounts?.groups ?? 0) +
      Number(alphaAggregateCounts?.teachers ?? 0) +
      Number(alphaAggregateCounts?.lessons ?? 0) +
      Number(alphaAggregateCounts?.payments ?? 0) >
    0;
  const incompleteAlphaScopes = Number(alphaQuality?.incomplete_scopes ?? 0);
  const alphaRowsExportable =
    alphaScopeInventoryComplete && incompleteAlphaScopes === 0;
  if (
    hasAlphaData &&
    !alphaRowsExportable &&
    !allowVerifiedPayrollWithPartialAlfaAggregate
  ) {
    throw new Error("ALFACRM_TERMINAL_SNAPSHOT_REQUIRED");
  }
  if (
    incompleteAlphaScopes > 0 &&
    !allowVerifiedPayrollWithPartialAlfaAggregate
  ) {
    throw new Error("ALFACRM_SCOPE_COMPLETION_REQUIRED");
  }
  const alphaLinkageIssues = [
    alphaQuality?.memberships_without_student,
    alphaQuality?.memberships_without_group,
    alphaQuality?.attendance_without_student,
    alphaQuality?.attendance_without_lesson,
    alphaQuality?.tariffs_without_student,
    alphaQuality?.family_candidates_without_student,
    alphaQuality?.family_candidates_with_same_identity,
  ].reduce<number>((total, value) => total + Number(value ?? 0), 0);

  const latestPayrollImport = (
    await database.query<{
      records_rejected: number | null;
    }>(
      `SELECT records_rejected
       FROM source_import_batches
       WHERE source_system = 'google_sheets'
         AND source_title = '25-26 Атлас // Зарплатная ведомость'
       ORDER BY started_at DESC
       LIMIT 1`,
    )
  ).rows[0];
  const rejectedPayrollSourceRows = Number(
    latestPayrollImport?.records_rejected ?? 0,
  );

  const syncStatus = [
    {
      source: "payroll",
      status:
        unresolvedPayments.length +
          unresolvedAccruals.length +
          rejectedPayrollSourceRows >
        0
          ? "attention"
          : "active",
      label: "Зарплатная ведомость",
      data_mode: "real_owner_provided_source",
      last_synced_at: exportedAt,
      counts_json: JSON.stringify({
        employees: employees.length,
        monthlyRows: payrollRows.length,
        accrualComponents: payrollComponents.length,
        paymentRows: payrollPayments.length,
        unresolved: unresolvedPayments.length + unresolvedAccruals.length,
        rejectedSourceRows: rejectedPayrollSourceRows,
      }),
      details_json: JSON.stringify({
        formulasPreserved: true,
        formulaRulesActivated: false,
        amountsAudited: true,
        rejectedRowsExcludedFromMoneyTotals: true,
      }),
      updated_at: exportedAt,
    },
    {
      source: "payroll_taxes",
      status: "not_sourced",
      label: "Налоги по зарплате",
      data_mode: "source_not_provided",
      last_synced_at: exportedAt,
      counts_json: JSON.stringify({ normalizedTaxRows: 0 }),
      details_json: JSON.stringify({
        taxRulesActivated: false,
        taxAssumptionsApplied: false,
        explicitNormalizedTaxSourcePresent: false,
      }),
      updated_at: exportedAt,
    },
    {
      source: "alfacrm",
      status:
        alphaRowsExportable && alphaLinkageIssues > 0
          ? "attention"
          : alphaRowsExportable
            ? "completed"
            : "partial",
      label: "AlfaCRM",
      data_mode: alphaRowsExportable
        ? "real_read_only_terminal"
        : "partial_aggregate_no_rows",
      last_synced_at: latestAlpha?.finished_at
        ? iso(latestAlpha.finished_at)
        : null,
      counts_json: JSON.stringify({
        branches: Number(alphaAggregateCounts?.branches ?? 0),
        students: Number(alphaAggregateCounts?.students ?? 0),
        familyCandidates: Number(alphaAggregateCounts?.family_candidates ?? 0),
        groups: Number(alphaAggregateCounts?.groups ?? 0),
        teachers: Number(alphaAggregateCounts?.teachers ?? 0),
        teacherRates: Number(alphaAggregateCounts?.teacher_rates ?? 0),
        lessons: Number(alphaAggregateCounts?.lessons ?? 0),
        extraLessonCandidates: skipAlphaOperationalRows
          ? 0
          : lessons.filter(
              (row) =>
                row.record_state === "current" &&
                row.lesson_category === "extra_candidate",
            ).length,
        payments: Number(alphaAggregateCounts?.payments ?? 0),
      }),
      details_json: JSON.stringify({
        batchMode: latestAlpha?.mode ?? "not_loaded",
        batchStatus: latestAlpha?.status ?? "not_loaded",
        entitiesRequested: Number(latestAlpha?.entities_requested ?? 0),
        entitiesSucceeded: Number(latestAlpha?.entities_succeeded ?? 0),
        entitiesFailed: Number(latestAlpha?.entities_failed ?? 0),
        scopeRuns: Number(latestAlpha?.scope_runs ?? 0),
        scopeInventoryComplete: alphaScopeInventoryComplete,
        totalFetched: Number(latestAlpha?.total_fetched ?? 0),
        linkageIssues: alphaLinkageIssues,
        terminalGatePassed: alphaRowsExportable,
        operationalRowsPublished: alphaRowsExportable,
        quality: {
          incompleteScopes: incompleteAlphaScopes,
          membershipsWithoutStudent: Number(
            alphaQuality?.memberships_without_student ?? 0,
          ),
          membershipsWithoutGroup: Number(
            alphaQuality?.memberships_without_group ?? 0,
          ),
          attendanceWithoutStudent: Number(
            alphaQuality?.attendance_without_student ?? 0,
          ),
          attendanceWithoutLesson: Number(
            alphaQuality?.attendance_without_lesson ?? 0,
          ),
          tariffsWithoutStudent: Number(
            alphaQuality?.tariffs_without_student ?? 0,
          ),
          familyCandidatesWithoutStudent: Number(
            alphaQuality?.family_candidates_without_student ?? 0,
          ),
          familyCandidatesWithSameIdentity: Number(
            alphaQuality?.family_candidates_with_same_identity ?? 0,
          ),
        },
        sourceReadOnly: true,
        automaticFamilyMerge: false,
      }),
      updated_at: exportedAt,
    },
  ];

  const payload = {
    exportedAt,
    dataMode: alphaRowsExportable
      ? "owner_only_real_sources"
      : "owner_only_verified_payroll_partial_alfa_aggregate",
    datasets: {
      employees,
      employee_payroll_monthly: payrollRows,
      employee_payroll_components: payrollComponents,
      employee_payroll_payments: payrollPayments,
      payroll_unresolved: [...unresolvedPayments, ...unresolvedAccruals],
      alpha_branches: alphaRowsExportable ? branches : [],
      alpha_students: alphaRowsExportable ? students : [],
      family_candidates: alphaRowsExportable ? families : [],
      alpha_groups: alphaRowsExportable ? groups : [],
      alpha_teachers: alphaRowsExportable ? teachers : [],
      alpha_teacher_rates: alphaRowsExportable ? teacherRates : [],
      alpha_lessons: alphaRowsExportable ? lessons : [],
      alpha_payments: alphaRowsExportable ? payments : [],
      sync_status: syncStatus,
    },
    safety: {
      containsPersonalData: true,
      containsBankSecrets: false,
      sourceSecretsIncluded: false,
      ownerOnlyDestinationRequired: true,
      moneyStorageMode: "integer_minor_units",
      moneyScale: 2,
      sourceToMinorReconciliation: {
        monthlyRows: payrollRows.length,
        componentRows: payrollComponents.length,
        paymentRows: payrollPayments.length,
        unresolvedRows: unresolvedPayments.length + unresolvedAccruals.length,
        mismatches: 0,
      },
      legacyRealColumnsAuthoritative: false,
      financialCalculationsEnabled: false,
      payrollRulesActivated: false,
      taxRulesActivated: false,
      teacherPayrollLinksActivated: false,
      lessonCategoryAuthoritative: false,
      automaticFamilyMerge: false,
      partialAlfaRowsPublished: false,
      alfaTerminalGatePassed: alphaRowsExportable,
    },
  };

  process.stdout.write(JSON.stringify(payload));
} finally {
  await database.close();
}
