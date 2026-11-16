Pod::Spec.new do |s|
  s.name           = 'CliffwordNative'
  s.version        = '1.0.0'
  s.summary        = 'Cliffword native helpers: streaming file SHA-256, backup exclusion, free space.'
  s.description    = 'Small local Expo module of the Cliffword app (app/modules/cliffword-native).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
