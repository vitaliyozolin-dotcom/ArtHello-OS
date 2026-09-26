require 'xcodeproj'
require 'fileutils'
# Lightweight test host. The real School111 app is installed separately from
# the SHA-verified native artifact; it is never substituted by this host.
base='ci/harness';FileUtils.mkdir_p(base)
File.write("#{base}/Host.swift", <<~SWIFT)
import UIKit
@main final class HostDelegate: UIResponder, UIApplicationDelegate {
 var window: UIWindow?
 func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
  window = UIWindow(frame: UIScreen.main.bounds)
  window?.rootViewController = UIViewController()
  window?.makeKeyAndVisible()
  return true
 }
}
SWIFT
project=Xcodeproj::Project.new("#{base}/AcceptanceHost.xcodeproj")
app=project.new_target(:application,'AcceptanceHost',:ios,'16.4')
ref=project.main_group.new_file('Host.swift');app.source_build_phase.add_file_reference(ref)
test=project.new_target(:ui_test_bundle,'School111UITests',:ios,'16.4')
FileUtils.cp('ci/NativeDiaryTests.swift',"#{base}/NativeDiaryTests.swift")
ref=project.main_group.new_file('NativeDiaryTests.swift');test.source_build_phase.add_file_reference(ref)
test.add_dependency(app)
[app,test].each do |target|
 target.build_configurations.each do |c|
  c.build_settings['PRODUCT_NAME']='$(TARGET_NAME)'
  c.build_settings['PRODUCT_MODULE_NAME']=target.name
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER']= target==app ? 'ru.arthello.school111.acceptancehost' : 'ru.arthello.school111.acceptancehost.tests'
  c.build_settings['GENERATE_INFOPLIST_FILE']='YES'
  c.build_settings['SWIFT_VERSION']='5.0'
  c.build_settings['TARGETED_DEVICE_FAMILY']='1,2'
  c.build_settings['CODE_SIGN_IDENTITY']='-'
  c.build_settings['CODE_SIGN_STYLE']='Automatic'
  c.build_settings['DEVELOPMENT_TEAM']=''
  c.build_settings['SWIFT_INSTALL_OBJC_HEADER']='NO'
  c.build_settings['ARCHS[sdk=iphonesimulator*]']='arm64'
 end
end
test.product_reference.path='School111UITests.xctest'
test.build_configurations.each { |c| c.build_settings['TEST_TARGET_NAME']=app.name }
app.build_configurations.each do |c|
 c.build_settings['INFOPLIST_KEY_UILaunchScreen_Generation']='YES'
 c.build_settings['INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents']='YES'
end
project.root_object.attributes['TargetAttributes']={test.uuid=>{'TestTargetID'=>app.uuid}}
project.save
scheme=Xcodeproj::XCScheme.new
scheme.add_build_target(app);scheme.add_build_target(test);scheme.add_test_target(test);scheme.set_launch_target(app)
scheme.test_action.build_configuration='Release'
scheme.save_as("#{base}/AcceptanceHost.xcodeproj",'NativeAcceptance',true)
puts 'Native XCTest harness created; target application remains ru.arthello.school111'
