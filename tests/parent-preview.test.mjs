import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mayPreviewParent, projectParentPreview } from '../lib/parent-preview.mjs';

const fixture = () => ({
  viewer:{role:'deputy'}, students:[{id:'a',fullName:'Child A',className:'1'},{id:'b',fullName:'Child B',className:'2'}],
  lessons:[{id:'l1',className:'1',status:'active',note:'staff-only'},{id:'l2',className:'2',status:'active'}],
  homework:[{id:'h1',className:'1',status:'active'},{id:'h2',className:'2',status:'active'}],
  grades:[{id:'g1',studentId:'a'},{id:'g2',studentId:'b'}],
  comments:[{id:'c1',studentId:'a',visibility:'parent',body:'published'},{id:'c2',studentId:'a',visibility:'staff',body:'SECRET'},{id:'c3',studentId:'b',visibility:'parent',body:'OTHER CHILD'}],
  achievements:[],attendance:[{id:'t1',studentId:'a',note:'internal note'}],
  messages:[{body:'PRIVATE CHAT'}],subscriptions:[{balance:999}],notifications:[{readAt:null}],audit:[{details:'SECRET'}],
});
test('roles are denied by default',()=>{
  for(const role of ['teacher','methodist','parent','student','admin','tech_admin','unknown']) {
    assert.equal(mayPreviewParent(role),false);
    assert.throws(()=>projectParentPreview({...fixture(),viewer:{role}},'a'));
  }
});
test('requested child must be in authenticated actor snapshot; no fallback',()=>{
  assert.throws(()=>projectParentPreview(fixture(),'missing'));
  assert.throws(()=>projectParentPreview(fixture(),''));
});
test('projection excludes other children, staff comments, finances and chat',()=>{
  const input=fixture();const before=structuredClone(input);const out=projectParentPreview(input,'a');
  assert.deepEqual(out.comments.map(x=>x.id),['c1']);
  assert.deepEqual(out.lessons.map(x=>x.id),['l1']);
  assert.deepEqual(out.homework.map(x=>x.id),['h1']);
  assert.deepEqual(out.grades.map(x=>x.id),['g1']);
  assert.equal(out.readOnly,true);
  assert.doesNotMatch(JSON.stringify(out),/SECRET|OTHER CHILD|PRIVATE CHAT|internal note|staff-only|999/);
  assert.deepEqual(input,before);
  for(const key of ['viewer','messages','subscriptions','notifications','audit','users']) assert.equal(key in out,false);
});
test('endpoint checks exact child before snapshot and rejects preview writes',()=>{
  const source=readFileSync(new URL('../app/api/school/route.ts',import.meta.url),'utf8');
  const preview=source.slice(source.indexOf('const preview = new URL(request.url)'));
  assert(preview.indexOf('visibleStudentIds(actor)')<preview.indexOf('loadSnapshot(actor, request)'));
  const post=source.slice(source.indexOf('export async function POST'));
  assert(post.indexOf('searchParams.has("preview")')<post.indexOf('ensureSchoolStructure()'));
});
