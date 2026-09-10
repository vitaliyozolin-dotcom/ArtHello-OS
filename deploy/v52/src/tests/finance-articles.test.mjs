import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyCatalog, changeCatalog, validateClassification, previewArticleRule, cashflowBreakdown } from '../lib/finance-articles.ts';

const draft = (overrides = {}) => ({ action: 'createArticle', name: 'Аренда', report: 'cashflow', direction: 'Списание', group: 'operating', ...overrides });
const create = (catalog, input = {}, id = 'a') => changeCatalog(catalog, draft(input), 'FINANCE', id);
const approve = (catalog, id = 'a') => changeCatalog(catalog, { action: 'approveArticle', articleId: id }, 'OWNER', 'ignored');
const operation = { id: 'op', direction: 'Списание', cashflowArticle: '', category: 'Не классифицировано', pnlArticle: '', reportClass: 'Не включено в ОПиУ', accrualPeriod: '', updatedAt: '2026-09-10T00:00:00.000Z' };
const allocation = { cashflowArticle: 'Аренда', reportClass: 'Не включено в ОПиУ', expectedUpdatedAt: operation.updatedAt };

test('new catalog is empty; creating a proposal never approves it', () => {
  assert.equal(emptyCatalog().articles.length, 0);
  const result = create(emptyCatalog());
  assert.equal(result.articles[0].status, 'draft');
  assert.equal(result.revision, 1);
  assert.equal(emptyCatalog().revision, 0);
});
test('duplicate names normalize whitespace, Unicode and case within each report', () => {
  const result = create(emptyCatalog());
  assert.throws(() => create(result, { name: '  АРЕНДА  ' }, 'b'), /существует/);
  assert.equal(create(result, { report: 'pnl' }, 'b').articles.length, 2);
});
test('only leaders approve/archive; finance staff can propose; others cannot write', () => {
  const catalog = create(emptyCatalog());
  assert.throws(() => changeCatalog(catalog, { action: 'approveArticle', articleId: 'a' }, 'FINANCE', ''), /прав/);
  assert.throws(() => create(emptyCatalog(), { name: '' }), /название/);
  assert.throws(() => changeCatalog(catalog, draft(), 'TEACHER', 'a'), /прав/);
  const approved = approve(catalog);
  assert.equal(approved.articles[0].status, 'active');
  const archived = changeCatalog(approved, { action: 'archiveArticle', articleId: 'a' }, 'OWNER', '');
  assert.equal(archived.articles[0].status, 'archived');
  assert.throws(() => approve(archived), /архив/);
});
test('assignments require approved report-specific article and matching cash direction', () => {
  const catalog = create(emptyCatalog());
  assert.throws(() => validateClassification(catalog, operation, allocation), /утвержд/);
  assert.equal(validateClassification(approve(catalog), operation, allocation).category, 'Аренда');
  assert.throws(() => validateClassification(approve(catalog), { ...operation, direction: 'Поступление' }, allocation), /направлен/);
});
test('P&L is explicit: cash payment does not infer revenue or accrual period', () => {
  let catalog = approve(create(emptyCatalog()));
  catalog = approve(create(catalog, { report: 'pnl', name: 'Расход аренды' }, 'b'), 'b');
  assert.equal(validateClassification(catalog, operation, allocation).reportClass, 'Не включено в ОПиУ');
  for (const accrualPeriod of ['', '2026-00', '2026-13', '2026-02-junk']) {
    assert.throws(() => validateClassification(catalog, operation, { ...allocation, pnlArticle: 'Расход аренды', reportClass: 'Расходы ОПиУ', accrualPeriod }), /период/);
  }
  assert.equal(validateClassification(catalog, operation, { ...allocation, pnlArticle: 'Расход аренды', reportClass: 'Расходы ОПиУ', accrualPeriod: '2026-09' }).pnlArticle, 'Расход аренды');
});
test('unchanged legacy names remain usable without silently approving or rewriting history', () => {
  const legacy = { ...operation, cashflowArticle: 'Старая статья', category: 'Старая статья' };
  assert.equal(validateClassification(emptyCatalog(), legacy, { ...allocation, cashflowArticle: 'Старая статья' }).category, 'Старая статья');
  assert.throws(() => validateClassification(emptyCatalog(), operation, { ...allocation, cashflowArticle: 'Старая статья' }), /утвержд/);
});
test('stale draft rejected; raw bank and money fields cannot be assigned', () => {
  const catalog = approve(create(emptyCatalog()));
  assert.throws(() => validateClassification(catalog, operation, { ...allocation, expectedUpdatedAt: 'old' }), /изменена/);
  const value = validateClassification(catalog, operation, { ...allocation, amountMinor: 0, operationDate: '2099-01-01', legalEntityId: 'other', direction: 'Поступление' });
  for (const key of ['amountMinor', 'operationDate', 'direction', 'legalEntityId', 'bankOperationRef']) assert.equal(Object.hasOwn(value, key), false);
});
test('rule preview uses AND and exact INN, only unallocated same-month operations; no mutation', () => {
  const catalog = approve(create(emptyCatalog()));
  const base = { ...operation, amountMinor: 101, period: '2026-09', bankDetails: { currency: 'RUB', counterpartyInn: '0000000000', description: 'Оплата АРЕНДЫ' } };
  const rows = [base, { ...base, id: '2', amountMinor: 202 }, { ...base, id: '3', cashflowArticle: 'Другое' }, { ...base, id: '4', period: '2026-08' }, { ...base, id: '5', direction: 'Поступление' }, { ...base, id: '6', bankDetails: { ...base.bankDetails, counterpartyInn: '1000000000' } }];
  const before = structuredClone(rows);
  const result = previewArticleRule(catalog, rows, { articleId: 'a', period: '2026-09', counterpartyInn: '0000000000', purposeContains: 'аренды' });
  assert.deepEqual(result, { operationIds: ['op', '2'], count: 2, amountMinor: 303 });
  assert.deepEqual(rows, before);
  assert.throws(() => previewArticleRule(catalog, rows, { articleId: 'a', period: '2026-09' }), /условие/);
});
test('cashflow breakdown preserves every kopek including unclassified and legacy names', () => {
  const rows = [{ ...operation, period: '2026-09', amountMinor: 101 }, { ...operation, id: '2', period: '2026-09', amountMinor: 202, cashflowArticle: 'Аренда' }, { ...operation, id: '3', period: '2026-08', amountMinor: 999 }];
  const groups = cashflowBreakdown(rows, '2026-09');
  assert.equal(groups.reduce((sum, item) => sum + item.outflowsMinor, 0), 303);
  assert.equal(groups.find(item => item.article === 'Без статьи').count, 1);
});

test('positive-amount P&L model rejects a new income assignment to an outflow', () => {
  let catalog = approve(create(emptyCatalog()));
  catalog = approve(create(catalog, { report: 'pnl', name: 'Выручка', direction: 'Поступление' }, 'b'), 'b');
  assert.throws(() => validateClassification(catalog, operation, { ...allocation, pnlArticle: 'Выручка', reportClass: 'Доходы ОПиУ', accrualPeriod: '2026-09' }), /направлен/);
});
