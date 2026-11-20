// Cliffword's local Expo module (iOS): what the model download needs and expo-file-system lacks.
//
// - sha256File(uri, jobId): streams the file through CryptoKit's SHA-256 in 1 MiB reads and
//   sends "onHashProgress" { jobId, bytesRead, totalBytes } about ten times a second. It runs on
//   its own global queue: Expo's default async queue is one serial queue shared by every module,
//   and hashing the 1.1 GB model takes seconds.
// - excludeFromBackup(uri): sets isExcludedFromBackup, so the re-downloadable model stays out of
//   iCloud and device backups (Apple's data storage guidelines for files in Documents).
// - availableBytes(): free space for a user-initiated download
//   (volumeAvailableCapacityForImportantUsage, which counts space iOS can purge), or -1.
// - hasCamera (a constant): whether the device has a camera for the learner's selfie. False in the
//   Simulator and on a Mac without one: expo-image-picker opens UIImagePickerController with the
//   camera source without checking it, and UIKit raises an exception JS cannot catch.

import AVFoundation
import CryptoKit
import ExpoModulesCore
import Foundation

public final class CliffwordNativeModule: Module {
  private static let readSize = 1 << 20
  private static let progressInterval: TimeInterval = 0.1

  public func definition() -> ModuleDefinition {
    Name("CliffwordNative")

    Events("onHashProgress")

    Constant("hasCamera") { () -> Bool in
      #if targetEnvironment(simulator)
      return false
      #else
      // Device discovery only: it asks for no permission and is safe off the main thread.
      return AVCaptureDevice.default(for: .video) != nil
      #endif
    }

    AsyncFunction("sha256File") { (url: URL, jobId: String) throws -> String in
      return try self.sha256(of: url, jobId: jobId)
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))

    AsyncFunction("excludeFromBackup") { (url: URL) throws -> Bool in
      var target = url
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try target.setResourceValues(values)
      return true
    }

    AsyncFunction("availableBytes") { () -> Double in
      let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
      let values = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
      if let bytes = values?.volumeAvailableCapacityForImportantUsage {
        return Double(bytes)
      }
      return -1
    }
  }

  private func sha256(of url: URL, jobId: String) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }

    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    let totalBytes = (attributes?[.size] as? NSNumber)?.int64Value ?? -1

    var hasher = SHA256()
    var bytesRead: Int64 = 0
    var lastProgress = Date.distantPast
    while true {
      let chunk: Data? = try autoreleasepool {
        try handle.read(upToCount: CliffwordNativeModule.readSize)
      }
      guard let chunk, !chunk.isEmpty else {
        break
      }
      hasher.update(data: chunk)
      bytesRead += Int64(chunk.count)
      let now = Date()
      if now.timeIntervalSince(lastProgress) >= CliffwordNativeModule.progressInterval {
        lastProgress = now
        sendProgress(jobId: jobId, bytesRead: bytesRead, totalBytes: totalBytes)
      }
    }
    sendProgress(jobId: jobId, bytesRead: bytesRead, totalBytes: totalBytes)

    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private func sendProgress(jobId: String, bytesRead: Int64, totalBytes: Int64) {
    sendEvent("onHashProgress", [
      "jobId": jobId,
      "bytesRead": Double(bytesRead),
      "totalBytes": Double(totalBytes),
    ])
  }
}
