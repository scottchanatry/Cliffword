// The player side of CliffwordMusicModule.
//
// Threading: everything that touches ApplicationMusicPlayer, the timers or the Combine
// subscriptions runs on the main thread. Those methods are @MainActor; the module reaches them
// with `await` (AsyncFunction) or DispatchQueue.main plus MainActor.assumeIsolated (Function,
// lifecycle). The library cache is the only state used off the main thread and sits behind a
// lock. That discipline is why the class is @unchecked Sendable.
//
// Line-end pause: schedulePause(token, targetSec) keeps one target. While playing, the timer
// sleeps until 300 ms before the target (at most 1 s at a time, so seeks and stalls are noticed),
// then checks every 10 ms and sleeps exactly the remainder for the last step, and pauses when
// fewer than 3 ms remain. The target stays armed while paused. A position more than 250 ms past
// the target (an outside seek) drops it and reports `missed`.

import Combine
import Foundation
import MusicKit

struct SongInfo: Sendable {
  let id: String
  let title: String
  let artist: String
  let album: String?
  let durationSec: Double?
  let artworkUrl: String?
  let explicit: Bool
  let isrc: String?
  let genre: String?
  let playable: Bool

  init(_ song: Song) {
    id = song.id.rawValue
    title = song.title
    artist = song.artistName
    album = song.albumTitle
    durationSec = song.duration
    artworkUrl = song.artwork?.url(width: MusicController.artworkSize, height: MusicController.artworkSize)?.absoluteString
    explicit = song.contentRating == .explicit
    isrc = song.isrc
    genre = song.genreNames.first
    playable = song.playParameters != nil
  }

  /// JS shape (NativeSong in modules/cliffword-music/index.ts); nil fields are left out.
  var dictionary: [String: Any] {
    var result: [String: Any] = [
      "id": id,
      "title": title,
      "artist": artist,
      "explicit": explicit,
      "playable": playable,
    ]
    if let album = album { result["album"] = album }
    if let durationSec = durationSec, durationSec.isFinite { result["durationSec"] = durationSec }
    if let artworkUrl = artworkUrl { result["artworkUrl"] = artworkUrl }
    if let isrc = isrc { result["isrc"] = isrc }
    if let genre = genre { result["genre"] = genre }
    return result
  }
}

struct PlaybackSnapshot: Sendable {
  let status: String
  let positionSec: Double
  let rate: Double
  let song: SongInfo?

  /// JS shape (NativePlaybackState).
  var dictionary: [String: Any] {
    var result: [String: Any] = [
      "status": status,
      "positionSec": positionSec,
      "rate": rate,
    ]
    if let song = song {
      result["songId"] = song.id
      result["song"] = song.dictionary
    }
    return result
  }
}

private struct PendingPause {
  let token: Int
  let targetSec: Double
}

final class MusicController: @unchecked Sendable {
  static let artworkSize = 300

  private static let fineWindowSec = 0.3
  private static let fineStepSec = 0.01
  private static let pauseEpsilonSec = 0.003
  private static let maxSleepSec = 1.0
  private static let idleRecheckSec = 0.25
  private static let missedSlackSec = 0.25
  private static let seekSettleSec = 0.05
  private static let maxCachedSongs = 2000

  /// Set once by the module (OnCreate): sends an event to JavaScript.
  var emit: ((String, [String: Any]) -> Void)?

  // Library cache (any thread, behind the lock).
  private let cacheLock = NSLock()
  private var songCache: [String: Song] = [:]

  // Main-thread state.
  private var currentSong: SongInfo?
  private var stateCancellable: AnyCancellable?
  private var queueCancellable: AnyCancellable?
  private var lastStatus: String?
  private var lastSongId: String?
  private var timeObserved = false
  private var timeIntervalSec = 0.25
  private var timeTimer: DispatchSourceTimer?
  private var pendingPause: PendingPause?
  private var pauseTimer: DispatchSourceTimer?

  @MainActor
  private var player: ApplicationMusicPlayer {
    return ApplicationMusicPlayer.shared
  }

  // MARK: - Library

  func librarySongs(query: String?, order: String, limit: Int, offset: Int) async throws -> [SongInfo] {
    var request = MusicLibraryRequest<Song>()
    request.limit = max(1, min(limit, 500))
    request.offset = max(0, offset)
    if let text = query?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
      request.filter(text: text)
    }
    switch order {
    case "title":
      request.sort(by: \.title, ascending: true)
    case "recentlyPlayed":
      request.sort(by: \.lastPlayedDate, ascending: false)
    default:
      request.sort(by: \.libraryAddedDate, ascending: false)
    }
    let response: MusicLibraryResponse<Song>
    do {
      response = try await request.response()
    } catch {
      throw MusicErrors.failed(error)
    }
    let songs = Array(response.items)
    remember(songs)
    return songs.map { SongInfo($0) }
  }

  private func remember(_ songs: [Song]) {
    cacheLock.lock()
    defer { cacheLock.unlock() }
    if songCache.count + songs.count > Self.maxCachedSongs {
      songCache.removeAll(keepingCapacity: true)
    }
    for song in songs {
      songCache[song.id.rawValue] = song
    }
  }

  private func cachedSong(_ songId: String) -> Song? {
    cacheLock.lock()
    defer { cacheLock.unlock() }
    return songCache[songId]
  }

  private func librarySong(id songId: String) async throws -> Song {
    if let song = cachedSong(songId) {
      return song
    }
    var request = MusicLibraryRequest<Song>()
    request.filter(matching: \.id, equalTo: MusicItemID(songId))
    let response: MusicLibraryResponse<Song>
    do {
      response = try await request.response()
    } catch {
      throw MusicErrors.failed(error)
    }
    guard let song = response.items.first else {
      throw MusicErrors.notFound(songId)
    }
    remember([song])
    return song
  }

  // MARK: - Playback

  @MainActor
  func play(songId: String) async throws -> PlaybackSnapshot {
    let song = try await librarySong(id: songId)
    guard song.playParameters != nil else {
      throw MusicErrors.notPlayable(songId)
    }
    startObservingState()
    let player = self.player
    currentSong = SongInfo(song)
    player.queue = [song]
    observeQueue()
    do {
      try await player.prepareToPlay()
      try await player.play()
    } catch {
      currentSong = nil
      let failure = await MusicErrors.playback(error)
      throw failure
    }
    updateTimeTimer(playing: true)
    return snapshot(status: "playing", positionSec: 0)
  }

  @MainActor
  func pause() -> PlaybackSnapshot {
    guard currentSong != nil else {
      return snapshot()
    }
    player.pause()
    updateTimeTimer(playing: false)
    return snapshot(status: "paused")
  }

  @MainActor
  func resume() async throws -> PlaybackSnapshot {
    guard currentSong != nil else {
      return snapshot()
    }
    do {
      try await player.play()
    } catch {
      let failure = await MusicErrors.playback(error)
      throw failure
    }
    updateTimeTimer(playing: true)
    if pendingPause != nil {
      checkPendingPause()
    }
    return snapshot(status: "playing")
  }

  @MainActor
  func seek(to positionSec: Double) -> PlaybackSnapshot {
    guard currentSong != nil else {
      return snapshot()
    }
    let target = positionSec.isFinite ? max(0, positionSec) : 0
    player.playbackTime = target
    if pendingPause != nil {
      // Let the new position settle before the next check reads it.
      armPauseTimer(after: Self.seekSettleSec)
    }
    return snapshot(positionSec: target)
  }

  /// The current state. Calls that just changed it pass what they set, since MusicKit may report
  /// the old status or time for a moment.
  @MainActor
  func snapshot(status statusOverride: String? = nil, positionSec positionOverride: Double? = nil) -> PlaybackSnapshot {
    guard let song = currentSong else {
      return PlaybackSnapshot(status: "stopped", positionSec: 0, rate: 0, song: nil)
    }
    let player = self.player
    let status = statusOverride ?? MusicMapping.status(player.state.playbackStatus)
    let time = positionOverride ?? player.playbackTime
    return PlaybackSnapshot(
      status: status,
      positionSec: time.isFinite ? max(0, time) : 0,
      rate: Double(player.state.playbackRate),
      song: song
    )
  }

  // MARK: - Observation

  @MainActor
  private func startObservingState() {
    guard stateCancellable == nil else { return }
    stateCancellable = player.state.objectWillChange
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in
        MainActor.assumeIsolated { self?.playerDidChange() }
      }
  }

  /// The queue object can be replaced when a new queue is set, so it is observed again after each play().
  @MainActor
  private func observeQueue() {
    queueCancellable = player.queue.objectWillChange
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in
        MainActor.assumeIsolated { self?.playerDidChange() }
      }
  }

  @MainActor
  private func playerDidChange() {
    let current = snapshot()
    reportState(current)
    updateTimeTimer(playing: current.status == "playing")
    if pendingPause != nil {
      checkPendingPause()
    }
  }

  /// Sends onPlaybackState when the status or the song changed since the last report.
  @MainActor
  private func reportState(_ current: PlaybackSnapshot) {
    let songId = current.song?.id
    guard current.status != lastStatus || songId != lastSongId else { return }
    lastStatus = current.status
    lastSongId = songId
    emit?(MusicEvents.playbackState, current.dictionary)
  }

  @MainActor
  func setTimeObserved(_ observed: Bool) {
    timeObserved = observed
    updateTimeTimer(playing: lastStatus == "playing")
  }

  @MainActor
  func setTimeUpdateInterval(ms: Double) {
    timeIntervalSec = ms > 0 ? max(ms, 20) / 1000 : 0
    timeTimer?.cancel()
    timeTimer = nil
    updateTimeTimer(playing: lastStatus == "playing")
  }

  @MainActor
  private func updateTimeTimer(playing: Bool) {
    guard playing, timeObserved, timeIntervalSec > 0 else {
      timeTimer?.cancel()
      timeTimer = nil
      return
    }
    guard timeTimer == nil else { return }
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
    timer.schedule(deadline: .now() + timeIntervalSec, repeating: timeIntervalSec, leeway: .milliseconds(10))
    timer.setEventHandler { [weak self] in
      MainActor.assumeIsolated { self?.emitTime() }
    }
    timeTimer = timer
    timer.resume()
  }

  @MainActor
  private func emitTime() {
    let current = snapshot()
    emit?(MusicEvents.playbackTime, ["positionSec": current.positionSec, "status": current.status])
  }

  // MARK: - Line-end pause

  @MainActor
  func schedulePause(token: Int, targetSec: Double) {
    pendingPause = PendingPause(token: token, targetSec: targetSec)
    startObservingState()
    checkPendingPause()
  }

  @MainActor
  func cancelScheduledPause() {
    pendingPause = nil
    cancelPauseTimer()
  }

  @MainActor
  private func checkPendingPause() {
    cancelPauseTimer()
    guard let pending = pendingPause else { return }
    let player = self.player
    guard currentSong != nil, player.state.playbackStatus == .playing else {
      // Paused, loading or interrupted: the target stays armed; state changes also re-check.
      armPauseTimer(after: Self.idleRecheckSec)
      return
    }
    let rate = player.state.playbackRate > 0 ? Double(player.state.playbackRate) : 1
    let remaining = (pending.targetSec - player.playbackTime) / rate
    if remaining < -Self.missedSlackSec {
      pendingPause = nil
      emit?(MusicEvents.scheduledPause, [
        "token": pending.token,
        "targetSec": pending.targetSec,
        "positionSec": player.playbackTime,
        "missed": true,
      ])
      return
    }
    if remaining <= Self.pauseEpsilonSec {
      player.pause()
      pendingPause = nil
      let position = player.playbackTime
      emit?(MusicEvents.scheduledPause, [
        "token": pending.token,
        "targetSec": pending.targetSec,
        "positionSec": position,
        "missed": false,
      ])
      reportState(snapshot(status: "paused", positionSec: position))
      updateTimeTimer(playing: false)
      return
    }
    let delay = remaining > Self.fineWindowSec
      ? min(remaining - Self.fineWindowSec, Self.maxSleepSec)
      : min(remaining, Self.fineStepSec)
    armPauseTimer(after: delay)
  }

  @MainActor
  private func armPauseTimer(after seconds: Double) {
    cancelPauseTimer()
    let timer = DispatchSource.makeTimerSource(flags: .strict, queue: DispatchQueue.main)
    timer.schedule(deadline: .now() + max(0, seconds), leeway: .milliseconds(1))
    timer.setEventHandler { [weak self] in
      MainActor.assumeIsolated { self?.checkPendingPause() }
    }
    pauseTimer = timer
    timer.resume()
  }

  @MainActor
  private func cancelPauseTimer() {
    pauseTimer?.cancel()
    pauseTimer = nil
  }

  // MARK: - Lifecycle

  @MainActor
  func shutdown() {
    cancelScheduledPause()
    timeTimer?.cancel()
    timeTimer = nil
    stateCancellable = nil
    queueCancellable = nil
  }
}
