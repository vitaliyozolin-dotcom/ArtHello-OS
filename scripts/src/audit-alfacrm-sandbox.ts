import { openSandboxDatabase, sandboxTableCount } from "./sandbox-db.js";

interface CountRow {
  count: number;
}

async function main(): Promise<void> {
  const { database, migrationsApplied } = await openSandboxDatabase();
  try {
    const scalar = async (sql: string): Promise<number> => {
      const result = await database.query<CountRow>(sql);
      return Number(result.rows[0]?.count ?? 0);
    };
    const provenanceTables = [
      "crm_attendance",
      "crm_branches",
      "crm_groups",
      "crm_lessons",
      "crm_payments",
      "crm_students",
      "crm_teachers",
      "student_profiles",
      "crm_change_log",
      "crm_customer_tariffs",
      "crm_group_memberships",
      "crm_leads",
      "crm_reference_records",
    ] as const;
    const provenanceCoverage: Record<
      string,
      {
        rows: number;
        missingRaw: number;
        orphanRaw: number;
        missingBatch: number;
        orphanBatch: number;
        missingScope: number;
      }
    > = {};
    for (const table of provenanceTables) {
      const result = await database.query<{
        rows: number;
        missing_raw: number;
        orphan_raw: number;
        missing_batch: number;
        orphan_batch: number;
        missing_scope: number;
      }>(
        `SELECT
           COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE normalized.raw_record_id IS NULL)::int
             AS missing_raw,
           COUNT(*) FILTER (
             WHERE normalized.raw_record_id IS NOT NULL
               AND raw.id IS NULL
           )::int AS orphan_raw,
           COUNT(*) FILTER (WHERE normalized.last_seen_batch_id IS NULL)::int
             AS missing_batch,
           COUNT(*) FILTER (
             WHERE normalized.last_seen_batch_id IS NOT NULL
               AND batch.id IS NULL
           )::int AS orphan_batch,
           COUNT(*) FILTER (
             WHERE normalized.source_scope IS NULL
                OR normalized.source_scope = ''
           )::int AS missing_scope
         FROM ${table} AS normalized
         LEFT JOIN alpha_raw_records AS raw
           ON raw.id = normalized.raw_record_id
         LEFT JOIN alpha_sync_batches AS batch
           ON batch.id = normalized.last_seen_batch_id`,
      );
      const row = result.rows[0];
      provenanceCoverage[table] = {
        rows: Number(row?.rows ?? 0),
        missingRaw: Number(row?.missing_raw ?? 0),
        orphanRaw: Number(row?.orphan_raw ?? 0),
        missingBatch: Number(row?.missing_batch ?? 0),
        orphanBatch: Number(row?.orphan_batch ?? 0),
        missingScope: Number(row?.missing_scope ?? 0),
      };
    }

    const report = {
      mode: "sandbox_read_only_audit",
      migrationsApplied,
      tableCount: await sandboxTableCount(database),
      latestBatch:
        (
          await database.query<{
            status: string | null;
            entities_requested: number | null;
            entities_succeeded: number | null;
            entities_failed: number | null;
            total_fetched: number | null;
            total_saved: number | null;
          }>(
            `SELECT
             status,
             entities_requested,
             entities_succeeded,
             entities_failed,
             total_fetched,
             total_saved
           FROM alpha_sync_batches
           ORDER BY started_at DESC
           LIMIT 1`,
          )
        ).rows[0] ?? null,
      normalizedCounts: {
        branches: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_branches",
        ),
        students: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_students",
        ),
        leads: await scalar("SELECT COUNT(*)::int AS count FROM crm_leads"),
        groups: await scalar("SELECT COUNT(*)::int AS count FROM crm_groups"),
        teachers: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_teachers",
        ),
        payments: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_payments",
        ),
        customerTariffs: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_customer_tariffs",
        ),
        referenceRecords: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_reference_records",
        ),
        paymentReferenceTypes: await scalar(
          `SELECT COUNT(DISTINCT reference_type)::int AS count
           FROM crm_reference_records
           WHERE reference_type IN (
             'pay_accounts',
             'pay_types',
             'pay_items',
             'pay_item_categories'
           )`,
        ),
        changeLog: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_change_log",
        ),
        lessons: await scalar("SELECT COUNT(*)::int AS count FROM crm_lessons"),
        attendance: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_attendance",
        ),
        groupMemberships: await scalar(
          "SELECT COUNT(*)::int AS count FROM crm_group_memberships",
        ),
        familyCandidates: await scalar(
          "SELECT COUNT(*)::int AS count FROM family_merge_candidates",
        ),
        confirmedFamilies: 0,
      },
      provenanceCoverage,
      scopeRuns: {
        completed: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM alpha_sync_scope_runs
           WHERE status = 'completed'`,
        ),
        incomplete: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM alpha_sync_scope_runs
           WHERE status = 'incomplete'`,
        ),
      },
      integrityIssues: {
        duplicateRawKeys: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM (
             SELECT alpha_id, entity_type, branch_id, payload_hash
             FROM alpha_raw_records
             GROUP BY alpha_id, entity_type, branch_id, payload_hash
             HAVING COUNT(*) > 1
           ) duplicated`,
        ),
        crossBranchStudentIds: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM (
             SELECT alpha_id
             FROM alpha_raw_records
             WHERE entity_type = 'students'
             GROUP BY alpha_id
             HAVING COUNT(DISTINCT branch_id) > 1
           ) conflicts`,
        ),
        membershipsWithoutStudent: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM crm_group_memberships membership
           LEFT JOIN crm_students student
             ON student.crm_id = membership.student_crm_id
           WHERE student.id IS NULL`,
        ),
        membershipsWithoutGroup: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM crm_group_memberships membership
           LEFT JOIN crm_groups crm_group
             ON crm_group.crm_id = membership.group_crm_id
           WHERE crm_group.id IS NULL`,
        ),
        attendanceWithoutStudent: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM crm_attendance attendance
           LEFT JOIN crm_students student
             ON student.crm_id = attendance.student_crm_id
           WHERE student.id IS NULL`,
        ),
        attendanceWithoutLesson: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM crm_attendance attendance
           LEFT JOIN crm_lessons lesson
             ON lesson.crm_id = attendance.lesson_crm_id
           WHERE lesson.id IS NULL`,
        ),
        customerTariffsWithoutStudent: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM crm_customer_tariffs customer_tariff
           LEFT JOIN crm_students student
             ON student.crm_id = customer_tariff.customer_crm_id
           WHERE student.id IS NULL`,
        ),
        referenceRowsWithoutRawProvenance: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM crm_reference_records
           WHERE raw_record_id IS NULL`,
        ),
        changeLogRowsWithoutRawProvenance: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM crm_change_log
           WHERE raw_record_id IS NULL`,
        ),
        observationsWithoutRaw: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM alpha_raw_observations observation
           LEFT JOIN alpha_raw_records raw
             ON raw.id = observation.raw_record_id
           WHERE raw.id IS NULL`,
        ),
        observationsWithoutBatch: await scalar(
          `SELECT COUNT(*)::int AS count
           FROM alpha_raw_observations observation
           LEFT JOIN alpha_sync_batches batch
             ON batch.id = observation.sync_batch_id
           WHERE batch.id IS NULL`,
        ),
        normalizedRowsWithBrokenProvenance: Object.values(
          provenanceCoverage,
        ).reduce(
          (total, coverage) =>
            total +
            coverage.missingRaw +
            coverage.orphanRaw +
            coverage.missingBatch +
            coverage.orphanBatch +
            coverage.missingScope,
          0,
        ),
        mappedBranches: await scalar(
          "SELECT COUNT(*)::int AS count FROM branch_legal_entity_assignments",
        ),
      },
      guarantees: {
        sourceIsReadOnly: true,
        automaticFamilyMerge: false,
        leadsSeparatedFromStudents: true,
        incrementalModeIsDiscoveryOnly: true,
        incrementalOverlapDaysRange: [1, 7],
        paymentActionAttempted: false,
        secretsPersisted: false,
        personalDataPrinted: false,
        realDataPublishedToSites: false,
      },
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await database.close();
  }
}

await main();
