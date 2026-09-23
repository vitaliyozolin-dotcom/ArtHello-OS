import test from 'node:test';
import assert from 'node:assert/strict';
import * as alfa from '../lib/alfacrm-import.ts';

test('foreign branch, archived customers and leads are excluded; true multi-branch membership survives',()=>{
 const rows=[{remoteBranchId:'1',item:{id:7,branch_ids:[2],is_study:1}},
 {remoteBranchId:'2',item:{id:7,branch_ids:[2],is_study:1}},
 {remoteBranchId:'2',item:{id:8,branch_ids:[2],is_study:0}},
 {remoteBranchId:'2',item:{id:9,branch_ids:[2],is_study:1,removed:1}},
 {remoteBranchId:'1',item:{id:10,branch_ids:[1,2],is_study:1}},
 {remoteBranchId:'2',item:{id:10,branch_ids:[1,2],is_study:1}}];
 const result=alfa.scopedAlfaRows('families',rows);
 assert.deepEqual(result.map(r=>[r.remoteBranchId,r.item.id]),[['2',7],['1',10],['2',10]]);
 const audit=alfa.auditAlfaBranchRows('families',rows);
 assert.equal(audit.uniqueCustomers,2);assert.equal(audit.foreignBranch,1);assert.equal(audit.inactive,2);
});
test('unknown or malformed membership stops the snapshot instead of assuming the request branch',()=>{
 for(const item of [{id:1,is_study:1},{id:1,is_study:1,branch_ids:'1'}, {id:1,is_study:1,branch_ids:[null]}, {id:1,branch_ids:[1],is_study:null}]){
 assert.throws(()=>alfa.scopedAlfaRows('families',[{remoteBranchId:'1',item}]));
 }
 assert.deepEqual(alfa.scopedAlfaRows('families',[{remoteBranchId:'1',item:{id:1,branch_ids:[],is_study:1}}]),[]);
});
test('teachers and groups need source branch membership and current lifecycle',()=>{
 const rows=[{remoteBranchId:'1',item:{id:1,branch_ids:[2]}},{remoteBranchId:'1',item:{id:2,branch_ids:[1],e_date:'01.01.2020'}},{remoteBranchId:'1',item:{id:3,branch_ids:['1']}}];
 for(const moduleKey of ['staff','groups'])assert.deepEqual(alfa.scopedAlfaRows(moduleKey,rows).map(r=>r.item.id),[3]);
});
test('legacy raw audit reports unknown evidence without inventing a count of active families',()=>{
 const result=alfa.auditAlfaBranchRows('families',[{remoteBranchId:'1',item:{id:1}}]);
 assert.equal(result.unknown,1);assert.equal(result.complete,false);
});

test('current family list excludes archives and archive copies do not flag active identities as duplicates',async()=>{
 const {listEntities}=await import('../lib/entity-list.ts');
 const row={id:'F-1',entityType:'Семья',displayName:'One',status:'Активна',sourceSystem:'ALFACRM',sourceRecordId:'student:1:1',dataQuality:'Проверено',scope:'School',metadata:'{}'};
 const options={type:'Семья',q:'',quality:'',review:'',mode:'source_only',offset:0,limit:100};
 const rows=[row,{...row,id:'F-2',sourceRecordId:'student:2:1',status:'Архив'}];
 const current=listEntities(rows,options);
 assert.equal(current.total,1);assert.equal(current.entities[0].dataQuality,'Проверено');
 assert.equal(listEntities(rows,{...options,status:'archive'}).entities[0].id,'F-2');
 assert.equal(listEntities(rows,{...options,status:'all'}).total,2);
 const merged={...row,metadata:JSON.stringify({branchAssignments:[{scope:'School',active:true},{scope:'Atlas',active:true}]})};
 assert.equal(listEntities([merged],{...options,branch:'Atlas'}).total,1);
 assert.equal(listEntities([merged],{...options,branch:'Other'}).total,0);
 assert.equal(listEntities([row],{...options,branch:'School'}).total,1);
});
