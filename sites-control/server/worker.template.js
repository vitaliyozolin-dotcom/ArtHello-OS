const page = __ARTHELLO_PAGE__;

const TOCHKA_API_BASE = "https://enter.tochka.com/uapi";
const TOCHKA_TOKEN_URL = "https://enter.tochka.com/connect/token";
const TOCHKA_AUTH_URL = "https://enter.tochka.com/connect/authorize";
const TOCHKA_SCOPE = "accounts balances customers statements";
const TOCHKA_PERMISSIONS = [
  "ReadAccountsBasic",
  "ReadAccountsDetail",
  "ReadBalances",
  "ReadStatements",
  "ReadCustomerData",
];

const securityHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
};

const jsonHeaders = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": securityHeaders["x-robots-tag"],
};

const importDatasets = {
  employees: {
    table: "employees",
    key: "id",
    columns: [
      "id",
      "full_name",
      "primary_role",
      "classification_status",
      "source_kind",
      "updated_at",
    ],
  },
  employee_payroll_monthly: {
    table: "employee_payroll_monthly",
    key: "id",
    columns: [
      "id",
      "employee_id",
      "period_month",
      "accrued_amount",
      "paid_amount",
      "accrued_amount_minor",
      "paid_amount_minor",
      "accrual_rows",
      "payment_rows",
      "evidence_status",
      "legal_entity_name",
      "updated_at",
    ],
  },
  employee_payroll_components: {
    table: "employee_payroll_components",
    key: "id",
    columns: [
      "id",
      "employee_id",
      "period_month",
      "legal_entity_name",
      "component_key",
      "source_label",
      "amount",
      "amount_minor",
      "quantity",
      "source_sheet",
      "formula_present",
      "evidence_status",
      "rule_activated",
      "updated_at",
    ],
  },
  employee_payroll_payments: {
    table: "employee_payroll_payments",
    key: "id",
    columns: [
      "id",
      "employee_id",
      "period_month",
      "legal_entity_name",
      "payment_date",
      "amount",
      "amount_minor",
      "payment_kind",
      "evidence_status",
      "updated_at",
    ],
  },
  payroll_unresolved: {
    table: "payroll_unresolved",
    key: "id",
    columns: [
      "id",
      "source_type",
      "source_label",
      "source_role",
      "period_month",
      "amount",
      "amount_minor",
      "reason",
      "updated_at",
    ],
  },
  alpha_branches: {
    table: "alpha_branches",
    key: "id",
    columns: [
      "id",
      "name",
      "record_state",
      "legal_entity_name",
      "legal_entity_status",
      "updated_at",
    ],
  },
  alpha_students: {
    table: "alpha_students",
    key: "id",
    columns: [
      "id",
      "branch_id",
      "branch_name",
      "full_name",
      "study_status",
      "record_state",
      "group_count",
      "payment_count",
      "lesson_count",
      "updated_at",
    ],
  },
  family_candidates: {
    table: "family_candidates",
    key: "id",
    columns: [
      "id",
      "left_student_id",
      "left_student_name",
      "right_student_id",
      "right_student_name",
      "branch_name",
      "confidence",
      "status",
      "reason_codes_json",
      "updated_at",
    ],
  },
  alpha_groups: {
    table: "alpha_groups",
    key: "id",
    columns: [
      "id",
      "branch_id",
      "branch_name",
      "name",
      "lifecycle_status",
      "record_state",
      "student_count",
      "lesson_count",
      "unit_kind",
      "classification_status",
      "updated_at",
    ],
  },
  alpha_teachers: {
    table: "alpha_teachers",
    key: "id",
    columns: [
      "id",
      "branch_id",
      "branch_name",
      "full_name",
      "teacher_status",
      "record_state",
      "lesson_count",
      "rate_rule_count",
      "working_hour_rule_count",
      "payroll_employee_id_candidate",
      "payroll_match_status",
      "updated_at",
    ],
  },
  alpha_teacher_rates: {
    table: "alpha_teacher_rates",
    key: "id",
    columns: [
      "id",
      "branch_id",
      "branch_name",
      "teacher_id",
      "teacher_name",
      "rate_amount",
      "rate_amount_minor",
      "rate_type",
      "valid_from",
      "valid_to",
      "conditions_json",
      "evidence_status",
      "record_state",
      "updated_at",
    ],
  },
  alpha_lessons: {
    table: "alpha_lessons",
    key: "id",
    columns: [
      "id",
      "branch_id",
      "branch_name",
      "group_id",
      "group_name",
      "teacher_name",
      "lesson_type_name",
      "subject_name",
      "lesson_category",
      "classification_status",
      "lesson_date",
      "title",
      "record_state",
      "attendance_count",
      "updated_at",
    ],
  },
  alpha_payments: {
    table: "alpha_payments",
    key: "id",
    columns: [
      "id",
      "branch_id",
      "branch_name",
      "student_id",
      "student_name",
      "amount",
      "amount_minor",
      "payment_date",
      "payment_type",
      "record_state",
      "updated_at",
    ],
  },
  sync_status: {
    table: "sync_status",
    key: "source",
    columns: [
      "source",
      "status",
      "label",
      "data_mode",
      "last_synced_at",
      "counts_json",
      "details_json",
      "updated_at",
    ],
  },
};
const importDatasetNames = Object.keys(importDatasets);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: jsonHeaders,
  });
}

function safeText(value, maximum = 256) {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function boundedInteger(value, fallback, maximum) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function ownerEmail(request) {
  return (request.headers.get("oai-authenticated-user-email") ?? "")
    .trim()
    .toLowerCase();
}

function isOwner(request, env) {
  const expected = (env.ARTHELLO_OWNER_EMAIL ?? "").trim().toLowerCase();
  return Boolean(expected) && ownerEmail(request) === expected;
}

function requireOwner(request, env) {
  return isOwner(request, env)
    ? null
    : json({ error: "OWNER_AUTH_REQUIRED" }, 403);
}

function requireOwnerAction(request, env) {
  const denied = requireOwner(request, env);
  if (denied) return denied;
  return request.headers.get("x-arthello-action") === "owner-confirmed"
    ? null
    : json({ error: "OWNER_ACTION_HEADER_REQUIRED" }, 403);
}

function requireImportAccess(request, env) {
  const provided = request.headers.get("x-arthello-import-token") ?? "";
  const expected = env.ARTHELLO_IMPORT_TOKEN ?? "";
  return expected.length >= 32 && provided === expected
    ? null
    : json({ error: "IMPORT_AUTH_REQUIRED" }, 403);
}

async function auditSensitiveAccess(
  env,
  action,
  resourceKind,
  outcome = "allowed",
  actorRole = "owner",
) {
  await env.DB.prepare(
    `INSERT INTO sensitive_access_audit (
       id, actor_role, action, resource_kind, outcome, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      actorRole,
      action,
      resourceKind,
      outcome,
      new Date().toISOString(),
    )
    .run();
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function readBody(request, maximumBytes = 750_000) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maximumBytes) throw new Error("payload_too_large");
  const text = await request.text();
  if (text.length > maximumBytes) throw new Error("payload_too_large");
  return JSON.parse(text);
}

function publicationBatchId(value) {
  return typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
    ? value
    : null;
}

function publicationExpectedCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (
    Object.keys(value).length !== importDatasetNames.length ||
    importDatasetNames.some(
      (dataset) =>
        !Object.hasOwn(value, dataset) ||
        !Number.isSafeInteger(value[dataset]) ||
        value[dataset] < 0 ||
        value[dataset] > 1_000_000,
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    importDatasetNames.map((dataset) => [dataset, value[dataset]]),
  );
}

function publicationExpectedDigests(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (
    Object.keys(value).length !== importDatasetNames.length ||
    importDatasetNames.some(
      (dataset) =>
        !Object.hasOwn(value, dataset) ||
        typeof value[dataset] !== "string" ||
        !/^[a-f0-9]{64}$/.test(value[dataset]),
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    importDatasetNames.map((dataset) => [dataset, value[dataset]]),
  );
}

function compareSnapshotText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalSnapshotRow(row) {
  return Object.fromEntries(
    Object.keys(row)
      .sort(compareSnapshotText)
      .map((key) => [key, row[key] ?? null]),
  );
}

async function snapshotDigestFromDatasetDigests(digests) {
  return sha256(
    JSON.stringify(
      importDatasetNames.map((dataset) => [dataset, digests[dataset]]),
    ),
  );
}

async function beginReadModelSnapshot(request, env) {
  const denied = requireImportAccess(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await readBody(request, 50_000);
  } catch {
    return json({ error: "INVALID_IMPORT_PAYLOAD" }, 400);
  }
  const batchId = publicationBatchId(body?.batchId);
  const payloadDigest =
    typeof body?.payloadDigest === "string" &&
    /^[a-f0-9]{64}$/.test(body.payloadDigest)
      ? body.payloadDigest
      : null;
  const expectedCounts = publicationExpectedCounts(body?.expectedCounts);
  const expectedDigests = publicationExpectedDigests(body?.expectedDigests);
  if (!batchId || !payloadDigest || !expectedCounts || !expectedDigests) {
    return json({ error: "INVALID_SNAPSHOT_MANIFEST" }, 400);
  }
  if (
    payloadDigest !== (await snapshotDigestFromDatasetDigests(expectedDigests))
  ) {
    return json({ error: "SNAPSHOT_DIGEST_MISMATCH" }, 409);
  }
  const expectedCountsJson = JSON.stringify(expectedCounts);
  const expectedDigestsJson = JSON.stringify(expectedDigests);
  const existing = await env.DB.prepare(
    `SELECT
       status, payload_digest, expected_counts_json, expected_digests_json
     FROM read_model_publication_batches
     WHERE id = ?`,
  )
    .bind(batchId)
    .first();
  if (existing) {
    if (
      existing.status === "staging" &&
      existing.payload_digest === payloadDigest &&
      existing.expected_counts_json === expectedCountsJson &&
      existing.expected_digests_json === expectedDigestsJson
    ) {
      return json({ ok: true, batchId, status: "staging" });
    }
    return json({ error: "SNAPSHOT_BATCH_CONFLICT" }, 409);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE read_model_publication_batches
         SET status = 'abandoned', updated_at = ?
         WHERE status IN ('staging', 'verifying')`,
      ).bind(now),
      env.DB.prepare(
        `DELETE FROM read_model_staging_rows
         WHERE batch_id IN (
           SELECT id FROM read_model_publication_batches
           WHERE status IN ('abandoned', 'superseded')
         )`,
      ),
      env.DB.prepare(
        `INSERT INTO read_model_publication_batches (
           id, status, payload_digest, expected_counts_json,
           expected_digests_json, computed_digest,
           created_at, updated_at, committed_at
         ) VALUES (?, 'staging', ?, ?, ?, NULL, ?, ?, NULL)`,
      ).bind(
        batchId,
        payloadDigest,
        expectedCountsJson,
        expectedDigestsJson,
        now,
        now,
      ),
    ]);
    return json({ ok: true, batchId, status: "staging" });
  } catch {
    return json({ error: "SNAPSHOT_BEGIN_FAILED" }, 500);
  }
}

async function stageReadModelDataset(request, env, batchIdValue, datasetName) {
  const denied = requireImportAccess(request, env);
  if (denied) return denied;
  const batchId = publicationBatchId(batchIdValue);
  const definition = importDatasets[datasetName];
  if (!batchId || !definition) {
    return json({ error: "UNKNOWN_SNAPSHOT_TARGET" }, 404);
  }
  const batch = await env.DB.prepare(
    `SELECT status
     FROM read_model_publication_batches
     WHERE id = ?`,
  )
    .bind(batchId)
    .first();
  if (batch?.status !== "staging") {
    return json({ error: "SNAPSHOT_NOT_STAGING" }, 409);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: "INVALID_IMPORT_PAYLOAD" }, 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray(body.rows) ||
    body.rows.length > 100 ||
    typeof body.replace !== "boolean"
  ) {
    return json({ error: "INVALID_IMPORT_PAYLOAD" }, 400);
  }

  const statements = [
    env.DB.prepare(
      `SELECT CASE
         WHEN EXISTS (
           SELECT 1
           FROM read_model_publication_batches
           WHERE id = ? AND status = 'staging'
         ) THEN 1
         ELSE json_extract('invalid_snapshot_state', '$')
       END AS stage_guard`,
    ).bind(batchId),
  ];
  if (body.replace) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM read_model_staging_rows
         WHERE batch_id = ? AND dataset_name = ?`,
      ).bind(batchId, datasetName),
    );
  }
  const sql = `INSERT INTO read_model_staging_rows (
      batch_id, dataset_name, row_key, row_json
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(batch_id, dataset_name, row_key)
    DO UPDATE SET row_json = excluded.row_json`;
  for (const row of body.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return json({ error: "INVALID_IMPORT_ROW" }, 400);
    }
    const projected = {};
    for (const column of definition.columns) {
      const value = row[column];
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number"
      ) {
        projected[column] = value;
        continue;
      }
      return json({ error: "INVALID_IMPORT_ROW" }, 400);
    }
    const keyValue = projected[definition.key];
    if (
      (typeof keyValue !== "string" && typeof keyValue !== "number") ||
      String(keyValue).length < 1 ||
      String(keyValue).length > 512
    ) {
      return json({ error: "IMPORT_KEY_REQUIRED" }, 400);
    }
    statements.push(
      env.DB.prepare(sql).bind(
        batchId,
        datasetName,
        String(keyValue),
        JSON.stringify(projected),
      ),
    );
  }
  try {
    if (statements.length) await env.DB.batch(statements);
    return json({
      ok: true,
      batchId,
      dataset: datasetName,
      staged: body.rows.length,
    });
  } catch {
    return json({ error: "SNAPSHOT_STAGE_FAILED" }, 500);
  }
}

async function commitReadModelSnapshot(request, env, batchIdValue) {
  const denied = requireImportAccess(request, env);
  if (denied) return denied;
  const batchId = publicationBatchId(batchIdValue);
  if (!batchId) return json({ error: "UNKNOWN_SNAPSHOT_TARGET" }, 404);
  const batch = await env.DB.prepare(
    `SELECT
       status, payload_digest, expected_counts_json, expected_digests_json,
       computed_digest, committed_at
     FROM read_model_publication_batches
     WHERE id = ?`,
  )
    .bind(batchId)
    .first();
  if (!batch) return json({ error: "SNAPSHOT_NOT_FOUND" }, 404);
  if (batch.status === "active") {
    if (!/^[a-f0-9]{64}$/.test(batch.computed_digest ?? "")) {
      return json({ error: "SNAPSHOT_ATTESTATION_MISSING" }, 409);
    }
    return json({
      ok: true,
      batchId,
      status: "active",
      payloadDigest: batch.computed_digest,
      counts: parseJsonObject(batch.expected_counts_json),
      committedAt: batch.committed_at,
    });
  }
  if (batch.status !== "staging") {
    return json({ error: "SNAPSHOT_NOT_STAGING" }, 409);
  }

  const expectedCounts = publicationExpectedCounts(
    parseJsonObject(batch.expected_counts_json),
  );
  const expectedDigests = publicationExpectedDigests(
    parseJsonObject(batch.expected_digests_json),
  );
  if (!expectedCounts || !expectedDigests) {
    return json({ error: "SNAPSHOT_MANIFEST_INVALID" }, 409);
  }
  const claimed = await env.DB.prepare(
    `UPDATE read_model_publication_batches
     SET status = 'verifying', updated_at = ?
     WHERE id = ? AND status = 'staging'`,
  )
    .bind(new Date().toISOString(), batchId)
    .run();
  if (Number(claimed.meta?.changes ?? 0) !== 1) {
    return json({ error: "SNAPSHOT_NOT_STAGING" }, 409);
  }
  const staged = await env.DB.prepare(
    `SELECT dataset_name, COUNT(*) AS count
     FROM read_model_staging_rows
     WHERE batch_id = ?
     GROUP BY dataset_name`,
  )
    .bind(batchId)
    .all();
  const stagedCounts = Object.fromEntries(
    importDatasetNames.map((dataset) => [dataset, 0]),
  );
  for (const row of staged.results ?? []) {
    if (Object.hasOwn(stagedCounts, row.dataset_name)) {
      stagedCounts[row.dataset_name] = Number(row.count ?? 0);
    }
  }
  for (const dataset of importDatasetNames) {
    if (stagedCounts[dataset] !== expectedCounts[dataset]) {
      return json(
        {
          error: "SNAPSHOT_COUNT_MISMATCH",
          dataset,
          expected: expectedCounts[dataset],
          staged: stagedCounts[dataset],
        },
        409,
      );
    }
  }

  const computedDigests = {};
  for (const dataset of importDatasetNames) {
    const definition = importDatasets[dataset];
    const pairs = [];
    let offset = 0;
    while (true) {
      const page = await env.DB.prepare(
        `SELECT row_key, row_json
         FROM read_model_staging_rows
         WHERE batch_id = ? AND dataset_name = ?
         ORDER BY row_key
         LIMIT 500 OFFSET ?`,
      )
        .bind(batchId, dataset, offset)
        .all();
      const rows = page.results ?? [];
      for (const stagedRow of rows) {
        let parsed;
        try {
          parsed = JSON.parse(stagedRow.row_json);
        } catch {
          return json({ error: "SNAPSHOT_STAGED_ROW_INVALID", dataset }, 409);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return json({ error: "SNAPSHOT_STAGED_ROW_INVALID", dataset }, 409);
        }
        const projected = {};
        for (const column of definition.columns) {
          const value = parsed[column];
          if (
            value !== null &&
            typeof value !== "string" &&
            typeof value !== "number"
          ) {
            return json({ error: "SNAPSHOT_STAGED_ROW_INVALID", dataset }, 409);
          }
          projected[column] = value;
        }
        if (String(projected[definition.key]) !== String(stagedRow.row_key)) {
          return json({ error: "SNAPSHOT_STAGED_KEY_MISMATCH", dataset }, 409);
        }
        pairs.push([
          String(stagedRow.row_key),
          await sha256(JSON.stringify(canonicalSnapshotRow(projected))),
        ]);
      }
      if (rows.length < 500) break;
      offset += rows.length;
    }
    pairs.sort((left, right) => compareSnapshotText(left[0], right[0]));
    computedDigests[dataset] = await sha256(JSON.stringify(pairs));
    if (computedDigests[dataset] !== expectedDigests[dataset]) {
      return json({ error: "SNAPSHOT_DATASET_DIGEST_MISMATCH", dataset }, 409);
    }
  }
  const computedDigest =
    await snapshotDigestFromDatasetDigests(computedDigests);
  if (computedDigest !== batch.payload_digest) {
    return json({ error: "SNAPSHOT_DIGEST_MISMATCH" }, 409);
  }

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `SELECT CASE
         WHEN EXISTS (
           SELECT 1
           FROM read_model_publication_batches
           WHERE id = ? AND status = 'verifying'
         ) THEN 1
         ELSE json_extract('invalid_snapshot_state', '$')
       END AS commit_guard`,
    ).bind(batchId),
    env.DB.prepare(
      `UPDATE read_model_publication_batches
       SET status = 'superseded', updated_at = ?
       WHERE status = 'active' AND id <> ?`,
    ).bind(now, batchId),
  ];
  for (const [datasetName, definition] of Object.entries(importDatasets)) {
    const selectors = definition.columns
      .map((column) => `json_extract(row_json, '$.${column}')`)
      .join(", ");
    statements.push(env.DB.prepare(`DELETE FROM ${definition.table}`));
    statements.push(
      env.DB.prepare(
        `INSERT INTO ${definition.table} (${definition.columns.join(", ")})
         SELECT ${selectors}
         FROM read_model_staging_rows
         WHERE batch_id = ? AND dataset_name = ?
         ORDER BY row_key`,
      ).bind(batchId, datasetName),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE read_model_publication_batches
       SET
         status = 'active',
         computed_digest = ?,
         updated_at = ?,
         committed_at = ?
       WHERE id = ? AND status = 'verifying'`,
    ).bind(computedDigest, now, now, batchId),
    env.DB.prepare(
      `INSERT INTO sensitive_access_audit (
         id, actor_role, action, resource_kind, outcome, occurred_at
       ) VALUES (?, 'system', 'read_model_snapshot_commit',
         'all_datasets', 'allowed', ?)`,
    ).bind(crypto.randomUUID(), now),
    env.DB.prepare(
      `DELETE FROM read_model_staging_rows
       WHERE batch_id = ?`,
    ).bind(batchId),
  );
  try {
    await env.DB.batch(statements);
    return json({
      ok: true,
      batchId,
      status: "active",
      payloadDigest: computedDigest,
      counts: expectedCounts,
      committedAt: now,
    });
  } catch {
    return json({ error: "SNAPSHOT_COMMIT_FAILED" }, 500);
  }
}

async function listEmployees(url, env) {
  const query = (url.searchParams.get("query") ?? "").trim().slice(0, 100);
  const limit = boundedInteger(url.searchParams.get("limit"), 50, 100);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);
  const pattern = `%${query}%`;
  const where = query ? "WHERE e.full_name LIKE ? ESCAPE '\\'" : "";
  const bindings = query ? [pattern] : [];
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM employees e ${where}`,
  )
    .bind(...bindings)
    .first();
  const result = await env.DB.prepare(
    `SELECT
       e.id,
       e.full_name,
       e.primary_role,
       e.classification_status,
       COUNT(p.id) AS period_count,
       CASE
         WHEN SUM(
           CASE
             WHEN p.id IS NOT NULL AND p.accrued_amount_minor IS NULL
             THEN 1 ELSE 0
           END
         ) > 0
         THEN NULL
         ELSE COALESCE(SUM(p.accrued_amount_minor), 0)
       END AS accrued_total_minor,
       CASE
         WHEN SUM(
           CASE
             WHEN p.id IS NOT NULL AND p.paid_amount_minor IS NULL
             THEN 1 ELSE 0
           END
         ) > 0
         THEN NULL
         ELSE COALESCE(SUM(p.paid_amount_minor), 0)
       END AS paid_total_minor,
       MAX(p.period_month) AS latest_period
     FROM employees e
     LEFT JOIN employee_payroll_monthly p ON p.employee_id = e.id
     ${where}
     GROUP BY e.id
     ORDER BY e.full_name
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, limit, offset)
    .all();
  return json({
    dataMode: "real_owner_provided_source",
    total: Number(count?.count ?? 0),
    rows: result.results ?? [],
  });
}

async function employeePayroll(url, env) {
  const employeeId = safeText(url.searchParams.get("employee_id"), 80);
  if (!employeeId) return json({ error: "EMPLOYEE_ID_REQUIRED" }, 400);
  const [monthly, components, payments] = await env.DB.batch([
    env.DB.prepare(
      `SELECT
         id,
         period_month,
         accrued_amount_minor,
         paid_amount_minor,
         accrual_rows,
         payment_rows,
         evidence_status,
         legal_entity_name
       FROM employee_payroll_monthly
       WHERE employee_id = ?
       ORDER BY period_month DESC, legal_entity_name`,
    ).bind(employeeId),
    env.DB.prepare(
      `SELECT
         id,
         period_month,
         legal_entity_name,
         component_key,
         source_label,
         amount_minor,
         quantity,
         source_sheet,
         formula_present,
         evidence_status,
         rule_activated
       FROM employee_payroll_components
       WHERE employee_id = ?
       ORDER BY period_month DESC, source_label, id`,
    ).bind(employeeId),
    env.DB.prepare(
      `SELECT
         id,
         period_month,
         legal_entity_name,
         payment_date,
         amount_minor,
         payment_kind,
         evidence_status
       FROM employee_payroll_payments
       WHERE employee_id = ?
       ORDER BY period_month DESC, payment_date DESC, id`,
    ).bind(employeeId),
  ]);
  return json({
    dataMode: "real_owner_provided_source",
    rows: monthly.results ?? [],
    components: components.results ?? [],
    payments: payments.results ?? [],
    money: {
      storageMode: "integer_minor_units",
      scale: 2,
      financialCalculationsEnabled: false,
    },
    taxCoverage: {
      status: "not_sourced",
      normalizedRows: 0,
      assumptionsApplied: false,
    },
  });
}

async function listRows(url, env, kind) {
  const definitions = {
    students: {
      table: "alpha_students",
      name: "full_name",
      order: "full_name",
    },
    families: {
      table: "family_candidates",
      name: "left_student_name || ' ' || right_student_name",
      order: "updated_at DESC",
    },
    groups: { table: "alpha_groups", name: "name", order: "name" },
    teachers: {
      table: "alpha_teachers",
      name: "full_name",
      order: "full_name",
    },
    teacher_rates: {
      table: "alpha_teacher_rates",
      name: "COALESCE(teacher_name, '') || ' ' || COALESCE(rate_type, '')",
      order: "teacher_name, valid_from DESC",
    },
    lessons: {
      table: "alpha_lessons",
      name: "COALESCE(title, '') || ' ' || COALESCE(group_name, '')",
      order: "lesson_date DESC",
    },
    payments: {
      table: "alpha_payments",
      name: "COALESCE(student_name, '') || ' ' || COALESCE(payment_type, '')",
      order: "payment_date DESC",
    },
  };
  const definition = definitions[kind];
  if (!definition) return json({ error: "UNKNOWN_DATASET" }, 404);
  const query = (url.searchParams.get("query") ?? "").trim().slice(0, 100);
  const limit = boundedInteger(url.searchParams.get("limit"), 50, 100);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 100_000);
  const filters = [];
  const bindings = [];
  if (query) {
    filters.push(`${definition.name} LIKE ?`);
    bindings.push(`%${query}%`);
  }
  if (
    kind === "lessons" &&
    url.searchParams.get("lesson_category") === "extra_candidate"
  ) {
    filters.push("lesson_category = ?");
    bindings.push("extra_candidate");
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM ${definition.table} ${where}`,
  )
    .bind(...bindings)
    .first();
  const result = await env.DB.prepare(
    `SELECT * FROM ${definition.table}
     ${where}
     ORDER BY ${definition.order}
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, limit, offset)
    .all();
  return json({
    dataMode: "real_alfacrm_read_only",
    total: Number(count?.count ?? 0),
    rows: result.results ?? [],
  });
}

async function ownerSummary(env) {
  const statements = [
    "SELECT COUNT(*) AS count FROM employees",
    "SELECT COUNT(*) AS count FROM employee_payroll_monthly",
    "SELECT COUNT(*) AS count FROM employee_payroll_components",
    "SELECT COUNT(*) AS count FROM employee_payroll_payments",
    "SELECT COUNT(*) AS count FROM payroll_unresolved",
    "SELECT COUNT(*) AS count FROM alpha_branches WHERE record_state = 'current'",
    "SELECT COUNT(*) AS count FROM alpha_students WHERE record_state = 'current'",
    "SELECT COUNT(*) AS count FROM family_candidates WHERE status = 'pending_review'",
    "SELECT COUNT(*) AS count FROM alpha_groups WHERE record_state = 'current'",
    "SELECT COUNT(*) AS count FROM alpha_teachers WHERE record_state = 'current'",
    "SELECT COUNT(*) AS count FROM alpha_teacher_rates WHERE record_state = 'current'",
    "SELECT COUNT(*) AS count FROM alpha_lessons WHERE record_state = 'current'",
    "SELECT COUNT(*) AS count FROM alpha_lessons WHERE record_state = 'current' AND lesson_category = 'extra_candidate'",
    "SELECT COUNT(*) AS count FROM alpha_payments WHERE record_state = 'current'",
    "SELECT COUNT(*) AS count FROM bank_accounts",
    "SELECT source, status, label, data_mode, last_synced_at, counts_json, details_json FROM sync_status ORDER BY source",
    `SELECT id, status, computed_digest, committed_at
     FROM read_model_publication_batches
     WHERE status = 'active'
     ORDER BY committed_at DESC
     LIMIT 1`,
  ].map((sql) => env.DB.prepare(sql));
  const results = await env.DB.batch(statements);
  const countAt = (index) => Number(results[index]?.results?.[0]?.count ?? 0);
  const publication = results[16]?.results?.[0] ?? null;
  return json({
    dataMode: "owner_only_real_sources",
    money: {
      storageMode: "integer_minor_units",
      scale: 2,
      financialCalculationsEnabled: false,
    },
    counts: {
      employees: countAt(0),
      payrollPeriods: countAt(1),
      payrollComponents: countAt(2),
      payrollPayments: countAt(3),
      payrollUnresolved: countAt(4),
      branches: countAt(5),
      students: countAt(6),
      familyCandidates: countAt(7),
      groups: countAt(8),
      teachers: countAt(9),
      teacherRates: countAt(10),
      lessons: countAt(11),
      extraLessonCandidates: countAt(12),
      payments: countAt(13),
      bankAccounts: countAt(14),
    },
    sources: (results[15]?.results ?? []).map((row) => ({
      ...row,
      counts: parseJsonObject(row.counts_json),
      details: parseJsonObject(row.details_json),
      counts_json: undefined,
      details_json: undefined,
    })),
    publication: {
      activeBatchId: publication?.id ?? null,
      status: publication?.status ?? "not_published",
      payloadDigest: publication?.computed_digest ?? null,
      committedAt: publication?.committed_at ?? null,
      atomicSnapshot: Boolean(publication?.id && publication?.computed_digest),
      attestationStatus:
        publication?.id && publication?.computed_digest
          ? "atomic_attested"
          : "legacy_unattested",
    },
  });
}

async function adminReadModelStatus(env) {
  const datasets = Object.entries(importDatasets);
  const statements = [
    ...datasets.map(([, definition]) =>
      env.DB.prepare(`SELECT COUNT(*) AS count FROM ${definition.table}`),
    ),
    env.DB.prepare(
      `SELECT status, last_synced_at, last_error_code, updated_at
       FROM bank_connector_state
       WHERE id = 'tochka'`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM bank_accounts
       WHERE connector_id = 'tochka'`,
    ),
    env.DB.prepare(
      `SELECT source, status, last_synced_at
       FROM sync_status
       ORDER BY source`,
    ),
    env.DB.prepare(
      `SELECT id, status, computed_digest, committed_at
       FROM read_model_publication_batches
       WHERE status = 'active'
       ORDER BY committed_at DESC
       LIMIT 1`,
    ),
  ];
  const moneyStatements = [
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM employee_payroll_monthly
       WHERE accrued_amount_minor IS NULL OR paid_amount_minor IS NULL`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM employee_payroll_components
       WHERE amount_minor IS NULL`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM employee_payroll_payments
       WHERE amount_minor IS NULL`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM payroll_unresolved
       WHERE amount_minor IS NULL`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM alpha_teacher_rates
       WHERE rate_amount IS NOT NULL AND rate_amount_minor IS NULL`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM alpha_payments
       WHERE amount IS NOT NULL AND amount_minor IS NULL`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM bank_accounts
       WHERE current_balance IS NOT NULL AND current_balance_minor IS NULL`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM employee_payroll_monthly
       WHERE CAST(ROUND(accrued_amount * 100) AS INTEGER) <> accrued_amount_minor
          OR CAST(ROUND(paid_amount * 100) AS INTEGER) <> paid_amount_minor`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM employee_payroll_components
       WHERE CAST(ROUND(amount * 100) AS INTEGER) <> amount_minor`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM employee_payroll_payments
       WHERE CAST(ROUND(amount * 100) AS INTEGER) <> amount_minor`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM payroll_unresolved
       WHERE CAST(ROUND(amount * 100) AS INTEGER) <> amount_minor`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM alpha_teacher_rates
       WHERE rate_amount IS NOT NULL
         AND CAST(ROUND(rate_amount * 100) AS INTEGER) <> rate_amount_minor`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM alpha_payments
       WHERE amount IS NOT NULL
         AND CAST(ROUND(amount * 100) AS INTEGER) <> amount_minor`,
    ),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM bank_accounts
       WHERE current_balance IS NOT NULL
         AND CAST(ROUND(current_balance * 100) AS INTEGER) <> current_balance_minor`,
    ),
  ];
  const results = await env.DB.batch(statements);
  const moneyResults = await env.DB.batch(moneyStatements);
  const connectorIndex = datasets.length;
  const accountsIndex = connectorIndex + 1;
  const sourcesIndex = connectorIndex + 2;
  const publicationIndex = connectorIndex + 3;
  const publication = results[publicationIndex]?.results?.[0] ?? null;
  const sumMoneyCounts = (start, end) =>
    moneyResults
      .slice(start, end)
      .reduce(
        (total, result) => total + Number(result?.results?.[0]?.count ?? 0),
        0,
      );
  return json({
    dataMode: "aggregate_owner_control_status",
    money: {
      storageMode: "integer_minor_units",
      scale: 2,
      financialCalculationsEnabled: false,
      missingMinorRows: sumMoneyCounts(0, 7),
      legacyReconciliationMismatches: sumMoneyCounts(7, 14),
    },
    datasets: Object.fromEntries(
      datasets.map(([name], index) => [
        name,
        Number(results[index]?.results?.[0]?.count ?? 0),
      ]),
    ),
    banking: {
      configured: Boolean(
        env.TOCHKA_CLIENT_ID &&
        env.TOCHKA_CLIENT_SECRET &&
        env.TOCHKA_OAUTH_REDIRECT_URI,
      ),
      status: results[connectorIndex]?.results?.[0]?.status ?? "not_started",
      accountCount: Number(results[accountsIndex]?.results?.[0]?.count ?? 0),
      lastSyncedAt:
        results[connectorIndex]?.results?.[0]?.last_synced_at ?? null,
      lastErrorCode:
        results[connectorIndex]?.results?.[0]?.last_error_code ?? null,
      updatedAt: results[connectorIndex]?.results?.[0]?.updated_at ?? null,
      scopeMode: "read_only",
      paymentActionsEnabled: false,
    },
    sources: results[sourcesIndex]?.results ?? [],
    publication: {
      activeBatchId: publication?.id ?? null,
      status: publication?.status ?? "not_published",
      payloadDigest: publication?.computed_digest ?? null,
      committedAt: publication?.committed_at ?? null,
      atomicSnapshot: Boolean(publication?.id && publication?.computed_digest),
      attestationStatus:
        publication?.id && publication?.computed_digest
          ? "atomic_attested"
          : "legacy_unattested",
    },
  });
}

function randomHex(bytes) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function vaultKey(env) {
  const raw = base64ToBytes(env.ARTHELLO_VAULT_KEY ?? "");
  if (raw.length !== 32) throw new Error("vault_not_configured");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function sealTokens(value, env) {
  const key = await vaultKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cleartext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    cleartext,
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function unsealTokens(value, env) {
  const [version, ivValue, encryptedValue] = String(value ?? "").split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) {
    throw new Error("vault_payload_invalid");
  }
  const key = await vaultKey(env);
  const cleartext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivValue) },
    key,
    base64ToBytes(encryptedValue),
  );
  return JSON.parse(new TextDecoder().decode(cleartext));
}

async function hmacHex(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function webflowIngressToken(env) {
  const raw = base64ToBytes(env.ARTHELLO_VAULT_KEY ?? "");
  if (raw.length !== 32) throw new Error("vault_not_configured");
  return hmacHex(raw, "ARTHELLO:front-office:webflow-ingress:v1");
}

function constantTimeEqualHex(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length ||
    left.length % 2 !== 0 ||
    !/^[a-f0-9]+$/i.test(left) ||
    !/^[a-f0-9]+$/i.test(right)
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 2) {
    difference |=
      Number.parseInt(left.slice(index, index + 2), 16) ^
      Number.parseInt(right.slice(index, index + 2), 16);
  }
  return difference === 0;
}

function leadRetentionDays(env) {
  const value = Number(env.ARTHELLO_LEAD_RETENTION_DAYS);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : null;
}

function normalizedFieldKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function scalarText(value, maximum) {
  if (!["string", "number"].includes(typeof value)) return null;
  const result = String(value).trim();
  return result && result.length <= maximum ? result : null;
}

function formValue(fields, keys, maximum = 256) {
  const normalized = new Map(
    Object.entries(fields ?? {}).map(([key, value]) => [
      normalizedFieldKey(key),
      value,
    ]),
  );
  for (const key of keys) {
    const value = scalarText(normalized.get(normalizedFieldKey(key)), maximum);
    if (value) return value;
  }
  return null;
}

function maskedPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `+${digits.slice(0, Math.min(1, digits.length - 4))} ••• •••-${digits.slice(-4)}`;
}

function maskedEmail(value) {
  const [local, domain] = String(value ?? "")
    .trim()
    .split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}•••@${domain}`;
}

function formLooksLikeSchool(formName, fields) {
  const relevantValues = [
    formName,
    formValue(fields, ["направление", "программа", "service"], 160),
  ]
    .filter(Boolean)
    .join(" ");
  return /(школа|school|1\s*[-–—]?\s*11)/i.test(relevantValues);
}

async function boundedJsonBody(request, maximum = 64 * 1024) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximum) {
    return { error: "PAYLOAD_TOO_LARGE" };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maximum) {
    return { error: "PAYLOAD_TOO_LARGE" };
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch {
    return { error: "INVALID_JSON" };
  }
}

async function connectorStatus(request, env) {
  const [states, counts] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, status, external_account_id, last_event_at,
              last_error_code, updated_at
       FROM front_office_connector_state
       WHERE project_id = 'ARTHELLO'`,
    ),
    env.DB.prepare(
      `SELECT connector_id, COUNT(*) AS event_count
       FROM front_office_inbound_events
       WHERE project_id = 'ARTHELLO'
       GROUP BY connector_id`,
    ),
  ]);
  const stateById = Object.fromEntries(
    (states.results ?? []).map((row) => [row.id, row]),
  );
  const countById = Object.fromEntries(
    (counts.results ?? []).map((row) => [
      row.connector_id,
      Number(row.event_count ?? 0),
    ]),
  );
  const site = stateById["site-webflow"] ?? {
    status: "not_started",
    external_account_id: null,
    last_event_at: null,
    last_error_code: null,
    updated_at: null,
  };
  let webhookUrl = null;
  if (site.status !== "not_started") {
    webhookUrl = `${new URL(request.url).origin}/api/webhooks/arthello/webflow/${await webflowIngressToken(env)}`;
  }
  return json({
    projectId: "ARTHELLO",
    mode: "REAL_INBOUND_MANUAL_REPLY",
    outboundEnabled: false,
    retentionDays: leadRetentionDays(env),
    connectors: {
      site: {
        status: site.status,
        externalAccountId: site.external_account_id,
        eventCount: countById["site-webflow"] ?? 0,
        lastEventAt: site.last_event_at,
        lastErrorCode: site.last_error_code,
        webhookUrl,
      },
      telegram: {
        status: "waiting_manual_reply_path",
        eventCount: 0,
      },
      "vk-messages": {
        status: "planned_next",
        eventCount: 0,
      },
    },
  });
}

async function startWebflowPilot(request, env) {
  const denied = requireOwnerAction(request, env);
  if (denied) return denied;
  const retentionDays = leadRetentionDays(env);
  if (!retentionDays) {
    return json({ error: "RETENTION_POLICY_REQUIRED" }, 409);
  }
  const now = new Date().toISOString();
  const webhookUrl = `${new URL(request.url).origin}/api/webhooks/arthello/webflow/${await webflowIngressToken(env)}`;
  await env.DB.prepare(
    `INSERT INTO front_office_connector_state (
       id, project_id, status, external_account_id, last_event_at,
       last_error_code, created_at, updated_at
     ) VALUES ('site-webflow', 'ARTHELLO', 'awaiting_test', NULL, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = CASE
         WHEN front_office_connector_state.status = 'active' THEN 'active'
         ELSE 'awaiting_test'
       END,
       last_error_code = NULL,
       updated_at = excluded.updated_at`,
  )
    .bind(now, now)
    .run();
  return json({
    ok: true,
    connectorId: "site",
    status: "awaiting_test",
    webhookUrl,
    setup: {
      destination: "Webflow form webhook",
      action: "paste_url_and_submit_test_form",
    },
    retentionDays,
    outboundEnabled: false,
  });
}

async function handleWebflowLead(request, env, providedToken) {
  if (!leadRetentionDays(env)) {
    return json({ error: "RETENTION_POLICY_REQUIRED" }, 503);
  }
  let expectedToken;
  try {
    expectedToken = await webflowIngressToken(env);
  } catch {
    return json({ error: "INGRESS_NOT_CONFIGURED" }, 503);
  }
  if (!constantTimeEqualHex(providedToken, expectedToken)) {
    return json({ error: "WEBHOOK_AUTH_FAILED" }, 403);
  }

  const connector = await env.DB.prepare(
    `SELECT status, external_account_id
     FROM front_office_connector_state
     WHERE id = 'site-webflow' AND project_id = 'ARTHELLO'`,
  ).first();
  if (!connector || !["awaiting_test", "active"].includes(connector.status)) {
    return json({ error: "CONNECTOR_NOT_STARTED" }, 503);
  }

  const parsed = await boundedJsonBody(request);
  if (parsed.error) {
    return json(
      { error: parsed.error },
      parsed.error === "PAYLOAD_TOO_LARGE" ? 413 : 400,
    );
  }
  const event = parsed.value;
  const payload = event?.payload;
  if (
    event?.triggerType !== "form_submission" ||
    !payload ||
    typeof payload !== "object" ||
    !payload.data ||
    typeof payload.data !== "object"
  ) {
    return json({ error: "UNSUPPORTED_WEBFLOW_EVENT" }, 400);
  }

  const externalEventId = scalarText(payload.id, 160);
  const siteId = scalarText(payload.siteId, 160);
  const formId = scalarText(payload.formId, 160) ?? "unknown-form";
  const formName = scalarText(payload.name, 160) ?? "Форма сайта";
  if (!externalEventId || !siteId) {
    return json({ error: "WEBFLOW_EVENT_ID_REQUIRED" }, 400);
  }
  if (
    connector.external_account_id &&
    connector.external_account_id !== siteId
  ) {
    return json({ error: "WEBFLOW_SITE_MISMATCH" }, 409);
  }

  const fields = payload.data;
  const name =
    formValue(fields, ["имя", "name", "first name", "ваше имя"], 160) ??
    "Новый контакт с сайта";
  const phone = formValue(
    fields,
    ["номер телефона", "телефон", "phone", "phone number"],
    80,
  );
  const email = formValue(
    fields,
    ["email", "e mail", "электронная почта"],
    254,
  );
  const message = formValue(
    fields,
    ["сообщение", "message", "комментарий", "comment", "вопрос"],
    4000,
  );
  if (!phone && !email && !message) {
    return json({ error: "EMPTY_LEAD" }, 400);
  }
  const program = formValue(
    fields,
    ["программа", "направление", "service", "услуга"],
    180,
  );
  const branch = formValue(fields, ["филиал", "branch", "адрес", "район"], 180);
  const utmSource = formValue(fields, ["utm source", "utm_source"], 120);
  const utmCampaign = formValue(fields, ["utm campaign", "utm_campaign"], 160);
  const schoolRoute = formLooksLikeSchool(formName, fields);
  const submittedAtValue = Date.parse(String(payload.submittedAt ?? ""));
  const submittedAt = Number.isFinite(submittedAtValue)
    ? new Date(submittedAtValue).toISOString()
    : new Date().toISOString();
  const identitySeed = `ARTHELLO|site-webflow|${siteId}|${formId}|${externalEventId}`;
  const identity = await sha256(identitySeed);
  const eventId = `evt_${identity.slice(0, 32)}`;
  const conversationId = `conv_${identity.slice(0, 32)}`;
  const leadId = `lead_${identity.slice(0, 32)}`;
  const messageId = `msg_${identity.slice(0, 32)}`;
  const auditId = `audit_${identity.slice(0, 32)}`;
  const contactMasked =
    maskedPhone(phone) ?? maskedEmail(email) ?? "Контакт не указан";
  const sealedContact =
    phone || email
      ? await sealTokens(
          {
            phone: phone ?? null,
            email: email ?? null,
          },
          env,
        )
      : null;
  const source = `Сайт · ${formName}`;
  const messageBody =
    message ?? "Контакт оставил заявку без текстового комментария.";
  const campaign = [utmSource, utmCampaign].filter(Boolean).join(" · ") || null;
  const rawHash = await sha256(parsed.raw);
  const requestId =
    safeText(request.headers.get("cf-ray"), 128) ??
    `webflow-${identity.slice(0, 16)}`;

  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO front_office_inbound_events (
         id, project_id, connector_id, external_event_id, payload_hash,
         processing_status, received_at
       ) VALUES (?, 'ARTHELLO', 'site-webflow', ?, ?, 'accepted', ?)`,
    ).bind(eventId, externalEventId, rawHash, submittedAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO front_office_conversations (
         id, project_id, external_key, kind, channel, status, priority,
         contact_display_name, contact_point_masked, sealed_contact,
         identity_status, intent, service, branch_or_object, owner_role,
         owner_display_name, last_message_at, due_at, next_action_at,
         is_synthetic, version, created_at, updated_at
       ) VALUES (
         ?, 'ARTHELLO', ?, 'lead', 'Сайт', 'open', 'P3', ?, ?, ?,
         'not_required', ?, ?, ?, ?, NULL, ?, NULL, NULL, 0, 1, ?, ?
       )`,
    ).bind(
      conversationId,
      `webflow:${siteId}:${formId}:${externalEventId}`,
      name,
      contactMasked,
      sealedContact,
      schoolRoute ? "Заявка в отдельный контур школы" : "Первичная заявка",
      program,
      schoolRoute ? "SCHOOL_1_11_QUEUE" : branch,
      schoolRoute ? "SCHOOL_SUPPORT_ROUTER" : "SALES_MANAGER",
      submittedAt,
      submittedAt,
      submittedAt,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO front_office_leads (
         id, conversation_id, stage, source, campaign, child_age_band,
         branch_preference, program_interest, owner_display_name,
         next_action, next_action_at, trial_status, is_synthetic, version,
         created_at, updated_at
       ) VALUES (
         ?, ?, 'NEW', ?, ?, NULL, ?, ?, NULL, NULL, NULL,
         'not_requested', 0, 1, ?, ?
       )`,
    ).bind(
      leadId,
      conversationId,
      source,
      campaign,
      branch,
      program,
      submittedAt,
      submittedAt,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO front_office_messages (
         id, conversation_id, message_type, direction, body, author_role,
         author_display_name, fact_status, source_refs_json, is_synthetic,
         created_at
       ) VALUES (
         ?, ?, 'incoming', 'incoming', ?, 'customer', ?, 'UNVERIFIED',
         ?, 0, ?
       )`,
    ).bind(
      messageId,
      conversationId,
      messageBody,
      name,
      JSON.stringify([`webflow:${siteId}:${formId}:${externalEventId}`]),
      submittedAt,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO front_office_audit_events (
         id, entity_type, entity_id, action, actor_role, actor_display_name,
         after_state_json, request_id, created_at
       ) VALUES (?, 'lead', ?, 'inbound_lead_created', 'channel_webhook',
                 'Webflow', ?, ?, ?)`,
    ).bind(
      auditId,
      leadId,
      JSON.stringify({
        projectId: "ARTHELLO",
        connectorId: "site-webflow",
        route: schoolRoute ? "school_1_11_queue" : "sales_manager_queue",
        outboundEnabled: false,
      }),
      requestId,
      submittedAt,
    ),
    env.DB.prepare(
      `UPDATE front_office_connector_state
       SET status = 'active',
           external_account_id = COALESCE(external_account_id, ?),
           last_event_at = ?,
           last_error_code = NULL,
           updated_at = ?
       WHERE id = 'site-webflow'
         AND project_id = 'ARTHELLO'
         AND (external_account_id IS NULL OR external_account_id = ?)`,
    ).bind(siteId, submittedAt, submittedAt, siteId),
  ]);

  return json({
    ok: true,
    accepted: true,
    duplicate: Number(results[0]?.meta?.changes ?? 0) === 0,
    projectId: "ARTHELLO",
    leadId,
    route: schoolRoute ? "school_1_11_queue" : "sales_manager_queue",
    outboundEnabled: false,
  });
}

async function listFrontOfficeLeads(env) {
  const [leadResult, messageResult, auditResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT
         l.id,
         l.stage,
         l.source,
         l.campaign,
         l.child_age_band,
         l.branch_preference,
         l.program_interest,
         l.owner_display_name,
         l.next_action,
         l.next_action_at,
         l.trial_status,
         l.version,
         c.id AS conversation_id,
         c.channel,
         c.status,
         c.priority,
         c.contact_display_name,
         c.contact_point_masked,
         c.sealed_contact,
         c.identity_status,
         c.intent,
         c.service,
         c.branch_or_object,
         c.owner_role,
         c.last_message_at,
         c.created_at
       FROM front_office_leads l
       JOIN front_office_conversations c ON c.id = l.conversation_id
       WHERE c.project_id = 'ARTHELLO' AND l.is_synthetic = 0
       ORDER BY c.last_message_at DESC
       LIMIT 100`,
    ),
    env.DB.prepare(
      `SELECT conversation_id, message_type, body, author_display_name,
              fact_status, created_at
       FROM front_office_messages
       WHERE is_synthetic = 0
       ORDER BY created_at`,
    ),
    env.DB.prepare(
      `SELECT entity_id, action, actor_display_name, created_at
       FROM front_office_audit_events
       WHERE entity_type = 'lead'
       ORDER BY created_at DESC`,
    ),
  ]);
  const messagesByConversation = {};
  for (const message of messageResult.results ?? []) {
    (messagesByConversation[message.conversation_id] ??= []).push({
      type: message.message_type,
      label:
        message.message_type === "incoming"
          ? "Входящее сообщение"
          : "Внутренняя заметка",
      body: message.body,
      time: message.created_at,
      factStatus: message.fact_status,
    });
  }
  const auditByLead = {};
  for (const event of auditResult.results ?? []) {
    (auditByLead[event.entity_id] ??= []).push({
      title:
        event.action === "inbound_lead_created"
          ? "Лид создан из реального канала"
          : event.action,
      meta: `${event.actor_display_name ?? "Система"} · ${event.created_at}`,
    });
  }
  const rows = await Promise.all(
    (leadResult.results ?? []).map(async (row) => {
      let contact = {};
      if (row.sealed_contact) {
        try {
          contact = await unsealTokens(row.sealed_contact, env);
        } catch {
          contact = {};
        }
      }
      return {
        id: row.id,
        name: row.contact_display_name,
        contact:
          contact.phone ??
          contact.email ??
          row.contact_point_masked ??
          "Контакт не указан",
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        channel: row.channel,
        source: row.source ?? "Сайт",
        intent: row.intent ?? "Первичная заявка",
        priority: row.priority,
        stage: row.stage,
        owner: row.owner_display_name ?? "",
        ownerRole: row.owner_role,
        program: row.program_interest ?? row.service ?? "",
        nextAction: row.next_action ?? "",
        nextAt: row.next_action_at ?? "",
        overdue: false,
        route: row.branch_or_object,
        identityStatus: row.identity_status,
        campaign: row.campaign,
        branch: row.branch_preference,
        ageBand: row.child_age_band,
        trialStatus: row.trial_status,
        lastMessageAt: row.last_message_at,
        firstTouchAt: row.created_at,
        messages: messagesByConversation[row.conversation_id] ?? [],
        tasks: [],
        audit: auditByLead[row.id] ?? [],
        isSynthetic: false,
        version: row.version,
      };
    }),
  );
  return json({
    projectId: "ARTHELLO",
    dataMode: rows.length ? "real_inbound" : "empty_real_inbound",
    outboundEnabled: false,
    rows,
  });
}

function realLeadId(pathname) {
  const match = pathname.match(
    /^\/api\/front-office\/leads\/(lead_[a-f0-9]{32})$/,
  );
  return match?.[1] ?? null;
}

function realLeadNoteId(pathname) {
  const match = pathname.match(
    /^\/api\/front-office\/leads\/(lead_[a-f0-9]{32})\/notes$/,
  );
  return match?.[1] ?? null;
}

async function updateFrontOfficeLead(request, env, leadId) {
  const denied = requireOwnerAction(request, env);
  if (denied) return denied;
  const parsed = await boundedJsonBody(request, 16 * 1024);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const input = parsed.value ?? {};
  const allowedStages = new Set([
    "NEW",
    "QUALIFIED",
    "PROGRAM_MATCHED",
    "TRIAL_REQUESTED",
    "TRIAL_CONFIRMED",
    "WON",
    "LOST",
  ]);
  const stage = scalarText(input.stage, 40);
  const ownerDisplayName =
    input.ownerDisplayName === null || input.ownerDisplayName === ""
      ? null
      : scalarText(input.ownerDisplayName, 120);
  const nextAction =
    input.nextAction === null || input.nextAction === ""
      ? null
      : scalarText(input.nextAction, 140);
  const programInterest =
    input.programInterest === null || input.programInterest === ""
      ? null
      : scalarText(input.programInterest, 180);
  const nextActionAt =
    input.nextActionAt === null || input.nextActionAt === ""
      ? null
      : scalarText(input.nextActionAt, 40);
  const expectedVersion = Number(input.expectedVersion);
  if (
    !allowedStages.has(stage) ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1 ||
    (input.ownerDisplayName && !ownerDisplayName) ||
    (input.nextAction && !nextAction) ||
    (input.programInterest && !programInterest) ||
    (nextActionAt && !Number.isFinite(Date.parse(nextActionAt)))
  ) {
    return json({ error: "INVALID_LEAD_UPDATE" }, 400);
  }

  const current = await env.DB.prepare(
    `SELECT l.version, l.stage
     FROM front_office_leads l
     JOIN front_office_conversations c ON c.id = l.conversation_id
     WHERE l.id = ? AND l.is_synthetic = 0 AND c.project_id = 'ARTHELLO'`,
  )
    .bind(leadId)
    .first();
  if (!current) return json({ error: "LEAD_NOT_FOUND" }, 404);
  if (Number(current.version) !== expectedVersion) {
    return json(
      { error: "VERSION_CONFLICT", currentVersion: Number(current.version) },
      409,
    );
  }

  const now = new Date().toISOString();
  const nextVersion = expectedVersion + 1;
  const auditId = `audit_${randomHex(16)}`;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE front_office_leads
       SET stage = ?, owner_display_name = ?, next_action = ?,
           next_action_at = ?, program_interest = ?, version = ?,
           updated_at = ?
       WHERE id = ? AND version = ?`,
    ).bind(
      stage,
      ownerDisplayName,
      nextAction,
      nextActionAt,
      programInterest,
      nextVersion,
      now,
      leadId,
      expectedVersion,
    ),
    env.DB.prepare(
      `UPDATE front_office_conversations
       SET owner_display_name = ?, next_action_at = ?, version = version + 1,
           updated_at = ?
       WHERE id = (
         SELECT conversation_id FROM front_office_leads WHERE id = ?
       ) AND project_id = 'ARTHELLO'`,
    ).bind(ownerDisplayName, nextActionAt, now, leadId),
    env.DB.prepare(
      `INSERT INTO front_office_audit_events (
         id, entity_type, entity_id, action, actor_role, actor_display_name,
         after_state_json, request_id, created_at
       ) VALUES (?, 'lead', ?, 'lead_updated', 'owner', ?, ?, ?, ?)`,
    ).bind(
      auditId,
      leadId,
      ownerEmail(request),
      JSON.stringify({
        stage,
        ownerDisplayName,
        nextAction,
        nextActionAt,
        programInterest,
        outboundEnabled: false,
      }),
      safeText(request.headers.get("cf-ray"), 128),
      now,
    ),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return json({ error: "VERSION_CONFLICT" }, 409);
  }
  return json({
    ok: true,
    leadId,
    version: nextVersion,
    outboundEnabled: false,
  });
}

async function addFrontOfficeNote(request, env, leadId) {
  const denied = requireOwnerAction(request, env);
  if (denied) return denied;
  const parsed = await boundedJsonBody(request, 8 * 1024);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const type = scalarText(parsed.value?.type, 40);
  const body = scalarText(parsed.value?.body, 800);
  if (!["internal_note", "ai_draft"].includes(type) || !body) {
    return json({ error: "INVALID_NOTE" }, 400);
  }
  const lead = await env.DB.prepare(
    `SELECT l.conversation_id
     FROM front_office_leads l
     JOIN front_office_conversations c ON c.id = l.conversation_id
     WHERE l.id = ? AND l.is_synthetic = 0 AND c.project_id = 'ARTHELLO'`,
  )
    .bind(leadId)
    .first();
  if (!lead) return json({ error: "LEAD_NOT_FOUND" }, 404);

  const now = new Date().toISOString();
  const messageId = `msg_${randomHex(16)}`;
  const auditId = `audit_${randomHex(16)}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO front_office_messages (
         id, conversation_id, message_type, direction, body, author_role,
         author_display_name, fact_status, source_refs_json, is_synthetic,
         created_at
       ) VALUES (?, ?, ?, 'internal', ?, 'owner', ?, 'UNVERIFIED', '[]', 0, ?)`,
    ).bind(
      messageId,
      lead.conversation_id,
      type,
      body,
      ownerEmail(request),
      now,
    ),
    env.DB.prepare(
      `INSERT INTO front_office_audit_events (
         id, entity_type, entity_id, action, actor_role, actor_display_name,
         after_state_json, request_id, created_at
       ) VALUES (?, 'lead', ?, ?, 'owner', ?, ?, ?, ?)`,
    ).bind(
      auditId,
      leadId,
      type === "ai_draft" ? "ai_draft_saved" : "internal_note_saved",
      ownerEmail(request),
      JSON.stringify({ messageId, outboundEnabled: false }),
      safeText(request.headers.get("cf-ray"), 128),
      now,
    ),
  ]);
  return json({
    ok: true,
    leadId,
    messageId,
    createdAt: now,
    outboundEnabled: false,
  });
}

function safeUpstreamCode(status) {
  if (status === 400) return "provider_rejected_request";
  if (status === 401) return "provider_auth_failed";
  if (status === 403) return "provider_consent_forbidden";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "provider_error";
}

async function providerJson(url, init, operation) {
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(`${operation}_network_error`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${operation}_${safeUpstreamCode(response.status)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${operation}_invalid_response`);
  }
}

async function startTochkaOAuth(request, env) {
  const denied = requireOwnerAction(request, env);
  if (denied) return denied;
  const clientId = env.TOCHKA_CLIENT_ID ?? "";
  const clientSecret = env.TOCHKA_CLIENT_SECRET ?? "";
  const redirectUri = env.TOCHKA_OAUTH_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    return json({ error: "TOCHKA_NOT_CONFIGURED" }, 503);
  }
  try {
    const serviceToken = await providerJson(
      TOCHKA_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: TOCHKA_SCOPE,
        }),
      },
      "service_token",
    );
    if (!safeText(serviceToken.access_token, 8192)) {
      throw new Error("service_token_invalid_response");
    }
    const consent = await providerJson(
      `${TOCHKA_API_BASE}/v1.0/consents`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceToken.access_token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ Data: { permissions: TOCHKA_PERMISSIONS } }),
      },
      "consent",
    );
    const data = consent.Data ?? consent;
    const consentId =
      data.ConsentId ?? data.consentId ?? data.consent_id ?? data.id;
    if (!safeText(consentId, 256)) {
      throw new Error("consent_invalid_response");
    }
    const state = randomHex(24);
    const stateHash = await sha256(state);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO bank_connector_state (
         id, provider, status, consent_id, state_hash, sealed_tokens,
         token_expires_at, last_synced_at, last_error_code, created_at, updated_at
       ) VALUES (
         'tochka', 'tochka', 'awaiting_authorization', ?, ?, NULL,
         NULL, NULL, NULL, ?, ?
       )
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         consent_id = excluded.consent_id,
         state_hash = excluded.state_hash,
         sealed_tokens = NULL,
         token_expires_at = NULL,
         last_error_code = NULL,
         updated_at = excluded.updated_at`,
    )
      .bind(consentId, stateHash, now, now)
      .run();
    const authorizeUrl = new URL(TOCHKA_AUTH_URL);
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      state,
      redirect_uri: redirectUri,
      scope: TOCHKA_SCOPE,
      consent_id: consentId,
    }).toString();
    return json({
      ok: true,
      stage: "awaiting_authorization",
      authorizeUrl: authorizeUrl.toString(),
      scopeMode: "read_only",
    });
  } catch (error) {
    const code = safeText(error?.message, 128) ?? "oauth_start_failed";
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO bank_connector_state (
         id, provider, status, last_error_code, created_at, updated_at
       ) VALUES ('tochka', 'tochka', 'error', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = 'error',
         last_error_code = excluded.last_error_code,
         updated_at = excluded.updated_at`,
    )
      .bind(code, now, now)
      .run();
    return json({ error: code }, 502);
  }
}

function listFromProvider(data, singularName) {
  const block = data?.Data ?? data ?? {};
  const value =
    block[singularName] ??
    block[singularName.toLowerCase()] ??
    block[`${singularName}s`] ??
    [];
  return Array.isArray(value) ? value : [];
}

function providerField(value, names) {
  for (const name of names) {
    const candidate = value?.[name];
    if (candidate !== null && candidate !== undefined && candidate !== "") {
      return String(candidate);
    }
  }
  return "";
}

function maskAccount(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? `•••• ${digits.slice(-4).padStart(4, "•")}` : "Счёт";
}

function decimalTextToMinorUnits(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(",", ".");
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error("money_decimal_invalid");
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    throw new Error("money_precision_exceeds_cents");
  }
  const cents = `${fraction.slice(0, 2)}00`.slice(0, 2);
  const absoluteMinor = BigInt(whole) * 100n + BigInt(cents);
  const signedMinor = sign === "-" ? -absoluteMinor : absoluteMinor;
  const result = Number(signedMinor);
  if (!Number.isSafeInteger(result)) throw new Error("money_out_of_range");
  return result;
}

function balanceAmount(data) {
  const balances = listFromProvider(data, "Balance");
  const priority = ["ClosingAvailable", "OpeningAvailable"];
  const balance =
    priority
      .map((type) =>
        balances.find((item) => providerField(item, ["Type", "type"]) === type),
      )
      .find(Boolean) ?? null;
  if (!balance) {
    return { amount: null, amountMinor: null, currency: "RUB" };
  }
  const amountBlock = balance.Amount ?? balance.amount ?? {};
  const amountText = providerField(amountBlock, ["Amount", "amount"]);
  let amountMinor = null;
  try {
    amountMinor =
      amountText === "" ? null : decimalTextToMinorUnits(amountText);
  } catch {
    amountMinor = null;
  }
  return {
    amount: amountMinor === null ? null : amountMinor / 100,
    amountMinor,
    currency: providerField(amountBlock, ["Currency", "currency"]) || "RUB",
  };
}

async function syncTochkaReadOnly(env, tokens) {
  const clientId = env.TOCHKA_CLIENT_ID ?? "";
  const clientSecret = env.TOCHKA_CLIENT_SECRET ?? "";
  let current = { ...tokens };
  if (
    current.tokenExpiresAt &&
    new Date(current.tokenExpiresAt).getTime() <= Date.now() + 60_000
  ) {
    if (!current.refreshToken) throw new Error("refresh_token_missing");
    const refreshed = await providerJson(
      TOCHKA_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
      "refresh_token",
    );
    current = {
      ...current,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? current.refreshToken,
      tokenExpiresAt: new Date(
        Date.now() + Number(refreshed.expires_in ?? 3600) * 1000,
      ).toISOString(),
    };
  }

  const authHeaders = {
    authorization: `Bearer ${current.accessToken}`,
    accept: "application/json",
  };
  const customers = await providerJson(
    `${TOCHKA_API_BASE}/open-banking/v1.0/customers`,
    { headers: authHeaders },
    "customers",
  );
  const customerList = listFromProvider(customers, "Customer");
  const businessCustomers = customerList.filter(
    (item) =>
      providerField(item, ["customerType", "CustomerType"]).toLowerCase() ===
      "business",
  );
  if (!businessCustomers.length) throw new Error("business_customer_missing");

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare("DELETE FROM bank_accounts WHERE connector_id = 'tochka'"),
  ];
  let accountCount = 0;
  for (const customer of businessCustomers) {
    const customerCode = providerField(customer, [
      "customerCode",
      "CustomerCode",
    ]);
    if (!customerCode) continue;
    const customerName =
      providerField(customer, [
        "shortName",
        "ShortName",
        "fullName",
        "FullName",
      ]) || "Юридическое лицо";
    const accountsData = await providerJson(
      `${TOCHKA_API_BASE}/open-banking/v1.0/accounts`,
      {
        headers: {
          ...authHeaders,
          CustomerCode: customerCode,
        },
      },
      "accounts",
    );
    const accounts = listFromProvider(accountsData, "Account");
    for (const account of accounts) {
      const accountId = providerField(account, [
        "accountId",
        "AccountId",
        "resourceId",
        "ResourceId",
        "id",
      ]);
      if (!accountId || !/^[0-9A-Za-z./_-]+$/.test(accountId)) continue;
      let balance = {
        amount: null,
        amountMinor: null,
        currency: "RUB",
      };
      let balanceStatus = "unavailable";
      try {
        const data = await providerJson(
          `${TOCHKA_API_BASE}/open-banking/v1.0/accounts/${accountId}/balances`,
          {
            headers: {
              ...authHeaders,
              CustomerCode: customerCode,
            },
          },
          "balances",
        );
        balance = balanceAmount(data);
        balanceStatus = balance.amountMinor === null ? "unavailable" : "loaded";
      } catch {
        balanceStatus = "unavailable";
      }
      const accountNumber =
        providerField(account, ["accountNumber", "AccountNumber"]) || accountId;
      const accountName =
        providerField(account, [
          "name",
          "Name",
          "accountName",
          "AccountName",
        ]) || "Расчётный счёт";
      statements.push(
        env.DB.prepare(
          `INSERT INTO bank_accounts (
             id, connector_id, display_name, masked_number, currency,
             current_balance, current_balance_minor, balance_status,
             last_synced_at
           ) VALUES (?, 'tochka', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             masked_number = excluded.masked_number,
             currency = excluded.currency,
             current_balance = excluded.current_balance,
             current_balance_minor = excluded.current_balance_minor,
             balance_status = excluded.balance_status,
             last_synced_at = excluded.last_synced_at`,
        ).bind(
          await sha256(`${customerCode}|${accountId}`),
          `${customerName} · ${accountName}`,
          maskAccount(accountNumber),
          balance.currency,
          balance.amount,
          balance.amountMinor,
          balanceStatus,
          now,
        ),
      );
      accountCount += 1;
    }
  }
  if (!accountCount) throw new Error("accounts_missing");
  await env.DB.batch(statements);
  return { tokens: current, accountCount, syncedAt: now };
}

async function handleTochkaCallback(url, env) {
  const providerError = safeText(url.searchParams.get("error"), 128);
  const code = safeText(url.searchParams.get("code"), 2048);
  const state = safeText(url.searchParams.get("state"), 96);
  const target = new URL("/", url.origin);
  if (providerError) {
    target.searchParams.set("tochka_error", "provider_rejected");
    return Response.redirect(target.toString(), 303);
  }
  if (!code || !state || !/^[a-f0-9]{48}$/.test(state)) {
    target.searchParams.set("tochka_error", "missing_code");
    return Response.redirect(target.toString(), 303);
  }

  const row = await env.DB.prepare(
    `SELECT state_hash FROM bank_connector_state
     WHERE id = 'tochka' AND status = 'awaiting_authorization'`,
  ).first();
  if (!row?.state_hash || row.state_hash !== (await sha256(state))) {
    target.searchParams.set("tochka_error", "state_mismatch");
    return Response.redirect(target.toString(), 303);
  }

  try {
    const token = await providerJson(
      TOCHKA_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: env.TOCHKA_OAUTH_REDIRECT_URI ?? "",
          client_id: env.TOCHKA_CLIENT_ID ?? "",
          client_secret: env.TOCHKA_CLIENT_SECRET ?? "",
          scope: TOCHKA_SCOPE,
        }),
      },
      "code_exchange",
    );
    if (!safeText(token.access_token, 8192)) {
      throw new Error("code_exchange_invalid_response");
    }
    let tokens = {
      accessToken: token.access_token,
      refreshToken: safeText(token.refresh_token, 8192),
      tokenExpiresAt: new Date(
        Date.now() + Number(token.expires_in ?? 3600) * 1000,
      ).toISOString(),
      scopes: TOCHKA_SCOPE,
    };
    let syncStatus = "active";
    let accountCount = 0;
    let syncedAt = null;
    try {
      const sync = await syncTochkaReadOnly(env, tokens);
      tokens = sync.tokens;
      accountCount = sync.accountCount;
      syncedAt = sync.syncedAt;
    } catch {
      syncStatus = "active_sync_attention";
    }
    const sealed = await sealTokens(tokens, env);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE bank_connector_state
         SET
           status = ?,
           state_hash = NULL,
           sealed_tokens = ?,
           token_expires_at = ?,
           last_synced_at = ?,
           last_error_code = ?,
           updated_at = ?
         WHERE id = 'tochka'`,
      ).bind(
        syncStatus,
        sealed,
        tokens.tokenExpiresAt,
        syncedAt,
        syncStatus === "active" ? null : "initial_sync_attention",
        now,
      ),
      env.DB.prepare(
        `INSERT INTO sync_status (
           source, status, label, data_mode, last_synced_at,
           counts_json, details_json, updated_at
         ) VALUES (
           'tochka', ?, 'Банк «Точка»', 'real_read_only', ?,
           ?, ?, ?
         )
         ON CONFLICT(source) DO UPDATE SET
           status = excluded.status,
           last_synced_at = excluded.last_synced_at,
           counts_json = excluded.counts_json,
           details_json = excluded.details_json,
           updated_at = excluded.updated_at`,
      ).bind(
        syncStatus,
        syncedAt,
        JSON.stringify({ accounts: accountCount }),
        JSON.stringify({
          scopes: TOCHKA_SCOPE.split(" "),
          paymentActionsEnabled: false,
        }),
        now,
      ),
    ]);
    await auditSensitiveAccess(
      env,
      "oauth_callback",
      "tochka",
      "allowed",
      "system",
    );
    target.searchParams.set("tochka_oauth", "success");
    return Response.redirect(target.toString(), 303);
  } catch (error) {
    const codeValue = safeText(error?.message, 128) ?? "callback_failed";
    await env.DB.prepare(
      `UPDATE bank_connector_state
       SET status = 'error', state_hash = NULL, last_error_code = ?, updated_at = ?
       WHERE id = 'tochka'`,
    )
      .bind(codeValue, new Date().toISOString())
      .run();
    await auditSensitiveAccess(
      env,
      "oauth_callback",
      "tochka",
      "failed",
      "system",
    );
    target.searchParams.set("tochka_error", "exchange_failed");
    return Response.redirect(target.toString(), 303);
  }
}

async function tochkaStatus(env) {
  const row = await env.DB.prepare(
    `SELECT
       status, consent_id, token_expires_at, last_synced_at,
       last_error_code, updated_at
     FROM bank_connector_state
     WHERE id = 'tochka'`,
  ).first();
  const accounts = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM bank_accounts
     WHERE connector_id = 'tochka'`,
  ).first();
  return json({
    configured: Boolean(
      env.TOCHKA_CLIENT_ID &&
      env.TOCHKA_CLIENT_SECRET &&
      env.TOCHKA_OAUTH_REDIRECT_URI,
    ),
    scopeMode: "read_only",
    paymentActionsEnabled: false,
    status: row?.status ?? "not_started",
    consentCreated: Boolean(row?.consent_id),
    tokenExpiresAt: row?.token_expires_at ?? null,
    lastSyncedAt: row?.last_synced_at ?? null,
    lastErrorCode: row?.last_error_code ?? null,
    accountCount: Number(accounts?.count ?? 0),
    updatedAt: row?.updated_at ?? null,
  });
}

async function syncTochka(request, env) {
  const denied = requireOwnerAction(request, env);
  if (denied) return denied;
  const row = await env.DB.prepare(
    `SELECT sealed_tokens FROM bank_connector_state
     WHERE id = 'tochka'`,
  ).first();
  if (!row?.sealed_tokens) return json({ error: "OAUTH_REQUIRED" }, 409);
  try {
    const tokens = await unsealTokens(row.sealed_tokens, env);
    const result = await syncTochkaReadOnly(env, tokens);
    const sealed = await sealTokens(result.tokens, env);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE bank_connector_state
         SET status = 'active', sealed_tokens = ?, token_expires_at = ?,
             last_synced_at = ?, last_error_code = NULL, updated_at = ?
         WHERE id = 'tochka'`,
      ).bind(
        sealed,
        result.tokens.tokenExpiresAt,
        result.syncedAt,
        result.syncedAt,
      ),
      env.DB.prepare(
        `UPDATE sync_status
         SET status = 'active', last_synced_at = ?, counts_json = ?,
             updated_at = ?
         WHERE source = 'tochka'`,
      ).bind(
        result.syncedAt,
        JSON.stringify({ accounts: result.accountCount }),
        result.syncedAt,
      ),
    ]);
    return json({
      ok: true,
      accountCount: result.accountCount,
      lastSyncedAt: result.syncedAt,
    });
  } catch (error) {
    const code = safeText(error?.message, 128) ?? "sync_failed";
    await env.DB.prepare(
      `UPDATE bank_connector_state
       SET status = 'error', last_error_code = ?, updated_at = ?
       WHERE id = 'tochka'`,
    )
      .bind(code, new Date().toISOString())
      .run();
    return json({ error: code }, 502);
  }
}

async function route(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/healthz") {
    return json({
      status: "ok",
      surface: "arthello-os-control",
      dataMode: "owner_only_read_model_with_real_inbound",
      outboundEnabled: false,
    });
  }

  if (
    url.pathname === "/" &&
    (url.searchParams.has("code") || url.searchParams.has("error"))
  ) {
    return handleTochkaCallback(url, env);
  }

  if (url.pathname === "/" && request.method === "GET") {
    return new Response(page, { headers: securityHeaders });
  }

  if (!url.pathname.startsWith("/api/")) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": securityHeaders["x-robots-tag"],
      },
    });
  }

  const webflowMatch = url.pathname.match(
    /^\/api\/webhooks\/arthello\/webflow\/([a-f0-9]{64})$/,
  );
  if (request.method === "POST" && webflowMatch) {
    return handleWebflowLead(request, env, webflowMatch[1]);
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/admin/read-model/status"
  ) {
    return adminReadModelStatus(env);
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/admin/read-model/snapshot/begin"
  ) {
    return beginReadModelSnapshot(request, env);
  }
  const snapshotCommit = url.pathname.match(
    /^\/api\/admin\/read-model\/snapshot\/([^/]+)\/commit$/,
  );
  if (request.method === "POST" && snapshotCommit) {
    return commitReadModelSnapshot(request, env, snapshotCommit[1]);
  }
  const snapshotDataset = url.pathname.match(
    /^\/api\/admin\/read-model\/snapshot\/([^/]+)\/([^/]+)$/,
  );
  if (request.method === "POST" && snapshotDataset) {
    return stageReadModelDataset(
      request,
      env,
      snapshotDataset[1],
      snapshotDataset[2],
    );
  }
  if (
    request.method === "POST" &&
    url.pathname.startsWith("/api/admin/read-model/")
  ) {
    return json({ error: "ATOMIC_SNAPSHOT_REQUIRED" }, 410);
  }

  const denied = requireOwner(request, env);
  if (denied) return denied;

  const auditResources = {
    "/api/owner-summary": "owner_summary",
    "/api/employees": "employees",
    "/api/payroll": "payroll",
    "/api/students": "students",
    "/api/families": "family_candidates",
    "/api/groups": "groups",
    "/api/teachers": "teachers",
    "/api/teacher_rates": "teacher_rates",
    "/api/lessons": "lessons",
    "/api/payments": "crm_payments",
    "/api/banking/tochka/oauth/start": "tochka_oauth",
    "/api/banking/tochka/status": "tochka_status",
    "/api/banking/tochka/sync": "tochka_sync",
    "/api/banking/accounts": "bank_accounts",
    "/api/integrations/status": "front_office_integrations",
    "/api/integrations/site-webflow/start": "front_office_integrations",
    "/api/front-office/leads": "front_office_leads",
  };
  await auditSensitiveAccess(
    env,
    request.method === "GET" ? "view" : "connection_action",
    auditResources[url.pathname] ?? "unknown_api",
  );

  if (request.method === "GET" && url.pathname === "/api/owner-summary") {
    return ownerSummary(env);
  }
  if (request.method === "GET" && url.pathname === "/api/integrations/status") {
    return connectorStatus(request, env);
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/integrations/site-webflow/start"
  ) {
    return startWebflowPilot(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/front-office/leads") {
    return listFrontOfficeLeads(env);
  }
  const noteLeadId = realLeadNoteId(url.pathname);
  if (request.method === "POST" && noteLeadId) {
    return addFrontOfficeNote(request, env, noteLeadId);
  }
  const updateLeadId = realLeadId(url.pathname);
  if (request.method === "PATCH" && updateLeadId) {
    return updateFrontOfficeLead(request, env, updateLeadId);
  }
  if (request.method === "GET" && url.pathname === "/api/employees") {
    return listEmployees(url, env);
  }
  if (request.method === "GET" && url.pathname === "/api/payroll") {
    return employeePayroll(url, env);
  }
  if (
    request.method === "GET" &&
    [
      "/api/students",
      "/api/families",
      "/api/groups",
      "/api/teachers",
      "/api/teacher_rates",
      "/api/lessons",
      "/api/payments",
    ].includes(url.pathname)
  ) {
    return listRows(url, env, url.pathname.slice("/api/".length));
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/banking/tochka/oauth/start"
  ) {
    return startTochkaOAuth(request, env);
  }
  if (
    request.method === "GET" &&
    url.pathname === "/api/banking/tochka/status"
  ) {
    return tochkaStatus(env);
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/banking/tochka/sync"
  ) {
    return syncTochka(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/banking/accounts") {
    const result = await env.DB.prepare(
      `SELECT
         id,
         display_name,
         masked_number,
         currency,
         current_balance_minor,
         balance_status,
         last_synced_at
       FROM bank_accounts
       ORDER BY display_name, masked_number`,
    ).all();
    return json({
      dataMode: "real_bank_read_only",
      money: {
        storageMode: "integer_minor_units",
        scale: 2,
        financialCalculationsEnabled: false,
      },
      rows: result.results ?? [],
    });
  }

  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch {
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  },
};
