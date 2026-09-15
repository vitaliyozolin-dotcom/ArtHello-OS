import test from 'node:test';
import assert from 'node:assert/strict';
import { customerPolicy, previewCustomers } from '../lib/alfacrm-customer-policy.ts';

test('approved statuses retain distinct lifecycle and attendance meaning', () => {
  assert.deepEqual(customerPolicy('Активен'), { include: true, lifecycle: 'active', attendance: 'unspecified', destination: 'clients' });
  assert.equal(customerPolicy('Открыто').lifecycle, 'open');
  assert.deepEqual(customerPolicy('Разовое посещение'), { include: true, lifecycle: 'unverified', attendance: 'single', destination: 'clients' });
  assert.equal(customerPolicy('Запись').destination, 'leads');
  for (const status of ['Пробное занятие', 'Завершил']) assert.equal(customerPolicy(status).include, false);
  assert.equal(customerPolicy(null).lifecycle, 'review');
  assert.equal(customerPolicy('Неизвестный статус').lifecycle, 'review');
});

test('preview counts branch assignments and unique source IDs separately without mutations', () => {
  const rows = [
    { id: '1', branch: '2', status: 'Активен', branchIds: ['2', '6'] },
    { id: '1', branch: '6', status: 'Открыто', branchIds: ['2', '6'] },
    { id: '2', branch: '2', status: 'Разовое посещение', branchIds: ['2'] },
    { id: '3', branch: '6', status: 'Запись', branchIds: ['6'] },
    { id: '4', branch: '6', status: 'Завершил', branchIds: ['6'] },
    { id: '5', branch: '6', status: 'Активен', branchIds: ['2'] },
  ];
  const before = structuredClone(rows);
  const report = previewCustomers(rows, ['2', '6'], { complete: true });
  assert.equal(report.includedAssignments, 4);
  assert.equal(report.uniqueIncludedCustomerIds, 3);
  assert.equal(report.excludedStatus, 1);
  assert.equal(report.foreignBranch, 1);
  assert.deepEqual(report.intersections, [{ id: '1', branches: ['2', '6'] }]);
  assert.equal(report.byBranch['6'].leads, 1);
  assert.equal(report.byBranch['2'].single, 1);
  assert.deepEqual(rows, before);
});

test('unknown status, unknown membership and incomplete reads cannot authorize cleanup', () => {
  const valid = { id: '1', branch: '2', status: 'Активен', branchIds: ['2'] };
  for (const rows of [[{ ...valid, status: null }], [{ ...valid, branchIds: undefined }], [valid, valid]]) {
    const report = previewCustomers(rows, ['2'], { complete: true });
    assert.equal(report.readyForReconciliation, false);
  }
  assert.equal(previewCustomers([valid], ['2'], { complete: false }).readyForReconciliation, false);
});

test('school status is review evidence, never a silent transfer to a different branch', () => {
  const report = previewCustomers([{ id: '1', branch: '6', status: 'Активен ШКОЛА', branchIds: ['6'] }], ['6', '10'], { complete: true });
  assert.equal(report.byBranch['6'].active, 1);
  assert.equal(report.byBranch['10'].included, 0);
  assert.equal(report.schoolAssignments.length, 1);
  assert.equal(report.readyForReconciliation, false);
});
