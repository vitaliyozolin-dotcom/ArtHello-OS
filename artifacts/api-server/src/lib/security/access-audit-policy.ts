const ROUTE_TEMPLATES: ReadonlyArray<{
  pattern: RegExp;
  template: string;
}> = [
  { pattern: /^\/auth\/me\/?$/, template: "/auth/me" },
  { pattern: /^\/auth\/logout\/?$/, template: "/auth/logout" },
  { pattern: /^\/auth\/users\/?$/, template: "/auth/users" },
  {
    pattern: /^\/banking\/connectors\/[^/]+\/customers\/?$/,
    template: "/banking/connectors/:id/customers",
  },
  {
    pattern: /^\/banking\/connectors\/[^/]+\/health\/?$/,
    template: "/banking/connectors/:id/health",
  },
  {
    pattern:
      /^\/banking\/connectors\/[^/]+\/oauth\/status\/?$/,
    template: "/banking/connectors/:id/oauth/status",
  },
  {
    pattern: /^\/banking\/connectors\/[^/]+\/?$/,
    template: "/banking/connectors/:id",
  },
  {
    pattern:
      /^\/banking\/transactions\/[^/]+\/match\/?$/,
    template: "/banking/transactions/:id/match",
  },
  {
    pattern: /^\/webhooks\/website-lead\/?$/,
    template: "/webhooks/website-lead",
  },
];

const REGISTERED_ROOTS = new Set([
  "articles",
  "audit",
  "auth",
  "banking",
  "branches",
  "categorization",
  "cfo",
  "contracts",
  "contractors",
  "coverage",
  "documents",
  "educational",
  "employees",
  "finance",
  "healthz",
  "identity",
  "integrations",
  "ledger",
  "marketing",
  "month-closing",
  "payables",
  "pnl",
  "reconciliation",
  "recurring",
  "schedule",
  "staff",
  "sync",
  "system",
  "taxes",
  "timeline",
  "trust-score",
  "webhooks",
]);

function normalizedPathOnly(path: string): string {
  const pathOnly = path.split("?", 1)[0] || "/";
  const normalized = `/${pathOnly
    .split("/")
    .filter(Boolean)
    .join("/")}`;
  return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
}

export function canonicalAuditPath(path: string): string {
  const normalized = normalizedPathOnly(path);
  const registered = ROUTE_TEMPLATES.find(({ pattern }) =>
    pattern.test(normalized),
  );
  if (registered) return registered.template;

  const [root, ...rest] = normalized.split("/").filter(Boolean);
  if (!root || !REGISTERED_ROOTS.has(root)) {
    return "/unregistered/:path";
  }
  return rest.length === 0 ? `/${root}` : `/${root}/:path`;
}

export function shouldAuditAccess(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const canonicalPath = canonicalAuditPath(path);
  if (
    (normalizedMethod === "GET" && canonicalPath === "/auth/me") ||
    (normalizedMethod === "POST" &&
      canonicalPath === "/auth/logout")
  ) {
    return false;
  }
  return true;
}
