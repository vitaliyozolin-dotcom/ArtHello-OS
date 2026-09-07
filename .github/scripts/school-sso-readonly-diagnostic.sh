#!/usr/bin/env bash
# Run on the existing School Docker host through the protected production-ru
# transport. No restart, config change, session injection or login attempt.
set -Eeuo pipefail

classify_callback_logs() {
  python3 -c '
import json,re,sys
categories = [
 ("transaction_expired", "Сеанс входа истёк"),
 ("transaction_invalid", "Сеанс входа повреждён"),
 ("transaction_state_invalid", "ArtHello OS вернула недействительный сеанс входа"),
 ("exchange_origin_rejected", "Источник запроса не разрешён"),
 ("exchange_unavailable", "Обмен кода временно недоступен"),
 ("exchange_code_invalid", "Одноразовый код входа недействителен"),
 ("exchange_code_expired", "Одноразовый код входа истёк или уже использован"),
 ("exchange_access_revoked", "Доступ к электронному дневнику не выдан"),
 ("exchange_access_changed", "Права доступа изменились"),
 ("exchange_throttled", "Слишком много попыток входа"),
 ("contact_invalid", "Введите корректный"),
 ("identity_family_conflict", "Этот контакт уже принадлежит семье или ученику"),
 ("identity_staff_conflict", "Контакт уже связан с другим сотрудником"),
 ("identity_version_stale", "Получена устаревшая версия доступа"),
 ("identity_invalid", "ArtHello OS передала неполную учётную запись"),
 ("identity_access_unconfirmed", "ArtHello OS не подтвердила доступ к дневнику"),
 ("secret_missing", "Защитный ключ passwordless-входа не настроен"),
 ("sqlite_unique", "UNIQUE constraint failed"),
 ("sqlite_missing_column", "no such column"),
 ("sqlite_missing_table", "no such table"),
 ("sqlite_readonly", "readonly database"),
 ("sqlite_locked", "database is locked"),
 ("sqlite_foreign_key", "FOREIGN KEY constraint failed"),
 ("fetch_failed", "fetch failed"),
 ("fetch_timeout", "aborted due to timeout"),
]
counts={}
last={}
for line in sys.stdin:
 if "school_sso.callback_failed" not in line: continue
 category=next((name for name,needle in categories if needle in line),"other_callback_error")
 counts[category]=counts.get(category,0)+1
 stamp=re.match(r"^(\d{4}-\d\d-\d\dT[0-9:.]+Z) ",line)
 if stamp: last[category]=stamp.group(1)
print(json.dumps({"callbackErrorCounts":counts,"lastSeenUtc":last},sort_keys=True))
'
}

if [[ "${1:-}" == --self-test ]]; then
  report="$(printf '%s\n' \
    '2026-09-07T10:00:00Z school_sso.callback_failed fetch failed secret=DO_NOT_PRINT' \
    '2026-09-07T10:00:01Z school_sso.callback_failed UNIQUE constraint failed: users.email user=PRIVATE' \
    '2026-09-07T10:00:02Z school_sso.callback_failed arbitrary sensitive user@example.invalid' \
    'unrelated request token=DO_NOT_PRINT' | classify_callback_logs)"
  REPORT="$report" python3 -c '
import json,os
r=json.loads(os.environ["REPORT"])
assert r["callbackErrorCounts"] == {"fetch_failed":1,"sqlite_unique":1,"other_callback_error":1}
assert "DO_NOT_PRINT" not in os.environ["REPORT"]
assert "PRIVATE" not in os.environ["REPORT"]
assert "example.invalid" not in os.environ["REPORT"]
assert r["lastSeenUtc"]["fetch_failed"] == "2026-09-07T10:00:00Z"
print("SCHOOL_SSO_DIAGNOSTIC_LOG_REDACTION=PASS")
'
  exit 0
fi

production=school-1-11
test "$(docker inspect "$production" --format '{{.State.Running}}')" = true
test "$(docker inspect "$production" --format '{{index .Config.Labels "school.system"}}')" = school-1-11
test "$(docker inspect "$production" --format '{{index .Config.Labels "school.environment"}}')" = production
printf 'SCHOOL_SSO_DIAGNOSTIC_BEGIN\n'
docker inspect "$production" --format \
  '{"imageId":{{json .Image}},"release":{{json (index .Config.Labels "school.candidate-sha")}},"startedAt":{{json .State.StartedAt}},"health":{{json .State.Health.Status}},"networkMode":{{json .HostConfig.NetworkMode}},"readOnlyRootfs":{{json .HostConfig.ReadonlyRootfs}}}'

# Raw log lines never go to stdout; only fixed categories and UTC timestamps.
docker logs --since 2h --tail 2000 --timestamps "$production" 2>&1 | classify_callback_logs

docker exec -i "$production" node --input-type=module - <<'NODE'
import { DatabaseSync } from 'node:sqlite';
import { lookup } from 'node:dns/promises';

const schoolOrigin = 'https://school-188-225-38-55.sslip.io';
const centralOrigin = 'https://arthello-188-225-38-55.sslip.io';
const originMatches = (input, expected) => {
  try { return new URL(input).origin === expected && input.replace(/\/$/, '') === expected; }
  catch { return false; }
};
console.log(JSON.stringify({
  origins: {
    schoolMatches: originMatches(process.env.PUBLIC_APP_ORIGIN || schoolOrigin, schoolOrigin),
    arthelloMatches: originMatches(process.env.ARTHELLO_PUBLIC_ORIGIN || centralOrigin, centralOrigin),
  },
  runtime: { node:process.version, centralSecretConfigured: (process.env.CENTRAL_ACCESS_SECRET?.trim().length || 0) >= 32,
    passwordlessPepperConfigured: Boolean(process.env.PASSWORDLESS_PEPPER?.trim()) },
}));

// Report fixed error codes only. fetch causes can contain request details.
const errorCodes = new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT']);
const classify = error => {
  for(const value of [error?.code,error?.cause?.code]) if(errorCodes.has(value)) return value;
  return error?.name === 'TimeoutError' ? 'TIMEOUT' : 'OTHER';
};
try {
  const addresses=await lookup(new URL(centralOrigin).hostname,{all:true});
  console.log(JSON.stringify({arthelloDns:{ok:true,addressCount:addresses.length,expectedGatewayPresent:addresses.some(a=>a.address==='188.225.38.55')}}));
} catch(error) { console.log(JSON.stringify({arthelloDns:{ok:false,errorCode:classify(error)}})); }
try {
  const response=await fetch(`${centralOrigin}/api/health`,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(12000)});
  const payload=await response.json().catch(()=>({}));
  console.log(JSON.stringify({arthelloHttps:{httpStatus:response.status,healthy:payload.status==='ok',databaseAvailable:payload.database==='available'}}));
} catch(error) { console.log(JSON.stringify({arthelloHttps:{ok:false,errorCode:classify(error)}})); }

const databasePath=process.env.DATABASE_PATH;
if(databasePath!=='/data/school-1-11.sqlite') throw new Error('Unexpected database path; no database opened');
const db=new DatabaseSync(databasePath,{readOnly:true});
try {
  const required={users:['id','email','phone','display_name','role','status','auth_version','central_user_id','central_access_version'],auth_sessions:['id','user_id','token_hash','auth_version','expires_at'],audit_log:['id','actor_user_id','action','entity_type','entity_id','details']};
  const missing=[];
  for(const [table,columns] of Object.entries(required)) {
    const actual=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
    for(const column of columns) if(!actual.has(column)) missing.push(`${table}.${column}`);
  }
  const integrity=db.prepare('PRAGMA quick_check').get().quick_check;
  console.log(JSON.stringify({schema:{missing,quickCheckOk:integrity==='ok'}}));
  if(!missing.length) {
    const stats=db.prepare(`SELECT count(*) AS userCount,
      sum(CASE WHEN central_user_id IS NOT NULL THEN 1 ELSE 0 END) AS centrallyLinked,
      sum(CASE WHEN central_user_id IS NOT NULL AND central_access_version < 1 THEN 1 ELSE 0 END) AS invalidCentralVersions
      FROM users`).get();
    const audit=db.prepare("SELECT count(*) AS count, max(created_at) AS latestAt FROM audit_log WHERE action='auth.central_sso'").get();
    console.log(JSON.stringify({databaseStats:stats,successfulReconciliations:audit}));
  }
} finally { db.close(); }
NODE
printf 'SCHOOL_SSO_DIAGNOSTIC_END\n'
