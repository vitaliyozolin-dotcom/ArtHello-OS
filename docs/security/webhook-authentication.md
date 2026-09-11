# Callback and webhook authentication contract

Status: shared website verifier and durable PostgreSQL replay-claim primitives
implemented; provider callbacks remain fail closed until their route adapter,
raw-body capture and provider-specific negative tests implement the contract.

## Common boundary

Verification happens on bounded raw request bytes before JSON parsing, logging,
queueing or database writes. Unknown provider, missing/duplicate authentication
headers, malformed timestamp/identifier, unavailable key store, signature
mismatch and replay return a fixed `401`/`409` without provider body, secret or
derived signature in logs. Comparison is constant-time. Secrets are versioned,
provider-scoped and loaded from the server secret store; no query-string secret
or global `SESSION_SECRET` fallback is allowed.

An accepted callback atomically claims `(provider, key_id, event_id)` in
PostgreSQL before side effects. The unique claim stores only a body digest,
received timestamp and terminal processing state. Same identity plus same digest
is an idempotent acknowledgement; same identity plus another digest is a
conflict. Delivery may enqueue a read-only synchronization, never initiate a
payment. Raw financial observations remain append-only.

## Website lead

Because ArtHello controls both ends, use versioned HMAC-SHA256 over the exact
bytes `v1\n<unix-seconds>\n<event-id>\n<sha256(raw-body)>`. Required headers are
`X-ArtHello-Signature: v1=<lower-hex>`, `X-ArtHello-Timestamp`,
`X-ArtHello-Event-Id` and the existing payload-bound idempotency key. Reject
timestamps outside a configured bounded window and retain the durable event ID
claim beyond that window. Rotation accepts explicit current/previous key IDs
for a bounded overlap; absence of configuration keeps the endpoint closed.

## Bank adapters

There is no generic `/banking/webhooks/:bank` authentication algorithm.
Registration is an allowlist of implemented adapters, each binding the exact
provider method/path, documented authentication scheme, account/connector and
event identity. T-Bank's documented T-API webhook transport can use Basic or
Bearer authentication; use a dedicated random credential per legal entity and
endpoint. Published source IPs are defence in depth, not identity. Tochka and
other banks stay disabled until their exact webhook product documentation and
test vectors are approved; outbound API request-signing rules must not be
assumed to authenticate inbound callbacks.

## Evotor

The current user-token endpoint is an OAuth installation callback, not an
ordinary event webhook. It requires a server-generated, single-use, expiring
state bound to the initiating owner session, exact callback URL and intended
connector. State is consumed atomically before encrypted token storage; missing,
expired, replayed or cross-session state fails closed. A token in the callback
does not itself authenticate the request. Event callbacks, if later required,
need a separate provider-documented verifier and must not reuse OAuth state.

## Acceptance before exposure

- positive official/synthetic signature vectors and byte-changing negatives;
- duplicate headers, stale/future timestamps, replay and conflicting replay;
- key rotation, missing key store and database outage fail closed;
- body-size limit before buffering and content-type allowlist;
- transaction rollback proves no partial raw/normalized/audit write;
- logs and responses pass secret/PII sanitization tests;
- OpenAPI, public allowlist, permission matrix and deployment callback URL change
  in the same reviewed candidate.

Provider references: `https://developer.tbank.ru/docs/intro/webhooks/` and
`https://enter.tochka.com/doc/v2/`. Their current availability is not evidence
that an ArtHello adapter has been implemented or enabled.
