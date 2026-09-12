export type AuthRouteAccess = "public" | "session";

export type AuthRouteDecision =
  | { kind: "allow"; access: AuthRouteAccess }
  | { kind: "reject"; status: 404 | 405; allow?: string };

const AUTH_ROUTES: Readonly<Record<string, { method: "GET" | "POST"; access: AuthRouteAccess }>> = {
  "/api/auth/me": { method: "GET", access: "public" },
  "/api/auth/login": { method: "POST", access: "public" },
  "/api/auth/password": { method: "POST", access: "session" },
  "/api/auth/logout": { method: "POST", access: "session" },
};

const PUBLIC_API_ROUTES: Readonly<Record<string, "GET" | "POST">> = {
  "/api/health": "GET",
  "/api/atlas-sso/open": "GET",
  "/api/atlas-sso/authorize": "GET",
  "/api/atlas-sso/exchange": "POST",
  "/api/atlas-sso/check": "POST",
  "/api/school-sso/authorize": "GET",
  "/api/school-sso/exchange": "POST",
};

export function authRouteDecision(pathname: string, method: string): AuthRouteDecision | null {
  if (pathname !== "/api/auth" && !pathname.startsWith("/api/auth/")) return null;
  const route = AUTH_ROUTES[pathname];
  if (!route) return { kind: "reject", status: 404 };
  if (method.toUpperCase() !== route.method) {
    return { kind: "reject", status: 405, allow: route.method };
  }
  return { kind: "allow", access: route.access };
}

export function publicApiRouteDecision(pathname: string, method: string): AuthRouteDecision | null {
  const expectedMethod = PUBLIC_API_ROUTES[pathname];
  if (!expectedMethod) return null;
  if (method.toUpperCase() !== expectedMethod) {
    return { kind: "reject", status: 405, allow: expectedMethod };
  }
  return { kind: "allow", access: "public" };
}

export function hasTrustedMutationOrigin(
  request: Request,
  configuredPublicOrigin = "",
  configuredAdditionalOrigins = "",
) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;

  const expectedOrigins = new Set<string>();
  try {
    expectedOrigins.add(new URL(configuredPublicOrigin.trim() || request.url).origin);
    for (const raw of configuredAdditionalOrigins.split(",")) {
      const value = raw.trim();
      if (!value) continue;
      const url = new URL(value);
      if (url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        return false;
      }
      expectedOrigins.add(url.origin);
    }
  } catch {
    return false;
  }

  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return false;

  try {
    return expectedOrigins.has(new URL(source).origin);
  } catch {
    return false;
  }
}
