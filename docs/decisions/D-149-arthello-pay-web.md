# D-149 — ArtHello Pay web surface and release boundary

**Status:** approved for production candidate  
**Date:** 2026-09-11

## Decision

ArtHello Pay is released as a separate responsive web module on the same public gateway pattern as ArtHello OS and the electronic diaries.

Production host: `pay-188-225-38-55.sslip.io`.

The module is a payment-orchestration surface, not a bank and not a replacement for the acquiring provider. It provides a dedicated operator workspace, scoped customer search, obligations, payment requests and stable public payer URLs.

## Access boundary

The `payment_operator` role may use only explicitly scoped ArtHello Pay endpoints for assigned branches and legal entities. It must not receive access to bank balances, statements, connector credentials, outgoing-payment routes or internet banking.

Owner-only configuration maps an operating branch and legal entity to the provider route and fiscal profile.

## Public payment surface

Public payer pages use opaque `AH-UUID` identifiers. The public response must not expose payer contact data, bank credentials, merchant configuration or internal authorization state.

Until a verified provider URL exists, the public page must not simulate payment or report success.

## Release boundary

This production candidate includes:

- responsive ArtHello Pay operator UI;
- mobile and desktop layouts under the ArtHello design code;
- protected operator authentication and scoped API;
- customer/student lookup limited to the operator scope;
- manual obligation and payment-request preparation;
- stable public payment page routing;
- deployment routing for `pay-188-225-38-55.sslip.io`;
- canonical D147/D148 payment foundation and migration `0019_lying_tarot`.

This production candidate deliberately does **not** enable:

- live Tochka acquiring credentials;
- real provider payment-link creation;
- acquiring webhook confirmation;
- fiscal callback processing;
- scheduled billing/reminders;
- automatic recurring debit.

Those capabilities require a separate verified provider adapter and acceptance tests before money movement is enabled.

## Release condition

The candidate may be merged and deployed only after the repository Quality and Proof gates pass for the exact immutable head. Production activation must preserve rollback and existing financial data.
