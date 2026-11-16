/**
 * The story module holds no target-language data: every prompt word, example, region
 * name, leak pattern, meta word, label and abbreviation comes from the language pack
 * (LanguagePack.story, LanguagePack.abbreviations). This test reads the module's source
 * and checks that no string or regular-expression literal holds a word of the Spanish
 * story data.
 */
import { describe, expect, it } from 'vitest';
import { SPANISH_ABBREVIATIONS, SPANISH_STORY_DATA } from '../lang/es/story';

const sources = Object.entries(
  import.meta.glob(['./*.ts', '!./*.test.ts', '!./testStubs.ts'], { query: '?raw', import: 'default', eager: true }),
).map(([file, code]) => ({ file: file.replace('./', ''), code: code as string }));

/** Words (3+ letters, lowercase, accents folded) of every string of the Spanish story data. */
function spanishWords(): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      // Placeholders ({text}, {names}) are template syntax, not Spanish.
      for (const w of v.replace(/\{\w+\}/gu, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/\p{L}{3,}/gu) ?? []) out.add(w);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(SPANISH_STORY_DATA);
  visit(SPANISH_ABBREVIATIONS.filter((a) => a.length >= 3));
  // Words of the regex sources that are regex syntax, not Spanish.
  for (const w of ['abc']) out.delete(w);
  return out;
}

/** String, template and regular-expression literals of a source, comments removed. */
function literals(code: string): string[] {
  const noComments = code.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');
  const out: string[] = [];
  for (const m of noComments.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\/(?![*/])(?:[^/\\\n]|\\.)+\/[gimsuy]*/gu)) out.push(m[0]);
  return out;
}

describe('story module language neutrality', () => {
  it('reads the module sources', () => {
    expect(sources.map((s) => s.file).sort()).toEqual(['cliffPick.ts', 'index.ts', 'next.ts', 'prompt.ts', 'select.ts', 'targets.ts', 'text.ts']);
  });

  it('holds no word of the Spanish story data in any literal', () => {
    const words = spanishWords();
    expect(words.size).toBeGreaterThan(50);
    for (const { file, code } of sources) {
      for (const lit of literals(code)) {
        // All-capital words are code tags (parts of speech such as NUM), not text.
        for (const raw of lit.normalize('NFD').replace(/\p{M}/gu, '').match(/\p{L}{3,}/gu) ?? []) {
          if (raw === raw.toUpperCase()) continue;
          expect(words.has(raw.toLowerCase()), `${file}: ${lit}`).toBe(false);
        }
      }
    }
  });

  it('imports no language or pair data', () => {
    for (const { file, code } of sources) expect(code, file).not.toMatch(/from '\.\.\/(lang\/es|pair\/en-es|packs)/u);
  });
});
