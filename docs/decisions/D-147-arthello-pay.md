# D-147 — ArtHello Pay: payment orchestration without bank access

Status: ACCEPTED
Date: 2026-09-11
Owner: ArtHello

## Decision

Create a separate ArtHello Pay module that lets scoped ArtHello staff issue and track customer payment requests without access to internet banking.

ArtHello Pay is an orchestration layer over a payment provider. It is not a bank, wallet, money-transfer service or replacement for Tochka acquiring.

The first provider is Tochka internet acquiring. The existing `banking` connector remains read-only and MUST NOT receive acquiring or outgoing-payment permissions.

The payment module receives money only. No ArtHello Pay credential or role may create, sign or send an outgoing bank payment.

## Product outcome

An operator can:

1. find/select a customer obligation inside the allowed branch/legal-entity scope;
2. verify that the obligation is still outstanding;
3. create a payment request;
4. copy/send one ArtHello Pay URL and show its QR code;
5. see `waiting / paid / fiscalized / expired / cancelled` status;
6. see the receipt status without opening internet banking.

Later, a billing rule can perform steps 1–4 on the configured date automatically. Automation creates a payment request, not an automatic debit. The customer still authorizes the payment.

## External module

Public customer surface:

- canonical host: `pay.arthello.ru` (final DNS is a deployment concern);
- stable opaque URL: `/p/<random-token>`;
- no family, student, contract, branch, legal-entity, bank-account or merchant identifiers in the URL;
- the same page can offer payment by card/SBP supported by the provider;
- QR encodes the ArtHello Pay URL rather than an expiring provider URL.

Staff surface:

- dedicated ArtHello Pay application/module using central ArtHello authentication;
- staff never receive provider credentials;
- staff never see bank balances, statements, account numbers beyond a safe recipient label, or internet-bank controls.

## Roles and authorization

### Owner

May configure provider routes, fiscal profiles, billing rules, staff access, refunds and manual overrides.

### Payment operator

May only within explicit `branchIds` AND `legalEntityIds` scope:

- view payment obligations and requests;
- create a manual payment request;
- cancel/reissue an unpaid request;
- copy/send the ArtHello Pay URL;
- see payment and receipt status.

Payment operator MUST NOT:

- read bank connectors, balances or statements;
- read provider tokens/customer codes/merchant secrets;
- create/sign outgoing payments;
- alter legal-entity routing or fiscal policy;
- refund without a separately granted owner/accounting permission;
- change an already confirmed paid amount.

All non-owner payment routes remain fail-closed until route-specific scope predicates and negative tests exist.

## Provider security boundary

Create a separate Tochka acquiring credential. Do not expand the current read-only Tochka Open Banking connector.

Minimum provider permissions expected for the acquiring credential:

- `ReadCustomerData`;
- `ReadAcquiringData`;
- `MakeAcquiringOperation`;
- `ManageWebhookData` only where webhook registration is performed by the application.

Explicitly forbidden for the ArtHello Pay credential:

- permissions that create or sign outgoing bank payments;
- statement/balance access unless a later reviewed decision proves it is required;
- reuse of a broad owner internet-bank credential.

Provider credential is server-only, encrypted/protected at rest, redacted from logs and never returned by API.

## Routing model

Every payable obligation is routed before a provider request is created:

`branch -> legal entity -> payment route -> Tochka customerCode + merchantId -> fiscal profile`

A route is usable only when all of these are true:

- route is active;
- branch and legal entity match the obligation;
- acquiring retailer is registered/active;
- `merchantId` is explicitly known (do not rely on single-retailer implicit routing);
- fiscal profile is approved;
- required payer contact for the electronic receipt is available.

No fallback to another legal entity or merchant is allowed. Missing/ambiguous routing fails closed.

## Fiscalization

MVP uses Tochka `Create Payment Operation With Receipt` so fiscalization is performed through Tochka's connected fiscal partner under 54-FZ.

We still model fiscal data independently from the provider so another bank/KKT can be added later.

Fiscal policy is data, not hard-coded assumptions. For each legal entity/service the owner/accounting setup must explicitly approve:

- taxation system code;
- VAT type;
- payment object (`service` for education only after confirmation);
- payment method (`full_payment`, `full_prepayment`, etc.);
- item name/receipt wording;
- receipt contact rules;
- treatment of advance and advance settlement.

The application MUST NOT guess these values.

A paid request is not considered operationally complete until the fiscal status is known. UI therefore distinguishes `PAID` from `FISCALIZED` and raises a visible incident for `PAID + fiscalization unknown/failed`.

## Core entities

### payment_routes

Maps a branch/legal entity to provider routing and an approved fiscal profile. Provider token itself is not stored in this row.

### billing_rules

Defines future automatic generation, for example monthly on a configured day. A rule creates obligations/requests only after an outstanding-balance check.

### payment_obligations

Represents what a customer owes for a billing period/service. Amounts are stored in integer kopecks. An obligation can be open, partially paid, paid, cancelled or disputed.

### payment_requests

One attempt to collect a specific outstanding amount. Contains our opaque public token hash and a unique `paymentLinkId` sent to Tochka. A new provider link means a new request/version; paid history is immutable.

### payment_events

Append-only provider/internal event history with idempotency identity and digest. Provider raw payload must be minimized/redacted according to security policy.

### fiscal_receipts

Tracks expected fiscalization and provider/KKT receipt identity/status separately from payment status.

## Money representation

Internal calculations use integer kopecks only. Decimal/ruble strings are produced only at provider boundaries.

Never use JavaScript floating point for debt, payment, refund or reconciliation arithmetic.

## Manual issue flow

1. Operator selects customer/obligation.
2. Backend verifies operator branch/legal-entity scope.
3. Backend refreshes/re-reads authoritative payment evidence available to the system.
4. `outstanding = obligation amount - confirmed allocated payments`.
5. If `outstanding <= 0`, return `ALREADY_PAID`; do not create a provider link.
6. If partially paid, offer/create only the remaining amount.
7. Resolve exactly one active payment route and approved fiscal profile.
8. Create local request with a globally unique `paymentLinkId` and opaque public token.
9. Call Tochka fiscalized payment-link API idempotently.
10. Persist provider operation/link response without logging secrets/PII.
11. Return the ArtHello Pay public URL, not the raw bank API response.

## Automatic issue flow

The scheduler is a deterministic continuation of the manual flow:

1. select enabled billing rules due at the current local business date;
2. create/refresh the period obligation idempotently;
3. check for confirmed payment before issuing;
4. skip fully paid obligations and record `SKIPPED_ALREADY_PAID`;
5. issue only the outstanding remainder;
6. never create more than one active request for `(obligation, amount, billing generation)`;
7. enqueue notification only after provider link creation succeeds;
8. reminders operate only on currently outstanding requests.

Automation MUST be safe to rerun after crash/retry.

## Existing-payment check

Do not decide `already paid` by customer name + amount alone.

Evidence priority:

1. payment already tied to our `paymentLinkId`/provider operation;
2. an approved internal allocation to the same obligation;
3. high-confidence reconciliation to the same customer/contract/period;
4. ambiguous bank/CRM evidence -> `REVIEW_REQUIRED`, not automatic suppression or allocation.

The existing read-only `banking` and `reconciliation` contours may provide evidence. ArtHello Pay must not widen their permissions.

## Tochka payment link contract

Production creation uses the official fiscalized acquiring method:

`POST https://enter.tochka.com/uapi/acquiring/v1.0/payments_with_receipt`

Before enabling live creation we verify the deployed request/response schema against the current Tochka OpenAPI specification and sandbox/test vectors.

Required business inputs include:

- amount;
- customerCode;
- purpose;
- explicit merchantId;
- unique paymentLinkId;
- client receipt contact;
- receipt items;
- approved tax/fiscal fields;
- redirect/fail redirect URL;
- bounded TTL.

No two ArtHello requests reuse the same `paymentLinkId`.

## Webhook contract

Use Tochka `acquiringInternetPayment` as the authoritative near-real-time provider event.

Tochka sends `text/plain` containing an RS256-signed JWT. The adapter MUST:

1. bound body size before buffering;
2. require exact `Content-Type` policy;
3. verify JWT signature using the current official Tochka public key/JWK source;
4. validate expected claims/event type and reject malformed content;
5. derive a stable event identity and atomically claim replay identity before side effects;
6. use `paymentLinkId` as an ArtHello correlation key where present;
7. process duplicate same-payload delivery idempotently;
8. reject conflicting replay;
9. never trust browser redirect as payment proof;
10. return only sanitized errors/logs.

The existing generic bank callback remains closed; Tochka acquiring gets its own reviewed adapter/tests.

## Payment state machine

Primary states:

- `DRAFT`
- `READY`
- `LINK_CREATING`
- `WAITING`
- `AUTHORIZED` (card two-stage only; not used by normal MVP)
- `PAID`
- `FISCALIZED`
- `EXPIRED`
- `CANCELLED`
- `REFUND_PENDING`
- `REFUNDED`
- `REVIEW_REQUIRED`
- `ERROR`

State transitions are monotonic where possible and append an audit event. A late provider duplicate cannot move a finalized payment backwards.

## Refunds

Refunds are not part of payment-operator MVP.

When added, refund creation requires owner/accounting permission, explicit confirmation, amount <= net paid amount, independent audit, provider result capture and receipt/correction handling. A payment operator can see refund status but cannot initiate it.

## Notifications

Notification transport (SMS/email/Telegram/other) is downstream from payment creation and must be retryable independently. A notification failure must not duplicate a payment request.

First implementation may expose `Copy link` only; automatic sending is a separate adapter.

## Observability and audit

Every meaningful action stores actor/system, timestamp, request/obligation IDs, action, result and safe reason code:

- request created/reissued/cancelled;
- automatic generation skipped because paid;
- route resolution failed;
- provider creation accepted/rejected;
- webhook accepted/duplicate/conflict/rejected;
- payment confirmed;
- fiscalization confirmed/failed/unknown;
- manual override;
- refund lifecycle.

No PAN, bank token, raw authorization header or full webhook JWT is stored in application logs.

## Delivery phases

### Phase 1 — foundation (D147)

- architecture/security decision;
- payment decision policy in pure code with tests;
- dedicated provider boundary types;
- no live provider credential and no production DB migration.

### Phase 2 — persistence and scoped staff API

- additive payment tables + rollback companion;
- `$migration-check` and PostgreSQL 16 tests;
- `payment_operator` central role with route-specific branch/legal-entity enforcement;
- manual create/list/cancel/reissue APIs;
- audit.

### Phase 3 — Tochka sandbox/live controlled activation

- separate acquiring JWT/consent;
- Get Retailers readiness check;
- fiscalized link adapter;
- RS256 webhook adapter + official/synthetic vectors;
- one low-value controlled end-to-end payment and receipt verification;
- no production activation until exact-head quality gates pass.

### Phase 4 — automatic billing

- billing rules;
- scheduled outstanding check;
- idempotent issuance;
- notification adapters/reminders;
- exception queue.

### Phase 5 — optional recurring debit

Not implied by automatic billing. Requires a new decision, explicit customer opt-in, saved-card/subscription legal/UX review and separate cancellation controls.

## Acceptance criteria

MVP is accepted only when all are proven:

1. operator cannot access banking connector/balance/statement routes;
2. operator can issue a link only inside both assigned scopes;
3. wrong/missing route or fiscal profile fails closed;
4. already-paid obligation does not produce another request;
5. partial payment produces only the remainder;
6. retry cannot duplicate provider paymentLinkId/request;
7. customer pays through ArtHello Pay and Tochka reports `APPROVED`;
8. RS256 webhook validation passes positives and tamper/replay negatives;
9. receipt is produced with the approved fiscal policy and customer can receive it;
10. payment appears in internal status/reconciliation without operator bank access;
11. logs contain no provider secret, PAN or raw signed webhook;
12. exact candidate passes typecheck, tests, build, PostgreSQL migration/rollback and security gates before release.

## Non-goals

- holding customer money;
- splitting one payment after receipt between legal entities;
- marketplace/agent settlement for third parties;
- giving payment staff internet-bank access;
- automatic debit without explicit future opt-in;
- guessing accounting or fiscal policy.

## Rationale

This design gives ArtHello one payment UX across multiple branches/legal entities while keeping the actual movement of money inside Tochka. It minimizes regulatory and security scope, preserves the existing read-only banking boundary, and makes future automation a deterministic extension of the same tested payment workflow rather than a second system.