import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type {
  AccessDecision,
  AuthRole,
  BusinessScope,
} from "./access-policy.js";
import { canonicalAuditPath } from "./access-audit-policy.js";

export interface AccessAuditInput {
  tokenHash: string;
  role: AuthRole;
  method: string;
  path: string;
  scope: BusinessScope;
  decision: AccessDecision;
  requestId?: string | number;
}

export async function recordAccessAudit(
  input: AccessAuditInput,
): Promise<void> {
  const sessionFingerprint = createHash("sha256")
    .update(input.tokenHash)
    .digest("hex")
    .slice(0, 24);

  await pool.query(
    `INSERT INTO security_access_audit (
       session_fingerprint,
       role,
       method,
       path,
       decision,
       policy,
       branch_ids,
       legal_entity_ids,
       request_id
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7::jsonb,
       $8::jsonb,
       $9
     )`,
    [
      sessionFingerprint,
      input.role,
      input.method.toUpperCase(),
      canonicalAuditPath(input.path),
      input.decision.allowed ? "allowed" : "denied",
      input.decision.policy,
      JSON.stringify(input.scope.branchIds),
      JSON.stringify(input.scope.legalEntityIds),
      input.requestId === undefined ? null : String(input.requestId),
    ],
  );
}
