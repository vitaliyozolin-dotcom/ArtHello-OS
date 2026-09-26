# Build, TestFlight and public release are distinct gates

This workflow builds an actual iPhoneOS XCArchive, not an iOS Simulator application. It uses no Apple signing credentials and never uploads to Apple. The resulting archive is explicitly UNSIGNED and cannot be installed on a physical iPhone until signed with the publisher's valid certificate and provisioning profile.

The existing post-install hook required device acceptance before the first signed build. That circular dependency is removed: build-time identity and HTTPS prerequisites remain required; public-release evidence remains separately required by check-release.mjs. TestFlight uses distribution=store; it is not ad-hoc internal distribution. No public release is triggered automatically.

The archive and the simulator replay are separate operations, with independent concurrency groups. This archive job uses GitHub-hosted macOS with read-only repository/action permissions and no production access. Its source recovery input is pinned and SHA-256 verified; source/evidence must be persisted outside expiring CI artifacts. The earlier simulator replay does not validate code changes in a new device build; physical iPhone acceptance remains required after signing.

Official references checked 2026-09-27: https://docs.expo.dev/submit/testflight/ and https://docs.expo.dev/submit/ios-manual/ .
