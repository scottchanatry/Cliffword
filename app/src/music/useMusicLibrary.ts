/**
 * The data behind the Music tab's library (C3, route (tabs)/music/index): stored songs with
 * their summary, brought texts, unconfirmed shares, Apple Music access and library, and the
 * slang settings. Everything comes from useServices() and the app state; the route hands the
 * result to MusicLibraryView as plain props.
 *
 * - Read again whenever the screen gets focus (a song pasted, a share confirmed, access granted
 *   in Settings).
 * - Shares: services.share.pending() at mount and every onShare after; a confirmed or dismissed
 *   share is cleared by the share screen.
 * - Apple Music: 'unsupported' where there is no MusicKit (Android, web); otherwise the current
 *   access, asked for only when the learner taps Connect. The library list is shown only while
 *   access is granted, without the songs already stored.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { splitTextUnits } from '@cliffword/engine';
import { router, useFocusEffect } from 'expo-router';
import type { SharedItem } from '../adapters/share/types';
import type { Song as MusicKitSong } from '../adapters/music/types';
import { useAppState } from '../appState/AppStateProvider';
import type { AppleLibrarySong, AppleMusicStatus, BroughtTextRow, LibrarySongRow, MusicLibraryProps } from '../features/music/types';
import { useServices } from '../services/ServicesProvider';
import type { Services } from '../services/types';
import type { Storage } from '../storage/storage';
import { readLyrics } from './lyricsData';
import { pendingShareRows } from './share';
import { monogram, songSummary } from './songSummary';

/** Apple Music library songs listed at once. */
export const APPLE_LIBRARY_LIMIT = 25;

export interface LibraryData {
  songs: LibrarySongRow[];
  texts: BroughtTextRow[];
  appleMusic: AppleMusicStatus;
  appleLibrary: AppleLibrarySong[];
}

/** Stored songs and texts as library rows (summaries from each song's lyrics). */
export async function loadStoredLibrary(storage: Storage, packs: Services['packs']): Promise<Pick<LibraryData, 'songs' | 'texts'>> {
  const songs: LibrarySongRow[] = [];
  for (const song of await storage.songs.recent()) {
    const stored = await readLyrics(storage, song.id, packs.lang);
    const hasLyrics = stored !== null && stored.lyrics.lines.length > 0;
    songs.push({
      id: song.id,
      title: song.title,
      artist: song.artist,
      monogram: monogram(song.title, packs.lang),
      source: song.source,
      hasLyrics,
      summary: hasLyrics && stored ? songSummary(stored.lyrics, packs.lang, packs.pair) : null,
    });
  }
  const texts = (await storage.texts.list()).map((t) => ({ id: t.id, title: t.title, sentences: splitTextUnits(packs.lang, t.rawText).length }));
  return { songs, texts };
}

/** Apple Music access and the library songs not stored yet. */
export async function loadAppleMusic(music: Services['music'], storedIds: ReadonlySet<string>): Promise<Pick<LibraryData, 'appleMusic' | 'appleLibrary'>> {
  if (!music.available) return { appleMusic: 'unsupported', appleLibrary: [] };
  let status: AppleMusicStatus;
  try {
    status = await music.authorizationStatus();
  } catch {
    return { appleMusic: 'unsupported', appleLibrary: [] };
  }
  if (status !== 'authorized') return { appleMusic: status, appleLibrary: [] };
  let songs: MusicKitSong[] = [];
  try {
    songs = await music.librarySongs({ limit: APPLE_LIBRARY_LIMIT });
  } catch {
    songs = [];
  }
  return {
    appleMusic: 'authorized',
    appleLibrary: songs
      .filter((s) => !storedIds.has(s.id))
      .map((s) => ({ id: s.id, title: s.title, artist: s.artist, explicit: s.explicit === true, genre: s.genre ?? null })),
  };
}

export interface UseMusicLibrary {
  props: MusicLibraryProps;
  /** Read everything again. */
  refresh: () => Promise<void>;
}

const EMPTY: LibraryData = { songs: [], texts: [], appleMusic: 'checking', appleLibrary: [] };

export function useMusicLibrary(): UseMusicLibrary {
  const services = useServices();
  const { storage, settings, updateSettings } = useAppState();
  const [data, setData] = useState<LibraryData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [shares, setShares] = useState<readonly SharedItem[]>(() => services.share.pending());
  const alive = useRef(true);
  const appleById = useRef(new Map<string, AppleLibrarySong>());

  const refresh = useCallback(async () => {
    try {
      const stored = await loadStoredLibrary(storage, services.packs);
      const storedApple = new Set<string>();
      for (const s of await storage.songs.list()) if (s.source === 'apple_music' && s.externalId) storedApple.add(s.externalId);
      const apple = await loadAppleMusic(services.music, storedApple);
      if (!alive.current) return;
      appleById.current = new Map(apple.appleLibrary.map((s) => [s.id, s]));
      setData({ ...stored, ...apple });
      setShares(services.share.pending());
    } catch (e) {
      console.warn('[music] library could not be read', e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [services, storage]);

  useEffect(() => {
    alive.current = true;
    const unsub = services.share.onShare(() => setShares(services.share.pending()));
    return () => {
      alive.current = false;
      unsub();
    };
  }, [services]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const toggleRegion = useCallback(
    (code: string) => {
      const regions = settings.regions;
      void updateSettings({ regions: regions.includes(code) ? regions.filter((c) => c !== code) : [...regions, code] }).catch((e: unknown) =>
        console.warn('[music] regions not saved', e),
      );
    },
    [settings.regions, updateSettings],
  );

  const props = useMemo<MusicLibraryProps>(
    () => ({
      songs: data.songs,
      appleMusic: data.appleMusic,
      appleLibrary: data.appleLibrary,
      shares: pendingShareRows(shares),
      texts: data.texts,
      regions: settings.regions,
      showExplicit: settings.showExplicit,
      loading,
      onOpenSong: (id) => router.push({ pathname: '/music/[songId]', params: { songId: id } }),
      onAddAppleSong: (id) => {
        const song = appleById.current.get(id);
        if (!song) return;
        void storage.songs
          .upsert({ source: 'apple_music', externalId: song.id, title: song.title, artist: song.artist, genre: song.genre })
          .then((stored) => router.push({ pathname: '/music/[songId]', params: { songId: stored.id } }))
          .catch((e: unknown) => console.warn('[music] song not saved', e));
      },
      onConnectAppleMusic: () => {
        void services.music
          .authorize()
          .catch(() => undefined)
          .then(() => refresh());
      },
      onManageAppleMusic: () => {
        void Linking.openSettings().catch(() => undefined);
      },
      onShowSpotifyHowTo: () => undefined,
      onPasteLyrics: () => router.push('/music/paste'),
      onOpenShare: (id) => router.push({ pathname: '/music/share', params: { id } }),
      onBringText: () => router.push('/text/paste'),
      onOpenText: (id) => router.push({ pathname: '/text/[textId]', params: { textId: id } }),
      onToggleRegion: toggleRegion,
      onToggleExplicit: () => {
        void updateSettings({ showExplicit: !settings.showExplicit }).catch((e: unknown) => console.warn('[music] explicit not saved', e));
      },
    }),
    [data, shares, settings.regions, settings.showExplicit, loading, storage, services, refresh, toggleRegion, updateSettings],
  );

  return { props, refresh };
}
