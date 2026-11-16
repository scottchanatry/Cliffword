package app.cliffword.nativemodule

import java.io.File
import java.io.FileInputStream
import java.net.URI
import java.security.MessageDigest

/**
 * Streaming SHA-256 of a file, with progress. Plain JVM code (no Android or Expo types), so it can
 * be compiled and checked against sha256sum off the device.
 */
internal object FileSha256 {
  private const val READ_SIZE = 1 shl 20
  private const val PROGRESS_INTERVAL_MS = 100L

  /** A `file://` URI (as expo-file-system gives it) or a plain absolute path. */
  fun fileFrom(uriOrPath: String): File =
    if (uriOrPath.startsWith("file:")) File(URI(uriOrPath)) else File(uriOrPath)

  /**
   * Lower-case hex SHA-256 of [file]. Calls [onProgress] with (bytesRead, totalBytes) about ten
   * times a second and once at the end.
   */
  fun hash(file: File, onProgress: (Long, Long) -> Unit): String {
    val totalBytes = file.length()
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(READ_SIZE)
    var bytesRead = 0L
    var lastProgress = 0L
    FileInputStream(file).use { input ->
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
        bytesRead += n
        val now = System.currentTimeMillis()
        if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
          lastProgress = now
          onProgress(bytesRead, totalBytes)
        }
      }
    }
    onProgress(bytesRead, totalBytes)
    return toHex(digest.digest())
  }

  private fun toHex(bytes: ByteArray): String {
    val digits = "0123456789abcdef"
    val out = StringBuilder(bytes.size * 2)
    for (b in bytes) {
      val v = b.toInt() and 0xff
      out.append(digits[v ushr 4]).append(digits[v and 0x0f])
    }
    return out.toString()
  }
}
