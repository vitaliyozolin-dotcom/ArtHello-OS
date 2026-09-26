require 'xcodeproj'
require 'fileutils'
project_path = Dir['ios/*.xcodeproj'].first or abort 'Missing native project'
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.product_type == 'com.apple.product-type.application' } or abort 'Missing application'
name = 'School111UITests'
abort 'Unexpected existing UI target' if project.targets.any? { |t| t.name == name }
target = project.new_target(:ui_test_bundle, name, :ios, '16.4')
FileUtils.mkdir_p("ios/#{name}")
FileUtils.cp('ci/NativeDiaryTests.swift', "ios/#{name}/NativeDiaryTests.swift")
group = project.main_group.new_group(name, name)
ref = group.new_file('NativeDiaryTests.swift')
target.source_build_phase.add_file_reference(ref)
target.add_dependency(app)
target.product_reference.path = "#{name}.xctest"
target.build_configurations.each do |c|
  c.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
  c.build_settings['PRODUCT_MODULE_NAME'] = name
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'ru.arthello.school111.uitests'
  c.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  c.build_settings['SWIFT_VERSION'] = '5.0'
  c.build_settings['TEST_TARGET_NAME'] = app.name
  c.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  c.build_settings['CODE_SIGN_IDENTITY'] = '-'
  c.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
  c.build_settings['DEVELOPMENT_TEAM'] = ''
  c.build_settings['SWIFT_INSTALL_OBJC_HEADER'] = 'NO'
end
# Build only the architecture of this macOS CI host for simulator acceptance.
# Conditional setting cannot affect an archive targeting iphoneos.
project.build_configurations.each do |c|
  c.build_settings['ARCHS[sdk=iphonesimulator*]'] = 'arm64'
end
project.root_object.attributes['TargetAttributes'] ||= {}
project.root_object.attributes['TargetAttributes'][target.uuid] = { 'TestTargetID' => app.uuid }
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.set_launch_target(app)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(project_path, 'School111Acceptance', true)
puts "UI target #{name} created for #{app.name}; simulator signing only"
