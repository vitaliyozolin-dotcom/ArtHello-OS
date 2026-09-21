// Read-only AlfaCRM audit. Only aggregate, non-personal evidence reaches stdout.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function databases(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? databases(join(dir, entry.name)) : entry.name.endsWith('.sqlite') ? [join(dir, entry.name)] : []);
}

export function summarizeBranch(records, dictionary, branch) {
  const names = new Map(dictionary.map(row => [String(row.id), row.name]));
  if (names.size !== dictionary.length || [...names.values()].some(name => typeof name !== 'string')) throw Error('STATUS_DICTIONARY_INVALID');
  const result = { observed: records.length, members: 0, foreign: 0, unknownMembership: 0, statuses: {}, included: 0, unknownStatusIds: {}, groups: {} };
  for (const row of records) {
    if (!Array.isArray(row.branch_ids)) { result.unknownMembership++; continue; }
    if (!row.branch_ids.map(String).includes(String(branch))) { result.foreign++; continue; }
    result.members++;
    const name = names.get(String(row.study_status_id)) ?? 'UNKNOWN';
    // Only known policy labels are printed; upstream free text is never logged.
    const safe = ['Активен', 'Активен ШКОЛА', 'Открыто', 'Разовое посещение', 'Запись', 'Пробное занятие', 'Завершил'].includes(name) ? name : 'UNKNOWN';
    result.statuses[safe] = (result.statuses[safe] ?? 0) + 1;
    if(safe==='UNKNOWN'){const id=/^[0-9]+$/.test(String(row.study_status_id))?String(row.study_status_id):'MISSING';result.unknownStatusIds[id]=(result.unknownStatusIds[id]??0)+1;}
    if (!['Активен', 'Активен ШКОЛА', 'Открыто', 'Разовое посещение', 'Запись'].includes(safe)) continue;
    result.included++;
    for (const value of Array.isArray(row.groups) ? row.groups : Array.isArray(row.group_ids) ? row.group_ids : []) {
      const id = value && typeof value === 'object' ? value.id : value;
      if (/^[1-9]\d*$/.test(String(id))) result.groups[String(id)] = (result.groups[String(id)] ?? 0) + 1;
    }
  }
  return result;
}

async function main() {
  const candidates = [];
  for (const path of databases('/data/d1')) {
    const db = new DatabaseSync(path, { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (['system_runtime_state', 'entities', 'organization_branches'].every(name => tables.has(name))) candidates.push(db);
    else db.close();
  }
  if (candidates.length !== 1) throw Error('DATABASE_SCOPE_UNCONFIRMED');
  const db = candidates[0];
  const stateRow = db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').get('alfacrm_connector:v1');
  const state = JSON.parse(stateRow?.state_value ?? 'null');
  if (!state?.connected || state.endpoint !== 'https://arthellonew.s20.online') throw Error('SOURCE_ACCOUNT_UNCONFIRMED');
  const envelopeRow = db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?')
    .get('integration_credential:v2:INT-T-ALFACRM:ARTHELLO:ALFACRM-V2');
  const envelope = JSON.parse(envelopeRow?.state_value ?? 'null');
  if (envelope?.version !== 1 || envelope.algorithm !== 'AES-GCM') throw Error('CREDENTIAL_UNAVAILABLE');
  const keyFile = process.env.INTEGRATION_CREDENTIALS_KEY_FILE;
  if (!keyFile?.startsWith('/run/secrets/')) throw Error('CREDENTIAL_KEY_MOUNT_UNAVAILABLE');
  const configured = readFileSync(keyFile, 'utf8').trim();
  if (configured.length < 32) throw Error('CREDENTIAL_KEY_INVALID');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`arthello.integration-credential.key.v1\n${configured}`));
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt']);
  // Existing envelope AAD tag is shared by legacy non-TBank connectors.
  const aad = 'arthello.integration-credential.v2\nINT-T-ALFACRM\nARTHELLO\nALFACRM-V2\nTOCHKA_ACCOUNTS_READ_V1';
  const credentials = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64url'),additionalData:new TextEncoder().encode(aad),tagLength:128},key,Buffer.from(envelope.ciphertext,'base64url'))));
  let token = '';
  async function request(path, body) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const response = await fetch(`${state.endpoint}/v2api/${path}`, { method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),
      headers:{'content-type':'application/json',accept:'application/json',...(token?{'X-ALFACRM-TOKEN':token}:{}),...(credentials.appKey?{'X-APP-KEY':credentials.appKey}:{})},body:JSON.stringify(body) });
    if (!response.ok) throw Error(`UPSTREAM_HTTP_${response.status}`);
    return response.json();
  }
  const login = await request('auth/login', {email:credentials.email,api_key:credentials.apiKey});
  if (typeof login.token !== 'string' || login.token.length < 10) throw Error('SOURCE_AUTH_FAILED');
  token = login.token;
  async function paged(path, filters = {}) {
    const rows = [], seen = new Set(); let expected;
    for (let page=0;page<120;page++) {
      const payload = await request(path,{...filters,page,pageSize:500});
      if (!Array.isArray(payload.items) || !Number.isSafeInteger(Number(payload.total)) || Number(payload.total)<0) throw Error('PAGE_SHAPE_UNCONFIRMED');
      const total=Number(payload.total);
      if (expected !== undefined && expected!==total) throw Error('SOURCE_CHANGED_DURING_READ');
      expected=total;
      for(const row of payload.items){const id=String(row.id);if(!/^[1-9]\d*$/.test(id)||seen.has(id))throw Error('REPEATED_OR_INVALID_SOURCE_ID');seen.add(id);rows.push(row);}
      if(rows.length===expected)return rows;
      if(!payload.items.length||rows.length>expected)throw Error('INCOMPLETE_PAGE');
    }
    throw Error('PAGE_LIMIT');
  }
  const branches = await paged('branch/index',{is_active:1});
  const report={observedAt:new Date().toISOString(),sourceBranches:[],osFamilies:[],uniqueIncludedCustomerIds:0};
  const unique = new Set();
  for(const branch of branches){
    const id=String(branch.id);
    const dictionary=await paged(`${id}/study-status/index`);
    const records=await paged(`${id}/customer/index`,{is_study:1,removed:0,withGroups:true});
    const groups=await paged(`${id}/group/index`,{removed:0});
    const teachers=await paged(`${id}/teacher/index`,{removed:0});
    const summary=summarizeBranch(records,dictionary,id);
    const names=new Map(dictionary.map(row=>[String(row.id),row.name]));
    for(const row of records)if(Array.isArray(row.branch_ids)&&row.branch_ids.map(String).includes(id)&&['Активен','Активен ШКОЛА','Открыто','Разовое посещение','Запись'].includes(names.get(String(row.study_status_id))))unique.add(String(row.id));
    const safeTitle = value => String(value??'').replace(/\d{5,}/g,'*').replace(/[a-zа-яё]+/gi,word=>['класс','кл','атлас','школа','лет','мини','сад','садик','группа','нулевой','первый','второй','третий','четвертый','подготовка','школе','к','младшая','старшая','средняя','подготовительная'].includes(word.toLowerCase())?word:'*');
    report.sourceBranches.push({id,localBranch:state.branchMappings[id]??null,...summary,customerFields:records[0]?Object.keys(records[0]).sort():[],teacherCount:teachers.length,teachersInBranch:teachers.filter(t=>Array.isArray(t.branch_ids)&&t.branch_ids.map(String).includes(id)).length,groups:groups.map(group=>({id:String(group.id),safeTitle:safeTitle(group.name),grade:String(group.name??'').match(/(?:^|[^0-9])(1[01]|[0-9])[\s_.-]*(?:класс|кл\b)/i)?.[1]??null,year:String(group.name??'').match(/202[0-9].{0,3}202[0-9]/)?.[0]??null,customers:summary.groups[String(group.id)]??0}))});
  }
  report.uniqueIncludedCustomerIds=unique.size;
  report.osFamilies=db.prepare("SELECT scope,status,COUNT(*) AS count FROM entities WHERE entity_type='Семья' GROUP BY scope,status").all();
  db.close();
  console.log('ALFA_SOURCE_AUDIT='+JSON.stringify(report));
}

if(process.argv[1]==='-') main().catch(error=>{const code=/^[A-Z_0-9]+$/.test(error?.message??'')?error.message:'UNCONFIRMED';console.error(`ALFA_SOURCE_AUDIT_FAILED=${code}; no data changed`);process.exitCode=1;});
