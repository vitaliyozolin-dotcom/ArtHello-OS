import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { editableFamilyExtras } from '../lib/family-card-state.ts';

// Execute the actual route handlers with an isolated, in-memory database double.
// No production credentials, customer records, network calls or duplicated merge logic.
const source = stripTypeScriptTypes(readFileSync(new URL('../app/api/families/route.ts', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');
const tableNames = ['auditEvents', 'clientAccruals', 'clientLifecycles', 'educationGroups',
  'educationStudents', 'entities', 'entityLinks', 'financialOperations', 'legalContracts',
  'legalDocumentItems', 'organizationBranches', 'salesLeads', 'salesStageEvents', 'salesTouchpoints'];

function fixture({ sourceSystem = 'ALFACRM', authenticated = true, allowed = true } = {}) {
  const tables = Object.fromEntries(tableNames.map(name => [name, new Proxy({ table: name }, {
    get: (target, key) => key === 'table' ? target.table : key,
  })]));
  const rows = Object.fromEntries(tableNames.map(name => [name, []]));
  const protectedMetadata = {
    canonicalId: 'TEST-CANONICAL', alfaCustomerId: '123', remoteBranchId: '7',
    branchAssignments: [{ active: true, scope: 'Тестовый филиал', alfaStatusName: 'Активен' }],
    identitySourceStatus: { verified: true }, localArchive: false, legacyIds: [1, 2],
    source_record_id: 'TEST-SOURCE', metadata: { imported: true },
  };
  const entity = (id, entityType, displayName, extra) => ({ id, entityType, displayName,
    sourceSystem, sourceRecordId: `TEST:${id}`, status: 'Активна', dataQuality: 'Проверено',
    scope: 'Тестовый филиал', metadata: JSON.stringify({ ...protectedMetadata, ...extra }),
  });
  rows.entities = [
    entity('TEST-FAMILY', 'Семья', 'Тестовая семья', { discountCode: 'OLD' }),
    entity('TEST-PARENT', 'Клиент', 'Тестовый представитель', { contactTime: 'Утро', retained: 'keep' }),
    entity('TEST-CHILD', 'Ребёнок', 'Тестовый ученик', { interests: 'Рисование', retained: 'keep' }),
  ];
  rows.entityLinks = ['TEST-PARENT', 'TEST-CHILD'].map(toEntityId => ({ fromEntityId: 'TEST-FAMILY', toEntityId, relationType: 'Тестовая связь' }));
  const db = {
    select: columns => ({ from: table => {
      let selected = rows[table.table];
      const query = {
        where(predicate) { selected = selected.filter(predicate); return this; },
        limit(count) { selected = selected.slice(0, count); return this; },
        orderBy() { return this; },
        then(resolve, reject) { return Promise.resolve(selected.map(row => columns
          ? Object.fromEntries(Object.entries(columns).map(([key, field]) => [key, row[field]]))
          : { ...row })).then(resolve, reject); },
      };
      return query;
    } }),
    update: table => ({ set: changes => ({ where: async predicate => {
      for (const row of rows[table.table].filter(predicate)) Object.assign(row, changes);
    } }) }),
    insert: table => ({ values: async values => { rows[table.table].push(...(Array.isArray(values) ? values : [values])); } }),
  };
  const dependencies = {
    ...tables, editableFamilyExtras, env: { DB: {} }, getDb: () => db,
    ensureCoreTables: async () => {}, getRequestUser: () => authenticated ? 'test-editor' : null,
    getAuthenticatedRequestContext: async () => ({ appUserId: 'test-editor', auth: { user: { isAdministrative: true } } }),
    isCanonicalOwnerContext: () => false, canAccessApi: () => allowed,
    readIdentityIndex: async () => ({ cards: rows.entities, canonical: id => id, members: id => [id] }),
    eq: (key, value) => row => row[key] === value,
    inArray: (key, values) => row => values.includes(row[key]),
    and: (...predicates) => row => predicates.every(predicate => predicate(row)),
    or: (...predicates) => row => predicates.some(predicate => predicate(row)), asc: key => key,
  };
  const handlers = new Function(...Object.keys(dependencies), `${source}\nreturn { GET, PATCH };`)(...Object.values(dependencies));
  const body = { familyId: 'TEST-FAMILY', parentId: 'TEST-PARENT', childId: 'TEST-CHILD',
    familyName: 'Тестовая семья', parentName: 'Тестовый представитель', childName: 'Тестовый ученик',
    branch: 'Тестовый филиал', operationIds: '', groupName: '',
  };
  return { rows, protectedMetadata,
    patch: edits => handlers.PATCH(new Request('https://example.invalid/api/families', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...edits }),
    })),
    read: async () => {
      const response = await handlers.GET(new Request('https://example.invalid/api/families?id=TEST-FAMILY'));
      assert.equal(response.status, 200);
      const detail = await response.json();
      return { family: detail.family.profile,
        parent: detail.members.find(member => member.id === 'TEST-PARENT').profile,
        child: detail.members.find(member => member.id === 'TEST-CHILD').profile };
    },
  };
}

async function save(f, edits) {
  const response = await f.patch(edits);
  assert.equal(response.status, 200, await response.text());
  return f.read();
}

for (const sourceSystem of ['ALFACRM', 'MANUAL']) {
  test(`${sourceSystem}: existing representative and student extras survive PATCH then GET`, async () => {
    const f = fixture({ sourceSystem });
    const detail = await save(f, { parentOther: 'contactTime: Вечер', childOther: 'interests: Футбол' });
    assert.equal(detail.parent.contactTime, 'Вечер');
    assert.equal(detail.child.interests, 'Футбол');
    assert.equal(detail.parent.retained, 'keep');
    assert.equal(detail.child.retained, 'keep');
    assert.equal(f.rows.auditEvents.at(-1).action, 'family.updated');
    assert.equal(f.rows.educationStudents.length, 0);
  });
}

test('explicit empty values replace old extras and remain empty on repeated save', async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    const detail = await save(f, { parentOther: 'contactTime:', childOther: 'interests:' });
    assert.equal(detail.parent.contactTime, '');
    assert.equal(detail.child.interests, '');
  }
});

test('new extras, Cyrillic keys and colon-containing values are retained after reopening', async () => {
  const f = fixture();
  const detail = await save(f, { parentOther: 'contactTime: После 18:00\nСпособ связи: Почта', childOther: 'interests: Спорт\nПримечание: Встреча: пятница' });
  assert.equal(detail.parent.contactTime, 'После 18:00');
  assert.equal(detail.parent['Способ связи'], 'Почта');
  assert.equal(detail.child['Примечание'], 'Встреча: пятница');
});

test('dedicated contact and education controls take precedence over extra-field text', async () => {
  const f = fixture();
  const detail = await save(f, { parentPhone: 'TEST-PHONE', parentEmail: 'test@example.invalid',
    parentRelation: 'Представитель', className: 'Тестовый класс', birthDate: '2016-01-01',
    parentOther: 'phone: stale\nemail: stale\nrelation: stale\ncontactTime: Вечер',
    childOther: 'className: stale\nbirthDate: stale\ninterests: Спорт',
  });
  assert.equal(detail.parent.phone, 'TEST-PHONE');
  assert.equal(detail.parent.email, 'test@example.invalid');
  assert.equal(detail.parent.relation, 'Представитель');
  assert.equal(detail.child.className, 'Тестовый класс');
  assert.equal(detail.child.birthDate, '2016-01-01');
});

test('hidden source metadata and identifiers cannot be injected or converted to strings', async () => {
  const f = fixture();
  const hidden = Object.keys(f.protectedMetadata).map(key => `${key}: forged`).join('\n');
  const detail = await save(f, { familyOther: `${hidden}\nalfaNewId: forged\ndiscountCode: NEW`,
    parentOther: `${hidden}\nalfaNewId: forged\ncontactTime: Вечер`,
    childOther: `${hidden}\nalfaNewId: forged\ninterests: Спорт` });
  for (const profile of Object.values(detail)) {
    for (const [key, value] of Object.entries(f.protectedMetadata)) assert.deepEqual(profile[key], value, key);
    assert.equal(Object.hasOwn(profile, 'alfaNewId'), false);
  }
  assert.equal(detail.family.discountCode, 'NEW');
  assert.equal(detail.parent.contactTime, 'Вечер');
  assert.equal(detail.child.interests, 'Спорт');
});

test('generic extra-field filter excludes the same technical key shapes hidden by the editor', () => {
  const keys = ['id', 'sourceSystem', 'sourceRecordId', 'dataQuality', 'metadata', 'createdAt', 'updatedAt',
    'legacyId', 'legacyIds', 'legacy_id', 'legacy_ids', 'alfaStatusName', 'branchAssignments', 'localArchive'];
  assert.deepEqual(editableFamilyExtras({ ...Object.fromEntries(keys.map(key => [key, 'forged'])), contactTime: '', interests: 'Спорт' }), { contactTime: '', interests: 'Спорт' });
});

for (const [options, expectedStatus] of [[{ authenticated: false }, 401], [{ allowed: false }, 403]]) {
  test(`denied PATCH (${expectedStatus}) leaves all records untouched`, async () => {
    const f = fixture(options), before = structuredClone(f.rows);
    const response = await f.patch({ parentOther: 'contactTime: changed', childOther: 'interests: changed' });
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(f.rows, before);
  });
}
