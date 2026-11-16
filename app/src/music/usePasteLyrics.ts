/**
 * The paste-lyrics screen (route (tabs)/music/paste, ?songId= for a song that exists): the
 * pasted text is parsed as it changes (engine parseLyrics: plain text or LRC) and previewed;
 * Save stores the song (a new manual song, or the given one) and its lyrics, reloads any open
 * controller of that song, and opens the song page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useAppState } from '../appState/AppStateProvider';
import type { PasteLyricsProps } from '../features/music/types';
import { tKey } from '../i18n/tKey';
import { useServices } from '../services/ServicesProvider';
import { targetKey, useLyricControllerRegistry } from '../session/lyric/useLyricController';
import { hasLyricLines, lyricsPreview, parsePastedLyrics, readLyrics, saveLyrics } from './lyricsData';

export function usePasteLyrics(songId: string | null): PasteLyricsProps {
  const services = useServices();
  const { storage, settings } = useAppState();
  const registry = useLyricControllerRegistry();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [text, setText] = useState('');
  const [songFixed, setSongFixed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (songId) {
      void (async () => {
        const song = await storage.songs.get(songId);
        if (!alive.current || !song) return;
        setTitle(song.title);
        setArtist(song.artist);
        setSongFixed(true);
        const stored = await readLyrics(storage, songId, services.packs.lang);
        if (alive.current && stored) setText((current) => current || stored.raw);
      })().catch((e: unknown) => console.warn('[music] song not read', e));
    }
    return () => {
      alive.current = false;
    };
  }, [songId, storage, services.packs.lang]);

  const parsed = useMemo(() => (text.trim() ? parsePastedLyrics(text, services.packs.lang) : null), [text, services.packs.lang]);
  const preview = useMemo(
    () => (parsed && hasLyricLines(parsed) ? lyricsPreview(parsed, services.packs.lang, services.packs.pair, { regions: settings.regions, showExplicit: settings.showExplicit }) : null),
    [parsed, services.packs, settings.regions, settings.showExplicit],
  );
  const canSave = !saving && preview !== null && (songFixed || title.trim().length > 0);

  const save = useCallback(() => {
    if (!canSave) return;
    setSaving(true);
    setErrorKey(null);
    void (async () => {
      try {
        const id = songId ?? (await storage.songs.upsert({ source: 'manual', title: title.trim(), artist: artist.trim() })).id;
        await saveLyrics(storage, id, text, services.packs.lang);
        for (const c of registry?.find(targetKey({ kind: 'song', songId: id })) ?? []) c.reload();
        if (!alive.current) return;
        // Back to the song page when it is open below (edit lyrics), else open it here.
        router.dismissTo({ pathname: '/music/[songId]', params: { songId: id } });
      } catch (e) {
        console.warn('[music] lyrics not saved', e);
        if (alive.current) setErrorKey(tKey('paste.error.notSaved'));
      } finally {
        if (alive.current) setSaving(false);
      }
    })();
  }, [canSave, songId, storage, title, artist, text, services.packs.lang, registry]);

  return {
    title,
    artist,
    text,
    songFixed,
    preview,
    canSave,
    saving,
    errorKey,
    onChangeTitle: setTitle,
    onChangeArtist: setArtist,
    onChangeText: setText,
    onSave: save,
    onCancel: () => (songId ? router.dismissTo({ pathname: '/music/[songId]', params: { songId } }) : router.dismissTo('/music')),
  };
}
