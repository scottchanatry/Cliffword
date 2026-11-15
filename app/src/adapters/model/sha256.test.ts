import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSha256Hex, Sha256, sha256Hex } from './sha256';

const ascii = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const nodeSha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Deterministic pseudo-random bytes (xorshift32), so failures reproduce. */
function bytes(length: number, seed = 0x9e3779b9): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed | 0;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

describe('Sha256', () => {
  // FIPS 180-4 / NIST CSRC example vectors.
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('hashes %j to the NIST value', (input, expected) => {
    expect(sha256Hex(ascii(input))).toBe(expected);
  });

  it('hashes one million "a" (fed in uneven slices) to the NIST value', () => {
    const hash = new Sha256();
    const slice = ascii('a'.repeat(9973));
    let left = 1_000_000;
    while (left > 0) {
      const n = Math.min(left, slice.length);
      hash.update(slice.subarray(0, n));
      left -= n;
    }
    expect(hash.length).toBe(1_000_000);
    expect(hash.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('matches node:crypto at every padding boundary', () => {
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
      const data = bytes(n, n);
      expect(sha256Hex(data)).toBe(nodeSha256(data));
    }
  });

  it('gives the same digest however the input is split', () => {
    const data = bytes(10_000);
    const expected = nodeSha256(data);
    for (const step of [1, 3, 63, 64, 65, 4096, 9999]) {
      const hash = new Sha256();
      for (let i = 0; i < data.length; i += step) hash.update(data.subarray(i, i + step));
      expect(hash.hex()).toBe(expected);
    }
  });

  it('keeps the digest after finishing and refuses more input', () => {
    const hash = new Sha256().update(ascii('abc'));
    const first = hash.hex();
    expect(hash.hex()).toBe(first);
    expect(Array.from(hash.digest())).toHaveLength(32);
    expect(() => hash.update(ascii('d'))).toThrow(/after digest/);
  });

  it('matches sha256sum of a generated file read in slices', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliffword-sha256-'));
    const file = path.join(dir, 'generated.bin');
    try {
      // 3 MiB + 17 bytes: several slices and a partial last block.
      fs.writeFileSync(file, bytes(3 * 1024 * 1024 + 17, 42));
      let expected: string;
      try {
        expected = execFileSync('sha256sum', [file], { encoding: 'utf8' }).split(/\s+/)[0] ?? '';
      } catch {
        // No coreutils (e.g. macOS without them): node:crypto is the reference instead.
        expected = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
      const hash = new Sha256();
      const fd = fs.openSync(file, 'r');
      const buffer = new Uint8Array(1 << 20);
      try {
        for (;;) {
          const n = fs.readSync(fd, buffer, 0, buffer.length, null);
          if (n === 0) break;
          hash.update(buffer.subarray(0, n));
        }
      } finally {
        fs.closeSync(fd);
      }
      expect(isSha256Hex(expected)).toBe(true);
      expect(hash.hex()).toBe(expected);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recognizes lower-case hex digests', () => {
    expect(isSha256Hex('b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897')).toBe(true);
    expect(isSha256Hex('B139949C5BD74937AD8ED8C8CF3D9FFB1E99C866C823204DC42C0D91FA181897')).toBe(false);
    expect(isSha256Hex('abc')).toBe(false);
  });
});
