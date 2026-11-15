import { describe, expect, it } from 'vitest';
import { createDefaultPairPack } from '../packs';
import { DEFAULT_ALIGN_TRANSCRIPT_OPTIONS } from './align';
import { DEFAULT_NO_SE_OPTIONS } from './noSe';
import { DEFAULT_REPAIR_OPTIONS } from './repair';

// Vite's static glob import (the engine's tsconfig has no Node or Vite client types).
declare global {
  interface ImportMeta {
    glob(pattern: string | string[], opts: { query: string; import: string; eager: true }): Record<string, string>;
  }
}

/** Engine source files of this module (tests excluded), comments removed. */
const sources = Object.entries(import.meta.glob(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true })).map(
  ([path, text]) => ({
    file: path.replace(/^\.\//, ''),
    code: text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
  }),
);

describe('speaking module rules', () => {
  it('reads no clock and no randomness', () => {
    expect(sources.map((s) => s.file).sort()).toEqual([
      'align.ts', 'commands.ts', 'duration.ts', 'index.ts', 'native.ts', 'noSe.ts', 'repair.ts', 'retell.ts', 'spokenTime.ts', 'text.ts',
    ]);
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/Date\.now|new Date|Math\.random|performance\.now/);
    }
  });

  it('keeps language data out of the code (fillers and street endings come from the pack)', () => {
    for (const { file, code } of sources) {
      // Spanish letters and marks, and the Spanish command words, appear only in comments.
      expect(code, file).not.toMatch(/[áéíóúñü¿¡]/i);
      for (const word of ['otra vez', 'despacio', 'no se', 'siguiente', 'listo', 'significa', "'ado'", "'ao'"]) {
        expect(code.toLowerCase(), `${file}: ${word}`).not.toContain(word);
      }
    }
  });

  it('only names interface strings by PairPack.ui key, and the keys exist in the en-es pack', () => {
    const ui = createDefaultPairPack().ui;
    for (const key of [
      DEFAULT_ALIGN_TRANSCRIPT_OPTIONS.uiKey,
      DEFAULT_REPAIR_OPTIONS.promptKey,
      DEFAULT_REPAIR_OPTIONS.expectedKey,
      DEFAULT_REPAIR_OPTIONS.fixKey,
      DEFAULT_NO_SE_OPTIONS.repeatKey,
      'retell.round',
      'stats.spokenToday',
      'cliff.repeatAloud',
    ]) {
      expect(ui[key], key).toBeTruthy();
    }
    expect(ui['repair.fix']).toContain('{fix}');
    expect(ui['repair.expected']).toContain('{expected}');
  });
});
