# Deterministic manual-entry CI environment

The native Save Password sheet is presented by an OS remote view service on this simulator runtime. The app and SpringBoard accessibility trees did not expose that sheet to the test monitor; runs 36272289522 and 36273070809 therefore stopped before completing session acceptance.

For the isolated manual-entry/session test only, set com.apple.WebUI / AutoFillPasswords to integer 0 on the ephemeral booted simulator, before launching the diary. Read the setting back and preserve its value in proof. This matches Appium's setAutoFillPasswords implementation, not an invented application workaround:
https://github.com/appium/appium-ios-simulator/blob/f243974e2569ee99d1cd843b5d0228a555a0badf/lib/extensions/settings.ts
https://github.com/appium/appium-xcuitest-driver/pull/1972

No application source, login validation, session token, SecureStore behavior, native Keychain, TLS verification, server authorization or UI assertions are changed. No permission or authentication prompt is automatically approved. The setting affects only this disposable simulator, never a user phone or production service.

Coverage limitation is explicit: this run tests paced manual keyboard input and the diary/session lifecycle, not password-manager save/autofill or rapid typing on a real device. Those acceptance gates remain open. A passing simulator test does not imply TestFlight, an Apple-signed IPA or App Store readiness.
