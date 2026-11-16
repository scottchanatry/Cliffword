/**
 * Music view fixtures: one view model per song-screen kind (and the props of the library,
 * paste, share, time-it and brought-text screens), for the dev preview gallery
 * (app/(dev)/preview/[screen].tsx) and the view tests. Song screens come from real engine
 * LyricSession steps on parsed sample lyrics (canned mode, or the deterministic mock model),
 * so they always match the engine's types and wording; app-only state (playback, listening,
 * the explicit setting) is set by hand.
 *
 * The sample lyrics and the sample text are written for Cliffword (the previews' "Luna de
 * Santurce" by the made-up artist Rayo K.); they are not real song lyrics. Target-language text
 * here is content (data), not interface text.
 */
import {
  LearnerModel,
  LyricSession,
  parseLyrics,
  songSlangNotes,
  surpriseMap,
  type LanguageModel,
  type LanguagePack,
  type LyricScreen,
  type LyricStep,
  type PairPack,
  type PriorFn,
  type SlangNote,
} from '@cliffword/engine';
import type { LyricViewModel, PlaybackState } from '../../session/contract';
import type { LibrarySongRow, MusicLibraryProps, PasteLyricsProps, ShareConfirmProps, TapTimerProps, TextPasteProps } from './types';

/** "Luna de Santurce" by Rayo K. (made up for the previews): Puerto Rican slang, one explicit word, an ad-lib. */
export const SAMPLE_LYRICS = [
  '[Verso 1]',
  'Esta noche salimos a janguear,',
  "el corillo ya 'tá listo pa' janguear.",
  'La luna de Santurce brilla en el mar,',
  "y nadie se quiere ir pa' la casa.",
  '',
  '[Coro]',
  'Wepa, que suene el perreo,',
  'mi pana trae los chavos y la guagua.',
  '(Dale, dale)',
  "La calle 'tá brutal, puñeta, qué calor,",
  'bailamos hasta que salga el sol.',
  '¡Wepa!',
].join('\n');

export const SAMPLE_SONG = { title: 'Luna de Santurce', artist: 'Rayo K.' };

/** A short text a learner might bring (written for Cliffword). */
export const SAMPLE_TEXT = [
  'El mercado de Santurce abre los sábados por la mañana.',
  'Los vecinos venden frutas, pan y café recién hecho.',
  'Este año el corillo del barrio montó una tarima con música en vivo.',
  'Al final de la tarde todos bailan en la plaza.',
].join(' ');

export const SAMPLE_TEXT_TITLE = 'Sábado en el mercado';

export const MUSIC_FIXTURE_NAMES = [
  // Previews
  'a3',
  'c1',
  'c2',
  'b4',
  'c3',
  'paste',
  'text',
  // Every other song-screen kind and the other screens
  'lyric-line',
  'lyric-result',
  'lyric-result-scored',
  'lyric-noSe',
  'lyric-native',
  'lyric-done',
  'lyric-loading',
  'b4-before',
  'c1-hint',
  'c1-free',
  'c1-listening',
  'c1-manual',
  'a3-explicit-off',
  'a3-manual',
  'text-cliff',
  'text-paste',
  'time',
  'share',
  'needs-lyrics',
  'c3-android',
] as const;

export type MusicFixtureName = (typeof MUSIC_FIXTURE_NAMES)[number];

export function isMusicFixtureName(name: string): name is MusicFixtureName {
  return (MUSIC_FIXTURE_NAMES as readonly string[]).includes(name);
}

/** 08:00 UTC on the day the previews were drawn: fixtures never depend on the clock. */
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
/** The settings the previews show: Puerto Rico (and the shared Caribbean pack), explicit lyrics on. */
const REGIONS = ['PR', 'CARIB'] as const;

const PLAYING: PlaybackState = { available: true, playing: true, positionMs: 42000, durationMs: 150000 };
const WAITING: PlaybackState = { available: true, playing: false, positionMs: 19000, durationMs: 150000 };
const NO_PLAYER: PlaybackState = { available: false, playing: false, positionMs: 0, durationMs: null };

/** App-only state of a view model around an engine screen. */
export function lyricViewModel(screen: LyricScreen | null, over: Partial<LyricViewModel> = {}): LyricViewModel {
  return {
    screen,
    listen: { phase: 'idle' },
    busy: false,
    modelMode: screen?.meta.canned === false ? 'model' : 'canned',
    meaning: null,
    spokenTodayMs: 252000,
    notice: null,
    playback: PLAYING,
    register: screen?.meta.register ?? 'neutral',
    showExplicit: true,
    regions: REGIONS,
    ...over,
  };
}

/** A learner at a given speaking level for every word: 0.1 options rung, 0.45 hint rung, 0.85 free. */
function learnerAt(speaking: number): LearnerModel {
  const prior: PriorFn = (_key, skill) => (skill === 'speaking' ? speaking : 0.3);
  return new LearnerModel({ prior });
}

function expectKind<K extends LyricScreen['kind']>(step: LyricStep, kind: K): Extract<LyricScreen, { kind: K }> {
  if (step.screen.kind !== kind) throw new Error(`music fixture: expected a ${kind} screen, got ${step.screen.kind}`);
  return step.screen as Extract<LyricScreen, { kind: K }>;
}

export interface MusicFixtureDeps {
  lang: LanguagePack;
  pair: PairPack;
  /** The mock model (scored results, brought-text surprise). */
  model: LanguageModel;
}

export interface MusicFixtures {
  /** Song screens by fixture name. */
  song: Partial<Record<MusicFixtureName, LyricViewModel>>;
  library: Partial<Record<MusicFixtureName, MusicLibraryProps>>;
  paste: PasteLyricsProps;
  share: ShareConfirmProps;
  time: TapTimerProps;
  textPaste: TextPasteProps;
  needsLyrics: { title: string; artist: string };
}

/** The fixtures, built from real LyricSession steps. Deterministic: same packs, same fixtures. */
export async function musicFixtures({ lang, pair, model }: MusicFixtureDeps): Promise<MusicFixtures> {
  const lyrics = parseLyrics(SAMPLE_LYRICS, lang);
  const session = (opts: { speaking: number; register: 'neutral' | 'street'; showExplicit?: boolean; model?: LanguageModel | null }) =>
    LyricSession.create({
      model: opts.model ?? null,
      pack: lang,
      pair,
      learner: learnerAt(opts.speaking),
      now: T0,
      seed: 7,
      source: { kind: 'lyrics', lyrics },
      song: SAMPLE_SONG,
      settings: { register: opts.register, regions: [...REGIONS], showExplicit: opts.showExplicit ?? true },
    });
  const song: MusicFixtures['song'] = {};

  // A3: the song page in street register (the model loaded), the track playing; and without a player, in canned mode.
  const page = session({ speaking: 0.1, register: 'street', model });
  song.a3 = lyricViewModel(page.screen, { register: 'street', genre: 'reggaetón' });
  const street = session({ speaking: 0.1, register: 'street' });
  song['a3-manual'] = lyricViewModel(street.screen, { register: 'street', playback: NO_PLAYER });
  const clean = session({ speaking: 0.1, register: 'neutral', showExplicit: false });
  song['a3-explicit-off'] = lyricViewModel(clean.screen, { showExplicit: false });

  // C1: line 2 stops before its last word ("janguear"); the options rung, the track waiting.
  const c1 = session({ speaking: 0.1, register: 'neutral' });
  await c1.next(T0 + 1000);
  const c1Cliff = expectKind(await c1.next(T0 + 2000), 'cliff');
  // The canned cliff ("the line's last word") is the one the preview draws; the model is shown as loaded, as in C1.
  song.c1 = lyricViewModel(c1Cliff, { playback: WAITING, modelMode: 'model' });
  song['c1-listening'] = lyricViewModel(c1Cliff, { playback: WAITING, modelMode: 'model', listen: { phase: 'listening', level: 0.6, partial: 'jan' } });
  // The same cliff without a player (pasted lyrics with no Apple Music track, and Android): the manual note.
  song['c1-manual'] = lyricViewModel(c1Cliff, { playback: NO_PLAYER, modelMode: 'model' });
  const hint = session({ speaking: 0.45, register: 'neutral' });
  await hint.next(T0 + 1000);
  song['c1-hint'] = lyricViewModel(expectKind(await hint.next(T0 + 2000), 'cliff'), { playback: WAITING });
  const free = session({ speaking: 0.85, register: 'neutral' });
  await free.next(T0 + 1000);
  song['c1-free'] = lyricViewModel(expectKind(await free.next(T0 + 2000), 'cliff'), { playback: NO_PLAYER });

  // The result of singing it (canned: matched by form), then the sing-back (B4).
  const result = expectKind(await free.handleUtterance('janguear', T0 + 3000, { durationMs: 1200 }), 'result');
  song['lyric-result'] = lyricViewModel(result, { playback: WAITING });
  const echo = street;
  await echo.next(T0 + 1000);
  await echo.next(T0 + 2000);
  song['b4-before'] = lyricViewModel(expectKind(echo.startEcho(T0 + 3000), 'echo'), { register: 'street', playback: WAITING });
  // One word missed ("ya"), the clipped forms sung in full: they land in street register.
  song.b4 = lyricViewModel(expectKind(await echo.handleUtterance('el corillo está listo para janguear', T0 + 4000, { durationMs: 2600 }), 'echo'), {
    register: 'street',
    playback: WAITING,
    modelMode: 'model',
  });

  // A result scored by the (mock) model: the landing line and its notes.
  const scored = session({ speaking: 0.85, register: 'street', model });
  await scored.openLine(8, T0 + 1000);
  song['lyric-result-scored'] = lyricViewModel(expectKind(await scored.handleUtterance('sol', T0 + 2000, { durationMs: 800 }), 'result'), { playback: WAITING });

  // C2: neutral and street side by side.
  const reg = session({ speaking: 0.1, register: 'neutral' });
  song.c2 = lyricViewModel(expectKind(reg.setRegister('street', T0 + 1000), 'registers'), { register: 'street', modelMode: 'model' });

  // A line without a cliff ("¡Wepa!": one word), no sé on "mar", an answer in English, the end.
  const misc = session({ speaking: 0.85, register: 'neutral' });
  song['lyric-line'] = lyricViewModel(expectKind(await misc.openLine(lyrics.lines.length - 1, T0 + 1000), 'line'), { playback: NO_PLAYER });
  await misc.openLine(2, T0 + 2000);
  await misc.command('dont_know', T0 + 3000);
  misc.played(T0 + 4000);
  song['lyric-noSe'] = lyricViewModel(expectKind(await misc.handleUtterance('el mar', T0 + 5000, { durationMs: 700 }), 'noSe'), { playback: WAITING });
  await misc.openLine(4, T0 + 6000);
  const native = await misc.handleUtterance('the party', T0 + 7000, { durationMs: 1100 });
  song['lyric-native'] = lyricViewModel(expectKind(native, 'nativeReply'), { playback: WAITING });
  song['lyric-done'] = lyricViewModel(expectKind(await misc.command('done', T0 + 8000), 'done'), { playback: NO_PLAYER });
  song['lyric-loading'] = lyricViewModel(null);

  // A brought text: the reader with surprise shading (mock model) and a cliff in the Ink look.
  const text = LyricSession.create({
    model,
    pack: lang,
    pair,
    learner: learnerAt(0.1),
    now: T0,
    seed: 7,
    source: { kind: 'text', text: SAMPLE_TEXT },
    song: { title: SAMPLE_TEXT_TITLE, artist: '' },
    settings: { register: 'neutral', regions: [...REGIONS] },
  });
  const surprise = await surpriseMap(model, lang, SAMPLE_TEXT, 'neutral', { regions: [...REGIONS] });
  song.text = lyricViewModel(text.screen, { surprise, playback: NO_PLAYER });
  await text.next(T0 + 1000);
  song['text-cliff'] = lyricViewModel(expectKind(await text.next(T0 + 2000), 'cliff'), { surprise, playback: NO_PLAYER });

  const notes = songSlangNotes(lyrics, lang, pair, { regions: [...REGIONS] }).map((n) => n.note);
  const library = libraryFixture();
  return {
    song,
    library: { c3: library, 'c3-android': { ...library, appleMusic: 'unsupported', appleLibrary: [], os: 'android' } },
    paste: pasteFixture(notes, lyrics.lines.map((l) => l.text), lyrics.removed.length),
    share: shareFixture(),
    time: timeFixture(lyrics.lines.map((l) => l.text)),
    textPaste: textPasteFixture(),
    needsLyrics: { title: 'Malecón a las dos', artist: 'Brisa 809' },
  };
}

const none = () => undefined;

/** The C3 library: three songs with lots, some and little slang (made-up titles and artists). */
function libraryFixture(): MusicLibraryProps {
  const songs: LibrarySongRow[] = [
    {
      id: 'song-1',
      title: SAMPLE_SONG.title,
      artist: SAMPLE_SONG.artist,
      monogram: 'LS',
      source: 'apple_music',
      hasLyrics: true,
      summary: { region: 'PR', slang: 'lots', slangCount: 14, slangLexemes: 9, lines: 24, explicit: 1, timed: false },
    },
    {
      id: 'song-2',
      title: 'Malecón a las dos',
      artist: 'Brisa 809',
      monogram: 'MD',
      source: 'spotify_share',
      hasLyrics: true,
      summary: { region: 'DO', slang: 'some', slangCount: 5, slangLexemes: 4, lines: 30, explicit: 0, timed: false },
    },
    {
      id: 'song-3',
      title: 'Café sin azúcar',
      artist: 'Vera Sol',
      monogram: 'CS',
      source: 'manual',
      hasLyrics: true,
      summary: { region: null, slang: 'little', slangCount: 1, slangLexemes: 1, lines: 20, explicit: 0, timed: false },
    },
  ];
  return {
    songs,
    appleMusic: 'authorized',
    appleLibrary: [],
    shares: [],
    texts: [],
    regions: ['PR'],
    showExplicit: true,
    loading: false,
    onOpenSong: none,
    onAddAppleSong: none,
    onConnectAppleMusic: none,
    onManageAppleMusic: none,
    onShowSpotifyHowTo: none,
    onPasteLyrics: none,
    onOpenShare: none,
    onBringText: none,
    onOpenText: none,
    onToggleRegion: none,
    onToggleExplicit: none,
  };
}

function pasteFixture(notes: readonly SlangNote[], lines: string[], removed: number): PasteLyricsProps {
  return {
    title: SAMPLE_SONG.title,
    artist: SAMPLE_SONG.artist,
    text: SAMPLE_LYRICS,
    songFixed: false,
    preview: { lines: lines.length, timedLines: 0, removed, notes, explicit: 1, firstLines: lines.slice(0, 4) },
    canSave: true,
    saving: false,
    errorKey: null,
    onChangeTitle: none,
    onChangeArtist: none,
    onChangeText: none,
    onSave: none,
    onCancel: none,
  };
}

function shareFixture(): ShareConfirmProps {
  return {
    shared: { url: 'https://open.spotify.com/track/0000000000000000000000', text: 'Malecón a las dos - Brisa 809' },
    title: 'Malecón a las dos',
    artist: 'Brisa 809',
    notASong: false,
    canSave: true,
    saving: false,
    onChangeTitle: none,
    onChangeArtist: none,
    onConfirm: none,
    onDismiss: none,
  };
}

function timeFixture(lines: string[]): TapTimerProps {
  const starts = [12400, 16150, 20300];
  return {
    title: SAMPLE_SONG.title,
    artist: SAMPLE_SONG.artist,
    lines: lines.map((text, index) => ({ index, text, startMs: starts[index] ?? null })),
    current: starts.length,
    playback: { available: true, playing: true, positionMs: 23800, durationMs: 150000 },
    onPlay: none,
    onPause: none,
    onTap: none,
    onNudge: none,
    onUndo: none,
    onDone: none,
  };
}

function textPasteFixture(): TextPasteProps {
  return {
    title: SAMPLE_TEXT_TITLE,
    text: SAMPLE_TEXT,
    preview: { sentences: 4, slang: 1 },
    modelReady: true,
    canSave: true,
    saving: false,
    errorKey: null,
    onChangeTitle: none,
    onChangeText: none,
    onSave: none,
    onCancel: none,
  };
}
