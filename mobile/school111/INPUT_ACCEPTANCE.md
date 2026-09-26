# Native input and interruption acceptance

Run 36271028429 passed native startup but its unchecked input burst lost characters. Run 36272289522 used actual keyboard events with exact per-character assertions: rejected password and successful authenticated login both worked. It then failed on the homework button because the iOS Save Password? system sheet covered the application (verified from the native screen recording, not inferred from element existence).

The canonical XCTest now handles only the exact Save Password?/Сохранить пароль? sheet by choosing Not Now/Не сейчас. It does not suppress other permission prompts, application errors, validation, network failures or test assertions. Existing application autofill and secure storage stay enabled. No password is saved by the test into the OS password manager.

Keyboard input is paced, not injected; exact login and secure-input length are verified before submit. No retries, session injection, backend relaxations or runtime app code changes. Simulator results are not real-device burst typing/autofill acceptance. The existing bounded replay remains isolated from production and Apple credentials.
