/**
 * SongView over fixtures built from real engine LyricSession steps (fixtures.ts): every
 * song-screen kind renders its key texts through i18n and calls the right LyricActions; slang
 * underlines at the engine's character spans, masked explicit words, the echo rows, hold
 * anywhere and accessibility (named 44 dp controls) are checked on the same fixtures.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { colors, fontFamilies, heatColors } from '../../theme';
import { ECHO_TILE_HEIGHT } from './EchoTiles';
import { MUSIC_FIXTURE_NAMES, type MusicFixtures } from './fixtures';
import { featuredFirst } from './RegistersView';
import { expectAccessibleControls, flat, loadMusicFixtures, mockLyricActions, renderSong } from './testing/musicTestKit';

let fx: MusicFixtures;
beforeAll(async () => {
  fx = await loadMusicFixtures();
}, 60000);

const song = (name: (typeof MUSIC_FIXTURE_NAMES)[number]) => {
  const vm = fx.song[name];
  if (!vm) throw new Error(`no song fixture ${name}`);
  return vm;
};
const activate = (el: ReturnType<typeof screen.getByTestId>, actionName = 'activate') =>
  fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName } });
const SONG_FIXTURES = MUSIC_FIXTURE_NAMES.filter((n) => ['a3', 'c1', 'c2', 'b4', 'text'].includes(n) || n.startsWith('lyric-') || n.startsWith('c1-') || n.startsWith('a3-') || n.startsWith('b4-') || n === 'text-cliff');

describe('every song fixture', () => {
  it('covers every LyricScreen kind', () => {
    const kinds = new Set(SONG_FIXTURES.map((n) => fx.song[n]?.screen?.kind ?? 'loading'));
    expect([...kinds].sort()).toEqual(['cliff', 'done', 'echo', 'line', 'loading', 'nativeReply', 'noSe', 'read', 'registers', 'result'].sort());
  });

  it.each(SONG_FIXTURES)('%s renders with named 44 dp controls', async (name) => {
    await renderSong(song(name));
    expect(screen.getByTestId('song-view')).toBeOnTheScreen();
    const controls = expectAccessibleControls();
    if (name !== 'lyric-loading') expect(controls).toBeGreaterThan(0);
  });
});

describe('song page (A3)', () => {
  it('shows the song, its lines with slang underlined at the engine spans, and the notes', async () => {
    await renderSong(song('a3'));
    expect(screen.getByTestId('song-header-title')).toHaveTextContent('Luna de Santurce');
    expect(screen.getByTestId('song-header-meta')).toHaveTextContent('Rayo K. · reggaetón · Puerto Rico');
    expect(screen.getByText('From your library')).toBeOnTheScreen();
    // Line 2 is "el corillo ya 'tá listo pa' janguear.": corillo, 'tá, pa' and janguear are slang, "ya" and "listo" are not.
    for (const i of [1, 3, 5, 6]) expect(screen.getByTestId(`lyric-1-slang-${i}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('lyric-1-slang-2')).toBeNull();
    expect(screen.queryByTestId('lyric-1-slang-4')).toBeNull();
    const underline = flat(screen.getByTestId('lyric-1-slang-1').props.style);
    expect(underline).toMatchObject({ textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.accentText });
    // Punctuation stays with its word as written; nothing is split on spaces.
    expect(screen.getByTestId('lyric-1-word-6')).toHaveTextContent('janguear.');
    expect(screen.getByTestId('song-line-1').props.accessibilityLabel).toBe("el corillo ya 'tá listo pa' janguear.");
    // One note per slang lexeme: word · meaning, then regions · formality (explicit ones labelled).
    expect(within(screen.getByTestId('slang-note-janguear')).getByText(/to hang out/)).toBeOnTheScreen();
    expect(within(screen.getByTestId('slang-note-corillo')).getByText('Puerto Rico · Casual')).toBeOnTheScreen();
    expect(within(screen.getByTestId('slang-note-puñeta')).getByText(/Vulgar · Explicit/)).toBeOnTheScreen();
  });

  it('opens a line, toggles the register, plays and pauses, and sings the next word', async () => {
    const { actions } = await renderSong(song('a3'));
    await fireEvent.press(screen.getByTestId('song-line-4'));
    expect(actions.openLine).toHaveBeenCalledWith(4);
    expect(screen.getByRole('togglebutton', { name: 'Caribbean street' }).props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(screen.getByRole('togglebutton', { name: 'Neutral' }));
    expect(actions.setRegister).toHaveBeenCalledWith('neutral');
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('0:42 · playing in Apple Music');
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(actions.pause).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Sing the next word' }));
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it('offers the song links the route gives', async () => {
    const nav = { onEditLyrics: jest.fn(), onTimeIt: jest.fn(), onOpenRegisters: jest.fn() };
    await renderSong(song('a3'), mockLyricActions(), nav);
    await fireEvent.press(screen.getByRole('button', { name: 'Time it while you listen' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit the lyrics' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Two ways to say it' }));
    expect(nav.onTimeIt).toHaveBeenCalled();
    expect(nav.onEditLyrics).toHaveBeenCalled();
    expect(nav.onOpenRegisters).toHaveBeenCalled();
  });

  it('masks explicit words when explicit lyrics are off, on screen and for screen readers', async () => {
    await renderSong(song('a3-explicit-off'));
    expect(screen.queryByText(/puñeta/)).toBeNull();
    expect(screen.getByTestId('masked-4')).toBeOnTheScreen();
    expect(screen.getByTestId('masked-4').props.accessibilityLabel).toBe('Hidden word (explicit lyrics are off)');
    expect(screen.getByTestId('song-line-7').props.accessibilityLabel).toBe("La calle 'tá brutal, Hidden word (explicit lyrics are off), qué calor,");
    expect(screen.queryByTestId('slang-note-puñeta')).toBeNull();
  });

  it('says how to practise without a player, and that cliffs are simple until the model is ready', async () => {
    await renderSong(song('a3-manual'));
    expect(screen.getByTestId('manual-mode')).toHaveTextContent('No player for this song here. Read each line, then sing it.');
    expect(screen.queryByTestId('now-playing')).toBeNull();
    expect(screen.getByTestId('song-canned')).toBeOnTheScreen();
  });
});

describe('lyric cliff (C1)', () => {
  it('shows the Anton title, the line count, the line before and the line up to the gap', async () => {
    await renderSong(song('c1'));
    const title = flat(screen.getByRole('header', { name: 'Luna de Santurce' }).props.style);
    expect(title).toMatchObject({ fontFamily: fontFamilies.music, textTransform: 'uppercase', fontSize: 46 });
    expect(screen.getByTestId('music-title-sub')).toHaveTextContent('Rayo K. · line 2 of 10');
    expect(screen.getByTestId('lyric-previous')).toHaveTextContent('Esta noche salimos a janguear,');
    expect(screen.getByTestId('lyric-current')).toHaveTextContent("el corillo ya 'tá listo pa'");
    expect(screen.queryByText(/janguear\./)).toBeNull();
    expect(screen.getByLabelText('Gap: the story stops here')).toBeOnTheScreen();
    expect(screen.getByTestId('now-playing-line')).toHaveTextContent('0:19 · the music waits for you');
    expect(screen.queryByTestId('song-canned')).toBeNull();
  });

  it('shows three options on request and sends the pick', async () => {
    const { actions } = await renderSong(song('c1'));
    await fireEvent.press(screen.getByRole('button', { name: 'Stuck? Show three options' }));
    expect(screen.getByText('Pick the one that fits.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'janguear' }));
    expect(actions.pickOption).toHaveBeenCalledWith(1);
  });

  it('turns explicit lyrics off from the pill, plays, and sends the commands', async () => {
    const { actions } = await renderSong(song('c1'));
    const pill = screen.getByTestId('explicit-pill');
    expect(pill.props.accessibilityState).toEqual({ checked: true });
    expect(pill).toHaveTextContent('Explicit · on');
    await fireEvent.press(pill);
    expect(actions.setShowExplicit).toHaveBeenCalledWith(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Play' }));
    expect(actions.play).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('command-dont_know'));
    expect(actions.command).toHaveBeenCalledWith('dont_know');
    await fireEvent.press(screen.getByRole('button', { name: 'Type instead' }));
    await fireEvent.changeText(screen.getByTestId('type-input'), ' janguear ');
    await fireEvent.press(screen.getByTestId('type-send'));
    expect(actions.typeAnswer).toHaveBeenCalledWith('janguear');
  });

  it('is a static chip when the controller cannot change the setting', async () => {
    const actions = mockLyricActions();
    const { setShowExplicit: _drop, ...rest } = actions;
    await renderSong(song('c1'), rest);
    expect(screen.queryByRole('togglebutton', { name: 'Explicit lyrics' })).toBeNull();
    expect(screen.getByTestId('explicit-pill')).toHaveTextContent('Explicit · on');
  });

  it('sings it by holding (screen readers: activate) and shows what is heard', async () => {
    const { actions } = await renderSong(song('c1'));
    const sing = screen.getByTestId('sing-it');
    expect(sing.props.accessibilityLabel).toBe('Sing it');
    expect(flat(sing.props.style).minHeight).toBe(68);
    await activate(sing);
    expect(actions.holdBegin).toHaveBeenCalledTimes(1);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
    await renderSong(song('c1-listening'));
    expect(screen.getByTestId('sing-it')).toHaveTextContent('jan');
  });

  it('shows the hint rung and no options button', async () => {
    await renderSong(song('c1-hint'));
    expect(screen.getByTestId('lyric-rung')).toHaveTextContent('It starts with “ja”.');
    expect(screen.queryByTestId('show-options')).toBeNull();
  });

  it('hides explicit words in the raw lines when explicit lyrics are off', async () => {
    const c1 = song('c1');
    if (c1.screen?.kind !== 'cliff') throw new Error('c1 is a cliff');
    await renderSong({ ...c1, showExplicit: false, screen: { ...c1.screen, previous: "La calle 'tá brutal, puñeta, qué calor,", before: 'bailamos hasta que salga el ' } });
    expect(screen.queryByText(/puñeta/)).toBeNull();
    expect(screen.getByLabelText('Hidden word (explicit lyrics are off)')).toBeOnTheScreen();
    expect(screen.getByTestId('explicit-pill')).toHaveTextContent('Explicit · off');
  });
});

describe('result, no sé, answer in English, line, done', () => {
  it('shows where a scored answer landed, with the song word lit, and sings the line back', async () => {
    const { actions } = await renderSong(song('lyric-result-scored'));
    expect(screen.getByTestId('result-headline')).toHaveTextContent('That’s exactly what the song says.');
    expect(screen.getByTestId('result-landing-line')).toBeOnTheScreen();
    expect(screen.getByTestId('result-notes')).toHaveTextContent('“mercado” is just as natural.');
    expect(screen.getByTestId('result-line-lit-5')).toHaveTextContent('sol');
    await fireEvent.press(screen.getByRole('button', { name: 'Sing the line back' }));
    expect(actions.startEcho).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('command-next'));
    expect(actions.command).toHaveBeenCalledWith('next');
  });

  it('shows a canned result without the landing line', async () => {
    await renderSong(song('lyric-result'));
    expect(screen.getByTestId('result-headline')).toBeOnTheScreen();
    expect(screen.queryByTestId('result-landing-line')).toBeNull();
    expect(screen.queryByTestId('result-you-said')).toBeNull();
  });

  it('no sé: plays the answer again and moves on once repeated', async () => {
    const { actions } = await renderSong(song('lyric-noSe'));
    expect(screen.getByTestId('nose-answer')).toHaveTextContent('mar');
    expect(screen.getByText('Words understood: 1 of 1')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Play the answer again' }));
    expect(actions.command).toHaveBeenCalledWith('again');
    await fireEvent.press(screen.getByRole('button', { name: 'Next line' }));
    expect(actions.next).toHaveBeenCalledTimes(1);
  });

  it('answer in English: what was heard and the Spanish to say', async () => {
    await renderSong(song('lyric-native'));
    expect(screen.getByTestId('native-heard')).toHaveTextContent('You said “the party”.');
    expect(screen.getByTestId('native-target')).toHaveTextContent('fiesta');
    expect(screen.getByTestId('native-ui')).toHaveTextContent('Now say it out loud.');
  });

  it('a line without a cliff: where it plays, sing it back, back to the song', async () => {
    const { actions } = await renderSong(song('lyric-line'));
    expect(screen.getByTestId('lyric-line-only')).toHaveTextContent('¡Wepa!');
    expect(screen.getByTestId('line-play')).toHaveTextContent('Read it, sing it, then say Siguiente.');
    await fireEvent.press(screen.getByRole('button', { name: 'Sing the line back' }));
    expect(actions.startEcho).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the song' }));
    expect(actions.showSong).toHaveBeenCalled();
  });

  it('the end of the song: cliffs answered and full ones, back to the page or the library', async () => {
    const nav = { onBack: jest.fn() };
    const { actions } = await renderSong(song('lyric-done'), mockLyricActions(), nav);
    expect(screen.getByText('2 cliffs answered')).toBeOnTheScreen();
    expect(screen.getByTestId('done-full')).toHaveTextContent('0 of 2 landed where the song goes.');
    await fireEvent.press(screen.getByRole('button', { name: 'See the song' }));
    expect(actions.showSong).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to your music' }));
    expect(nav.onBack).toHaveBeenCalled();
  });

  it('shows a calm loading state before the first screen', async () => {
    await renderSong(song('lyric-loading'));
    expect(screen.getByTestId('song-loading')).toBeOnTheScreen();
    expect(screen.getByText('Getting the song ready…')).toBeOnTheScreen();
  });
});

describe('sing-back (B4)', () => {
  it('draws the singer row at one height with slang underlined, and the learner row by status', async () => {
    await renderSong(song('b4'));
    expect(screen.getByTestId('song-header-meta')).toHaveTextContent('Rayo K. · stopped in Apple Music');
    expect(screen.getByTestId('echo-eyebrow')).toHaveTextContent('The track stopped. Sing the line back.');
    const faces = [0, 1, 2, 3, 4, 5, 6].map((i) => flat(screen.getByTestId(`echo-tile-${i}-face`).props.style));
    expect(new Set(faces.map((f) => f.height))).toEqual(new Set([ECHO_TILE_HEIGHT]));
    // corillo (1), 'tá (3), pa' (5), janguear (6) are slang; el, ya, listo are not.
    expect(faces.map((f) => f.borderBottomWidth === 3)).toEqual([false, true, false, true, false, true, true]);
    expect(screen.getByTestId('echo-landed')).toHaveTextContent('6 of 7 landed');
    expect(screen.getByTestId('echo-you-2-missed')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('echo-you-2-missed').props.children.props.style)).toMatchObject({ borderStyle: 'dashed' });
    expect(screen.getAllByTestId(/^echo-you-\d-landed$/)).toHaveLength(6);
    expect(screen.getByTestId('echo-tap-hollow')).toHaveTextContent('Tap the hollow tile to hear that word slowly.');
    expect(screen.getByText('Hold anywhere and sing it again')).toBeOnTheScreen();
  });

  it('hears a missed word slowly, and shows a held word with its note', async () => {
    const { actions } = await renderSong(song('b4'));
    fireGestureHandler(getByGestureTestId('echo-you-2-tap'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    expect(actions.hearWord).toHaveBeenCalledWith(2);
    expect(screen.queryByText('corillo')).toBeNull();
    fireGestureHandler(getByGestureTestId('echo-tile-1-hold'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    expect(await screen.findByText('corillo')).toBeOnTheScreen();
    expect(screen.getByTestId('echo-tiles-legend')).toHaveTextContent(/You held one: corillo · group of friends, crew · Puerto Rico\./);
    expect(actions.holdStart).not.toHaveBeenCalled();
    // The tile hold wins over hold anywhere.
    const root = getByGestureTestId('hold-anywhere') as unknown as { handlerTag: number };
    const hold = getByGestureTestId('echo-tile-1-hold') as unknown as { gestureRelations?: { blocksHandlers: number[] } };
    expect(hold.gestureRelations?.blocksHandlers).toContain(root.handlerTag);
    // Screen readers: the long-press action shows it; activate on a hollow tile hears it.
    await activate(screen.getByTestId('echo-tile-4'), 'longpress');
    expect(within(screen.getByTestId('echo-tile-4-face')).getByText('listo')).toBeOnTheScreen();
    expect(screen.getByTestId('echo-tile-4').props.accessibilityLabel).toBe('listo');
    await activate(screen.getByTestId('echo-you-2-missed'));
    expect(actions.hearWord).toHaveBeenCalledTimes(2);
  });

  it('draws the hollow tile without a button when the controller cannot speak a word', async () => {
    const { hearWord: _drop, ...rest } = mockLyricActions();
    await renderSong(song('b4'), rest);
    expect(screen.getByTestId('echo-you-2-missed').props.accessibilityRole).toBeUndefined();
    expect(screen.queryByTestId('echo-tap-hollow')).toBeNull();
  });

  it('before singing: the singer row only, and the commands', async () => {
    const { actions } = await renderSong(song('b4-before'));
    expect(screen.queryByTestId('echo-tiles-learner')).toBeNull();
    expect(screen.getByText('Hold anywhere and sing the line')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('command-slower'));
    expect(actions.command).toHaveBeenCalledWith('slower');
  });
});

describe('two registers (C2)', () => {
  it('shows the line that changes most, neutral and street, with the swaps', async () => {
    await renderSong(song('c2'));
    expect(screen.getByRole('header', { name: 'Same idea, two ways to say it' })).toBeOnTheScreen();
    expect(screen.getByTestId('register-neutral-1')).toHaveTextContent(/^Neutral · works anywhere/);
    expect(screen.getByTestId('register-neutral-1-line')).toHaveTextContent('el grupo ya está listo para salir.');
    expect(screen.getByTestId('register-street-1')).toHaveTextContent(/^Street · Puerto Rico, with friends/);
    expect(screen.getByTestId('register-street-1-line')).toHaveTextContent("el corillo ya 'tá listo pa' janguear.");
    expect(within(screen.getByTestId('swaps-1')).getByText('grupo → corillo')).toBeOnTheScreen();
    expect(within(screen.getByTestId('swaps-1')).getByText('para → pa\'')).toBeOnTheScreen();
    expect(screen.queryByTestId('register-pair-0')).toBeNull();
  });

  it('shows the other lines on request and sets the register', async () => {
    const { actions } = await renderSong(song('c2'));
    await fireEvent.press(screen.getByRole('button', { name: 'Show 7 more lines' }));
    expect(screen.getByTestId('register-pair-0')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Say it street' }));
    expect(actions.setRegister).toHaveBeenCalledWith('street');
    await fireEvent.press(screen.getByRole('button', { name: 'Say it neutral' }));
    expect(actions.setRegister).toHaveBeenCalledWith('neutral');
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the song' }));
    expect(actions.showSong).toHaveBeenCalled();
  });

  it('puts the line with the most swaps first', () => {
    const pairs = [
      { lineIndex: 0, swaps: [1] },
      { lineIndex: 1, swaps: [1, 2, 3] },
      { lineIndex: 2, swaps: [1, 2] },
    ];
    expect(featuredFirst(pairs).map((p) => p.lineIndex)).toEqual([1, 0, 2]);
    expect(featuredFirst([])).toEqual([]);
  });
});

describe('a brought text', () => {
  it('reads with surprise shading, named for screen readers, and starts the cliffs', async () => {
    const { actions } = await renderSong(song('text'));
    expect(screen.getByTestId('song-header-title')).toHaveTextContent('Sábado en el mercado');
    expect(screen.getByTestId('heat-legend')).toBeOnTheScreen();
    const shaded = screen.getAllByTestId(/^text-\d-word-\d+$/).filter((w) => {
      const inner = w.props.children[1] as { props: { style: unknown } };
      return heatColors.includes(String(flat(inner.props.style).backgroundColor ?? ''));
    });
    expect(shaded.length).toBeGreaterThan(0);
    expect(String(screen.getByTestId('text-sentence-0').props.accessibilityLabel)).toMatch(/^El mercado de Santurce abre los sábados por la mañana\.( Surprising: .+)?/);
    await fireEvent.press(screen.getByTestId('text-sentence-2'));
    expect(actions.openLine).toHaveBeenCalledWith(2);
    await fireEvent.press(screen.getByRole('button', { name: 'Start the cliffs' }));
    expect(actions.next).toHaveBeenCalled();
  });

  it('draws the text unshaded until the model has scored it', async () => {
    await renderSong({ ...song('text'), surprise: null });
    expect(screen.getByTestId('text-no-heat')).toBeOnTheScreen();
    expect(screen.queryByTestId('heat-legend')).toBeNull();
  });

  it('stops mid-sentence in the Ink look with the cliff card', async () => {
    const { actions } = await renderSong(song('text-cliff'));
    expect(screen.getByTestId('text-cliff-meta')).toHaveTextContent('Sábado en el mercado · sentence 2 of 4');
    expect(screen.getByTestId('text-current')).toHaveTextContent('Los vecinos venden frutas, pan y café recién');
    expect(screen.getByTestId('cliff-card')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'hecho' }));
    expect(actions.pickOption).toHaveBeenCalledWith(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(actions.command).toHaveBeenCalledWith('dont_know');
  });
});

describe('around every screen', () => {
  it('holds anywhere: warms on touch-down, listens, sends on release', async () => {
    const { actions } = await renderSong(song('b4'));
    fireGestureHandler(getByGestureTestId('hold-anywhere'), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
    expect(actions.holdBegin).toHaveBeenCalledTimes(1);
    expect(actions.holdStart).toHaveBeenCalledTimes(1);
    expect(actions.holdEnd).toHaveBeenCalledTimes(1);
  });

  it('shows the meaning sheet and a notice, and closes them', async () => {
    const { actions } = await renderSong({
      ...song('c1'),
      meaning: { word: 'corillo', key: 'es:corillo', gloss: 'group of friends, crew' },
      notice: { key: 'story.notice.speechOut' },
    });
    expect(screen.getByTestId('meaning-gloss')).toHaveTextContent('group of friends, crew');
    await fireEvent.press(screen.getByTestId('meaning-close'));
    expect(actions.closeMeaning).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('story-notice'));
    expect(actions.dismissNotice).toHaveBeenCalled();
  });

  it('shows a speech-in error under the sing button', async () => {
    await renderSong({ ...song('c1'), listen: { phase: 'error', messageKey: 'speechIn.error.noSpeech' } });
    expect(screen.getByTestId('sing-it-error')).toHaveTextContent('I didn’t hear anything. Hold, say your answer, then let go.');
  });
});
