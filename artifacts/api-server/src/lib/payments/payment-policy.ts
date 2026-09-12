export type PaymentEvidenceStatus = "CONFIRMED" | "AMBIGUOUS" | "UNAVAILABLE";

export type PaymentIssueDecision =
  | {
      action: "ISSUE";
      reason: "OUTSTANDING_FULL" | "OUTSTANDING_REMAINDER";
      outstandingKopecks: number;
    }
  | {
      action: "SKIP";
      reason: "ALREADY_PAID" | "ACTIVE_REQUEST_MATCHES_OUTSTANDING";
      outstandingKopecks: number;
    }
  | {
      action: "REVIEW";
      reason: "AMBIGUOUS_PAYMENT_EVIDENCE" | "ACTIVE_REQUEST_AMOUNT_CONFLICT";
      outstandingKopecks: number;
    };

export interface PaymentIssueInput {
  obligationKopecks: number;
  confirmedPaidKopecks: number;
  evidenceStatus: PaymentEvidenceStatus;
  activeRequestKopecks?: number | null;
}

function assertKopecks(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      `${name} must be a non-negative safe integer amount in kopecks`,
    );
  }
}

/**
 * Pure policy for both manual and scheduled payment-link generation.
 *
 * The policy deliberately refuses to guess when evidence is ambiguous and never
 * issues a second request while an active request already represents the exact
 * current debt. All money is integer kopecks.
 */
export function decidePaymentIssue(
  input: PaymentIssueInput,
): PaymentIssueDecision {
  assertKopecks("obligationKopecks", input.obligationKopecks);
  assertKopecks("confirmedPaidKopecks", input.confirmedPaidKopecks);
  if (input.activeRequestKopecks != null) {
    assertKopecks("activeRequestKopecks", input.activeRequestKopecks);
  }

  const outstandingKopecks = Math.max(
    0,
    input.obligationKopecks - input.confirmedPaidKopecks,
  );

  if (input.evidenceStatus === "AMBIGUOUS") {
    return {
      action: "REVIEW",
      reason: "AMBIGUOUS_PAYMENT_EVIDENCE",
      outstandingKopecks,
    };
  }

  if (outstandingKopecks === 0) {
    return { action: "SKIP", reason: "ALREADY_PAID", outstandingKopecks: 0 };
  }

  if (input.activeRequestKopecks != null) {
    if (input.activeRequestKopecks === outstandingKopecks) {
      return {
        action: "SKIP",
        reason: "ACTIVE_REQUEST_MATCHES_OUTSTANDING",
        outstandingKopecks,
      };
    }
    return {
      action: "REVIEW",
      reason: "ACTIVE_REQUEST_AMOUNT_CONFLICT",
      outstandingKopecks,
    };
  }

  return {
    action: "ISSUE",
    reason:
      input.confirmedPaidKopecks > 0
        ? "OUTSTANDING_REMAINDER"
        : "OUTSTANDING_FULL",
    outstandingKopecks,
  };
}

export interface PaymentRouteCandidate {
  id: string;
  branchId: string;
  legalEntityId: string;
  active: boolean;
  provider: "tochka";
  providerCustomerCode: string | null;
  merchantId: string | null;
  fiscalProfileStatus: "APPROVED" | "DRAFT" | "DISABLED";
}

export type PaymentRouteResolution =
  | { ok: true; route: PaymentRouteCandidate }
  | {
      ok: false;
      reason:
        | "ROUTE_NOT_FOUND"
        | "ROUTE_AMBIGUOUS"
        | "PROVIDER_ROUTE_INCOMPLETE"
        | "FISCAL_PROFILE_NOT_APPROVED";
    };

function nonEmpty(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Fail-closed branch + legal-entity routing. There is intentionally no fallback
 * to a different branch, company or merchant.
 */
export function resolvePaymentRoute(
  routes: readonly PaymentRouteCandidate[],
  branchId: string,
  legalEntityId: string,
): PaymentRouteResolution {
  const exact = routes.filter(
    (route) =>
      route.active &&
      route.branchId === branchId &&
      route.legalEntityId === legalEntityId,
  );

  if (exact.length === 0) return { ok: false, reason: "ROUTE_NOT_FOUND" };
  if (exact.length > 1) return { ok: false, reason: "ROUTE_AMBIGUOUS" };

  const route = exact[0]!;
  if (!nonEmpty(route.providerCustomerCode) || !nonEmpty(route.merchantId)) {
    return { ok: false, reason: "PROVIDER_ROUTE_INCOMPLETE" };
  }
  if (route.fiscalProfileStatus !== "APPROVED") {
    return { ok: false, reason: "FISCAL_PROFILE_NOT_APPROVED" };
  }

  return { ok: true, route };
}
