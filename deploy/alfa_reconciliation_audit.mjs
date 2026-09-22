import { pathToFileURL } from 'node:url';
import { AtlasOwnerAccessHttpClient } from './activate-atlas-owner-access.mjs';

const ORIGIN = 'https://arthello-188-225-38-55.sslip.io';
const PATH = '/api/integrations/alfacrm';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const pairs = value => Object.entries(value ?? {}).filter(([key, item]) => /^[1-9]\d*$/.test(key) && typeof item === 'string' && /^BR-[A-Z0-9-]+$/.test(item));
const safeFailure = error => /^HTTP_\d{3}$|^[A-Z_0-9]{3,60}$/.test(error?.message ?? '') ? error.message : 'UNCONFIRMED';

// Exact application-owned messages only. Never expose upstream bodies or names.
export function classifyAlfaApiFailure(status, payload) {
  const message = typeof payload?.error === 'string' ? payload.error : '';
  const reasons = new Map([
    ['AlfaCRM не вернула корректный список записей. Изменения не применены.','ALFA_INVALID_LIST'],
    ['AlfaCRM вернула некорректное количество записей.','ALFA_INVALID_TOTAL'],
    ['Серверный канал AlfaCRM не настроен. Подключение не изменено.','ALFA_TRANSPORT_NOT_CONFIGURED'],
    ['AlfaCRM перенаправила запрос. Проверьте адрес аккаунта; данные доступа на другой адрес не отправлялись.','ALFA_REDIRECT'],
    ['AlfaCRM повторила страницу. Полнота загрузки не подтверждена; изменения не применены.','ALFA_REPEATED_PAGE'],
    ['AlfaCRM повторила ID на страницах. Полнота загрузки не подтверждена; повторите чтение.','ALFA_REPEATED_ID'],
    ['Список AlfaCRM изменился во время чтения. Повторите предпросмотр.','ALFA_TOTAL_CHANGED'],
    ['Количество записей AlfaCRM не совпало с итогом. Повторите чтение.','ALFA_TOTAL_MISMATCH'],
    ['AlfaCRM вернула неполный список. Изменения не применены.','ALFA_INCOMPLETE_PAGE'],
    ['Достигнут предел страниц AlfaCRM. Полнота загрузки не подтверждена; сузьте выборку.','ALFA_PAGE_LIMIT'],
    ['AlfaCRM вернула слишком большой ответ. Сузьте период или набор данных.','ALFA_RESPONSE_TOO_LARGE'],
    ['AlfaCRM вернула некорректный ответ.','ALFA_INVALID_JSON'],
    ['Сессия AlfaCRM истекла во время чтения. Повторите действие — ключ в ArtHello OS сохранён.','ALFA_SESSION_EXPIRED'],
    ['AlfaCRM отклонила e-mail или ключ API. Проверьте доступ v2api в карточке пользователя.','ALFA_AUTH_REJECTED'],
    ['Сервер ArtHello не смог установить защищённое соединение с AlfaCRM. Подключение не изменено; требуется восстановить связь на сервере.','ALFA_TRANSPORT_UNAVAILABLE'],
    ['Сервер ArtHello не дождался ответа AlfaCRM. Подключение не изменено; повторите после восстановления связи.','ALFA_TRANSPORT_TIMEOUT'],
  ]);
  if(reasons.has(message)) return reasons.get(message);
  const upstream = /^AlfaCRM (?:не выполнила чтение данных|не подтвердила авторизацию) \(([1-5]\d{2})\)\.$/.exec(message);
  return upstream ? `ALFA_UPSTREAM_HTTP_${upstream[1]}` : `HTTP_${status}`;
}

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
      ['staffPreview',{action:'previewModule',module:'staff'},v=>({count:count(v.count)})],
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
    if (response.status >= 400) {
      let payload = null;
      try { const body = await response.text(); if(body.length <= 16_384) payload=JSON.parse(body); } catch {}
      throw Error(classifyAlfaApiFailure(response.status,payload));
    }
    return response;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  audit(new AuditClient(process.env.ARTHELLO_OWNER_LOGIN??'',process.env.ARTHELLO_OWNER_PASSWORD??''))
    .then(result=>console.log('ALFA_OS_AUDIT='+JSON.stringify(result)))
    .catch(error=>{console.error('ALFA_OS_AUDIT_BLOCKED='+safeFailure(error));process.exitCode=2;});
}
