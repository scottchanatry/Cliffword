/**
 * The behaviour behind the picture chooser (onboarding's "Who are you in the story?" and Settings'
 * "Your picture"), apart from its view: every choice is stored at once in settings.picture, and a
 * photo file that is no longer the picture is deleted.
 *
 * - A character: stored; a photo it replaces is deleted.
 * - "Take a selfie" / "Choose a photo": the PhotoPicker asks for the permission it needs only now,
 *   opens the system UI and stores a copy. Picked: stored, and the earlier photo deleted. Cancelled:
 *   nothing changes. Denied: a notice says how to allow it in Settings; the picture stays. An error
 *   (or a copy that could not be stored as the setting): a notice; the picture stays and the new
 *   copy is deleted.
 * - "Remove photo": back to the default character, and the photo deleted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { PhotoSource } from '../../adapters/photo/types';
import { useAppState } from '../../appState/AppStateProvider';
import type { YouAvatarId } from '../../illustrations';
import { useServices } from '../../services/ServicesProvider';
import { DEFAULT_PICTURE, type LearnerPicture } from '../../storage/repos/settings';

/** What the chooser says after a photo did not work: the permission is off, or something failed. */
export type PictureNotice = { kind: 'denied'; source: PhotoSource } | { kind: 'error' };

export interface PictureChooserState {
  picture: LearnerPicture;
  /** The photo sources this device offers (none in the web preview). */
  sources: readonly PhotoSource[];
  /** A photo is being taken or chosen, or a choice is being stored. */
  busy: boolean;
  notice: PictureNotice | null;
  chooseCharacter: (id: YouAvatarId) => void;
  pickPhoto: (source: PhotoSource) => void;
  /** Back to the default character (only offered while a photo is the picture). */
  removePhoto: () => void;
  /** The system Settings, after a refusal. */
  openSettings: () => void;
}

const samePicture = (a: LearnerPicture, b: LearnerPicture) =>
  a.kind === b.kind && (a.kind === 'character' ? a.id === (b as typeof a).id : a.uri === (b as typeof a).uri);

export function usePictureChooser(): PictureChooserState {
  const { photos } = useServices();
  const { settings, updateSettings } = useAppState();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PictureNotice | null>(null);
  const live = useRef(true);
  const working = useRef(false);
  // The stored picture, as of the last write this hook made (renders can lag behind it).
  const current = useRef(settings.picture);
  useEffect(() => {
    current.current = settings.picture;
  }, [settings.picture]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /** Stores `next`; then deletes the photo it replaced. Rejects (nothing deleted) when the write fails. */
  const store = useCallback(
    async (next: LearnerPicture) => {
      const before = current.current;
      if (samePicture(before, next)) return;
      const after = await updateSettings({ picture: next });
      current.current = after.picture;
      if (before.kind === 'photo' && !(after.picture.kind === 'photo' && after.picture.uri === before.uri)) await photos.remove(before.uri);
    },
    [updateSettings, photos],
  );

  const run = useCallback((work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice(null);
    work()
      .catch((e: unknown) => {
        console.warn('[picture] not saved', e);
        if (live.current) setNotice({ kind: 'error' });
      })
      .finally(() => {
        working.current = false;
        if (live.current) setBusy(false);
      });
  }, []);

  const chooseCharacter = useCallback((id: YouAvatarId) => run(() => store({ kind: 'character', id })), [run, store]);

  const pickPhoto = useCallback(
    (source: PhotoSource) =>
      run(async () => {
        const result = await photos.pick(source);
        switch (result.kind) {
          case 'picked':
            try {
              await store({ kind: 'photo', uri: result.uri });
            } catch (e) {
              await photos.remove(result.uri);
              throw e;
            }
            return;
          case 'cancelled':
            return;
          case 'denied':
            if (live.current) setNotice({ kind: 'denied', source });
            return;
          case 'unavailable':
          case 'error':
            throw new Error(result.kind === 'error' ? result.message : `no ${source} on this device`);
        }
      }),
    [run, photos, store],
  );

  const removePhoto = useCallback(() => run(() => store(DEFAULT_PICTURE)), [run, store]);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);

  return { picture: settings.picture, sources: photos.sources, busy, notice, chooseCharacter, pickPhoto, removePhoto, openSettings };
}
