import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const integrationUrl = new URL("../lib/integrations.ts", import.meta.url);
const financeRouteUrl = new URL("../app/api/finance/route.ts", import.meta.url);
const financeWorkspaceUrl = new URL("../app/components/FinanceWorkspace.tsx", import.meta.url);
const financeCssUrl = new URL("../app/components/FinanceWorkspace.ds.css", import.meta.url);

const marker = "D066_TOCHKA_FINANCE_BANK_VISIBILITY";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`D-066 patch target missing: ${label}`);
  return source.replace(before, after);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`D-066 block start missing: ${label}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`D-066 block end missing: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

export function patchD066Integrations(source) {
  if (source.includes(marker)) return source;
  const replacement = `async function normalizeTochkaTransaction(
  value: unknown,
  accountId: string,
  statementId: string,
): Promise<TochkaTransactionSnapshot | null> {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawProviderTransactionId = cleanText(row.transactionId ?? row.TransactionId, 210);
  const paymentId = cleanProviderId(String(row.paymentId ?? row.PaymentId ?? ""));
  const indicator = cleanText(row.creditDebitIndicator ?? row.CreditDebitIndicator, 20).toLowerCase();
  const direction = indicator === "credit" ? "Поступление" : indicator === "debit" ? "Списание" : "";
  const amountRow = (row.Amount ?? row.amount) as Record<string, unknown> | undefined;
  const amountMinor = toMinorUnits(amountRow?.amount ?? amountRow?.Amount);
  const currency = cleanCurrency(amountRow?.currency ?? amountRow?.Currency);
  const operationDate = cleanIsoDate(row.documentProcessDate ?? row.DocumentProcessDate ?? row.bookingDate ?? row.BookingDate);
  const status = cleanText(row.status ?? row.Status, 40);
  const documentNumber = cleanText(row.documentNumber ?? row.DocumentNumber, 80);
  const transactionType = cleanText(row.transactionTypeCode ?? row.TransactionTypeCode, 120);
  const description = cleanText(row.description ?? row.Description, 500);
  if (!direction || amountMinor === null || amountMinor <= 0 || !currency || !operationDate || !status) return null;

  const party = (direction === "Поступление"
    ? row.DebtorParty ?? row.debtorParty
    : row.CreditorParty ?? row.creditorParty) as Record<string, unknown> | undefined;
  const counterpartyName = cleanText(party?.name ?? party?.Name, 200);
  const counterpartyInn = cleanDigits(party?.inn ?? party?.Inn, 12);
  const counterpartyKpp = cleanDigits(party?.kpp ?? party?.Kpp, 9);
  const sourcePayloadHash = await sha256Text(JSON.stringify(row));

  // ${marker}: transactionId is optional in Tochka's TransactionModel. Keep the
  // provider id when it fits the local safe-id boundary; otherwise derive a
  // deterministic id from the immutable bank row. The statement id is omitted
  // deliberately so re-requesting the same period does not create duplicates.
  let providerTransactionId = "";
  if (rawProviderTransactionId) {
    providerTransactionId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawProviderTransactionId)
      ? rawProviderTransactionId
      : `TOCHKA-${(await sha256Text(rawProviderTransactionId)).slice(0, 48).toUpperCase()}`;
  } else {
    const discriminator = [paymentId, documentNumber, transactionType, description, counterpartyInn, counterpartyName]
      .filter(Boolean)
      .join("|");
    if (!discriminator) return null;
    providerTransactionId = `DERIVED-${(await sha256Text(`${accountId}|${operationDate}|${direction}|${amountMinor}|${currency}|${status}|${discriminator}|${sourcePayloadHash}`)).slice(0, 48).toUpperCase()}`;
  }

  const idHash = await sha256Text(`${accountId}|${providerTransactionId}`);
  return {
    id: `TOCHKA-TX-${idHash.slice(0, 32).toUpperCase()}`,
    providerTransactionId,
    paymentId,
    statementId,
    accountId,
    operationDate,
    direction,
    amountMinor,
    currency,
    status,
    documentNumber,
    transactionType,
    description,
    counterpartyName,
    counterpartyInn,
    counterpartyKpp,
    sourcePayloadHash,
  };
}

`;
  return replaceBlock(
    source,
    "async function normalizeTochkaTransaction(",
    "function cleanTochkaAccountId",
    replacement,
    "normalizeTochkaTransaction",
  );
}

export function patchD066FinanceRoute(source) {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(
    next,
    `  financeReconciliationIssues,\n  financialOperations,`,
    `  financeReconciliationIssues,\n  financialOperations,\n  bankAccounts,`,
    "finance schema import",
  );
  next = replaceOnce(
    next,
    `const [storedOperations, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([\n      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),`,
    `const [storedOperations, storedBankAccounts, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([\n      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),\n      db.select({\n        id: bankAccounts.id,\n        connectionId: bankAccounts.connectionId,\n        legalEntityId: bankAccounts.legalEntityId,\n        maskedAccount: bankAccounts.maskedAccount,\n        name: bankAccounts.name,\n        currency: bankAccounts.currency,\n        status: bankAccounts.status,\n        balanceMinor: bankAccounts.balanceMinor,\n        balanceAsOf: bankAccounts.balanceAsOf,\n        syncedAt: bankAccounts.syncedAt,\n      }).from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.maskedAccount)),`,
    "finance bank account query",
  );
  next = replaceOnce(
    next,
    `    const bankOperationCount = operations.filter((operation) => operation.sourceSystem === "BANK_TOCHKA_API").length;\n    const entityNames`,
    `    const bankOperationCount = operations.filter((operation) => operation.sourceSystem === "BANK_TOCHKA_API").length;\n    const bankAccountsView = storedBankAccounts.filter((account) => !account.connectionId.startsWith("TEST"));\n    const rubBankAccounts = bankAccountsView.filter((account) => account.currency === "RUB" && account.balanceMinor !== null);\n    const rubBalanceMinor = rubBankAccounts.reduce((sum, account) => sum + Number(account.balanceMinor ?? 0), 0);\n    const bankSummary = {\n      accountCount: bankAccountsView.length,\n      accountsWithBalance: bankAccountsView.filter((account) => account.balanceMinor !== null).length,\n      rubBalanceMinor,\n      latestSyncedAt: bankAccountsView.map((account) => account.syncedAt).filter(Boolean).sort().at(-1) ?? "",\n    };\n    // ${marker}: bank accounts and balances are first-class finance facts even\n    // when a selected statement contains zero booked operations.\n    const entityNames`,
    "finance bank summary",
  );
  next = replaceOnce(
    next,
    `    const openingBalanceMinor = 0;`,
    `    const openingBalanceMinor = bankSummary.accountsWithBalance ? bankSummary.rubBalanceMinor : 0;`,
    "forecast opening balance",
  );
  next = replaceOnce(
    next,
    `      operations,\n      accruals,`,
    `      operations,\n      bankAccounts: bankAccountsView,\n      bankSummary,\n      accruals,`,
    "finance response bank accounts",
  );
  next = replaceOnce(
    next,
    `        bank: bankOperationCount\n          ? \`Точка подключена · \${bankOperationCount} проведённых операций в реестре\`\n          : "Банковский источник не подключён",`,
    `        bank: bankSummary.accountCount\n          ? bankOperationCount\n            ? \`Точка подключена · \${bankSummary.accountCount} счетов · \${bankOperationCount} проведённых операций в реестре\`\n            : \`Точка подключена · \${bankSummary.accountCount} счетов · остатки загружены, операций за выбранный период пока нет\`\n          : "Банковский источник не подключён",`,
    "finance source policy",
  );
  return next;
}

export function patchD066FinanceWorkspace(source) {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(
    next,
    `type FinanceData = {`,
    `type FinanceBankAccount = {\n  id: string;\n  connectionId: string;\n  legalEntityId: string;\n  maskedAccount: string;\n  name: string;\n  currency: string;\n  status: string;\n  balanceMinor: number | null;\n  balanceAsOf: string;\n  syncedAt: string;\n};\n\ntype FinanceData = {`,
    "finance bank account type",
  );
  next = replaceOnce(
    next,
    `  operations: FinanceOperation[];\n  accruals:`,
    `  operations: FinanceOperation[];\n  bankAccounts: FinanceBankAccount[];\n  bankSummary: { accountCount: number; accountsWithBalance: number; rubBalanceMinor: number; latestSyncedAt: string };\n  accruals:`,
    "finance data bank fields",
  );
  next = replaceOnce(
    next,
    `const rubles = (minor: number) => rub.format(minor / 100);\nconst signedRubles`,
    `const rubles = (minor: number) => rub.format(minor / 100);\nconst bankMoney = (minor: number | null, currency: string) => {\n  if (minor === null) return "Остаток не передан";\n  try {\n    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);\n  } catch {\n    return \`\${(minor / 100).toLocaleString("ru-RU")} \${currency}\`;\n  }\n};\nconst signedRubles`,
    "bank money formatter",
  );
  const kpis = `      <div className="ahFinanceKpis">\n        <KpiCard label={\`Остаток на счетах · \${data.bankSummary.accountCount}\`} value={rubles(data.bankSummary.rubBalanceMinor)} note={data.bankSummary.accountsWithBalance ? "по последним выпискам Точки" : "остатки ещё не получены"} onClick={() => setTab("register")} />\n        <KpiCard label={\`Поступления · \${financePeriodLabel(period)}\`} value={rubles(data.summary.receiptsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />\n        <KpiCard label="Списания" value={rubles(data.summary.outflowsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />\n        <KpiCard label="Чистый денежный поток" value={signedRubles(data.summary.netMinor)} note={data.checks.length ? "контрольная модель рассчитана" : "проверок пока нет"} onClick={() => setTab("cashflow")} className={data.summary.netMinor < 0 ? "ahFinanceKpiRisk" : undefined} />\n        <KpiCard label="Задолженность по оплатам" value={rubles(data.summary.debtMinor)} note={\`обезличено · \${data.accruals.reduce((sum, row) => sum + row.debtCases, 0)} случаев\`} onClick={() => setTab("debts")} className={data.summary.debtMinor > 0 ? "ahFinanceKpiWarning" : undefined} />\n      </div>\n\n      {data.bankAccounts.length ? (\n        <section className="finance-panel ahFinanceBankPanel" data-d066-marker="${marker}">\n          <div className="finance-panel-head">\n            <div><p>Банк · факт</p><h2>Счета Точки и текущие остатки</h2></div>\n            <span className="source-pill">{data.bankAccounts.length} счетов · синхронизировано</span>\n          </div>\n          <div className="ahFinanceBankGrid">\n            {data.bankAccounts.map((account) => (\n              <article key={account.id} className="ahFinanceBankAccount">\n                <div><strong>{account.name || "Расчётный счёт"}</strong><span>{account.maskedAccount} · {account.currency}</span></div>\n                <b>{bankMoney(account.balanceMinor, account.currency)}</b>\n                <small>{account.balanceAsOf ? \`Остаток на \${new Date(\`\${account.balanceAsOf}T00:00:00Z\`).toLocaleDateString("ru-RU")}\` : "Дата остатка не передана"}</small>\n              </article>\n            ))}\n          </div>\n        </section>\n      ) : null}`;
  const oldKpis = `      <div className="ahFinanceKpis">\n        <KpiCard label={\`Поступления · \${financePeriodLabel(period)}\`} value={rubles(data.summary.receiptsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />\n        <KpiCard label="Списания" value={rubles(data.summary.outflowsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />\n        <KpiCard label="Чистый денежный поток" value={signedRubles(data.summary.netMinor)} note={data.checks.length ? "контрольная модель рассчитана" : "проверок пока нет"} onClick={() => setTab("cashflow")} className={data.summary.netMinor < 0 ? "ahFinanceKpiRisk" : undefined} />\n        <KpiCard label="Задолженность по оплатам" value={rubles(data.summary.debtMinor)} note={\`обезличено · \${data.accruals.reduce((sum, row) => sum + row.debtCases, 0)} случаев\`} onClick={() => setTab("debts")} className={data.summary.debtMinor > 0 ? "ahFinanceKpiWarning" : undefined} />\n      </div>`;
  next = replaceOnce(next, oldKpis, kpis, "finance KPI and bank account panel");
  return next;
}

export function patchD066FinanceCss(source) {
  if (source.includes(marker)) return source;
  let next = replaceOnce(
    source,
    `  grid-template-columns: repeat(4, minmax(0, 1fr));`,
    `  grid-template-columns: repeat(5, minmax(0, 1fr));`,
    "finance KPI desktop grid",
  );
  const styles = `\n/* ${marker} */\n.ahFinanceBankPanel {\n  display: grid;\n  gap: 0;\n}\n\n.ahFinanceBankGrid {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 10px;\n  border-top: 1px solid var(--ah-color-border);\n  padding: 12px 14px 14px;\n}\n\n.ahFinanceBankAccount {\n  display: grid;\n  gap: 8px;\n  min-width: 0;\n  border: 1px solid var(--ah-color-border);\n  border-radius: 14px;\n  background: var(--ah-color-surface-soft);\n  padding: 12px;\n}\n\n.ahFinanceBankAccount > div { display: grid; gap: 2px; min-width: 0; }\n.ahFinanceBankAccount strong { font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }\n.ahFinanceBankAccount span,\n.ahFinanceBankAccount small { color: var(--ah-color-text-secondary); font-size: 11px; line-height: 16px; }\n.ahFinanceBankAccount b { font-size: 18px; line-height: 22px; font-weight: 720; }\n\n@media (max-width: 1024px) {\n  .ahFinanceBankGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n}\n\n@media (max-width: 767px) {\n  .ahFinanceBankGrid { grid-template-columns: 1fr; padding: 10px 12px 12px; }\n  .ahFinanceBankAccount { padding: 12px; }\n}\n`;
  return next + styles;
}

export async function applyD066() {
  const [integrationSource, routeSource, workspaceSource, cssSource] = await Promise.all([
    readFile(integrationUrl, "utf8"),
    readFile(financeRouteUrl, "utf8"),
    readFile(financeWorkspaceUrl, "utf8"),
    readFile(financeCssUrl, "utf8"),
  ]);
  const outputs = [
    [integrationUrl, patchD066Integrations(integrationSource), integrationSource],
    [financeRouteUrl, patchD066FinanceRoute(routeSource), routeSource],
    [financeWorkspaceUrl, patchD066FinanceWorkspace(workspaceSource), workspaceSource],
    [financeCssUrl, patchD066FinanceCss(cssSource), cssSource],
  ];
  for (const [url, patched, original] of outputs) {
    if (patched !== original) await writeFile(url, patched, "utf8");
  }
  return outputs.some(([, patched, original]) => patched !== original);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const changed = await applyD066();
  console.log(changed ? "D-066 bank finance visibility applied" : "D-066 already present");
}
