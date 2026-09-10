import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../lib/integrations.ts", import.meta.url);
const marker = "TOCHKA_STATEMENT_ARRAY_RESPONSE";

const before = `function readTochkaStatement(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = (root.Data ?? root.data) as Record<string, unknown> | undefined;
  const statement = data?.Statement ?? data?.statement ?? root.Statement ?? root.statement;
  return statement && typeof statement === "object" && !Array.isArray(statement)
    ? statement as Record<string, unknown>
    : null;
}
`;

const after = `function readTochkaStatement(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const dataCandidate = root.Data ?? root.data;
  const data = dataCandidate && typeof dataCandidate === "object" && !Array.isArray(dataCandidate)
    ? dataCandidate as Record<string, unknown>
    : undefined;
  // ${marker}: Init Statement returns Data.Statement as one object, while the
  // documented Get Statement response uses StatementListModel, where
  // Data.Statement is an array of StatementModel objects. Accept both exact
  // provider shapes and reject primitive/empty/ambiguous payloads.
  const statement = data?.Statement ?? data?.statement ?? data?.Statements ?? data?.statements
    ?? root.Statement ?? root.statement ?? root.Statements ?? root.statements;
  if (Array.isArray(statement)) {
    const rows = statement.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    return rows.length === 1 ? rows[0] : null;
  }
  return statement && typeof statement === "object" && !Array.isArray(statement)
    ? statement as Record<string, unknown>
    : null;
}
`;

export function patchTochkaStatementArrayResponse(source) {
  if (source.includes(marker)) return source;
  if (!source.includes(before)) throw new Error("D-065 patch target missing: readTochkaStatement");
  return source.replace(before, after);
}

export async function applyTochkaStatementArrayResponse(path = targetUrl) {
  const source = await readFile(path, "utf8");
  const patched = patchTochkaStatementArrayResponse(source);
  if (patched !== source) await writeFile(path, patched, "utf8");
  return patched !== source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const changed = await applyTochkaStatementArrayResponse();
  console.log(changed ? "D-065 Tochka statement array response applied" : "D-065 statement array response already present");
}
