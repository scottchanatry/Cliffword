import { describe, expect, it } from 'vitest';
import { COGNATES } from './cognates';
import { EXPLANATION_KEYS, EXPLANATIONS } from './explanations';
import { FALSE_FRIENDS, falseFriend } from './falseFriends';
import { ES_TO_EN } from './glossary';
import { NATIVE_LEXICON_WORDS, parseWords, SPANISH_LOOKALIKES } from './nativeLexicon';
import { UI_STRINGS } from './ui';

/**
 * Common Spanish words and forms (function words, frequent verb forms, and words spelled
 * like English ones). None may be in the English lexicon. Independent of the module's
 * own SPANISH_LOOKALIKES filter.
 */
const COMMON_SPANISH = `
a no me come red sea son dos plan total normal hotel animal actor idea final general once
pie ten real solo mesa he ha has van dan den era fue es está la lo el en un una uno que de
del al y o e u se te le les nos mi tu su si sí ya yo tú él con sin por para pero más mas
muy hay ser ver dar ir sale dice use vote late base tan fin par mar pan ave dame dime
mire pare comes decide describe produce reduce imagine prepare invite continue grave
verse vine tender note quite media area menu cafe video region version decision color
error doctor director hospital local social simple terrible horrible chocolate radio
taxi bus club bar show test top box piano pizza patio plaza fiesta taco loco amigo nada
alto cola coma opera chile banana drama golf gas auto mama papa sofa crisis virus
popular similar familiar particular regular actual usual natural personal original
capital central ideal legal metal moral rural cruel civil noble cable probable visible
sensible record corner pure toy chin to pa ta na as do ate
`.split(/\s+/).filter(Boolean);

const lexicon = new Set(NATIVE_LEXICON_WORDS);

describe('COGNATES', () => {
  it('has at least 300 unique lemmas', () => {
    expect(COGNATES.length).toBeGreaterThanOrEqual(300);
    expect(new Set(COGNATES).size).toBe(COGNATES.length);
  });

  it('lemmas are lowercase NFC single words', () => {
    for (const c of COGNATES) {
      expect(c, c).toBe(c.normalize('NFC').toLowerCase());
      expect(c, c).toMatch(/^[\p{L}]+$/u);
    }
  });

  it('includes clear cognates and keeps accents', () => {
    for (const c of ['hospital', 'animal', 'importante', 'información', 'música', 'teléfono', 'decidir', 'posible']) {
      expect(COGNATES).toContain(c);
    }
  });

  it('never includes a false friend or a partial cognate', () => {
    const ff = new Set(FALSE_FRIENDS.map((f) => f.es));
    expect(COGNATES.filter((c) => ff.has(c))).toEqual([]);
    for (const c of ['actual', 'embarazada', 'realizar', 'introducir', 'educado', 'simpático', 'último']) {
      expect(COGNATES).not.toContain(c);
    }
  });

  it('every cognate has a gloss', () => {
    expect(COGNATES.filter((c) => !ES_TO_EN.has(c))).toEqual([]);
  });
});

describe('FALSE_FRIENDS', () => {
  it('has at least 40 unique entries with all fields filled', () => {
    expect(FALSE_FRIENDS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FALSE_FRIENDS.map((f) => f.es)).size).toBe(FALSE_FRIENDS.length);
    for (const f of FALSE_FRIENDS) {
      for (const v of [f.es, f.looksLike, f.means, f.warning]) expect(v.trim(), f.es).toBeTruthy();
      expect(f.es).toBe(f.es.normalize('NFC').toLowerCase());
    }
  });

  it('includes the classic traps', () => {
    const es = FALSE_FRIENDS.map((f) => f.es);
    for (const w of [
      'embarazada', 'actual', 'librería', 'éxito', 'carpeta', 'constipado', 'sensible', 'asistir', 'realizar', 'molestar',
    ]) {
      expect(es).toContain(w);
    }
  });

  it('warnings are short and name the Spanish word', () => {
    for (const f of FALSE_FRIENDS) {
      expect(f.warning.length, f.es).toBeLessThanOrEqual(140);
      expect(f.warning.toLowerCase(), f.es).toContain(f.es.slice(0, 4));
      expect(f.warning, f.es).toMatch(/[.!]$/);
    }
  });

  it('every false friend has a gloss with its real meaning', () => {
    for (const f of FALSE_FRIENDS) expect(ES_TO_EN.get(f.es), f.es).toBeTruthy();
    expect(ES_TO_EN.get('embarazada')).toBe('pregnant');
    expect(ES_TO_EN.get('éxito')).toMatch(/success/);
  });

  it('falseFriend() looks up by lemma, case- and composition-insensitive', () => {
    expect(falseFriend('embarazada')?.means).toBe('pregnant');
    expect(falseFriend('Embarazada')?.means).toBe('pregnant');
    expect(falseFriend('éxito'.normalize('NFD'))?.looksLike).toBe('exit');
    expect(falseFriend('casa')).toBeUndefined();
    expect(falseFriend('')).toBeUndefined();
  });
});

describe('NATIVE_LEXICON_WORDS', () => {
  it('has at least 1500 unique normalized words', () => {
    expect(NATIVE_LEXICON_WORDS.length).toBeGreaterThanOrEqual(1500);
    expect(lexicon.size).toBe(NATIVE_LEXICON_WORDS.length);
    for (const w of NATIVE_LEXICON_WORDS) {
      expect(w, w).toBe(w.normalize('NFC').toLowerCase());
      expect(w, w).toMatch(/^[a-z]+(?:'[a-z]+)?$/);
    }
  });

  it('contains common English words and contractions', () => {
    for (const w of ['the', 'and', 'beach', 'want', 'went', 'house', 'because', 'i', "don't", "i'm", "it's", 'yesterday']) {
      expect(lexicon.has(w), w).toBe(true);
    }
  });

  it(`excludes ${COMMON_SPANISH.length} common Spanish words and forms`, () => {
    expect(COMMON_SPANISH.length).toBeGreaterThanOrEqual(100);
    expect(COMMON_SPANISH.filter((w) => lexicon.has(w))).toEqual([]);
  });

  it('excludes clipped Caribbean forms with or without the apostrophe', () => {
    for (const w of ["'tá", 'ta', "pa'", 'pa', "to'", 'to', "na'", 'na', 'toy', "'toy", 'chin']) {
      expect(lexicon.has(w), w).toBe(false);
    }
  });

  it('is disjoint from the SPANISH_LOOKALIKES filter and from the cognates', () => {
    expect(NATIVE_LEXICON_WORDS.filter((w) => SPANISH_LOOKALIKES.has(w))).toEqual([]);
    expect(COGNATES.filter((c) => lexicon.has(c))).toEqual([]);
  });

  it('parseWords dedupes, lowercases, composes and filters', () => {
    expect(parseWords('  The the THE  hotel Beach\nbeach ', new Set(['hotel']))).toEqual(['the', 'beach']);
    expect(parseWords('')).toEqual([]);
    expect(parseWords('No Me Gusta')).toEqual(['gusta']);
  });
});

describe('EXPLANATIONS', () => {
  it('covers exactly the Spanish rule keys', () => {
    expect(Object.keys(EXPLANATIONS).sort()).toEqual([...EXPLANATION_KEYS].sort());
    expect(EXPLANATION_KEYS).toEqual([
      'es.ser_estar', 'es.por_para', 'es.gender', 'es.number', 'es.aspect', 'es.mood', 'es.personal_a', 'es.article',
      'es.pronoun_placement', 'es.negative_command', 'es.pronoun_order', 'es.se_lo',
    ]);
  });

  it('each is one or two short sentences with a Spanish example', () => {
    const examples: Record<string, string> = {
      'es.ser_estar': 'estoy',
      'es.por_para': 'para ti',
      'es.gender': 'la casa',
      'es.number': 'las flores',
      'es.aspect': 'fui',
      'es.mood': 'vengas',
      'es.personal_a': 'a mi madre',
      'es.article': 'el café',
      'es.pronoun_placement': 'lo compré',
      'es.negative_command': 'no lo hagas',
      'es.pronoun_order': 'te lo digo',
      'es.se_lo': 'se lo di',
    };
    for (const k of EXPLANATION_KEYS) {
      const text = EXPLANATIONS[k];
      expect(text.length, k).toBeLessThanOrEqual(240);
      const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z¿¡])/).filter(Boolean);
      expect(sentences.length, k).toBeGreaterThanOrEqual(1);
      expect(sentences.length, k).toBeLessThanOrEqual(2);
      expect(text.toLowerCase(), k).toContain(examples[k]);
    }
  });
});

describe('UI_STRINGS', () => {
  const ids = Object.keys(UI_STRINGS);

  it('has at least 40 non-empty strings', () => {
    expect(ids.length).toBeGreaterThanOrEqual(40);
    for (const id of ids) expect(UI_STRINGS[id]?.trim(), id).toBeTruthy();
  });

  it('ids are dotted lowerCamel keys', () => {
    for (const id of ids) expect(id, id).toMatch(/^[a-z][A-Za-z]*(?:\.[A-Za-z][A-Za-z]*)+$/);
  });

  it('placeholders are well formed', () => {
    for (const id of ids) {
      const s = UI_STRINGS[id] ?? '';
      const stripped = s.replace(/\{[a-z][A-Za-z]*\}/g, '');
      expect(stripped, id).not.toMatch(/[{}]/);
    }
  });

  it('covers the preview screens', () => {
    const want: Record<string, RegExp> = {
      'cliff.prompt': /say what comes next/i,
      'cliff.holdToSpeak': /hold anywhere and say it/i,
      'cliff.anyAnswer': /any natural answer counts/i,
      'command.otraVez': /^otra vez — again$/,
      'command.masDespacio': /^más despacio — slower$/,
      'command.noSe': /^no sé — skip/,
      'command.siguiente': /^siguiente — next$/,
      'command.listo': /^listo — done$/,
      'text.show': /show text/i,
      'text.hide': /hide text/i,
      'landing.likely': /landed where a spanish speaker would/i,
      'retell.round': /\{round\}.*\{rounds\}.*\{seconds\}/,
      'stats.understood': /understood \{n\} of \{m\} words/i,
      'stats.spokenToday': /spoken today/i,
      'tab.story': /^Story$/,
      'tab.music': /^Music$/,
      'slang.neutral': /^Neutral$/,
      'slang.street': /^Street$/,
      'music.explicitOn': /explicit lyrics: on/i,
      'music.explicitOff': /explicit lyrics: off/i,
      'music.connectAppleMusic': /apple music/i,
      'music.shareFromSpotify': /spotify/i,
      'music.pasteLyrics': /paste lyrics/i,
    };
    for (const [id, re] of Object.entries(want)) expect(UI_STRINGS[id], id).toMatch(re);
  });

  it('has no accent score wording', () => {
    for (const s of Object.values(UI_STRINGS)) expect(s.toLowerCase()).not.toMatch(/accent score|pronunciation score/);
  });
});
