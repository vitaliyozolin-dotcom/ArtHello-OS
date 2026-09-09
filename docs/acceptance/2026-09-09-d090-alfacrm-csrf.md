# D090 / AlfaCRM CSRF — preparation, 2026-09-09

Status: local fix verified and independently reviewed; hosted full application build/tests and live behavior pending. No production, upstream or GitHub action was performed in this preparation.

Accepted source `77f26ec9bcba7233f39d5e8cb9f59c276bc8c1ed`, tree `ac3fcaac06acf33bf9ee32e438d0c040adb38fd7`: the wizard used `x-arthello-csrf` from `arthello_csrf`; the actual server issues `__Host-arthello_csrf` and verifies `x-csrf-token`. Exactly two code/test paths change under `deploy/v52/overrides/`:

- `app/components/AlfaCrmSetupWizard.tsx`: one-line header/cookie correction. Base blob `d298e5142828905a33d31bd7e259ec99b3c8ff40`, candidate blob `dbadac345fee7ddf167c1ec0d1a876c3a42be227`.
- `tests/alfacrm-csrf-contract.test.mjs`: executes the actual sender and cookie reader against unchanged server cookie writer, CSRF verifier and origin guard. Candidate blob `343556a88fb87fdc5febbfbb9ab39eea6e36417e`.

`node --test deploy/v52/overrides/tests/alfacrm-csrf-contract.test.mjs` on Node24.19.0: RED 4 pass / 1 expected failure (`actual sender denied: csrf_denied`); GREEN 5 pass / 0 fail. Independent review confirmed the limited client/server contract fix. The positive case uses a server-issued cookie with a stale legacy cookie present; deny cases cover legacy-only cookie/header, wrong canonical token and cross-origin request. Endpoint, POST method, credentials, cache and payload are preserved. Local logs are indexed by the preparation manifest; no test was rerun for this documentation-only addition.

The real auth/access/request-security files remain unchanged. The fixture supplies synthetic document.cookie/session-CSRF context, UI callbacks and network responses; it does not exercise browser login, DB, upstream connectivity or import. No fallback or authentication widening is introduced. `ALFACRM_IMPORT_ENABLED`, branch/connection permissions and the finance-direction projection block remain in force.

Documentation is appended to the finalized D089 candidate, retaining D088/D089 verbatim. Final parent/source/tree and hosted evidence must be recorded after rebase on the actual main following D089. The existing application test aggregate includes `tests/*.test.mjs`; full hosted build/tests/CI and any guarded release/browser verification remain pending. A future successful CSRF request alone will not establish selective-import, money or whole-business acceptance.
