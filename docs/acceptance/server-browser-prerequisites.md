# Server browser check: prerequisite inventory

This is a prerequisite diagnostic, **not a browser test and not release acceptance**.
It uses the existing `arthello-gateway` runner and `production-ru` Environment.
No production database, runtime secret, account, Docker container or network is modified.
The script does not install packages, pull/build/run images, log in or write an SSO receipt.

## Authorized scope

On 2026-09-08 Vitaliy answered “Тогда действуй” to the proposal to prepare isolated
server-side browser verification with a dedicated test account. This authorizes
preparing that path; it does not provide missing credentials or waive any release gate.
The decision and AI contract are appended to `docs/PROJECT_PASSPORT_PRODUCTION_RU.md`.

## Inputs in the protected Environment

| Type | Name | Meaning |
| --- | --- | --- |
| Secret | `ARTHELLO_E2E_LOGIN` | Dedicated active ArtHello test login, never the canonical owner or a reused employee login |
| Secret | `ARTHELLO_E2E_PASSWORD` | Test account password after any mandatory first-password change; never a deployment/API/bank key |
| Variable | `ARTHELLO_E2E_ACCOUNT_CONFIRMED` | `dedicated-active-education-account-v1`, set only after confirming its Education and School grants |
| Variable | `ARTHELLO_E2E_IMAGE_ID` | Exact locally loaded `sha256:…` of a separately verified browser image, not a tag |
| Variable | `ARTHELLO_E2E_IMAGE_SOURCE_SHA` | Source SHA associated with that browser image's immutable evidence |

No values are recovered from existing production containers, password hashes, databases,
other employees or unrelated configuration. Missing inputs remain blockers. Do not create
values for `ACCOUNT_CONFIRMED` or source identity simply to make the diagnostic green.

The future browser image contract is Linux/amd64, `USER 1000:1000`, entrypoint
`["node", "/opt/arthello-e2e/run.mjs"]`, role label `org.arthello.role=e2e-browser`
and `org.opencontainers.image.revision` equal to the configured source SHA.
This change does **not** build/provision that image or its browser test entrypoint.
Image metadata matching is only inventory, never proof of browser sandboxing or tests.
A later reviewed launcher must provide a read-only rootfs, bounded CPU/memory/PIDs,
private ephemeral profile, Chromium sandbox, no privileged mode, no host filesystem,
no Docker socket, no production database/secret mounts, strict TLS, and only scoped
test credentials. No traces, screenshots, cookies or full callback URLs may enter public logs.

## Execution and interpretation

After a successful main Quality run, the diagnostic verifies the current main SHA
before executing repository source. A manual run is also available for the owner on main.
PR/fork events cannot run on the production-capable runner. Existing gateway and School
locks are shared. Credentials are passed only to the final allowlisted inventory step.
Results are printed as sanitized statuses and counts only; no Actions artifact is uploaded.
The gateway historically has no system Node (D-056). The workflow uses an existing
Node 22+ or the runner's already bundled Node 24; it never installs a host runtime.
If neither is available, it stops before checkout or secret access.

`blocked` (exit 2) identifies missing/invalid prerequisites or failed endpoint probes.
`prerequisites_observed` (exit 0) does **not** mean login succeeded: `liveAcceptance`
always remains `not_run`. HEAD 200 and HTTP redirects are transport observations only.
There is no automatic deployment or alteration of the R7 receipt, age or identity rules.

## Remaining work

1. Obtain the actual prerequisite result on the gateway.
2. Provision the separate browser bundle off the production host and the dedicated
   account through an approved account-management path; do not reuse an owner's session.
3. Implement and run natural browser login → Education → diary. Preserve one-time
   state/PKCE/cookies and check authenticated School identity without session injection.
4. Test permissions/feedback/backups in an isolated fixture; this restricted test account
   cannot establish owner-only production acceptance. Actual bank/AlfaCRM data coverage,
   sums, deduplication, selected scopes and owner-only operations need their own authorized
   checks. No financial sync/payment or destructive restore is authorized by this diagnostic.
5. Produce fresh before/after release evidence, then follow the existing guarded release.

Local unit checks use synthetic input and fake transports only. They do not validate
server connectivity, image availability, credentials or any of the six live scenarios.
