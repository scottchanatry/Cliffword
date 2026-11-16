import { useEffect, useRef, useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAppState } from '../../../src/appState/AppStateProvider';
import { NeedsLyricsView } from '../../../src/features/music/NeedsLyricsView';
import { SongView } from '../../../src/features/music/SongView';
import { useI18n } from '../../../src/i18n';
import { useLyricController } from '../../../src/session/lyric/useLyricController';

const back = () => router.dismissTo('/music');

/**
 * Two registers (C2): the song's lines in neutral and street register side by side (the
 * session's registers screen). ?songId= picks the song; without it, the most recently opened
 * song with lyrics. Leaving goes back to the song page.
 */
export default function RegistersRoute() {
  const params = useLocalSearchParams<{ songId?: string }>();
  const { storage } = useAppState();
  const { t } = useI18n();
  const [songId, setSongId] = useState<string | null>(params.songId ? String(params.songId) : null);
  const [none, setNone] = useState(false);

  useEffect(() => {
    if (songId) return;
    let alive = true;
    void (async () => {
      for (const song of await storage.songs.recent()) {
        if ((await storage.lyrics.get(song.id))?.rawText.trim()) {
          if (alive) setSongId(song.id);
          return;
        }
      }
      if (alive) setNone(true);
    })();
    return () => {
      alive = false;
    };
  }, [songId, storage]);

  const { vm, actions, source } = useLyricController(songId ? { kind: 'song', songId } : null);

  // Show the registers once the song has opened; back on the song page when this page closes.
  const shown = useRef(false);
  const reached = useRef(false);
  useEffect(() => {
    if (!vm.screen) return;
    if (!shown.current) {
      shown.current = true;
      if (vm.screen.kind !== 'registers') actions.setRegister(vm.register);
    }
    if (vm.screen.kind === 'registers') reached.current = true;
    else if (reached.current && songId) {
      // "Back to the song" left the registers: this page is done.
      reached.current = false;
      router.dismissTo({ pathname: '/music/[songId]', params: { songId } });
    }
  }, [vm.screen, vm.register, actions, songId]);
  useEffect(() => () => actions.showSong(), [actions]);

  if (none) return <NeedsLyricsView title={t('register.title')} artist="" onPaste={() => router.replace('/music/paste')} onBack={back} />;
  if (source.status === 'missing') return <Redirect href="/music" />;
  if (source.status === 'needsLyrics' && songId) {
    return (
      <NeedsLyricsView
        title={source.title}
        artist={source.artist}
        onPaste={() => router.push({ pathname: '/music/paste', params: { songId } })}
        onBack={back}
      />
    );
  }
  return <SongView vm={vm} actions={actions} nav={{ onBack: back }} />;
}
