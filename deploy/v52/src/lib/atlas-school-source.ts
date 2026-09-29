/** D264: a fixed owner-approved roster, never a rule for future overlaps. */
export const ATLAS_SCHOOL_ONLY_KEY = 'alfacrm_atlas_school_only:v1';
export type AtlasSchoolOnly = { version: 1; endpoint: string; customerIds: string[]; acceptedAt: string; actor: string };
export function parseAtlasSchoolOnly(raw: string | undefined | null): AtlasSchoolOnly | null {
  if (raw == null) return null;
  const rule = JSON.parse(raw) as AtlasSchoolOnly;
  if (rule.version !== 1 || rule.endpoint !== 'https://arthellonew.s20.online'
    || !Array.isArray(rule.customerIds) || rule.customerIds.length !== 32
    || new Set(rule.customerIds).size !== 32 || rule.customerIds.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
    || !Number.isFinite(Date.parse(rule.acceptedAt)) || rule.actor !== 'USR-OWNER') throw Error('ATLAS_SCHOOL_ONLY_RULE_INVALID');
  return rule;
}
export async function readAtlasSchoolOnly(db: D1Database) {
  const row = await db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?')
    .bind(ATLAS_SCHOOL_ONLY_KEY).first<{ state_value: string }>();
  return parseAtlasSchoolOnly(row?.state_value);
}
export function sourceCustomerAllowed(rule: AtlasSchoolOnly | null, branch: string, customerId: string) {
  return !rule?.customerIds.includes(customerId) || branch === '10';
}
