import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  marketingLeadsTable,
  marketingSourcesTable,
  leadEventsTable,
  crmStudentsTable,
  syncLogsTable,
  settingsTable,
} from "@workspace/db";
import { sql, desc, count, eq, and, or } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  readSheetRows,
  normalisePhone,
  parseDate,
} from "../lib/googleSheets.js";

export const marketingRouter: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logSync(
  entity: string,
  status: "success" | "error",
  message: string,
  recordsCount = 0,
  rawError?: unknown,
  startedAt?: Date,
): Promise<void> {
  const now = new Date();
  await db.insert(syncLogsTable).values({
    entity,
    status,
    message,
    recordsCount,
    rawError: rawError ? (rawError as Record<string, unknown>) : null,
    startedAt: startedAt ?? now,
    finishedAt: now,
  });
}

/** Guess which header column maps to which field by keyword matching */
function detectColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const lower = headers.map((h) => h.toLowerCase());

  const matchers: Array<{ field: string; keywords: string[] }> = [
    { field: "lead_date", keywords: ["дата", "date"] },
    {
      field: "branch_name",
      keywords: ["филиал", "branch", "студия", "studio"],
    },
    { field: "channel", keywords: ["канал", "channel"] },
    { field: "source", keywords: ["источник", "source", "utm_source"] },
    { field: "campaign", keywords: ["кампания", "campaign", "utm_campaign"] },
    {
      field: "lead_name",
      keywords: ["имя", "name", "клиент", "client", "фио"],
    },
    { field: "phone", keywords: ["телефон", "phone", "tel", "номер"] },
    {
      field: "message",
      keywords: ["сообщение", "message", "запрос", "comment"],
    },
    { field: "status", keywords: ["статус", "status"] },
    { field: "manager", keywords: ["менеджер", "manager", "ответственный"] },
    { field: "comment", keywords: ["комментарий", "примечание", "note"] },
  ];

  for (const { field, keywords } of matchers) {
    for (let i = 0; i < lower.length; i++) {
      const h = lower[i] ?? "";
      if (keywords.some((k) => h.includes(k))) {
        if (!(field in map)) map[field] = i;
        break;
      }
    }
  }

  return map;
}

/** Phone normalisation for matching — strip all non-digits, keep last 10 digits */
function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.slice(-10);
}

// ─── POST /api/sync/google-leads ──────────────────────────────────────────────

marketingRouter.post("/sync/google-leads", async (req, res): Promise<void> => {
  const startedAt = new Date();
  req.log.info("Syncing leads from Google Sheets");

  const spreadsheetId =
    (req.body as Record<string, string>).sheetId ??
    process.env.GOOGLE_SHEET_ID_PROMOTION;

  if (!spreadsheetId) {
    res.status(400).json({
      success: false,
      message:
        "No Google Sheet ID provided. Set GOOGLE_SHEET_ID_PROMOTION env var or pass sheetId in body.",
      stats: null,
    });
    return;
  }

  const sheetName = (req.body as Record<string, string>).sheetName ?? "Sheet1";

  try {
    const { headers, rows } = await readSheetRows(spreadsheetId, sheetName, 1);

    if (!headers.length) {
      const msg = "Sheet is empty or has no header row";
      await logSync("google-leads", "error", msg, 0, undefined, startedAt);
      res.json({ success: false, message: msg, stats: null });
      return;
    }

    const colMap = detectColumnMap(headers);
    logger.info({ headers, colMap }, "Column mapping detected");

    // Load existing students for phone matching
    const students = await db
      .select({ crmId: crmStudentsTable.crmId, phone: crmStudentsTable.phone })
      .from(crmStudentsTable);
    const studentsByPhone = new Map<string, string>();
    for (const s of students) {
      if (s.phone) {
        const k = phoneKey(s.phone);
        if (k.length >= 7) studentsByPhone.set(k, s.crmId);
      }
    }

    // Load existing marketing leads for duplicate detection
    const existingLeads = await db
      .select({
        phone: marketingLeadsTable.phone,
        leadDate: marketingLeadsTable.leadDate,
        source: marketingLeadsTable.source,
      })
      .from(marketingLeadsTable);
    const existingKeys = new Set(
      existingLeads.map(
        (l) =>
          `${phoneKey(l.phone ?? "")}|${l.leadDate ?? ""}|${(l.source ?? "").toLowerCase()}`,
      ),
    );

    let inserted = 0;
    let duplicates = 0;
    let skipped = 0;
    const unrecognised: number[] = [];

    for (const row of rows) {
      const v = row.values;
      const get = (field: string): string => {
        const idx = colMap[field];
        return idx !== undefined ? (v[idx] ?? "").trim() : "";
      };

      const phone = normalisePhone(get("phone"));
      const leadDateRaw = get("lead_date");
      const leadDate = parseDate(leadDateRaw);
      const source = get("source");
      const channel = get("channel");
      const branchName = get("branch_name");
      const leadName = get("lead_name");
      const status = get("status");
      const manager = get("manager");
      const message = get("message");
      const campaign = get("campaign");
      const comment = get("comment");

      // Skip completely empty rows
      if (!phone && !leadName && !leadDateRaw) {
        skipped++;
        continue;
      }

      // Flag rows with no phone
      if (!phone) {
        unrecognised.push(row.rowNumber);
        skipped++;
        continue;
      }

      // Duplicate check
      const dupKey = `${phoneKey(phone)}|${leadDate ?? ""}|${source.toLowerCase()}`;
      const isDuplicate = existingKeys.has(dupKey);
      if (isDuplicate) duplicates++;
      existingKeys.add(dupKey);

      // Phone-match to student
      const pk = phoneKey(phone);
      const matchedStudentCrmId =
        pk.length >= 7 ? (studentsByPhone.get(pk) ?? null) : null;

      // Insert into lead_events first, get the id
      const [leEvent] = await db
        .insert(leadEventsTable)
        .values({
          sourceSystem: "google_sheets",
          externalId: String(row.rowNumber),
          eventTime: leadDate ? new Date(leadDate) : null,
          branchName: branchName || null,
          channel: channel || null,
          source: source || null,
          campaign: campaign || null,
          clientName: leadName || null,
          phone: phone || null,
          message: message || null,
          status: status || null,
          manager: manager || null,
          raw: row.raw as Record<string, unknown>,
          matchedStudentCrmId,
          duplicateCandidate: isDuplicate,
        })
        .returning({ id: leadEventsTable.id });

      const leadEventId = leEvent?.id ?? null;

      // Insert into marketing_leads
      await db.insert(marketingLeadsTable).values({
        googleSheetId: spreadsheetId,
        sheetName,
        rowNumber: row.rowNumber,
        leadDate: leadDate ?? null,
        branchName: branchName || null,
        channel: channel || null,
        source: source || null,
        campaign: campaign || null,
        leadName: leadName || null,
        phone: phone || null,
        message: message || null,
        status: status || null,
        manager: manager || null,
        comment: comment || null,
        duplicateCandidate: isDuplicate,
        leadEventId: leadEventId ?? undefined,
        raw: row.raw as Record<string, unknown>,
        syncedAt: new Date(),
      });

      inserted++;
    }

    const msg = `Google Sheets sync: ${inserted} leads imported, ${duplicates} duplicates flagged, ${skipped} skipped, ${unrecognised.length} unrecognised rows`;
    await logSync(
      "google-leads",
      "success",
      msg,
      inserted,
      undefined,
      startedAt,
    );

    res.json({
      success: true,
      message: msg,
      stats: {
        rowsFound: rows.length,
        inserted,
        duplicates,
        skipped,
        unrecognisedRows: unrecognised,
        headers,
        columnMap: colMap,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Google Sheets sync failed");
    await logSync("google-leads", "error", message, 0, { message }, startedAt);
    res.status(500).json({ success: false, message, stats: null });
  }
});

// ─── GET /api/marketing/leads ─────────────────────────────────────────────────

marketingRouter.get("/marketing/leads", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  const status = req.query["status"] as string | undefined;
  const channel = req.query["channel"] as string | undefined;

  const rows = await db
    .select()
    .from(marketingLeadsTable)
    .orderBy(desc(marketingLeadsTable.syncedAt))
    .limit(limit);

  res.json(
    rows.map((r) => ({
      id: r.id,
      leadDate: r.leadDate,
      branchName: r.branchName,
      channel: r.channel,
      source: r.source,
      campaign: r.campaign,
      leadName: r.leadName,
      phone: r.phone ? r.phone.slice(0, 4) + "****" + r.phone.slice(-2) : null,
      status: r.status,
      manager: r.manager,
      duplicateCandidate: r.duplicateCandidate,
      syncedAt: r.syncedAt?.toISOString() ?? null,
    })),
  );
});

// ─── GET /api/marketing/lead-events ──────────────────────────────────────────

marketingRouter.get(
  "/marketing/lead-events",
  async (req, res): Promise<void> => {
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

    const rows = await db
      .select()
      .from(leadEventsTable)
      .orderBy(desc(leadEventsTable.createdAt))
      .limit(limit);

    res.json(
      rows.map((r) => ({
        id: r.id,
        sourceSystem: r.sourceSystem,
        eventTime: r.eventTime?.toISOString() ?? null,
        branchName: r.branchName,
        channel: r.channel,
        source: r.source,
        campaign: r.campaign,
        clientName: r.clientName,
        phone: r.phone
          ? r.phone.slice(0, 4) + "****" + r.phone.slice(-2)
          : null,
        status: r.status,
        manager: r.manager,
        matchedStudentCrmId: r.matchedStudentCrmId,
        duplicateCandidate: r.duplicateCandidate,
        createdAt: r.createdAt?.toISOString() ?? null,
      })),
    );
  },
);

// ─── GET /api/marketing/sources ──────────────────────────────────────────────

marketingRouter.get("/marketing/sources", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(marketingSourcesTable)
    .orderBy(marketingSourcesTable.rawSource);
  res.json(rows);
});

// ─── GET /api/marketing/stats ─────────────────────────────────────────────────

marketingRouter.get("/marketing/stats", async (req, res): Promise<void> => {
  const [totalLeads, duplicates, matched, byChannel, byStatus, recentLeads] =
    await Promise.all([
      db
        .select({ count: count() })
        .from(leadEventsTable)
        .then((r) => Number(r[0]?.count ?? 0)),
      db
        .select({ count: count() })
        .from(leadEventsTable)
        .where(eq(leadEventsTable.duplicateCandidate, true))
        .then((r) => Number(r[0]?.count ?? 0)),
      db
        .select({ count: count() })
        .from(leadEventsTable)
        .where(sql`${leadEventsTable.matchedStudentCrmId} IS NOT NULL`)
        .then((r) => Number(r[0]?.count ?? 0)),
      db
        .execute(
          sql`
      SELECT channel, count(*)::int AS cnt
      FROM lead_events
      WHERE channel IS NOT NULL
      GROUP BY channel
      ORDER BY cnt DESC
      LIMIT 10
    `,
        )
        .then((r) => r.rows),
      db
        .execute(
          sql`
      SELECT status, count(*)::int AS cnt
      FROM lead_events
      WHERE status IS NOT NULL
      GROUP BY status
      ORDER BY cnt DESC
    `,
        )
        .then((r) => r.rows),
      db
        .select({
          id: leadEventsTable.id,
          eventTime: leadEventsTable.eventTime,
          channel: leadEventsTable.channel,
          source: leadEventsTable.source,
          clientName: leadEventsTable.clientName,
          phone: leadEventsTable.phone,
          status: leadEventsTable.status,
          manager: leadEventsTable.manager,
          branchName: leadEventsTable.branchName,
          duplicateCandidate: leadEventsTable.duplicateCandidate,
          matchedStudentCrmId: leadEventsTable.matchedStudentCrmId,
          createdAt: leadEventsTable.createdAt,
        })
        .from(leadEventsTable)
        .orderBy(desc(leadEventsTable.createdAt))
        .limit(20),
    ]);

  res.json({
    totalLeads,
    duplicates,
    matched,
    conversionRate:
      totalLeads > 0 ? Math.round((matched / totalLeads) * 100) : 0,
    byChannel,
    byStatus,
    recentLeads: recentLeads.map((l) => ({
      ...l,
      phone: l.phone
        ? String(l.phone).slice(0, 4) + "****" + String(l.phone).slice(-2)
        : null,
      eventTime: l.eventTime?.toISOString() ?? null,
      createdAt: l.createdAt?.toISOString() ?? null,
    })),
  });
});

// ─── POST /api/marketing/sources/normalize ────────────────────────────────────

marketingRouter.post(
  "/marketing/sources/normalize",
  async (req, res): Promise<void> => {
    const body = req.body as {
      rawSource?: string;
      canonicalSource?: string;
      canonicalChannel?: string;
    };
    if (!body.rawSource) {
      res
        .status(400)
        .json({ success: false, message: "rawSource is required" });
      return;
    }
    await db
      .insert(marketingSourcesTable)
      .values({
        rawSource: body.rawSource,
        canonicalSource: body.canonicalSource ?? null,
        canonicalChannel: body.canonicalChannel ?? null,
      })
      .onConflictDoUpdate({
        target: marketingSourcesTable.rawSource,
        set: {
          canonicalSource: body.canonicalSource ?? null,
          canonicalChannel: body.canonicalChannel ?? null,
        },
      });
    res.json({ success: true, message: "Source mapping saved" });
  },
);
