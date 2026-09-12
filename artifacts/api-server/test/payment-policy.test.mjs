import assert from "node:assert/strict";
import test from "node:test";

import {
  decidePaymentIssue,
  resolvePaymentRoute,
} from "../src/lib/payments/payment-policy.ts";

test("issues the full amount when no confirmed payment exists", () => {
  assert.deepEqual(
    decidePaymentIssue({
      obligationKopecks: 4_500_000,
      confirmedPaidKopecks: 0,
      evidenceStatus: "CONFIRMED",
    }),
    {
      action: "ISSUE",
      reason: "OUTSTANDING_FULL",
      outstandingKopecks: 4_500_000,
    },
  );
});

test("issues only the remainder after a confirmed partial payment", () => {
  assert.deepEqual(
    decidePaymentIssue({
      obligationKopecks: 4_500_000,
      confirmedPaidKopecks: 1_500_000,
      evidenceStatus: "CONFIRMED",
    }),
    {
      action: "ISSUE",
      reason: "OUTSTANDING_REMAINDER",
      outstandingKopecks: 3_000_000,
    },
  );
});

test("does not create another payment request after full payment", () => {
  assert.deepEqual(
    decidePaymentIssue({
      obligationKopecks: 4_500_000,
      confirmedPaidKopecks: 4_500_000,
      evidenceStatus: "CONFIRMED",
    }),
    { action: "SKIP", reason: "ALREADY_PAID", outstandingKopecks: 0 },
  );
});

test("does not create a duplicate active request for the current debt", () => {
  assert.deepEqual(
    decidePaymentIssue({
      obligationKopecks: 4_500_000,
      confirmedPaidKopecks: 1_500_000,
      evidenceStatus: "CONFIRMED",
      activeRequestKopecks: 3_000_000,
    }),
    {
      action: "SKIP",
      reason: "ACTIVE_REQUEST_MATCHES_OUTSTANDING",
      outstandingKopecks: 3_000_000,
    },
  );
});

test("ambiguous payment evidence blocks automatic issuance", () => {
  assert.deepEqual(
    decidePaymentIssue({
      obligationKopecks: 4_500_000,
      confirmedPaidKopecks: 0,
      evidenceStatus: "AMBIGUOUS",
    }),
    {
      action: "REVIEW",
      reason: "AMBIGUOUS_PAYMENT_EVIDENCE",
      outstandingKopecks: 4_500_000,
    },
  );
});

test("stale active request amount requires review instead of a second request", () => {
  assert.deepEqual(
    decidePaymentIssue({
      obligationKopecks: 4_500_000,
      confirmedPaidKopecks: 1_500_000,
      evidenceStatus: "CONFIRMED",
      activeRequestKopecks: 4_500_000,
    }),
    {
      action: "REVIEW",
      reason: "ACTIVE_REQUEST_AMOUNT_CONFLICT",
      outstandingKopecks: 3_000_000,
    },
  );
});

test("rejects floating-point money", () => {
  assert.throws(
    () =>
      decidePaymentIssue({
        obligationKopecks: 4_500_000.5,
        confirmedPaidKopecks: 0,
        evidenceStatus: "CONFIRMED",
      }),
    /integer amount in kopecks/,
  );
});

const completeRoute = {
  id: "route-atlas",
  branchId: "atlas-school",
  legalEntityId: "arthello-llc",
  active: true,
  provider: "tochka",
  providerCustomerCode: "customer-code",
  merchantId: "merchant-id",
  fiscalProfileStatus: "APPROVED",
};

test("route resolution requires exact branch and legal entity", () => {
  assert.deepEqual(
    resolvePaymentRoute([completeRoute], "atlas-school", "arthello-llc"),
    { ok: true, route: completeRoute },
  );
  assert.deepEqual(
    resolvePaymentRoute([completeRoute], "atlas-school", "another-company"),
    { ok: false, reason: "ROUTE_NOT_FOUND" },
  );
});

test("route resolution fails closed on ambiguity", () => {
  assert.deepEqual(
    resolvePaymentRoute(
      [completeRoute, { ...completeRoute, id: "route-atlas-duplicate" }],
      "atlas-school",
      "arthello-llc",
    ),
    { ok: false, reason: "ROUTE_AMBIGUOUS" },
  );
});

test("route resolution refuses incomplete provider or fiscal configuration", () => {
  assert.deepEqual(
    resolvePaymentRoute(
      [{ ...completeRoute, merchantId: null }],
      "atlas-school",
      "arthello-llc",
    ),
    { ok: false, reason: "PROVIDER_ROUTE_INCOMPLETE" },
  );
  assert.deepEqual(
    resolvePaymentRoute(
      [{ ...completeRoute, fiscalProfileStatus: "DRAFT" }],
      "atlas-school",
      "arthello-llc",
    ),
    { ok: false, reason: "FISCAL_PROFILE_NOT_APPROVED" },
  );
});
