import { google, type sheets_v4 } from "googleapis";
import { logger } from "./logger.js";

let sheetsClient: sheets_v4.Sheets | null = null;

function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");

  let creds: Record<string, unknown>;
  try {
    creds = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return auth;
}

export function getSheetsClient(): sheets_v4.Sheets {
  if (!sheetsClient) {
    const auth = getAuthClient();
    sheetsClient = google.sheets({ version: "v4", auth });
  }
  return sheetsClient;
}

export interface SheetRow {
  rowNumber: number;
  values: string[];
  raw: Record<string, string>;
}

/**
 * Reads all rows from a sheet tab, returns them as objects keyed by header row.
 */
export async function readSheetRows(
  spreadsheetId: string,
  sheetName = "Sheet1",
  headerRow = 1,
): Promise<{ headers: string[]; rows: SheetRow[] }> {
  const sheets = getSheetsClient();
  logger.info({ spreadsheetId, sheetName }, "Reading Google Sheet");

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const allRows = (resp.data.values ?? []) as string[][];
  if (allRows.length < headerRow) {
    return { headers: [], rows: [] };
  }

  const headers = (allRows[headerRow - 1] ?? []).map((h) =>
    String(h ?? "").trim(),
  );

  const dataRows: SheetRow[] = [];
  for (let i = headerRow; i < allRows.length; i++) {
    const cells = allRows[i] ?? [];
    const raw: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (header) raw[header] = String(cells[j] ?? "").trim();
    }
    dataRows.push({
      rowNumber: i + 1,
      values: cells.map((c) => String(c ?? "").trim()),
      raw,
    });
  }

  logger.info(
    { spreadsheetId, sheetName, headerCount: headers.length, rowCount: dataRows.length },
    "Sheet read complete",
  );

  return { headers, rows: dataRows };
}

/**
 * Normalise a phone number to digits-only (keeps leading +).
 */
export function normalisePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  return cleaned;
}

/**
 * Try to parse various date formats to ISO date string.
 */
export function parseDate(raw: string): string | null {
  if (!raw) return null;
  // Try dd.mm.yyyy
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  // Try yyyy-mm-dd
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (ymd) return ymd[0] ?? null;
  // Try JS Date
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
