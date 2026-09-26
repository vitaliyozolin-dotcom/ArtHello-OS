# Replay packaging and runner correction
The original XCTest startup/Keychain regression has already passed in native build 36268330034. Replay 36270011050 timed out during cold simulator startup before producing its test log. Split cold boot (15-minute bound, persisted diagnostics) from XCTest (7-minute bound), retaining the 10-minute end-to-end scenario bound.

Restore the exact SHA-verified app with macOS ditto rather than Python ZIP extraction. This preserves executable modes and framework symlinks. Assert executable mode before installation. No runtime source changes, production changes, credentials, networking policy relaxation or assertion removal. The fixture remains private localhost HTTPS with synthetic data only.
