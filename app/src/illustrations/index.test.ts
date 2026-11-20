import fs from 'fs';
import path from 'path';

import { createDefaultPairPack, resolveStory, variantContext } from '@cliffword/engine';
import {
  CAST,
  CAST_IDS,
  COVER_IDS,
  COVERS,
  DEFAULT_YOU_AVATAR,
  SCENE_IDS,
  SCENES,
  SERIES_CAST,
  SERIES_COVERS,
  SERIES_SCENES,
  VOCAB,
  VOCAB_BY_WORD,
  VOCAB_IDS,
  YOU_AVATAR_IDS,
  YOU_AVATARS,
  castForSpeaker,
  coverForTrack,
  isYouAvatarId,
  sceneForEpisode,
  seriesKeyOf,
  vocabIdForWord,
  vocabImageForWord,
  vocabInText,
} from './index';

const ROOT = path.join(__dirname, '../../assets/illustrations');

describe('illustrations', () => {
  const groups = [
    ['covers', COVER_IDS, COVERS],
    ['cast', CAST_IDS, CAST],
    ['scenes', SCENE_IDS, SCENES],
    ['vocab', VOCAB_IDS, VOCAB],
  ] as const;

  it.each(groups)('%s: every id has its source and its 1x, @2x and @3x PNGs', (group, ids, map) => {
    expect(Object.keys(map).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(map[id as keyof typeof map]).toBeTruthy();
      for (const file of [`src/${group}/${id}.svg`, `${group}/${id}.png`, `${group}/${id}@2x.png`, `${group}/${id}@3x.png`]) {
        expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
      }
    }
  });

  it('every cast source is a series cast picture or a learner avatar', () => {
    const sources = fs
      .readdirSync(path.join(ROOT, 'src/cast'))
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice(0, -4));
    expect(sources.sort()).toEqual([...new Set<string>([...CAST_IDS, ...YOU_AVATAR_IDS])].sort());
  });

  it('maps words to vocab ids that exist, and every picture has a word', () => {
    const ids = new Set<string>(VOCAB_IDS);
    for (const [word, id] of Object.entries(VOCAB_BY_WORD)) {
      expect(word).toBe(word.toLocaleLowerCase('es'));
      expect(ids.has(id)).toBe(true);
    }
    expect(new Set(Object.values(VOCAB_BY_WORD)).size).toBe(VOCAB_IDS.length);
  });

  it('finds a picture for a word as it appears in a sentence', () => {
    expect(vocabIdForWord('¡Las chancletas!')).toBe('chancletas');
    expect(vocabIdForWord('un coco frío')).toBe('coco-frio');
    expect(vocabIdForWord('Coco Frio')).toBe('coco-frio');
    expect(vocabIdForWord('el semaforo')).toBe('semaforo');
    expect(vocabIdForWord('Teléfono.')).toBe('telefono');
    expect(vocabIdForWord('chavos')).toBe('dinero');
    expect(vocabIdForWord('nube')).toBeUndefined();
    expect(vocabImageForWord('mofongo')).toBe(VOCAB.mofongo);
  });

  it('finds every picture word of a line, phrases first, once each', () => {
    expect(vocabInText('Hay arroz con gandules, pernil, tostones... ¡Wepa!').map((w) => [w.word, w.id])).toEqual([
      ['arroz con gandules', 'arroz-con-gandules'],
      ['pernil', 'pernil'],
      ['tostones', 'tostones'],
    ]);
    expect(vocabInText('Hi! Hello! ¿Alcapurrias? ¿Bacalaítos? ¿Coco frío?').map((w) => w.word)).toEqual(['alcapurrias', 'bacalaítos', 'coco frío']);
    expect(vocabInText('Pancho mira tus sandalias.').map((w) => w.id)).toEqual(['chancletas']);
    expect(vocabInText('Son dos dólares, please. Y el pan, y más pan.').map((w) => w.id)).toEqual(['dinero', 'pan-sobao']);
    expect(vocabInText('¿Qué es la que hay?')).toEqual([]);
    expect(vocabInText('¡Agua, por favor!')[0]?.image).toBe(VOCAB.agua);
  });
});

describe("the learner's avatars", () => {
  /** The disc color of a cast source (the first full-size circle). */
  const discColor = (id: string) =>
    fs.readFileSync(path.join(ROOT, `src/cast/${id}.svg`), 'utf8').match(/<circle cx="128" cy="128" r="124" fill="(#[0-9A-Fa-f]{6})"\/>/)?.[1];

  it('has the default first, then everyone youngest first: a teen, eight in their twenties and thirties, then forties to eighties', () => {
    expect(YOU_AVATAR_IDS[0]).toBe('you');
    expect(DEFAULT_YOU_AVATAR).toBe('you');
    expect(YOU_AVATAR_IDS).toEqual([
      'you',
      'you-teen',
      'you-painter',
      'you-courier',
      'you-surfer',
      'you-backpacker',
      'you-dancer',
      'you-remote',
      'you-dad',
      'you-doglover',
      'you-chef',
      'you-photographer',
      'you-musician',
      'you-grandma',
      'you-captain',
    ]);
  });

  it('gives every id its source, its three PNGs and its own picture', () => {
    expect(YOU_AVATAR_IDS.length).toBe(15);
    expect(new Set(YOU_AVATAR_IDS).size).toBe(YOU_AVATAR_IDS.length);
    expect(Object.keys(YOU_AVATARS).sort()).toEqual([...YOU_AVATAR_IDS].sort());
    for (const id of YOU_AVATAR_IDS) {
      expect(YOU_AVATARS[id]).toBeTruthy();
      for (const file of [`src/cast/${id}.svg`, `cast/${id}.png`, `cast/${id}@2x.png`, `cast/${id}@3x.png`]) {
        expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
      }
    }
    expect(new Set(Object.values(YOU_AVATARS)).size).toBe(YOU_AVATAR_IDS.length);
  });

  it('keeps the default the same picture as CAST.you, which the series cast never uses', () => {
    expect(YOU_AVATARS[DEFAULT_YOU_AVATAR]).toBe(CAST.you);
    for (const cast of Object.values(SERIES_CAST)) expect(Object.values(cast)).not.toContain('you');
  });

  /**
   * The palette colors a disc can take: all of them but ink (the outlines would vanish into it)
   * and ground (the disc would vanish into the app's background).
   */
  const DISC_COLORS = ['#EF6A57', '#FFC46B', '#B4530A', '#5B616B', '#2E9C92', '#62AD52', '#C3B3EA', '#A8DBF0', '#FFE9C7', '#F08A1D', '#F7BBCB'];
  /** The chooser shows the avatars three to a row. */
  const COLUMNS = 3;

  it('gives every avatar a palette disc, and uses every disc color before it repeats one', () => {
    const colors = YOU_AVATAR_IDS.map(discColor);
    for (const color of colors) expect(DISC_COLORS).toContain(color);
    // Fifteen avatars, eleven disc colors: all eleven are used, and none more than twice.
    expect(new Set(colors).size).toBe(Math.min(YOU_AVATAR_IDS.length, DISC_COLORS.length));
    for (const color of DISC_COLORS) expect(colors.filter((c) => c === color).length).toBeLessThanOrEqual(2);
  });

  it('never puts two discs of one color next to each other in the chooser, not even corner to corner', () => {
    const colors = YOU_AVATAR_IDS.map(discColor);
    const touching: string[] = [];
    colors.forEach((color, i) =>
      colors.forEach((other, j) => {
        const apart = Math.max(Math.abs(Math.floor(i / COLUMNS) - Math.floor(j / COLUMNS)), Math.abs((i % COLUMNS) - (j % COLUMNS)));
        if (i < j && color === other && apart < 2) touching.push(`${YOU_AVATAR_IDS[i]} and ${YOU_AVATAR_IDS[j]}`);
      }),
    );
    expect(touching).toEqual([]);
  });

  it('recognizes avatar ids, and nothing else', () => {
    for (const id of YOU_AVATAR_IDS) expect(isYouAvatarId(id)).toBe(true);
    for (const x of ['dona-mari', 'You', 'you ', 'you-', 'selfie', '', 'toString', '__proto__', null, undefined, 1, {}, ['you']]) {
      expect(isYouAvatarId(x)).toBe(false);
    }
  });
});

describe('series pictures by neutral key', () => {
  const pair = createDefaultPairPack();

  it('takes the series key from a track id', () => {
    expect(seriesKeyOf('en-es.track.living')).toBe('living');
    expect(seriesKeyOf('es-en.track.living')).toBe('living');
    expect(seriesKeyOf('living')).toBe('living');
    expect(seriesKeyOf(null)).toBeNull();
    expect(seriesKeyOf('')).toBeNull();
  });

  it('has a cover for every experience of the pair, and the maps name pictures that exist', () => {
    for (const track of pair.tracks ?? []) expect(coverForTrack(track.id)).toBeTruthy();
    expect(coverForTrack('en-es.track.living')).toBe(COVERS['living-san-juan']);
    expect(coverForTrack('en-es.track.unknown')).toBeUndefined();
    expect(Object.values(SERIES_COVERS).sort()).toEqual([...COVER_IDS].sort());
    for (const scenes of Object.values(SERIES_SCENES)) for (const id of scenes) expect(SCENES[id]).toBeTruthy();
    for (const cast of Object.values(SERIES_CAST)) for (const id of Object.values(cast)) expect(CAST[id]).toBeTruthy();
  });

  it('has a scene for every written episode of San Juan', () => {
    const episodes = [...new Set((pair.library ?? []).filter((x) => x.track === 'en-es.track.living').map((x) => x.episode))].sort();
    expect(episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const n of episodes) expect(sceneForEpisode('en-es.track.living', n)).toBe(SCENES[SERIES_SCENES.living?.[n - 1] ?? 'e1-street']);
    expect(sceneForEpisode('en-es.track.living', 2)).toBe(SCENES['e2-colmado']);
    expect(sceneForEpisode('en-es.track.living', 9)).toBeUndefined();
    expect(sceneForEpisode('en-es.track.living', 0)).toBeUndefined();
    expect(sceneForEpisode('en-es.track.dating', 1)).toBeUndefined();
  });

  it('has an avatar for every speaker of San Juan (a cast id), and none for narration', () => {
    const track = pair.tracks?.find((x) => x.id === 'en-es.track.living');
    const speakers = new Set<string>();
    for (const story of (pair.library ?? []).filter((x) => x.track === track?.id)) {
      const r = resolveStory(story, variantContext(track, 'f'));
      for (const line of r.sentences) if (line.speaker) speakers.add(line.speaker);
      for (const turn of r.turns ?? []) if (turn.speaker) speakers.add(turn.speaker);
    }
    // Every speaker is a cast id, and every cast member has a picture.
    expect([...speakers].filter((id) => !(track?.cast ?? []).some((c) => c.id === id))).toEqual([]);
    for (const id of speakers) expect(castForSpeaker(track?.id, id)).toBeTruthy();
    for (const c of track?.cast ?? []) expect(castForSpeaker(track?.id, c.id)).toBeTruthy();
    expect(castForSpeaker(track?.id, 'neighbor')).toBe(CAST['dona-mari']);
    expect(castForSpeaker(track?.id, 'pharmacist')).toBe(CAST['dona-lourdes']);
    expect(castForSpeaker(track?.id, null)).toBeUndefined();
    expect(castForSpeaker(track?.id, 'Doña Mari')).toBeUndefined();
    expect(castForSpeaker('en-es.track.dating', 'neighbor')).toBeUndefined();
  });
});
