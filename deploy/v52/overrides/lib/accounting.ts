export function documentCompleteness(required:string[],actual:string[]){const have=new Set(actual),missing=required.filter(x=>!have.has(x));return{missing,status:missing.length?"Не комплектно":"Комплектно"}}
export function paymentDocumentMatch(document:{amountMinor:number;counterpartyEntityId:string},operation:{amountMinor:number;counterpartyEntityId:string}){return{amountMatch:document.amountMinor===operation.amountMinor,counterpartyMatch:document.counterpartyEntityId===operation.counterpartyEntityId,matched:document.amountMinor===operation.amountMinor&&document.counterpartyEntityId===operation.counterpartyEntityId}}
export function accountingExportSummary(documents:Array<{amountMinor:number}>){return{documentCount:documents.length,amountMinor:documents.reduce((s,x)=>s+x.amountMinor,0)}}
export function canConfirmAccountingDocument(evidence:string,sourceType:string){return evidence.trim().length>=8&&sourceType!=="AUTOMATIC_EDO_UNVERIFIED"}

export function rublesToMinorUnits(value: string | number) {
  const rubles = typeof value === "number" ? value : Number(value.replace(",", ".").trim());
  if (!Number.isFinite(rubles) || rubles <= 0) throw new Error("Укажите сумму больше нуля");
  const minor = Math.round(rubles * 100);
  if (!Number.isSafeInteger(minor)) throw new Error("Сумма слишком велика");
  return minor;
}

export function currentAccountingPeriod(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

const accountingCounterpartyTypes = new Set(["Юрлицо", "Подрядчик", "Поставщик", "Контрагент"]);

export function filterAccountingCounterparties<T extends { entityType: string }>(rows: T[]) {
  return rows.filter((row) => accountingCounterpartyTypes.has(row.entityType));
}
