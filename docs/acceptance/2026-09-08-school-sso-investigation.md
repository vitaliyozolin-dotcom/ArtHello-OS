# School SSO continuation — 2026-09-08

## Status

The production cause is still unproven. No School/ArtHello authentication code, database, secrets, server configuration, permissions, or deployment gates were changed.

Evidence reviewed: the recovery branch `docs/acceptance/2026-09-07-school-sso-investigation.md`, exact School source `54242340f2d9b6a9887d69ecc03520ddf9f7982c`, ArtHello main `9e4c49161e643997fe821a91b84c60c6e38ede33` SSO routes, and the previous cutover/validation scripts. The known candidate succeeded for five real identities; the production callback failed for all five immediately after cutover. The runtime/network/data distinction is still material.

## Attribution correction

`/login?authError=central_denied` alone does not establish that School rejected a callback. ArtHello `deploy/v52/overrides/app/api/school-sso/authorize/route.ts` also redirects directly to this path when current central access cannot be confirmed; it includes a `reason` query parameter. School's catch redirect has no `reason`. Check the presence of `reason` and whether `/auth/central/callback` was traversed. Never print the authorization code, state, cookies, or full callback URL.

## Fresh natural production reproduction

On 2026-09-08 the root agent restored the owner's existing ArtHello session through the protected browser authentication flow, opened Education and clicked the visible diary link. The resulting School URL had pathname `/login`, `authError=central_denied`, and no `reason` parameter. No code/state/cookie values were emitted. This fresh observation attributes the failure to School's callback catch path. It still does not distinguish a missing/invalid transaction cookie, exchange rejection, network failure or database reconciliation failure, because that catch intentionally returns the same user-facing error for each category.

The readonly host diagnostic remains necessary. Repeated browser login attempts or public School health checks cannot establish School-to-ArtHello outbound connectivity or expose the protected callback error category.

## Prepared diagnostic

Repository destination: `.github/scripts/school-sso-readonly-diagnostic.sh`.

Compared with the existing recovery script, the candidate adds:

- Docker network driver and `Internal` flag, without the full inspect output or addresses. The historical passing candidate and failing production used different Docker networks; this check distinguishes an egress hypothesis without changing networking.
- Effective process UID/GID and read/write access checks for the database directory, database, WAL and SHM files. The checks do not write files or change mode/ownership.
- Fixed callback-error categories for missing/invalid Content-Length, invalid JSON/media type, generic upstream unavailability, filesystem failures, and malformed cookie URI. Raw errors and contact values never reach output.
- `audit_log.created_at` in the prerequisite schema check because the diagnostic subsequently queries that column.

Use the existing protected School transport and pinned SSH host identity. The script is read-only and must not be used to rearm an expired deployment or bypass a platform gate. Run shortly after a natural failed browser login, then choose a functional correction from the observed error category. No credential/session injection is necessary.

## Validation

- `bash -n school-sso-readonly-diagnostic.sh`: PASS.
- `bash school-sso-readonly-diagnostic.sh --self-test`: PASS (`SCHOOL_SSO_DIAGNOSTIC_LOG_REDACTION=PASS`), including arbitrary private text and paths that must not be emitted.
- Extracted embedded Node module `node --input-type=module --check`: PASS.
- SHA256: `dc4de924582a62881942774a76748a0efea1cd000e385df14192dff8b83d046a`.
- Production execution: NOT RUN by this agent. Live root-cause classification and functional acceptance remain pending.

## Changed-file manifest

| Local file | Intended repository path | Purpose |
| --- | --- | --- |
| `school-sso-readonly-diagnostic.sh` | `.github/scripts/school-sso-readonly-diagnostic.sh` | Expanded read-only diagnostic |
| `README.md` | `docs/acceptance/2026-09-08-school-sso-investigation.md` | Evidence and pending acceptance |
