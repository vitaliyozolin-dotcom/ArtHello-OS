"""Apply bounded changes to the verified, standalone native candidate.
No server deployment, signing credentials or production data are involved.
"""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]).resolve()

def replace(path, old, new):
    p = root / path
    s = p.read_text()
    assert s.count(old) == 1, f'Source drift: {path}'
    p.write_text(s.replace(old, new))

(root / 'src/errors.ts').write_text('''import { DiaryError } from "./domain.ts";
/** Never render native exception traces, filesystem paths or secrets. */
export function safeErrorText(error: unknown): string {
  return error instanceof DiaryError
    ? error.message
    : "Не удалось выполнить действие. Повторите попытку.";
}
/** Fail closed. A Keychain failure must not switch to plaintext storage. */
export async function secureOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch { throw new DiaryError(
    "Не удалось открыть защищённое хранилище. Перезапустите приложение. Если ошибка повторяется, обратитесь в поддержку.",
    "secure_storage"
  ); }
}
''')
replace('src/App.tsx', 'const errorText = (e: unknown) =>\n  e instanceof Error ? e.message : "Не удалось выполнить действие";', 'const errorText = safeErrorText;')
replace('src/App.tsx', 'import { useColors, type Colors } from "./theme";', 'import { useColors, type Colors } from "./theme";\nimport { safeErrorText } from "./errors";')
replace('src/App.tsx', '      accessibilityLiveRegion="polite"', '      testID={tone === "error" ? "feedback-error" : "feedback-info"}\n      accessibilityLiveRegion="polite"')
replace('src/platform.ts', 'import { DiaryError } from "./domain";', 'import { DiaryError } from "./domain";\nimport { secureOperation } from "./errors";')
p = root / 'src/platform.ts'
s = p.read_text()
for old, new, count in [
 ('await SecureStore.getItemAsync(KEY, OPTIONS)', 'await secureOperation(() => SecureStore.getItemAsync(KEY, OPTIONS))', 1),
 ('await SecureStore.deleteItemAsync(KEY, OPTIONS)', 'await secureOperation(() => SecureStore.deleteItemAsync(KEY, OPTIONS))', 2),
 ('await SecureStore.setItemAsync(KEY, JSON.stringify(v), OPTIONS)', 'await secureOperation(() => SecureStore.setItemAsync(KEY, JSON.stringify(v), OPTIONS))', 1),
 ('await SecureStore.getItemAsync("school111.biometric")', 'await secureOperation(() => SecureStore.getItemAsync("school111.biometric", OPTIONS))', 1),
 ('await SecureStore.setItemAsync("school111.biometric", String(value), OPTIONS)', 'await secureOperation(() => SecureStore.setItemAsync("school111.biometric", String(value), OPTIONS))', 1),
]:
    assert s.count(old) == count, old
    s = s.replace(old, new)
p.write_text(s)
(root / 'tests/errors.test.ts').write_text('''import test from "node:test";
import assert from "node:assert/strict";
import { DiaryError } from "../src/domain.ts";
import { safeErrorText, secureOperation } from "../src/errors.ts";
test("unknown native errors do not leak traces", () => {
  const result = safeErrorText(new Error("FunctionCallException secret-token /private/ExpoSecureStore.swift:168"));
  assert.equal(result, "Не удалось выполнить действие. Повторите попытку.");
});
test("controlled application errors remain useful", () => {
  assert.equal(safeErrorText(new DiaryError("Введите логин", "validation")), "Введите логин");
});
test("keychain operation preserves a successful value", async () => {
  assert.equal(await secureOperation(async () => "opaque-session"), "opaque-session");
});
test("keychain rejection fails closed and hides native details", async () => {
  await assert.rejects(secureOperation(async () => { throw new Error("entitlement missing SECRET"); }),
    (e: unknown) => e instanceof DiaryError && e.code === "secure_storage" && !e.message.includes("SECRET"));
});
''')
# The existing Xcode project was generated without signatures. Recreate it with
# Expo, then let Xcode generate simulated entitlements at link time.
# Do not post-sign a simulator binary using iOS-only entitlements.
for name in ['ios', 'dist', 'preview', 'proof']:
    p = root / name
    if p.exists(): shutil.rmtree(p)
(root / 'proof').mkdir()
(root / 'preview').mkdir()
print('Patched secure error handling. Keychain remains mandatory; no insecure fallback.')
