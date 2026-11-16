/**
 * The Music tab's plain-props screens: the library (C3), paste lyrics, confirm a share, time it
 * while you listen, a song waiting for lyrics, and bring a text. Key texts through i18n, the
 * callbacks, and named 44 dp controls.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';
import { createTranslator } from '../../i18n';
import { fontFamilies } from '../../theme';
import { TextPasteView } from '../text/TextPasteView';
import type { MusicFixtures } from './fixtures';
import { songRowMeta } from './LibraryList';
import { appleMusicRow, MusicLibraryView } from './MusicLibraryView';
import { NeedsLyricsView } from './NeedsLyricsView';
import { pastedLines, PasteLyricsView, withoutLine } from './PasteLyricsView';
import { ShareConfirmView } from './ShareConfirmView';
import { NUDGE_MS, preciseClock, TapTimerView } from './TapTimerView';
import { expectAccessibleControls, flat, loadMusicFixtures, renderMusic } from './testing/musicTestKit';
import type { MusicLibraryProps } from './types';

let fx: MusicFixtures;
beforeAll(async () => {
  fx = await loadMusicFixtures();
}, 60000);

const { t } = createTranslator();

/** The library fixture with every callback a jest.fn(). */
function libraryProps(over: Partial<MusicLibraryProps> = {}): MusicLibraryProps {
  const base = fx.library.c3;
  if (!base) throw new Error('no c3 fixture');
  const fns = Object.fromEntries(Object.keys(base).filter((k) => k.startsWith('on')).map((k) => [k, jest.fn()]));
  return { ...base, ...fns, ...over } as MusicLibraryProps;
}

describe('library (C3)', () => {
  it('shows the sources, the songs with what their lyrics hold, the regions and explicit lyrics', async () => {
    await renderMusic(<MusicLibraryView {...libraryProps()} />);
    expect(screen.getByTestId('music-screen')).toBeOnTheScreen();
    expect(flat(screen.getByRole('header', { name: 'Your music' }).props.style)).toMatchObject({ fontFamily: fontFamilies.music, textTransform: 'uppercase' });
    expect(screen.getByTestId('source-apple-music-hint')).toHaveTextContent('Connected · your library plays here');
    expect(screen.getByTestId('library-song-song-1-meta')).toHaveTextContent('Rayo K. · Puerto Rico · lots of slang');
    expect(screen.getByTestId('library-song-song-2-meta')).toHaveTextContent('Brisa 809 · Dominican Republic · some slang');
    expect(screen.getByTestId('library-song-song-3-meta')).toHaveTextContent('Vera Sol · neutral Spanish · little slang');
    expect(screen.getByRole('togglebutton', { name: 'Puerto Rico' }).props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('explicit-hint')).toHaveTextContent('On: nothing is skipped');
    expectAccessibleControls();
  });

  it('calls back for every action', async () => {
    const props = libraryProps();
    await renderMusic(<MusicLibraryView {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Manage' }));
    expect(props.onManageAppleMusic).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Paste' }));
    expect(props.onPasteLyrics).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('library-song-song-2'));
    expect(props.onOpenSong).toHaveBeenCalledWith('song-2');
    await fireEvent.press(screen.getByRole('togglebutton', { name: 'Cuba' }));
    expect(props.onToggleRegion).toHaveBeenCalledWith('CU');
    await fireEvent.press(screen.getByRole('button', { name: 'Turn off' }));
    expect(props.onToggleExplicit).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Bring a text' }));
    expect(props.onBringText).toHaveBeenCalled();
  });

  it('opens the Spotify how-to from "Show me", with its steps', async () => {
    const props = libraryProps();
    await renderMusic(<MusicLibraryView {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Show me' }));
    expect(props.onShowSpotifyHowTo).toHaveBeenCalled();
    expect(screen.getByText('Share a song from Spotify')).toBeOnTheScreen();
    for (const n of [1, 2, 3, 4]) expect(within(screen.getByTestId(`spotify-step-${n}`)).getByText(t(`spotify.howTo.step${n}`))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('spotify-close'));
    expect(screen.queryByText('Share a song from Spotify')).toBeNull();
  });

  it('offers Connect before access is asked, and says Apple Music is not available on Android', async () => {
    const props = libraryProps({ appleMusic: 'notDetermined' });
    await renderMusic(<MusicLibraryView {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(props.onConnectAppleMusic).toHaveBeenCalled();
    expect(appleMusicRow(t, 'unsupported', 'android')).toEqual({ hint: 'Not available on Android yet', action: null });
    expect(appleMusicRow(t, 'unsupported', 'web')).toEqual({ hint: 'Not available on this device', action: null });
    expect(appleMusicRow(t, 'denied').action).toBe('manage');
    expect(appleMusicRow(t, 'restricted').action).toBeNull();
    expect(appleMusicRow(t, 'checking').action).toBeNull();
  });

  it('has no Apple Music button where it does not exist', async () => {
    await renderMusic(<MusicLibraryView {...libraryProps({ appleMusic: 'unsupported' })} />);
    expect(screen.queryByTestId('source-apple-music-action')).toBeNull();
  });

  it('lists Apple Music songs to add, shared songs waiting and brought texts', async () => {
    const props = libraryProps({
      appleLibrary: [{ id: 'am-1', title: 'Noche de playa', artist: 'Brisa 809', explicit: false, genre: null }],
      shares: [{ id: 'sh-1', title: null, artist: null }],
      texts: [{ id: 'tx-1', title: 'Sábado en el mercado', sentences: 4 }],
      songs: [{ id: 'song-9', title: 'Sin letra', artist: 'Vera Sol', monogram: 'SL', source: 'spotify_share', hasLyrics: false, summary: null }],
    });
    await renderMusic(<MusicLibraryView {...props} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add Noche de playa' }));
    expect(props.onAddAppleSong).toHaveBeenCalledWith('am-1');
    expect(screen.getByText('A shared song')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('share-sh-1'));
    expect(props.onOpenShare).toHaveBeenCalledWith('sh-1');
    expect(screen.getByTestId('text-tx-1-meta')).toHaveTextContent('4 sentences');
    await fireEvent.press(screen.getByTestId('text-tx-1'));
    expect(props.onOpenText).toHaveBeenCalledWith('tx-1');
    expect(screen.getByTestId('library-song-song-9-meta')).toHaveTextContent('Vera Sol · waiting for lyrics');
    expectAccessibleControls();
  });

  it('says how to start with no songs, and waits while loading', async () => {
    await renderMusic(<MusicLibraryView {...libraryProps({ songs: [] })} />);
    expect(screen.getByTestId('library-empty')).toHaveTextContent('No songs yet. Connect Apple Music or paste lyrics to start.');
    await renderMusic(<MusicLibraryView {...libraryProps({ loading: true })} />);
    expect(screen.getByTestId('library-loading')).toBeOnTheScreen();
  });

  it('describes a song by region and slang amount', () => {
    const summary = { region: null, slang: 'none' as const, slangCount: 0, slangLexemes: 0, lines: 10, explicit: 0, timed: false };
    expect(songRowMeta(t, 'Vera Sol', summary)).toBe('Vera Sol · neutral Spanish');
    expect(songRowMeta(t, 'Rayo K.', { ...summary, region: 'CARIB', slang: 'some' })).toBe('Rayo K. · Caribbean · some slang');
    expect(songRowMeta(t, '', null)).toBe('Waiting for lyrics');
  });
});

describe('paste lyrics', () => {
  it('shows what the parse found and saves', async () => {
    const onSave = jest.fn();
    await renderMusic(<PasteLyricsView {...fx.paste} onSave={onSave} />);
    expect(screen.getByTestId('paste-preview')).toBeOnTheScreen();
    expect(screen.getByText('10 lines')).toBeOnTheScreen();
    expect(screen.getByText('2 lines left out (labels, extras)')).toBeOnTheScreen();
    expect(screen.getByText('1 explicit word')).toBeOnTheScreen();
    expect(within(screen.getByTestId('paste-notes')).getByTestId('slang-note-corillo')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save the song' }));
    expect(onSave).toHaveBeenCalled();
    expectAccessibleControls();
  });

  it('deletes a pasted line', async () => {
    const onChangeText = jest.fn();
    await renderMusic(<PasteLyricsView {...fx.paste} text={'[Coro]\nUno dos\n\nTres cuatro'} onChangeText={onChangeText} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete line 1: [Coro]' }));
    expect(onChangeText).toHaveBeenCalledWith('Uno dos\n\nTres cuatro');
    expect(pastedLines('a\n\nb').map((l) => l.at)).toEqual([0, 2]);
    expect(withoutLine('a\r\nb\nc', 1)).toBe('a\nc');
  });

  it('edits title and artist unless the song is fixed, blocks saving when it cannot, and shows errors', async () => {
    const onChangeTitle = jest.fn();
    await renderMusic(<PasteLyricsView {...fx.paste} onChangeTitle={onChangeTitle} canSave={false} errorKey="paste.empty" />);
    await fireEvent.changeText(screen.getByTestId('paste-title'), 'Otra');
    expect(onChangeTitle).toHaveBeenCalledWith('Otra');
    expect(screen.getByTestId('paste-save')).toBeDisabled();
    expect(screen.getByTestId('paste-error')).toBeOnTheScreen();
    await renderMusic(<PasteLyricsView {...fx.paste} songFixed preview={null} text="" />);
    expect(screen.queryByTestId('paste-title')).toBeNull();
    expect(screen.getByTestId('paste-song')).toHaveTextContent(/^Luna de Santurce/);
    expect(screen.getByTestId('paste-empty')).toBeOnTheScreen();
  });
});

describe('confirm a shared song', () => {
  it('shows what arrived, lets the title be fixed, and adds or drops it', async () => {
    const props = { ...fx.share, onConfirm: jest.fn(), onDismiss: jest.fn(), onChangeArtist: jest.fn() };
    await renderMusic(<ShareConfirmView {...props} />);
    expect(screen.getByTestId('share-what')).toHaveTextContent('Shared: Malecón a las dos - Brisa 809');
    await fireEvent.changeText(screen.getByTestId('share-artist'), 'Brisa');
    expect(props.onChangeArtist).toHaveBeenCalledWith('Brisa');
    await fireEvent.press(screen.getByRole('button', { name: 'Add the song' }));
    expect(props.onConfirm).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Not this one' }));
    expect(props.onDismiss).toHaveBeenCalled();
    expectAccessibleControls();
  });

  it('says when a link is not a song, and when nothing is waiting', async () => {
    await renderMusic(<ShareConfirmView {...fx.share} notASong />);
    expect(screen.getByTestId('share-not-a-song')).toBeOnTheScreen();
    expect(screen.queryByTestId('share-confirm')).toBeNull();
    await renderMusic(<ShareConfirmView {...fx.share} shared={null} />);
    expect(screen.getByTestId('share-nothing')).toHaveTextContent('Nothing is waiting here.');
  });
});

describe('time it while you listen', () => {
  it('taps the current line, nudges a tapped one a quarter second, undoes and finishes', async () => {
    const props = { ...fx.time, onTap: jest.fn(), onNudge: jest.fn(), onUndo: jest.fn(), onDone: jest.fn(), onPause: jest.fn() };
    await renderMusic(<TapTimerView {...props} />);
    expect(screen.getByTestId('time-at-0')).toHaveTextContent('0:12.4');
    expect(screen.getByTestId('time-at-3')).toHaveTextContent('Not timed yet');
    expect(screen.getByTestId('time-line-3').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Line 4 starts now' }));
    expect(props.onTap).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Line 2 starts a quarter second earlier' }));
    expect(props.onNudge).toHaveBeenCalledWith(1, -NUDGE_MS);
    await fireEvent.press(screen.getByRole('button', { name: 'Line 1 starts a quarter second later' }));
    expect(props.onNudge).toHaveBeenCalledWith(0, NUDGE_MS);
    await fireEvent.press(screen.getByRole('button', { name: 'Undo the last tap' }));
    expect(props.onUndo).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(props.onPause).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(props.onDone).toHaveBeenCalled();
    expectAccessibleControls();
  });

  it('cannot tap without a player or past the last line', async () => {
    await renderMusic(<TapTimerView {...fx.time} playback={{ available: false, playing: false, positionMs: 0, durationMs: null }} />);
    expect(screen.getByTestId('time-tap')).toBeDisabled();
    expect(screen.getByText('Timing needs the song playing in Apple Music on this phone.')).toBeOnTheScreen();
    await renderMusic(<TapTimerView {...fx.time} current={fx.time.lines.length} />);
    expect(screen.getByRole('button', { name: 'Every line has a time.' })).toBeDisabled();
    expect(preciseClock(t, 61_250)).toBe('1:01.2');
    expect(preciseClock(t, -5)).toBe('0:00.0');
  });
});

describe('a song waiting for lyrics, and bringing a text', () => {
  it('asks for the lyrics', async () => {
    const onPaste = jest.fn();
    await renderMusic(<NeedsLyricsView {...fx.needsLyrics} onPaste={onPaste} />);
    expect(screen.getByText('Malecón a las dos')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Paste lyrics' }));
    expect(onPaste).toHaveBeenCalled();
    expect(screen.queryByTestId('needs-lyrics-back')).toBeNull();
  });

  it('takes a title and a text, counts sentences and slang, and notes when the model is not ready', async () => {
    const props = { ...fx.textPaste, onSave: jest.fn(), onChangeText: jest.fn() };
    await renderMusic(<TextPasteView {...props} modelReady={false} />);
    expect(screen.getByText('4 sentences')).toBeOnTheScreen();
    expect(screen.getByText('1 slang word')).toBeOnTheScreen();
    expect(screen.getByTestId('text-paste-no-model')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('text-paste-text'), 'Hola.');
    expect(props.onChangeText).toHaveBeenCalledWith('Hola.');
    await fireEvent.press(screen.getByRole('button', { name: 'Read it' }));
    expect(props.onSave).toHaveBeenCalled();
    expectAccessibleControls();
  });
});
