import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const schemaUrl = new URL("../db/schema.ts", import.meta.url);
const dbUrl = new URL("../db/index.ts", import.meta.url);
const financeRouteUrl = new URL("../app/api/finance/route.ts", import.meta.url);
const financeActionsUrl = new URL("../app/api/finance-actions/route.ts", import.meta.url);
const financeWorkspaceUrl = new URL("../app/components/FinanceWorkspace.tsx", import.meta.url);
const financeCssUrl = new URL("../app/components/FinanceWorkspace.ds.css", import.meta.url);
const marker = "D069_FINANCE_OPERATION_ALLOCATION";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`D-069 target missing: ${label}`);
  return source.replace(before, after);
}

export function patchSchema(source) {
  if (source.includes(marker)) return source;
  const before = `  dataQuality: text("data_quality").notNull(),
  status: text("status").notNull().default("Разнесено"),
  createdBy: text("created_by").notNull(),`;
  const after = `  dataQuality: text("data_quality").notNull(),
  // ${marker}: editable management allocation; immutable bank fact remains in bank_transactions.
  cashflowArticle: text("cashflow_article").notNull().default(""),
  pnlArticle: text("pnl_article").notNull().default(""),
  accrualPeriod: text("accrual_period").notNull().default(""),
  counterpartyLabel: text("counterparty_label").notNull().default(""),
  managementPurpose: text("management_purpose").notNull().default(""),
  status: text("status").notNull().default("Разнесено"),
  createdBy: text("created_by").notNull(),`;
  return replaceOnce(source, before, after, "financial operation management columns");
}

export function patchDb(source) {
  if (source.includes(marker)) return source;
  let next = replaceOnce(
    source,
    "  await initializeCoreTables();\n  await migrateLegacyAlfaBankIntegration();",
    `  await initializeCoreTables();
  await ensureFinanceOperationAllocationColumns();
  await migrateLegacyAlfaBankIntegration();`,
    "classification migration call",
  );
  const anchor = "async function migrateLegacyAlfaBankIntegration() {";
  const helper = `// ${marker}
async function ensureFinanceOperationAllocationColumns() {
  const info = await env.DB.prepare("PRAGMA table_info(financial_operations)").all<{ name: string }>();
  const existing = new Set((info.results ?? []).map((row) => row.name));
  const additions = [
    ["cashflow_article", "TEXT NOT NULL DEFAULT ''"],
    ["pnl_article", "TEXT NOT NULL DEFAULT ''"],
    ["accrual_period", "TEXT NOT NULL DEFAULT ''"],
    ["counterparty_label", "TEXT NOT NULL DEFAULT ''"],
    ["management_purpose", "TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, ddl] of additions) {
    if (!existing.has(name)) await env.DB.prepare(\`ALTER TABLE financial_operations ADD COLUMN \${name} \${ddl}\`).run();
  }
  await env.DB.prepare(\`UPDATE financial_operations
    SET cashflow_article=category
    WHERE cashflow_article='' AND category<>'' AND category<>'Не классифицировано'\`).run();
}

`;
  next = replaceOnce(next, anchor, helper + anchor, "classification migration helper");
  return next;
}

export function patchFinanceRoute(source) {
  if (source.includes(marker)) return source;
  let next = replaceOnce(
    source,
    "  financialOperations,\n  bankAccounts,",
    "  financialOperations,\n  bankAccounts,\n  bankTransactions,",
    "bankTransactions import",
  );
  next = replaceOnce(
    next,
    "const [storedOperations, storedBankAccounts, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([",
    "const [storedOperations, storedBankAccounts, storedBankTransactions, accruals, storedBudgets, storedForecasts, payroll, corrections, issues, entityRows, lifecycles, allTasks] = await Promise.all([",
    "finance query tuple",
  );
  next = replaceOnce(
    next,
    `      }).from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.maskedAccount)),
      db.select().from(financeAccruals).orderBy(desc(financeAccruals.period), asc(financeAccruals.contour)),`,
    `      }).from(bankAccounts).orderBy(asc(bankAccounts.legalEntityId), asc(bankAccounts.maskedAccount)),
      db.select({
        financialOperationId: bankTransactions.financialOperationId,
        operationDate: bankTransactions.operationDate,
        direction: bankTransactions.direction,
        amountMinor: bankTransactions.amountMinor,
        currency: bankTransactions.currency,
        documentNumber: bankTransactions.documentNumber,
        transactionType: bankTransactions.transactionType,
        description: bankTransactions.description,
        counterpartyName: bankTransactions.counterpartyName,
        counterpartyInn: bankTransactions.counterpartyInn,
        counterpartyKpp: bankTransactions.counterpartyKpp,
        importedAt: bankTransactions.importedAt,
      }).from(bankTransactions),
      db.select().from(financeAccruals).orderBy(desc(financeAccruals.period), asc(financeAccruals.contour)),`,
    "bank transaction query",
  );
  next = replaceOnce(
    next,
    `    const operations = sourceOnly
      ? storedOperations.filter((operation) => !operation.sourceSystem.startsWith("SYNTHETIC"))
      : storedOperations;
    const budgets = sourceOnly ? [] : storedBudgets;`,
    `    const bankDetailsByOperation = new Map(
      storedBankTransactions.filter((transaction) => transaction.financialOperationId).map((transaction) => [transaction.financialOperationId, transaction]),
    );
    const operations = (sourceOnly
      ? storedOperations.filter((operation) => !operation.sourceSystem.startsWith("SYNTHETIC"))
      : storedOperations).map((operation) => ({
        ...operation,
        bankDetails: bankDetailsByOperation.get(operation.id) ?? null,
      }));
    const cashOperations = operations.map((operation) => ({
      ...operation,
      category: operation.cashflowArticle || operation.category,
    }));
    const pnlOperations = operations.map((operation) => ({
      ...operation,
      period: operation.accrualPeriod || operation.period,
      category: operation.pnlArticle || operation.cashflowArticle || operation.category,
    }));
    const budgets = sourceOnly ? [] : storedBudgets;`,
    "effective finance projections",
  );
  next = replaceOnce(
    next,
    "      ...operations.map((operation) => operation.period),",
    "      ...operations.flatMap((operation) => [operation.period, operation.accrualPeriod]),",
    "reporting periods",
  );
  next = replaceOnce(next, "    const cash = summarizeCash(operations, selectedPeriod);", "    const cash = summarizeCash(cashOperations, selectedPeriod);", "cash effective operations");
  next = replaceOnce(next, "    const pnl = summarizePnl(operations, budgets, selectedPeriod);", "    const pnl = summarizePnl(pnlOperations, budgets, selectedPeriod);", "pnl effective operations");
  next = replaceOnce(
    next,
    `      const periodCash = summarizeCash(operations, period);
      const periodPnl = summarizePnl(operations, budgets, period);`,
    `      const periodCash = summarizeCash(cashOperations, period);
      const periodPnl = summarizePnl(pnlOperations, budgets, period);`,
    "monthly effective operations",
  );
  next = replaceOnce(
    next,
    "    operations.filter((operation) => operation.period === selectedPeriod).forEach((operation) => {",
    "    pnlOperations.filter((operation) => operation.period === selectedPeriod).forEach((operation) => {",
    "pnl grouping",
  );
  next = replaceOnce(
    next,
    "    return Response.json({\n      selectedPeriod,",
    `    const articleSuggestions = [...new Set(operations.flatMap((operation) => [
      operation.cashflowArticle,
      operation.pnlArticle,
      operation.category,
    ]).filter((value) => value && value !== "Не классифицировано"))].sort((left, right) => left.localeCompare(right, "ru"));
    // ${marker}: raw bank fields are exposed read-only; allocations are explicit projection fields.
    return Response.json({
      selectedPeriod,`,
    "article suggestions",
  );
  next = replaceOnce(
    next,
    "      operations,\n      bankAccounts: bankAccountsView,",
    "      operations,\n      articleSuggestions,\n      bankAccounts: bankAccountsView,",
    "article suggestions response",
  );
  return next;
}

export function patchFinanceActions(source) {
  if (source.includes(marker)) return source;
  let next = replaceOnce(
    source,
    '    if (action === "addCorrection") return addCorrection(actor, body);',
    `    if (action === "classifyOperation") return classifyOperation(actor, body);
    if (action === "addCorrection") return addCorrection(actor, body);`,
    "classify dispatch",
  );
  const anchor = "async function addCorrection(actor: string, body: Record<string, unknown>) {";
  const implementation = `// ${marker}: financial_operations is the management projection; bank_transactions remains immutable.
async function classifyOperation(actor: string, body: Record<string, unknown>) {
  const operationId = clean(body.operationId, 80);
  const cashflowArticle = clean(body.cashflowArticle, 160);
  const pnlArticle = clean(body.pnlArticle, 160);
  const reportClass = clean(body.reportClass, 80) || "Не включено в ОПиУ";
  const accrualPeriod = clean(body.accrualPeriod, 7);
  const counterpartyLabel = clean(body.counterpartyLabel, 240);
  const managementPurpose = clean(body.managementPurpose, 500);
  const contractId = clean(body.contractId, 120);
  const documentId = clean(body.documentId, 120);
  const projectEntityId = clean(body.projectEntityId, 120);
  const objectEntityId = clean(body.objectEntityId, 120);
  const cfrEntityId = clean(body.cfrEntityId, 120);
  const allowedReportClasses = new Set(["Доходы ОПиУ", "Расходы ОПиУ", "Финансирование", "Не включено в ОПиУ"]);
  if (!operationId || !cashflowArticle) {
    return Response.json({ error: "Укажите статью ДДС" }, { status: 400 });
  }
  if (!allowedReportClasses.has(reportClass)) {
    return Response.json({ error: "Выберите корректный класс ОПиУ" }, { status: 400 });
  }
  const affectsPnl = reportClass === "Доходы ОПиУ" || reportClass === "Расходы ОПиУ";
  if (affectsPnl && (!pnlArticle || !/^\\d{4}-\\d{2}$/.test(accrualPeriod))) {
    return Response.json({ error: "Для ОПиУ укажите статью и период начисления" }, { status: 400 });
  }
  if (accrualPeriod && !/^\\d{4}-\\d{2}$/.test(accrualPeriod)) {
    return Response.json({ error: "Период ОПиУ должен быть в формате ГГГГ-ММ" }, { status: 400 });
  }

  const db = getDb();
  const [operation] = await db.select().from(financialOperations).where(eq(financialOperations.id, operationId)).limit(1);
  if (!operation) return Response.json({ error: "Операция не найдена" }, { status: 404 });

  const normalizedPnlArticle = pnlArticle;
  const normalizedAccrualPeriod = accrualPeriod;
  const [updated] = await db.update(financialOperations).set({
    cashflowArticle,
    pnlArticle: normalizedPnlArticle,
    accrualPeriod: normalizedAccrualPeriod,
    counterpartyLabel,
    managementPurpose,
    category: cashflowArticle,
    reportClass,
    contractId,
    documentId,
    projectEntityId,
    objectEntityId,
    cfrEntityId,
    status: "Разнесено",
  }).where(eq(financialOperations.id, operationId)).returning();

  const changed = {
    cashflowArticle: [operation.cashflowArticle, cashflowArticle],
    pnlArticle: [operation.pnlArticle, normalizedPnlArticle],
    accrualPeriod: [operation.accrualPeriod, normalizedAccrualPeriod],
    counterpartyLabel: [operation.counterpartyLabel, counterpartyLabel],
    managementPurpose: [operation.managementPurpose, managementPurpose],
    reportClass: [operation.reportClass, reportClass],
    contractId: [operation.contractId, contractId],
    documentId: [operation.documentId, documentId],
    projectEntityId: [operation.projectEntityId, projectEntityId],
    objectEntityId: [operation.objectEntityId, objectEntityId],
    cfrEntityId: [operation.cfrEntityId, cfrEntityId],
  };
  await db.insert(auditEvents).values({
    actor,
    action: "finance.operation_classified",
    entityType: "financial_operation",
    entityId: operationId,
    payload: JSON.stringify({
      immutableBankFact: true,
      changes: Object.fromEntries(Object.entries(changed).filter(([, pair]) => pair[0] !== pair[1])),
    }),
  });
  return Response.json({ operation: updated, message: "Операция разнесена; ДДС и ОПиУ пересчитаны" });
}

`;
  next = replaceOnce(next, anchor, implementation + anchor, "classification implementation");
  return next;
}

export function patchFinanceWorkspace(source) {
  if (source.includes(marker)) return source;
  let next = source;
  next = replaceOnce(
    next,
    `  dataQuality: string;
  status: string;
};`,
    `  dataQuality: string;
  cashflowArticle: string;
  pnlArticle: string;
  accrualPeriod: string;
  counterpartyLabel: string;
  managementPurpose: string;
  status: string;
  bankDetails: null | {
    operationDate: string;
    direction: string;
    amountMinor: number;
    currency: string;
    documentNumber: string;
    transactionType: string;
    description: string;
    counterpartyName: string;
    counterpartyInn: string;
    counterpartyKpp: string;
    importedAt: string;
  };
};`,
    "finance operation UI type",
  );
  next = replaceOnce(
    next,
    "  operations: FinanceOperation[];\n  bankAccounts:",
    "  operations: FinanceOperation[];\n  articleSuggestions: string[];\n  bankAccounts:",
    "article suggestions UI type",
  );
  const typeAnchor = 'type Tab = "register" | "cashflow" | "pnl" | "plan" | "debts" | "reconciliation";';
  const draftType = `type ClassificationDraft = {
  cashflowArticle: string;
  pnlArticle: string;
  reportClass: string;
  accrualPeriod: string;
  counterpartyLabel: string;
  managementPurpose: string;
  contractId: string;
  documentId: string;
  projectEntityId: string;
  objectEntityId: string;
  cfrEntityId: string;
};

`;
  next = replaceOnce(next, typeAnchor, draftType + typeAnchor, "classification draft type");
  next = replaceOnce(
    next,
    '  const [correctionOpen, setCorrectionOpen] = useState(false);',
    `  const [classificationDraft, setClassificationDraft] = useState<ClassificationDraft | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);`,
    "classification state",
  );
  next = replaceOnce(
    next,
    `  const openOperation = useCallback((operation: FinanceOperation) => {
    setLinkedEntityId(null);
    setCorrectionOpen(false);
    setSelected(operation);
  }, []);`,
    `  const openOperation = useCallback((operation: FinanceOperation) => {
    setLinkedEntityId(null);
    setCorrectionOpen(false);
    setClassificationDraft({
      cashflowArticle: operation.cashflowArticle || (operation.category === "Не классифицировано" ? "" : operation.category),
      pnlArticle: operation.pnlArticle || "",
      reportClass: operation.reportClass || "Не включено в ОПиУ",
      accrualPeriod: operation.accrualPeriod || operation.period,
      counterpartyLabel: operation.counterpartyLabel || operation.bankDetails?.counterpartyName || "",
      managementPurpose: operation.managementPurpose || operation.bankDetails?.description || "",
      contractId: operation.contractId || "",
      documentId: operation.documentId || "",
      projectEntityId: operation.projectEntityId || "",
      objectEntityId: operation.objectEntityId || "",
      cfrEntityId: operation.cfrEntityId || "",
    });
    setSelected(operation);
  }, []);`,
    "classification draft init",
  );
  next = replaceOnce(
    next,
    "const operation = data.operations.find((item) => item.id === line.operationIds[0]); if (operation) setSelected(operation);",
    "const operation = data.operations.find((item) => item.id === line.operationIds[0]); if (operation) openOperation(operation);",
    "P&L operation draft init",
  );
  next = replaceOnce(
    next,
    "  async function submitCorrection(event: FormEvent) {",
    `  async function submitClassification(event: FormEvent) {
    event.preventDefault();
    if (!selected || !classificationDraft) return;
    const saved = await action({
      action: "classifyOperation",
      operationId: selected.id,
      ...classificationDraft,
    }, \`classify:\${selected.id}\`);
    if (saved) closeOperation();
  }

  async function submitCorrection(event: FormEvent) {`,
    "classification submit",
  );
  next = replaceOnce(
    next,
    `<div className="finance-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, статья, договор, документ…" aria-label="Поиск финансовых операций" /><select value={direction} onChange={(event) => setDirection(event.target.value)}><option>Все направления</option><option>Поступление</option><option>Списание</option></select><span>Суммы хранятся в копейках · исходник неизменяем</span></div>`,
    `<div className="finance-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Контрагент, назначение, статья, договор…" aria-label="Поиск финансовых операций" /><select value={direction} onChange={(event) => setDirection(event.target.value)}><option>Все направления</option><option>Поступление</option><option>Списание</option></select><span>Банковский факт неизменяем · разнесение хранится отдельно</span></div>`,
    "register toolbar",
  );
  next = replaceOnce(
    next,
    `.filter((operation) => !normalized || [operation.id, operation.category, operation.counterpartyEntityId, operation.contractId, operation.documentId, operation.bankOperationRef].some((value) => value.toLocaleLowerCase("ru").includes(normalized)));`,
    `.filter((operation) => !normalized || [
        operation.id,
        operation.category,
        operation.cashflowArticle,
        operation.pnlArticle,
        operation.counterpartyLabel,
        operation.managementPurpose,
        operation.bankDetails?.counterpartyName ?? "",
        operation.bankDetails?.description ?? "",
        operation.counterpartyEntityId,
        operation.contractId,
        operation.documentId,
        operation.bankOperationRef,
      ].some((value) => value.toLocaleLowerCase("ru").includes(normalized)));`,
    "bank search fields",
  );
  const oldRow = `{filteredOperations.map((operation) => <tr key={operation.id} tabIndex={0} aria-label={\`Открыть \${recordLabel("операцию", operation.id)}\`} onClick={() => openOperation(operation)} onKeyDown={(event) => handleOperationKey(event, operation)}><td><strong>{recordLabel("Операция", operation.id)}</strong><small>{operation.sourceFile || "Финансовый реестр"}</small></td><td>{new Date(\`\${operation.operationDate}T00:00:00Z\`).toLocaleDateString("ru-RU")}</td><td><span className={\`direction-chip \${operation.direction === "Поступление" ? "in" : "out"}\`}>{operation.direction}</span></td><td><strong>{operation.category}</strong><small>{operation.reportClass}</small></td><td><strong>{data.entityNames[operation.counterpartyEntityId] ?? recordLabel(counterpartyLabel(operation.counterpartyEntityId), operation.counterpartyEntityId)}</strong><small>{operation.contractId ? recordLabel("Договор", operation.contractId) : "Без договора"}</small></td><td className="money-cell">{operation.direction === "Поступление" ? "+" : "−"}{rubles(operation.amountMinor)}</td><td><span className={operation.status === "Разнесено" ? "quality-ok" : "quality-warn"}>{operation.status}</span></td></tr>)}`;
  const newRow = `{filteredOperations.map((operation) => <tr key={operation.id} tabIndex={0} aria-label={\`Открыть \${recordLabel("операцию", operation.id)}\`} onClick={() => openOperation(operation)} onKeyDown={(event) => handleOperationKey(event, operation)}><td><strong>{operation.bankDetails?.counterpartyName || operation.counterpartyLabel || recordLabel("Операция", operation.id)}</strong><small>{operation.bankDetails?.description || operation.sourceFile || "Финансовый реестр"}</small></td><td>{new Date(\`\${operation.operationDate}T00:00:00Z\`).toLocaleDateString("ru-RU")}</td><td><span className={\`direction-chip \${operation.direction === "Поступление" ? "in" : "out"}\`}>{operation.direction}</span></td><td><strong>{operation.cashflowArticle || operation.category}</strong><small>{operation.pnlArticle ? \`ОПиУ: \${operation.pnlArticle}\` : operation.reportClass}</small></td><td><strong>{operation.counterpartyLabel || operation.bankDetails?.counterpartyName || "Не указан"}</strong><small>{operation.bankDetails?.counterpartyInn ? \`ИНН \${operation.bankDetails.counterpartyInn}\` : operation.contractId ? recordLabel("Договор", operation.contractId) : "Без привязки"}</small></td><td className="money-cell">{operation.direction === "Поступление" ? "+" : "−"}{rubles(operation.amountMinor)}</td><td><span className={operation.status === "Разнесено" ? "quality-ok" : "quality-warn"}>{operation.status}</span></td></tr>)}`;
  next = replaceOnce(next, oldRow, newRow, "register bank rows");

  const correctionsAnchor = '<section className="operation-corrections">';
  const classificationSection = `<section className="operation-classification" data-d069-marker="${marker}">
    <div className="operation-classification-head"><div><p>Разнесение операции</p><span>Банковская дата и сумма не меняются. Эти поля формируют управленческие ДДС и ОПиУ.</span></div><b>{selected.status}</b></div>
    {classificationDraft ? <form className="operation-classification-form" onSubmit={submitClassification}>
      <label><span>Кто</span><input value={classificationDraft.counterpartyLabel} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, counterpartyLabel: event.target.value }) : current)} placeholder={selected.bankDetails?.counterpartyName || "Контрагент / плательщик"} /></label>
      <label><span>За что</span><input value={classificationDraft.managementPurpose} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, managementPurpose: event.target.value }) : current)} placeholder={selected.bankDetails?.description || "Управленческий смысл операции"} /></label>
      <label><span>Статья ДДС</span><input list="finance-article-suggestions" required value={classificationDraft.cashflowArticle} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, cashflowArticle: event.target.value }) : current)} placeholder="Например, Оплата обучения" /></label>
      <label><span>Класс ОПиУ</span><select value={classificationDraft.reportClass} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, reportClass: event.target.value }) : current)}><option>Доходы ОПиУ</option><option>Расходы ОПиУ</option><option>Финансирование</option><option>Не включено в ОПиУ</option></select></label>
      <label><span>Статья ОПиУ</span><input list="finance-article-suggestions" value={classificationDraft.pnlArticle} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, pnlArticle: event.target.value }) : current)} placeholder="Например, Выручка школы" /></label>
      <label><span>Период ОПиУ</span><input type="month" value={classificationDraft.accrualPeriod} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, accrualPeriod: event.target.value }) : current)} /></label>
      <label><span>Договор</span><input value={classificationDraft.contractId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, contractId: event.target.value }) : current)} placeholder="Необязательно" /></label>
      <label><span>Документ</span><input value={classificationDraft.documentId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, documentId: event.target.value }) : current)} placeholder="Необязательно" /></label>
      <label><span>Объект / филиал</span><input value={classificationDraft.objectEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, objectEntityId: event.target.value }) : current)} placeholder="Можно заполнить позже" /></label>
      <label><span>Проект</span><input value={classificationDraft.projectEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, projectEntityId: event.target.value }) : current)} placeholder="Можно заполнить позже" /></label>
      <label><span>ЦФО</span><input value={classificationDraft.cfrEntityId} onChange={(event) => setClassificationDraft((current) => current ? ({ ...current, cfrEntityId: event.target.value }) : current)} placeholder="Можно заполнить позже" /></label>
      <div className="operation-classification-actions"><button type="button" onClick={() => setClassificationDraft((current) => current ? ({ ...current, reportClass: "Не включено в ОПиУ", pnlArticle: "", accrualPeriod: "" }) : current)}>Не включать в ОПиУ</button><button disabled={busy === \`classify:\${selected.id}\`}>Сохранить разнесение</button></div>
      <datalist id="finance-article-suggestions">{data.articleSuggestions.map((article) => <option key={article} value={article} />)}</datalist>
    </form> : null}
  </section>`;
  next = replaceOnce(next, correctionsAnchor, classificationSection + correctionsAnchor, "classification form");
  return next;
}

export function patchFinanceCss(source) {
  if (source.includes(marker)) return source;
  return source + `
/* ${marker} */
.operation-classification { display: grid; gap: 12px; border-top: 1px solid var(--ah-color-border); padding-top: 16px; }
.operation-classification-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.operation-classification-head > div { display: grid; gap: 4px; }
.operation-classification-head p { margin: 0; font-weight: 750; }
.operation-classification-head span { color: var(--ah-color-text-secondary); font-size: 12px; line-height: 17px; }
.operation-classification-head b { white-space: nowrap; font-size: 12px; }
.operation-classification-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.operation-classification-form label { display: grid; gap: 5px; min-width: 0; }
.operation-classification-form label > span { color: var(--ah-color-text-secondary); font-size: 11px; line-height: 16px; }
.operation-classification-form input, .operation-classification-form select { width: 100%; min-width: 0; min-height: 40px; border: 1px solid var(--ah-color-border); border-radius: 10px; background: var(--ah-color-surface); padding: 9px 10px; font: inherit; }
.operation-classification-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
.operation-classification-actions button { min-height: 38px; border-radius: 10px; padding: 8px 12px; }
.operation-classification-actions button:last-child { background: var(--ah-color-accent); color: white; border-color: transparent; }
.finance-table td:first-child small { display: block; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 767px) {
  .operation-classification-form { grid-template-columns: 1fr; }
  .operation-classification-actions { grid-column: auto; display: grid; }
  .operation-classification-form input, .operation-classification-form select { font-size: 16px; }
}
`;
}

export async function applyD069() {
  const [schema, db, route, actions, workspace, css] = await Promise.all([
    readFile(schemaUrl, "utf8"),
    readFile(dbUrl, "utf8"),
    readFile(financeRouteUrl, "utf8"),
    readFile(financeActionsUrl, "utf8"),
    readFile(financeWorkspaceUrl, "utf8"),
    readFile(financeCssUrl, "utf8"),
  ]);
  const outputs = [
    [schemaUrl, schema, patchSchema(schema)],
    [dbUrl, db, patchDb(db)],
    [financeRouteUrl, route, patchFinanceRoute(route)],
    [financeActionsUrl, actions, patchFinanceActions(actions)],
    [financeWorkspaceUrl, workspace, patchFinanceWorkspace(workspace)],
    [financeCssUrl, css, patchFinanceCss(css)],
  ];
  for (const [url, original, patched] of outputs) {
    if (patched !== original) await writeFile(url, patched, "utf8");
  }
  return outputs.some(([, original, patched]) => original !== patched);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log((await applyD069()) ? "D-069 finance operation allocation applied" : "D-069 already present");
}
