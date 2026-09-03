import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const integrationUrl = new URL("../lib/integrations.ts", import.meta.url);
const financeRouteUrl = new URL("../app/api/finance/route.ts", import.meta.url);
const financeWorkspaceUrl = new URL("../app/components/FinanceWorkspace.tsx", import.meta.url);
const financeCssUrl = new URL("../app/components/FinanceWorkspace.ds.css", import.meta.url);
const marker = "D066_TOCHKA_FINANCE_BANK_VISIBILITY";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`D-066 target missing: ${label}`);
  return source.replace(before, after);
}

export function patchD066Integrations(source) {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(
    next,
    '  const providerTransactionId = cleanProviderId(String(row.transactionId ?? row.TransactionId ?? ""));',
    '  const rawProviderTransactionId = cleanText(row.transactionId ?? row.TransactionId, 210);',
    "raw transaction id",
  );
  next = replaceOnce(
    next,
    '  if (!providerTransactionId || !direction || amountMinor === null || amountMinor <= 0 || !currency || !operationDate || !status) return null;',
    '  if (!direction || amountMinor === null || amountMinor <= 0 || !currency || !operationDate || !status) return null;',
    "transaction validation",
  );
  const anchor = '  const sourcePayloadHash = await sha256Text(JSON.stringify(row));\n  const idHash = await sha256Text(`${accountId}|${providerTransactionId}`);';
  const injected = [
    '  const sourcePayloadHash = await sha256Text(JSON.stringify(row));',
    `  // ${marker}: transactionId is optional in Tochka TransactionModel.`,
    '  // Preserve a safe provider id when present; otherwise derive a stable id',
    '  // from bank facts without including statementId, so resync stays idempotent.',
    '  let providerTransactionId = "";',
    '  if (rawProviderTransactionId) {',
    '    providerTransactionId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawProviderTransactionId)',
    '      ? rawProviderTransactionId',
    '      : `TOCHKA-${(await sha256Text(rawProviderTransactionId)).slice(0, 48).toUpperCase()}`;',
    '  } else {',
    '    const discriminator = [paymentId, documentNumber, transactionType, description, counterpartyInn, counterpartyName]',
    '      .filter(Boolean)',
    '      .join("|");',
    '    if (!discriminator) return null;',
    '    const fallbackSeed = [accountId, operationDate, direction, String(amountMinor), currency, status, discriminator, sourcePayloadHash].join("|");',
    '    providerTransactionId = `DERIVED-${(await sha256Text(fallbackSeed)).slice(0, 48).toUpperCase()}`;',
    '  }',
    '  const idHash = await sha256Text(`${accountId}|${providerTransactionId}`);',
  ].join("\n");
  next = replaceOnce(next, anchor, injected, "derived transaction id");
  return next;
}

export function patchD066FinanceRoute(source) {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(
    next,
    '  financeReconciliationIssues,\n  financialOperations,',
    '  financeReconciliationIssues,\n  financialOperations,\n  bankAccounts,',
    "bankAccounts import",
  );
  next = replaceOnce(
    next,
    'const [storedOperations, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([\n      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),',
    [
      'const [storedOperations, storedBankAccounts, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([',
      '      db.select().from(financialOperations).orderBy(desc(financialOperations.operationDate), asc(financialOperations.id)),',
      '      db.select({',
      '        id: bankAccounts.id,',
      '        connectionId: bankAccounts.connectionId,',
      '        legalEntityId: bankAccounts.legalEntityId,',
      '        maskedAccount: bankAccounts.maskedAccount,',
      '        name: bankAccounts.name,',
      '        currency: bankAccounts.currency,',
      '        status: bankAccounts.status,',
      '        balanceMinor: bankAccounts.balanceMinor,',
      '        balanceAsOf: bankAccounts.balanceAsOf,',
      '        syncedAt: bankAccounts.syncedAt,',
      '      }).from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.maskedAccount)),',
    ].join("\n"),
    "bank account query",
  );
  next = replaceOnce(
    next,
    '    const bankOperationCount = operations.filter((operation) => operation.sourceSystem === "BANK_TOCHKA_API").length;\n    const entityNames',
    [
      '    const bankOperationCount = operations.filter((operation) => operation.sourceSystem === "BANK_TOCHKA_API").length;',
      '    const bankAccountsView = storedBankAccounts.filter((account) => !account.connectionId.startsWith("TEST"));',
      '    const rubBankAccounts = bankAccountsView.filter((account) => account.currency === "RUB" && account.balanceMinor !== null);',
      '    const rubBalanceMinor = rubBankAccounts.reduce((sum, account) => sum + Number(account.balanceMinor ?? 0), 0);',
      '    const bankSummary = {',
      '      accountCount: bankAccountsView.length,',
      '      accountsWithBalance: bankAccountsView.filter((account) => account.balanceMinor !== null).length,',
      '      rubBalanceMinor,',
      '      latestSyncedAt: bankAccountsView.map((account) => account.syncedAt).filter(Boolean).sort().at(-1) ?? "",',
      '    };',
      `    // ${marker}: stored bank accounts are finance facts even with zero operations.`,
      '    const entityNames',
    ].join("\n"),
    "bank summary",
  );
  next = replaceOnce(next, '    const openingBalanceMinor = 0;', '    const openingBalanceMinor = bankSummary.accountsWithBalance ? bankSummary.rubBalanceMinor : 0;', "opening bank balance");
  next = replaceOnce(next, '      operations,\n      accruals,', '      operations,\n      bankAccounts: bankAccountsView,\n      bankSummary,\n      accruals,', "bank response fields");
  next = replaceOnce(
    next,
    '        bank: bankOperationCount\n          ? `Точка подключена · ${bankOperationCount} проведённых операций в реестре`\n          : "Банковский источник не подключён",',
    [
      '        bank: bankSummary.accountCount',
      '          ? bankOperationCount',
      '            ? `Точка подключена · ${bankSummary.accountCount} счетов · ${bankOperationCount} проведённых операций в реестре`',
      '            : `Точка подключена · ${bankSummary.accountCount} счетов · остатки загружены, операций за выбранный период пока нет`',
      '          : "Банковский источник не подключён",',
    ].join("\n"),
    "bank source policy",
  );
  return next;
}

export function patchD066FinanceWorkspace(source) {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(
    next,
    'type FinanceData = {',
    [
      'type FinanceBankAccount = {',
      '  id: string;',
      '  connectionId: string;',
      '  legalEntityId: string;',
      '  maskedAccount: string;',
      '  name: string;',
      '  currency: string;',
      '  status: string;',
      '  balanceMinor: number | null;',
      '  balanceAsOf: string;',
      '  syncedAt: string;',
      '};',
      '',
      'type FinanceData = {',
    ].join("\n"),
    "bank account UI type",
  );
  next = replaceOnce(
    next,
    '  operations: FinanceOperation[];\n  accruals:',
    '  operations: FinanceOperation[];\n  bankAccounts: FinanceBankAccount[];\n  bankSummary: { accountCount: number; accountsWithBalance: number; rubBalanceMinor: number; latestSyncedAt: string };\n  accruals:',
    "bank fields UI",
  );
  next = replaceOnce(
    next,
    'const rubles = (minor: number) => rub.format(minor / 100);\nconst signedRubles',
    [
      'const rubles = (minor: number) => rub.format(minor / 100);',
      'const bankMoney = (minor: number | null, currency: string) => {',
      '  if (minor === null) return "Остаток не передан";',
      '  try {',
      '    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);',
      '  } catch {',
      '    return `${(minor / 100).toLocaleString("ru-RU")} ${currency}`;',
      '  }',
      '};',
      'const signedRubles',
    ].join("\n"),
    "bank money formatter",
  );
  const oldKpis = [
    '      <div className="ahFinanceKpis">',
    '        <KpiCard label={`Поступления · ${financePeriodLabel(period)}`} value={rubles(data.summary.receiptsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />',
    '        <KpiCard label="Списания" value={rubles(data.summary.outflowsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />',
    '        <KpiCard label="Чистый денежный поток" value={signedRubles(data.summary.netMinor)} note={data.checks.length ? "контрольная модель рассчитана" : "проверок пока нет"} onClick={() => setTab("cashflow")} className={data.summary.netMinor < 0 ? "ahFinanceKpiRisk" : undefined} />',
    '        <KpiCard label="Задолженность по оплатам" value={rubles(data.summary.debtMinor)} note={`обезличено · ${data.accruals.reduce((sum, row) => sum + row.debtCases, 0)} случаев`} onClick={() => setTab("debts")} className={data.summary.debtMinor > 0 ? "ahFinanceKpiWarning" : undefined} />',
    '      </div>',
  ].join("\n");
  const bankPanel = [
    '      <div className="ahFinanceKpis">',
    '        <KpiCard label={`Остаток на счетах · ${data.bankSummary.accountCount}`} value={rubles(data.bankSummary.rubBalanceMinor)} note={data.bankSummary.accountsWithBalance ? "по последним выпискам Точки" : "остатки ещё не получены"} onClick={() => setTab("register")} />',
    '        <KpiCard label={`Поступления · ${financePeriodLabel(period)}`} value={rubles(data.summary.receiptsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />',
    '        <KpiCard label="Списания" value={rubles(data.summary.outflowsMinor)} note="сверено с ОДДС" onClick={() => setTab("cashflow")} />',
    '        <KpiCard label="Чистый денежный поток" value={signedRubles(data.summary.netMinor)} note={data.checks.length ? "контрольная модель рассчитана" : "проверок пока нет"} onClick={() => setTab("cashflow")} className={data.summary.netMinor < 0 ? "ahFinanceKpiRisk" : undefined} />',
    '        <KpiCard label="Задолженность по оплатам" value={rubles(data.summary.debtMinor)} note={`обезличено · ${data.accruals.reduce((sum, row) => sum + row.debtCases, 0)} случаев`} onClick={() => setTab("debts")} className={data.summary.debtMinor > 0 ? "ahFinanceKpiWarning" : undefined} />',
    '      </div>',
    '',
    '      {data.bankAccounts.length ? (',
    `        <section className="finance-panel ahFinanceBankPanel" data-d066-marker="${marker}">`,
    '          <div className="finance-panel-head">',
    '            <div><p>Банк · факт</p><h2>Счета Точки и текущие остатки</h2></div>',
    '            <span className="source-pill">{data.bankAccounts.length} счетов · синхронизировано</span>',
    '          </div>',
    '          <div className="ahFinanceBankGrid">',
    '            {data.bankAccounts.map((account) => (',
    '              <article key={account.id} className="ahFinanceBankAccount">',
    '                <div><strong>{account.name || "Расчётный счёт"}</strong><span>{account.maskedAccount} · {account.currency}</span></div>',
    '                <b>{bankMoney(account.balanceMinor, account.currency)}</b>',
    '                <small>{account.balanceAsOf ? `Остаток на ${new Date(`${account.balanceAsOf}T00:00:00Z`).toLocaleDateString("ru-RU")}` : "Дата остатка не передана"}</small>',
    '              </article>',
    '            ))}',
    '          </div>',
    '        </section>',
    '      ) : null}',
  ].join("\n");
  next = replaceOnce(next, oldKpis, bankPanel, "bank finance panel");
  return next;
}

export function patchD066FinanceCss(source) {
  if (source.includes(marker)) return source;
  let next = replaceOnce(source, '  grid-template-columns: repeat(4, minmax(0, 1fr));', '  grid-template-columns: repeat(5, minmax(0, 1fr));', "desktop KPI grid");
  next += [
    '',
    `/* ${marker} */`,
    '.ahFinanceBankPanel { display: grid; gap: 0; }',
    '.ahFinanceBankGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; border-top: 1px solid var(--ah-color-border); padding: 12px 14px 14px; }',
    '.ahFinanceBankAccount { display: grid; gap: 8px; min-width: 0; border: 1px solid var(--ah-color-border); border-radius: 14px; background: var(--ah-color-surface-soft); padding: 12px; }',
    '.ahFinanceBankAccount > div { display: grid; gap: 2px; min-width: 0; }',
    '.ahFinanceBankAccount strong { font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }',
    '.ahFinanceBankAccount span, .ahFinanceBankAccount small { color: var(--ah-color-text-secondary); font-size: 11px; line-height: 16px; }',
    '.ahFinanceBankAccount b { font-size: 18px; line-height: 22px; font-weight: 720; }',
    '@media (max-width: 1024px) { .ahFinanceBankGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
    '@media (max-width: 767px) { .ahFinanceBankGrid { grid-template-columns: 1fr; padding: 10px 12px 12px; } .ahFinanceBankAccount { padding: 12px; } }',
    '',
  ].join("\n");
  return next;
}

export async function applyD066() {
  const [a, b, c, d] = await Promise.all([
    readFile(integrationUrl, "utf8"), readFile(financeRouteUrl, "utf8"),
    readFile(financeWorkspaceUrl, "utf8"), readFile(financeCssUrl, "utf8"),
  ]);
  const outputs = [
    [integrationUrl, a, patchD066Integrations(a)],
    [financeRouteUrl, b, patchD066FinanceRoute(b)],
    [financeWorkspaceUrl, c, patchD066FinanceWorkspace(c)],
    [financeCssUrl, d, patchD066FinanceCss(d)],
  ];
  for (const [url, original, patched] of outputs) if (patched !== original) await writeFile(url, patched, "utf8");
  return outputs.some(([, original, patched]) => original !== patched);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log((await applyD066()) ? "D-066 bank finance visibility applied" : "D-066 already present");
}
