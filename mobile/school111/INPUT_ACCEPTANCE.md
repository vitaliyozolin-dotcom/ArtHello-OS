# Native input acceptance correction

Run 36271028429 passed production startup and native signing, then failed the synthetic login scenario. Captured native input was pexample.invalid rather than parent@example.invalid; the synthetic backend correctly rejected it. No authentication or Keychain success is claimed from that failure.

The replacement XCTest input helper uses native keyboard events with a settle assertion after each character, checks exact login before submission and verifies secure-input length. It does not set application state, inject a session, weaken backend validation or automatically retry a mismatch. A successful run proves paced native keyboard input and the subsequent session lifecycle on the simulator; it does not prove every real-device keyboard, autofill or burst-typing scenario.

The existing bounded replay workflow remains the only active workflow for this fix branch. No production actions, Apple credentials, new permissions, external notifications or paid-service purchases are involved.
