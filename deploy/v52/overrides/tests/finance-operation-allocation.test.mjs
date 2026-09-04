import test from "node:test";
import assert from "node:assert/strict";
import {
  patchSchema,
  patchDb,
  patchFinanceRoute,
  patchFinanceActions,
  patchFinanceWorkspace,
  patchFinanceCss,
} from "../scripts/patch-finance-operation-allocation.mjs";

test("D-069 adds management allocation fields without touching immutable bank facts", () => {
  const schema = `export const financialOperations = sqliteTable("financial_operations", {
  dataQuality: text("data_quality").notNull(),
  status: text("status").notNull().default("Разнесено"),
  createdBy: text("created_by").notNull(),
});`;
  const out = patchSchema(schema);
  assert.match(out, /cashflowArticle: text\("cashflow_article"\)/);
  assert.match(out, /pnlArticle: text\("pnl_article"\)/);
  assert.match(out, /accrualPeriod: text\("accrual_period"\)/);
  assert.match(out, /counterpartyLabel: text\("counterparty_label"\)/);
  assert.match(out, /managementPurpose: text\("management_purpose"\)/);
  assert.doesNotMatch(out, /bank_transactions.*ALTER/i);
});

test("D-069 migration is additive and backfills only prior classifications", () => {
  const source = `async function boot() {
  await initializeCoreTables();
  await migrateLegacyAlfaBankIntegration();
}
async function migrateLegacyAlfaBankIntegration() {}`;
  const out = patchDb(source);
  assert.match(out, /PRAGMA table_info\(financial_operations\)/);
  assert.match(out, /ALTER TABLE financial_operations ADD COLUMN/);
  assert.match(out, /category<>'Не классифицировано'/);
  assert.doesNotMatch(out, /DROP TABLE|DELETE FROM financial_operations/i);
});

test("D-069 finance API joins raw bank descriptions and separates cash from accrual projection", () => {
  const source = `import {
  financialOperations,
  bankAccounts,
} from "../../../db/schema";
async function x() {
const [storedOperations, storedBankAccounts, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([
      db.select().from(financialOperations),
      db.select({
      }).from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.maskedAccount)),
      db.select().from(financeAccruals).orderBy(desc(financeAccruals.period), asc(financeAccruals.contour)),
]);
    const sourceOnly = true;
    const operations = sourceOnly
      ? storedOperations.filter((operation) => !operation.sourceSystem.startsWith("SYNTHETIC"))
      : storedOperations;
    const budgets = sourceOnly ? [] : storedBudgets;
    const periods = [...new Set([
      ...operations.map((operation) => operation.period),
    ])];
    const cash = summarizeCash(operations, selectedPeriod);
    const pnl = summarizePnl(operations, budgets, selectedPeriod);
      const periodCash = summarizeCash(operations, period);
      const periodPnl = summarizePnl(operations, budgets, period);
    operations.filter((operation) => operation.period === selectedPeriod).forEach((operation) => {
    });
    return Response.json({
      selectedPeriod,
      operations,
      bankAccounts: bankAccountsView,
    });
}`;
  const out = patchFinanceRoute(source);
  assert.match(out, /bankTransactions/);
  assert.match(out, /description: bankTransactions\.description/);
  assert.match(out, /counterpartyName: bankTransactions\.counterpartyName/);
  assert.match(out, /const cashOperations/);
  assert.match(out, /const pnlOperations/);
  assert.match(out, /period: operation\.accrualPeriod \|\| operation\.period/);
  assert.match(out, /articleSuggestions/);
});

test("D-069 classification action updates only management projection and audits it", () => {
  const source = `async function x() {
    if (action === "addCorrection") return addCorrection(actor, body);
}
async function addCorrection(actor: string, body: Record<string, unknown>) {}`;
  const out = patchFinanceActions(source);
  assert.match(out, /action === "classifyOperation"/);
  assert.match(out, /cashflowArticle/);
  assert.match(out, /pnlArticle/);
  assert.match(out, /accrualPeriod/);
  assert.match(out, /finance\.operation_classified/);
  assert.match(out, /immutableBankFact: true/);
  assert.doesNotMatch(out, /operationDate:|amountMinor:|direction:/);
});

test("D-069 UI exposes who, purpose, DDS article, P&L article and accrual period", () => {
  const source = [
    '"use client";',
    'type FinanceOperation = {',
    '  dataQuality: string;',
    '  status: string;',
    '};',
    'type FinanceData = {',
    '  operations: FinanceOperation[];',
    '  bankAccounts: X[];',
    '};',
    'type Tab = "register" | "cashflow" | "pnl" | "plan" | "debts" | "reconciliation";',
    'function X() {',
    '  const [correctionOpen, setCorrectionOpen] = useState(false);',
    '  const openOperation = useCallback((operation: FinanceOperation) => {',
    '    setLinkedEntityId(null);',
    '    setCorrectionOpen(false);',
    '    setSelected(operation);',
    '  }, []);',
    '  const filteredOperations = data.operations',
    '      .filter((operation) => !normalized || [operation.id, operation.category, operation.counterpartyEntityId, operation.contractId, operation.documentId, operation.bankOperationRef].some((value) => value.toLocaleLowerCase("ru").includes(normalized)));',
    '  async function submitCorrection(event: FormEvent) {}',
    '  return <>',
    '<div className="finance-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, статья, договор, документ…" aria-label="Поиск финансовых операций" /><select value={direction} onChange={(event) => setDirection(event.target.value)}><option>Все направления</option><option>Поступление</option><option>Списание</option></select><span>Суммы хранятся в копейках · исходник неизменяем</span></div>',
    '{filteredOperations.map((operation) => <tr key={operation.id} tabIndex={0} aria-label={`Открыть ${recordLabel("операцию", operation.id)}`} onClick={() => openOperation(operation)} onKeyDown={(event) => handleOperationKey(event, operation)}><td><strong>{recordLabel("Операция", operation.id)}</strong><small>{operation.sourceFile || "Финансовый реестр"}</small></td><td>{new Date(`${operation.operationDate}T00:00:00Z`).toLocaleDateString("ru-RU")}</td><td><span className={`direction-chip ${operation.direction === "Поступление" ? "in" : "out"}`}>{operation.direction}</span></td><td><strong>{operation.category}</strong><small>{operation.reportClass}</small></td><td><strong>{data.entityNames[operation.counterpartyEntityId] ?? recordLabel(counterpartyLabel(operation.counterpartyEntityId), operation.counterpartyEntityId)}</strong><small>{operation.contractId ? recordLabel("Договор", operation.contractId) : "Без договора"}</small></td><td className="money-cell">{operation.direction === "Поступление" ? "+" : "−"}{rubles(operation.amountMinor)}</td><td><span className={operation.status === "Разнесено" ? "quality-ok" : "quality-warn"}>{operation.status}</span></td></tr>)}',
    '<section className="operation-corrections"></section>',
    '</>;',
    '}',
  ].join("\n");
  const out = patchFinanceWorkspace(source);
  assert.match(out, />Кто</);
  assert.match(out, />За что</);
  assert.match(out, />Статья ДДС</);
  assert.match(out, />Статья ОПиУ</);
  assert.match(out, />Период ОПиУ</);
  assert.match(out, /bankDetails\?\.description/);
  assert.match(out, /classifyOperation/);
  assert.match(out, /Банковский факт неизменяем/);
});

test("D-069 CSS keeps classification form mobile-safe", () => {
  const out = patchFinanceCss(".base{}");
  assert.match(out, /\.operation-classification-form/);
  assert.match(out, /max-width: 767px/);
  assert.match(out, /font-size: 16px/);
});
