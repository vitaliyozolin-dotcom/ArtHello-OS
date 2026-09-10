export type ContractorPayment = {
  counterpartyEntityId: string;
  amountMinor: number;
  operationDate: string;
  category: string;
  contractId: string;
  documentId: string;
  sourceSystem: string;
};

export type ContractorSummary = {
  id: string;
  paymentCount: number;
  totalMinor: number;
  firstPaymentAt: string;
  lastPaymentAt: string;
  categories: string[];
  contracts: string[];
  documents: string[];
  sourceSystems: string[];
};

export function buildContractorRegister(payments: ContractorPayment[]): ContractorSummary[] {
  const groups = new Map<string, ContractorSummary>();
  for (const payment of payments) {
    if (!payment.counterpartyEntityId || payment.amountMinor <= 0) continue;
    const current = groups.get(payment.counterpartyEntityId) ?? {
      id: payment.counterpartyEntityId,
      paymentCount: 0,
      totalMinor: 0,
      firstPaymentAt: payment.operationDate,
      lastPaymentAt: payment.operationDate,
      categories: [],
      contracts: [],
      documents: [],
      sourceSystems: [],
    };
    current.paymentCount += 1;
    current.totalMinor += payment.amountMinor;
    current.firstPaymentAt = current.firstPaymentAt < payment.operationDate ? current.firstPaymentAt : payment.operationDate;
    current.lastPaymentAt = current.lastPaymentAt > payment.operationDate ? current.lastPaymentAt : payment.operationDate;
    addUnique(current.categories, payment.category);
    addUnique(current.contracts, payment.contractId);
    addUnique(current.documents, payment.documentId);
    addUnique(current.sourceSystems, payment.sourceSystem);
    groups.set(payment.counterpartyEntityId, current);
  }
  return [...groups.values()].sort((left, right) => right.totalMinor - left.totalMinor);
}

function addUnique(values: string[], value: string) {
  if (value && !values.includes(value)) values.push(value);
}
