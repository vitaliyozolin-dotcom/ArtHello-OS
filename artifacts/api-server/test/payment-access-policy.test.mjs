import assert from "node:assert/strict";
import test from "node:test";

import {
  decideRouteAccess,
  isAuthRole,
} from "../src/lib/security/access-policy.ts";

const completeScope = {
  unrestricted: false,
  branchIds: ["atlas-school"],
  legalEntityIds: ["11111111-1111-4111-8111-111111111111"],
};

const incompleteScope = {
  unrestricted: false,
  branchIds: ["atlas-school"],
  legalEntityIds: [],
};

test("payment_operator is a recognized session role", () => {
  assert.equal(isAuthRole("payment_operator"), true);
});

test("payment operator can use only explicitly registered ArtHello Pay routes", () => {
  for (const [method, path] of [
    ["GET", "/payments/catalog"],
    ["GET", "/payments/customers"],
    ["GET", "/payments/obligations"],
    ["GET", "/payments/obligations/11111111-1111-4111-8111-111111111111"],
    ["GET", "/payments/requests"],
    ["POST", "/payments/obligations"],
    [
      "POST",
      "/payments/obligations/11111111-1111-4111-8111-111111111111/requests/preview",
    ],
    [
      "POST",
      "/payments/obligations/11111111-1111-4111-8111-111111111111/requests",
    ],
    [
      "POST",
      "/payments/requests/11111111-1111-4111-8111-111111111111/cancel",
    ],
  ]) {
    assert.deepEqual(
      decideRouteAccess("payment_operator", method, path, completeScope),
      { allowed: true, policy: "payment-operator-scoped" },
    );
  }
});

test("payment operator cannot read or write banking routes", () => {
  for (const [method, path] of [
    ["GET", "/banking/connectors"],
    ["GET", "/banking/transactions"],
    ["POST", "/banking/connectors"],
    ["POST", "/banking/transactions/tx-1/match"],
  ]) {
    assert.equal(
      decideRouteAccess("payment_operator", method, path, completeScope).allowed,
      false,
    );
  }
});

test("payment operator cannot configure routes or provision other operators", () => {
  assert.equal(
    decideRouteAccess(
      "payment_operator",
      "GET",
      "/payments/routes",
      completeScope,
    ).allowed,
    false,
  );
  assert.equal(
    decideRouteAccess(
      "payment_operator",
      "POST",
      "/payments/routes",
      completeScope,
    ).allowed,
    false,
  );
  assert.equal(
    decideRouteAccess(
      "payment_operator",
      "POST",
      "/payments/operators",
      completeScope,
    ).allowed,
    false,
  );
});

test("payment operator fails closed without complete branch and legal-entity scope", () => {
  assert.deepEqual(
    decideRouteAccess(
      "payment_operator",
      "GET",
      "/payments/catalog",
      incompleteScope,
    ),
    { allowed: false, policy: "scope-required" },
  );
  assert.deepEqual(
    decideRouteAccess(
      "payment_operator",
      "GET",
      "/payments/obligations",
      incompleteScope,
    ),
    { allowed: false, policy: "scope-required" },
  );
});

test("existing accountant and viewer roles do not gain payment write access", () => {
  for (const role of ["accountant", "viewer"]) {
    assert.equal(
      decideRouteAccess(role, "POST", "/payments/obligations", completeScope)
        .allowed,
      false,
    );
  }
});
