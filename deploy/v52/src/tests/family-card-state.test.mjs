import test from 'node:test';
import assert from 'node:assert/strict';
import { familyCardState } from '../lib/family-card-state.ts';

const family = (meta = {}, extra = {}) => ({status:'Активна',sourceSystem:'ALFACRM',dataQuality:'На проверке',metadata:JSON.stringify(meta),...extra});
test('source statuses stay literal and separate from card state', () => {
  for (const status of ['Активен','Активен ШКОЛА','Открыто','Разовое посещение','Запись']) {
    const state = familyCardState(family({alfaStatusName:status}));
    assert.equal(state.customerStatus,status);
    assert.equal(state.cardStatus,'Текущая');
    assert.ok(!state.customerStatus.includes('не подтверждена'));
  }
});
test('branch statuses do not collapse and inactive assignments stay excluded', () => {
  const state = familyCardState(family({branchAssignments:[
    {active:true,scope:'Сад',alfaStatusName:'Открыто'},
    {active:true,scope:'Школа',alfaStatusName:'Активен ШКОЛА'},
    {active:false,scope:'Старый филиал',alfaStatusName:'Активен'},
  ]}));
  assert.equal(state.customerStatus,'Сад: Открыто; Школа: Активен ШКОЛА');
});
test('name collision is evidence of a name match only; saving does not clear it', () => {
  const state = familyCardState(family({alfaStatusName:'Активен'}, {dataQuality:'Проверено',hasNameCollision:true}));
  assert.equal(state.issues[0].code,'name-collision');
  assert.match(state.issues[0].action,/Не объединяйте/);
});
test('actual linked representative overrides old missing source field', () => {
  const f=family({alfaStatusName:'Активен',guardianName:''});
  assert.ok(familyCardState(f,{parentName:'Представитель семьи'}).issues.some(x=>x.code==='parent-missing'));
  assert.ok(!familyCardState(f,{parentName:'Тестовый Родитель'}).issues.some(x=>x.code==='parent-missing'));
  assert.ok(!familyCardState(f).issues.some(x=>x.code==='parent-missing'));
  assert.ok(familyCardState(f).issues.some(x=>x.code==='import-review'));
});
test('unknown source and malformed metadata never look active or complete', () => {
  for (const metadata of ['{}','not-json','null','[]']) {
    const state=familyCardState(family({}, {metadata,dataQuality:'Проверено'}));
    assert.equal(state.customerStatus,'Статус в AlfaCRM не подтверждён');
    assert.ok(state.issues.some(x=>x.code==='source-status'));
  }
});
test('review is not shown as complete merely because a field was edited', () => {
  const state=familyCardState(family({alfaStatusName:'Разовое посещение'}),{parentName:'Тестовый Родитель'});
  assert.ok(state.issues.some(x=>x.code==='import-review'));
  assert.equal(familyCardState(family({}, {sourceSystem:'MANUAL',dataQuality:'Проверено'})).issues.length,0);
  assert.equal(familyCardState(family({alfaStatusName:'Активен'}, {status:'Архив'})).cardStatus,'Архив');
});
