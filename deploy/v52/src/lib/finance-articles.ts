/** D108: approved management dictionary. No bank writes, automatic accruals or seeded articles. */
export type Article = {
  id: string; name: string; report: 'cashflow' | 'pnl'; direction: 'Поступление' | 'Списание';
  group: 'operating' | 'investing' | 'financing' | 'internal'; status: 'draft' | 'active' | 'archived';
};
export type ArticleCatalog = { schema: 1; revision: number; articles: Article[] };
export type AllocationOperation = {
  id: string; direction: string; category: string; cashflowArticle: string; pnlArticle: string;
  reportClass: string; accrualPeriod: string; updatedAt: string;
};
export class FinanceArticleError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const writers = new Set(['OWNER', 'DIRECTOR', 'REPRESENTATIVE', 'FINANCE']);
const approvers = new Set(['OWNER', 'DIRECTOR', 'REPRESENTATIVE']);
const groups = new Set(['operating', 'investing', 'financing', 'internal']);
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const nameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
export const emptyCatalog = (): ArticleCatalog => ({ schema: 1, revision: 0, articles: [] });
function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new FinanceArticleError(`Проверьте ${label}`);
  return value.trim();
}
export function readCatalog(raw: string | null): ArticleCatalog {
  if (raw === null) return emptyCatalog();
  try {
    const value = JSON.parse(raw) as ArticleCatalog;
    if (value.schema !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.articles) || value.articles.length > 500) throw new Error();
    const keys = new Set<string>(); const ids = new Set<string>();
    for (const a of value.articles) {
      const key = `${a.report}:${nameKey(a.name)}`;
      if (typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(a.id) || ids.has(a.id) || !a.name || a.name.length > 160 || keys.has(key) || !['cashflow', 'pnl'].includes(a.report) || !['Поступление', 'Списание'].includes(a.direction) || !groups.has(a.group) || !['draft', 'active', 'archived'].includes(a.status)) throw new Error();
      keys.add(key); ids.add(a.id);
    }
    return value;
  } catch { throw new FinanceArticleError('Справочник статей недоступен. Сохранение остановлено.', 503); }
}
export function changeCatalog(catalog: ArticleCatalog, body: Record<string, unknown>, role: string, id: string): ArticleCatalog {
  if (!writers.has(role)) throw new FinanceArticleError('Недостаточно прав', 403);
  const articles = catalog.articles.map(a => ({ ...a }));
  if (body.action === 'createArticle') {
    const name = text(body.name, 160, 'название').normalize('NFKC').replace(/\s+/g, ' ');
    if (!name || ['без статьи', 'не классифицировано'].includes(nameKey(name))) throw new FinanceArticleError('Укажите название статьи');
    if (!['cashflow', 'pnl'].includes(String(body.report)) || !['Поступление', 'Списание'].includes(String(body.direction)) || !groups.has(String(body.group))) throw new FinanceArticleError('Выберите отчёт, направление и вид деятельности');
    if (articles.some(a => a.report === body.report && nameKey(a.name) === nameKey(name))) throw new FinanceArticleError('Такая статья уже существует, в том числе в архиве', 409);
    if (articles.length >= 500) throw new FinanceArticleError('Достигнут предел справочника', 409);
    articles.push({ id, name, report: body.report as Article['report'], direction: body.direction as Article['direction'], group: body.group as Article['group'], status: 'draft' });
  } else {
    if (!approvers.has(role)) throw new FinanceArticleError('Недостаточно прав для утверждения или архива', 403);
    const article = articles.find(a => a.id === body.articleId);
    if (!article) throw new FinanceArticleError('Статья не найдена', 404);
    if (body.action === 'approveArticle') {
      if (article.status !== 'draft') throw new FinanceArticleError('Утвердить можно только черновик; архив сохранён', 409);
      article.status = 'active';
    } else if (body.action === 'archiveArticle') {
      if (article.status === 'archived') throw new FinanceArticleError('Статья уже в архиве', 409);
      article.status = 'archived';
    } else throw new FinanceArticleError('Неизвестное действие');
  }
  return { schema: 1, revision: catalog.revision + 1, articles };
}
function requireArticle(catalog: ArticleCatalog, name: string, report: Article['report'], direction: string, unchanged: boolean) {
  if (unchanged) return; // Preserve history; this does not activate a legacy/archived article for another operation.
  const article = catalog.articles.find(a => a.report === report && a.name === name && a.status === 'active');
  if (!article) throw new FinanceArticleError('Выберите утверждённую статью из справочника');
  if (article.direction !== direction) throw new FinanceArticleError('Статья не подходит для направления операции');
}
export function validateClassification(catalog: ArticleCatalog, operation: AllocationOperation, body: Record<string, unknown>) {
  if (body.expectedUpdatedAt !== operation.updatedAt) throw new FinanceArticleError('Операция уже изменена. Обновите её и повторите разнесение.', 409);
  const cashflowArticle = text(body.cashflowArticle, 160, 'статью ДДС');
  const pnlArticle = text(body.pnlArticle, 160, 'статью ОПиУ');
  const reportClass = text(body.reportClass, 80, 'класс ОПиУ');
  const accrualPeriod = text(body.accrualPeriod, 7, 'период ОПиУ');
  if (!cashflowArticle) throw new FinanceArticleError('Укажите статью ДДС');
  if (!['Доходы ОПиУ', 'Расходы ОПиУ', 'Финансирование', 'Не включено в ОПиУ'].includes(reportClass)) throw new FinanceArticleError('Выберите класс ОПиУ');
  requireArticle(catalog, cashflowArticle, 'cashflow', operation.direction, cashflowArticle === (operation.cashflowArticle || (operation.category === 'Не классифицировано' ? '' : operation.category)));
  const affectsPnl = reportClass === 'Доходы ОПиУ' || reportClass === 'Расходы ОПиУ';
  const pnlDirection = reportClass === 'Доходы ОПиУ' ? 'Поступление' : 'Списание';
  const unchangedPnl = reportClass === operation.reportClass && pnlArticle === operation.pnlArticle && accrualPeriod === operation.accrualPeriod;
  if (affectsPnl && pnlDirection !== operation.direction && !unchangedPnl) throw new FinanceArticleError('Класс ОПиУ не соответствует направлению операции. Для возврата требуется отдельная корректировка ОПиУ.');
  if ((affectsPnl && !monthPattern.test(accrualPeriod)) || (accrualPeriod && !monthPattern.test(accrualPeriod))) throw new FinanceArticleError('Укажите корректный период ОПиУ');
  if (affectsPnl) requireArticle(catalog, pnlArticle, 'pnl', reportClass === 'Доходы ОПиУ' ? 'Поступление' : 'Списание', Boolean(pnlArticle) && pnlArticle === operation.pnlArticle && reportClass === operation.reportClass);
  else if (pnlArticle && pnlArticle !== operation.pnlArticle) throw new FinanceArticleError('Статья ОПиУ требует класса доходов или расходов');
  return {
    cashflowArticle, category: cashflowArticle, pnlArticle, reportClass, accrualPeriod,
    counterpartyLabel: text(body.counterpartyLabel, 240, 'контрагента'),
    managementPurpose: text(body.managementPurpose, 500, 'назначение'),
    contractId: text(body.contractId, 120, 'договор'), documentId: text(body.documentId, 120, 'документ'),
    projectEntityId: text(body.projectEntityId, 120, 'проект'), objectEntityId: text(body.objectEntityId, 120, 'объект'), cfrEntityId: text(body.cfrEntityId, 120, 'ЦФО'),
    status: 'Разнесено',
  };
}
export function operationArticle(operation: { cashflowArticle: string; category: string }) {
  const value = operation.cashflowArticle || operation.category;
  return !value || value === 'Не классифицировано' ? '' : value;
}
type CashOperation = { id: string; period: string; direction: string; amountMinor: number; cashflowArticle: string; category: string };
export function cashflowBreakdown(operations: CashOperation[], period: string) {
  const groups = new Map<string, { article: string; count: number; receiptsMinor: number; outflowsMinor: number }>();
  for (const op of operations.filter(op => op.period === period)) {
    const article = operationArticle(op) || 'Без статьи';
    const group = groups.get(article) ?? { article, count: 0, receiptsMinor: 0, outflowsMinor: 0 };
    group.count += 1;
    if (op.direction === 'Поступление') group.receiptsMinor += op.amountMinor;
    if (op.direction === 'Списание') group.outflowsMinor += op.amountMinor;
    groups.set(article, group);
  }
  return [...groups.values()].sort((a, b) => a.article.localeCompare(b.article, 'ru'));
}
export function previewArticleRule(catalog: ArticleCatalog, operations: (CashOperation & { bankDetails: null | { counterpartyInn: string; description: string; currency: string } })[], input: { articleId: string; period: string; counterpartyInn?: string; purposeContains?: string }) {
  const article = catalog.articles.find(a => a.id === input.articleId && a.report === 'cashflow' && a.status === 'active');
  if (!article) throw new FinanceArticleError('Выберите утверждённую статью ДДС');
  if (!monthPattern.test(input.period)) throw new FinanceArticleError('Выберите период');
  const inn = text(input.counterpartyInn, 12, 'ИНН');
  const purpose = text(input.purposeContains, 160, 'назначение').toLocaleLowerCase('ru');
  if (!inn && purpose.length < 3) throw new FinanceArticleError('Задайте ИНН или условие по назначению длиной от трёх символов');
  if (inn && !/^(\d{10}|\d{12})$/.test(inn)) throw new FinanceArticleError('ИНН должен содержать 10 или 12 цифр');
  const matched = operations.filter(op => op.period === input.period && !operationArticle(op) && op.direction === article.direction && op.bankDetails?.currency === 'RUB' && (!inn || op.bankDetails.counterpartyInn === inn) && (!purpose || op.bankDetails.description.toLocaleLowerCase('ru').includes(purpose)));
  return { operationIds: matched.map(op => op.id), count: matched.length, amountMinor: matched.reduce((sum, op) => sum + op.amountMinor, 0) };
}
