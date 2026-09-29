import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildPayCustomers, loadPayCustomers } from '../lib/pay-customers.ts';
import { makeEducationCondition, educationConditionKey } from '../lib/education-conditions.ts';
function fixture() {
  const meta = {localBranchId:'BR-SCHOOL',remoteBranchId:'8',alfaCustomerId:'123',customerLifecycle:'active'};
  const card = (id, entityType, displayName) => ({id,entityType,displayName,status:'Активна',dataQuality:'Импортировано из AlfaCRM',metadata:JSON.stringify(meta)});
  return {branchId:'BR-SCHOOL',query:'',merges:[],conditions:[],
    current:[{remoteBranchId:'8',recordId:'123'}],
    cards:[card('C','Ребёнок','Тестов Семён'),card('F','Семья','Семья Тест'),{...card('P','Клиент','Тестова Анна'),metadata:JSON.stringify({...meta,guardianName:'Тестова Анна',phone:'+70000000000',email:'parent@example.invalid'})}],
    links:[{fromId:'F',toId:'C',relation:'Семья → ребёнок'},{fromId:'F',toId:'P',relation:'Клиентская карточка семьи'}]};
}
function change(f,id,patch) {
  const c=f.cards.find(c=>c.id===id); c.metadata=JSON.stringify({...JSON.parse(c.metadata),...patch});
}
test('current branch family projects exact canonical IDs and confirmed contact, without changing input',()=>{
  const f=fixture(), before=JSON.stringify(f), rows=buildPayCustomers(f);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0],{familyId:'F',studentPersonId:'C',studentCrmId:'123',studentName:'Тестов Семён',payerPersonId:'P',payerName:'Тестова Анна',payerPhone:'+70000000000',payerEmail:'parent@example.invalid',remoteBranchId:'8',tuitionExempt:false});
  assert.equal(JSON.stringify(f),before);
});
test('query is case-insensitive, normalizes ё, treats wildcards literally and limits results',()=>{
  const f=fixture(); assert.equal(buildPayCustomers({...f,query:'  СЕМЕН тестов '}).length,1);
  assert.equal(buildPayCustomers({...f,query:'%'}).length,0);
  assert.equal(buildPayCustomers({...f,query:'not-found'}).length,0);
});
test('other branch, archive, missing source, invalid metadata, lead and completed never leak',()=>{
  for(const mutate of [f=>f.branchId='OTHER', f=>f.cards[0].status='Архив',f=>f.cards[1].status='Архив',
    f=>f.current=[],f=>f.cards[0].metadata='{',f=>change(f,'C',{localArchive:true}),
    f=>change(f,'C',{customerLifecycle:'lead'}),f=>change(f,'C',{customerLifecycle:'completed'}),
    f=>change(f,'C',{customerLifecycle:'unknown'}),f=>change(f,'F',{localBranchId:'OTHER'})]) {
    const f=fixture();mutate(f);assert.deepEqual(buildPayCustomers(f),[]);
  }
});
test('free tuition keeps an open child selectable, scoped to the exact child and branch',()=>{
  const f=fixture();change(f,'C',{customerLifecycle:'open'});assert.deepEqual(buildPayCustomers(f),[]);
  const condition=makeEducationCondition({childId:'C',remoteBranchId:'8',enabled:true,actor:'test-owner',now:'2026-09-29T00:00:00Z'});
  f.conditions=[{key:educationConditionKey('C','8'),value:JSON.stringify(condition)}];
  assert.equal(buildPayCustomers(f)[0].tuitionExempt,true);
  change(f,'C',{remoteBranchId:'9'});f.current=[{remoteBranchId:'9',recordId:'123'}];assert.deepEqual(buildPayCustomers(f),[]);
});
test('confirmed merge resolves canonical child, family and payer without borrowing other branch contacts',()=>{
  const f=fixture();
  for(const original of [...f.cards]) {
    f.cards.push({...original,id:original.id+'-ROOT',metadata:JSON.stringify({localBranchId:'OTHER'})});
    f.merges.push({survivorId:original.id+'-ROOT',duplicateId:original.id});
    original.status='Объединена';change(f,original.id,{identitySourceStatus:'Активна'});
  }
  const row=buildPayCustomers(f)[0];assert.equal(row.studentPersonId,'C-ROOT');assert.equal(row.familyId,'F-ROOT');
  assert.equal(row.payerPersonId,'P-ROOT');assert.equal(row.payerEmail,'parent@example.invalid');
});
test('ambiguous family or duplicate source identity is excluded, ambiguous payer is not guessed',()=>{
  const f=fixture();f.cards.push({...f.cards[1],id:'F2'});f.links.push({fromId:'F2',toId:'C',relation:'Семья → ребёнок'});
  assert.deepEqual(buildPayCustomers(f),[]);
  const p=fixture();p.cards.push({...p.cards[2],id:'P2'});p.links.push({fromId:'F',toId:'P2',relation:'Клиентская карточка семьи'});
  const row=buildPayCustomers(p)[0];assert.equal(row.payerPersonId,null);assert.equal(row.payerEmail,'');
  const d=fixture();d.cards.push({...d.cards[0],id:'C2',status:'Объединена'});
  change(d,'C2',{identitySourceStatus:'Активна'});d.merges.push({survivorId:'C',duplicateId:'C2'});d.links.push({fromId:'F',toId:'C2',relation:'Семья → ребёнок'});
  assert.deepEqual(buildPayCustomers(d),[]);
});
test('SQL loader executes read-only queries against the real SQLite schema',async()=>{
  const f=fixture(),sql=new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE organization_branches(id TEXT,status TEXT); INSERT INTO organization_branches VALUES('BR-SCHOOL','Активен');");
  sql.exec('CREATE TABLE entities(id TEXT,entity_type TEXT,display_name TEXT,status TEXT,metadata TEXT,data_quality TEXT); CREATE TABLE entity_links(from_entity_id TEXT,to_entity_id TEXT,relation_type TEXT); CREATE TABLE entity_merges(survivor_id TEXT,duplicate_id TEXT); CREATE TABLE alfacrm_current_records(module TEXT,remote_branch_id TEXT,record_id TEXT,active INTEGER); CREATE TABLE system_runtime_state(state_key TEXT,state_value TEXT);');
  for(const c of f.cards)sql.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?)').run(c.id,c.entityType,c.displayName,c.status,c.metadata,c.dataQuality);
  for(const l of f.links)sql.prepare('INSERT INTO entity_links VALUES(?,?,?)').run(l.fromId,l.toId,l.relation);
  sql.exec("INSERT INTO alfacrm_current_records VALUES('families','8','123',1); PRAGMA query_only=ON");
  const db={prepare(query){return{all:async()=>({results:sql.prepare(query).all()})};}};
  assert.deepEqual(await loadPayCustomers(db,'BR-SCHOOL','семен'),buildPayCustomers(f));
  assert.deepEqual(await loadPayCustomers(db,'ARCHIVED',''),[]);sql.close();
});

test('directory limit is applied after search and exact selected-ID resolution',()=>{
  const f=fixture();f.cards=[];f.links=[];f.current=[];
  for(let n=0;n<60;n++){
    const part=fixture(),suffix=String(n).padStart(2,'0');
    for(const c of part.cards){c.id+=suffix;c.displayName+=suffix;c.metadata=JSON.stringify({...JSON.parse(c.metadata),alfaCustomerId:String(1000+n)});f.cards.push(c);}
    for(const l of part.links)f.links.push({...l,fromId:l.fromId+suffix,toId:l.toId+suffix});
    f.current.push({remoteBranchId:'8',recordId:String(1000+n)});
  }
  assert.equal(buildPayCustomers(f).length,50);
  assert.equal(buildPayCustomers({...f,query:'1059'})[0].studentPersonId,'C59');
  assert.equal(buildPayCustomers({...f,studentPersonId:'C59'})[0].studentPersonId,'C59');
});

test('placeholder representative is not payer evidence even with a contact',()=>{
  const f=fixture();f.cards[2].displayName='Представитель семьи';f.cards[2].dataQuality='Требует сверки';
  const row=buildPayCustomers(f)[0];assert.equal(row.payerPersonId,null);assert.equal(row.payerName,'');
  assert.equal(row.payerPhone,'');assert.equal(row.payerEmail,'');
});
