import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const paySource = readFileSync(new URL('../lib/arthello-pay.ts', import.meta.url), 'utf8');
test('Pay customer search no longer discards the synchronized directory', async () => {
  const text = paySource.slice(paySource.indexOf('export async function searchPayCustomers('), paySource.indexOf('export async function listPayObligations('));
  const js = stripTypeScriptTypes(text).replace('export ', '');
  const expected = [{ familyId: 'F-TEST', studentPersonId: 'C-TEST', studentName: 'Тестовый ученик' }];
  const calls = [];
  const search = new Function('assertBranchAccess', 'routeFor', 'loadPayCustomers', 'database', js + '; return searchPayCustomers;')(
    async (_, branch) => calls.push(branch), () => ({}), async (_, branch, query) => { calls.push([branch, query]); return expected; }, () => ({}));
  assert.deepEqual(await search({}, 'BR-SCHOOL', 'Тестовый'), expected);
  assert.deepEqual(calls, ['BR-SCHOOL', ['BR-SCHOOL', 'Тестовый']]);
});

function obligationFixture(selectedRows, deny=false) {
  const section=paySource.slice(paySource.indexOf('export async function createPayObligation('),paySource.indexOf('async function obligationFor('));
  const js=stripTypeScriptTypes(section).replace(/^export /gm,'');
  const writes=[],calls=[];
  const selected={familyId:'F',studentPersonId:'C',studentCrmId:'123',payerPersonId:'P',studentName:'Verified child',payerName:'Verified payer'};
  const db={prepare(){return{bind(...values){return{run:async()=>writes.push(values),first:async()=>({id:'PAYO-TEST'})};}};}};
  class PayError extends Error { constructor(message,status){super(message);this.status=status;} }
  const optionalText=value=>typeof value==='string'&&value.trim()?value.trim():null;
  const deps={serializeIdentityMutation:async fn=>{calls.push('locked');return fn();},
    assertBranchAccess:async()=>{if(deny)throw new PayError('denied',403);},routeFor:()=>({legalEntityId:'L',legalEntityName:'Legal'}),
    cleanText:value=>typeof value==='string'?value.trim():'',optionalText,positiveMinor:value=>value,
    loadPayCustomers:async(_db,branch,query,id)=>{calls.push([branch,query,id]);return selectedRows??[selected];},
    database:()=>db,ArtHelloPayError:PayError,nowIso:()=> '2026-09-29T00:00:00Z',uuid:()=> 'PAYO-TEST',
    validDate:optionalText,publicObligation:row=>row};
  const create=new Function(...Object.keys(deps),js+';return createPayObligation;')(...Object.values(deps));
  const body={branchCrmId:'BR-SCHOOL',legalEntityId:'L',purpose:'Test service',amountKopecks:100,payerEmail:'p@example.invalid',
    studentName:'Untrusted name',payerName:'Untrusted payer',familyId:'F',studentPersonId:'C',studentCrmId:'123',payerPersonId:'P'};
  return{create,body,writes,calls};
}
test('selected identity is rechecked within the shared mutation lock; saved names come from current cards',async()=>{
  const f=obligationFixture();await f.create({appUserId:'OWNER'},f.body);
  assert.deepEqual(f.calls,['locked',['BR-SCHOOL','','C']]);assert.equal(f.writes.length,1);
  assert.deepEqual(f.writes[0].slice(4,10),['F','P','C','123','Verified child','Verified payer']);
});
test('stale, cross-branch or forged identity is refused before any financial write',async()=>{
  for(const patch of [{familyId:'OTHER'},{studentCrmId:'999'},{payerPersonId:'OTHER'},{studentPersonId:''}]) {
    const f=obligationFixture();await assert.rejects(f.create({}, {...f.body,...patch}),{status:409});assert.equal(f.writes.length,0);
  }
  const stale=obligationFixture([]);await assert.rejects(stale.create({},stale.body),{status:409});assert.equal(stale.writes.length,0);
  const denied=obligationFixture(undefined,true);await assert.rejects(denied.create({},denied.body),{status:403});assert.equal(denied.writes.length,0);
});
test('explicit manual entry remains unlinked rather than guessing a canonical identity',async()=>{
  const f=obligationFixture();await f.create({appUserId:'OWNER'},{...f.body,familyId:undefined,studentPersonId:undefined,studentCrmId:undefined,payerPersonId:undefined});
  assert.deepEqual(f.calls,['locked']);assert.deepEqual(f.writes[0].slice(4,8),[null,null,null,null]);
});

test('CRM-only identity cannot bypass selected-card verification',async()=>{
  const f=obligationFixture();await assert.rejects(f.create({}, {...f.body,familyId:undefined,studentPersonId:undefined,payerPersonId:undefined}),{status:409});
  assert.equal(f.writes.length,0);
});
test('per-submission reference separates branches and distinct equal-amount charges',()=>{
  let asset;
  try {asset=readFileSync(new URL('../../public/pay-assets/app.js',import.meta.url),'utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;asset=readFileSync(new URL('../contract-fixtures/pay-app.js',import.meta.url),'utf8');}
  const body=asset.match(/function paymentSubmissionRef\([\s\S]*?\n\}/)?.[0];
  assert.ok(body,'submission reference helper is required');
  const makeRef=new Function(body+';return paymentSubmissionRef;')();
  const customer={studentCrmId:'123',remoteBranchId:'8'};
  assert.notEqual(makeRef('BR-SCHOOL',customer,'A'),makeRef('BR-ATLAS-SCHOOL',{...customer,remoteBranchId:'10'},'A'));
  assert.notEqual(makeRef('BR-SCHOOL',customer,'A'),makeRef('BR-SCHOOL',customer,'B'));
  assert.equal(makeRef('BR-SCHOOL',customer,'A'),makeRef('BR-SCHOOL',customer,'A'));
});
