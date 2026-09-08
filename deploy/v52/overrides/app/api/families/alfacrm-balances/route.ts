import { env } from "cloudflare:workers";
import { ensureCoreTables } from "../../../../db";
import { canAccessApi } from "../../../../lib/access-policy";
import { getAuthenticatedRequestContext, isCanonicalOwnerContext } from "../../../../lib/production-auth";
import { assignedActiveBranchScope } from "../../../../lib/section-read-scope";

type FamilyRow = { scope: string; metadata: string };
type BalanceRow = {
  remote_branch_id: string; customer_id: string; local_branch_id: string;
  balance_minor: number; source_field: string; imported_at: string;
  payload_hash: string; observation_hash: string | null; observed_at: string | null;
  observation_id: string | null; latest_observation_id: string | null;
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

/** A family card does not grant financial access. This separate read model checks both sections. */
export async function GET(request: Request) {
  let context;
  try { context = await getAuthenticatedRequestContext(request); }
  catch { return json({ error: "Сервис авторизации временно недоступен" }, 503); }
  if (!context) return json({ error: "Требуется вход" }, 401);
  if (context.apiRole === "OWNER" && !isCanonicalOwnerContext(context)) return json({ error: "Нет доступа" }, 403);
  if (!canAccessApi(context.auth.user, "/api/families", "GET")
    || !canAccessApi(context.auth.user, "/api/finance", "GET")) {
    return json({ error: "Нет доступа к финансовым данным семьи" }, 403);
  }
  const familyId = new URL(request.url).searchParams.get("familyId")?.trim() ?? "";
  if (!familyId || familyId.length > 120) return json({ error: "Укажите семью" }, 400);
  try {
    await ensureCoreTables();
    const db = env.DB;
    const family = await db.prepare("SELECT scope,metadata FROM entities WHERE id=? AND entity_type='Семья'")
      .bind(familyId).first<FamilyRow>();
    if (!family) return json({ error: "Семья не найдена" }, 404);
    const owner = isCanonicalOwnerContext(context);
    const branchRows = await db.prepare("SELECT id,name,status FROM organization_branches ORDER BY sort_order,name")
      .all<{ id: string; name: string; status: string }>();
    const grants = owner ? [] : (await db.prepare("SELECT branch_id AS branchId FROM user_branch_access WHERE user_id=?")
      .bind(context.appUserId).all<{ branchId: string }>()).results;
    const scope = assignedActiveBranchScope(context.auth.user, branchRows.results, grants);
    let localFamilyBranch: unknown;
    try { localFamilyBranch = JSON.parse(family.metadata)?.localBranchId; } catch { /* Scope label is the legacy fallback. */ }
    // Imported identities use a stable branch ID. Do not fall back from an invalid ID to a label.
    if (!owner && !(localFamilyBranch === undefined
      ? scope.allowsBranch(family.scope) : scope.branchIds.has(String(localFamilyBranch)))) {
      return json({ error: "Семья не найдена" }, 404);
    }
    const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alfacrm_customer_balances'")
      .first<{ name: string }>();
    // The first selected import creates the projection; an absent import is never a zero balance.
    if (!table) return json({ familyId, balances: [] });
    const settings = await db.prepare("SELECT state_value FROM system_runtime_state WHERE state_key='alfacrm_connector:v1'")
      .first<{ state_value: string }>();
    const mappings: Record<string, unknown> = settings ? JSON.parse(settings.state_value)?.branchMappings ?? {} : {};
    const rows = await db.prepare(`SELECT b.remote_branch_id,b.customer_id,b.local_branch_id,
      b.balance_minor,b.source_field,b.imported_at,b.payload_hash,
      o.payload_hash AS observation_hash,o.observed_at,o.id AS observation_id,
      latest.observation_id AS latest_observation_id
      FROM alfacrm_customer_balances b
      LEFT JOIN alfacrm_projection_lineage l ON l.projection_table='alfacrm_customer_balances'
        AND l.projection_id=json_array(b.remote_branch_id,b.customer_id)
      LEFT JOIN alfacrm_raw_observations o ON o.id=l.observation_id AND o.batch_id=l.batch_id
        AND o.remote_branch_id=b.remote_branch_id AND o.module='subscriptions'
        AND o.record_id='customer-balance-v2:' || b.customer_id
      LEFT JOIN alfacrm_current_records latest ON latest.remote_branch_id=b.remote_branch_id
        AND latest.module='subscriptions' AND latest.record_id='customer-balance-v2:' || b.customer_id AND latest.active=1
      WHERE b.family_entity_id=?
        AND EXISTS(SELECT 1 FROM alfacrm_current_records c WHERE c.remote_branch_id=b.remote_branch_id
          AND c.module='families' AND c.record_id=b.customer_id AND c.active=1)
      ORDER BY b.local_branch_id,b.remote_branch_id,b.customer_id`)
      .bind(familyId).all<BalanceRow>();
    const names = new Map(branchRows.results.map((row: { id: string; name: string }) => [row.id, row.name]));
    const balances = rows.results.filter((row: BalanceRow) => mappings[row.remote_branch_id] === row.local_branch_id
      && (owner || scope.branchIds.has(row.local_branch_id)))
      .map((row: BalanceRow) => {
        const verified = row.source_field === "Customer.balance" && Number.isSafeInteger(row.balance_minor)
          && /^[a-f0-9]{64}$/.test(row.payload_hash) && row.payload_hash === row.observation_hash
          && typeof row.observed_at === "string" && Number.isFinite(Date.parse(row.observed_at));
        return {
          customerId: row.customer_id, remoteBranchId: row.remote_branch_id,
          branchName: names.get(row.local_branch_id) ?? "Филиал не подтверждён",
          balanceMinor: verified ? row.balance_minor : null,
          observedAt: verified ? row.observed_at : null,
          refreshUnconfirmed: verified && row.latest_observation_id !== row.observation_id,
          source: "AlfaCRM", currency: null, status: verified ? "available" : "unconfirmed",
        };
      });
    return json({ familyId, balances });
  } catch { return json({ error: "Не удалось загрузить остатки AlfaCRM" }, 503); }
}
