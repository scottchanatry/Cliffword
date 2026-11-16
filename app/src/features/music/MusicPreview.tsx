/**
 * Dev gallery of the Music views: renders one fixture (src/features/music/fixtures.ts) by name.
 * The actions keep a little local state (listening, register, explicit, the meaning sheet,
 * the notice, the library's pills, the paste text) so the screens can be tried by hand;
 * everything else does nothing. Reached only through the guarded (dev) route.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LyricActions, LyricViewModel } from '../../session/contract';
import { sharedMockModel } from '../../services/defaults';
import { useServices } from '../../services/ServicesProvider';
import { colors, spacing } from '../../theme';
import { TextPasteView } from '../text/TextPasteView';
import { musicFixtures, type MusicFixtureName, type MusicFixtures } from './fixtures';
import { MusicLibraryView } from './MusicLibraryView';
import { NeedsLyricsView } from './NeedsLyricsView';
import { PasteLyricsView } from './PasteLyricsView';
import { ShareConfirmView } from './ShareConfirmView';
import { SongView } from './SongView';
import { TapTimerView } from './TapTimerView';
import type { MusicLibraryProps, PasteLyricsProps, TextPasteProps } from './types';

export function MusicPreview({ name }: { name: MusicFixtureName }) {
  const { packs } = useServices();
  const [fixtures, setFixtures] = useState<MusicFixtures | null>(null);
  useEffect(() => {
    let live = true;
    void musicFixtures({ lang: packs.lang, pair: packs.pair, model: sharedMockModel() }).then((f) => {
      if (live) setFixtures(f);
    });
    return () => {
      live = false;
    };
  }, [packs]);
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']} testID="music-preview">
      {fixtures ? <PreviewBody key={name} name={name} fixtures={fixtures} /> : <ActivityIndicator style={styles.wait} color={colors.muted} />}
    </SafeAreaView>
  );
}

function PreviewBody({ name, fixtures }: { name: MusicFixtureName; fixtures: MusicFixtures }) {
  const song = fixtures.song[name];
  if (song !== undefined) return <PreviewSong initial={song} />;
  const library = fixtures.library[name];
  if (library) return <PreviewLibrary initial={library} />;
  switch (name) {
    case 'paste':
      return <PreviewPaste initial={fixtures.paste} />;
    case 'share':
      return <ShareConfirmView {...fixtures.share} />;
    case 'time':
      return <TapTimerView {...fixtures.time} />;
    case 'text-paste':
      return <PreviewTextPaste initial={fixtures.textPaste} />;
    case 'needs-lyrics':
      return <NeedsLyricsView {...fixtures.needsLyrics} onPaste={() => undefined} onBack={() => undefined} />;
    default:
      return null;
  }
}

function PreviewSong({ initial }: { initial: LyricViewModel }) {
  const [vm, setVm] = useState(initial);
  const actions = useMemo<LyricActions>(() => {
    const none = () => undefined;
    return {
      holdBegin: none,
      holdStart: () => setVm((v) => ({ ...v, listen: { phase: 'listening', level: 0.6, partial: '' } })),
      holdEnd: () => setVm((v) => ({ ...v, listen: { phase: 'idle' } })),
      holdCancel: () => setVm((v) => (v.listen.phase === 'listening' ? v : { ...v, listen: { phase: 'idle' } })),
      typeAnswer: none,
      command: none,
      pickOption: none,
      closeMeaning: () => setVm((v) => ({ ...v, meaning: null })),
      dismissNotice: () => setVm((v) => ({ ...v, notice: null })),
      start: none,
      next: none,
      openLine: none,
      startEcho: none,
      setRegister: (register) => setVm((v) => ({ ...v, register })),
      showSong: none,
      markLine: none,
      play: () => setVm((v) => ({ ...v, playback: { ...v.playback, playing: true } })),
      pause: () => setVm((v) => ({ ...v, playback: { ...v.playback, playing: false } })),
      setShowExplicit: (showExplicit) => setVm((v) => ({ ...v, showExplicit })),
      hearWord: none,
    };
  }, []);
  return <SongView vm={vm} actions={actions} />;
}

function PreviewLibrary({ initial }: { initial: MusicLibraryProps }) {
  const [regions, setRegions] = useState(initial.regions);
  const [showExplicit, setShowExplicit] = useState(initial.showExplicit);
  return (
    <MusicLibraryView
      {...initial}
      regions={regions}
      showExplicit={showExplicit}
      onToggleRegion={(code) => setRegions((r) => (r.includes(code) ? r.filter((c) => c !== code) : [...r, code]))}
      onToggleExplicit={() => setShowExplicit((s) => !s)}
    />
  );
}

function PreviewPaste({ initial }: { initial: PasteLyricsProps }) {
  const [text, setText] = useState(initial.text);
  const [title, setTitle] = useState(initial.title);
  const [artist, setArtist] = useState(initial.artist);
  return <PasteLyricsView {...initial} text={text} title={title} artist={artist} onChangeText={setText} onChangeTitle={setTitle} onChangeArtist={setArtist} />;
}

function PreviewTextPaste({ initial }: { initial: TextPasteProps }) {
  const [text, setText] = useState(initial.text);
  const [title, setTitle] = useState(initial.title);
  return <TextPasteView {...initial} text={text} title={title} onChangeText={setText} onChangeTitle={setTitle} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground, paddingTop: spacing.lg },
  wait: { flex: 1 },
});
