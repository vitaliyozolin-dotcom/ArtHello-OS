const CALLBACK_PATH = "/api/banking/oauth/callback";

function validateHttpsUrl(
  raw: string,
  purpose: "callback" | "frontend",
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid ${purpose} URL`);
  }
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error(`${purpose} URL must use HTTPS`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${purpose} URL contains forbidden components`);
  }
  if (url.hostname.endsWith(".chatgpt.site")) {
    throw new Error(
      "Sites cannot receive Tochka OAuth callbacks or banking credentials",
    );
  }
  return url;
}

export function resolveTochkaOAuthRedirectUri(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = environment["TOCHKA_OAUTH_REDIRECT_URI"]?.trim();
  const replitDomain = environment["REPLIT_DOMAINS"]
    ?.split(",")[0]
    ?.trim();
  const candidate = explicit
    ? explicit
    : replitDomain
      ? `https://${replitDomain}${CALLBACK_PATH}`
      : environment["NODE_ENV"] === "production"
        ? null
        : `http://localhost:8080${CALLBACK_PATH}`;
  if (!candidate) {
    throw new Error(
      "TOCHKA_OAUTH_REDIRECT_URI is required in production",
    );
  }
  const url = validateHttpsUrl(candidate, "callback");
  if (
    url.pathname !== CALLBACK_PATH ||
    url.search
  ) {
    throw new Error(
      `Tochka OAuth callback must use the exact path ${CALLBACK_PATH}`,
    );
  }
  return url.toString();
}

export function resolveBankingFrontendBaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const appPublicUrl = environment["APP_PUBLIC_URL"]?.trim();
  const appOrigin = environment["APP_ORIGINS"]
    ?.split(",")[0]
    ?.trim();
  const replitDomain = environment["REPLIT_DOMAINS"]
    ?.split(",")[0]
    ?.trim();
  const candidate = appPublicUrl
    ? appPublicUrl
    : appOrigin
      ? appOrigin
      : replitDomain
        ? `https://${replitDomain}`
        : environment["NODE_ENV"] === "production"
          ? null
          : "http://localhost:21987";
  if (!candidate) {
    throw new Error("APP_PUBLIC_URL is required in production");
  }
  const url = validateHttpsUrl(candidate, "frontend");
  return url.origin;
}

export const TOCHKA_OAUTH_CALLBACK_PATH = CALLBACK_PATH;
