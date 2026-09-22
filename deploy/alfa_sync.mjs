import { pathToFileURL } from 'node:url';
import { AuditClient, summarizePreview } from './alfa_reconciliation_audit.mjs';

const ORIGIN = 'https://arthello-188-225-38-55.sslip.io';
const PATH = '/api/integrations/alfacrm';
const requireValue = (value, code) => { if (!value) throw Error(code); };
const mappings = {'2':'BR-LISTVENNAYA','6':'BR-KINDERGARTEN','8':'BR-SCHOOL','9':'BR-NEBO','10':'BR-ATLAS-SCHOOL'};

export function classMappings(branchId, options) {
  const count = branchId === 'BR-SCHOOL' ? 6 : branchId === 'BR-ATLAS-SCHOOL' ? 4 : 0;
  requireValue(count && options?.branchId === branchId && Array.isArray(options.groups) && Array.isArray(options.classes), 'CLASS_OPTIONS');
  const result = [];
  for (let grade = 1; grade <= count; grade++) {
    const groups = options.groups.filter(row => Number(/^(\d{1,2})(?:[-‑–][а-яa-z]+)?\s+класс(?:\s|$)/iu.exec(row.name)?.[1]) === grade);
    const existing = options.classes.filter(row => row.grade === grade);
    requireValue(groups.length === 1 && existing.length <= 1, 'CLASS_AMBIGUOUS');
    requireValue(branchId !== 'BR-SCHOOL' || existing.length === 1, 'SCHOOL_CLASS_BINDING');
    result.push({id:groups[0].id, name:existing[0]?.name ?? groups[0].name, grade,
      ...(existing[0] ? {localId:existing[0].id} : {})});
  }
  return result;
}

export async function synchronize(client, progress = () => {}) {
  let authenticated = false;
  const report = {modules:{}, diaries:{}, deferredCount:1};
  const call = body => client.json('POST', ORIGIN, PATH, body);
  try {
    const login = await client.login(); authenticated = true;
    requireValue(login?.userId === 'USR-OWNER' && login.isSystemOwner === true && login.mustChangePassword === false, 'CANONICAL_OWNER_REQUIRED');
    const current = await client.json('GET', ORIGIN, PATH);
    requireValue(current.canManageCredentials && current.credentialStored && current.importEnabled && current.state?.connected && current.state.endpoint === 'https://arthellonew.s20.online' && !current.state.autosync?.enabled, 'SOURCE_ACCOUNT_UNCONFIRMED');
    requireValue(JSON.stringify(Object.entries(current.state.branchMappings).sort()) === JSON.stringify(Object.entries(mappings).sort()) && !Object.keys(current.state.educationRouting ?? {}).length, 'BRANCH_MAPPING_DRIFT');
    const before = (await call({action:'previewCustomers'})).customerPreview;
    requireValue(before?.unknown === 1 && before.byBranch?.['2']?.review === 1 && before.duplicates === 0 && before.foreignBranch === 0 && before.includedAssignments > 0 && before.comparison?.reviewIds?.length === 1, 'SOURCE_REVIEW_DRIFT');
    requireValue((await call({action:'previewLegacyMigration'})).legacyMigration?.complete === true, 'LEGACY_NOT_VERIFIED');
    report.before = summarizePreview({customerPreview:before});
    for (const module of ['families','staff','groups']) {
      const params = {module, ...(module === 'families' ? {deferMissingStatusBranch:'2'} : {})};
      progress({stage:'module-preview', module});
      const preview = await call({action:'previewModule', ...params});
      requireValue(typeof preview.previewToken === 'string' && preview.count > 0, 'MODULE_PREVIEW');
      if (module === 'families') requireValue(preview.count === before.includedAssignments && preview.deferredCount === 1, 'FAMILY_PREVIEW_DRIFT');
      progress({stage:'module-import', module});
      const applied = await call({action:'importModule', ...params, previewToken:preview.previewToken});
      requireValue(applied.complete === true && applied.rejected === 0 && applied.accepted === preview.count && applied.state?.modules?.[module]?.status === 'imported', 'MODULE_IMPORT_UNCONFIRMED');
      if (module === 'families') requireValue(applied.deferredCount === 1, 'DEFERRED_RECORD_UNCONFIRMED');
      report.modules[module] = {accepted:applied.accepted, rejected:0, deferred:applied.deferredCount ?? 0};
      progress({stage:'module-complete', module, ...report.modules[module]});
    }
    const after = (await call({action:'previewCustomers'})).customerPreview;
    requireValue(after?.unknown === 1 && after.byBranch?.['2']?.review === 1 && after.duplicates === 0 && after.comparison && ['archiveIds','newSourceKeys','moves'].every(key => after.comparison[key]?.length === 0) && after.comparison.reviewIds.length === 1, 'RECONCILIATION_UNCONFIRMED');
    report.after = summarizePreview({customerPreview:after});
    for (const branchId of ['BR-SCHOOL','BR-ATLAS-SCHOOL']) {
      const options = (await call({action:'readDiaryDirectoryOptions',branchId})).diaryOptions;
      const classes = classMappings(branchId, options);
      const preview = (await call({action:'previewDiaryDirectory',branchId,classes,includeSchoolSchedule:branchId==='BR-SCHOOL'})).diaryDirectory;
      requireValue(preview?.applied === false && preview.students > 0 && preview.teachers > 0 && preview.classes === classes.length && preview.archived === 0 && preview.scheduleLessons === (branchId==='BR-SCHOOL'?184:0), 'DIARY_PREVIEW_UNCONFIRMED');
      const applied = (await call({action:'applyDiaryDirectory',branchId,token:preview.token})).diaryDirectory;
      requireValue(applied?.applied === true && ['students','families','classes','teachers','scheduleLessons','unassignedLessons'].every(key => applied[key] === preview[key]), 'DIARY_APPLY_UNCONFIRMED');
      // The same token must return the same receipt without creating duplicates.
      const repeated = (await call({action:'applyDiaryDirectory',branchId,token:preview.token})).diaryDirectory;
      requireValue(repeated?.applied === true && ['students','families','classes','teachers','scheduleLessons','unassignedLessons'].every(key => repeated[key] === applied[key]), 'DIARY_REPEAT_UNCONFIRMED');
      report.diaries[branchId] = Object.fromEntries(['students','families','classes','teachers','scheduleLessons','unassignedLessons','archived','applied'].map(key=>[key,applied[key]]));
      progress({stage:'diary-complete',branchId,...report.diaries[branchId]});
    }
    return {...report,status:'synchronized-except-deferred-record',autosyncEnabled:false};
  } finally { if (authenticated) await client.logoutAll(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  synchronize(new AuditClient(process.env.ARTHELLO_OWNER_LOGIN ?? '', process.env.ARTHELLO_OWNER_PASSWORD ?? ''),
    progress=>console.log('ALFA_SYNC_PROGRESS='+JSON.stringify(progress)))
    .then(report=>console.log('ALFA_SYNC_RESULT='+JSON.stringify(report)))
    .catch(error=>{console.error('ALFA_SYNC_BLOCKED='+(/^[A-Z_0-9]{3,70}$/.test(error?.message ?? '') ? error.message : 'UNCONFIRMED'));process.exitCode=2;});
}
