export const AUTH_ROLES = [
  "owner",
  "accountant",
  "viewer",
  "payment_operator",
] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const NON_BUSINESS_ACCOUNT_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: "GET", path: "/auth/me" },
  { method: "POST", path: "/auth/logout" },
  { method: "POST", path: "/auth/password" },
];
const OWNER_ONLY_READ_PATTERNS = [
  /^\/auth\/users\/?$/,
  /^\/people-access(?:\/.*)?$/,
  /^\/banking\/connectors\/[^/]+\/customers\/?$/,
  /^\/banking\/connectors\/[^/]+\/health\/?$/,
  /^\/banking\/connectors\/[^/]+\/oauth\/status\/?$/,
] as const;

const PAYMENT_OPERATOR_ROUTES: ReadonlyArray<{
  methods: ReadonlySet<string>;
  pattern: RegExp;
}> = [
  {
    methods: new Set(["GET", "HEAD", "OPTIONS"]),
    pattern: /^\/payments\/catalog\/?$/,
  },
  {
    methods: new Set(["GET", "HEAD", "OPTIONS"]),
    pattern: /^\/payments\/customers\/?$/,
  },
  {
    methods: new Set(["GET", "HEAD", "OPTIONS"]),
    pattern: /^\/payments\/obligations\/?$/,
  },
  {
    methods: new Set(["GET", "HEAD", "OPTIONS"]),
    pattern: /^\/payments\/obligations\/[^/]+\/?$/,
  },
  {
    methods: new Set(["GET", "HEAD", "OPTIONS"]),
    pattern: /^\/payments\/requests\/?$/,
  },
  {
    methods: new Set(["POST"]),
    pattern: /^\/payments\/obligations\/?$/,
  },
  {
    methods: new Set(["POST"]),
    pattern: /^\/payments\/obligations\/[^/]+\/requests\/preview\/?$/,
  },
  {
    methods: new Set(["POST"]),
    pattern: /^\/payments\/obligations\/[^/]+\/requests\/?$/,
  },
  {
    methods: new Set(["POST"]),
    pattern: /^\/payments\/requests\/[^/]+\/cancel\/?$/,
  },
];

export interface BusinessScope {
  unrestricted: boolean;
  branchIds: readonly string[];
  legalEntityIds: readonly string[];
}
export interface AccessDecision {
  allowed: boolean;
  policy:
    | "owner-full-access"
    | "authenticated-account-route"
    | "owner-only-read"
    | "payment-operator-scoped"
    | "scope-required"
    | "scope-route-not-enforced"
    | "write-denied";
}

function normalizePath(path: string): string {
  if (!path) return "/";
  const withoutQuery = path.split("?", 1)[0] ?? "/";
  return withoutQuery === "/" ? withoutQuery : withoutQuery.replace(/\/+$/, "");
}

export function hasCompleteBusinessScope(scope: BusinessScope | null | undefined): boolean {
  if (!scope || scope.unrestricted) return Boolean(scope?.unrestricted);
  return scope.branchIds.length > 0 && scope.legalEntityIds.length > 0;
}

function paymentOperatorRouteAllowed(method: string, path: string): boolean {
  return PAYMENT_OPERATOR_ROUTES.some(
    ({ methods, pattern }) => methods.has(method) && pattern.test(path),
  );
}

export function decideRouteAccess(
  role: AuthRole,
  method: string,
  path: string,
  scope?: BusinessScope | null,
): AccessDecision {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = normalizePath(path);
  if (role === "owner") return { allowed: true, policy: "owner-full-access" };
  if (
    NON_BUSINESS_ACCOUNT_ROUTES.some(
      (route) =>
        route.method === normalizedMethod && route.path === normalizedPath,
    )
  ) {
    return { allowed: true, policy: "authenticated-account-route" };
  }
  if (
    READ_METHODS.has(normalizedMethod) &&
    OWNER_ONLY_READ_PATTERNS.some((pattern) => pattern.test(normalizedPath))
  ) {
    return { allowed: false, policy: "owner-only-read" };
  }
  if (!hasCompleteBusinessScope(scope)) {
    return { allowed: false, policy: "scope-required" };
  }
  if (
    role === "payment_operator" &&
    paymentOperatorRouteAllowed(normalizedMethod, normalizedPath)
  ) {
    return { allowed: true, policy: "payment-operator-scoped" };
  }
  if (READ_METHODS.has(normalizedMethod)) {
    return { allowed: false, policy: "scope-route-not-enforced" };
  }
  return { allowed: false, policy: "write-denied" };
}

export function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === "string" && AUTH_ROLES.includes(value as AuthRole);
}
