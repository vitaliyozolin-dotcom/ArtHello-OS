import { Router } from "express";
import { google } from "googleapis";
import { db } from "@workspace/db";
import {
  sourceConnectorsTable,
  rawEventsTable,
  leadEventsTable,
  normalizedEventsTable,
} from "@workspace/db";
import { eq, sql, count } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import crypto from "node:crypto";

export const integrationsRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHash(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var not set");
  const creds = JSON.parse(raw) as {
    client_email: string;
    private_key: string;
  };
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

// ─── GET /api/integrations/connectors ────────────────────────────────────────

integrationsRouter.get("/integrations/connectors", async (req, res): Promise<void> => {
  const connectors = await db.select().from(sourceConnectorsTable).orderBy(sourceConnectorsTable.createdAt);
  res.json(connectors);
});

// ─── GET /api/integrations/stats ─────────────────────────────────────────────

integrationsRouter.get("/integrations/stats", async (req, res): Promise<void> => {
  const [rawTotal] = await db.select({ count: count() }).from(rawEventsTable);
  const [leadsFromSheets] = await db
    .select({ count: count() })
    .from(rawEventsTable)
    .where(eq(rawEventsTable.sourceSystem, "google_sheets"));
  const [leadsFromWebhook] = await db
    .select({ count: count() })
    .from(rawEventsTable)
    .where(eq(rawEventsTable.sourceSystem, "website_webhook"));
  const [unprocessed] = await db
    .select({ count: count() })
    .from(rawEventsTable)
    .where(eq(rawEventsTable.processed, false));

  res.json({
    rawEventsTotal: Number(rawTotal?.count ?? 0),
    googleSheetsLeads: Number(leadsFromSheets?.count ?? 0),
    websiteWebhookLeads: Number(leadsFromWebhook?.count ?? 0),
    unprocessedEvents: Number(unprocessed?.count ?? 0),
  });
});

// ─── GET /api/integrations/google-sheets/status ───────────────────────────────

integrationsRouter.get("/integrations/google-sheets/status", async (req, res): Promise<void> => {
  const configured = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !!process.env.GOOGLE_SHEET_ID_PROMOTION;
  if (!configured) {
    res.json({ configured: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEET_ID_PROMOTION not set" });
    return;
  }
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetId = process.env.GOOGLE_SHEET_ID_PROMOTION!;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "spreadsheetId,properties.title,sheets.properties" });
    const sheetList = (meta.data.sheets ?? []).map((s) => ({
      title: s.properties?.title ?? "",
      index: s.properties?.index ?? 0,
      sheetId: s.properties?.sheetId ?? 0,
    }));
    res.json({ configured: true, spreadsheetTitle: meta.data.properties?.title, sheets: sheetList });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.json({ configured: false, error: message });
  }
});

// ─── GET /api/integrations/google-sheets/sheets ───────────────────────────────

integrationsRouter.get("/integrations/google-sheets/sheets", async (req, res): Promise<void> => {
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetId = process.env.GOOGLE_SHEET_ID_PROMOTION!;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties" });
    const sheetList = (meta.data.sheets ?? []).map((s) => ({
      title: s.properties?.title ?? "",
      index: s.properties?.index ?? 0,
    }));
    res.json(sheetList);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to list sheets");
    res.status(500).json({ error: message });
  }
});

// ─── GET /api/integrations/google-sheets/preview ─────────────────────────────
// ?sheetName=...&headerRow=0

integrationsRouter.get("/integrations/google-sheets/preview", async (req, res): Promise<void> => {
  const { sheetName, headerRow = "0" } = req.query as Record<string, string>;
  if (!sheetName) { res.status(400).json({ error: "sheetName required" }); return; }

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetId = process.env.GOOGLE_SHEET_ID_PROMOTION!;
    const headerIdx = parseInt(headerRow, 10) || 0;

    const range = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${sheetName}'!A1:Z${headerIdx + 21}`,
    });

    const rows = range.data.values ?? [];
    const headers: string[] = rows[headerIdx] ? rows[headerIdx].map(String) : [];
    const dataRows = rows.slice(headerIdx + 1, headerIdx + 21).map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = String(r[i] ?? ""); });
      return obj;
    });

    res.json({ headers, rows: dataRows, totalRowsInSheet: rows.length - headerIdx - 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Google Sheets preview failed");
    res.status(500).json({ error: message });
  }
});

// ─── POST /api/integrations/google-sheets/import ─────────────────────────────
// Body: { sheetName, headerRow, mapping, branchCrmId, branchName }

integrationsRouter.post("/integrations/google-sheets/import", async (req, res): Promise<void> => {
  const {
    sheetName,
    headerRow = 0,
    mapping,
    branchCrmId = "",
    branchName = "",
  } = req.body as {
    sheetName: string;
    headerRow?: number;
    mapping: Record<string, string>; // { date, clientName, phone, source, channel, campaign, status, manager, comment, branch }
    branchCrmId?: string;
    branchName?: string;
  };

  if (!sheetName || !mapping) { res.status(400).json({ error: "sheetName and mapping required" }); return; }

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetId = process.env.GOOGLE_SHEET_ID_PROMOTION!;

    const range = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${sheetName}'`,
    });

    const allRows = range.data.values ?? [];
    const hIdx = Number(headerRow) || 0;
    const headers: string[] = allRows[hIdx] ? allRows[hIdx].map(String) : [];
    const dataRows = allRows.slice(hIdx + 1);

    let imported = 0;
    let skipped = 0;

    // Save/update the connector config
    await db
      .update(sourceConnectorsTable)
      .set({
        status: "active",
        config: { sheetId, sheetName, headerRow: hIdx, mapping },
        lastSyncAt: new Date(),
      })
      .where(eq(sourceConnectorsTable.sourceType, "google_sheet"));

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const get = (field: keyof typeof mapping): string => {
        const col = mapping[field];
        if (!col) return "";
        const idx = headers.indexOf(col);
        return idx >= 0 ? String(row[idx] ?? "") : "";
      };

      const phone = get("phone").trim();
      const clientName = get("clientName").trim();
      if (!phone && !clientName) { skipped++; continue; }

      const rawPayload: Record<string, string> = {};
      headers.forEach((h, ci) => { rawPayload[h] = String(row[ci] ?? ""); });

      const hash = makeHash(`google_sheets__${sheetId}__${sheetName}__${i}__${JSON.stringify(rawPayload)}`);

      // Insert raw_event (skip duplicates)
      const [rawEvent] = await db
        .insert(rawEventsTable)
        .values({
          sourceSystem: "google_sheets",
          externalId: `${sheetName}__row_${hIdx + 1 + i}`,
          eventType: "lead",
          eventTime: get("date") ? new Date(get("date")) : null,
          raw: rawPayload,
          hash,
          processed: false,
        })
        .onConflictDoNothing()
        .returning();

      if (!rawEvent) { skipped++; continue; } // duplicate

      const eventDate = get("date") ? new Date(get("date")) : null;

      // Insert lead_event
      await db
        .insert(leadEventsTable)
        .values({
          sourceSystem: "google_sheets",
          externalId: rawEvent.id,
          eventTime: eventDate,
          branchName: get("branch") || branchName || null,
          branchCrmId: branchCrmId || null,
          channel: get("channel") || null,
          source: get("source") || null,
          campaign: get("campaign") || null,
          clientName: clientName || null,
          phone: phone || null,
          email: null,
          message: get("comment") || null,
          status: get("status") || null,
          manager: get("manager") || null,
          raw: rawPayload,
          rawEventId: rawEvent.id,
        })
        .onConflictDoNothing();

      // Mark raw_event processed
      await db.update(rawEventsTable).set({ processed: true }).where(eq(rawEventsTable.id, rawEvent.id));

      imported++;
    }

    req.log.info({ imported, skipped, sheetName }, "Google Sheets import complete");
    res.json({ success: true, imported, skipped, total: dataRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Google Sheets import failed");
    res.status(500).json({ error: message });
  }
});

// ─── PATCH /api/integrations/connectors/:id ───────────────────────────────────

integrationsRouter.patch("/integrations/connectors/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { config, status } = req.body as { config?: Record<string, unknown>; status?: string };

  const [updated] = await db
    .update(sourceConnectorsTable)
    .set({
      ...(config !== undefined ? { config } : {}),
      ...(status !== undefined ? { status } : {}),
    })
    .where(eq(sourceConnectorsTable.id, id))
    .returning();

  res.json(updated);
});
