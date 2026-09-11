import type { ArticleCatalog } from "./finance-articles.ts";
import { FINANCE_ACCOUNTING_START_DATE } from "./finance-branch-scope.ts";

export type FinanceAutoAllocationInput = {
  legalEntityName: string;
  operationDate: string;
  direction: string;
  currency: string;
  description: string;
};

export type FinanceAutoAllocation = {
  objectEntityId: "BR-ATLAS-SCHOOL" | "BR-KINDERGARTEN";
  cashflowArticle: "Оплата школы" | "Оплата детского сада";
  pnlArticle: "Выручка школы" | "Выручка детского сада";
  reportClass: "Доходы ОПиУ";
  accrualPeriod: string;
  status: "Разнесено автоматически";
};

const normalize = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase("ru")
  .replace(/[«»"']/g, "")
  .replace(/[^a-zа-яё0-9]+/giu, " ")
  .trim();

const articleRequirements = [
  ["cashflow", "Поступление", "Оплата школы"],
  ["pnl", "Поступление", "Выручка школы"],
  ["cashflow", "Поступление", "Оплата детского сада"],
  ["pnl", "Поступление", "Выручка детского сада"],
] as const;

export function isAutoAllocationCatalogReady(catalog: ArticleCatalog) {
  return articleRequirements.every(([report, direction, name]) => catalog.articles.some((article) =>
    article.status === "active" && article.report === report && article.direction === direction && article.name === name,
  ));
}

export function classifyFinanceOperation(input: FinanceAutoAllocationInput): FinanceAutoAllocation | null {
  if (input.operationDate < FINANCE_ACCOUNTING_START_DATE) return null;
  if (input.direction !== "Поступление" || input.currency !== "RUB") return null;
  if (normalize(input.legalEntityName) !== "ооо артхелло") return null;

  const purpose = normalize(input.description);
  const school = /(^| )школ[а-яё]*( |$)/u.test(purpose);
  const kindergarten = /(^| )(детск[а-яё]* сад[а-яё]*|детсад[а-яё]*|садик[а-яё]*|дошкол[а-яё]*)( |$)/u.test(purpose);
  if (school === kindergarten) return null;

  return school ? {
    objectEntityId: "BR-ATLAS-SCHOOL",
    cashflowArticle: "Оплата школы",
    pnlArticle: "Выручка школы",
    reportClass: "Доходы ОПиУ",
    accrualPeriod: input.operationDate.slice(0, 7),
    status: "Разнесено автоматически",
  } : {
    objectEntityId: "BR-KINDERGARTEN",
    cashflowArticle: "Оплата детского сада",
    pnlArticle: "Выручка детского сада",
    reportClass: "Доходы ОПиУ",
    accrualPeriod: input.operationDate.slice(0, 7),
    status: "Разнесено автоматически",
  };
}
