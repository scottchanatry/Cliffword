/**
 * Native numbers as plain JavaScript numbers.
 *
 * On iOS, expo-file-system passes Swift Int64 values (download progress, File.size, FileHandle.size)
 * to JavaScript as BigInt. A BigInt never equals a number with ===, Number.isFinite(1n) is false,
 * and it still compares with < and >. That made a correct 1,107,409,472-byte download look like
 * the wrong length ("early check, the server announced unknown bytes; 0 received", build 6) and
 * would have failed the final size check too. Every native byte count goes through toNumber.
 */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/** A native byte count, or null when it is missing, negative or not a number. */
export function toByteCount(value: unknown): number | null {
  const n = toNumber(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
