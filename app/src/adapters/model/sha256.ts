/**
 * Incremental SHA-256 (FIPS 180-4) in plain TypeScript, for files read in slices.
 *
 * The model file is 1.1 GB, so it cannot be hashed in one piece in memory (expo-crypto only
 * digests in-memory data). fileHash.ts prefers the native hash (the cliffword-native module, then
 * expo-file-system's File#digest) and falls back to this when neither is there: it reads the file
 * through a FileHandle in slices and feeds each one to update().
 *
 *   const hash = new Sha256();
 *   hash.update(firstSlice).update(secondSlice);
 *   hash.hex(); // 64 lower-case hex digits
 *
 * Inputs may be split anywhere; the result only depends on the concatenated bytes. Lengths up to
 * 2^53 bytes are handled (Number arithmetic for the bit count).
 */

// prettier-ignore
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// prettier-ignore
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const BLOCK_BYTES = 64;
const TWO_POW_32 = 0x100000000;

export class Sha256 {
  private readonly state = new Int32Array(INITIAL);
  private readonly block = new Uint8Array(BLOCK_BYTES);
  private readonly w = new Int32Array(64);
  private blockLength = 0;
  private totalBytes = 0;
  private finished: Uint8Array | null = null;

  /** Bytes hashed so far. */
  get length(): number {
    return this.totalBytes;
  }

  /** Adds `data` to the hash. Throws after digest() or hex(). */
  update(data: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update() after digest()');
    const length = data.length;
    let offset = 0;
    if (this.blockLength > 0) {
      const take = Math.min(BLOCK_BYTES - this.blockLength, length);
      this.block.set(data.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength === BLOCK_BYTES) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }
    while (offset + BLOCK_BYTES <= length) {
      this.compress(data, offset);
      offset += BLOCK_BYTES;
    }
    if (offset < length) {
      this.block.set(data.subarray(offset), 0);
      this.blockLength = length - offset;
    }
    this.totalBytes += length;
    return this;
  }

  /** The 32-byte digest. Further calls return the same bytes; update() is no longer allowed. */
  digest(): Uint8Array {
    if (this.finished) return this.finished.slice();
    const bitsHigh = Math.floor((this.totalBytes * 8) / TWO_POW_32);
    const bitsLow = (this.totalBytes * 8) % TWO_POW_32;
    const block = this.block;
    block[this.blockLength] = 0x80;
    block.fill(0, this.blockLength + 1);
    if (this.blockLength + 1 > BLOCK_BYTES - 8) {
      this.compress(block, 0);
      block.fill(0);
    }
    writeUint32(block, 56, bitsHigh);
    writeUint32(block, 60, bitsLow);
    this.compress(block, 0);

    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) writeUint32(out, i * 4, this.state[i] as number);
    this.finished = out;
    return out.slice();
  }

  /** The digest as 64 lower-case hex digits. */
  hex(): string {
    return toHex(this.digest());
  }

  private compress(data: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((data[j] as number) << 24) | ((data[j + 1] as number) << 16) | ((data[j + 2] as number) << 8) | (data[j + 3] as number);
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }

    const s = this.state;
    let a = s[0] as number;
    let b = s[1] as number;
    let c = s[2] as number;
    let d = s[3] as number;
    let e = s[4] as number;
    let f = s[5] as number;
    let g = s[6] as number;
    let h = s[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    s[0] = ((s[0] as number) + a) | 0;
    s[1] = ((s[1] as number) + b) | 0;
    s[2] = ((s[2] as number) + c) | 0;
    s[3] = ((s[3] as number) + d) | 0;
    s[4] = ((s[4] as number) + e) | 0;
    s[5] = ((s[5] as number) + f) | 0;
    s[6] = ((s[6] as number) + g) | 0;
    s[7] = ((s[7] as number) + h) | 0;
  }
}

/** SHA-256 of `data` as 64 lower-case hex digits. */
export function sha256Hex(data: Uint8Array): string {
  return new Sha256().update(data).hex();
}

/** Whether `value` looks like a SHA-256 in lower-case hex. */
export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function writeUint32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += HEX.charAt(b >>> 4) + HEX.charAt(b & 0x0f);
  }
  return out;
}
