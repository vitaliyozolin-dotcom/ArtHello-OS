# School SSO investigation — 2026-09-07

No production fix is claimed. No server, browser, credentials, GitHub branch, permissions or deployment gates were changed by this investigation.

## Proven evidence

- Exact deployed School source: `54242340f2d9b6a9887d69ecc03520ddf9f7982c`, tree `65d2ab6b182d6c8218b1022fecd840dd9f9d7564` (validated source `43fda9852a7c39236c70f1f8ee7aad0edb6770aa`, same tree).
- [Candidate validation job 100621322855](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33746867643/job/100621322855) completed **5/5** real ArtHello identities through School callback, session, `/api/school` snapshot 200, page and assets at 2026-09-03 10:59 UTC.
- That candidate ran with an empty School SQLite volume on the ArtHello gateway Docker network. It used the real public ArtHello exchange and identities. The School callback was addressed through local HTTP inside the candidate, while its configured public origin remained the public HTTPS School origin.
- [Production job 100624724669](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33747950711/job/100624724669) completed cutover and origin boundary tests, then **0/5** at 11:13 UTC. Every account got start 303, authorize 303, callback 303, and `/login` instead of `/`. Tests discard query parameters and do not collect the School callback server error.
- Root agent reproduced the current production failure from a real owner browser session on 2026-09-07.
- School `app/auth/central/callback/route.ts` returns `/login?authError=central_denied` only from its catch block, and logs `school_sso.callback_failed` followed by the error message. Thus the failure is before completion of the callback, not merely a missing post-login UI link.
- The local `reproduce-sso.mjs` executes exact source functions against real in-memory SQLite and supplied synthetic successful exchange replies. Five role cases pass callback, reconciliation, session insert, cookie and session retrieval. This is local isolated evidence, not a live acceptance test.

## Compared runtime boundaries

| Item | Validated candidate | Production |
| --- | --- | --- |
| School code tree | `65d2ab6...` | `65d2ab6...` |
| Exchange URL | public ArtHello `/api/school-sso/exchange` | same |
| Exchange Origin | public School origin | same in exact source and cutover env |
| Exchange body | `code`, `codeVerifier`, exact Content-Length | same |
| Authorization code | ArtHello-generated, PKCE, 60-second TTL | same |
| Candidate database | newly initialized empty SQLite | pre-existing School SQLite copied/preserved by cutover |
| School host/network | ArtHello gateway Docker network | separate protected School Docker host/network |
| Callback transport | candidate loopback HTTP, manual cookie | public gateway HTTPS |
| Transaction secret | isolated temporary candidate value | preserved original School CENTRAL_ACCESS_SECRET; PASSWORDLESS_PEPPER, if any, also preserved |
| Public app origins | explicitly School/ArtHello public HTTPS | explicitly same values by cutover script |

Both authorize and exchange use the ArtHello D1 environment. Exchange atomically consumes an unexpired PKCE-bound code and rechecks current live access. School roles and payload field names agree with the broker. The candidate's real 5/5 result rules out a universal payload/role/session error in that source at validation time. Current production runtime/data/gateway differences remain unproven until logs are read.

## Minimal next diagnostic

`school-sso-readonly-diagnostic.sh` runs on the **existing protected School Docker host**. Use the existing `production-ru` SSH transport and pinned ED25519 host fingerprint; retain every environment protection and approval gate. Do not use this as a reason to rearm old deployment workflows, change reviewers, inject sessions, or bypass login.

It checks the fixed `school-1-11` production container, reports selected image/runtime metadata, classifies recent callback errors into fixed categories, checks public ArtHello DNS/HTTPS health from inside School, and opens the School database read-only to inspect required schema and reconciliation counts. It prints no raw Docker environment, cookies, auth codes, tokens, contact values, user names or arbitrary server error messages.

After the script has been copied through that existing transport to a temporary, owner-only path on the School host, execute:

```sh
bash /tmp/school-sso-readonly-diagnostic.sh
```

Expected evidence distinguishes `fetch_failed`/TLS/network, transaction cookie/state, exchange rejection, and database/identity reconciliation. Only then should a narrow functional fix be selected. If classification is `other_callback_error`, refine the allowlist against protected server logs without printing the raw message.

## Validation performed here

```sh
bash -n school-sso-readonly-diagnostic.sh
bash school-sso-readonly-diagnostic.sh --self-test
node reproduce-sso.mjs
```

All passed. The diagnostic has **not** run on production; it has no proof of the root cause yet.
