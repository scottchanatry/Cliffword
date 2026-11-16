package app.cliffword.nativemodule

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Cliffword's local Expo module (Android): what the model download needs and expo-file-system
 * lacks.
 *
 * - sha256File(uri, jobId): streams the file through MessageDigest on the IO dispatcher (not on
 *   Expo's shared async queue: hashing the 1.1 GB model takes seconds) and sends
 *   "onHashProgress" { jobId, bytesRead, totalBytes } about ten times a second.
 * - excludeFromBackup(uri): false. Android keeps files out of backups through the app's backup
 *   rules, not per file.
 * - availableBytes() is iOS only; the JS side uses expo-file-system's Paths.availableDiskSpace.
 */
class CliffwordNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CliffwordNative")

    Events("onHashProgress")

    AsyncFunction("sha256File") Coroutine { uri: String, jobId: String ->
      withContext(Dispatchers.IO) {
        FileSha256.hash(FileSha256.fileFrom(uri)) { bytesRead, totalBytes ->
          sendEvent(
            "onHashProgress",
            mapOf(
              "jobId" to jobId,
              "bytesRead" to bytesRead.toDouble(),
              "totalBytes" to totalBytes.toDouble()
            )
          )
        }
      }
    }

    AsyncFunction("excludeFromBackup") { _: String ->
      false
    }
  }
}
