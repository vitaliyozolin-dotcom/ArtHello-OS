import XCTest
import Foundation

class DiaryUITestCase: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "ru.arthello.school111")
  override func setUpWithError() throws { continueAfterFailure = false }
  func element(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }
  func button(_ id: String) -> XCUIElement { app.buttons.matching(identifier: id).firstMatch }
  func tap(_ e: XCUIElement) {
    XCTAssertTrue(e.waitForExistence(timeout: 20), "Missing element: \(e)")
    for _ in 0..<7 { if e.isHittable { break }; app.swipeUp() }
    XCTAssertTrue(e.isHittable, "Element not tappable: \(e)")
    e.tap()
  }
  func capture(_ name: String) { let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a) }
  func assertNoError() { XCTAssertFalse(element("feedback-error").exists, "Unexpected error: \(app.debugDescription)") }
  func signIn(password: String = "ExamplePassword123") {
    let identifier = app.textFields["login-identifier"]
    XCTAssertTrue(identifier.waitForExistence(timeout: 20))
    tap(identifier); identifier.typeText("parent@example.invalid")
    let field = app.secureTextFields["login-password"]
    tap(field); field.typeText(password)
    tap(button("login-submit"))
  }
  func control(_ action: String) {
    let ready = expectation(description: "Local fixture control")
    URLSession.shared.dataTask(with: URL(string: "https://localhost:8843/test/" + action)!) { _, response, error in
      XCTAssertNil(error)
      XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
      ready.fulfill()
    }.resume()
    wait(for: [ready], timeout: 15)
  }
}

final class StartupTests: DiaryUITestCase {
  func testProductionLoginAndKeychainStartup() {
    app.launch()
    XCTAssertTrue(app.textFields["login-identifier"].waitForExistence(timeout: 30))
    tap(app.secureTextFields["login-password"])
    app.swipeUp()
    XCTAssertTrue(button("login-submit").exists)
    assertNoError()
    capture("production-login-no-keychain-error")
    app.terminate(); app.launch()
    XCTAssertTrue(app.textFields["login-identifier"].waitForExistence(timeout: 20))
    assertNoError()
    capture("production-relaunch-no-keychain-error")
  }
}

final class NativeDiaryTests: DiaryUITestCase {
  func testNativeKeychainSessionAndDiary() {
    control("reset")
    app.launch()
    signIn(password: "bad")
    XCTAssertTrue(element("feedback-error").waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts["Неверный логин или пароль"].exists)
    capture("01-rejected-login")
    app.terminate(); app.launch()
    signIn()
    XCTAssertTrue(button("tab-home").waitForExistence(timeout: 25), app.debugDescription)
    assertNoError(); capture("02-home")
    tap(button("tab-schedule")); capture("03-schedule")
    tap(button("tab-homework")); tap(button("Математика. Закрепляем умножение"))
    XCTAssertTrue(button("Поделиться заданием").waitForExistence(timeout: 10))
    capture("04-homework-detail"); tap(button("Закрыть"))
    tap(button("tab-grades")); XCTAssertTrue(app.staticTexts["4,8"].waitForExistence(timeout: 10)); capture("05-grades")
    tap(button("Выбрать ребёнка")); tap(button("Мария Примерова · 5"))
    XCTAssertTrue(button("tab-home").waitForExistence(timeout: 20)); assertNoError(); capture("06-second-child")
    tap(button("tab-more")); XCTAssertFalse(button("Ученики и классы").exists); capture("07-parent-sections")
    // This crosses the actual native Keychain write/read boundary, not a mock.
    app.terminate(); app.launch()
    XCTAssertTrue(button("tab-home").waitForExistence(timeout: 25), "Session was not restored from Keychain: \(app.debugDescription)")
    XCTAssertFalse(button("login-submit").exists); assertNoError(); capture("08-session-restored")
    tap(button("tab-more")); tap(button("Профиль")); tap(button("Выйти из дневника"))
    XCTAssertTrue(button("login-submit").waitForExistence(timeout: 20))
    app.terminate(); app.launch()
    XCTAssertTrue(button("login-submit").waitForExistence(timeout: 20)); XCTAssertFalse(button("tab-home").exists); assertNoError(); capture("09-logout-persisted")
    signIn(); XCTAssertTrue(button("tab-home").waitForExistence(timeout: 25))
    control("expire")
    XCUIDevice.shared.press(.home); app.activate()
    XCTAssertTrue(button("login-submit").waitForExistence(timeout: 25)); XCTAssertFalse(button("tab-home").exists); capture("10-expired-session")
    control("empty")
    app.terminate(); app.launch(); signIn()
    XCTAssertTrue(app.staticTexts["Ученик пока не привязан"].waitForExistence(timeout: 20)); capture("11-empty-family")
  }
}
