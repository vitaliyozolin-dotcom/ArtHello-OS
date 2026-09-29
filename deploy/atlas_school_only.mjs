import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ATLAS_SCHOOL_ONLY_KEY, parseAtlasSchoolOnly } from './v52/src/lib/atlas-school-source.ts';
import { identityProjectionStatements } from './v52/src/lib/entity-identity-db.ts';
import { buildIdentityIndex } from './v52/src/lib/entity-identity.ts';
import { reviewSignature } from './v52/src/lib/client-reconciliation.ts';

const requireValue = (value, code) => { if (!value) throw Error(code); };
const json = (text) => JSON.parse(text);
function historyDigest(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'alfacrm_%' OR name IN ('financial_operations','client_accruals','education_attendance','education_grades')) ORDER BY name").all()
    .map(r => r.name).filter(name => !['alfacrm_current_records','alfacrm_import_batches','alfacrm_family_merge_candidates'].includes(name));
  const hash = createHash('sha256'); let rows = 0;
  for (const table of tables) {
    requireValue(/^[a-z_]+$/.test(table),'HISTORY_TABLE');
    hash.update(table);
    for (const row of db.prepare('SELECT * FROM '+table+' ORDER BY rowid').iterate()) { hash.update(JSON.stringify(row)); rows++; }
  }
  return {sha256:hash.digest('hex'),rows,tables:tables.length};
}
function cards(db) {
  return db.prepare('SELECT id,entity_type AS entityType,display_name AS displayName,source_system AS sourceSystem,source_record_id AS sourceRecordId,scope,status,metadata,data_quality AS dataQuality,updated_at AS updatedAt FROM entities').all();
}
export async function applyAtlasSchoolOnly(db, {readOnly=false}={}) {
  const state = json(db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').get('alfacrm_connector:v1')?.state_value ?? 'null');
  requireValue(state?.endpoint === 'https://arthellonew.s20.online' && state.branchMappings?.['6']==='BR-KINDERGARTEN' && state.branchMappings?.['10']==='BR-ATLAS-SCHOOL','SOURCE_ACCOUNT');
  let rule = parseAtlasSchoolOnly(db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').get(ATLAS_SCHOOL_ONLY_KEY)?.state_value);
  if (readOnly) { requireValue(rule,'RULE_MISSING'); return verify(db,rule); }
  const before = historyDigest(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const original = cards(db);
    const merges = db.prepare('SELECT survivor_id AS survivorId,duplicate_id AS duplicateId FROM entity_merges').all();
    const index = buildIdentityIndex(original,merges);
    if (!rule) {
      const childPairs = new Map();
      for (const card of original.filter(c=>c.entityType==='Ребёнок'&&c.sourceSystem==='ALFACRM')) {
        const meta=json(card.metadata), branch=String(meta.remoteBranchId??''), id=String(meta.alfaCustomerId??'');
        if (!['6','10'].includes(branch)||!/^[1-9]\d*$/.test(id)) continue;
        const source=db.prepare("SELECT o.payload FROM alfacrm_current_records c JOIN alfacrm_raw_observations o ON o.id=c.observation_id WHERE c.module='families' AND c.remote_branch_id=? AND c.record_id=? AND c.active=1").get(branch,id);
        if (!source) continue;
        const payload=json(source.payload);
        if (!(payload.branch_ids??[]).map(String).includes('6') || !(payload.branch_ids??[]).map(String).includes('10')) continue;
        childPairs.set(id,[...(childPairs.get(id)??[]),card]);
      }
      const ids = [...childPairs].filter(([,pair])=>pair.length===2 && new Set(pair.map(c=>String(json(c.metadata).remoteBranchId))).size===2 && new Set(pair.map(c=>index.canonical(c.id))).size===1).map(([id])=>id).sort();
      requireValue(ids.length===32,'EXACT_32_CONFIRMED_IDS_REQUIRED');
      rule={version:1,endpoint:state.endpoint,customerIds:ids,acceptedAt:new Date().toISOString(),actor:'USR-OWNER',decision:'D264',historyBefore:before};
      parseAtlasSchoolOnly(JSON.stringify(rule));
      db.prepare('INSERT INTO system_runtime_state(state_key,state_value,updated_at) VALUES(?,?,?)').run(ATLAS_SCHOOL_ONLY_KEY,JSON.stringify(rule),rule.acceptedAt);
    }
    for (const id of rule.customerIds) {
      for (const kind of ['Семья','Ребёнок']) {
        const pair=original.filter(c=>c.entityType===kind&&c.sourceSystem==='ALFACRM'&&String(json(c.metadata).alfaCustomerId)===id&&['6','10'].includes(String(json(c.metadata).remoteBranchId)));
        requireValue(pair.length===2 && index.canonical(pair[0].id)===index.canonical(pair[1].id),'CONFIRMED_ALIAS_REQUIRED');
        requireValue(String(json(pair.find(c=>String(json(c.metadata).remoteBranchId)==='10').metadata).identitySourceStatus)==='Активна','SCHOOL_ASSIGNMENT_REQUIRED');
      }
      db.prepare("UPDATE entities SET status=CASE WHEN status='Объединена' THEN status ELSE 'Архив' END,metadata=json_set(metadata,'$.identitySourceScope',COALESCE(json_extract(metadata,'$.identitySourceScope'),scope),'$.identitySourceStatus','Архив'),updated_at=CURRENT_TIMESTAMP WHERE source_system='ALFACRM' AND json_extract(metadata,'$.alfaCustomerId')=? AND json_extract(metadata,'$.remoteBranchId')='6' AND entity_type IN ('Семья','Клиент','Ребёнок')").run(id);
      db.prepare("UPDATE alfacrm_current_records SET active=0 WHERE remote_branch_id='6' AND module='families' AND record_id=?").run(id);
    }
    state.autosync = state.autosync ? {...state.autosync,enabled:false,outcome:'paused'} : undefined;
    for(const module of Object.values(state.modules ?? {})) {module.previewToken='';module.previewSignature='';}
    db.prepare('UPDATE system_runtime_state SET state_value=?,updated_at=CURRENT_TIMESTAMP WHERE state_key=?').run(JSON.stringify(state),'alfacrm_connector:v1');
    const current=cards(db);
    const adapter={prepare(sql){return {bind(...args){return {run(){db.prepare(sql).run(...args);}};}};}};
    for (const stmt of identityProjectionStatements(adapter,current,merges,rule)) stmt.run();
    const roots = original.filter(c=>c.entityType==='Ребёнок'&&rule.customerIds.includes(String(json(c.metadata).alfaCustomerId))).map(c=>index.canonical(c.id));
    for(const root of new Set(roots)) db.prepare("UPDATE education_students SET status='Архив' WHERE child_entity_id=? AND group_id IN (SELECT id FROM education_groups WHERE unit_entity_id='BR-KINDERGARTEN')").run(root);
    // Extend the existing owner's identity/roster acceptance only for this expressly authorized fixed set.
    const reviewRow=db.prepare('SELECT state_value FROM system_runtime_state WHERE state_key=?').get('client_reconciliation:v1');
    if(reviewRow) {
      const receipt=json(reviewRow.state_value), all=cards(db);
      requireValue(receipt.version===1&&receipt.signatures&&receipt.actor,'REVIEW_RECEIPT');
      const links=db.prepare('SELECT from_entity_id AS fromEntityId,to_entity_id AS toEntityId,relation_type AS relationType FROM entity_links').all();
      for(const card of all.filter(c=>c.status==='Активна'&&c.sourceSystem==='ALFACRM'&&rule.customerIds.includes(String(json(c.metadata).alfaCustomerId))&&['Семья','Клиент','Ребёнок'].includes(c.entityType))) {
        receipt.signatures[card.id]=await reviewSignature(card,all,links);
      }
      receipt.at=rule.acceptedAt;
      db.prepare('UPDATE system_runtime_state SET state_value=?,updated_at=CURRENT_TIMESTAMP WHERE state_key=?').run(JSON.stringify(receipt),'client_reconciliation:v1');
    }
    const after=historyDigest(db);
    requireValue(JSON.stringify(before)===JSON.stringify(after),'HISTORY_CHANGED');
    const report=verify(db,rule);
    db.prepare("INSERT INTO audit_events(actor,action,entity_type,entity_id,payload) VALUES('USR-OWNER','integration.atlas_school_only_confirmed','integration','INT-T-ALFACRM',?)").run(JSON.stringify({decision:'D264',customerCount:32,history:after,ruleHash:createHash('sha256').update(JSON.stringify(rule.customerIds)).digest('hex'),financialVerification:false,accessChanged:false}));
    db.exec('COMMIT');
    return {...report,historyUnchanged:true,history:after};
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
function verify(db,rule) {
  const all=cards(db); let schoolOnly=0;
  const index=buildIdentityIndex(all,db.prepare('SELECT survivor_id AS survivorId,duplicate_id AS duplicateId FROM entity_merges').all());
  for(const id of rule.customerIds) {
    for(const kind of ['Семья','Ребёнок']) {
      const source=all.find(c=>c.entityType===kind&&String(json(c.metadata).remoteBranchId)==='10'&&String(json(c.metadata).alfaCustomerId)===id);
      requireValue(source,'SCHOOL_SOURCE_CARD');
      const root=all.find(c=>c.id===index.canonical(source.id)), meta=json(root.metadata);
      requireValue(root.status==='Активна'&&root.scope==='Атлас — школа'&&meta.currentSourceBranchId==='10','CURRENT_SCHOOL');
      const active=(meta.branchAssignments??[]).filter(a=>a.active);
      requireValue(active.length===1&&String(active[0].remoteBranchId)==='10','BRANCH_COUNT');
    }
    requireValue(!db.prepare("SELECT 1 FROM alfacrm_current_records WHERE remote_branch_id='6' AND module='families' AND record_id=? AND active=1").get(id),'KINDERGARTEN_SOURCE_ACTIVE');
    const child=all.find(c=>c.entityType==='Ребёнок'&&String(json(c.metadata).remoteBranchId)==='10'&&String(json(c.metadata).alfaCustomerId)===id);
    requireValue(!db.prepare("SELECT 1 FROM education_students s JOIN education_groups g ON g.id=s.group_id WHERE s.child_entity_id=? AND g.unit_entity_id='BR-KINDERGARTEN' AND s.status='Активен'").get(index.canonical(child.id)),'KINDERGARTEN_ENROLLMENT_ACTIVE');
    schoolOnly++;
  }
  return {decision:'D264',customerCount:rule.customerIds.length,schoolOnly,kindergartenCurrent:0,ruleHash:createHash('sha256').update(JSON.stringify(rule.customerIds)).digest('hex')};
}
function databasePaths(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?databasePaths(join(dir,e.name)):e.name.endsWith('.sqlite')?[join(dir,e.name)]:[]);}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.env.ATLAS_SCHOOL_ONLY_WRITER_STOPPED==='1','SOLE_WRITER_REQUIRED');
    const matches=databasePaths('/data/d1').filter(path=>{const db=new DatabaseSync(path,{readOnly:true});try{return ['entities','system_runtime_state','organization_branches'].every(t=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));}finally{db.close();}});
    requireValue(matches.length===1,'DATABASE_SCOPE');
    const db=new DatabaseSync(matches[0]);
    console.log('ATLAS_SCHOOL_ONLY_RESULT='+JSON.stringify(await applyAtlasSchoolOnly(db)));
    db.close();
  }catch(error){console.error('ATLAS_SCHOOL_ONLY_BLOCKED='+(/^[A-Z_0-9]+$/.test(error.message)?error.message:'UNCONFIRMED'));process.exitCode=2;}
}
