Pod::Spec.new do |s|
  s.name           = 'CliffwordMusic'
  s.version        = '1.0.0'
  s.summary        = 'Cliffword Apple Music: MusicKit library browsing and playback with a line-end pause timer.'
  s.description    = 'Small local Expo module of the Cliffword app (app/modules/cliffword-music), iOS only.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # ExpoModulesCore 58 needs iOS 16.4; MusicLibraryRequest needs iOS 16.
  s.platforms      = {
    :ios => '16.4'
  }
  # Swift 5 language mode: ExpoModulesCore itself is Swift 6, but this module keeps its own
  # main-thread discipline (see MusicController.swift) instead of strict concurrency checking.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.frameworks     = 'MusicKit', 'Combine'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
