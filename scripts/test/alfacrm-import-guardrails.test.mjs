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

test("array relationship ids are normalized and an interrupted sandbox batch can resume", () => {
  assert.match(
    importer,
    /firstString\(item\["group_id"\] \?\? item\["group_ids"\]\)/,
  );
  assert.match(
    importer,
    /firstString\(item\["teacher_id"\] \?\? item\["teacher_ids"\]\)/,
  );
  assert.match(importer, /const teacherIds = Array\.isArray\(item\["teacher_ids"\]\)/);
  assert.match(importer, /ALFACRM_RESUME_RUNNING_BATCH === "1"/);
  assert.match(importer, /status IN \('running', 'partial'\)/);
  assert.match(
    importer,
    /SET status = 'running', finished_at = NULL/,
  );
  assert.match(importer, /async function importEntityOrResume/);
  assert.match(importer, /previousObservations/);
  assert.match(importer, /pages_fetched = \$3,\s*records_fetched = \$4/);
  assert.match(
    importer,
    /status = 'completed'[\s\S]*?return \{[\s\S]*?resumed: true/,
  );
});

test("provider errors are not copied verbatim into the report", () => {
  assert.match(importer, /safeAlfaErrorCode\(error\)/);
  assert.match(
    importer,
    /ALFACRM_REQUEST_TIMEOUT_MS"[\s\S]*?30_000,[\s\S]*?5_000,[\s\S]*?60_000/,
  );
  assert.match(
    importer,
    /ALFACRM_MAX_RETRY_ATTEMPTS"[\s\S]*?2,[\s\S]*?0,[\s\S]*?4/,
  );
  assert.match(importer, /isRetryableAlfaReadError/);
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
  assert.match(importer, /const tariffPrefetchConcurrency = 16/);
  assert.match(importer, /const tariffPrefetchWindowSize = 64/);
  assert.match(importer, /const tariffPageSize = 500/);
  assert.match(importer, /async function prefetchFirstPages/);
  assert.match(importer, /entity_type = 'customer_tariffs'/);
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
  assert.match(
    importer,
    /endpoint:\s*`\$\{branch\.crm_id\}\/log\/index`/,
  );
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
  assert.match(importer, /const defaultPageSize = 50/);
  assert.match(importer, /const paginationPrefetchConcurrency = 16/);
  assert.match(importer, /async function prefetchPages/);
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
    importer.indexOf("for (const [index] of window.entries())"),
    importer.indexOf("const groups = await database.query"),
  );
  const membershipLoop = importer.slice(
    importer.indexOf("for (const [index] of groups.rows.entries())"),
    importer.indexOf("const changeLogOptions"),
  );
  assert.doesNotMatch(tariffLoop, /\bbreak\b/);
  assert.doesNotMatch(membershipLoop, /\bbreak\b/);
  assert.match(tariffLoop, /recordImportError/);
  assert.match(membershipLoop, /recordImportError/);
});

test("independent resume pages overlap network waits without parallel database writes", () => {
  const prefetch = importer.slice(
    importer.indexOf("async function prefetchResumePages"),
    importer.indexOf("export interface NormalizationContext"),
  );
  assert.match(prefetch, /status !== "completed"/);
  assert.match(prefetch, /pages_fetched/);
  assert.match(prefetch, /return prefetchFirstPages/);
  assert.match(importer, /const membershipClient = await prefetchResumePages/);
  assert.match(importer, /const changeLogClient = await prefetchResumePages/);
  assert.doesNotMatch(prefetch, /database\.exec\("BEGIN"\)/);
});

test("family candidates preserve both branch-scoped student identities", () => {
  assert.match(importer, /left_student_branch_crm_id/);
  assert.match(importer, /right_student_branch_crm_id/);
  assert.match(
    importer,
    /ON CONFLICT \(\s*left_student_branch_crm_id,\s*left_student_crm_id,\s*right_student_branch_crm_id,\s*right_student_crm_id,\s*candidate_type\s*\)/,
  );
  assert.match(importer, /requiresManualConfirmation:\s*true/);
});
