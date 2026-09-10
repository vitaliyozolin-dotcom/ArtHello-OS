import { env } from "cloudflare:workers";
import { handleBackupRequest } from "../../../../lib/backup-api";
import { getAuthenticatedRequestContext, isCanonicalOwnerContext, verifyAuthenticatedRequestCsrf } from "../../../../lib/production-auth";
import { hasTrustedMutationOrigin } from "../../../../lib/request-security";

function handle(request: Request) {
  const runtime = env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string; BACKUP_TRANSPORT?: { fetch: (request: Request) => Promise<Response> } };
  return handleBackupRequest(request, {
    authenticate: getAuthenticatedRequestContext,
    isOwner: isCanonicalOwnerContext,
    verifyCsrf: verifyAuthenticatedRequestCsrf,
    trustedOrigin: (input) => hasTrustedMutationOrigin(input, runtime.ARTHELLO_PUBLIC_ORIGIN?.trim() ?? ""),
    transport: runtime.BACKUP_TRANSPORT,
  });
}

export const GET = handle;
export const POST = handle;
