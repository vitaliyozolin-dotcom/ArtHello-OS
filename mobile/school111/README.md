# School 1–11 native iOS candidate

Isolated React Native + Expo 57 app. No production changes, secrets, real children or new privileges. Existing school backend is reused. Backend additions are an uninstalled candidate. Signing, App Store upload and device acceptance are not implied.

The five binary source.part-* files concatenate into an XZ-compressed JSON dictionary of 38 UTF-8 source files. This compact transport is SHA-256 verified before extraction. The workflow produces a readable source ZIP with package-lock.json and evidence; no node_modules, fonts, credentials or real school databases are included.

Packed SHA256: eaa2985bad3525fa80da2919023b2fe84abe8e0774a7a6efa7d2f0c31b760cf8
Decoded SHA256: c9b54acf89706ebf4b9612c8f2fb044b0d9af9ea545597b44ba665b81a8743f1

Native simulator compilation is separate from signed device IPA and TestFlight. See workflow evidence for actual results. Source contract reviewed at 13187fe0e69f9c45a4067ae969ad272d82e3acab; not a claim that this revision is currently deployed.
