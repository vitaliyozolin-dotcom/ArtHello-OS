export function getRequestUser(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  if (email) return email;

  const host = request.headers.get("host") ?? "";
  if (host.includes("terminal.local") || host.includes("localhost") || host.includes("127.0.0.1")) {
    return "local-preview@arthello.test";
  }

  return null;
}
