/**
 * The share-confirm screen (route (tabs)/music/share, ?id= of a shared item; default the oldest
 * pending one): the shared item as a draft song (title and artist editable), Confirm saves it
 * (one row per Spotify track) and clears the share, then asks for the lyrics; Dismiss clears it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useAppState } from '../appState/AppStateProvider';
import type { SharedItem } from '../adapters/share/types';
import type { ShareConfirmProps } from '../features/music/types';
import { useServices } from '../services/ServicesProvider';
import { saveSharedSong, shareDraft } from './share';

export function useShareConfirm(id: string | null): ShareConfirmProps {
  const { share } = useServices();
  const { storage } = useAppState();
  const pick = useCallback((): SharedItem | null => {
    const pending = share.pending();
    return (id ? pending.find((p) => p.id === id) : pending[0]) ?? null;
  }, [share, id]);
  const [item, setItem] = useState<SharedItem | null>(pick);
  const draft = useMemo(() => (item ? shareDraft(item) : null), [item]);
  // null until the learner edits a field: until then it shows the draft's value (also of a share that arrived later).
  const [editedTitle, setTitle] = useState<string | null>(null);
  const [editedArtist, setArtist] = useState<string | null>(null);
  const title = editedTitle ?? draft?.title ?? '';
  const artist = editedArtist ?? draft?.artist ?? '';
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const unsub = share.onShare(() => setItem((current) => current ?? pick()));
    return () => {
      alive.current = false;
      unsub();
    };
  }, [share, pick]);

  const close = () => router.dismissTo('/music');
  const canSave = !saving && draft !== null && title.trim().length > 0;

  return {
    shared: item ? { url: item.url ?? null, text: item.text ?? null } : null,
    title,
    artist,
    notASong: draft?.notASong ?? false,
    canSave,
    saving,
    onChangeTitle: setTitle,
    onChangeArtist: setArtist,
    onConfirm: () => {
      if (!canSave || !draft || !item) return;
      setSaving(true);
      void saveSharedSong(storage, draft, { title, artist })
        .then((song) => {
          share.clear(item.id);
          router.replace({ pathname: '/music/paste', params: { songId: song.id } });
        })
        .catch((e: unknown) => console.warn('[music] shared song not saved', e))
        .finally(() => {
          if (alive.current) setSaving(false);
        });
    },
    onDismiss: () => {
      if (item) share.clear(item.id);
      close();
    },
  };
}
