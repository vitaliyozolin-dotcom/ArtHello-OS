# School SSO network repair for D064

This is a configuration-only repair for the production diagnosis recorded by run 34193103822 / job 101955030295: School's only Docker network, `arthello-os_backend`, is internal; the central ArtHello hostname fails DNS lookup with `EAI_AGAIN` from School. School source, image, filesystem permissions and local schema are already verified. There is no authentication-code change.

The new relay reuses the already loaded immutable School image, starts only Node, and receives none of School's runtime environment, secrets or data volumes. It binds its own backend IPv4 on port 443 and accepts only the current School IPv4 and its own backend address (for health checks). It forwards unchanged TCP bytes only to `188.225.38.55:443`. School keeps the original hostname and performs normal TLS certificate validation. This allows HTTPS to that address, not a path-level restriction inside encrypted traffic.

The controller creates one owned egress bridge and one owned relay container. It adds the exact ArtHello DNS alias to the relay endpoint on the existing internal bridge. Docker aliases are visible to all peers on that bridge; foreign peers are rejected by the relay. The shared bridge's `Internal` flag and all School container settings stay unchanged. A free static backend address is selected from the inspected IPv4 IPAM pool, excluding peers, gateway and auxiliary reservations; Docker must successfully allocate and report that same address at start.

The DNS alias is assigned before relay health checks. The prior diagnosed state is already broken. If setup or the real-School normal-DNS/TLS health probe fails, cleanup removes only relay/network IDs created by that attempt with matching owner labels. No School restart, volume operation, database restore, image pull or build occurs. Once verified state is durably published, a later browser-acceptance abort keeps the repair. Retry checks the same exact configuration and performs only read-only checks; no recreation or update is allowed. A recreated School container, changed School IP, changed network identity, changed relay IP or changed relay files causes refusal. Restarting the same containers with retained addresses is compatible.

A root-owned metadata snapshot records School/network identities and configuration hashes before mutation. It contains no raw environment or database data. Reviewed manifest, runtime configuration and final state use no-replace publication, file fsync and directory fsync. This is a configuration rollback mechanism, not a substitute for the separate application/database backup feature.

## Transport contract

Four allowlisted files under `deploy/school/sso-relay/`:

- `manifest.json`
- `repair.py`
- `relay.mjs`
- `healthcheck.mjs`

Run the controller as root through the existing protected SSH transport, with these variables only:

- `REPAIR_BUNDLE_DIR`: private temporary bundle directory.
- `EXPECTED_REPAIR_CONFIG_SHA256`: SHA256 of UTF-8 `json.dumps(manifest, sort_keys=True, separators=(',', ':'))`, with no trailing newline.
- `RELEASE_SHA`: exact reviewed R2 main SHA.
- `RELEASE_RUN_ID`, `RELEASE_ATTEMPT`: positive decimal IDs.

The successful stdout JSON receipt has `state=verified`, `mode=created|verified-existing`, `repairConfigSha256`, `runtimeConfigSha256`, `schoolSourceSha`, `schoolImageId`, `schoolContainerId`, `relayContainerId`, `activatedAtUtc`, `verifiedAtUtc`, and `schemaVersion=1`. The activation time remains unchanged on retries. Failures print only an allowlisted generic reason; command stderr, TLS payloads and environment values are never emitted.

The R2 consumer must bind fresh natural browser Education→Diary acceptance to the exact R2 main SHA, School SHA and `repairConfigSha256`. Passing health checks proves network/TLS readiness, not completed SSO. ArtHello cutover remains blocked until that browser acceptance is verified.

## Verification

From `candidate/`:

```
node --test scripts/test/school-sso-relay.test.mjs
python3 -I scripts/test/school-sso-repair.test.py
```

Local results: 8 transport tests and 14 controller tests pass. Coverage includes byte-preserving half-close/backpressure, source ACL, connection/byte/idle/lifetime bounds, create→read-only retry, configuration tampering, scoped cleanup and publication fault handling. Python tests use a fake Docker engine and private temporary lock/state paths.

The release builder adds `scripts/test/school-sso-relay-docker-smoke.sh` as a mandatory hosted gate: actual non-root port 443 under cap-drop/read-only/sysctl constraints, Docker DNS, mocked TLS with certificate verification, and a rejected foreign peer. Docker is unavailable locally, so this gate is not claimed as passed here. The production image/netnamespace are additionally checked by the controller's live TLS health check and the real-School probe before receipt publication.
