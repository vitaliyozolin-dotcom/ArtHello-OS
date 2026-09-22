import { pathToFileURL } from 'node:url';
import { AtlasOwnerAccessHttpClient } from './activate-atlas-owner-access.mjs';

const ORIGIN = 'https://arthello-188-225-38-55.sslip.io';
const PATH = '/api/integrations/alfacrm';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const pairs = value => Object.entries(value ?? {}).filter(([key, item]) => /^[1-9]\d*$/.test(key) && typeof item === 'string' && /^BR-[A-Z0-9-]+$/.test(item));
const safeFailure = error => /^HTTP_\d{3}$|^[A-Z_]{3,60}$/.test(error?.message ?? '') ? error.message : 'UNCONFIRMED';

export function summarizePreview(value) {
  const p = value?.customerPreview;
  if (!p || !p.byBranch) throw Error('PREVIEW_INVALID');
  return {
    observedAt: p.observedAt,
    byBranch: Object.fromEntries(Object.entries(p.byBranch).filter(([id]) => /^[1-9]\d*$/.test(id)).map(([id, row]) => [id,
      Object.fromEntries(['observed','included','active','open','single','leads','excluded','review'].map(key => [key,count(row[key])]))])),
    ...Object.fromEntries(['includedAssignments','uniqueIncludedCustomerIds','excludedStatus','foreignBranch','unknown','duplicates','excludedLifecycle'].map(key => [key,count(p[key])])),
    intersectionCustomers: Array.isArray(p.intersections) ? p.intersections.length : null,
    intersectionBranches: Object.entries((p.intersections ?? []).reduce((all,row) => {
      if (Array.isArray(row.branches) && row.branches.every(id => /^[1-9]\d*$/.test(id))) {
        const key=[...row.branches].sort().join(','); all[key]=(all[key]??0)+1;
      }
      return all;
    }, {})).map(([branches,customers]) => ({branches:branches.split(','),customers})),
    schoolAssignments: Array.isArray(p.schoolAssignments) ? p.schoolAssignments.length : null,
    comparison: p.comparison ? Object.fromEntries(['archiveIds','preservedArchiveIds','reviewIds','updateIds','moves','newSourceKeys'].map(key => [key,Array.isArray(p.comparison[key]) ? p.comparison[key].length : null])) : null,
    readyForReconciliation: p.readyForReconciliation === true,
    applicationReady: false,
  };
}

export async function audit(client) {
  let authenticated=false;
  const result={observedAt:new Date().toISOString(),businessDataChanged:false,checks:{}};
  try {
    const login=await client.login(); authenticated=true;
    if (login?.userId !== 'USR-OWNER' || login?.isSystemOwner !== true || login?.mustChangePassword !== false) throw Error('CANONICAL_OWNER_REQUIRED');
    const current=await client.json('GET',ORIGIN,PATH);
    if (!current.canManageCredentials || !current.credentialStored || current.state?.endpoint !== 'https://arthellonew.s20.online') throw Error('SOURCE_ACCOUNT_UNCONFIRMED');
    result.connector={connected:current.state.connected===true,importEnabled:current.importEnabled===true,autosyncAvailable:current.autosyncAvailable===true,autosyncEnabled:current.state.autosync?.enabled===true,
      branchMappings:Object.fromEntries(pairs(current.state.branchMappings)), educationRouting:Object.fromEntries(Object.entries(current.state.educationRouting??{}).filter(([key,value])=>/^[1-9]\d*:[1-9]\d*$/.test(key)&&typeof value==='string'&&/^BR-[A-Z0-9-]+$/.test(value))),
      modules:Object.fromEntries(Object.entries(current.state.modules??{}).filter(([key])=>['families','staff','groups','lessons','subscriptions','finance'].includes(key)).map(([key,row])=>[key,{status:row.status,importedCount:count(row.importedCount)}]))};
    const checks=[
      ['customers',{action:'previewCustomers'},summarizePreview],
      ['legacy',{action:'previewLegacyMigration'},v=>({count:count(v.legacyMigration?.count),complete:v.legacyMigration?.complete===true})],
      ...['BR-ATLAS-SCHOOL','BR-SCHOOL'].map(branchId=>[branchId,{action:'readDiaryDirectoryOptions',branchId},v=>({branchId,classes:v.diaryOptions?.classes?.length??null,groups:v.diaryOptions?.groups?.length??null})]),
    ];
    for (const [name,body,summarize] of checks) {
      try { result.checks[name]={status:'verified',...summarize(await client.json('POST',ORIGIN,PATH,body))}; }
      catch(error) { result.checks[name]={status:'blocked',reason:safeFailure(error)}; }
    }
    return result;
  } finally {
    if (authenticated) await client.logoutAll();
  }
}

export class AuditClient extends AtlasOwnerAccessHttpClient {
  async request(urlInput,options={}) {
    const url=this.checkedUrl(urlInput),headers=new Headers(options.headers??{});
    const cookie=this.jar.header(url); if(cookie) headers.set('cookie',cookie);
    const response=await fetch(url,{...options,headers,redirect:'manual',signal:AbortSignal.timeout(300_000)});
    this.jar.absorb(url,response.headers);
    if (response.status >= 400) throw Error(`HTTP_${response.status}`);
    return response;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  audit(new AuditClient(process.env.ARTHELLO_OWNER_LOGIN??'',process.env.ARTHELLO_OWNER_PASSWORD??''))
    .then(result=>console.log('ALFA_OS_AUDIT='+JSON.stringify(result)))
    .catch(error=>{console.error('ALFA_OS_AUDIT_BLOCKED='+safeFailure(error));process.exitCode=2;});
}
