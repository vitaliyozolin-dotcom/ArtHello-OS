import { Router, type IRouter } from "express";
import { createHash as _createHash } from "crypto";
import { db, pool } from "@workspace/db";
import {
  crmBranchesTable,
  crmStudentsTable,
  crmPaymentsTable,
  crmLessonsTable,
  crmAttendanceTable,
  crmTeachersTable,
  leadEventsTable,
  syncLogsTable,
  settingsTable,
} from "@workspace/db";
import { sql, desc, count, eq } from "drizzle-orm";
import {
  testCrmConnection,
  crmPost,
  crmGetAllPages,
  crmProbe,
  getBranchCandidates,
  getLessonsCandidates,
  isLessonsCompatible,
  detectEndpoint,
  authenticate,
  BASE_URL,
} from "../lib/alphaCrmClient";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Helper: write a sync log entry
async function logSync(
  entity: string,
  status: "success" | "error" | "running",
  message: string,
  recordsCount?: number,
  rawError?: unknown,
  startedAt?: Date,
): Promise<void> {
  try {
    await db.insert(syncLogsTable).values({
      entity,
      status,
      message,
      recordsCount: recordsCount ?? null,
      startedAt: startedAt ?? new Date(),
      finishedAt: new Date(),
      rawError: rawError ? (rawError as Record<string, unknown>) : null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write sync log");
  }
}

// GET /api/sync/logs
router.get("/sync/logs", async (req, res): Promise<void> => {
  const limitParam = req.query["limit"];
  const limit = limitParam ? Math.min(Number(limitParam), 200) : 50;

  const logs = await db
    .select()
    .from(syncLogsTable)
    .orderBy(desc(syncLogsTable.startedAt))
    .limit(limit);

  res.json(logs.map((l) => ({
    id: l.id,
    entity: l.entity,
    status: l.status,
    message: l.message,
    recordsCount: l.recordsCount,
    startedAt: l.startedAt?.toISOString() ?? null,
    finishedAt: l.finishedAt?.toISOString() ?? null,
    rawError: l.rawError,
  })));
});

// GET /api/sync/stats
router.get("/sync/stats", async (req, res): Promise<void> => {
  const [
    branchesCount,
    studentsCount,
    leadEventsCount,
    paymentsCount,
    lessonsCount,
    attendanceCount,
    atlasSetting,
    lessonsEndpointSetting,
    lessonsEndpointTotalSetting,
    lastLog,
    recentConnLog,
  ] = await Promise.all([
    db.select({ count: count() }).from(crmBranchesTable).then((r) => r[0]?.count ?? 0),
    db.select({ count: count() }).from(crmStudentsTable).then((r) => r[0]?.count ?? 0),
    db.select({ count: count() }).from(leadEventsTable).then((r) => r[0]?.count ?? 0),
    db.select({ count: count() }).from(crmPaymentsTable).then((r) => r[0]?.count ?? 0),
    db.select({ count: count() }).from(crmLessonsTable).then((r) => r[0]?.count ?? 0),
    db.select({ count: count() }).from(crmAttendanceTable).then((r) => r[0]?.count ?? 0),
    db.select().from(settingsTable).where(eq(settingsTable.key, "atlas_branch_id")).limit(1).then((r) => r[0] ?? null),
    db.select().from(settingsTable).where(eq(settingsTable.key, "lessons_endpoint")).limit(1).then((r) => r[0] ?? null),
    db.select().from(settingsTable).where(eq(settingsTable.key, "lessons_endpoint_total")).limit(1).then((r) => r[0] ?? null),
    db.select().from(syncLogsTable).where(sql`${syncLogsTable.status} = 'success'`).orderBy(desc(syncLogsTable.finishedAt)).limit(1).then((r) => r[0] ?? null),
    db.select().from(syncLogsTable).where(sql`${syncLogsTable.entity} = 'connection'`).orderBy(desc(syncLogsTable.startedAt)).limit(1).then((r) => r[0] ?? null),
  ]);

  const connectionStatus = recentConnLog
    ? (recentConnLog.status === "success" ? "connected" : "error")
    : "unknown";

  res.json({
    branches: Number(branchesCount),
    students: Number(studentsCount),
    leadEvents: Number(leadEventsCount),
    payments: Number(paymentsCount),
    lessons: Number(lessonsCount),
    attendance: Number(attendanceCount),
    atlasBranchId: atlasSetting?.value ?? null,
    lessonsEndpoint: lessonsEndpointSetting?.value ?? null,
    lessonsEndpointTotal: lessonsEndpointTotalSetting?.value ? Number(lessonsEndpointTotalSetting.value) : null,
    lastSyncAt: lastLog?.finishedAt?.toISOString() ?? null,
    connectionStatus,
  });
});

// POST /api/sync/test-connection
router.post("/sync/test-connection", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Testing AlphaCRM connection");
  const result = await testCrmConnection();

  await logSync(
    "connection",
    result.ok ? "success" : "error",
    result.message,
    undefined,
    result.ok ? undefined : { message: result.message },
    startedAt,
  );

  res.json({
    success: result.ok,
    message: result.message,
    data: result.rawResponse ?? null,
    recordsCount: null,
    atlasBranchId: null,
  });
});

// POST /api/sync/branches — probes all candidate endpoints, uses first working one
router.post("/sync/branches", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Syncing branches from AlphaCRM (multi-endpoint probe)");

  let token: string;
  try {
    token = await authenticate();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync("branches", "error", `Auth failed: ${message}`, 0, { message }, startedAt);
    res.json({ success: false, message: `Auth failed: ${message}`, recordsCount: 0, endpointUsed: null, probes: [], rawResponse: null });
    return;
  }

  const candidates = getBranchCandidates();
  const probes: ReturnType<typeof crmProbe> extends Promise<infer T> ? T[] : never[] = [];

  let workingPath: string | null = null;
  let workingItems: Record<string, unknown>[] = [];
  let rawResponse: unknown = null;

  for (const candidate of candidates) {
    const probe = await crmProbe(candidate.path, candidate.method, candidate.body, token);
    probes.push(probe);

    // A working endpoint: 2xx and has JSON with items array or is a direct array
    if (probe.status !== null && probe.status >= 200 && probe.status < 300 && probe.sampleJson !== null) {
      // Try to extract items from various response shapes
      let items: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(probe.rawText ?? "{}");
        if (Array.isArray(parsed)) {
          items = parsed as Record<string, unknown>[];
        } else if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          if (Array.isArray(obj["items"])) {
            items = obj["items"] as Record<string, unknown>[];
          } else if (Array.isArray(obj["data"])) {
            items = obj["data"] as Record<string, unknown>[];
          } else if (Array.isArray(obj["result"])) {
            items = obj["result"] as Record<string, unknown>[];
          } else {
            // Maybe the whole object is a single record or has branch-like fields
            items = [obj];
          }
        }
      } catch {
        // not JSON
      }

      if (items.length > 0 || (probe.status >= 200 && probe.status < 300)) {
        workingPath = `${BASE_URL}/${candidate.path}`;
        workingItems = items as Record<string, unknown>[];
        rawResponse = probe.sampleJson;
        req.log.info({ path: candidate.path, itemCount: items.length }, "Working branch endpoint found");
        break;
      }
    }
  }

  if (!workingPath) {
    const msg = `No working branch endpoint found. Probed ${probes.length} candidates. Check debug panel for details.`;
    await logSync("branches", "error", msg, 0, { probes: probes.map(p => ({ url: p.url, status: p.status, error: p.error, rawText: p.rawText?.slice(0, 500) })) }, startedAt);
    res.json({ success: false, message: msg, recordsCount: 0, endpointUsed: null, probes, rawResponse: null });
    return;
  }

  // If we have no items but the endpoint responded OK, try paginating with crmGetAllPages
  if (workingItems.length === 0) {
    try {
      const pathOnly = workingPath.replace(`${BASE_URL}/`, "");
      workingItems = await crmGetAllPages<Record<string, unknown>>(pathOnly);
    } catch {
      // fallback — use what we have
    }
  }

  let upserted = 0;
  for (const item of workingItems) {
    const crmId = String(item["id"] ?? item["branch_id"] ?? item["crm_id"] ?? "");
    if (!crmId || crmId === "undefined") continue;
    await db
      .insert(crmBranchesTable)
      .values({
        crmId,
        name: String(item["name"] ?? item["title"] ?? item["branch_name"] ?? ""),
        raw: item,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: crmBranchesTable.crmId,
        set: {
          name: String(item["name"] ?? item["title"] ?? item["branch_name"] ?? ""),
          raw: item,
          syncedAt: new Date(),
        },
      });
    upserted++;
  }

  const msg = `Synced ${upserted} branches via ${workingPath}`;
  await logSync("branches", upserted > 0 ? "success" : "error", msg, upserted, { endpointUsed: workingPath, probeCount: probes.length, rawResponse }, startedAt);
  res.json({ success: true, message: msg, recordsCount: upserted, endpointUsed: workingPath, probes, rawResponse });
});

// POST /api/sync/discover — probe all known endpoint candidates and return full report
router.post("/sync/discover", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Discovering AlphaCRM endpoints");

  let token: string;
  try {
    token = await authenticate();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ success: false, message: `Auth failed: ${message}`, probes: [] });
    return;
  }

  // Broader discovery list: branches + other useful endpoints
  const candidates: Array<{ path: string; method: "GET" | "POST"; body?: Record<string, unknown> }> = [
    ...getBranchCandidates(),
    { path: "0/customer/index", method: "POST", body: { page: 0, count: 1 } },
    { path: "1/customer/index", method: "POST", body: { page: 0, count: 1 } },
    { path: "0/lead/index",     method: "POST", body: { page: 0, count: 1 } },
    { path: "1/lead/index",     method: "POST", body: { page: 0, count: 1 } },
    { path: "0/pay/index",      method: "POST", body: { page: 0, count: 1 } },
    { path: "1/pay/index",      method: "POST", body: { page: 0, count: 1 } },
    { path: "0/lesson/index",   method: "POST", body: { page: 0, count: 1 } },
    { path: "1/lesson/index",   method: "POST", body: { page: 0, count: 1 } },
    { path: "0/user/index",     method: "POST", body: { page: 0, count: 1 } },
    { path: "1/user/index",     method: "POST", body: { page: 0, count: 1 } },
  ];

  const probes = [];
  for (const c of candidates) {
    const probe = await crmProbe(c.path, c.method, c.body, token);
    probes.push(probe);
  }

  const working = probes.filter(p => p.status !== null && p.status >= 200 && p.status < 300);
  const msg = `Discovered ${working.length} working endpoints out of ${probes.length} probed.`;
  await logSync("discover", working.length > 0 ? "success" : "error", msg, working.length, { probes: probes.map(p => ({ url: p.url, status: p.status, size: p.responseSize })) }, startedAt);

  res.json({ success: true, message: msg, probes });
});

// Helper: save a setting key/value
async function saveSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

// Helper: read a setting key
async function getSetting(key: string): Promise<string | null> {
  const row = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  return row[0]?.value ?? null;
}

// POST /api/sync/detect-lessons
router.post("/sync/detect-lessons", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Auto-detecting lessons endpoint");

  let token: string;
  try {
    token = await authenticate();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ success: false, message: `Auth failed: ${message}`, found: false, path: null, fullUrl: null, sampleJson: null, recordsTotal: null, probes: [] });
    return;
  }

  const result = await detectEndpoint(getLessonsCandidates(), isLessonsCompatible, token);

  if (result.found && result.path) {
    await saveSetting("lessons_endpoint", result.path);
    if (result.recordsTotal !== null) {
      await saveSetting("lessons_endpoint_total", String(result.recordsTotal));
    }
  }

  const msg = result.found
    ? `Detected lessons endpoint: ${result.path} (total=${result.recordsTotal ?? "?"})`
    : `No lessons-compatible endpoint found. Probed ${result.probes.length} candidates.`;

  await logSync(
    "detect-lessons",
    result.found ? "success" : "error",
    msg,
    result.found ? 1 : 0,
    { found: result.found, path: result.path, total: result.recordsTotal },
    startedAt,
  );

  res.json({ success: result.found, message: msg, ...result });
});

// POST /api/sync/find-atlas — fuzzy search: atlas / атлас / ATLAS via includes+toLowerCase
router.post("/sync/find-atlas", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Finding Atlas branch (fuzzy)");

  try {
    const allBranches = await db.select().from(crmBranchesTable);

    const TERMS = ["atlas", "атлас"];
    const matches = allBranches.filter((b) => {
      const lower = (b.name ?? "").toLowerCase();
      return TERMS.some((t) => lower.includes(t));
    });

    if (matches.length === 0) {
      const msg = `No branches matching "atlas"/"атлас" found among ${allBranches.length} branches. Sync branches first.`;
      await logSync("find-atlas", "error", msg, 0, undefined, startedAt);
      res.json({
        success: false,
        message: msg,
        matches: [],
        savedAtlasBranchId: null,
      });
      return;
    }

    // If exactly one match, auto-save it
    let savedAtlasBranchId: string | null = null;
    if (matches.length === 1) {
      savedAtlasBranchId = matches[0].crmId;
      await db
        .insert(settingsTable)
        .values({ key: "atlas_branch_id", value: savedAtlasBranchId })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: savedAtlasBranchId, updatedAt: new Date() },
        });
    }

    const msg = matches.length === 1
      ? `Found and saved Atlas branch: "${matches[0].name}" (crm_id=${matches[0].crmId})`
      : `Found ${matches.length} branches matching "atlas"/"атлас". Select the correct one below.`;

    await logSync("find-atlas", "success", msg, matches.length, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      matches: matches.map((b) => ({
        crmId: b.crmId,
        name: b.name,
        raw: b.raw,
        syncedAt: b.syncedAt?.toISOString() ?? null,
      })),
      savedAtlasBranchId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Find atlas failed");
    await logSync("find-atlas", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, matches: [], savedAtlasBranchId: null });
  }
});

async function getAtlasBranchId(): Promise<string | null> {
  // First check the settings table (manually set or auto-saved by find-atlas)
  const setting = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, "atlas_branch_id"))
    .limit(1)
    .then((r) => r[0] ?? null);
  return setting?.value ?? null;
}

// POST /api/sync/students-atlas
router.post("/sync/students-atlas", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Syncing Atlas students");

  try {
    const atlasBranchId = await getAtlasBranchId();
    if (!atlasBranchId) {
      const msg = "Atlas branch not found. Run 'Sync Branches' and 'Find Atlas' first.";
      await logSync("students", "error", msg, 0, undefined, startedAt);
      res.json({ success: false, message: msg, recordsCount: 0, atlasBranchId: null, data: null });
      return;
    }

    const items = await crmGetAllPages<Record<string, unknown>>("1/customer/index", {
      branch_id: Number(atlasBranchId),
    });

    let upserted = 0;
    for (const item of items) {
      const crmId = String(item["id"] ?? "");
      if (!crmId) continue;
      const fullName = [item["name"], item["patronymic"]].filter(Boolean).join(" ") || String(item["name"] ?? "");
      await db
        .insert(crmStudentsTable)
        .values({
          crmId,
          branchCrmId: atlasBranchId,
          fullName,
          status: item["is_study"] != null ? String(item["is_study"]) : null,
          phone: item["phone"] ? String(item["phone"]) : null,
          email: item["email"] ? String(item["email"]) : null,
          createdAtCrm: item["created_at"] ? new Date(String(item["created_at"])) : null,
          raw: item,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [crmStudentsTable.branchCrmId, crmStudentsTable.crmId],
          set: {
            fullName,
            status: item["is_study"] != null ? String(item["is_study"]) : null,
            phone: item["phone"] ? String(item["phone"]) : null,
            email: item["email"] ? String(item["email"]) : null,
            raw: item,
            syncedAt: new Date(),
          },
        });
      upserted++;
    }

    const msg = `Synced ${upserted} students for Atlas branch (id=${atlasBranchId})`;
    await logSync("students", "success", msg, upserted, undefined, startedAt);
    res.json({ success: true, message: msg, recordsCount: upserted, atlasBranchId, data: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Student sync failed");
    await logSync("students", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, recordsCount: 0, atlasBranchId: null, data: null });
  }
});

// ── phone normalizer (mirrors identity.ts) ──────────────────────────────────
function normalizePhoneForSync(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  const stripped = digits.replace(/^\+/, "");
  if (stripped.length === 11 && (stripped.startsWith("7") || stripped.startsWith("8"))) {
    return `+7${stripped.slice(1)}`;
  }
  if (stripped.length === 10) return `+7${stripped}`;
  return digits.startsWith("+") ? digits : `+${stripped}`;
}

// POST /api/sync/normalize-students-from-raw
router.post("/sync/normalize-students-from-raw", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("P7.1: Normalizing Atlas students from alpha_raw_records");
  const BRANCH_ID = "6";

  let created = 0, updated = 0, failed = 0;
  const failedReasons: { alphaId: string; reason: string }[] = [];

  try {
    // ── 1. Read all raw students ───────────────────────────────────────────
    const rawResult = await pool.query<{
      id: string;
      alpha_id: string;
      payload_hash: string;
      source_payload: Record<string, unknown>;
    }>(
      `SELECT id, alpha_id, payload_hash, source_payload
       FROM alpha_raw_records
       WHERE entity_type = 'students' AND branch_id = $1
       ORDER BY alpha_id`,
      [BRANCH_ID],
    );

    const rawStudents = rawResult.rows;
    req.log.info({ count: rawStudents.length }, "Raw Atlas students found");

    // ── 2. Normalize each record ───────────────────────────────────────────
    for (const row of rawStudents) {
      try {
        const p = row.source_payload;
        const crmId = row.alpha_id;

        const fullName = String(p["name"] ?? "").trim() || null;

        // Phone — stored as array in AlphaCRM payloads
        const rawPhones = Array.isArray(p["phone"]) ? p["phone"] : p["phone"] ? [p["phone"]] : [];
        const phone = normalizePhoneForSync(rawPhones[0] != null ? String(rawPhones[0]) : null);

        // Email — also array
        const rawEmails = Array.isArray(p["email"]) ? p["email"] : p["email"] ? [p["email"]] : [];
        const email = rawEmails[0] != null ? String(rawEmails[0]).trim().toLowerCase() || null : null;

        // lifecycleStatus
        const isStudy   = p["is_study"];
        const isArchive = p["is_archive"];
        let lifecycleStatus: string;
        if (isArchive === 1 || isArchive === "1") lifecycleStatus = "archived";
        else if (isStudy === 1 || isStudy === "1") lifecycleStatus = "active";
        else if (isStudy === 0 || isStudy === "0") lifecycleStatus = "inactive";
        else lifecycleStatus = "unknown";

        const alphaStatus    = p["is_study"]     != null ? String(p["is_study"])     : null;
        const birthdate      = p["dob"]          ? String(p["dob"])                  : null;
        const guardianName   = p["legal_name"]   ? String(p["legal_name"])           : null;
        const createdAtCrm   = p["created_at"]   ? new Date(String(p["created_at"])) : null;
        const updatedAtCrm   = p["updated_at"]   ? new Date(String(p["updated_at"])) : null;

        const upsertResult = await pool.query<{ inserted: boolean }>(
          `INSERT INTO crm_students (
             crm_id, branch_crm_id, full_name, status, phone, email,
             created_at_crm, raw, synced_at,
             lifecycle_status, alpha_status, raw_record_id, source_payload_hash,
             birthdate, guardian_name, updated_at_crm
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (crm_id) DO UPDATE SET
             branch_crm_id        = EXCLUDED.branch_crm_id,
             full_name            = EXCLUDED.full_name,
             status               = EXCLUDED.status,
             phone                = EXCLUDED.phone,
             email                = EXCLUDED.email,
             raw                  = EXCLUDED.raw,
             synced_at            = NOW(),
             lifecycle_status     = EXCLUDED.lifecycle_status,
             alpha_status         = EXCLUDED.alpha_status,
             raw_record_id        = EXCLUDED.raw_record_id,
             source_payload_hash  = EXCLUDED.source_payload_hash,
             birthdate            = EXCLUDED.birthdate,
             guardian_name        = EXCLUDED.guardian_name,
             updated_at_crm       = EXCLUDED.updated_at_crm
           RETURNING (xmax = 0) AS inserted`,
          [
            crmId, BRANCH_ID, fullName, alphaStatus, phone, email,
            createdAtCrm, JSON.stringify(p),
            lifecycleStatus, alphaStatus, row.id, row.payload_hash,
            birthdate, guardianName, updatedAtCrm,
          ],
        );

        if (upsertResult.rows[0]?.inserted) created++;
        else updated++;
      } catch (err) {
        failed++;
        failedReasons.push({
          alphaId: row.alpha_id,
          reason: err instanceof Error ? err.message : String(err),
        });
        req.log.error({ err, alphaId: row.alpha_id }, "Failed to normalize student");
      }
    }

    // ── 3. Lifecycle summary ───────────────────────────────────────────────
    const lcResult = await pool.query<{ lifecycle_status: string; cnt: string }>(
      `SELECT lifecycle_status, COUNT(*) AS cnt
       FROM crm_students WHERE branch_crm_id = $1 GROUP BY 1`,
      [BRANCH_ID],
    );
    const lc: Record<string, number> = { active: 0, inactive: 0, archived: 0, unknown: 0 };
    for (const row of lcResult.rows) lc[row.lifecycle_status ?? "unknown"] = Number(row.cnt);

    // ── 4. Re-link attendance FK: set student_id for rows whose student_alpha_id
    //        now resolves to a crm_students record (covers newly created students) ──
    const relinkResult = await pool.query<{ count: string }>(
      `WITH linked AS (
         UPDATE crm_attendance ca
         SET    student_id = cs.id
         FROM   crm_students cs
         WHERE  ca.student_alpha_id = cs.crm_id
           AND  ca.branch_id        = $1
           AND  ca.student_id       IS NULL
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM linked`,
      [BRANCH_ID],
    );
    const relinkedAttendance = Number(relinkResult.rows[0]?.count ?? 0);
    req.log.info({ relinkedAttendance }, "normalize-students-from-raw: attendance FK re-linked");

    // ── 5. Students without family link ───────────────────────────────────
    const withoutFamilyResult = await pool.query<{ crm_id: string; raw_record_id: string | null }>(
      `SELECT cs.crm_id, cs.raw_record_id
       FROM crm_students cs
       LEFT JOIN student_profiles sp ON sp.student_crm_id = cs.crm_id
       WHERE cs.branch_crm_id = $1 AND sp.id IS NULL`,
      [BRANCH_ID],
    );

    // Replace old student_without_family issues for this branch
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE issue_type = 'student_without_family' AND missing_reference_type = $1`,
      [BRANCH_ID],
    );
    for (const row of withoutFamilyResult.rows) {
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, raw_record_id, issue_type, issue_message,
            missing_reference_type, severity, suggested_action)
         VALUES ('student',$1,$2,'student_without_family',
           'Student has no family link in identity layer',$3,'warning',
           'Run Build Families in Identity tab to create guardian/family records')`,
        [row.crm_id, row.raw_record_id ?? null, BRANCH_ID],
      );
    }

    const total = created + updated;
    const msg = `P7.1: Normalized ${total}/${rawStudents.length} Atlas students from raw — ${created} created, ${updated} updated, ${failed} failed. Re-linked ${relinkedAttendance} attendance rows. ${withoutFamilyResult.rows.length} without family link.`;
    req.log.info(msg);
    await logSync("students", "success", msg, total, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      rawFound: rawStudents.length,
      created,
      updated,
      skipped: 0,
      failed,
      failedReasons,
      relinkedAttendance,
      withoutFamily: withoutFamilyResult.rows.length,
      lifecycleSummary: lc,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "normalize-students-from-raw failed");
    await logSync("students", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, rawFound: 0, created: 0, updated: 0, failed: 0 });
  }
});

// POST /api/sync/normalize-historical-students
// P7.4.3c — Case A: normalize 6 inactive customers; Case B: create 158 historical identity placeholders
router.post("/sync/normalize-historical-students", async (req, res): Promise<void> => {
  const startedAt = new Date();
  const BRANCH_ID = "6";
  req.log.info("P7.4.3c: normalize-historical-students starting");

  let caseA_found = 0, caseA_created = 0, caseA_updated = 0, caseA_relinked = 0;
  let caseB_ghostCount = 0, caseB_created = 0, caseB_updated = 0, caseB_relinked = 0;
  let issuesUpdated = 0;

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // CASE A — Normalize 6 inactive customers from customers_archived raw records
    // ══════════════════════════════════════════════════════════════════════════
    const archivedRaw = await pool.query<{
      id: string; alpha_id: string; payload_hash: string;
      source_payload: Record<string, unknown>;
    }>(
      `SELECT id, alpha_id, payload_hash, source_payload
       FROM alpha_raw_records
       WHERE entity_type = 'customers_archived' AND branch_id = $1
       ORDER BY alpha_id`,
      [BRANCH_ID],
    );
    caseA_found = archivedRaw.rows.length;
    req.log.info({ caseA_found }, "P7.4.3c: Case A — customers_archived raw records found");

    for (const row of archivedRaw.rows) {
      const p = row.source_payload;
      const crmId = row.alpha_id;

      const fullName = String(p["name"] ?? "").trim() || null;
      const rawPhones = Array.isArray(p["phone"]) ? p["phone"] : p["phone"] ? [p["phone"]] : [];
      const phone     = normalizePhoneForSync(rawPhones[0] != null ? String(rawPhones[0]) : null);
      const rawEmails = Array.isArray(p["email"]) ? p["email"] : p["email"] ? [p["email"]] : [];
      const email     = rawEmails[0] != null ? String(rawEmails[0]).trim().toLowerCase() || null : null;

      // Always 'inactive' for customers_archived (is_study=0)
      const lifecycleStatus = "inactive";
      const alphaStatus     = p["is_study"] != null ? String(p["is_study"]) : null;
      const birthdate       = p["dob"]        ? String(p["dob"])                  : null;
      const guardianName    = p["legal_name"] ? String(p["legal_name"])           : null;
      const createdAtCrm    = p["created_at"] ? new Date(String(p["created_at"])) : null;
      const updatedAtCrm    = p["updated_at"] ? new Date(String(p["updated_at"])) : null;

      const upsertRes = await pool.query<{ inserted: boolean }>(
        `INSERT INTO crm_students (
           crm_id, branch_crm_id, full_name, status, phone, email,
           created_at_crm, raw, synced_at,
           lifecycle_status, alpha_status, raw_record_id, source_payload_hash,
           birthdate, guardian_name, updated_at_crm, source
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (crm_id) DO UPDATE SET
           branch_crm_id       = EXCLUDED.branch_crm_id,
           full_name           = EXCLUDED.full_name,
           status              = EXCLUDED.status,
           phone               = EXCLUDED.phone,
           email               = EXCLUDED.email,
           raw                 = EXCLUDED.raw,
           synced_at           = NOW(),
           lifecycle_status    = EXCLUDED.lifecycle_status,
           alpha_status        = EXCLUDED.alpha_status,
           raw_record_id       = EXCLUDED.raw_record_id,
           source_payload_hash = EXCLUDED.source_payload_hash,
           birthdate           = EXCLUDED.birthdate,
           guardian_name       = EXCLUDED.guardian_name,
           updated_at_crm      = EXCLUDED.updated_at_crm,
           source              = EXCLUDED.source
         RETURNING (xmax = 0) AS inserted`,
        [
          crmId, BRANCH_ID, fullName, alphaStatus, phone, email,
          createdAtCrm, JSON.stringify(p),
          lifecycleStatus, alphaStatus, row.id, row.payload_hash,
          birthdate, guardianName, updatedAtCrm,
          "alpha_archived_customer_lookup",
        ],
      );
      if (upsertRes.rows[0]?.inserted) caseA_created++;
      else caseA_updated++;
    }

    // Re-link crm_attendance.student_id for the 6 inactive students
    const relinkA = await pool.query<{ count: string }>(
      `WITH linked AS (
         UPDATE crm_attendance ca
         SET    student_id = cs.id,
                identity_resolution_status = 'inactive_student_linked'
         FROM   crm_students cs
         WHERE  ca.student_alpha_id = cs.crm_id
           AND  cs.lifecycle_status = 'inactive'
           AND  cs.source           = 'alpha_archived_customer_lookup'
           AND  ca.branch_id        = $1
           AND  ca.student_id       IS NULL
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM linked`,
      [BRANCH_ID],
    );
    caseA_relinked = Number(relinkA.rows[0]?.count ?? 0);
    req.log.info({ caseA_relinked }, "P7.4.3c: Case A attendance relinked");

    // Clear INACTIVE_CUSTOMER_FOUND issues for normalized students, add student_without_family
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE issue_type = 'attendance_customer_inactive_found'
         AND alpha_id = ANY(
           SELECT crm_id FROM crm_students
           WHERE branch_crm_id=$1 AND source='alpha_archived_customer_lookup'
         )`,
      [BRANCH_ID],
    );
    // student_without_family for those without a family link
    const withoutFamilyA = await pool.query<{ crm_id: string }>(
      `SELECT cs.crm_id FROM crm_students cs
       LEFT JOIN student_profiles sp ON sp.student_crm_id = cs.crm_id
       WHERE cs.branch_crm_id=$1 AND cs.source='alpha_archived_customer_lookup' AND sp.id IS NULL`,
      [BRANCH_ID],
    );
    for (const row of withoutFamilyA.rows) {
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
         VALUES ('student',$1,'student_without_family',
           'Inactive student normalized from archived lookup — no family link',$2,'warning',
           'Run Build Families if contact data is available; otherwise accept as historical-only contact.')
         ON CONFLICT DO NOTHING`,
        [row.crm_id, BRANCH_ID],
      );
    }
    issuesUpdated += withoutFamilyA.rows.length;

    // ══════════════════════════════════════════════════════════════════════════
    // CASE B — 158 hard-deleted: create crm_student_identities placeholders
    // ══════════════════════════════════════════════════════════════════════════
    const ghostRows = await pool.query<{
      customer_id: string; attendance_count: string; lesson_count: string;
      first_date: string; last_date: string;
      group_ids: string[]; subject_ids: string[];
      teacher_ids_agg: string; sample_lessons: string[];
    }>(
      `SELECT
         a.student_alpha_id                                                    AS customer_id,
         COUNT(*)::text                                                        AS attendance_count,
         COUNT(DISTINCT a.lesson_id)::text                                     AS lesson_count,
         MIN(a.lesson_date)::date::text                                        AS first_date,
         MAX(a.lesson_date)::date::text                                        AS last_date,
         array_remove(array_agg(DISTINCT a.group_alpha_id),   NULL)            AS group_ids,
         array_remove(array_agg(DISTINCT a.subject_alpha_id), NULL)            AS subject_ids,
         (SELECT string_agg(DISTINCT elem::text, ',' ORDER BY elem::text)
          FROM crm_attendance a2, jsonb_array_elements_text(a2.teacher_alpha_ids) elem
          WHERE a2.branch_id=$1 AND a2.student_alpha_id = a.student_alpha_id
            AND a2.teacher_alpha_ids IS NOT NULL)                              AS teacher_ids_agg,
         (SELECT array_agg(lal ORDER BY lal)
          FROM (SELECT DISTINCT a3.lesson_alpha_id AS lal
                FROM crm_attendance a3
                WHERE a3.branch_id=$1 AND a3.student_alpha_id = a.student_alpha_id
                LIMIT 5) sub)                                                  AS sample_lessons
       FROM crm_attendance a
       LEFT JOIN crm_students s ON s.crm_id = a.student_alpha_id
       WHERE a.branch_id=$1
         AND a.student_alpha_id IS NOT NULL
         AND a.student_id IS NULL
       GROUP BY a.student_alpha_id
       ORDER BY COUNT(*) DESC`,
      [BRANCH_ID],
    );
    caseB_ghostCount = ghostRows.rows.length;
    req.log.info({ caseB_ghostCount }, "P7.4.3c: Case B — ghost customer_ids to process");

    for (const row of ghostRows.rows) {
      const teacherIds = row.teacher_ids_agg
        ? row.teacher_ids_agg.split(",").filter(Boolean)
        : [];

      const upsertRes = await pool.query<{ inserted: boolean }>(
        `INSERT INTO crm_student_identities
           (branch_id, alpha_customer_id, identity_type, source,
            first_seen_lesson_date, last_seen_lesson_date,
            attendance_count, lesson_count,
            group_ids, subject_ids, teacher_ids, sample_lesson_alpha_ids,
            resolution_status, confidence, notes, updated_at)
         VALUES ($1,$2,'historical_deleted','attendance_only',
           $3::date,$4::date,$5,$6,
           $7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,
           'hard_deleted_from_alpha','medium',
           'Customer absent from all AlphaCRM API endpoints including all 8 branches. Confirmed hard-deleted via direct lookup.',
           NOW())
         ON CONFLICT (branch_id, alpha_customer_id) DO UPDATE SET
           attendance_count          = EXCLUDED.attendance_count,
           lesson_count              = EXCLUDED.lesson_count,
           first_seen_lesson_date    = EXCLUDED.first_seen_lesson_date,
           last_seen_lesson_date     = EXCLUDED.last_seen_lesson_date,
           group_ids                 = EXCLUDED.group_ids,
           subject_ids               = EXCLUDED.subject_ids,
           teacher_ids               = EXCLUDED.teacher_ids,
           sample_lesson_alpha_ids   = EXCLUDED.sample_lesson_alpha_ids,
           resolution_status         = EXCLUDED.resolution_status,
           updated_at                = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [
          BRANCH_ID,
          row.customer_id,
          row.first_date   || null,
          row.last_date    || null,
          Number(row.attendance_count),
          Number(row.lesson_count),
          JSON.stringify(row.group_ids   ?? []),
          JSON.stringify(row.subject_ids ?? []),
          JSON.stringify(teacherIds),
          JSON.stringify(row.sample_lessons ?? []),
        ],
      );
      if (upsertRes.rows[0]?.inserted) caseB_created++;
      else caseB_updated++;
    }

    // Link crm_attendance.student_identity_id for Case B ghost customers
    const relinkB = await pool.query<{ count: string }>(
      `WITH linked AS (
         UPDATE crm_attendance ca
         SET    student_identity_id        = csi.id,
                identity_resolution_status = 'historical_only'
         FROM   crm_student_identities csi
         WHERE  ca.student_alpha_id = csi.alpha_customer_id
           AND  csi.branch_id       = $1
           AND  ca.branch_id        = $1
           AND  ca.student_id       IS NULL
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM linked`,
      [BRANCH_ID],
    );
    caseB_relinked = Number(relinkB.rows[0]?.count ?? 0);
    req.log.info({ caseB_relinked }, "P7.4.3c: Case B attendance identity-linked");

    // Update linking issues for Case B: replace RAW_CUSTOMER_NOT_FOUND with historical_deleted
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE issue_type = 'attendance_customer_raw_not_found'
         AND issue_message LIKE $1`,
      [`%branchId=${BRANCH_ID}%`],
    );
    // Insert one aggregated issue per ghost customer_id
    for (const row of ghostRows.rows) {
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message,
            missing_reference_type, missing_reference_id, severity, suggested_action)
         VALUES ('attendance',$1,'attendance_customer_historical_deleted',
           $2,'crm_student_identities',$1,'info',
           'Customer is confirmed hard-deleted from AlphaCRM API. Historical identity placeholder created in crm_student_identities. Attendance preserved.')
         ON CONFLICT DO NOTHING`,
        [
          row.customer_id,
          `branchId=${BRANCH_ID} customer_id=${row.customer_id} att_count=${row.attendance_count} first=${row.first_date} last=${row.last_date}`,
        ],
      );
    }
    issuesUpdated += ghostRows.rows.length;

    const msg = `P7.4.3c complete. Case A: ${caseA_found} inactive found, ${caseA_created} created, ${caseA_updated} updated, ${caseA_relinked} attendance relinked. Case B: ${caseB_ghostCount} ghosts, ${caseB_created} identities created, ${caseB_updated} updated, ${caseB_relinked} attendance identity-linked. Issues updated: ${issuesUpdated}.`;
    req.log.info(msg);
    await logSync("historical_students", "success", msg, caseA_created + caseA_updated + caseB_created + caseB_updated, undefined, startedAt);

    res.json({
      success:         true,
      message:         msg,
      caseA: {
        rawFound:     caseA_found,
        created:      caseA_created,
        updated:      caseA_updated,
        relinked:     caseA_relinked,
      },
      caseB: {
        ghostCount:   caseB_ghostCount,
        created:      caseB_created,
        updated:      caseB_updated,
        relinked:     caseB_relinked,
      },
      issuesUpdated,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "normalize-historical-students failed");
    await logSync("historical_students", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message });
  }
});

// POST /api/sync/normalize-teachers-from-raw
router.post("/sync/normalize-teachers-from-raw", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("P7.2: Normalizing Atlas teachers from alpha_raw_records");
  const BRANCH_ID = "6";

  let created = 0, updated = 0, failed = 0, unknownLifecycle = 0;
  const failedReasons: { alphaId: string; reason: string }[] = [];

  try {
    // ── 1. Read all raw teachers ──────────────────────────────────────────────
    const rawResult = await pool.query<{
      id: string;
      alpha_id: string;
      payload_hash: string;
      source_payload: Record<string, unknown>;
    }>(
      `SELECT id, alpha_id, payload_hash, source_payload
       FROM alpha_raw_records
       WHERE entity_type = 'teachers' AND branch_id = $1
       ORDER BY alpha_id`,
      [BRANCH_ID],
    );

    const rawTeachers = rawResult.rows;
    req.log.info({ count: rawTeachers.length }, "Raw Atlas teachers found");

    // ── 2. Normalize each record ──────────────────────────────────────────────
    for (const row of rawTeachers) {
      try {
        const p = row.source_payload;
        const crmId = row.alpha_id;

        const fullName = String(p["name"] ?? "").trim() || null;

        const rawPhones = Array.isArray(p["phone"]) ? (p["phone"] as unknown[]) : p["phone"] ? [p["phone"]] : [];
        const phone = normalizePhoneForSync(rawPhones[0] != null ? String(rawPhones[0]) : null);

        const rawEmails = Array.isArray(p["email"]) ? (p["email"] as unknown[]) : p["email"] ? [p["email"]] : [];
        const email = rawEmails[0] != null ? String(rawEmails[0]).trim().toLowerCase() || null : null;

        // lifecycleStatus: AlphaCRM uses e_date='2030-12-31' for active teachers (no archive flag)
        const eDate = p["e_date"] ? String(p["e_date"]) : null;
        let lifecycleStatus: string;
        if (eDate === "2030-12-31") {
          lifecycleStatus = "active";
        } else if (eDate && eDate < "2026-05-24") {
          lifecycleStatus = "archived";
        } else if (eDate) {
          lifecycleStatus = "active";
        } else {
          lifecycleStatus = "unknown";
          unknownLifecycle++;
        }

        const dob          = p["dob"]           ? String(p["dob"]).trim() || null     : null;
        const note         = p["note"]          ? String(p["note"]).trim() || null    : null;
        const customOklad  = p["custom_oklad"]  ? String(p["custom_oklad"]).trim() || null : null;
        const branchIdsCrm = Array.isArray(p["branch_ids"]) ? JSON.stringify(p["branch_ids"]) : null;
        const updatedAtCrm = p["updated_at"]    ? new Date(String(p["updated_at"]))   : null;

        const upsertResult = await pool.query<{ inserted: boolean }>(
          `INSERT INTO crm_teachers (
             crm_id, branch_crm_id, full_name, phone, email, status, raw, synced_at,
             lifecycle_status, alpha_status, raw_record_id, source_payload_hash,
             dob, note, e_date_crm, custom_oklad, branch_ids_crm, updated_at_crm
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (crm_id) DO UPDATE SET
             branch_crm_id        = EXCLUDED.branch_crm_id,
             full_name            = EXCLUDED.full_name,
             phone                = EXCLUDED.phone,
             email                = EXCLUDED.email,
             status               = EXCLUDED.status,
             raw                  = EXCLUDED.raw,
             synced_at            = NOW(),
             lifecycle_status     = EXCLUDED.lifecycle_status,
             alpha_status         = EXCLUDED.alpha_status,
             raw_record_id        = EXCLUDED.raw_record_id,
             source_payload_hash  = EXCLUDED.source_payload_hash,
             dob                  = EXCLUDED.dob,
             note                 = EXCLUDED.note,
             e_date_crm           = EXCLUDED.e_date_crm,
             custom_oklad         = EXCLUDED.custom_oklad,
             branch_ids_crm       = EXCLUDED.branch_ids_crm,
             updated_at_crm       = EXCLUDED.updated_at_crm
           RETURNING (xmax = 0) AS inserted`,
          [
            crmId, BRANCH_ID, fullName, phone, email, lifecycleStatus,
            JSON.stringify(p),
            lifecycleStatus, lifecycleStatus, row.id, row.payload_hash,
            dob, note, eDate, customOklad, branchIdsCrm, updatedAtCrm,
          ],
        );

        if (upsertResult.rows[0]?.inserted) created++;
        else updated++;
      } catch (err) {
        failed++;
        failedReasons.push({
          alphaId: row.alpha_id,
          reason: err instanceof Error ? err.message : String(err),
        });
        req.log.error({ err, alphaId: row.alpha_id }, "Failed to normalize teacher");
      }
    }

    // ── 3. Lifecycle summary ──────────────────────────────────────────────────
    const lcResult = await pool.query<{ lifecycle_status: string; cnt: string }>(
      `SELECT lifecycle_status, COUNT(*) AS cnt FROM crm_teachers WHERE branch_crm_id=$1 GROUP BY 1`,
      [BRANCH_ID],
    );
    const lc: Record<string, number> = { active: 0, inactive: 0, archived: 0, unknown: 0 };
    for (const row of lcResult.rows) lc[row.lifecycle_status ?? "unknown"] = Number(row.cnt);

    const total = created + updated;
    const msg = `P7.2: Normalized ${total}/${rawTeachers.length} Atlas teachers from raw — ${created} created, ${updated} updated, ${failed} failed. ${unknownLifecycle} unknown lifecycle.`;
    req.log.info(msg);
    await logSync("teachers", "success", msg, total, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      rawFound: rawTeachers.length,
      created,
      updated,
      failed,
      failedReasons,
      unknownLifecycle,
      lifecycleSummary: lc,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "normalize-teachers-from-raw failed");
    await logSync("teachers", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, rawFound: 0, created: 0, updated: 0, failed: 0 });
  }
});

// POST /api/sync/normalize-groups-from-raw
router.post("/sync/normalize-groups-from-raw", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("P7.2: Normalizing Atlas groups from alpha_raw_records");
  const BRANCH_ID = "6";
  const TODAY = "2026-05-24";

  let created = 0, updated = 0, failed = 0, unknownLifecycle = 0;
  let withoutSubject = 0, withoutTeacher = 0;
  const failedReasons: { alphaId: string; reason: string }[] = [];

  try {
    // ── 1. Read all raw groups ────────────────────────────────────────────────
    const rawResult = await pool.query<{
      id: string;
      alpha_id: string;
      payload_hash: string;
      source_payload: Record<string, unknown>;
    }>(
      `SELECT id, alpha_id, payload_hash, source_payload
       FROM alpha_raw_records
       WHERE entity_type = 'groups' AND branch_id = $1
       ORDER BY alpha_id`,
      [BRANCH_ID],
    );

    const rawGroups = rawResult.rows;
    req.log.info({ count: rawGroups.length }, "Raw Atlas groups found");

    // Clear old group linking issues for this branch
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE issue_type IN ('group_without_subject','group_without_teacher')
         AND missing_reference_type = $1`,
      [BRANCH_ID],
    );

    // ── 2. Normalize each record ──────────────────────────────────────────────
    for (const row of rawGroups) {
      try {
        const p = row.source_payload;
        const crmId = row.alpha_id;

        const name    = String(p["name"] ?? "").trim() || null;
        const note    = p["note"]    ? String(p["note"]).trim() || null    : null;
        const bDate   = p["b_date"]  ? String(p["b_date"])                : null;
        const eDate   = p["e_date"]  ? String(p["e_date"])                : null;
        const capacity = p["limit"] != null ? Number(p["limit"]) || null  : null;

        // Extract real teacher CRM IDs from embedded teacher objects
        const embeddedTeachers = Array.isArray(p["teachers"])
          ? (p["teachers"] as Array<Record<string, unknown>>)
          : [];
        const teacherCrmIds = embeddedTeachers
          .map(t => t["id"] != null ? String(t["id"]) : null)
          .filter((id): id is string => id !== null);

        // lifecycleStatus from e_date
        let lifecycleStatus: string;
        if (!eDate) {
          lifecycleStatus = "unknown";
          unknownLifecycle++;
        } else if (eDate < TODAY) {
          lifecycleStatus = "archived";
        } else {
          lifecycleStatus = "active";
        }

        // Groups in AlphaCRM don't have a subject_id field — linked only via lessons
        const hasSubject = false;
        if (!hasSubject) withoutSubject++;

        // Check if group has at least one teacher
        const hasTeacher = teacherCrmIds.length > 0;
        if (!hasTeacher) withoutTeacher++;

        const createdAtCrm = p["created_at"] ? new Date(String(p["created_at"])) : null;
        const updatedAtCrm = p["updated_at"] ? new Date(String(p["updated_at"])) : null;

        const upsertResult = await pool.query<{ inserted: boolean }>(
          `INSERT INTO crm_groups (
             crm_id, branch_crm_id, name, note, b_date, e_date, capacity,
             teacher_crm_ids, raw, synced_at,
             lifecycle_status, alpha_status, raw_record_id, source_payload_hash,
             created_at_crm, updated_at_crm
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10,$11,$12,$13,$14,$15)
           ON CONFLICT (crm_id) DO UPDATE SET
             branch_crm_id        = EXCLUDED.branch_crm_id,
             name                 = EXCLUDED.name,
             note                 = EXCLUDED.note,
             b_date               = EXCLUDED.b_date,
             e_date               = EXCLUDED.e_date,
             capacity             = EXCLUDED.capacity,
             teacher_crm_ids      = EXCLUDED.teacher_crm_ids,
             raw                  = EXCLUDED.raw,
             synced_at            = NOW(),
             lifecycle_status     = EXCLUDED.lifecycle_status,
             alpha_status         = EXCLUDED.alpha_status,
             raw_record_id        = EXCLUDED.raw_record_id,
             source_payload_hash  = EXCLUDED.source_payload_hash,
             created_at_crm       = EXCLUDED.created_at_crm,
             updated_at_crm       = EXCLUDED.updated_at_crm
           RETURNING (xmax = 0) AS inserted`,
          [
            crmId, BRANCH_ID, name, note, bDate, eDate, capacity,
            JSON.stringify(teacherCrmIds), JSON.stringify(p),
            lifecycleStatus, lifecycleStatus, row.id, row.payload_hash,
            createdAtCrm, updatedAtCrm,
          ],
        );

        if (upsertResult.rows[0]?.inserted) created++;
        else updated++;

        // Create linking issues
        await pool.query(
          `INSERT INTO alpha_linking_issues
             (entity_type, alpha_id, raw_record_id, issue_type, issue_message,
              missing_reference_type, severity, suggested_action)
           VALUES ('group',$1,$2,'group_without_subject',
             'Group has no subject_id — AlphaCRM groups do not expose subject links directly',$3,'warning',
             'Subject can be inferred from lessons that reference this group')`,
          [crmId, row.id, BRANCH_ID],
        );

        if (!hasTeacher) {
          await pool.query(
            `INSERT INTO alpha_linking_issues
               (entity_type, alpha_id, raw_record_id, issue_type, issue_message,
                missing_reference_type, severity, suggested_action)
             VALUES ('group',$1,$2,'group_without_teacher',
               'Group has no embedded teachers in raw payload',$3,'warning',
               'Check if teachers were assigned later or group is a template')`,
            [crmId, row.id, BRANCH_ID],
          );
        }
      } catch (err) {
        failed++;
        failedReasons.push({
          alphaId: row.alpha_id,
          reason: err instanceof Error ? err.message : String(err),
        });
        req.log.error({ err, alphaId: row.alpha_id }, "Failed to normalize group");
      }
    }

    // ── 3. Lifecycle summary ──────────────────────────────────────────────────
    const lcResult = await pool.query<{ lifecycle_status: string; cnt: string }>(
      `SELECT lifecycle_status, COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1 GROUP BY 1`,
      [BRANCH_ID],
    );
    const lc: Record<string, number> = { active: 0, inactive: 0, archived: 0, unknown: 0 };
    for (const row of lcResult.rows) lc[row.lifecycle_status ?? "unknown"] = Number(row.cnt);

    const total = created + updated;
    const msg = `P7.2: Normalized ${total}/${rawGroups.length} Atlas groups from raw — ${created} created, ${updated} updated, ${failed} failed. ${withoutSubject} without subject, ${withoutTeacher} without teacher.`;
    req.log.info(msg);
    await logSync("groups", "success", msg, total, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      rawFound: rawGroups.length,
      created,
      updated,
      failed,
      failedReasons,
      withoutSubject,
      withoutTeacher,
      unknownLifecycle,
      lifecycleSummary: lc,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "normalize-groups-from-raw failed");
    await logSync("groups", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, rawFound: 0, created: 0, updated: 0, failed: 0 });
  }
});

// POST /api/sync/normalize-lessons-from-raw
router.post("/sync/normalize-lessons-from-raw", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("P7.3: Normalizing Atlas lessons from alpha_raw_records");
  const BRANCH_ID = "6";

  try {
    // ── 1. Single SQL upsert — all 15,370 lessons in one shot ────────────────
    const upsertResult = await pool.query<{ created: string; updated: string }>(`
      WITH upserted AS (
        INSERT INTO crm_lessons (
          crm_id, branch_crm_id, group_crm_id, teacher_crm_id, lesson_date,
          subject_crm_id, teacher_crm_ids, group_crm_ids,
          time_from, time_to, lifecycle_status, alpha_status,
          raw_record_id, source_payload_hash,
          visits_raw, visits_count,
          room_crm_id, lesson_type_id, lesson_type_name,
          regular_crm_id, topic, note, customer_crm_ids,
          created_at_crm, updated_at_crm, raw, synced_at
        )
        SELECT
          r.alpha_id,
          r.branch_id,
          CASE WHEN jsonb_typeof(r.source_payload->'group_ids')='array'
                AND jsonb_array_length(r.source_payload->'group_ids')>0
               THEN (r.source_payload->'group_ids'->>0) ELSE NULL END,
          CASE WHEN jsonb_typeof(r.source_payload->'teacher_ids')='array'
                AND jsonb_array_length(r.source_payload->'teacher_ids')>0
               THEN (r.source_payload->'teacher_ids'->>0) ELSE NULL END,
          CASE WHEN r.source_payload->>'time_from' IS NOT NULL
               THEN (r.source_payload->>'time_from')::timestamptz
               ELSE (r.source_payload->>'date')::date::timestamptz END,
          r.source_payload->>'subject_id',
          COALESCE(
            (SELECT jsonb_agg(v::text)
             FROM jsonb_array_elements(COALESCE(r.source_payload->'teacher_ids','[]'::jsonb)) v),
            '[]'::jsonb),
          COALESCE(
            (SELECT jsonb_agg(v::text)
             FROM jsonb_array_elements(COALESCE(r.source_payload->'group_ids','[]'::jsonb)) v),
            '[]'::jsonb),
          CASE WHEN r.source_payload->>'time_from' IS NOT NULL
               THEN (r.source_payload->>'time_from')::timestamptz ELSE NULL END,
          CASE WHEN r.source_payload->>'time_to' IS NOT NULL
               THEN (r.source_payload->>'time_to')::timestamptz ELSE NULL END,
          CASE r.source_payload->>'status'
            WHEN '1' THEN 'scheduled' WHEN '2' THEN 'scheduled'
            WHEN '3' THEN 'completed' WHEN '5' THEN 'cancelled'
            WHEN '6' THEN 'moved'    ELSE 'unknown' END,
          r.source_payload->>'status',
          r.id,
          r.payload_hash,
          r.source_payload->'details',
          COALESCE(jsonb_array_length(r.source_payload->'details'), 0),
          r.source_payload->>'room_id',
          CASE WHEN r.source_payload->>'lesson_type_id' IS NOT NULL
               THEN (r.source_payload->>'lesson_type_id')::int ELSE NULL END,
          r.source_payload->>'lesson_type_name',
          r.source_payload->>'regular_id',
          NULLIF(r.source_payload->>'topic', ''),
          NULLIF(r.source_payload->>'note', ''),
          COALESCE(r.source_payload->'customer_ids', '[]'::jsonb),
          CASE WHEN r.source_payload->>'created_at' IS NOT NULL
               THEN (r.source_payload->>'created_at')::timestamptz ELSE NULL END,
          CASE WHEN r.source_payload->>'updated_at' IS NOT NULL
               THEN (r.source_payload->>'updated_at')::timestamptz ELSE NULL END,
          r.source_payload,
          NOW()
        FROM alpha_raw_records r
        WHERE r.entity_type = 'lessons' AND r.branch_id = $1
        ON CONFLICT (crm_id) DO UPDATE SET
          branch_crm_id       = EXCLUDED.branch_crm_id,
          group_crm_id        = EXCLUDED.group_crm_id,
          teacher_crm_id      = EXCLUDED.teacher_crm_id,
          lesson_date         = EXCLUDED.lesson_date,
          subject_crm_id      = EXCLUDED.subject_crm_id,
          teacher_crm_ids     = EXCLUDED.teacher_crm_ids,
          group_crm_ids       = EXCLUDED.group_crm_ids,
          time_from           = EXCLUDED.time_from,
          time_to             = EXCLUDED.time_to,
          lifecycle_status    = EXCLUDED.lifecycle_status,
          alpha_status        = EXCLUDED.alpha_status,
          raw_record_id       = EXCLUDED.raw_record_id,
          source_payload_hash = EXCLUDED.source_payload_hash,
          visits_raw          = EXCLUDED.visits_raw,
          visits_count        = EXCLUDED.visits_count,
          room_crm_id         = EXCLUDED.room_crm_id,
          lesson_type_id      = EXCLUDED.lesson_type_id,
          lesson_type_name    = EXCLUDED.lesson_type_name,
          regular_crm_id      = EXCLUDED.regular_crm_id,
          topic               = EXCLUDED.topic,
          note                = EXCLUDED.note,
          customer_crm_ids    = EXCLUDED.customer_crm_ids,
          created_at_crm      = EXCLUDED.created_at_crm,
          updated_at_crm      = EXCLUDED.updated_at_crm,
          raw                 = EXCLUDED.raw,
          synced_at           = NOW()
        RETURNING (xmax = 0) AS was_inserted
      )
      SELECT
        COUNT(*) FILTER (WHERE was_inserted)      AS created,
        COUNT(*) FILTER (WHERE NOT was_inserted)  AS updated
      FROM upserted
    `, [BRANCH_ID]);

    const created = Number(upsertResult.rows[0]?.created ?? 0);
    const updated = Number(upsertResult.rows[0]?.updated ?? 0);
    const total   = created + updated;
    req.log.info({ created, updated, total }, "P7.3: Lessons upserted");

    // ── 2. Stats summary ──────────────────────────────────────────────────────
    const statsResult = await pool.query<{
      with_group: string; without_group: string;
      with_teacher: string; without_teacher: string;
      with_subject: string; without_subject: string;
      with_visits: string; total_visits: string;
      earliest_date: string; latest_date: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE group_crm_ids  != '[]'::jsonb)   AS with_group,
        COUNT(*) FILTER (WHERE group_crm_ids   = '[]'::jsonb)   AS without_group,
        COUNT(*) FILTER (WHERE teacher_crm_ids != '[]'::jsonb)  AS with_teacher,
        COUNT(*) FILTER (WHERE teacher_crm_ids  = '[]'::jsonb)  AS without_teacher,
        COUNT(*) FILTER (WHERE subject_crm_id IS NOT NULL)      AS with_subject,
        COUNT(*) FILTER (WHERE subject_crm_id IS NULL)          AS without_subject,
        COUNT(*) FILTER (WHERE visits_count > 0)                AS with_visits,
        COALESCE(SUM(visits_count), 0)                          AS total_visits,
        MIN(lesson_date)::date::text                            AS earliest_date,
        MAX(lesson_date)::date::text                            AS latest_date
      FROM crm_lessons WHERE branch_crm_id = $1
    `, [BRANCH_ID]);
    const stats = statsResult.rows[0]!;

    // ── 3. By-month summary ───────────────────────────────────────────────────
    const monthsResult = await pool.query<{ month: string; cnt: string }>(`
      SELECT to_char(lesson_date, 'YYYY-MM') AS month, COUNT(*) AS cnt
      FROM crm_lessons WHERE branch_crm_id = $1
      GROUP BY 1 ORDER BY 1
    `, [BRANCH_ID]);

    // ── 4. Rebuild linking issues (bulk SQL) ──────────────────────────────────
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE issue_type IN ('lesson_without_group','lesson_without_teacher','lesson_without_subject')
         AND missing_reference_type = $1`,
      [BRANCH_ID],
    );
    await pool.query(`
      INSERT INTO alpha_linking_issues
        (entity_type, alpha_id, raw_record_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
      SELECT 'lesson', l.crm_id, l.raw_record_id,
             'lesson_without_group',
             'Lesson has no group_ids — standalone/one-time/private session',
             $1, 'warning', 'Expected for lesson_type Разовое занятие or private lessons'
      FROM crm_lessons l
      WHERE l.branch_crm_id = $1 AND l.group_crm_ids = '[]'::jsonb
    `, [BRANCH_ID]);
    await pool.query(`
      INSERT INTO alpha_linking_issues
        (entity_type, alpha_id, raw_record_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
      SELECT 'lesson', l.crm_id, l.raw_record_id,
             'lesson_without_teacher', 'Lesson has no teacher_ids',
             $1, 'warning', 'Check AlphaCRM lesson record'
      FROM crm_lessons l
      WHERE l.branch_crm_id = $1 AND l.teacher_crm_ids = '[]'::jsonb
    `, [BRANCH_ID]);
    await pool.query(`
      INSERT INTO alpha_linking_issues
        (entity_type, alpha_id, raw_record_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
      SELECT 'lesson', l.crm_id, l.raw_record_id,
             'lesson_without_subject', 'Lesson has no subject_id',
             $1, 'warning', 'Check AlphaCRM lesson record'
      FROM crm_lessons l
      WHERE l.branch_crm_id = $1 AND l.subject_crm_id IS NULL
    `, [BRANCH_ID]);

    // ── 5. Group subject inference ────────────────────────────────────────────
    await pool.query(
      `UPDATE crm_groups
       SET inferred_subject_crm_id=NULL, subject_inference_status=NULL, subject_inference_confidence=NULL
       WHERE branch_crm_id=$1`,
      [BRANCH_ID],
    );

    await pool.query(`
      WITH group_subject_counts AS (
        SELECT
          g.crm_id           AS group_id,
          l.subject_crm_id,
          COUNT(*)           AS lesson_count,
          SUM(COUNT(*)) OVER (PARTITION BY g.crm_id) AS total_lessons
        FROM crm_groups g
        JOIN crm_lessons l
          ON l.branch_crm_id = $1
          AND l.group_crm_ids @> jsonb_build_array(g.crm_id)
        WHERE g.branch_crm_id = $1 AND l.subject_crm_id IS NOT NULL
        GROUP BY g.crm_id, l.subject_crm_id
      ),
      dominant AS (
        SELECT group_id, subject_crm_id,
               lesson_count::float / total_lessons AS dominance
        FROM group_subject_counts
        WHERE lesson_count::float / total_lessons >= 0.7
      )
      UPDATE crm_groups
      SET inferred_subject_crm_id    = d.subject_crm_id,
          subject_inference_status   = 'primary',
          subject_inference_confidence = d.dominance
      FROM dominant d
      WHERE crm_groups.crm_id = d.group_id AND crm_groups.branch_crm_id = $1
    `, [BRANCH_ID]);

    await pool.query(`
      UPDATE crm_groups g
      SET subject_inference_status = 'ambiguous'
      WHERE g.branch_crm_id = $1
        AND g.inferred_subject_crm_id IS NULL
        AND EXISTS (
          SELECT 1 FROM crm_lessons l
          WHERE l.branch_crm_id = $1
            AND l.group_crm_ids @> jsonb_build_array(g.crm_id)
            AND l.subject_crm_id IS NOT NULL
        )
    `, [BRANCH_ID]);

    // ── 6. Group subject ambiguity issues ─────────────────────────────────────
    await pool.query(
      `DELETE FROM alpha_linking_issues WHERE issue_type='group_subject_ambiguous' AND missing_reference_type=$1`,
      [BRANCH_ID],
    );
    await pool.query(`
      INSERT INTO alpha_linking_issues
        (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
      SELECT 'group', g.crm_id, 'group_subject_ambiguous',
             'Group has multiple subjects with none dominating ≥70% — cannot infer primary subject',
             $1, 'warning', 'Review lesson subjects for this group in AlphaCRM'
      FROM crm_groups g
      WHERE g.branch_crm_id=$1 AND g.subject_inference_status='ambiguous'
    `, [BRANCH_ID]);

    const inferSummary = await pool.query<{ with_primary: string; ambiguous: string; still_without: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE inferred_subject_crm_id IS NOT NULL)   AS with_primary,
        COUNT(*) FILTER (WHERE subject_inference_status='ambiguous')   AS ambiguous,
        COUNT(*) FILTER (WHERE inferred_subject_crm_id IS NULL
          AND subject_inference_status IS DISTINCT FROM 'ambiguous')   AS still_without
      FROM crm_groups WHERE branch_crm_id=$1
    `, [BRANCH_ID]);
    const inf = inferSummary.rows[0]!;

    const msg = `P7.3: Normalized ${total} Atlas lessons — ${created} created, ${updated} updated. Group: ${stats.with_group} linked, ${stats.without_group} unlinked. Subject: ${stats.with_subject}. Visits: ${stats.with_visits} lessons / ${stats.total_visits} records. Inference: ${inf.with_primary} primary, ${inf.ambiguous} ambiguous, ${inf.still_without} unresolved.`;
    req.log.info(msg);
    await logSync("lessons", "success", msg, total, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      rawFound: total,
      created,
      updated,
      failed: 0,
      failedReasons: [],
      withoutGroup:   Number(stats.without_group),
      withoutTeacher: Number(stats.without_teacher),
      withoutSubject: Number(stats.without_subject),
      lessonsWithGroup:   Number(stats.with_group),
      lessonsWithTeacher: Number(stats.with_teacher),
      lessonsWithSubject: Number(stats.with_subject),
      lessonsWithVisits:  Number(stats.with_visits),
      totalVisitsCount:   Number(stats.total_visits),
      earliestDate: stats.earliest_date,
      latestDate:   stats.latest_date,
      byMonth: monthsResult.rows,
      groupSubjectInference: {
        withPrimarySubject:  Number(inf.with_primary),
        ambiguous:           Number(inf.ambiguous),
        stillWithoutSubject: Number(inf.still_without),
      },
      lifecycleSummary: { completed: total, scheduled: 0, cancelled: 0, moved: 0, unknown: 0 },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "normalize-lessons-from-raw failed");
    await logSync("lessons", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, rawFound: 0, created: 0, updated: 0, failed: 0 });
  }
});

// POST /api/sync/extract-attendance-from-raw
router.post("/sync/extract-attendance-from-raw", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("P7.4: Extracting Atlas attendance from crm_lessons.visits_raw");
  const BRANCH_ID = "6";

  try {
    // ── 1. Single SQL upsert — unnest visits_raw across all 15,291 lessons ───
    const upsertResult = await pool.query<{ created: string; updated: string }>(`
      WITH upserted AS (
        INSERT INTO crm_attendance (
          branch_id, lesson_id, lesson_alpha_id, raw_lesson_record_id,
          visit_alpha_id, visit_index,
          student_alpha_id, student_id, family_id,
          group_alpha_id, subject_alpha_id, teacher_alpha_ids,
          is_attend_raw, visit_status_normalized, is_present, is_absent,
          absence_reason_id, absence_reason_name, absence_reason_normalized,
          commission, ctt_id, visit_note,
          lesson_date, lesson_start_time, lesson_end_time,
          source_payload, payload_hash, sync_source, created_at, updated_at
        )
        SELECT
          l.branch_crm_id,
          l.id,
          l.crm_id,
          l.raw_record_id,
          v->>'id',
          (ord - 1)::int,
          v->>'customer_id',
          s.id,
          sp.family_id,
          l.group_crm_id,
          l.subject_crm_id,
          l.teacher_crm_ids,
          (v->>'is_attend')::int,
          CASE v->>'is_attend' WHEN '1' THEN 'present' WHEN '0' THEN 'absent' ELSE 'unknown' END,
          v->>'is_attend' = '1',
          v->>'is_attend' = '0',
          v->>'reason_id',
          NULLIF(v->>'reason_name', ''),
          CASE v->>'reason_id' WHEN '1' THEN 'excused' WHEN '2' THEN 'unexcused' ELSE NULL END,
          CASE WHEN v->>'commission' IS NOT NULL
               THEN (v->>'commission')::numeric ELSE NULL END,
          v->>'ctt_id',
          NULLIF(v->>'note', ''),
          l.lesson_date,
          l.time_from,
          l.time_to,
          v,
          md5(v::text),
          'alpha_lesson_details',
          NOW(),
          NOW()
        FROM crm_lessons l
        CROSS JOIN LATERAL jsonb_array_elements(l.visits_raw) WITH ORDINALITY AS visits(v, ord)
        LEFT JOIN crm_students s
          ON s.crm_id = v->>'customer_id' AND s.branch_crm_id = $1
        LEFT JOIN student_profiles sp
          ON sp.student_crm_id = v->>'customer_id'
        WHERE l.branch_crm_id = $1
          AND l.raw_record_id IS NOT NULL
          AND l.visits_raw IS NOT NULL
          AND jsonb_array_length(l.visits_raw) > 0
        ON CONFLICT (lesson_alpha_id, visit_alpha_id) DO UPDATE SET
          student_id              = EXCLUDED.student_id,
          family_id               = EXCLUDED.family_id,
          group_alpha_id          = EXCLUDED.group_alpha_id,
          subject_alpha_id        = EXCLUDED.subject_alpha_id,
          teacher_alpha_ids       = EXCLUDED.teacher_alpha_ids,
          is_attend_raw           = EXCLUDED.is_attend_raw,
          visit_status_normalized = EXCLUDED.visit_status_normalized,
          is_present              = EXCLUDED.is_present,
          is_absent               = EXCLUDED.is_absent,
          absence_reason_id       = EXCLUDED.absence_reason_id,
          absence_reason_name     = EXCLUDED.absence_reason_name,
          absence_reason_normalized = EXCLUDED.absence_reason_normalized,
          commission              = EXCLUDED.commission,
          ctt_id                  = EXCLUDED.ctt_id,
          visit_note              = EXCLUDED.visit_note,
          source_payload          = EXCLUDED.source_payload,
          payload_hash            = EXCLUDED.payload_hash,
          updated_at              = NOW()
        RETURNING (xmax = 0) AS was_inserted
      )
      SELECT
        COUNT(*) FILTER (WHERE was_inserted)     AS created,
        COUNT(*) FILTER (WHERE NOT was_inserted) AS updated
      FROM upserted
    `, [BRANCH_ID]);

    const created = Number(upsertResult.rows[0]?.created ?? 0);
    const updated = Number(upsertResult.rows[0]?.updated ?? 0);
    const total   = created + updated;
    req.log.info({ created, updated, total }, "P7.4: Attendance upserted");

    // ── 2. Stats ──────────────────────────────────────────────────────────────
    const statsResult = await pool.query<{
      total: string; linked_student: string; not_linked_student: string;
      linked_family: string; not_linked_family: string;
      status_present: string; status_absent: string; status_unknown: string;
      excused: string; unexcused: string;
      distinct_lessons: string; distinct_student_alphas: string;
    }>(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE student_id IS NOT NULL)       AS linked_student,
        COUNT(*) FILTER (WHERE student_id IS NULL)           AS not_linked_student,
        COUNT(*) FILTER (WHERE family_id IS NOT NULL)        AS linked_family,
        COUNT(*) FILTER (WHERE family_id IS NULL)            AS not_linked_family,
        COUNT(*) FILTER (WHERE visit_status_normalized='present') AS status_present,
        COUNT(*) FILTER (WHERE visit_status_normalized='absent')  AS status_absent,
        COUNT(*) FILTER (WHERE visit_status_normalized='unknown') AS status_unknown,
        COUNT(*) FILTER (WHERE absence_reason_normalized='excused')   AS excused,
        COUNT(*) FILTER (WHERE absence_reason_normalized='unexcused') AS unexcused,
        COUNT(DISTINCT lesson_id)                            AS distinct_lessons,
        COUNT(DISTINCT student_alpha_id)                     AS distinct_student_alphas
      FROM crm_attendance WHERE branch_id = $1
    `, [BRANCH_ID]);
    const st = statsResult.rows[0]!;

    // ── 3. Distinct raw absence reasons ───────────────────────────────────────
    const reasonsResult = await pool.query<{ reason_id: string; reason_name: string; cnt: string }>(`
      SELECT absence_reason_id AS reason_id, absence_reason_name AS reason_name, COUNT(*) AS cnt
      FROM crm_attendance WHERE branch_id = $1 AND absence_reason_id IS NOT NULL
      GROUP BY 1,2 ORDER BY cnt DESC
    `, [BRANCH_ID]);

    // ── 4. Linking issues for unresolved student_alpha_ids ───────────────────
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE issue_type IN ('attendance_student_not_found')
         AND missing_reference_type = $1`,
      [BRANCH_ID],
    );
    await pool.query(`
      INSERT INTO alpha_linking_issues
        (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
      SELECT DISTINCT ON (a.student_alpha_id)
             'attendance', a.student_alpha_id,
             'attendance_student_not_found',
             'customer_id ' || a.student_alpha_id || ' has attendance records but no normalized student in Atlas (likely registered in another branch)',
             $1, 'info',
             'Student may be registered in a different branch. Check cross-branch student data.'
      FROM crm_attendance a
      WHERE a.branch_id = $1 AND a.student_id IS NULL AND a.student_alpha_id IS NOT NULL
    `, [BRANCH_ID]);

    const msg = `P7.4: Extracted ${total} attendance records — ${created} created, ${updated} updated. Linked to student: ${st.linked_student}/${total}. Linked to family: ${st.linked_family}/${total}. Status: ${st.status_present} present, ${st.status_absent} absent, ${st.status_unknown} unknown. Distinct lessons: ${st.distinct_lessons}, distinct customers: ${st.distinct_student_alphas}.`;
    req.log.info(msg);
    await logSync("attendance", "success", msg, total, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      embeddedVisitsFound: total,
      created,
      updated,
      failed: 0,
      failedReasons: [],
      linkedToStudent:    Number(st.linked_student),
      notLinkedToStudent: Number(st.not_linked_student),
      linkedToFamily:     Number(st.linked_family),
      notLinkedToFamily:  Number(st.not_linked_family),
      statusPresent:  Number(st.status_present),
      statusAbsent:   Number(st.status_absent),
      statusUnknown:  Number(st.status_unknown),
      excusedAbsences:   Number(st.excused),
      unexcusedAbsences: Number(st.unexcused),
      distinctLessons:        Number(st.distinct_lessons),
      distinctStudentAlphaIds: Number(st.distinct_student_alphas),
      absenceReasons: reasonsResult.rows,
      rawStatusValues: [
        { value: '1', label: 'present',  count: Number(st.status_present) },
        { value: '0', label: 'absent',   count: Number(st.status_absent)  },
        { value: null, label: 'unknown', count: Number(st.status_unknown) },
      ],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "extract-attendance-from-raw failed");
    await logSync("attendance", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, embeddedVisitsFound: 0, created: 0, updated: 0, failed: 0 });
  }
});

// POST /api/sync/normalize-payments-from-raw
// P7.5 — Bulk normalize 22,315 Atlas raw payments into crm_payments via single CTE upsert
router.post("/sync/normalize-payments-from-raw", async (req, res): Promise<void> => {
  const startedAt = new Date();
  const BRANCH_ID = "6";
  req.log.info("P7.5: normalize-payments-from-raw starting");

  try {
    // ── Phase 1: Bulk CTE upsert ────────────────────────────────────────────
    const upsertResult = await pool.query<{ inserted: boolean }>(
      `WITH raw_payments AS (
         SELECT
           r.id             AS raw_record_id,
           r.alpha_id       AS alpha_payment_id,
           r.payload_hash   AS source_payload_hash,
           r.source_payload AS p
         FROM alpha_raw_records r
         WHERE r.entity_type = 'payments' AND r.branch_id = $1
       ),
       parsed AS (
         SELECT
           raw_record_id,
           alpha_payment_id,
           source_payload_hash,
           p,
           NULLIF(NULLIF(NULLIF(p->>'customer_id', '0'), ''), 'null')    AS customer_alpha_id,
           NULLIF(TRIM(p->>'payer_name'), '')                             AS payer_name_val,
           NULLIF(TRIM(p->>'note'), '')                                   AS note_val,
           CASE WHEN p->>'document_date' ~ '^[0-9]{2}[.][0-9]{2}[.][0-9]{4}$'
                THEN to_date(p->>'document_date', 'DD.MM.YYYY')
           END                                                             AS document_date_val,
           CASE WHEN LENGTH(COALESCE(p->>'created_at', '')) > 5
                THEN (p->>'created_at')::timestamptz END                  AS created_at_val,
           CASE WHEN LENGTH(COALESCE(p->>'updated_at', '')) > 5
                THEN (p->>'updated_at')::timestamptz END                  AS updated_at_val,
           CASE WHEN p->>'income' ~ '^-?[0-9]+(\\.[0-9]+)?$'
                THEN (p->>'income')::numeric END                          AS income_val,
           p->>'pay_type_id'                                              AS pay_type_id_raw,
           p->>'pay_type_name'                                            AS pay_type_name_raw,
           NULLIF(NULLIF(p->>'pay_item_id', ''), 'null')                 AS pay_item_id_val,
           NULLIF(p->>'pay_account_id', '')                               AS account_raw_val,
           p->>'ctt_id'                                                   AS ctt_id_val,
           CASE WHEN p->>'group_id' IS NOT NULL
                     AND p->>'group_id' NOT IN ('null','0','')
                THEN p->>'group_id' END                                   AS group_alpha_id_val,
           COALESCE((p->>'is_confirmed')::int, 0) = 1                    AS is_confirmed_val
         FROM raw_payments
       ),
       classified AS (
         SELECT
           *,
           CASE pay_type_id_raw
             WHEN '1'  THEN 'income'
             WHEN '5'  THEN 'refund'
             WHEN '6'  THEN 'correction'
             WHEN '11' THEN 'income'
             WHEN '12' THEN 'outcome'
             ELSE 'unknown'
           END                                                             AS payment_type_norm,
           CASE WHEN pay_type_id_raw IN ('1','6','11') THEN income_val END AS income_only,
           CASE WHEN pay_type_id_raw IN ('5','12')     THEN income_val END AS outcome_val,
           CASE pay_type_id_raw
             WHEN '1'  THEN 'income'
             WHEN '5'  THEN 'refund'
             WHEN '6'  THEN 'correction'
             WHEN '11' THEN 'income'
             WHEN '12' THEN 'outcome'
             ELSE 'unknown'
           END                                                             AS direction_val,
           (pay_type_id_raw = '6')                                        AS is_correction_val,
           (pay_type_id_raw = '5' OR (pay_type_id_raw = '6' AND COALESCE(income_val, 0) < 0)) AS is_refund_val,
           (NOT COALESCE(COALESCE((p->>'is_confirmed')::int, 0) = 1, FALSE)) AS is_cancelled_val,
           CASE WHEN income_val IS NULL THEN 'parse_error' ELSE 'normalized' END AS norm_status
         FROM parsed
       ),
       linked AS (
         SELECT
           c.*,
           s.id          AS linked_student_id,
           si.id         AS linked_identity_id,
           sp.family_id  AS linked_family_id
         FROM classified c
         LEFT JOIN crm_students s
           ON s.crm_id = c.customer_alpha_id AND s.branch_crm_id = $1
         LEFT JOIN crm_student_identities si
           ON si.alpha_customer_id = c.customer_alpha_id
           AND si.branch_id = $1
           AND s.id IS NULL
         LEFT JOIN student_profiles sp
           ON sp.student_crm_id = c.customer_alpha_id
       )
       INSERT INTO crm_payments (
         crm_id, branch_crm_id, student_crm_id, amount, payment_date, type, comment, raw, synced_at,
         raw_record_id, source_payload_hash,
         document_date, created_at_alpha, updated_at_alpha,
         income, outcome, direction,
         payment_type_id_raw, payment_type_name_raw, payment_type_normalized,
         payer_name, account_raw, pay_item_id, ctt_id, group_alpha_id,
         is_confirmed, is_correction, is_refund, is_cancelled,
         normalization_status, sync_source,
         student_id, student_identity_id, family_id
       )
       SELECT
         alpha_payment_id,
         $1,
         customer_alpha_id,
         COALESCE(income_only, outcome_val),
         document_date_val,
         payment_type_norm,
         note_val,
         p,
         NOW(),
         raw_record_id,
         source_payload_hash,
         document_date_val,
         created_at_val,
         updated_at_val,
         income_only,
         outcome_val,
         direction_val,
         pay_type_id_raw,
         pay_type_name_raw,
         payment_type_norm,
         payer_name_val,
         account_raw_val,
         pay_item_id_val,
         ctt_id_val,
         group_alpha_id_val,
         is_confirmed_val,
         is_correction_val,
         is_refund_val,
         is_cancelled_val,
         norm_status,
         'alpha_payments',
         linked_student_id,
         linked_identity_id,
         linked_family_id
       FROM linked
       ON CONFLICT (crm_id) DO UPDATE SET
         branch_crm_id           = EXCLUDED.branch_crm_id,
         student_crm_id          = EXCLUDED.student_crm_id,
         amount                  = EXCLUDED.amount,
         payment_date            = EXCLUDED.payment_date,
         type                    = EXCLUDED.type,
         comment                 = EXCLUDED.comment,
         raw                     = EXCLUDED.raw,
         synced_at               = NOW(),
         raw_record_id           = EXCLUDED.raw_record_id,
         source_payload_hash     = EXCLUDED.source_payload_hash,
         document_date           = EXCLUDED.document_date,
         created_at_alpha        = EXCLUDED.created_at_alpha,
         updated_at_alpha        = EXCLUDED.updated_at_alpha,
         income                  = EXCLUDED.income,
         outcome                 = EXCLUDED.outcome,
         direction               = EXCLUDED.direction,
         payment_type_id_raw     = EXCLUDED.payment_type_id_raw,
         payment_type_name_raw   = EXCLUDED.payment_type_name_raw,
         payment_type_normalized = EXCLUDED.payment_type_normalized,
         payer_name              = EXCLUDED.payer_name,
         account_raw             = EXCLUDED.account_raw,
         pay_item_id             = EXCLUDED.pay_item_id,
         ctt_id                  = EXCLUDED.ctt_id,
         group_alpha_id          = EXCLUDED.group_alpha_id,
         is_confirmed            = EXCLUDED.is_confirmed,
         is_correction           = EXCLUDED.is_correction,
         is_refund               = EXCLUDED.is_refund,
         is_cancelled            = EXCLUDED.is_cancelled,
         normalization_status    = EXCLUDED.normalization_status,
         sync_source             = EXCLUDED.sync_source,
         student_id              = EXCLUDED.student_id,
         student_identity_id     = EXCLUDED.student_identity_id,
         family_id               = EXCLUDED.family_id
       RETURNING (xmax = 0) AS inserted`,
      [BRANCH_ID],
    );

    const created       = upsertResult.rows.filter(r => r.inserted).length;
    const updated       = upsertResult.rows.length - created;
    const totalNorm     = upsertResult.rows.length;
    req.log.info({ totalNorm, created, updated }, "P7.5: bulk upsert complete");

    // ── Phase 2: Post-normalization stats ────────────────────────────────────
    const stats = await pool.query<{
      total: string; parse_errors: string;
      no_customer: string; student_linked: string;
      identity_linked: string; family_linked: string; unlinked: string;
      income_total: string; outcome_total: string; correction_total: string;
      by_type: Array<{ type: string; cnt: string; total: string }>;
      earliest_date: string; latest_date: string;
    }>(
      `SELECT
         COUNT(*)::text                                                              AS total,
         COUNT(CASE WHEN normalization_status='parse_error' THEN 1 END)::text       AS parse_errors,
         COUNT(CASE WHEN student_crm_id IS NULL THEN 1 END)::text                   AS no_customer,
         COUNT(CASE WHEN student_id IS NOT NULL THEN 1 END)::text                   AS student_linked,
         COUNT(CASE WHEN student_identity_id IS NOT NULL THEN 1 END)::text          AS identity_linked,
         COUNT(CASE WHEN family_id IS NOT NULL THEN 1 END)::text                    AS family_linked,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL THEN 1 END)::text AS unlinked,
         COALESCE(SUM(CASE WHEN direction='income'     THEN income     END), 0)::text AS income_total,
         COALESCE(SUM(CASE WHEN direction='outcome'    THEN outcome    END), 0)::text AS outcome_total,
         COALESCE(SUM(CASE WHEN direction='correction' THEN income     END), 0)::text AS correction_total,
         MIN(document_date)::text AS earliest_date,
         MAX(document_date)::text AS latest_date
       FROM crm_payments WHERE branch_crm_id = $1`,
      [BRANCH_ID],
    );
    const st = stats.rows[0];

    // Type breakdown
    const typeBreakdown = await pool.query<{ payment_type_normalized: string; cnt: string; total_income: string; total_outcome: string }>(
      `SELECT
         COALESCE(payment_type_normalized, 'unknown') AS payment_type_normalized,
         COUNT(*)::text AS cnt,
         COALESCE(SUM(income),  0)::text AS total_income,
         COALESCE(SUM(outcome), 0)::text AS total_outcome
       FROM crm_payments WHERE branch_crm_id=$1
       GROUP BY payment_type_normalized ORDER BY COUNT(*) DESC`,
      [BRANCH_ID],
    );

    // ── Phase 3: Aggregate linking issues ────────────────────────────────────
    // Delete old payment issues for this branch first
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE entity_type='payment'
         AND missing_reference_type=$1`,
      [BRANCH_ID],
    );
    // Also delete by issue_type prefix
    await pool.query(
      `DELETE FROM alpha_linking_issues
       WHERE issue_type LIKE 'payment_%'
         AND alpha_id IN (SELECT crm_id FROM crm_payments WHERE branch_crm_id=$1)`,
      [BRANCH_ID],
    );

    // payment_without_customer_alpha_id (aggregate — one issue)
    const noCustomerCnt = Number(st.no_customer ?? 0);
    if (noCustomerCnt > 0) {
      const examples = await pool.query<{ crm_id: string }>(
        `SELECT crm_id FROM crm_payments WHERE branch_crm_id=$1 AND student_crm_id IS NULL LIMIT 5`, [BRANCH_ID],
      );
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
         VALUES ('payment','__BRANCH_6_NO_CUSTOMER__','payment_without_customer_alpha_id',
           $2, $1, 'warning',
           'Some payments (encashments / internal corrections) have no customer_id. This is expected for pay_type_id=12.')
         ON CONFLICT DO NOTHING`,
        [BRANCH_ID, `${noCustomerCnt} payments have no customer_id. Examples: ${examples.rows.map(r => r.crm_id).join(', ')}`],
      );
    }

    // payment_customer_not_found (per customer_id, aggregated)
    const notFoundCustomers = await pool.query<{ customer_id: string; cnt: string }>(
      `SELECT student_crm_id AS customer_id, COUNT(*)::text AS cnt
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND student_crm_id IS NOT NULL
         AND student_id IS NULL
         AND student_identity_id IS NULL
       GROUP BY student_crm_id ORDER BY COUNT(*) DESC`,
      [BRANCH_ID],
    );
    for (const row of notFoundCustomers.rows.slice(0, 50)) {
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
         VALUES ('payment',$1,'payment_customer_not_found',
           $2, $3, 'warning',
           'Customer may be from another branch not yet normalized. Run pull-students-all-branches.')
         ON CONFLICT DO NOTHING`,
        [row.customer_id, `customer_id=${row.customer_id} has ${row.cnt} payments but no match in crm_students or crm_student_identities.`, BRANCH_ID],
      );
    }

    // payment_linked_to_historical_identity (aggregate)
    const histIdentityCnt = Number(st.identity_linked ?? 0);
    if (histIdentityCnt > 0) {
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
         VALUES ('payment','__BRANCH_6_HISTORICAL__','payment_linked_to_historical_identity',
           $2, $1, 'info',
           'Historical payments preserved. Customer confirmed hard-deleted from AlphaCRM (P7.4.3c).')
         ON CONFLICT DO NOTHING`,
        [BRANCH_ID, `${histIdentityCnt} payments are linked to historical identity placeholders (hard-deleted customers).`],
      );
    }

    // payment_suspicious_high_amount (per payment, up to 20)
    const suspicious = await pool.query<{ crm_id: string; income: string; outcome: string; document_date: string; student_crm_id: string }>(
      `SELECT crm_id, income::text, outcome::text, document_date::text, student_crm_id
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND ABS(COALESCE(income, outcome, 0)) > 100000
       ORDER BY ABS(COALESCE(income, outcome, 0)) DESC
       LIMIT 20`,
      [BRANCH_ID],
    );
    for (const row of suspicious.rows) {
      const amt = row.income ?? row.outcome;
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
         VALUES ('payment',$1,'payment_suspicious_high_amount',
           $2, $3, 'warning',
           'Verify against bank transaction. May be encashment, data entry error, or legitimate large payment.')
         ON CONFLICT DO NOTHING`,
        [row.crm_id, `Payment ${row.crm_id}: amount ${amt} on ${row.document_date ?? '?'} customer_id=${row.student_crm_id ?? 'none'}`, BRANCH_ID],
      );
    }

    // payment_unknown_type (aggregate)
    const unknownTypeCnt = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM crm_payments WHERE branch_crm_id=$1 AND payment_type_normalized='unknown'`, [BRANCH_ID],
    );
    if (Number(unknownTypeCnt.rows[0]?.cnt ?? 0) > 0) {
      const examples2 = await pool.query<{ pay_type_id_raw: string; pay_type_name_raw: string; cnt: string }>(
        `SELECT payment_type_id_raw AS pay_type_id_raw, payment_type_name_raw AS pay_type_name_raw, COUNT(*)::text AS cnt
         FROM crm_payments WHERE branch_crm_id=$1 AND payment_type_normalized='unknown'
         GROUP BY payment_type_id_raw, payment_type_name_raw LIMIT 5`, [BRANCH_ID],
      );
      await pool.query(
        `INSERT INTO alpha_linking_issues
           (entity_type, alpha_id, issue_type, issue_message, missing_reference_type, severity, suggested_action)
         VALUES ('payment','__BRANCH_6_UNKNOWN_TYPE__','payment_unknown_type',
           $2, $1, 'warning',
           'Add mapping for unknown pay_type_id values in normalize-payments-from-raw.')
         ON CONFLICT DO NOTHING`,
        [BRANCH_ID, `${unknownTypeCnt.rows[0]?.cnt} payments with unknown type. Examples: ${examples2.rows.map(r => `${r.pay_type_id_raw}/${r.pay_type_name_raw}(${r.cnt})`).join(', ')}`],
      );
    }

    const msg = `P7.5 complete. Total: ${totalNorm}, created: ${created}, updated: ${updated}. ` +
      `Linked: ${st.student_linked} students, ${st.identity_linked} identities, ${st.family_linked} families. ` +
      `Unlinked: ${st.unlinked}. Parse errors: ${st.parse_errors}. ` +
      `Income: ${Number(st.income_total).toLocaleString()}, Outcome: ${Number(st.outcome_total).toLocaleString()}, Correction sum: ${Number(st.correction_total).toLocaleString()}. ` +
      `Date range: ${st.earliest_date} → ${st.latest_date}.`;
    req.log.info(msg);
    await logSync("payments", "success", msg, totalNorm, undefined, startedAt);

    res.json({
      success:            true,
      message:            msg,
      raw:                22315,
      total:              totalNorm,
      created,
      updated,
      failed:             Number(st.parse_errors ?? 0),
      linkedToStudent:    Number(st.student_linked ?? 0),
      linkedToIdentity:   Number(st.identity_linked ?? 0),
      linkedToFamily:     Number(st.family_linked ?? 0),
      unlinked:           Number(st.unlinked ?? 0),
      parseErrors:        Number(st.parse_errors ?? 0),
      noCustomerId:       Number(st.no_customer ?? 0),
      incomeTotalCrm:     Number(st.income_total ?? 0),
      outcomeTotalCrm:    Number(st.outcome_total ?? 0),
      correctionTotalCrm: Number(st.correction_total ?? 0),
      earliestDate:       st.earliest_date,
      latestDate:         st.latest_date,
      typeBreakdown:      typeBreakdown.rows,
      notFoundCustomers:  notFoundCustomers.rows.length,
      suspiciousHigh:     suspicious.rows.length,
      warning:            "AlphaCRM payments are NOT bank-reconciled financial truth. These are operational records from AlphaCRM CRM system only.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "normalize-payments-from-raw failed");
    await logSync("payments", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message });
  }
});

// POST /api/sync/p76-cleanup-payments
// P7.6 — Risk-flag, safe-relink, and write alpha_linking_issues for Atlas payments
// Idempotent: clears all entity_type='payment' issues for the branch before re-creating.
router.post("/sync/p76-cleanup-payments", async (req, res): Promise<void> => {
  const startedAt = new Date();
  const BRANCH_ID = "6";
  req.log.info("P7.6: p76-cleanup-payments starting");

  try {
    // ── Phase 0: snapshot counts before ──────────────────────────────────────
    const snap0 = await pool.query<{ unknown_cnt: string; unlinked_cnt: string }>(
      `SELECT
         COUNT(CASE WHEN payment_type_normalized IS NULL OR payment_type_normalized='unknown' THEN 1 END)::text AS unknown_cnt,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL AND family_id IS NULL THEN 1 END)::text AS unlinked_cnt
       FROM crm_payments WHERE branch_crm_id=$1`,
      [BRANCH_ID],
    );
    const unknownBefore  = Number(snap0.rows[0]?.unknown_cnt  ?? 0);
    const unlinkedBefore = Number(snap0.rows[0]?.unlinked_cnt ?? 0);

    // ── Phase 1: Set reconciliation_risk_level + finance_treatment_hint ──────
    const riskResult = await pool.query(
      `UPDATE crm_payments SET
         reconciliation_risk_level = CASE
           WHEN payment_type_normalized = 'outcome'                                       THEN 'high'
           WHEN payment_type_normalized IS NULL OR payment_type_normalized = 'unknown'    THEN 'high'
           WHEN payment_type_normalized = 'refund'                                        THEN 'medium'
           WHEN payment_type_normalized = 'correction'
                AND ABS(COALESCE(income, 0)) > 100000                                     THEN 'high'
           WHEN payment_type_normalized = 'correction'                                    THEN 'medium'
           WHEN payment_type_normalized = 'income'
                AND (student_id IS NOT NULL OR student_identity_id IS NOT NULL)           THEN 'low'
           WHEN payment_type_normalized = 'income'                                        THEN 'medium'
           ELSE 'unknown'
         END,
         finance_treatment_hint = CASE
           WHEN payment_type_normalized = 'outcome'                                       THEN 'collection_internal'
           WHEN payment_type_normalized IS NULL OR payment_type_normalized = 'unknown'    THEN 'manual_review'
           WHEN payment_type_normalized = 'refund'                                        THEN 'refund_to_customer'
           WHEN payment_type_normalized = 'correction'                                    THEN 'operational_adjustment'
           WHEN payment_type_normalized = 'income'                                        THEN 'operational_income'
           ELSE 'manual_review'
         END
       WHERE branch_crm_id=$1`,
      [BRANCH_ID],
    );
    const riskFlagged = riskResult.rowCount ?? 0;
    req.log.info({ riskFlagged }, "P7.6: risk flags set");

    // ── Phase 2a: Safe relink → active/inactive students ─────────────────────
    const relinkStudentsRes = await pool.query<{ relinked: string }>(
      `WITH relinked AS (
         UPDATE crm_payments p SET
           student_id = s.id
         FROM crm_students s
         WHERE p.branch_crm_id = $1
           AND p.student_crm_id = s.crm_id
           AND s.branch_crm_id  = $1
           AND p.student_id IS NULL
           AND p.student_identity_id IS NULL
         RETURNING p.crm_id
       ) SELECT COUNT(*)::text AS relinked FROM relinked`,
      [BRANCH_ID],
    );
    const relinkStudentsCnt = Number(relinkStudentsRes.rows[0]?.relinked ?? 0);

    // ── Phase 2b: Safe relink → historical ghost identities ──────────────────
    const relinkIdentitiesRes = await pool.query<{ relinked: string }>(
      `WITH relinked AS (
         UPDATE crm_payments p SET
           student_identity_id = si.id
         FROM crm_student_identities si
         WHERE p.branch_crm_id     = $1
           AND p.student_crm_id    = si.alpha_customer_id
           AND si.branch_id        = $1
           AND p.student_id        IS NULL
           AND p.student_identity_id IS NULL
         RETURNING p.crm_id
       ) SELECT COUNT(*)::text AS relinked FROM relinked`,
      [BRANCH_ID],
    );
    const relinkIdentitiesCnt = Number(relinkIdentitiesRes.rows[0]?.relinked ?? 0);

    // ── Phase 2c: Back-fill family_id via student_profiles ───────────────────
    const relinkFamiliesRes = await pool.query<{ relinked: string }>(
      `WITH relinked AS (
         UPDATE crm_payments p SET
           family_id = sp.family_id
         FROM student_profiles sp
         WHERE p.branch_crm_id   = $1
           AND p.student_crm_id  = sp.student_crm_id
           AND p.family_id       IS NULL
           AND sp.family_id      IS NOT NULL
         RETURNING p.crm_id
       ) SELECT COUNT(*)::text AS relinked FROM relinked`,
      [BRANCH_ID],
    );
    const relinkFamiliesCnt = Number(relinkFamiliesRes.rows[0]?.relinked ?? 0);
    req.log.info({ relinkStudentsCnt, relinkIdentitiesCnt, relinkFamiliesCnt }, "P7.6: relink complete");

    // ── Phase 3: Snapshot counts after relink ────────────────────────────────
    const snap1 = await pool.query<{ unknown_cnt: string; unlinked_cnt: string }>(
      `SELECT
         COUNT(CASE WHEN payment_type_normalized IS NULL OR payment_type_normalized='unknown' THEN 1 END)::text AS unknown_cnt,
         COUNT(CASE WHEN student_id IS NULL AND student_identity_id IS NULL AND family_id IS NULL THEN 1 END)::text AS unlinked_cnt
       FROM crm_payments WHERE branch_crm_id=$1`,
      [BRANCH_ID],
    );
    const unknownAfter  = Number(snap1.rows[0]?.unknown_cnt  ?? 0);
    const unlinkedAfter = Number(snap1.rows[0]?.unlinked_cnt ?? 0);

    // ── Phase 4: Write alpha_linking_issues (idempotent: clear first) ─────────
    await pool.query(
      `DELETE FROM alpha_linking_issues WHERE entity_type='payment' AND branch_id=$1`,
      [BRANCH_ID],
    );

    const issues: Array<[string, string, string, string, string]> = [];

    // 4a. Unknown / legacy type payments
    const unknownRows = await pool.query<{ crm_id: string }>(
      `SELECT crm_id FROM crm_payments
       WHERE branch_crm_id=$1
         AND (payment_type_normalized IS NULL OR payment_type_normalized='unknown')`,
      [BRANCH_ID],
    );
    for (const r of unknownRows.rows) {
      issues.push([
        r.crm_id, "payment_unknown_type",
        `Payment ${r.crm_id}: unknown/missing pay_type. Legacy pre-P7.5 record — NULL amount, date, type.`,
        "warning",
        "Manual review: verify in AlphaCRM or archive if stale.",
      ]);
    }

    // 4b. Unlinked income/refund with customer_id not found
    const unlinkedIncomeRows = await pool.query<{ crm_id: string; student_crm_id: string; income: string }>(
      `SELECT crm_id, student_crm_id, COALESCE(income,0)::text AS income
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND student_id IS NULL AND student_identity_id IS NULL
         AND student_crm_id IS NOT NULL
         AND payment_type_normalized IN ('income','refund')`,
      [BRANCH_ID],
    );
    for (const r of unlinkedIncomeRows.rows) {
      issues.push([
        r.crm_id, "payment_customer_not_found",
        `Payment ${r.crm_id}: customer_id=${r.student_crm_id} not in students/identities. income=${r.income}.`,
        "warning",
        "Check AlphaCRM: customer may be deleted, merged, or from another branch.",
      ]);
    }

    // 4c. Corrections without linked customer
    const corrNoCustomerRows = await pool.query<{ crm_id: string; student_crm_id: string; income: string }>(
      `SELECT crm_id, COALESCE(student_crm_id,'') AS student_crm_id, COALESCE(income,0)::text AS income
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND payment_type_normalized='correction'
         AND student_id IS NULL AND student_identity_id IS NULL
         AND student_crm_id IS NOT NULL`,
      [BRANCH_ID],
    );
    for (const r of corrNoCustomerRows.rows) {
      issues.push([
        r.crm_id, "payment_correction_high_risk",
        `Correction ${r.crm_id}: customer_id=${r.student_crm_id} not found. amount=${r.income}.`,
        "warning",
        "Verify correction in AlphaCRM. May be system adjustment without client reference.",
      ]);
    }

    // 4d. Refund without linked customer
    const refundRows = await pool.query<{ crm_id: string; outcome: string }>(
      `SELECT crm_id, COALESCE(outcome,0)::text AS outcome
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND payment_type_normalized='refund'
         AND student_id IS NULL AND student_identity_id IS NULL`,
      [BRANCH_ID],
    );
    for (const r of refundRows.rows) {
      issues.push([
        r.crm_id, "payment_refund_review",
        `Refund ${r.crm_id}: outcome=${r.outcome}, customer not linked. Verify recipient.`,
        "info",
        "Check AlphaCRM for refund recipient. May be for deleted/inactive student.",
      ]);
    }

    // 4e. Collection/encashment (outcome, no customer) — high risk
    const collectionRows = await pool.query<{ crm_id: string; outcome: string; doc: string }>(
      `SELECT crm_id, COALESCE(outcome,0)::text AS outcome, COALESCE(document_date::text,'') AS doc
       FROM crm_payments
       WHERE branch_crm_id=$1 AND payment_type_normalized='outcome'`,
      [BRANCH_ID],
    );
    for (const r of collectionRows.rows) {
      issues.push([
        r.crm_id, "payment_collection_high_risk",
        `Encashment ${r.crm_id}: outcome=${r.outcome}, date=${r.doc}. No customer — internal cash movement.`,
        "warning",
        "Exclude from client revenue. Mark as collection_internal. Verify against bank statement.",
      ]);
    }

    // 4f. Suspicious high amounts (>100K)
    const suspRows = await pool.query<{ crm_id: string; income: string; outcome: string; dir: string }>(
      `SELECT crm_id,
              COALESCE(income,0)::text  AS income,
              COALESCE(outcome,0)::text AS outcome,
              COALESCE(direction,'?')   AS dir
       FROM crm_payments
       WHERE branch_crm_id=$1
         AND ABS(COALESCE(income, outcome, 0)) > 100000
       ORDER BY ABS(COALESCE(income, outcome, 0)) DESC
       LIMIT 150`,
      [BRANCH_ID],
    );
    for (const r of suspRows.rows) {
      issues.push([
        r.crm_id, "payment_suspicious_amount",
        `Payment ${r.crm_id} (${r.dir}): income=${r.income}, outcome=${r.outcome} — amount >100K.`,
        "warning",
        "Verify against bank transaction. May be annual fee, encashment, or data error.",
      ]);
    }

    // 4g. Possible duplicates: same customer+date+amount, count > 3
    const dupRows = await pool.query<{ first_id: string; student_crm_id: string; doc: string; income: string; dup_cnt: string }>(
      `SELECT MIN(crm_id)::text AS first_id, student_crm_id,
              document_date::text AS doc, income::text, COUNT(*)::text AS dup_cnt
       FROM crm_payments
       WHERE branch_crm_id=$1 AND income > 0
         AND student_crm_id IS NOT NULL AND document_date IS NOT NULL
       GROUP BY student_crm_id, document_date, income
       HAVING COUNT(*) > 3
       ORDER BY COUNT(*) DESC
       LIMIT 30`,
      [BRANCH_ID],
    );
    for (const r of dupRows.rows) {
      issues.push([
        r.first_id, "payment_possible_duplicate",
        `${r.dup_cnt} payments for customer ${r.student_crm_id} on ${r.doc} each = ${r.income}. Review for installments vs duplicates.`,
        "info",
        "Do not deduplicate without verifying in AlphaCRM. May be legitimate installment payments.",
      ]);
    }

    // Batch INSERT all issues in chunks of 50 to avoid parameter count limits
    let issuesCreated = 0;
    const CHUNK_SIZE = 50;
    for (let start = 0; start < issues.length; start += CHUNK_SIZE) {
      const chunk = issues.slice(start, start + CHUNK_SIZE);
      const vals = chunk
        .map((_, i) => {
          const b = i * 6;
          return `($${b+1},'payment',$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`;
        })
        .join(",");
      const flat = chunk.flatMap(([alpha_id, issue_type, msg, severity, action]) => [
        alpha_id, issue_type, msg, severity, action, BRANCH_ID,
      ]);
      await pool.query(
        `INSERT INTO alpha_linking_issues (alpha_id, entity_type, issue_type, issue_message, severity, suggested_action, branch_id)
         VALUES ${vals}`,
        flat,
      );
      issuesCreated += chunk.length;
    }
    req.log.info({ issuesCreated }, "P7.6: issues written");

    await logSync("payments", "success",
      `P7.6 cleanup: risk-flagged=${riskFlagged}, relinked=${relinkStudentsCnt}s+${relinkIdentitiesCnt}i, issues=${issuesCreated}`,
      issuesCreated, { riskFlagged, relinkStudentsCnt, relinkIdentitiesCnt }, startedAt,
    );

    res.json({
      success:          true,
      message:          `P7.6 complete. Risk-flagged: ${riskFlagged}. Relinked: ${relinkStudentsCnt} students + ${relinkIdentitiesCnt} identities + ${relinkFamiliesCnt} families. Issues written: ${issuesCreated}. Unknown: ${unknownBefore}→${unknownAfter}. Unlinked: ${unlinkedBefore}→${unlinkedAfter}.`,
      riskFlagged,
      relinkStudents:   relinkStudentsCnt,
      relinkIdentities: relinkIdentitiesCnt,
      relinkFamilies:   relinkFamiliesCnt,
      unknownBefore,
      unknownAfter,
      unlinkedBefore,
      unlinkedAfter,
      issuesCreated,
      warning: "AlphaCRM payments are NOT bank-reconciled financial truth.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "p76-cleanup-payments failed");
    res.status(500).json({ success: false, message });
  }
});

function toCrmDateStr(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).split(" ")[0];
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split(".");
    return `${y}-${m}-${d}`;
  }
  return s || null;
}

router.post("/sync/payments-atlas", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Syncing Atlas payments");

  const todayStr = new Date().toISOString().slice(0, 10);
  const dateFrom: string = req.body?.date_from ?? "2024-01-01";
  const dateTo: string = req.body?.date_to ?? todayStr;

  try {
    const atlasBranchId = await getAtlasBranchId();
    if (!atlasBranchId) {
      const msg = "Atlas branch not found. Run 'Sync Branches' and 'Find Atlas' first.";
      await logSync("payments", "error", msg, 0, undefined, startedAt);
      res.json({ success: false, message: msg, recordsCount: 0, atlasBranchId: null, data: null });
      return;
    }

    const payPath: string = req.body?.payments_path ?? await getSetting("payments_endpoint") ?? "1/pay/index";
    req.log.info({ payPath, dateFrom, dateTo }, "Using payments endpoint");
    const items = await crmGetAllPages<Record<string, unknown>>(payPath, {
      branch_id: Number(atlasBranchId),
      date_from: dateFrom,
      date_to: dateTo,
    });
    await saveSetting("sync_payments_date_from", dateFrom);
    await saveSetting("sync_payments_date_to", dateTo);

    let upserted = 0;
    for (const item of items) {
      const crmId = String(item["id"] ?? "");
      if (!crmId) continue;
      await db
        .insert(crmPaymentsTable)
        .values({
          crmId,
          branchCrmId: atlasBranchId,
          studentCrmId: item["customer_id"] ? String(item["customer_id"]) : null,
          amount: item["income"] != null ? String(item["income"]) : null,
          paymentDate: toCrmDateStr(item["document_date"]) ?? toCrmDateStr(item["created_at"]),
          type: item["pay_type_name"] != null ? String(item["pay_type_name"]) : null,
          comment: item["note"] ? String(item["note"]) : null,
          raw: item,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [crmPaymentsTable.branchCrmId, crmPaymentsTable.crmId],
          set: {
            amount: item["income"] != null ? String(item["income"]) : null,
            paymentDate: toCrmDateStr(item["document_date"]) ?? toCrmDateStr(item["created_at"]),
            comment: item["note"] ? String(item["note"]) : null,
            raw: item,
            syncedAt: new Date(),
          },
        });
      upserted++;
    }

    const msg = `Synced ${upserted} payments for Atlas branch (id=${atlasBranchId})`;
    await logSync("payments", "success", msg, upserted, undefined, startedAt);
    res.json({ success: true, message: msg, recordsCount: upserted, atlasBranchId, data: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Payment sync failed");
    await logSync("payments", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, recordsCount: 0, atlasBranchId: null, data: null });
  }
});

// ─── POST /sync/backfill-payments-normalize ──────────────────────────────────
// Backfills payment_type_normalized, document_date, income, outcome, direction,
// payment_type_id_raw, payment_type_name_raw from the raw JSON column.
// Safe to run multiple times (idempotent, only updates NULLs).
// Required after payments-atlas sync before p76-cleanup and reconciliation.

router.post("/sync/backfill-payments-normalize", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Backfilling payment normalization fields from raw JSON");
  try {
    const atlasBranchId = await getAtlasBranchId();
    if (!atlasBranchId) {
      return void res.status(400).json({ success: false, message: "Atlas branch not found." });
    }
    const BRANCH_ID = atlasBranchId;

    const result = await pool.query<{ updated: string }>(
      `WITH updated AS (
         UPDATE crm_payments SET
           payment_type_normalized = CASE NULLIF(raw->>'pay_type_id', '')
             WHEN '1'  THEN 'income'
             WHEN '5'  THEN 'refund'
             WHEN '6'  THEN 'correction'
             WHEN '11' THEN 'income'
             WHEN '12' THEN 'outcome'
             ELSE 'unknown'
           END,
           document_date = CASE
             WHEN raw->>'document_date' ~ '^[0-9]{2}[.][0-9]{2}[.][0-9]{4}$'
               THEN to_date(raw->>'document_date', 'DD.MM.YYYY')
             WHEN raw->>'document_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
               THEN (raw->>'document_date')::date
             ELSE payment_date
           END,
           income = CASE
             WHEN NULLIF(raw->>'pay_type_id', '') IN ('1','6','11')
               AND raw->>'income' ~ '^-?[0-9]+(\\.[0-9]+)?$'
             THEN (raw->>'income')::numeric
             ELSE NULL
           END,
           outcome = CASE
             WHEN NULLIF(raw->>'pay_type_id', '') IN ('5','12')
               AND raw->>'income' ~ '^-?[0-9]+(\\.[0-9]+)?$'
             THEN (raw->>'income')::numeric
             ELSE NULL
           END,
           direction = CASE NULLIF(raw->>'pay_type_id', '')
             WHEN '1'  THEN 'income'
             WHEN '5'  THEN 'refund'
             WHEN '6'  THEN 'correction'
             WHEN '11' THEN 'income'
             WHEN '12' THEN 'outcome'
             ELSE 'unknown'
           END,
           payment_type_id_raw   = NULLIF(raw->>'pay_type_id', ''),
           payment_type_name_raw = NULLIF(raw->>'pay_type_name', '')
         WHERE branch_crm_id = $1
           AND payment_type_normalized IS NULL
         RETURNING 1
       ) SELECT COUNT(*)::text AS updated FROM updated`,
      [BRANCH_ID],
    );
    const updatedCount = Number(result.rows[0]?.updated ?? 0);
    req.log.info({ updatedCount, branchId: BRANCH_ID }, "backfill-payments-normalize: done");

    const snap = await pool.query<{ total: string; income_cnt: string; refund_cnt: string; correction_cnt: string; outcome_cnt: string; unknown_cnt: string; null_date_cnt: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(CASE WHEN payment_type_normalized='income'     THEN 1 END)::text AS income_cnt,
              COUNT(CASE WHEN payment_type_normalized='refund'     THEN 1 END)::text AS refund_cnt,
              COUNT(CASE WHEN payment_type_normalized='correction' THEN 1 END)::text AS correction_cnt,
              COUNT(CASE WHEN payment_type_normalized='outcome'    THEN 1 END)::text AS outcome_cnt,
              COUNT(CASE WHEN payment_type_normalized='unknown' OR payment_type_normalized IS NULL THEN 1 END)::text AS unknown_cnt,
              COUNT(CASE WHEN document_date IS NULL THEN 1 END)::text AS null_date_cnt
       FROM crm_payments WHERE branch_crm_id = $1`,
      [BRANCH_ID],
    );
    const s = snap.rows[0];

    await logSync("payments", "success",
      `backfill-payments-normalize: updated=${updatedCount} income=${s?.income_cnt} refund=${s?.refund_cnt} correction=${s?.correction_cnt} outcome=${s?.outcome_cnt} unknown=${s?.unknown_cnt} null_date=${s?.null_date_cnt}`,
      updatedCount, undefined, startedAt,
    );

    res.json({
      success: true,
      updatedCount,
      branchId: BRANCH_ID,
      typeBreakdown: {
        income:     Number(s?.income_cnt     ?? 0),
        refund:     Number(s?.refund_cnt     ?? 0),
        correction: Number(s?.correction_cnt ?? 0),
        outcome:    Number(s?.outcome_cnt    ?? 0),
        unknown:    Number(s?.unknown_cnt    ?? 0),
      },
      nullDateCount: Number(s?.null_date_cnt ?? 0),
      message: `Backfilled ${updatedCount} payments. Types: income=${s?.income_cnt}, refund=${s?.refund_cnt}, correction=${s?.correction_cnt}, outcome=${s?.outcome_cnt}, unknown=${s?.unknown_cnt}. Null dates: ${s?.null_date_cnt}.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "backfill-payments-normalize failed");
    res.status(500).json({ success: false, message });
  }
});

// ─── POST /sync/attendance-from-lessons ──────────────────────────────────────
// Extracts per-student attendance from crm_lessons.raw.details.
// No AlphaCRM API call needed — works entirely from data already in the DB.
// Strategy: DELETE all existing crm_attendance rows, then re-insert from lessons.

router.post("/sync/attendance-from-lessons", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Extracting attendance from lesson details");
  try {
    await db.execute(sql`DELETE FROM crm_attendance`);

    const result = await db.execute(sql`
      INSERT INTO crm_attendance (lesson_crm_id, student_crm_id, status, raw, synced_at)
      SELECT
        l.crm_id                                                            AS lesson_crm_id,
        (det->>'customer_id')                                               AS student_crm_id,
        CASE WHEN (det->>'is_attend')::int = 1 THEN '1' ELSE '0' END       AS status,
        jsonb_build_object(
          'attendance_record_id',  det->>'id',
          'customer_id',           det->>'customer_id',
          'is_attend',             det->>'is_attend',
          'note',                  det->>'note',
          'reason_name',           det->>'reason_name',
          'reason_id',             det->>'reason_id',
          'commission',            det->>'commission',
          'lesson_date',           l.raw->>'date',
          'time_from',             l.raw->>'time_from',
          'time_to',               l.raw->>'time_to',
          'subject_id',            l.raw->>'subject_id',
          'lesson_crm_id',         l.crm_id,
          'extracted_from',        'lesson_details'
        )                                                                   AS raw,
        NOW()                                                               AS synced_at
      FROM crm_lessons l,
           jsonb_array_elements(l.raw->'details') AS det
      WHERE l.raw ? 'details'
        AND jsonb_array_length(l.raw->'details') > 0
        AND (det->>'customer_id') IS NOT NULL
    `);

    const extracted = result.rowCount ?? 0;
    const msg = `Extracted ${extracted} attendance records from crm_lessons.raw.details`;
    req.log.info({ extracted }, msg);
    await logSync("attendance", "success", msg, extracted, undefined, startedAt);
    res.json({ success: true, message: msg, recordsCount: extracted, data: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Attendance extraction failed");
    await logSync("attendance", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, recordsCount: 0, data: null });
  }
});

// ─── POST /sync/subjects ──────────────────────────────────────────────────────
// Fetches subject/direction names from AlphaCRM and caches them in settings
// as a JSON map: subject_id → name.

router.post("/sync/subjects", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Syncing subjects from AlphaCRM");
  try {
    await authenticate();
    // AlphaCRM subject endpoint — try both branch slots
    const subjectPaths = ["1/subject/index", "0/subject/index"];
    let items: Record<string, unknown>[] = [];
    let usedPath = "";
    for (const path of subjectPaths) {
      try {
        const result = await crmGetAllPages<Record<string, unknown>>(path, {});
        if (result.length > 0) { items = result; usedPath = path; break; }
      } catch {
        // try next
      }
    }

    if (items.length === 0) {
      const msg = "No subjects returned from AlphaCRM (tried 1/subject/index, 0/subject/index)";
      await logSync("subjects", "error", msg, 0, undefined, startedAt);
      res.json({ success: false, message: msg, recordsCount: 0, data: null });
      return;
    }

    const map: Record<string, string> = {};
    for (const item of items) {
      const id = item["id"] != null ? String(item["id"]) : null;
      const name = (item["name"] ?? item["title"]) != null ? String(item["name"] ?? item["title"]) : null;
      if (id && name) map[id] = name;
    }

    await saveSetting("crm_subjects_map", JSON.stringify(map));

    const msg = `Synced ${items.length} subjects via ${usedPath}`;
    req.log.info({ count: items.length, usedPath }, msg);
    await logSync("subjects", "success", msg, items.length, { map }, startedAt);
    res.json({ success: true, message: msg, recordsCount: items.length, data: map });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Subjects sync failed");
    await logSync("subjects", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, recordsCount: 0, data: null });
  }
});

// POST /api/sync/lessons-atlas
router.post("/sync/lessons-atlas", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Syncing Atlas lessons");

  const todayStr = new Date().toISOString().slice(0, 10);
  const dateFrom: string = req.body?.date_from ?? "2025-01-01";
  const dateTo: string = req.body?.date_to ?? todayStr;

  try {
    const atlasBranchId = await getAtlasBranchId();
    if (!atlasBranchId) {
      const msg = "Atlas branch not found. Run 'Sync Branches' and 'Find Atlas' first.";
      await logSync("lessons", "error", msg, 0, undefined, startedAt);
      res.json({ success: false, message: msg, recordsCount: 0, atlasBranchId: null, data: null });
      return;
    }

    const lessonsPath: string = req.body?.lessons_path ?? await getSetting("lessons_endpoint") ?? "1/lesson/index";
    req.log.info({ lessonsPath, dateFrom, dateTo }, "Using lessons endpoint");
    const lessons = await crmGetAllPages<Record<string, unknown>>(lessonsPath, {
      branch_id: Number(atlasBranchId),
      date_from: dateFrom,
      date_to: dateTo,
    });
    await saveSetting("sync_lessons_date_from", dateFrom);
    await saveSetting("sync_lessons_date_to", dateTo);

    let lessonsUpserted = 0;
    // Use raw SQL so that group_crm_id / teacher_crm_id are extracted from the
    // JSONB group_ids / teacher_ids arrays on both INSERT and CONFLICT UPDATE.
    // Drizzle's onConflictDoUpdate can only set literal JS values, not SQL
    // expressions, so a hand-written upsert is required here.
    for (const item of lessons) {
      const crmId = String(item["id"] ?? "");
      if (!crmId) continue;
      const rawJson = JSON.stringify(item);
      const lessonDate = item["date"] ? new Date(String(item["date"])) : null;
      const title     = item["subject_id"] ? String(item["subject_id"]) : null;
      await pool.query(
        `INSERT INTO crm_lessons
           (crm_id, branch_crm_id,
            group_crm_id, teacher_crm_id,
            lesson_date, title, raw, synced_at)
         VALUES (
           $1, $2,
           CASE WHEN jsonb_typeof($3::jsonb->'group_ids')   = 'array'
                 AND jsonb_array_length($3::jsonb->'group_ids')   > 0
                THEN ($3::jsonb->'group_ids'->>0)  ELSE NULL END,
           CASE WHEN jsonb_typeof($3::jsonb->'teacher_ids') = 'array'
                 AND jsonb_array_length($3::jsonb->'teacher_ids') > 0
                THEN ($3::jsonb->'teacher_ids'->>0) ELSE NULL END,
           $4, $5, $3::jsonb, NOW()
         )
         ON CONFLICT (branch_crm_id, crm_id) DO UPDATE SET
           raw          = EXCLUDED.raw,
           synced_at    = NOW(),
           group_crm_id = CASE WHEN jsonb_typeof(EXCLUDED.raw->'group_ids')   = 'array'
                                 AND jsonb_array_length(EXCLUDED.raw->'group_ids')   > 0
                               THEN (EXCLUDED.raw->'group_ids'->>0)  ELSE NULL END,
           teacher_crm_id = CASE WHEN jsonb_typeof(EXCLUDED.raw->'teacher_ids') = 'array'
                                   AND jsonb_array_length(EXCLUDED.raw->'teacher_ids') > 0
                                  THEN (EXCLUDED.raw->'teacher_ids'->>0) ELSE NULL END`,
        [crmId, atlasBranchId, rawJson, lessonDate, title],
      );
      lessonsUpserted++;
    }

    // Fetch attendance records for the lessons we just synced
    let attendanceUpserted = 0;
    // AlphaCRM attendance is fetched per-lesson using visit/index
    // Fetch a batch for the branch instead
    const attendancePath = await getSetting("attendance_endpoint") ?? "0/clog/index";
    req.log.info({ attendancePath }, "Using attendance endpoint");
    const attendanceItems = await crmGetAllPages<Record<string, unknown>>(attendancePath, {
      branch_id: Number(atlasBranchId),
    });

    for (const item of attendanceItems) {
      const lessonCrmId = item["lesson_id"] ? String(item["lesson_id"]) : null;
      const studentCrmId = item["customer_id"] ? String(item["customer_id"]) : null;
      if (!lessonCrmId || !studentCrmId) continue;
      await db.insert(crmAttendanceTable).values({
        branchCrmId: atlasBranchId,
        lessonCrmId,
        studentCrmId,
        status: item["status"] != null ? String(item["status"]) : null,
        raw: item,
        syncedAt: new Date(),
      }).onConflictDoNothing();
      attendanceUpserted++;
    }

    const msg = `Synced ${lessonsUpserted} lessons, ${attendanceUpserted} attendance records for Atlas`;
    await logSync("lessons", "success", msg, lessonsUpserted + attendanceUpserted, undefined, startedAt);
    res.json({ success: true, message: msg, recordsCount: lessonsUpserted + attendanceUpserted, atlasBranchId, data: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Lessons sync failed");
    await logSync("lessons", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, recordsCount: 0, atlasBranchId: null, data: null });
  }
});

// ─── POST /sync/teachers ──────────────────────────────────────────────────────

router.post("/sync/teachers", async (req, res): Promise<void> => {
  const startedAt = new Date();
  try {
    await authenticate();
    const items = await crmGetAllPages<Record<string, unknown>>("1/teacher/index", {});

    let upserted = 0;
    for (const item of items) {
      const crmId = String(item["id"] ?? "");
      if (!crmId) continue;
      const branchCrmId = item["branch_id"]
        ? String(item["branch_id"])
        : "1";

      await db
        .insert(crmTeachersTable)
        .values({
          crmId,
          branchCrmId,
          fullName: item["name"] ? String(item["name"]) : null,
          phone: item["phone"] ? String(item["phone"]) : null,
          email: item["email"] ? String(item["email"]) : null,
          status: item["is_study"] != null ? String(item["is_study"]) : null,
          raw: item,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [crmTeachersTable.branchCrmId, crmTeachersTable.crmId],
          set: {
            fullName: item["name"] ? String(item["name"]) : null,
            phone: item["phone"] ? String(item["phone"]) : null,
            email: item["email"] ? String(item["email"]) : null,
            status: item["is_study"] != null ? String(item["is_study"]) : null,
            raw: item,
            syncedAt: new Date(),
          },
        });
      upserted++;
    }

    const msg = `Synced ${upserted} teachers`;
    await logSync("teachers", "success", msg, upserted, undefined, startedAt);
    res.json({ success: true, message: msg, recordsCount: upserted, data: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Teachers sync failed");
    await logSync("teachers", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, recordsCount: 0, data: null });
  }
});

// ─── POST /sync/teachers-atlas ───────────────────────────────────────────────
// P9.3.2: Fetches Atlas branch (branchId=6) teachers from AlphaCRM endpoint
// {branchId}/teacher/index and writes raw payloads to alpha_raw_records.
// Idempotent: ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash).

router.post("/sync/teachers-atlas", async (req, res): Promise<void> => {
  const startedAt = new Date();
  try {
    const atlasBranchId = await getAtlasBranchId();
    if (!atlasBranchId) {
      const msg = "Atlas branch not found. Run 'Sync Branches' and 'Find Atlas' first.";
      await logSync("teachers", "error", msg, 0, undefined, startedAt);
      res.json({ success: false, message: msg, branchId: null, fetched: 0, inserted: 0, updated: 0, errors: 0, examples: [] });
      return;
    }

    const endpoint = `${atlasBranchId}/teacher/index`;
    req.log.info({ endpoint }, "P9.3.2: Fetching Atlas teachers from AlphaCRM");

    const items = await crmGetAllPages<Record<string, unknown>>(endpoint, {});

    let fetched = 0;
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    const examples: string[] = [];

    const client = await pool.connect();
    try {
      for (const item of items) {
        const alphaId = item["id"] != null ? String(item["id"]) : null;
        if (!alphaId) { errors++; continue; }

        fetched++;
        const payload = JSON.stringify(item);
        const hash = _md5(payload);
        const name = item["name"] ? String(item["name"]) : null;

        try {
          const upsertResult = await client.query<{ is_insert: boolean }>(
            `INSERT INTO alpha_raw_records
               (alpha_id, entity_type, endpoint, branch_id, source_payload, payload_hash, page, synced_at, updated_at)
             VALUES ($1, 'teachers', $2, $3, $4::jsonb, $5, 0, NOW(), NOW())
             ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash) DO UPDATE SET
               synced_at = NOW(),
               updated_at = NOW()
             RETURNING (xmax = 0) AS is_insert`,
            [alphaId, endpoint, atlasBranchId, payload, hash],
          );
          if (upsertResult.rows[0]?.is_insert === true) {
            inserted++;
            if (examples.length < 5 && name) examples.push(name);
          } else {
            updated++;
          }
        } catch (rowErr) {
          errors++;
          req.log.error({ rowErr, alphaId }, "teachers-atlas: row insert failed");
        }
      }
    } finally {
      client.release();
    }

    const msg = `P9.3.2: Fetched ${fetched} Atlas teachers from branchId=${atlasBranchId} → alpha_raw_records (${inserted} new, ${updated} unchanged, ${errors} errors)`;
    req.log.info({ branchId: atlasBranchId, fetched, inserted, updated, errors }, msg);
    await logSync("teachers", "success", msg, fetched, undefined, startedAt);

    res.json({ success: true, message: msg, branchId: atlasBranchId, fetched, inserted, updated, errors, examples });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "teachers-atlas: sync failed");
    await logSync("teachers", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, branchId: null, fetched: 0, inserted: 0, updated: 0, errors: 0, examples: [] });
  }
});

// ─── POST /sync/full-resync ───────────────────────────────────────────────────
// Chains: students → payments → lessons → extract-attendance → (families &
// timeline are run separately via Identity tab).
// Returns a summary of all steps.

router.post("/sync/full-resync", async (req, res): Promise<void> => {
  const startedAt = new Date();
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateFrom: string = req.body?.date_from ?? "2025-01-01";
  const dateTo: string = req.body?.date_to ?? todayStr;
  const steps: Array<{ step: string; success: boolean; message: string; count: number }> = [];

  req.log.info({ dateFrom, dateTo }, "Starting full CRM resync");

  const atlasBranchId = await getAtlasBranchId();
  if (!atlasBranchId) {
    res.status(400).json({ success: false, message: "Atlas branch not found. Run Sync Branches first.", steps });
    return;
  }

  // ── 1. Students (all, no date filter) ──────────────────────────────────────
  try {
    const items = await crmGetAllPages<Record<string, unknown>>("1/customer/index", { branch_id: Number(atlasBranchId) });
    let upserted = 0;
    for (const item of items) {
      const crmId = String(item["id"] ?? "");
      if (!crmId) continue;
      const fullName = [item["name"], item["patronymic"]].filter(Boolean).join(" ") || String(item["name"] ?? "");
      await db.insert(crmStudentsTable).values({
        crmId, branchCrmId: atlasBranchId, fullName,
        status: item["is_study"] != null ? String(item["is_study"]) : null,
        phone: item["phone"] ? String(item["phone"]) : null,
        email: item["email"] ? String(item["email"]) : null,
        createdAtCrm: item["created_at"] ? new Date(String(item["created_at"])) : null,
        raw: item, syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [crmStudentsTable.branchCrmId, crmStudentsTable.crmId],
        set: { fullName, status: item["is_study"] != null ? String(item["is_study"]) : null,
          phone: item["phone"] ? String(item["phone"]) : null, raw: item, syncedAt: new Date() },
      });
      upserted++;
    }
    await logSync("students", "success", `Full resync: ${upserted} students`, upserted, undefined, startedAt);
    steps.push({ step: "students", success: true, message: `${upserted} students synced`, count: upserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "students", success: false, message: msg, count: 0 });
  }

  // ── 2. Payments (with date range) ──────────────────────────────────────────
  try {
    const payPath: string = req.body?.payments_path ?? await getSetting("payments_endpoint") ?? "1/pay/index";
    const items = await crmGetAllPages<Record<string, unknown>>(payPath, {
      branch_id: Number(atlasBranchId), date_from: dateFrom, date_to: dateTo,
    });
    await saveSetting("sync_payments_date_from", dateFrom);
    await saveSetting("sync_payments_date_to", dateTo);
    let upserted = 0;
    for (const item of items) {
      const crmId = String(item["id"] ?? "");
      if (!crmId) continue;
      await db.insert(crmPaymentsTable).values({
        crmId, branchCrmId: atlasBranchId,
        studentCrmId: item["customer_id"] ? String(item["customer_id"]) : null,
        amount: item["income"] != null ? String(item["income"]) : null,
        paymentDate: toCrmDateStr(item["document_date"]) ?? toCrmDateStr(item["created_at"]),
        type: item["pay_type_name"] != null ? String(item["pay_type_name"]) : null,
        comment: item["note"] ? String(item["note"]) : null,
        raw: item, syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [crmPaymentsTable.branchCrmId, crmPaymentsTable.crmId],
        set: { amount: item["income"] != null ? String(item["income"]) : null,
          paymentDate: toCrmDateStr(item["document_date"]) ?? toCrmDateStr(item["created_at"]),
          raw: item, syncedAt: new Date() },
      });
      upserted++;
    }
    await logSync("payments", "success", `Full resync: ${upserted} payments`, upserted, undefined, startedAt);
    steps.push({ step: "payments", success: true, message: `${upserted} payments synced (${dateFrom}–${dateTo})`, count: upserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "payments", success: false, message: msg, count: 0 });
  }

  // ── 3. Lessons (with date range) ───────────────────────────────────────────
  try {
    const lessonsPath: string = req.body?.lessons_path ?? await getSetting("lessons_endpoint") ?? "1/lesson/index";
    const lessons = await crmGetAllPages<Record<string, unknown>>(lessonsPath, {
      branch_id: Number(atlasBranchId), date_from: dateFrom, date_to: dateTo,
    });
    await saveSetting("sync_lessons_date_from", dateFrom);
    await saveSetting("sync_lessons_date_to", dateTo);
    let upserted = 0;
    for (const item of lessons) {
      const crmId = String(item["id"] ?? "");
      if (!crmId) continue;
      await db.insert(crmLessonsTable).values({
        crmId, branchCrmId: atlasBranchId,
        groupCrmId: item["group_id"] ? String(item["group_id"]) : null,
        teacherCrmId: item["teacher_id"] ? String(item["teacher_id"]) : null,
        lessonDate: item["date"] ? new Date(String(item["date"])) : null,
        title: item["subject_id"] ? String(item["subject_id"]) : null,
        raw: item, syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [crmLessonsTable.branchCrmId, crmLessonsTable.crmId],
        set: { raw: item, syncedAt: new Date() },
      });
      upserted++;
    }
    await logSync("lessons", "success", `Full resync: ${upserted} lessons`, upserted, undefined, startedAt);
    steps.push({ step: "lessons", success: true, message: `${upserted} lessons synced (${dateFrom}–${dateTo})`, count: upserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "lessons", success: false, message: msg, count: 0 });
  }

  // ── 4. Extract attendance from lesson details ───────────────────────────────
  try {
    await db.execute(sql`DELETE FROM crm_attendance`);
    const result = await db.execute(sql`
      INSERT INTO crm_attendance (
        branch_crm_id,
        lesson_crm_id,
        student_crm_id,
        status,
        raw,
        synced_at
      )
      SELECT l.branch_crm_id, l.crm_id, (det->>'customer_id'),
        CASE WHEN (det->>'is_attend')::int = 1 THEN '1' ELSE '0' END,
        jsonb_build_object(
          'customer_id', det->>'customer_id', 'is_attend', det->>'is_attend',
          'reason_name', det->>'reason_name', 'lesson_date', l.raw->>'date',
          'time_from', l.raw->>'time_from', 'time_to', l.raw->>'time_to',
          'subject_id', l.raw->>'subject_id', 'lesson_crm_id', l.crm_id,
          'extracted_from', 'lesson_details'
        ), NOW()
      FROM crm_lessons l, jsonb_array_elements(l.raw->'details') AS det
      WHERE l.raw ? 'details' AND jsonb_array_length(l.raw->'details') > 0
        AND (det->>'customer_id') IS NOT NULL
    `);
    const extracted = result.rowCount ?? 0;
    steps.push({ step: "attendance", success: true, message: `${extracted} attendance records extracted`, count: extracted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "attendance", success: false, message: msg, count: 0 });
  }

  const allOk = steps.every(s => s.success);
  const totalCount = steps.reduce((a, s) => a + s.count, 0);
  req.log.info({ steps, dateFrom, dateTo }, "Full resync complete");

  res.json({
    success: allOk,
    message: `Full resync complete: ${steps.map(s => s.message).join("; ")}`,
    recordsCount: totalCount,
    dateFrom,
    dateTo,
    steps,
    data: null,
  });
});

// ─── POST /api/sync/pull-students-all-branches ───────────────────────────────
//
// P7.4.2 — Targeted raw pull of customer/student records for all 8 branches.
// Saves raw payloads to alpha_raw_records (entity_type='students').
// Idempotent — safe to run multiple times.
// Does NOT normalize into crm_students.

const KNOWN_BRANCHES: Array<{ id: number; name: string }> = [
  { id: 1, name: "Онлайн школа" },
  { id: 2, name: "Лиственная" },
  { id: 3, name: "Остров" },
  { id: 4, name: "Лыжный" },
  { id: 5, name: "Онлайн Школа" },
  { id: 6, name: "Атлас" },
  { id: 7, name: "Кемпинг" },
  { id: 8, name: "Школа 1-11" },
];

function _md5(s: string): string { return _createHash("md5").update(s).digest("hex"); }

function _extractStudentItems(json: unknown): unknown[] {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["items", "data", "result", "records", "list"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

router.post("/sync/pull-students-all-branches", async (req, res): Promise<void> => {
  const { branchIds: requestedIds } = req.body as { branchIds?: number[] };
  const branches = requestedIds
    ? KNOWN_BRANCHES.filter(b => requestedIds.includes(b.id))
    : KNOWN_BRANCHES;

  const startedAt = Date.now();
  req.log.info({ branchIds: branches.map(b => b.id) }, "pull-students-all-branches: start");

  const PAGE_SIZE = 50;
  const MAX_PAGES = 200;

  type BranchResult = {
    branchId: number;
    branchName: string;
    status: "ok" | "failed";
    fetched: number;
    inserted: number;
    updated: number;
    skippedDuplicates: number;
    pagesFetched: number;
    paginationStatus: string;
    error?: string;
  };
  const results: BranchResult[] = [];

  let token: string;
  try {
    token = await authenticate();
  } catch (authErr) {
    req.log.error({ err: authErr }, "pull-students-all-branches: auth failed");
    res.status(500).json({ error: "AlphaCRM authentication failed", detail: String(authErr) });
    return;
  }

  const client = await pool.connect();
  try {
    for (const branch of branches) {
      const bid = String(branch.id);
      const endpoint = `${bid}/customer/index`;

      let fetched = 0, inserted = 0, updated = 0, page = 0, pagesFetched = 0;
      let paginationStatus = "ok";
      let prevPageIds: Set<string> | null = null;

      try {
        while (page < MAX_PAGES) {
          const probe = await crmProbe(endpoint, "POST", { page, count: PAGE_SIZE }, token);

          if (!probe.status || probe.status >= 400) {
            paginationStatus = `http_error:${probe.status ?? "null"}`;
            break;
          }

          const items = _extractStudentItems(probe.parsedJson);
          if (items.length === 0) { paginationStatus = "empty_page"; break; }

          // Loop detection: stop if same alpha_ids as previous page
          const currIds = new Set<string>(
            items
              .map(it => { const o = it as Record<string, unknown>; return o["id"] !== undefined ? String(o["id"]) : null; })
              .filter((id): id is string => id !== null),
          );
          if (prevPageIds !== null && prevPageIds.size === currIds.size && [...currIds].every(id => prevPageIds!.has(id))) {
            paginationStatus = "loop_detected";
            break;
          }
          prevPageIds = currIds;

          fetched += items.length;
          pagesFetched++;

          for (const item of items) {
            const obj = item as Record<string, unknown>;
            const alphaId = obj["id"] !== undefined ? String(obj["id"]) : null;
            if (!alphaId) continue;

            const payload = JSON.stringify(item);
            const hash = _md5(payload);

            const { rows } = await client.query(
              `INSERT INTO alpha_raw_records
                 (alpha_id, entity_type, endpoint, branch_id, source_payload, payload_hash, page, synced_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
               ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash) DO UPDATE SET
                 synced_at = NOW(), updated_at = NOW()
               RETURNING (xmax = 0) AS is_insert`,
              [alphaId, "students", endpoint, bid, JSON.stringify(item), hash, page],
            );

            if (rows[0]?.is_insert === true) inserted++;
            else updated++;
          }

          if (items.length < PAGE_SIZE) break;
          page++;
        }

        if (page >= MAX_PAGES) paginationStatus = "max_pages_reached";

        results.push({ branchId: branch.id, branchName: branch.name, status: "ok",
          fetched, inserted, updated, skippedDuplicates: updated, pagesFetched, paginationStatus });
        req.log.info({ branchId: branch.id, fetched, inserted, updated, pagesFetched }, "pull-students-all-branches: branch ok");
      } catch (branchErr) {
        req.log.error({ err: branchErr, branchId: branch.id }, "pull-students-all-branches: branch failed");
        results.push({ branchId: branch.id, branchName: branch.name, status: "failed",
          fetched: 0, inserted: 0, updated: 0, skippedDuplicates: 0, pagesFetched: 0,
          paginationStatus: "error", error: String(branchErr) });
      }
    }
  } finally {
    client.release();
  }

  const totalFetched  = results.reduce((a, r) => a + r.fetched,   0);
  const totalInserted = results.reduce((a, r) => a + r.inserted,  0);
  const totalUpdated  = results.reduce((a, r) => a + r.updated,   0);
  const durationMs    = Date.now() - startedAt;

  req.log.info({ totalFetched, totalInserted, totalUpdated, durationMs }, "pull-students-all-branches: done");

  res.json({
    success: true,
    durationMs,
    branchesPulled: branches.length,
    totalFetched,
    totalInserted,
    totalUpdated,
    totalSkippedDuplicates: totalUpdated,
    branches: results,
    note: "Raw students saved to alpha_raw_records (entity_type='students'). No normalization to crm_students performed.",
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/sync/build-counterparties-from-bank
// P8.3 — Counterparty Foundation: extract + classify + link from bank_transactions
// ══════════════════════════════════════════════════════════════════════════════

// ── P8.3 helpers ──────────────────────────────────────────────────────────────

function p83NormalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

function p83CanonicalKey(
  inn: string | null | undefined,
  cpAccount: string | null | undefined,
  normalizedName: string,
): string {
  const i = inn?.trim();
  if (i && i.length >= 10) return `inn:${i}`;
  const a = cpAccount?.trim();
  if (a && a.length >= 16) return `acct:${a}`;
  const n = normalizedName.slice(0, 100);
  if (n) return `name:${n}`;
  return `name:UNKNOWN`;
}

type TxRow = {
  id: string;
  account_id: string | null;
  account_number: string | null;
  operation_date: string | null;
  amount: string;
  direction: string;
  counterparty_name: string | null;
  counterparty_inn: string | null;
  counterparty_account: string | null;
  purpose: string | null;
  external_id: string | null;
  masked_account: string | null;
};

function p83Classify(
  txs: TxRow[],
  ownAccountNumbers: Set<string>,
  ownExtAccountIds: Set<string>,
): { type: string; confidence: string; riskFlags: Record<string, boolean> } {
  const rep = txs[0]!;
  const name = p83NormalizeName(rep.counterparty_name);
  const inn  = rep.counterparty_inn?.trim() ?? "";
  const cpAcct = rep.counterparty_account?.trim() ?? "";

  // 1. Own account transfer (cross-account internal)
  if (
    (cpAcct && (ownAccountNumbers.has(cpAcct) || ownExtAccountIds.has(cpAcct))) ||
    txs.some(t => ownAccountNumbers.has(t.counterparty_account?.trim() ?? "") ||
                  ownExtAccountIds.has(t.counterparty_account?.trim() ?? ""))
  ) {
    return {
      type: "internal_company",
      confidence: "high",
      riskFlags: { own_account_transfer: true, exclude_from_revenue_expense: true },
    };
  }

  // 2. Known own-company INN (ООО Арт Хелло Нью / Артхелло)
  if (inn === "7802561028") {
    return {
      type: "internal_company",
      confidence: "high",
      riskFlags: { own_inn: true, exclude_from_revenue_expense: true },
    };
  }

  // 3. Tax authority: name or INN patterns
  if (
    /ФНС|ИФНС|УФК|КАЗНАЧЕЙСТВ|ФОНД ПЕНСИОН|ПФР|СФР|СОЦФОНД|СОЦИАЛЬНЫЙ ФОНД/.test(name) ||
    // Moscow / federal tax INNs start with 770x..779x
    (/^\d{10}$/.test(inn) && /^7[7-9]\d/.test(inn))
  ) {
    return {
      type: "tax_authority",
      confidence: "high",
      riskFlags: { tax_payment: true },
    };
  }

  // 4. Bank / fee — Точка bank INN or bank name patterns
  if (
    inn === "9721194461" ||
    /БАНК\s*ТОЧКА|ТОЧКА\s*БАНК|АО\s*"ТОЧКА"|АО\s*БАНК\s*ТОЧКА|TOCHKA|ТИНЬКОФФ|ТИНЬКОФ БАНК|СБЕРБАНК|АЛЬФА.БАНК|ВТБ\s*БАНК/.test(name) ||
    (name.includes("БАНК") && (name.includes("КОМИСС") || name.includes("ОБСЛУЖ") || name.includes("ЭКВАЙР")))
  ) {
    return {
      type: "bank_or_fee",
      confidence: "high",
      riskFlags: { bank_fee: true },
    };
  }

  // 5. Determine predominant direction for group
  const incomeCount  = txs.filter(t => t.direction === "income").length;
  const expenseCount = txs.filter(t => t.direction === "expense").length;
  const isPredominantlyIncome  = incomeCount  >= expenseCount;
  const isPredominantlyExpense = expenseCount > incomeCount;

  // 6. Income without strong signal → parent_client_candidate (needs AlphaCRM match)
  if (isPredominantlyIncome && !isPredominantlyExpense) {
    return {
      type: "parent_client",
      confidence: "low",
      riskFlags: { parent_client_candidate: true, needs_alpha_match: true },
    };
  }

  // 7. Expense: check legal form to distinguish contractor vs individual
  if (isPredominantlyExpense) {
    const hasLegalForm =
      /ООО|ОАО|ЗАО|АО\s|ПАО|ИП\s|ЧАСТНЫЙ\s|ГУП|МУП|ФГУП|ФГБУ|ГБОУ|НКО|АНО/.test(name);
    const hasInn = inn.length >= 10;

    if (hasLegalForm || hasInn) {
      return {
        type: "contractor",
        confidence: hasInn ? "medium" : "low",
        riskFlags: { supplier_candidate: true },
      };
    }
    // Individual-looking (no legal form, no INN)
    return {
      type: "employee_or_self_employed",
      confidence: "low",
      riskFlags: { employee_candidate: true, needs_review: true },
    };
  }

  return {
    type: "unknown",
    confidence: "low",
    riskFlags: { needs_review: true },
  };
}

router.post("/sync/build-counterparties-from-bank", async (req, res) => {
  const startedAt = Date.now();
  try {
    // ── 0. Production guard ─────────────────────────────────────────────────
    const dbRow = await pool.query<{ db: string }>("SELECT current_database() AS db");
    const dbName  = dbRow.rows[0]?.db ?? "";
    const nodeEnv = process.env["NODE_ENV"] ?? "";
    const isProduction =
      nodeEnv === "production" ||
      dbName.includes("prod") ||
      dbName.includes("neon") ||
      (!dbName.includes("dev") && !dbName.includes("test") && !dbName.includes("local"));

    if (!isProduction) {
      return res.status(400).json({
        error:   "COUNTERPARTY_FOUNDATION_NOT_VALID_OUTSIDE_PRODUCTION",
        message: "P8.3 must run against the production database. Current environment is dev/staging.",
        dbName,
        nodeEnv,
      });
    }

    // ── 1. Verify bank_transactions data ────────────────────────────────────
    const txCountRow = await pool.query<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM bank_transactions",
    );
    const txCount = txCountRow.rows[0]?.cnt ?? 0;
    if (txCount === 0) {
      return res.status(400).json({
        error:   "NO_BANK_TRANSACTIONS",
        message: "bank_transactions table is empty. Bank sync must run first.",
      });
    }

    // ── 2. Own bank account numbers (for transfer detection) ────────────────
    const ownAccRes = await pool.query<{
      account_number: string | null;
      external_account_id: string | null;
    }>("SELECT account_number, external_account_id FROM bank_accounts");
    const ownAccountNumbers = new Set<string>(
      ownAccRes.rows.map(r => r.account_number).filter((v): v is string => !!v),
    );
    const ownExtAccountIds = new Set<string>(
      ownAccRes.rows.map(r => r.external_account_id).filter((v): v is string => !!v),
    );

    // ── 3. Fetch all normalized bank_transactions ────────────────────────────
    const txRes = await pool.query<TxRow>(`
      SELECT id, account_id, account_number, operation_date::text,
             amount::text, direction,
             counterparty_name, counterparty_inn, counterparty_account,
             purpose, external_id, masked_account
      FROM bank_transactions
      ORDER BY operation_date ASC NULLS LAST
    `);
    const txRows = txRes.rows;

    // ── 4. Group transactions by canonical key ───────────────────────────────
    type GroupEntry = { txs: TxRow[] };
    const groups = new Map<string, GroupEntry>();

    for (const tx of txRows) {
      const normName = p83NormalizeName(tx.counterparty_name);
      const key = p83CanonicalKey(tx.counterparty_inn, tx.counterparty_account, normName);
      if (!groups.has(key)) groups.set(key, { txs: [] });
      groups.get(key)!.txs.push(tx);
    }

    req.log.info(
      { groups: groups.size, transactions: txRows.length },
      "build-counterparties: groups formed",
    );

    // ── 5. Upsert counterparties ─────────────────────────────────────────────
    let cpCreated = 0;
    let cpUpdated = 0;
    const cpIdByKey = new Map<string, string>();

    for (const [key, { txs }] of groups) {
      const rep = txs[0]!;
      const normName = p83NormalizeName(rep.counterparty_name);
      const inn = rep.counterparty_inn?.trim() ?? null;

      // Stats
      let totalIncome  = 0;
      let totalExpense = 0;
      let firstSeenAt: string | null = null;
      let lastSeenAt: string | null  = null;
      let lastTxId: string | null    = null;

      for (const tx of txs) {
        const amt = parseFloat(tx.amount ?? "0");
        if (tx.direction === "income")  totalIncome  += amt;
        else if (tx.direction === "expense") totalExpense += amt;
        if (tx.operation_date) {
          if (!firstSeenAt || tx.operation_date < firstSeenAt) firstSeenAt = tx.operation_date;
          if (!lastSeenAt  || tx.operation_date > lastSeenAt)  lastSeenAt  = tx.operation_date;
        }
        lastTxId = tx.id;
      }

      const hasIncome  = txs.some(t => t.direction === "income");
      const hasExpense = txs.some(t => t.direction === "expense");
      const role = hasIncome && hasExpense ? "both" : hasIncome ? "payer" : hasExpense ? "payee" : "unknown";

      const { type, confidence, riskFlags } = p83Classify(txs, ownAccountNumbers, ownExtAccountIds);
      const status = type === "unknown" ? "needs_review" : confidence === "high" ? "active" : "needs_review";

      const upsertRes = await pool.query<{ id: string; is_insert: boolean }>(`
        INSERT INTO counterparties (
          canonical_key, display_name, normalized_name, inn,
          counterparty_type, counterparty_role, status, confidence, source,
          first_seen_at, last_seen_at, total_income, total_expense,
          operations_count, last_operation_id, risk_flags
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (canonical_key) DO UPDATE SET
          display_name      = EXCLUDED.display_name,
          normalized_name   = EXCLUDED.normalized_name,
          inn               = COALESCE(EXCLUDED.inn, counterparties.inn),
          counterparty_type = EXCLUDED.counterparty_type,
          counterparty_role = EXCLUDED.counterparty_role,
          status            = EXCLUDED.status,
          confidence        = EXCLUDED.confidence,
          first_seen_at     = CASE WHEN counterparties.first_seen_at IS NULL
                                     OR EXCLUDED.first_seen_at < counterparties.first_seen_at
                                   THEN EXCLUDED.first_seen_at
                                   ELSE counterparties.first_seen_at END,
          last_seen_at      = CASE WHEN counterparties.last_seen_at IS NULL
                                     OR EXCLUDED.last_seen_at > counterparties.last_seen_at
                                   THEN EXCLUDED.last_seen_at
                                   ELSE counterparties.last_seen_at END,
          total_income      = EXCLUDED.total_income,
          total_expense     = EXCLUDED.total_expense,
          operations_count  = EXCLUDED.operations_count,
          last_operation_id = EXCLUDED.last_operation_id,
          risk_flags        = EXCLUDED.risk_flags,
          updated_at        = NOW()
        RETURNING id, (xmax = 0) AS is_insert
      `, [
        key,
        rep.counterparty_name ?? normName,
        normName || null,
        inn,
        type,
        role,
        status,
        confidence,
        "bank_transactions",
        firstSeenAt,
        lastSeenAt,
        totalIncome.toFixed(2),
        totalExpense.toFixed(2),
        txs.length,
        lastTxId,
        JSON.stringify(riskFlags),
      ]);

      const cpId       = upsertRes.rows[0]?.id as string;
      const isInsert   = upsertRes.rows[0]?.is_insert as boolean;
      if (isInsert) cpCreated++; else cpUpdated++;
      cpIdByKey.set(key, cpId);
    }

    // ── 6. Upsert links (bank_transaction ↔ counterparty) ───────────────────
    let linksUpserted = 0;

    for (const tx of txRows) {
      const normName = p83NormalizeName(tx.counterparty_name);
      const key  = p83CanonicalKey(tx.counterparty_inn, tx.counterparty_account, normName);
      const cpId = cpIdByKey.get(key);
      if (!cpId) continue;

      const txRole = tx.direction === "income" ? "payer" : tx.direction === "expense" ? "payee" : "unknown";
      const matchMethod =
        tx.counterparty_inn?.trim()     ? "inn" :
        tx.counterparty_account?.trim() ? "account_number" :
        "normalized_name";
      const linkConf =
        tx.counterparty_inn?.trim()     ? "high" :
        tx.counterparty_account?.trim() ? "medium" :
        "low";

      await pool.query(`
        INSERT INTO bank_transaction_counterparty_links
          (bank_transaction_id, counterparty_id, role, match_method, confidence)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (bank_transaction_id, counterparty_id, role) DO UPDATE SET
          match_method = EXCLUDED.match_method,
          confidence   = EXCLUDED.confidence,
          updated_at   = NOW()
      `, [tx.id, cpId, txRole, matchMethod, linkConf]);

      linksUpserted++;
    }

    // ── 7. Counterparty aliases (account numbers and names) ─────────────────
    for (const [key, { txs }] of groups) {
      const cpId = cpIdByKey.get(key);
      if (!cpId) continue;
      const accountsSeen = new Set<string>();
      const namesSeen    = new Set<string>();

      for (const tx of txs) {
        const acct = tx.counterparty_account?.trim();
        if (acct && !accountsSeen.has(acct)) {
          accountsSeen.add(acct);
          await pool.query(`
            INSERT INTO counterparty_aliases (counterparty_id, alias_type, alias_value, source)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
          `, [cpId, "account", acct, "bank_transactions"]).catch(() => {/* ignore dup */});
        }
        const nm = p83NormalizeName(tx.counterparty_name);
        if (nm && !namesSeen.has(nm) && nm !== key.replace("name:", "")) {
          namesSeen.add(nm);
          await pool.query(`
            INSERT INTO counterparty_aliases (counterparty_id, alias_type, alias_value, source)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
          `, [cpId, "name", nm, "bank_transactions"]).catch(() => {/* ignore dup */});
        }
      }
    }

    // ── 8. Duplicate candidate detection ────────────────────────────────────
    let dupCandidatesCreated = 0;

    // a. Same INN, different canonical keys (e.g. same entity, different name variants)
    const sameInnRes = await pool.query<{
      a_id: string; b_id: string; inn: string;
    }>(`
      SELECT a.id AS a_id, b.id AS b_id, a.inn
      FROM counterparties a
      JOIN counterparties b ON a.inn = b.inn AND a.id < b.id
      WHERE a.source = 'bank_transactions' AND b.source = 'bank_transactions'
        AND a.inn IS NOT NULL AND a.inn != ''
    `);
    for (const row of sameInnRes.rows) {
      await pool.query(`
        INSERT INTO counterparty_duplicate_candidates
          (counterparty_a_id, counterparty_b_id, reason, confidence, severity)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING
      `, [row.a_id, row.b_id, "same_inn_diff_key", "high", "high"]);
      dupCandidatesCreated++;
    }

    // b. Same normalized_name, different canonical keys
    const sameNameRes = await pool.query<{ a_id: string; b_id: string }>(`
      SELECT a.id AS a_id, b.id AS b_id
      FROM counterparties a
      JOIN counterparties b
        ON a.normalized_name = b.normalized_name
       AND a.id < b.id
       AND a.canonical_key != b.canonical_key
      WHERE a.source = 'bank_transactions' AND b.source = 'bank_transactions'
        AND a.normalized_name IS NOT NULL AND length(a.normalized_name) > 3
    `);
    for (const row of sameNameRes.rows) {
      await pool.query(`
        INSERT INTO counterparty_duplicate_candidates
          (counterparty_a_id, counterparty_b_id, reason, confidence, severity)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING
      `, [row.a_id, row.b_id, "same_normalized_name_diff_key", "medium", "medium"]);
      dupCandidatesCreated++;
    }

    const durationMs = Date.now() - startedAt;
    req.log.info(
      { cpCreated, cpUpdated, linksUpserted, dupCandidatesCreated, durationMs },
      "build-counterparties-from-bank: done",
    );

    return res.json({
      success:                  true,
      durationMs,
      dbName,
      bankTransactionsProcessed: txRows.length,
      counterpartiesCreated:    cpCreated,
      counterpartiesUpdated:    cpUpdated,
      totalCounterparties:      groups.size,
      linksUpserted,
      duplicateCandidatesCreated: dupCandidatesCreated,
      note: "Idempotent — safe to re-run. Use GET /api/coverage/counterparties-audit for full report.",
    });

  } catch (err) {
    req.log.error({ err }, "build-counterparties-from-bank failed");
    return void res.status(500).json({ error: String(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// P8.4a — Counterparty Reclassification Cleanup
// ══════════════════════════════════════════════════════════════════════════════

interface P84aRule {
  id:                   string;
  namePattern?:         RegExp;
  innExact?:            string;
  newType:              string;
  financeTreatmentHint: string;
  excludeFromRevExp:    boolean;
  confidence:           string;
  reason:               string;
  needsManualReview:    boolean;
  flagNeedsOpLevel?:    boolean;
}

const P84A_RECLASS_RULES: P84aRule[] = [
  // ── INTERNAL COMPANIES ───────────────────────────────────────────────────────
  { id: 'r01', innExact: '7802561028',
    newType: 'internal_company', financeTreatmentHint: 'internal_transfer_or_group_company',
    excludeFromRevExp: true,  confidence: 'high',
    reason: 'arthello_main_entity_own_account', needsManualReview: false },
  { id: 'r02', namePattern: /АРТХЕЛЛООСТРОВ/i,
    newType: 'internal_company', financeTreatmentHint: 'internal_transfer_or_group_company',
    excludeFromRevExp: true,  confidence: 'high',
    reason: 'related_entity_arthello_group', needsManualReview: false },
  { id: 'r03', namePattern: /ДЕТСКОЕ\s+ОБРАЗОВАНИЕ/i,
    newType: 'internal_company', financeTreatmentHint: 'internal_transfer_or_group_company',
    excludeFromRevExp: true,  confidence: 'high',
    reason: 'related_entity_management_company', needsManualReview: false },
  // ── UTILITIES (supplier) ─────────────────────────────────────────────────────
  { id: 'r10', namePattern: /ПЕТЕРБУРГСКАЯ\s+СБЫТОВАЯ/i,
    newType: 'supplier', financeTreatmentHint: 'utilities_or_kommunal',
    excludeFromRevExp: false, confidence: 'high',
    reason: 'utility_electricity_provider', needsManualReview: false },
  { id: 'r11', namePattern: /ТЭК\s*СПБ/i,
    newType: 'supplier', financeTreatmentHint: 'utilities_or_kommunal',
    excludeFromRevExp: false, confidence: 'high',
    reason: 'utility_heat_energy_provider', needsManualReview: false },
  { id: 'r12', namePattern: /водоканал|теплоснабж|энергосбыт/i,
    newType: 'supplier', financeTreatmentHint: 'utilities_or_kommunal',
    excludeFromRevExp: false, confidence: 'high',
    reason: 'utility_provider_name_match', needsManualReview: false },
  // ── LEASING / FINANCE (contractor) ──────────────────────────────────────────
  { id: 'r20', namePattern: /ГАЗПРОМБАНК\s+АВТОЛИЗИНГ|АВТОЛИЗИНГ/i,
    newType: 'contractor', financeTreatmentHint: 'lease_or_credit_payment',
    excludeFromRevExp: false, confidence: 'medium',
    reason: 'leasing_finance_provider', needsManualReview: false },
  { id: 'r21', namePattern: /\bЛИЗИНГ\b/i,
    newType: 'contractor', financeTreatmentHint: 'lease_or_credit_payment',
    excludeFromRevExp: false, confidence: 'medium',
    reason: 'leasing_company_name_match', needsManualReview: true },
  // ── CONTRACTORS / TRADE ─────────────────────────────────────────────────────
  { id: 'r30', namePattern: /ТД[\s\S]{0,5}ВЕСНА|ТОРГОВЫЙ\s+ДОМ.*ВЕСНА/i,
    newType: 'contractor', financeTreatmentHint: 'supplier_goods_or_services',
    excludeFromRevExp: false, confidence: 'medium',
    reason: 'trade_company_not_tax_authority', needsManualReview: false },
  { id: 'r31', namePattern: /АЕРО.{0,5}ИНЖИНИРИНГ/i,
    newType: 'contractor', financeTreatmentHint: 'supplier_goods_or_services',
    excludeFromRevExp: false, confidence: 'medium',
    reason: 'engineering_contractor_not_tax_authority', needsManualReview: false },
  // ── BANK: keep type, flag op-level split needed ───────────────────────────────
  { id: 'r40', namePattern: /Банк\s*Точка|TOCHKA/i,
    newType: 'bank_or_fee', financeTreatmentHint: 'bank_fee_or_acquiring_needs_split',
    excludeFromRevExp: false, confidence: 'high',
    reason: 'bank_mixed_income_expense_needs_operation_split', needsManualReview: false,
    flagNeedsOpLevel: true },
];

// True tax authorities — do NOT reclassify these
const TRUE_TAX_PATTERN = /\bФНС\b|\bИФНС\b|\bУФК\b|КАЗНАЧЕЙСТВ|\bОСФР\b|\bСФР\b|\bПФР\b|СОЦФОНД|СОЦИАЛЬНЫЙ\s+ФОНД/i;

function matchP84aRule(normalizedName: string, inn: string | null): P84aRule | null {
  for (const rule of P84A_RECLASS_RULES) {
    if (rule.innExact && inn === rule.innExact) return rule;
    if (rule.namePattern && rule.namePattern.test(normalizedName)) return rule;
  }
  return null;
}

router.post("/sync/reclassify-counterparties-p84a", async (req, res) => {
  const startedAt = Date.now();
  try {
    // ── 0. Production guard ─────────────────────────────────────────────────
    const dbRow = await pool.query<{ db: string }>("SELECT current_database() AS db");
    const dbName  = dbRow.rows[0]?.db ?? "";
    const nodeEnv = process.env["NODE_ENV"] ?? "";
    const isProduction =
      nodeEnv === "production" || dbName.includes("prod") || dbName.includes("neon") ||
      (!dbName.includes("dev") && !dbName.includes("test") && !dbName.includes("local"));

    if (!isProduction) {
      return res.json({ success: false,
        message: "P8.4a reclassification only valid on production — dev DB has no bank_transactions." });
    }

    // ── 1. Verify prerequisites ─────────────────────────────────────────────
    const countRow = await pool.query<{ cp_count: string; tx_count: string }>(
      "SELECT (SELECT COUNT(*) FROM counterparties)::text AS cp_count, (SELECT COUNT(*) FROM bank_transactions)::text AS tx_count"
    );
    const cpCount = Number(countRow.rows[0]?.cp_count ?? 0);
    const txCount = Number(countRow.rows[0]?.tx_count ?? 0);
    if (txCount === 0 || cpCount === 0) {
      return res.json({ success: false,
        message: `Prerequisites not met: counterparties=${cpCount}, bank_transactions=${txCount}. Run build-counterparties-from-bank first.` });
    }

    // ── 2. Load all counterparties ──────────────────────────────────────────
    const cpRes = await pool.query<{
      id: string; display_name: string; normalized_name: string;
      inn: string | null; counterparty_type: string;
      confidence: string; risk_flags: unknown;
      classification_version: string | null;
      total_income: string; total_expense: string; operations_count: string;
    }>("SELECT id, display_name, normalized_name, inn, counterparty_type, confidence, risk_flags, classification_version, total_income, total_expense, operations_count FROM counterparties ORDER BY operations_count::int DESC");

    // ── 3. Apply rules ──────────────────────────────────────────────────────
    interface ReclassEntry { id: string; displayName: string; oldType: string; newType: string; ruleId: string; reason: string }
    const changed: ReclassEntry[] = [];
    let updated = 0, unchanged = 0;
    const byTransition: Record<string, number> = {};

    for (const cp of cpRes.rows) {
      const name = (cp.normalized_name ?? cp.display_name ?? "").toUpperCase();
      const inn  = cp.inn?.trim() ?? null;
      const oldType = cp.counterparty_type;
      const rule = matchP84aRule(name, inn);
      const prevRiskFlags = (cp.risk_flags ?? {}) as Record<string, unknown>;

      let newType       = oldType;
      let hint: string | null  = null;
      let excludeRevExp = false;
      let nmr           = false;
      let ruleId        = "no_change";
      let reason        = "classification_confirmed";
      let newConfidence = cp.confidence;
      let updatedRiskFlags: Record<string, unknown> = { ...prevRiskFlags };

      if (rule) {
        newType       = rule.newType;
        hint          = rule.financeTreatmentHint;
        excludeRevExp = rule.excludeFromRevExp;
        nmr           = rule.needsManualReview;
        ruleId        = rule.id;
        reason        = rule.reason;
        newConfidence = rule.confidence;
        if (rule.flagNeedsOpLevel) updatedRiskFlags['needs_operation_level_classification'] = true;
        if (excludeRevExp) updatedRiskFlags['exclude_from_revenue_expense'] = true;
      } else {
        // No rule matched
        if (oldType === 'tax_authority' && !TRUE_TAX_PATTERN.test(name)) {
          nmr    = true;
          hint   = 'tax_authority_overclassification_needs_review';
          ruleId = 'manual_review';
          reason = 'unmatched_tax_authority_not_confirmed';
        } else if (oldType === 'internal_company') {
          hint   = 'internal_transfer_or_group_company';
          excludeRevExp = true;
          updatedRiskFlags['exclude_from_revenue_expense'] = true;
          ruleId = 'existing_internal';
          reason = 'already_classified_internal';
        } else {
          if (oldType === 'contractor') hint = 'supplier_goods_or_services';
          else if (oldType === 'employee_or_self_employed') hint = 'payroll_or_service_payment_needs_review';
          else if (oldType === 'parent_client') hint = 'needs_alpha_match';
          else if (oldType === 'bank_or_fee') hint = 'bank_fee_or_acquiring_needs_split';
        }
      }

      await pool.query(`
        UPDATE counterparties
        SET counterparty_type             = $1,
            confidence                    = $2,
            finance_treatment_hint        = $3,
            exclude_from_revenue_expense  = $4,
            needs_manual_review           = $5,
            reclassification_reason       = $6,
            classification_version        = 'p84a_v1',
            classification_updated_at     = NOW(),
            risk_flags                    = $7,
            updated_at                    = NOW()
        WHERE id = $8
      `, [newType, newConfidence, hint, excludeRevExp, nmr, reason,
          JSON.stringify(updatedRiskFlags), cp.id]);

      const transKey = newType !== oldType ? `${oldType} → ${newType}` : `${oldType} (unchanged)`;
      byTransition[transKey] = (byTransition[transKey] ?? 0) + 1;
      if (newType !== oldType) {
        updated++;
        changed.push({ id: cp.id, displayName: cp.display_name, oldType, newType, ruleId, reason });
      } else {
        unchanged++;
      }
    }

    // ── 4. Post-run counts ──────────────────────────────────────────────────
    const [afterTypes, excludedRow, needsMrRow] = await Promise.all([
      pool.query<{ t: string; cnt: string }>(
        "SELECT counterparty_type AS t, COUNT(*)::text AS cnt FROM counterparties GROUP BY t ORDER BY cnt DESC"
      ),
      pool.query<{ cnt: string }>(
        "SELECT COUNT(*)::text AS cnt FROM counterparties WHERE exclude_from_revenue_expense = TRUE"
      ),
      pool.query<{ cnt: string }>(
        "SELECT COUNT(*)::text AS cnt FROM counterparties WHERE needs_manual_review = TRUE"
      ),
    ]);

    const afterTypeMap: Record<string, number> = {};
    for (const r of afterTypes.rows) afterTypeMap[r.t] = Number(r.cnt);
    const excludedCount = Number(excludedRow.rows[0]?.cnt ?? 0);
    const needsMrTotal  = Number(needsMrRow.rows[0]?.cnt ?? 0);

    // ── 5. Readiness verdict ────────────────────────────────────────────────
    const internalExcluded = excludedCount > 0;
    let readiness: string;
    let readinessReason: string;
    if (!internalExcluded) {
      readiness = "NOT_READY";
      readinessReason = "Internal companies not flagged exclude_from_revenue_expense=true.";
    } else if (needsMrTotal > 5) {
      readiness = "READY_WITH_REVIEW";
      readinessReason = `${needsMrTotal} counterparties need manual type review (non-blocking). Internal companies excluded ✓. Bank Точка flagged ✓.`;
    } else {
      readiness = "READY_FOR_RECONCILIATION";
      readinessReason = `All counterparties reclassified. ${needsMrTotal} manual-review items. Internal companies excluded. Bank flagged for op-level split.`;
    }

    const durationMs = Date.now() - startedAt;
    req.log.info({ updated, unchanged, needsMrTotal, durationMs }, "reclassify-counterparties-p84a: done");

    return res.json({
      success:               true,
      durationMs,
      counterpartiesScanned: cpRes.rows.length,
      updated,
      unchanged,
      needsManualReview:     needsMrTotal,
      reclassificationSummary: Object.entries(byTransition)
        .map(([transition, count]) => ({ transition, count }))
        .sort((a, b) => b.count - a.count),
      examples: changed.slice(0, 20),
      afterTypeBreakdown: afterTypeMap,
      internalCompaniesExcluded: excludedCount,
      counterpartyReclassificationReadiness: readiness,
      readinessReason,
      p84bCanStart: readiness !== "NOT_READY",
      warnings: [
        "⚠️ Do NOT auto-merge duplicate candidates (66 pairs, same_inn_diff_key / SBP shared-INN pattern).",
        "⚠️ ООО 'Банк Точка' flagged needs_operation_level_classification — do not treat all 380 ops as simple fee.",
        "⚠️ Internal companies (exclude_from_revenue_expense=true) must be excluded from all P&L calculations.",
        "⚠️ Do NOT build final ДДС or ОПиУ before P8.4b Bank ↔ AlphaCRM matching.",
        `ℹ️ ${needsMrTotal} counterparties marked needs_manual_review — non-blocking for P8.4b.`,
      ],
    });

  } catch (err) {
    req.log.error({ err }, "reclassify-counterparties-p84a failed");
    return void res.status(500).json({ error: String(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// P8.4b — Bank ↔ AlphaCRM Reconciliation (idempotent per run)
// ══════════════════════════════════════════════════════════════════════════════
router.post("/sync/reconcile-bank-alpha-p84b", async (req, res) => {
  const startedAt = Date.now();

  try {
    // ── 0. Production guard ──────────────────────────────────────────────────
    const [dbRow, btRow, crmRow, linkRow, p84aRow] = await Promise.all([
      pool.query<{ db: string }>("SELECT current_database() AS db"),
      pool.query<{ cnt: string }>("SELECT COUNT(*)::text AS cnt FROM bank_transactions"),
      pool.query<{ cnt: string }>("SELECT COUNT(*)::text AS cnt FROM crm_payments"),
      pool.query<{ cnt: string }>("SELECT COUNT(DISTINCT bank_transaction_id)::text AS cnt FROM bank_transaction_counterparty_links"),
      pool.query<{ cnt: string }>("SELECT COUNT(*)::text AS cnt FROM counterparties WHERE classification_version = 'p84a_v1'"),
    ]);

    const dbName  = dbRow.rows[0]?.db ?? "";
    const nodeEnv = process.env["NODE_ENV"] ?? "";
    const isProduction =
      nodeEnv === "production" || dbName.includes("neon") || dbName.includes("prod") ||
      (!dbName.includes("dev") && !dbName.includes("test") && !dbName.includes("local"));

    if (!isProduction) {
      return void res.status(400).json({
        error: "BANK_ALPHA_RECONCILIATION_NOT_VALID_OUTSIDE_PRODUCTION",
        dbName, nodeEnv,
        message: "P8.4b reconciliation is only valid against the production bank dataset.",
      });
    }

    const btCount   = Number(btRow.rows[0]?.cnt ?? 0);
    const crmCount  = Number(crmRow.rows[0]?.cnt ?? 0);
    const linkCount = Number(linkRow.rows[0]?.cnt ?? 0);
    const p84aCount = Number(p84aRow.rows[0]?.cnt ?? 0);

    if (btCount < 800) {
      return void res.status(400).json({
        error: "BANK_ALPHA_RECONCILIATION_PRECONDITION_FAILED",
        reason: `Only ${btCount} bank transactions found. Expected ≥800 (production dataset).`,
      });
    }
    if (crmCount < 8_000) {
      return void res.status(400).json({
        error: "BANK_ALPHA_RECONCILIATION_PRECONDITION_FAILED",
        reason: `Only ${crmCount} CRM payments found. Expected ≥8,000 (Atlas production dataset has ~10,611 via 1/pay/index).`,
      });
    }
    if (linkCount < btCount * 0.9) {
      return void res.status(400).json({
        error: "BANK_ALPHA_RECONCILIATION_PRECONDITION_FAILED",
        reason: `Counterparty link coverage ${linkCount}/${btCount} is below 90%. Run POST /api/sync/build-counterparties-from-bank first.`,
      });
    }
    if (p84aCount === 0) {
      return void res.status(400).json({
        error: "BANK_ALPHA_RECONCILIATION_P84A_NOT_RUN",
        message: "P8.4a reclassification not run. Run POST /api/sync/reclassify-counterparties-p84a first.",
      });
    }

    // ── 1. Create reconciliation run record ──────────────────────────────────
    const runRes = await pool.query<{ id: string }>(
      "INSERT INTO bank_alpha_reconciliation_runs (status) VALUES ('running') RETURNING id"
    );
    const runId = runRes.rows[0]!.id;
    req.log.info({ runId }, "reconcile-bank-alpha-p84b: run created");

    // ── 2. Load bank transactions with counterparty info ─────────────────────
    const bankRes = await pool.query<{
      id: string;
      operation_date: string;
      amount: string;
      direction: string | null;
      counterparty_name: string | null;
      counterparty_inn: string | null;
      purpose: string | null;
      is_transfer: boolean;
      is_tax: boolean;
      cp_id: string | null;
      cp_type: string | null;
      cp_exclude: boolean;
      cp_name: string | null;
    }>(`
      SELECT bt.id,
             bt.operation_date::text,
             bt.amount::numeric(15,2)::text AS amount,
             bt.direction,
             bt.counterparty_name,
             bt.counterparty_inn,
             bt.purpose,
             (COALESCE(bt.is_transfer_between_own_accounts, FALSE)
              OR COALESCE(bt.is_internal_transfer, FALSE)) AS is_transfer,
             COALESCE(bt.is_tax, FALSE) AS is_tax,
             cp.id::text   AS cp_id,
             cp.counterparty_type AS cp_type,
             COALESCE(cp.exclude_from_revenue_expense, FALSE) AS cp_exclude,
             cp.display_name AS cp_name
      FROM bank_transactions bt
      LEFT JOIN bank_transaction_counterparty_links lnk
             ON lnk.bank_transaction_id = bt.id::text
      LEFT JOIN counterparties cp ON cp.id = lnk.counterparty_id
    `);

    // ── 3. Load CRM payments for Atlas branch ────────────────────────────────
    const crmRes = await pool.query<{
      id: string;
      crm_id: string | null;
      student_crm_id: string | null;
      amount: string;
      document_date: string | null;
      payment_type_normalized: string | null;
      direction: string | null;
      finance_treatment_hint: string | null;
      reconciliation_risk_level: string | null;
      student_id: string | null;
      student_identity_id: string | null;
    }>(`
      SELECT id::text,
             crm_id,
             student_crm_id,
             amount::numeric(15,2)::text AS amount,
             document_date::text,
             payment_type_normalized,
             direction,
             finance_treatment_hint,
             reconciliation_risk_level,
             student_id::text,
             student_identity_id::text
      FROM crm_payments
      WHERE branch_crm_id = '6'
    `);

    const bankTxs   = bankRes.rows;
    const crmAll    = crmRes.rows;
    req.log.info({ bankTxs: bankTxs.length, crmAll: crmAll.length }, "reconcile-bank-alpha-p84b: data loaded");

    // ── 4. Classify CRM payments ─────────────────────────────────────────────
    type CrmPay = (typeof crmAll)[0];
    const crmEligible:            CrmPay[] = [];
    const crmExcludedCollection:  CrmPay[] = [];
    const crmExcludedOther:       CrmPay[] = [];

    for (const p of crmAll) {
      if (p.finance_treatment_hint === 'collection_internal') {
        crmExcludedCollection.push(p);
      } else if (p.payment_type_normalized === 'income') {
        crmEligible.push(p);
      } else {
        crmExcludedOther.push(p);
      }
    }

    // Build amount → eligible CRM payments map (key: '1500.00' normalized string)
    const crmByAmount = new Map<string, CrmPay[]>();
    for (const p of crmEligible) {
      const key = p.amount;
      if (!crmByAmount.has(key)) crmByAmount.set(key, []);
      crmByAmount.get(key)!.push(p);
    }

    // ── 5. Process each bank transaction ─────────────────────────────────────
    const matchedCrmIds = new Set<string>();

    type MatchRec = {
      bank_transaction_id: string;
      crm_payment_id: string | null;
      match_status: string;
      match_confidence: string;
      match_method: string;
      amount_delta: string | null;
      date_delta_days: number | null;
      bank_amount: string;
      crm_amount: string | null;
      bank_date: string;
      crm_date: string | null;
      bank_counterparty_id: string | null;
      bank_counterparty_name: string | null;
      crm_customer_alpha_id: string | null;
      student_id: string | null;
      student_identity_id: string | null;
      reasons: object;
      risk_flags: object;
    };

    const matchRecs: MatchRec[] = [];

    let excInternalCount  = 0;
    let excBankFeeCount   = 0;
    let matchedExact      = 0;
    let matchedHigh       = 0;
    let possibleCount     = 0;
    let needsReviewCount  = 0;
    let unmatchedBankCount = 0;

    function dateDeltaDays(d1: string | null, d2: string | null): number {
      if (!d1 || !d2) return 9999;
      return Math.round(
        Math.abs(new Date(d1).getTime() - new Date(d2).getTime()) / 86_400_000
      );
    }

    for (const tx of bankTxs) {
      const isExcludedInternal =
        tx.cp_exclude || tx.cp_type === 'internal_company' || tx.is_transfer;
      const isExcludedBankFee  = tx.cp_type === 'bank_or_fee';

      // ── Exclude internal / transfer transactions ─────────────────────────
      if (isExcludedInternal) {
        excInternalCount++;
        matchRecs.push({
          bank_transaction_id: tx.id,
          crm_payment_id: null,
          match_status:    'excluded_internal',
          match_confidence:'none',
          match_method:    'excluded_rule',
          amount_delta: null, date_delta_days: null,
          bank_amount: tx.amount, crm_amount: null,
          bank_date: tx.operation_date, crm_date: null,
          bank_counterparty_id:   tx.cp_id,
          bank_counterparty_name: tx.cp_name ?? tx.counterparty_name,
          crm_customer_alpha_id: null, student_id: null, student_identity_id: null,
          reasons:    { reason: 'internal_company_or_own_transfer', cpType: tx.cp_type, cpExclude: tx.cp_exclude },
          risk_flags: {},
        });
        continue;
      }

      // ── Exclude bank fees ────────────────────────────────────────────────
      if (isExcludedBankFee) {
        excBankFeeCount++;
        matchRecs.push({
          bank_transaction_id: tx.id,
          crm_payment_id: null,
          match_status:    'excluded_bank_fee',
          match_confidence:'none',
          match_method:    'excluded_rule',
          amount_delta: null, date_delta_days: null,
          bank_amount: tx.amount, crm_amount: null,
          bank_date: tx.operation_date, crm_date: null,
          bank_counterparty_id:   tx.cp_id,
          bank_counterparty_name: tx.cp_name ?? tx.counterparty_name,
          crm_customer_alpha_id: null, student_id: null, student_identity_id: null,
          reasons:    { reason: 'bank_or_fee_counterparty' },
          risk_flags: {},
        });
        continue;
      }

      // ── Only match income bank transactions against CRM income payments ──
      if (tx.direction !== 'income') {
        unmatchedBankCount++;
        matchRecs.push({
          bank_transaction_id: tx.id,
          crm_payment_id: null,
          match_status:    'unmatched_bank',
          match_confidence:'none',
          match_method:    'none',
          amount_delta: null, date_delta_days: null,
          bank_amount: tx.amount, crm_amount: null,
          bank_date: tx.operation_date, crm_date: null,
          bank_counterparty_id:   tx.cp_id,
          bank_counterparty_name: tx.cp_name ?? tx.counterparty_name,
          crm_customer_alpha_id: null, student_id: null, student_identity_id: null,
          reasons:    { reason: 'bank_expense_or_null_direction', direction: tx.direction },
          risk_flags: {},
        });
        continue;
      }

      // ── Match by amount then date window ─────────────────────────────────
      const amtKey    = tx.amount;
      const allByAmt  = crmByAmount.get(amtKey) ?? [];
      const candidates = allByAmt.filter(p => !matchedCrmIds.has(p.id));

      if (candidates.length === 0) {
        unmatchedBankCount++;
        matchRecs.push({
          bank_transaction_id: tx.id,
          crm_payment_id: null,
          match_status:    'unmatched_bank',
          match_confidence:'none',
          match_method:    'none',
          amount_delta: null, date_delta_days: null,
          bank_amount: tx.amount, crm_amount: null,
          bank_date: tx.operation_date, crm_date: null,
          bank_counterparty_id:   tx.cp_id,
          bank_counterparty_name: tx.cp_name ?? tx.counterparty_name,
          crm_customer_alpha_id: null, student_id: null, student_identity_id: null,
          reasons:    { reason: 'bank_alpha_no_crm_candidate_for_amount', amount: amtKey },
          risk_flags: {},
        });
        continue;
      }

      // Score by date proximity
      type ScoredC = { p: CrmPay; delta: number };
      const scored: ScoredC[] = candidates
        .map(p => ({ p, delta: dateDeltaDays(p.document_date, tx.operation_date) }))
        .sort((a, b) => a.delta - b.delta);

      const exactDate = scored.filter(s => s.delta === 0);
      const within1   = scored.filter(s => s.delta <= 1);
      const within3   = scored.filter(s => s.delta <= 3);

      let chosen: ScoredC | null = null;
      let matchStatus   = '';
      let matchConf     = '';
      let matchMethod   = '';
      let isMultiCandidate = false;
      let multiReason  = '';

      if (exactDate.length === 1) {
        chosen = exactDate[0]!;
        matchStatus  = 'matched';
        matchConf    = 'exact';
        matchMethod  = 'exact_amount_date';
        matchedExact++;
      } else if (exactDate.length > 1) {
        isMultiCandidate = true;
        multiReason = 'multiple_exact_date_candidates';
        needsReviewCount++;
      } else if (within1.length === 1) {
        chosen = within1[0]!;
        matchStatus  = 'matched';
        matchConf    = 'high';
        matchMethod  = 'amount_date_window_customer';
        matchedHigh++;
      } else if (within1.length > 1) {
        isMultiCandidate = true;
        multiReason = 'multiple_within_1day_candidates';
        needsReviewCount++;
      } else if (within3.length === 1) {
        chosen = within3[0]!;
        matchStatus  = 'possible_match';
        matchConf    = 'medium';
        matchMethod  = 'amount_date_window_customer';
        possibleCount++;
      } else if (within3.length > 1) {
        isMultiCandidate = true;
        multiReason = 'multiple_within_3day_candidates';
        needsReviewCount++;
      } else if (candidates.length === 1) {
        // Only one CRM candidate but date is far
        chosen = scored[0]!;
        matchStatus  = 'possible_match';
        matchConf    = 'low';
        matchMethod  = 'amount_only_customer';
        possibleCount++;
      } else {
        // Multiple candidates but all dates are far
        isMultiCandidate = true;
        multiReason = 'multiple_candidates_date_mismatch';
        needsReviewCount++;
      }

      if (isMultiCandidate) {
        matchRecs.push({
          bank_transaction_id: tx.id,
          crm_payment_id: null,
          match_status:    'needs_review',
          match_confidence:'low',
          match_method:    'none',
          amount_delta: '0.00',
          date_delta_days: scored[0]?.delta ?? null,
          bank_amount: tx.amount,
          crm_amount:  scored[0]?.p?.amount ?? null,
          bank_date: tx.operation_date,
          crm_date:  scored[0]?.p?.document_date ?? null,
          bank_counterparty_id:   tx.cp_id,
          bank_counterparty_name: tx.cp_name ?? tx.counterparty_name,
          crm_customer_alpha_id: null, student_id: null, student_identity_id: null,
          reasons: {
            reason: 'bank_alpha_multiple_crm_candidates',
            detail: multiReason,
            candidateCount: candidates.length,
            topCandidates: scored.slice(0, 5).map(s => ({
              crmId: s.p.id, crm_id: s.p.crm_id,
              dateDelta: s.delta, date: s.p.document_date,
              studentCrmId: s.p.student_crm_id,
            })),
          },
          risk_flags: {},
        });
      } else if (chosen) {
        matchedCrmIds.add(chosen.p.id);
        matchRecs.push({
          bank_transaction_id: tx.id,
          crm_payment_id: chosen.p.id,
          match_status:    matchStatus,
          match_confidence: matchConf,
          match_method:    matchMethod,
          amount_delta:    '0.00',
          date_delta_days: chosen.delta,
          bank_amount: tx.amount,
          crm_amount:  chosen.p.amount,
          bank_date: tx.operation_date,
          crm_date:  chosen.p.document_date,
          bank_counterparty_id:   tx.cp_id,
          bank_counterparty_name: tx.cp_name ?? tx.counterparty_name,
          crm_customer_alpha_id:  chosen.p.student_crm_id,
          student_id:         chosen.p.student_id,
          student_identity_id: chosen.p.student_identity_id,
          reasons: {
            reason: 'amount_date_match',
            dateDeltaDays: chosen.delta,
            crmPaymentId: chosen.p.id,
            crmCrmId: chosen.p.crm_id,
          },
          risk_flags: chosen.p.reconciliation_risk_level
            ? { riskLevel: chosen.p.reconciliation_risk_level } : {},
        });
      }
    }

    // ── 6. Bulk-insert match records ─────────────────────────────────────────
    const CHUNK = 50;
    for (let i = 0; i < matchRecs.length; i += CHUNK) {
      const chunk = matchRecs.slice(i, i + CHUNK);
      const placeholders = chunk
        .map((_, j) => {
          const b = j * 18;
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18})`;
        })
        .join(',');
      const values = chunk.flatMap(m => [
        runId,
        m.bank_transaction_id,
        m.crm_payment_id,
        m.match_status,
        m.match_confidence,
        m.match_method,
        m.amount_delta,
        m.date_delta_days,
        m.bank_amount,
        m.crm_amount,
        m.bank_date,
        m.crm_date,
        m.bank_counterparty_id,
        m.bank_counterparty_name,
        m.crm_customer_alpha_id,
        m.student_id,
        JSON.stringify(m.reasons),
        JSON.stringify(m.risk_flags),
      ]);
      await pool.query(`
        INSERT INTO bank_alpha_reconciliation_matches
          (run_id, bank_transaction_id, crm_payment_id, match_status, match_confidence, match_method,
           amount_delta, date_delta_days, bank_amount, crm_amount, bank_date, crm_date,
           bank_counterparty_id, bank_counterparty_name, crm_customer_alpha_id, student_id,
           reasons, risk_flags)
        VALUES ${placeholders}
      `, values);
    }

    // ── 7. Compute stats and update run record ────────────────────────────────
    const unmatchedCrmCount  = crmEligible.filter(p => !matchedCrmIds.has(p.id)).length;
    const excCollectionCount = crmExcludedCollection.length;
    const totalMatched       = matchedExact + matchedHigh;
    const eligibleBankIncome = bankTxs.filter(tx => {
      if (tx.cp_exclude || tx.cp_type === 'internal_company' || tx.is_transfer) return false;
      if (tx.cp_type === 'bank_or_fee') return false;
      return tx.direction === 'income';
    }).length;
    const matchRate = eligibleBankIncome > 0
      ? Math.round((totalMatched / eligibleBankIncome) * 100) : 0;

    await pool.query(`
      UPDATE bank_alpha_reconciliation_runs SET
        status                   = 'completed',
        finished_at              = NOW(),
        bank_transactions_checked = $1,
        crm_payments_checked     = $2,
        matched_count            = $3,
        partial_count            = 0,
        possible_count           = $4,
        unmatched_bank_count     = $5,
        unmatched_crm_count      = $6,
        excluded_internal_count  = $7,
        excluded_collection_count = $8,
        excluded_bank_fee_count  = $9,
        needs_review_count       = $10
      WHERE id = $11
    `, [
      bankTxs.length, crmAll.length, totalMatched, possibleCount,
      unmatchedBankCount, unmatchedCrmCount, excInternalCount,
      excCollectionCount, excBankFeeCount, needsReviewCount, runId,
    ]);

    // ── 8. Readiness verdict ──────────────────────────────────────────────────
    let readiness: string;
    if (matchRate >= 80 && unmatchedBankCount < 50) {
      readiness = 'READY_FOR_VERIFIED_FINANCE';
    } else if (totalMatched > 0 || possibleCount > 0) {
      readiness = 'PARTIAL_READY';
    } else {
      readiness = 'NOT_READY';
    }

    const durationMs = Date.now() - startedAt;
    req.log.info({ runId, totalMatched, possibleCount, needsReviewCount, unmatchedBankCount, unmatchedCrmCount, matchRate, durationMs }, "reconcile-bank-alpha-p84b: done");

    return res.json({
      success: true,
      runId,
      durationMs,
      bankTransactionsChecked:  bankTxs.length,
      crmPaymentsChecked:       crmAll.length,
      crmEligibleCount:         crmEligible.length,
      eligibleBankIncomeCount:  eligibleBankIncome,
      matchedExact,
      matchedHigh,
      totalMatched,
      possibleCount,
      needsReviewCount,
      unmatchedBankCount,
      unmatchedCrmCount,
      excludedInternalCount:    excInternalCount,
      excludedCollectionCount:  excCollectionCount,
      excludedBankFeeCount:     excBankFeeCount,
      matchRate,
      bankAlphaReconciliationReadiness: readiness,
      warnings: [
        "⚠️ Do NOT build final ДДС or ОПиУ before P8.5 — reconciliation is a first pass only.",
        "⚠️ collection_internal (229 records) are excluded from matching — these are encashment ops, not client revenue.",
        "⚠️ Internal companies (exclude_from_revenue_expense=true) are excluded from all matching.",
        `ℹ️ ${needsReviewCount} bank transactions have multiple CRM amount-candidates — manual review required.`,
        `ℹ️ ${unmatchedCrmCount} eligible CRM income payments have no bank transaction match — review for phantom/prior-period payments.`,
      ],
    });

  } catch (err) {
    req.log.error({ err }, "reconcile-bank-alpha-p84b failed");
    return void res.status(500).json({ error: String(err) });
  }
});

// ─── POST /sync/groups-atlas ──────────────────────────────────────────────────
// P9.4: Fetches Atlas branch-6 groups from AlphaCRM → alpha_raw_records →
// crm_groups in one idempotent pass. No destructive operations.

router.post("/sync/groups-atlas", async (req, res): Promise<void> => {
  const startedAt = new Date();
  const BRANCH_ID = "6";
  const TODAY = new Date().toISOString().slice(0, 10);

  try {
    const atlasBranchId = await getAtlasBranchId();
    if (!atlasBranchId) {
      res.status(400).json({ success: false, message: "Atlas branch not found. Run Sync Branches first." });
      return;
    }

    // ── 1. Fetch all groups from AlphaCRM ────────────────────────────────────
    const endpoint = `${atlasBranchId}/group/index`;
    req.log.info({ endpoint }, "P9.4: Fetching Atlas groups from AlphaCRM");
    const items = await crmGetAllPages<Record<string, unknown>>(endpoint, {});

    let fetched = 0;
    let rawInserted = 0;
    let rawUpdated = 0;
    let rawErrors = 0;

    let created = 0;
    let updated = 0;
    let failed = 0;
    let rawCount = 0;
    const examples: Array<{ crm_id: string; name: string | null; lifecycle: string; teachers: string[] }> = [];

    const client = await pool.connect();
    try {
      // ── 2. Store to alpha_raw_records ────────────────────────────────────────
      for (const item of items) {
        const alphaId = item["id"] != null ? String(item["id"]) : null;
        if (!alphaId) { rawErrors++; continue; }
        fetched++;
        const payload = JSON.stringify(item);
        const hash = _md5(payload);
        try {
          const r = await client.query<{ is_insert: boolean }>(
            `INSERT INTO alpha_raw_records
               (alpha_id, entity_type, endpoint, branch_id, source_payload, payload_hash, page, synced_at, updated_at)
             VALUES ($1, 'groups', $2, $3, $4::jsonb, $5, 0, NOW(), NOW())
             ON CONFLICT (alpha_id, entity_type, branch_id, payload_hash) DO UPDATE SET
               synced_at = NOW(), updated_at = NOW()
             RETURNING (xmax = 0) AS is_insert`,
            [alphaId, endpoint, BRANCH_ID, payload, hash],
          );
          if (r.rows[0]?.is_insert === true) rawInserted++; else rawUpdated++;
        } catch (rowErr) {
          rawErrors++;
          req.log.error({ rowErr, alphaId }, "groups-atlas: raw insert failed");
        }
      }

      // ── 3. Normalize alpha_raw_records → crm_groups ──────────────────────────
      const rawResult = await client.query<{
        id: string;
        alpha_id: string;
        payload_hash: string;
        source_payload: Record<string, unknown>;
      }>(
        `SELECT id, alpha_id, payload_hash, source_payload
         FROM alpha_raw_records WHERE entity_type = 'groups' AND branch_id = $1 ORDER BY alpha_id`,
        [BRANCH_ID],
      );

      rawCount = rawResult.rows.length;

      for (const row of rawResult.rows) {
        try {
          const p = row.source_payload;
          const crmId = row.alpha_id;

          const name     = p["name"]   ? String(p["name"]).trim()   || null : null;
          const note     = p["note"]   ? String(p["note"]).trim()   || null : null;
          const bDate    = p["b_date"] ? String(p["b_date"])                : null;
          const eDate    = p["e_date"] ? String(p["e_date"])                : null;
          const capacity = p["limit"]  != null ? Number(p["limit"]) || null : null;

          const embeddedTeachers = Array.isArray(p["teachers"])
            ? (p["teachers"] as Array<Record<string, unknown>>)
            : [];
          const teacherCrmIds = embeddedTeachers
            .map(t => t["id"] != null ? String(t["id"]) : null)
            .filter((id): id is string => id !== null);

          let lifecycleStatus: string;
          if (!eDate) lifecycleStatus = "unknown";
          else if (eDate < TODAY) lifecycleStatus = "archived";
          else lifecycleStatus = "active";

          const createdAtCrm = p["created_at"] ? new Date(String(p["created_at"])) : null;
          const updatedAtCrm = p["updated_at"]  ? new Date(String(p["updated_at"])) : null;

          const upsertR = await client.query<{ inserted: boolean }>(
            `INSERT INTO crm_groups (
               crm_id, branch_crm_id, name, note, b_date, e_date, capacity,
               teacher_crm_ids, raw, synced_at,
               lifecycle_status, alpha_status, raw_record_id, source_payload_hash,
               created_at_crm, updated_at_crm
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10,$11,$12,$13,$14,$15)
             ON CONFLICT (crm_id) DO UPDATE SET
               name                = EXCLUDED.name,
               note                = EXCLUDED.note,
               b_date              = EXCLUDED.b_date,
               e_date              = EXCLUDED.e_date,
               capacity            = EXCLUDED.capacity,
               teacher_crm_ids     = EXCLUDED.teacher_crm_ids,
               raw                 = EXCLUDED.raw,
               synced_at           = NOW(),
               lifecycle_status    = EXCLUDED.lifecycle_status,
               alpha_status        = EXCLUDED.alpha_status,
               raw_record_id       = EXCLUDED.raw_record_id,
               source_payload_hash = EXCLUDED.source_payload_hash,
               created_at_crm      = EXCLUDED.created_at_crm,
               updated_at_crm      = EXCLUDED.updated_at_crm
             RETURNING (xmax = 0) AS inserted`,
            [
              crmId, BRANCH_ID, name, note, bDate, eDate, capacity,
              JSON.stringify(teacherCrmIds), JSON.stringify(p),
              lifecycleStatus, lifecycleStatus, row.id, row.payload_hash,
              createdAtCrm, updatedAtCrm,
            ],
          );

          if (upsertR.rows[0]?.inserted) created++; else updated++;
          if (examples.length < 30) {
            examples.push({ crm_id: crmId, name, lifecycle: lifecycleStatus, teachers: teacherCrmIds });
          }
        } catch (rowErr) {
          failed++;
          req.log.error({ rowErr, alphaId: row.alpha_id }, "groups-atlas: normalize failed");
        }
      }

    } finally {
      client.release();
    }

    // ── 4. Lifecycle summary ─────────────────────────────────────────────────
    const lcResult = await pool.query<{ lifecycle_status: string; cnt: string }>(
      `SELECT lifecycle_status, COUNT(*) AS cnt FROM crm_groups WHERE branch_crm_id=$1 GROUP BY 1`,
      [BRANCH_ID],
    );
    const lc: Record<string, number> = {};
    for (const r of lcResult.rows) lc[r.lifecycle_status ?? "unknown"] = Number(r.cnt);

    const msg = `P9.4: Fetched ${fetched} Atlas groups → alpha_raw_records (${rawInserted} new, ${rawUpdated} unchanged) → crm_groups (created=${created} updated=${updated} failed=${failed})`;
    req.log.info(msg);
    await logSync("groups", "success", msg, fetched, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      branchId: BRANCH_ID,
      raw: { fetched, inserted: rawInserted, updated: rawUpdated, errors: rawErrors },
      groups: { total: rawCount, created, updated, failed, lifecycleSummary: lc },
      examples,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "groups-atlas: failed");
    await logSync("groups", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message });
  }
});

// ─── POST /sync/repair-lessons-atlas-columns ──────────────────────────────────
// P9.4: Fills NULL crm_lessons columns (group_crm_id, teacher_crm_id,
// lesson_type_name, subject_crm_id, group_crm_ids, teacher_crm_ids) from
// crm_lessons.raw JSONB. Idempotent — safe to re-run.

router.post("/sync/repair-lessons-atlas-columns", async (req, res): Promise<void> => {
  const startedAt = new Date();
  const BRANCH_ID = "6";
  try {
    // ── Bulk UPDATE from raw JSON → columns ───────────────────────────────────
    const updateResult = await pool.query<{ updated_count: string }>(`
      WITH repaired AS (
        UPDATE crm_lessons SET
          group_crm_id     = CASE
            WHEN jsonb_typeof(raw->'group_ids') = 'array'
              AND jsonb_array_length(raw->'group_ids') > 0
            THEN (raw->'group_ids'->>0)
            ELSE NULL END,
          group_crm_ids    = COALESCE(
            (SELECT jsonb_agg(v::text)
             FROM jsonb_array_elements(COALESCE(raw->'group_ids', '[]'::jsonb)) v),
            '[]'::jsonb),
          teacher_crm_id   = CASE
            WHEN jsonb_typeof(raw->'teacher_ids') = 'array'
              AND jsonb_array_length(raw->'teacher_ids') > 0
            THEN (raw->'teacher_ids'->>0)
            ELSE NULL END,
          teacher_crm_ids  = COALESCE(
            (SELECT jsonb_agg(v::text)
             FROM jsonb_array_elements(COALESCE(raw->'teacher_ids', '[]'::jsonb)) v),
            '[]'::jsonb),
          lesson_type_name = raw->>'lesson_type_name',
          subject_crm_id   = raw->>'subject_id',
          synced_at        = NOW()
        WHERE branch_crm_id = $1
          AND raw IS NOT NULL
        RETURNING 1
      )
      SELECT COUNT(*) AS updated_count FROM repaired
    `, [BRANCH_ID]);

    const updatedCount = Number(updateResult.rows[0]?.updated_count ?? 0);

    // ── Coverage stats post-repair ────────────────────────────────────────────
    const statsResult = await pool.query<{
      lessons_total: string;
      with_group_crm_id: string;
      with_teacher_crm_id: string;
      with_lesson_type_name: string;
      without_group_crm_id: string;
      without_teacher_crm_id: string;
    }>(`
      SELECT
        COUNT(*)                                        AS lessons_total,
        COUNT(group_crm_id)                             AS with_group_crm_id,
        COUNT(teacher_crm_id)                           AS with_teacher_crm_id,
        COUNT(lesson_type_name)                         AS with_lesson_type_name,
        COUNT(*) FILTER (WHERE group_crm_id IS NULL)    AS without_group_crm_id,
        COUNT(*) FILTER (WHERE teacher_crm_id IS NULL)  AS without_teacher_crm_id
      FROM crm_lessons WHERE branch_crm_id = $1
    `, [BRANCH_ID]);

    const stats = statsResult.rows[0];

    // ── Update crm_groups.inferred_subject_name where lesson_type_name is now filled ──
    // Uses the most common lesson_type_name per group as a proxy until real subjects sync
    await pool.query(`
      UPDATE crm_groups g
      SET inferred_subject_name = ranked.lesson_type_name
      FROM (
        SELECT group_crm_id, lesson_type_name
        FROM (
          SELECT
            group_crm_id,
            lesson_type_name,
            COUNT(*) AS cnt,
            ROW_NUMBER() OVER (PARTITION BY group_crm_id ORDER BY COUNT(*) DESC) AS rn
          FROM crm_lessons
          WHERE branch_crm_id = $1
            AND group_crm_id IS NOT NULL
            AND lesson_type_name IS NOT NULL
          GROUP BY group_crm_id, lesson_type_name
        ) x WHERE rn = 1
      ) ranked
      WHERE g.crm_id = ranked.group_crm_id AND g.branch_crm_id = $1
    `, [BRANCH_ID]);

    const msg = `P9.4: Repaired ${updatedCount} crm_lessons from raw JSONB → columns populated`;
    req.log.info({ updatedCount, ...stats }, msg);
    await logSync("lessons", "success", msg, updatedCount, undefined, startedAt);

    res.json({
      success: true,
      message: msg,
      updated_rows: updatedCount,
      lessons_total: Number(stats.lessons_total),
      lessons_with_group_id: Number(stats.with_group_crm_id),
      lessons_with_teacher_id: Number(stats.with_teacher_crm_id),
      lessons_with_lesson_type_name: Number(stats.with_lesson_type_name),
      lessons_without_group_id: Number(stats.without_group_crm_id),
      lessons_without_teacher_id: Number(stats.without_teacher_crm_id),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "repair-lessons-atlas-columns: failed");
    await logSync("lessons", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message });
  }
});

export default router;
