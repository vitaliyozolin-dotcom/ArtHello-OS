export const CSRF_COOKIE_NAMES = [
  "__Host-arthello_csrf",
  "arthello_csrf",
] as const;

export function readCookie(
  cookieHeader: string,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const prefix = `${name}=`;
    const match = cookieHeader
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix));
    if (match) return decodeURIComponent(match.slice(prefix.length));
  }
  return null;
}

export function readCsrfCookie(cookieHeader?: string): string | null {
  const source =
    cookieHeader ??
    (typeof document === "undefined" ? undefined : document.cookie);
  return source === undefined ? null : readCookie(source, CSRF_COOKIE_NAMES);
}
