# iOS signing fix and native acceptance

The original compilation explicitly used CODE_SIGNING_ALLOWED=NO. That removed the simulated entitlements required by Security/Keychain. Adding iOS application-identifier and keychain-access-groups to a post-build macOS code signature was also incorrect for a simulator executable: the subsequent launch was denied.

The fix is to rebuild through Xcode with normal simulator ad-hoc signing. Xcode must generate and embed the simulated entitlements in the Mach-O executable. Do not substitute a plaintext cache or swallow SecureStore failures.

The source patch only converts internal exception traces to safe messages and adds regression tests; an error banner still causes native startup acceptance to fail. Test success requires actual native Keychain persistence across process termination, logout persistence, native HTTPS and cookie transport. UI tests use only an isolated, temporary localhost TLS server with fictional families; it is not deployed into the school backend or embedded into the production application.

The existing permanent native workflow is corrected on an isolated fix branch. Runners are GitHub-hosted macOS, repository/action permissions are read-only, no Apple or production secrets are used, no deployment or purchase is performed. Source artifact 36262379555 is a pinned recovery input and its archive digest is checked; the resulting readable source archive must be persisted before the old CI artifact expires. Prior one-shot signing workflows remain dormant on their own branches and are not production mechanisms.

A simulator PASS is not proof of an Apple-signed device IPA, TestFlight release, real school account acceptance or App Store approval. Publisher identity, live data isolation, deletion operations and published privacy documents retain their existing unverified release gates until separately demonstrated.
