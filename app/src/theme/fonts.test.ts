/** app.json embeds every font family the app uses, on iOS and Android, from files that exist. */
import fs from 'fs';
import path from 'path';
import { allFontFamilies, fontFamilies } from './fonts';
import { typography } from './typography';

const APP_ROOT = path.resolve(__dirname, '../..');
const appJson = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'app.json'), 'utf8')) as {
  expo: { plugins: unknown[] };
};

interface FontPluginConfig {
  ios: { fonts: string[] };
  android: { fonts: { fontFamily: string; fontDefinitions: { path: string; weight: number }[] }[] };
}

const fontPlugin = appJson.expo.plugins.find(
  (p): p is [string, FontPluginConfig] => Array.isArray(p) && p[0] === 'expo-font',
);

/** The PostScript name (name table id 6) of a TrueType file. */
function postScriptName(file: string): string {
  const b = fs.readFileSync(file);
  const tables = b.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (b.toString('ascii', rec, rec + 4) !== 'name') continue;
    const off = b.readUInt32BE(rec + 8);
    const count = b.readUInt16BE(off + 2);
    const strings = off + b.readUInt16BE(off + 4);
    for (let j = 0; j < count; j++) {
      const r = off + 6 + j * 12;
      if (b.readUInt16BE(r) !== 3 || b.readUInt16BE(r + 6) !== 6) continue;
      const start = strings + b.readUInt16BE(r + 10);
      return b.subarray(start, start + b.readUInt16BE(r + 8)).swap16().toString('utf16le');
    }
  }
  throw new Error(`No PostScript name in ${file}`);
}

describe('embedded fonts', () => {
  it('configures the expo-font plugin', () => {
    expect(fontPlugin).toBeDefined();
  });

  const config = fontPlugin?.[1];

  it('names every iOS font file by a family the app uses (PostScript name)', () => {
    const names = (config?.ios.fonts ?? []).map((f) => postScriptName(path.join(APP_ROOT, f)));
    expect([...names].sort()).toEqual([...allFontFamilies].sort());
  });

  it('registers every family on Android with a file whose PostScript name matches', () => {
    const families = config?.android.fonts ?? [];
    expect(families.map((f) => f.fontFamily).sort()).toEqual([...allFontFamilies].sort());
    for (const family of families) {
      for (const def of family.fontDefinitions) {
        expect(postScriptName(path.join(APP_ROOT, def.path))).toBe(family.fontFamily);
      }
    }
  });

  it('uses only these families in the type scale', () => {
    const used = new Set(Object.values(typography).map((v) => v.fontFamily));
    for (const family of used) expect(allFontFamilies).toContain(family);
    expect(used.has(fontFamilies.music)).toBe(true);
  });
});
