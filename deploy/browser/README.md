# Dedicated server browser — D076

The owner reported the dedicated employee setup complete. A fresh D074 job
`102209067350` at `2026-09-08T19:37:42.012Z` confirmed both protected secrets are
present and both fixed origins return200. It did not log in. D074's inventory
image variables remain absent; this implementation supplies and verifies the
bundle itself instead of asking the owner to build/configure it.

`check-arthello-server-browser.yml` builds on hosted runners with pinned checkout,
base image digest and package integrity. The same image must pass a real Chromium
sandbox check and a synthetic natural navigation fixture before upload. PRs get
no production Environment. An owner main dispatch or successful owner Quality
push-main whose commit begins `D076: natural server browser` may use the protected
gateway job. The gateway checks current main before checkout and verifies the
archive against the producing job's output plus the portable image fingerprint.
No cross-host assumption that Docker image IDs are identical is made (D045).

The test receives only `ARTHELLO_E2E_LOGIN` and `ARTHELLO_E2E_PASSWORD` through stdin.
It checks non-owner status, permanent password and explicit Education grant from
the ordinary login response. The owner's completion is evidence of dedicated
provisioning; an arbitrary Environment confirmation string is not fabricated.
It follows the actual Education button and observes fixed names of natural SSO
redirect steps. School contact must match the test login and have a staff role.
When Finance is not assigned, its navigation must be absent and GET API return403.
The feedback button's presence is reported without creating a feedback record.

Production network requests are restricted to the two HTTPS origins; only GET,
HEAD and one ArtHello login POST are permitted. TLS errors remain fatal and
service workers, downloads and WebSockets are blocked. The container has no
application mounts or socket; Chromium's namespace/PID/seccomp sandbox is tested
before the credential input is used. Sessions exist only in a temporary browser
context, not a saved cookie jar. Normal auth/SSO server-side effects are expected;
this is not D075's strict read-only database observation.

Only fixed statuses leave the process. No exception messages, contacts, finance
values, diary content, screenshots, traces or full redirect URLs are printed.
The synthetic fixture is explicitly not live acceptance. A live pass does not
itself create the release schema3 receipt or prove bank/AlfaCRM/backup behavior.
Those checks and exact School-repair/release identities remain separate gates.

## Workflow audit before addition

| Workflow | Trigger/runner | Production access and locks | Decision |
| --- | --- | --- | --- |
| New server browser | PR: hosted only; owner main: hosted then gateway | production-ru only on main job; gateway workflow lock + School job lock | Add; archive/image verified before one dedicated login |
| D074 prerequisites | Quality main/owner dispatch; gateway | Existing Environment + shared locks; inventory only | Preserve; historical inventory contract unchanged |
| D075 data observation | Explicit D075 Quality prefix; gateway | Existing Environment + shared locks; FD-gated read-only aggregates | Preserve; no rearm or health wake |
| Existing R1–R7 consumers | Verify events; gateway | Pinned one-shot identities/replay checks | Preserve; no new binding/replay/cutover |
| Quality/Proof/Verify | Hosted CI | No production account for PRs | Preserve full gates |

`.github/CODEOWNERS` covers `.github/` and `deploy/` with the owner. No old
workflow, runner permission, sudo policy, School route or volume is changed.
Playwright Docker guidance: https://playwright.dev/docs/docker.
The seccomp profile starts from microsoft/playwright commit
`26a9e470a7b3c7822084b09fb7f13902c5f37b51`, `utils/docker/seccomp_profile.json`.
The hosted attempt102215375681 exposed `sys_chroot` rejection: the upstream
profile permits chroot only when the *outer container* has SYS_CHROOT, whereas
Chromium needs it inside its own user namespace and this launcher drops all outer
capabilities. This profile permits the syscall without granting any capability.
Linux still requires SYS_CHROOT in the calling namespace. The entrypoint verifies
outer CapEff=0, NoNewPrivs=1 and Seccomp=2 before browser launch; the browser must
then prove its own namespace/PID/seccomp sandbox. No SYS_ADMIN, SYS_CHROOT or host
privilege is added to the container. Secret-free hosted fixture failures may
include synthetic-only browser diagnostics; production errors stay sanitized.
The pinned Chromium reports `Layer 1 Sandbox: Namespace`; its actual table is
checked along with PID/network namespaces and seccomp, not an obsolete UI label.
Russian fixture HTML explicitly declares UTF-8 so accessible button names match
the real UI. School's canonical `tech_admin` role is included (PR368 review).

The real fixture exposed a second issue: Chromium follows a303 without another
Playwright route callback. A fixed-authority local CONNECT proxy now also limits
destinations to the two HTTPS hostnames on port443 at the known gateway IP. It
tunnels end-to-end TLS without decrypting/logging requests and does not trust DNS
or caller-selected destinations. The hosted fixture uses local HTTPS sockets and
real303 responses inside network:none, with a throwaway self-signed certificate;
only that synthetic context ignores its test certificate. It tests foreign303
denial as well as the natural UI flow. Production TLS verification stays enabled.
