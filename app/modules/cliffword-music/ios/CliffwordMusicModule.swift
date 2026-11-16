// Cliffword's Apple Music module (iOS 16.4+): MusicKit library browsing and playback for lyric
// cliffs, behind the app's MusicPlayer contract (src/adapters/music/MusicKitPlayer.ts).
//
// - authorizationStatus() (sync) / requestAuthorization(): MusicAuthorization.
// - subscription(): MusicSubscription.current (canPlayCatalog, hasCloudLibrary, canSubscribe).
// - librarySongs(query, order, limit, offset): MusicLibraryRequest<Song>, filtered by text and
//   sorted by date added, last played or title.
// - play(id), pause(), resume(), seek(sec), playbackState(): ApplicationMusicPlayer with a
//   one-song queue; each resolves the playback snapshot.
// - schedulePause(token, sec) / cancelScheduledPause(): a main-queue timer that pauses when
//   playbackTime reaches the target (checks every 10 ms in the last 300 ms) and sends
//   "onScheduledPause". setTimeUpdateInterval(ms): "onPlaybackTime" while playing (default 250).
// - "onPlaybackState" on every status or song change.
//
// Errors carry codes the JS side maps: ERR_MUSIC_NOT_AUTHORIZED, ERR_MUSIC_NOT_FOUND,
// ERR_MUSIC_NO_SUBSCRIPTION, ERR_MUSIC_FAILED.
//
// Nothing here touches ApplicationMusicPlayer before the first play() or schedulePause(), so the
// module costs nothing at launch.

import ExpoModulesCore
import MusicKit

public final class CliffwordMusicModule: Module {
  private let controller = MusicController()

  public func definition() -> ModuleDefinition {
    let controller = self.controller

    Name("CliffwordMusic")

    Events(MusicEvents.playbackState, MusicEvents.playbackTime, MusicEvents.scheduledPause)

    OnCreate {
      controller.emit = { [weak self] name, body in
        self?.sendEvent(name, body.mapValues { value -> Any? in value })
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        MainActor.assumeIsolated { controller.shutdown() }
      }
    }

    OnStartObserving(MusicEvents.playbackTime) {
      DispatchQueue.main.async {
        MainActor.assumeIsolated { controller.setTimeObserved(true) }
      }
    }

    OnStopObserving(MusicEvents.playbackTime) {
      DispatchQueue.main.async {
        MainActor.assumeIsolated { controller.setTimeObserved(false) }
      }
    }

    Function("authorizationStatus") { () -> String in
      return MusicMapping.authorization(MusicAuthorization.currentStatus)
    }

    AsyncFunction("requestAuthorization") { () async -> String in
      let status = await MusicAuthorization.request()
      return MusicMapping.authorization(status)
    }

    AsyncFunction("subscription") { () async throws -> [String: Any] in
      do {
        let subscription = try await MusicSubscription.current
        return [
          "canPlayCatalog": subscription.canPlayCatalogContent,
          "hasCloudLibrary": subscription.hasCloudLibraryEnabled,
          "canSubscribe": subscription.canBecomeSubscriber,
        ]
      } catch {
        throw MusicErrors.subscription(error)
      }
    }

    AsyncFunction("librarySongs") { (query: String?, order: String, limit: Int, offset: Int) async throws -> [[String: Any]] in
      try MusicErrors.requireAuthorized()
      let songs = try await controller.librarySongs(query: query, order: order, limit: limit, offset: offset)
      return songs.map { $0.dictionary }
    }

    AsyncFunction("play") { (songId: String) async throws -> [String: Any] in
      try MusicErrors.requireAuthorized()
      let snapshot = try await controller.play(songId: songId)
      return snapshot.dictionary
    }

    AsyncFunction("pause") { () async -> [String: Any] in
      let snapshot = await controller.pause()
      return snapshot.dictionary
    }

    AsyncFunction("resume") { () async throws -> [String: Any] in
      let snapshot = try await controller.resume()
      return snapshot.dictionary
    }

    AsyncFunction("seek") { (positionSec: Double) async -> [String: Any] in
      let snapshot = await controller.seek(to: positionSec)
      return snapshot.dictionary
    }

    AsyncFunction("playbackState") { () async -> [String: Any] in
      let snapshot = await controller.snapshot()
      return snapshot.dictionary
    }

    Function("setTimeUpdateInterval") { (ms: Double) in
      DispatchQueue.main.async {
        MainActor.assumeIsolated { controller.setTimeUpdateInterval(ms: ms) }
      }
    }

    Function("schedulePause") { (token: Int, targetSec: Double) in
      DispatchQueue.main.async {
        MainActor.assumeIsolated { controller.schedulePause(token: token, targetSec: targetSec) }
      }
    }

    Function("cancelScheduledPause") { () in
      DispatchQueue.main.async {
        MainActor.assumeIsolated { controller.cancelScheduledPause() }
      }
    }
  }
}

enum MusicEvents {
  static let playbackState = "onPlaybackState"
  static let playbackTime = "onPlaybackTime"
  static let scheduledPause = "onScheduledPause"
}

enum MusicErrors {
  static func notAuthorized() -> Exception {
    return Exception(name: "MusicNotAuthorized", description: "Apple Music access is not authorized", code: "ERR_MUSIC_NOT_AUTHORIZED")
  }

  static func notFound(_ songId: String) -> Exception {
    return Exception(name: "MusicSongNotFound", description: "No library song with id \(songId)", code: "ERR_MUSIC_NOT_FOUND")
  }

  static func notPlayable(_ songId: String) -> Exception {
    return Exception(name: "MusicSongNotPlayable", description: "The library song \(songId) cannot be played", code: "ERR_MUSIC_NOT_FOUND")
  }

  static func noSubscription(_ error: Error) -> Exception {
    return Exception(
      name: "MusicNoSubscription",
      description: "Playing this song needs an Apple Music subscription (\(error.localizedDescription))",
      code: "ERR_MUSIC_NO_SUBSCRIPTION"
    )
  }

  static func failed(_ error: Error) -> Exception {
    return Exception(name: "MusicFailed", description: error.localizedDescription, code: "ERR_MUSIC_FAILED")
  }

  static func requireAuthorized() throws {
    guard MusicAuthorization.currentStatus == .authorized else {
      throw notAuthorized()
    }
  }

  static func subscription(_ error: Error) -> Exception {
    if let subscriptionError = error as? MusicSubscription.Error {
      switch subscriptionError {
      case .permissionDenied, .privacyAcknowledgementRequired:
        return notAuthorized()
      default:
        return failed(error)
      }
    }
    return failed(error)
  }

  /// A playback failure: "no subscription" when the account cannot play catalog content.
  static func playback(_ error: Error) async -> Exception {
    if let subscription = try? await MusicSubscription.current, !subscription.canPlayCatalogContent {
      return noSubscription(error)
    }
    return failed(error)
  }
}

enum MusicMapping {
  static func authorization(_ status: MusicAuthorization.Status) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    @unknown default: return "denied"
    }
  }

  static func status(_ status: MusicKit.MusicPlayer.PlaybackStatus) -> String {
    switch status {
    case .playing: return "playing"
    case .paused: return "paused"
    case .stopped: return "stopped"
    case .interrupted: return "interrupted"
    case .seekingForward, .seekingBackward: return "seeking"
    @unknown default: return "paused"
    }
  }
}
