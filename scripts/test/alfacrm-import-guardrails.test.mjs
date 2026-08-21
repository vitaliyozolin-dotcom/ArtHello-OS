import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const importer = await readFile(
  new URL("../src/import-alfacrm-sandbox.ts", import.meta.url),
  "utf8",
);

test("students and leads are fetched as separate AlfaCRM populations", () => {
  assert.match(
    importer,
    /body:\s*\{\s*is_study:\s*1,\s*removed:\s*1,\s*withGroups:\s*true\s*\}/,
  );
  assert.match(
    importer,
    /recordType:\s*"leads",\s*body:\s*\{\s*is_study:\s*0,\s*removed:\s*1\s*\}/,
  );
  assert.match(importer, /case\s+"leads":\s*return normalizeLead/);
  assert.doesNotMatch(importer, /case\s+"leads":\s*return normalizeStudent/);
});

test("groups and teachers include active and archived rows", () => {
  assert.match(
    importer,
    /recordType:\s*"groups",\s*body:\s*\{\s*removed:\s*1\s*\}/,
  );
  assert.match(
    importer,
    /recordType:\s*"teachers",\s*body:\s*\{\s*removed:\s*1\s*\}/,
  );
});

test("provider errors are not copied verbatim into the report", () => {
  assert.match(importer, /safeAlfaErrorCode\(error\)/);
  assert.doesNotMatch(
    importer,
    /error instanceof Error \? error\.message : String\(error\)/,
  );
});

test("the importer does not contain AlfaCRM write endpoints", () => {
  assert.doesNotMatch(
    importer,
    /\/(?:create|update|delete|teach|fiscal-sell)(?:\?|["'`])/,
  );
});

test("customer subscriptions are fetched per student and normalized", () => {
  assert.match(
    importer,
    /customer-tariff\/index\?customer_id=\$\{encodeURIComponent\(student\.crm_id\)\}/,
  );
  assert.match(importer, /recordType:\s*"customer_tariffs"/);
  assert.match(importer, /INSERT INTO crm_customer_tariffs/);
});

test("all payment dictionaries use their documented read endpoints", () => {
  for (const endpoint of [
    "pay-account/index",
    "pay-type/index",
    "pay-item/index",
    "pay-item-category/index",
  ]) {
    assert.match(importer, new RegExp(endpoint.replace("/", "\\/")));
  }
  for (const recordType of [
    "pay_accounts",
    "pay_types",
    "pay_items",
    "pay_item_categories",
  ]) {
    assert.match(importer, new RegExp(`recordType:\\s*"${recordType}"`));
  }
});

test("change log is stored raw and normalized with an incremental date_from", () => {
  assert.match(importer, /endpoint:\s*`\$\{branchId\}\/log\/index`/);
  assert.match(importer, /recordType:\s*"change_log"/);
  assert.match(importer, /\{\s*date_from:\s*incrementalWindow\.dateFrom\s*\}/);
  assert.match(importer, /INSERT INTO alpha_raw_records/);
  assert.match(importer, /INSERT INTO crm_change_log/);
});

test("reference records retain raw provenance and a normalized idempotent row", () => {
  assert.match(importer, /INSERT INTO crm_reference_records/);
  assert.match(
    importer,
    /ON CONFLICT \(branch_crm_id, reference_type, crm_id\) DO UPDATE/,
  );
  assert.match(importer, /raw_record_id/);
});

test("pagination follows documented page and pageSize parameters", () => {
  assert.match(importer, /page,\s*pageSize,/);
  assert.doesNotMatch(importer, /count:\s*pageSize/);
  assert.match(importer, /new AlfaReadError\("repeated_page"\)/);
  assert.match(importer, /new AlfaReadError\("pagination_guard"\)/);
});

test("downstream branch imports never revive stale branch scopes", () => {
  assert.match(
    importer,
    /SELECT crm_id\s+FROM crm_branches\s+WHERE record_state = 'current'\s+ORDER BY crm_id/,
  );
  assert.match(
    importer,
    /SELECT crm_id, name\s+FROM crm_branches\s+WHERE record_state = 'current'\s+ORDER BY crm_id/,
  );
});

test("raw lineage is append-only and observed separately per batch", () => {
  const rawWriter = importer.slice(
    importer.indexOf("async function saveRawRecord"),
    importer.indexOf("async function normalizeBranch"),
  );
  assert.match(rawWriter, /ON CONFLICT .*DO NOTHING/s);
  assert.match(rawWriter, /INSERT INTO alpha_raw_observations/);
  assert.doesNotMatch(
    rawWriter,
    /ON CONFLICT \(alpha_id, entity_type, branch_id, payload_hash\)[\s\S]*?DO UPDATE/,
  );
});

test("independent tariff and membership scopes continue after local errors", () => {
  const tariffLoop = importer.slice(
    importer.indexOf("for (const student of students.rows)"),
    importer.indexOf("const groups = await database.query"),
  );
  const membershipLoop = importer.slice(
    importer.indexOf("for (const group of groups.rows)"),
    importer.indexOf("const changeLogKey"),
  );
  assert.doesNotMatch(tariffLoop, /\bbreak\b/);
  assert.doesNotMatch(membershipLoop, /\bbreak\b/);
  assert.match(tariffLoop, /recordImportError/);
  assert.match(membershipLoop, /recordImportError/);
});
