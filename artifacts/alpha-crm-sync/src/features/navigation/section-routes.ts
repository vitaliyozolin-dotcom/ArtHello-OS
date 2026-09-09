export const SECTION_PATHS = {
  pulse: "/",
  money: "/banking",
  pnl: "/pnl",
  ledger: "/ledger",
  reconciliation: "/reconciliation",
  "finance-matching": "/finance/matching",
  "finance-cashflow": "/finance/cashflow",
  "finance-payment-plan": "/finance/payment-plan",
  "finance-payables": "/finance/payables",
  contractors: "/contractors",
  staff: "/staff",
  taxes: "/taxes",
  families: "/families",
  employees: "/employees",
  cfo: "/cfo",
  "trust-score": "/trust-score",
  "month-closing": "/month-closing",
  "finance-qa": "/finance/qa",
  articles: "/articles",
  documents: "/documents",
  "test-data": "/test-data",
  settings: "/settings",
  "front-office": "/front-office",
  contracts: "/contracts",
  educational: "/educational",
  schedule: "/schedule",
  "bank-integrations": "/integrations/banks",
  "crm-coverage": "/integrations/alfacrm/coverage",
} as const;

export type OwnerSection = keyof typeof SECTION_PATHS;

const PATH_SECTIONS = new Map<string, OwnerSection>(
  Object.entries(SECTION_PATHS).map(([section, path]) => [
    path,
    section as OwnerSection,
  ]),
);

export function pathForSection(section: OwnerSection): string {
  return SECTION_PATHS[section];
}

export function sectionForPath(pathname: string): OwnerSection | null {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PATH_SECTIONS.get(normalized) ?? null;
}
