import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { filterAssignedSafetyRows } from '../lib/safety-read-scope.ts';

function records() {
  const systems = ['A', 'B', 'C', 'UNKNOWN', 'A2'].map((key) => ({ id: 'SYS-' + key,
    objectEntityId: key === 'A2' ? 'BR-A' : key === 'UNKNOWN' ? 'School A' : 'BR-' + key,
    responsibleEntityId: 'STAFF-' + key, name: 'System ' + key, status: 'Работает' }));
  const equipment = systems.map((row, index) => ({ id: 'EQ-' + row.id.slice(4), systemId: row.id,
    contractorId: 'VENDOR-' + index, criticality: 'Высокая', nextCheckAt: '' }));
  const checks = systems.map((row) => ({ id: 'CHECK-' + row.id.slice(4), equipmentId: 'EQ-' + row.id.slice(4),
    objectEntityId: row.objectEntityId, responsibleEntityId: row.responsibleEntityId,
    status: 'Завершена', result: 'Неисправность', scheduledAt: '' }));
  const faults = checks.map((row, index) => ({ id: 'FAULT-' + row.id.slice(6), checkId: row.id,
    equipmentId: row.equipmentId, relatedTaskId: index + 1, status: 'В работе', severity: 'Критичный', detectedAt: '2026-09-01' }));
  const repairs = faults.map((row) => ({ id: 'REPAIR-' + row.id.slice(6), faultId: row.id,
    contractorId: 'VENDOR-' + row.id, paymentOperationId: 'PAY-' + row.id, costMinor: 100,
    status: 'Завершён', actDocumentId: 'ACT-' + row.id, result: 'Synthetic repair' }));
  const nextChecks = repairs.map((row) => ({ id: 'NEXT-' + row.id.slice(7), sourceRepairId: row.id,
    equipmentId: 'EQ-' + row.id.slice(7), responsibleEntityId: 'STAFF-' + row.id.slice(7), scheduledAt: '' }));
  const incidents = systems.map((row) => ({ id: 'INC-' + row.id.slice(4), systemId: row.id, objectEntityId: row.objectEntityId }));
  const guardShifts = systems.map((row) => ({ id: 'SHIFT-' + row.id.slice(4), objectEntityId: row.objectEntityId,
    employeeEntityId: 'GUARD-' + row.id.slice(4) }));
  const allTasks = faults.map((row) => ({ id: row.relatedTaskId, sourceType: 'Неисправность безопасности',
    sourceId: row.id, automationKey: 'SAFETY_FAULT:' + row.id }));
  const names = new Set([...systems.flatMap((row) => [row.objectEntityId, row.responsibleEntityId]),
    ...equipment.map((row) => row.contractorId), ...repairs.map((row) => row.contractorId),
    ...guardShifts.map((row) => row.employeeEntityId), 'PRIVATE-UNRELATED']);
  return { systems, equipment, checks, faults, repairs, nextChecks, incidents, guardShifts, allTasks,
    entityRows: [...names].map((id) => ({ id, displayName: 'Name ' + id })),
    operations: repairs.map((row) => ({ id: row.paymentOperationId, objectEntityId: 'BR-A', amountMinor: 999_999 })) };
}

test('assigned safety read follows the proven graph and hides foreign, inactive and unresolvable objects', () => {
  const data = records(); const result = filterAssignedSafetyRows(new Set(['BR-A']), data);
  for (const key of ['systems', 'equipment', 'checks', 'faults', 'repairs', 'nextChecks', 'incidents', 'guardShifts']) {
    assert.equal(result[key].length, 2, key); assert.ok(result[key].every((row) => /-A2?$/.test(row.id)), key);
  }
  assert.deepEqual(result.allTasks.map((row) => row.sourceId), ['FAULT-A', 'FAULT-A2']);
  assert.deepEqual(result.operations, []); assert.ok(result.repairs.every((row) => row.paymentOperationId === ''));
  assert.ok(result.entityRows.some((row) => row.id === 'STAFF-A'));
  assert.ok(result.entityRows.every((row) => !['STAFF-B', 'STAFF-C', 'PRIVATE-UNRELATED', 'School A'].includes(row.id)));
  assert.notEqual(data.repairs[0].paymentOperationId, '', 'filter must not mutate source rows');
});

test('cross-linked checks, faults, incidents, repairs and next checks cannot widen a branch grant', () => {
  const data = records();
  data.checks.push({ ...data.checks[0], id: 'CHECK-CROSS', equipmentId: 'EQ-B' });
  data.faults.push({ ...data.faults[0], id: 'FAULT-CROSS', checkId: 'CHECK-A', equipmentId: 'EQ-A2' });
  data.faults.push({ ...data.faults[0], id: 'FAULT-UNKNOWN', checkId: 'missing' });
  data.repairs.push({ ...data.repairs[0], id: 'REPAIR-CROSS', faultId: 'FAULT-CROSS' });
  data.incidents.push({ ...data.incidents[0], id: 'INC-CROSS', systemId: 'SYS-B' });
  data.nextChecks.push({ ...data.nextChecks[0], id: 'NEXT-CROSS', equipmentId: 'EQ-A2' });
  data.nextChecks.push({ ...data.nextChecks[0], id: 'NEXT-MISSING', sourceRepairId: 'missing' });
  const result = filterAssignedSafetyRows(new Set(['BR-A']), data);
  for (const key of ['checks', 'faults', 'repairs', 'incidents', 'nextChecks']) {
    assert.equal(result[key].length, 2, key);
    assert.ok(result[key].every((row) => !/CROSS|MISSING|UNKNOWN/.test(row.id)), key);
  }
});

test('related task payloads require consistent fault source and automation identity', () => {
  const data = records();
  data.allTasks.push({ id: 44, sourceType: 'Неисправность безопасности', sourceId: 'FAULT-A', automationKey: 'SAFETY_FAULT:FAULT-B' });
  data.allTasks.push({ id: 45, sourceType: 'Неисправность безопасности', sourceId: 'FAULT-A', automationKey: 'SAFETY_FAULT:FAULT-A' });
  data.allTasks.push({ id: 46, sourceType: 'Ручная задача', sourceId: 'FAULT-A', automationKey: null });
  assert.deepEqual(filterAssignedSafetyRows(new Set(['BR-A']), data).allTasks.map((row) => row.id), [1, 5]);
});

test('native role/owner model remains intact; an empty assigned scope exposes nothing', () => {
  const data = records(); assert.equal(filterAssignedSafetyRows(null, data), data);
  const empty = filterAssignedSafetyRows(new Set(), data);
  for (const [key, rows] of Object.entries(empty)) assert.deepEqual(rows, [], key);
});

const dataModule = (value) => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`;
async function loadActualSafetyHandler() {
  const raw = await readFile(new URL('../app/api/safety/route.ts', import.meta.url), 'utf8');
  const shared = stripTypeScriptTypes(await readFile(new URL('../lib/section-read-scope.ts', import.meta.url), 'utf8'), { mode: 'strip' })
    .replace(/from\s*["']\.\/access-policy(?:\.ts)?["']/g, `from "${new URL('../lib/access-policy.ts', import.meta.url).href}"`);
  const compiled = stripTypeScriptTypes(raw, { mode: 'strip' }).replace(/from\s*["']([^"']+)["']/g, (_all, dependency) => {
    let mapped;
    if (dependency === '../../../db') mapped = dataModule(`export const ensureCoreTables=async()=>{globalThis.__safetyReadFixture.reads++};
      export const getDb=()=>({select:()=>{let table,condition; const query={from(value){table=value.name;if(table==='financialOperations')globalThis.__safetyReadFixture.financeReads++;return this},
        where(value){condition=value;return this},orderBy(){return this},then(resolve,reject){let rows=globalThis.__safetyReadFixture.tables[table]??[];
          if(condition)rows=rows.filter(row=>row[condition.column]===condition.value);return Promise.resolve(rows).then(resolve,reject)}};return query}});`);
    else if (dependency === '../../../lib/production-auth') mapped = dataModule('export const getAuthenticatedRequestContext=async()=>globalThis.__safetyReadFixture.context;');
    else if (dependency === 'drizzle-orm') mapped = dataModule('export const asc=x=>x,eq=(column,value)=>({column,value});');
    else if (dependency === '../../../lib/task-access-query') mapped = dataModule(`export const selectVisibleTasks=async()=>globalThis.__safetyReadFixture.tables.allTasks,
      redactHiddenTaskReferences=(rows,tasks)=>rows.map(row=>({...row,relatedTaskId:tasks.some(task=>task.id===row.relatedTaskId)?row.relatedTaskId:null}));`);
    else if (dependency === '../../../db/schema') {
      const names = raw.match(/import\s*\{([^}]+)\}\s*from\s*["']\.\.\/\.\.\/\.\.\/db\/schema["']/)[1];
      mapped = dataModule(names.split(',').map((name) => name.trim()).filter(Boolean)
        .map((name) => `export const ${name}={name:'${name}',userId:'userId',branchId:'branchId'};`).join('\n'));
    } else if (dependency === '../../../lib/section-read-scope') mapped = dataModule(shared);
    else if (dependency.startsWith('../../../lib/')) mapped = new URL(`../lib/${dependency.slice('../../../lib/'.length)}.ts`, import.meta.url).href;
    assert.ok(mapped, dependency); return `from "${mapped}"`;
  });
  return import(dataModule(compiled));
}
const { GET } = await loadActualSafetyHandler();
function routeFixture(role, allowedModules, extra = {}) {
  const data = records(); const user = { apiRole: role, isSystemOwner: role === 'OWNER', allowedModules, ...extra };
  const tables = { safetySystems: data.systems, safetyEquipment: data.equipment, safetyChecks: data.checks,
    safetyFaults: data.faults, safetyIncidents: data.incidents, safetyRepairs: data.repairs, safetyNextChecks: data.nextChecks,
    safetyGuardShifts: data.guardShifts, entities: data.entityRows, financialOperations: data.operations, allTasks: data.allTasks,
    organizationBranches: [
      { id: 'BR-A', name: 'School A', status: 'Активен' }, { id: 'BR-B', name: 'School B', status: 'Активен' },
      { id: 'BR-C', name: 'School C', status: 'Неактивен' },
    ], userBranchAccess: [
      { userId: 'CURRENT', branchId: 'BR-A' }, { userId: 'CURRENT', branchId: 'BR-C' },
      { userId: 'OTHER', branchId: 'BR-B' },
    ] };
  return globalThis.__safetyReadFixture = { context: { apiRole: role, appUserId: 'CURRENT', auth: { user } },
    tables, reads: 0, financeReads: 0 };
}
const request = () => new Request('https://example.test/api/safety', { headers: { 'x-arthello-role': 'OWNER' } });

test('actual GET grants only active assigned branch rows and computes aggregates after filtering', async () => {
  const fixture = routeFixture('EMPLOYEE', ['safety']); const response = await GET(request());
  assert.equal(response.status, 200); const body = await response.json();
  assert.deepEqual(body.systems.map((row) => row.id), ['SYS-A', 'SYS-A2']);
  assert.equal(body.summary.systems, 2); assert.equal(body.summary.equipment, 2); assert.equal(body.summary.openFaults, 2);
  assert.deepEqual(body.payments, []); assert.equal(body.chain.paymentId, ''); assert.equal(fixture.financeReads, 0);
  assert.ok(!JSON.stringify(body).includes('PRIVATE-UNRELATED')); assert.ok(!JSON.stringify(body).includes('SYS-B'));
  assert.equal(body.chain.objectId, 'BR-A');
});

test('actual GET administrative assigned role sees all active branches, never inactive or guessed object names', async () => {
  routeFixture('EMPLOYEE', ['safety'], { isAdministrative: true }); const body = await (await GET(request())).json();
  assert.deepEqual(body.systems.map((row) => row.id), ['SYS-A', 'SYS-B', 'SYS-A2']);
  assert.deepEqual(body.payments, []);
});

test('actual GET owner and existing SAFETY role retain their current read model', async () => {
  for (const role of ['OWNER', 'SAFETY']) {
    const fixture = routeFixture(role, ['safety']); const body = await (await GET(request())).json();
    assert.equal(body.systems.length, 5); assert.equal(body.payments.length, 5); assert.equal(fixture.financeReads, 1);
    assert.ok(body.entityNames['PRIVATE-UNRELATED']);
  }
});

test('actual GET fails closed for removed checkbox, unassigned role and fake owner before data access', async () => {
  for (const [role, modules, extra] of [['EMPLOYEE', [], {}], ['EMPLOYEE', undefined, {}], ['OWNER', ['safety'], { isSystemOwner: false }]]) {
    const fixture = routeFixture(role, modules, extra); assert.equal((await GET(request())).status, 403); assert.equal(fixture.reads, 0);
  }
});
