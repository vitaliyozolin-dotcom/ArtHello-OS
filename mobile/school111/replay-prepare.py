from pathlib import Path, PurePosixPath
import hashlib, zipfile, shutil, json, subprocess, os
inputs = [
 ('input/source/school111-ios-keychain-fixed-source.zip','db9adca2f847ac23dcef4ed2b4d31bdf46025adc55aba6332654a643fc4978bf','source'),
 ('input/app/school111-production-origin-simulator.app.zip','fefea00f876bab0d636d8189f92b0143cd8c4edb8a5b2c2c478935e793402ab8','app')]
for filename, digest, folder in inputs:
 p = Path(filename)
 assert hashlib.sha256(p.read_bytes()).hexdigest() == digest
 with zipfile.ZipFile(p) as z:
  assert all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts for n in z.namelist())
  if folder == 'source': z.extractall('work/source')
 if folder == 'app': subprocess.run(['ditto','-x','-k',str(p),'work/app'],check=True)
assert os.access('work/app/111.app/111',os.X_OK), 'App executable permission missing'
shutil.move('work/source/school111-native','native-app')
root = Path('native-app')
shutil.move(root/'proof',root/'prior-proof-r2')
shutil.move(root/'preview',root/'prior-preview-r2')
(root/'proof').mkdir(); (root/'preview').mkdir()
p=root/'ci/NativeDiaryTests.swift';s=p.read_text()
old='func button(_ id: String) -> XCUIElement { app.buttons.matching(identifier: id).firstMatch }'
new='func button(_ id: String) -> XCUIElement { id.hasPrefix("tab-") ? element(id) : app.buttons.matching(identifier: id).firstMatch }'
assert s.count(old)==1
s=s.replace(old,new)
old='''  func signIn(password: String = "ExamplePassword123") {
    let identifier = app.textFields["login-identifier"]
    XCTAssertTrue(identifier.waitForExistence(timeout: 20))
    tap(identifier); identifier.typeText("parent@example.invalid")
    let field = app.secureTextFields["login-password"]
    tap(field); field.typeText(password)
    tap(button("login-submit"))
  }'''
new='''  // Synthesize real keyboard events, not programmatic state injection.
  // The previous unchecked burst silently dropped characters in simulator CI.
  // Wait for each character to settle and assert the exact value before submit.
  // Do not retry or silently repair a mismatch: it must fail this acceptance.
  func typeVerified(_ text: String, into field: XCUIElement, secure: Bool = false) {
    tap(field)
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
    let initial = field.value as? String ?? ""
    XCTAssertTrue(initial.isEmpty || initial == field.placeholderValue, "Expected a fresh input field")
    var expected = ""
    for character in text {
      field.typeText(String(character))
      expected += String(character)
      let predicate = secure
        ? NSPredicate { element, _ in ((element as? XCUIElement)?.value as? String)?.count == expected.count }
        : NSPredicate(format: "value == %@", expected)
      let settled = XCTNSPredicateExpectation(predicate: predicate, object: field)
      XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 3), .completed, "Keyboard value failed to settle")
    }
    if !secure { XCTAssertEqual(field.value as? String, text) }
  }
  func signIn(password: String = "ExamplePassword123") {
    let identifier = app.textFields["login-identifier"]
    XCTAssertTrue(identifier.waitForExistence(timeout: 20))
    typeVerified("parent@example.invalid", into: identifier)
    let field = app.secureTextFields["login-password"]
    typeVerified(password, into: field, secure: true)
    XCTAssertEqual(identifier.value as? String, "parent@example.invalid", "Login changed while entering password")
    tap(button("login-submit"))
  }'''
assert s.count(old)==1
s=s.replace(old,new)
p.write_text(s)
shutil.copy(p,root/'ios/School111UITests/NativeDiaryTests.swift')
shutil.copy('mobile/school111/replay-harness.rb',root/'ci/replay-harness.rb')
shutil.copy('mobile/school111/fixture-server.mts',root/'fixture-server.mts')
shutil.copytree('work/app/111.app',root/'ci/real-production-app/111.app',symlinks=True)
assert os.access(root/'ci/real-production-app/111.app/111',os.X_OK)
shutil.copy('input/app/school111-production-origin-simulator.app.zip',root/'school111-production-origin-simulator.app.zip')
w=Path('.github/workflows/school111-native-ios.yml')
if not w.exists():
 data=subprocess.check_output(['git','show','HEAD:'+w.as_posix()])
 assert data.startswith(b'name: School111 native Keychain acceptance replay')
 w.parent.mkdir(parents=True,exist_ok=True);w.write_bytes(data)
(root/'proof/input-provenance.json').write_text(json.dumps({'compiledBuildRun':36268330034,'compiledCommit':'2d18f6d8cb42c44a72f36f24880225ea5444625d','appArchiveSHA256':inputs[1][1],'sourceArchiveSHA256':inputs[0][1],'runtimeSourceChanges':False,'executableModesPreserved':True,'testChange':'Native tab locator plus keyboard-driven input with exact value and secure length assertions; no state injection or retry'},indent=2))
print('Verified native artifact and source. Real keyboard input checked before submitting; runtime code unchanged.')
