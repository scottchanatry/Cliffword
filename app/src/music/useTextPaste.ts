/**
 * Bring a text (route text/paste): an article or a transcript, pasted. The preview counts its
 * sentences (engine splitTextUnits) and slang; Save stores it on this device (texts, schema v4)
 * and opens it (text/[textId]), where the lyric session runs on { kind: 'text' }.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { router } from 'expo-router';
import { slangNotes, splitTextUnits } from '@cliffword/engine';
import { useAppState } from '../appState/AppStateProvider';
import type { TextPasteProps } from '../features/music/types';
import { tKey } from '../i18n/tKey';
import { useServices } from '../services/ServicesProvider';

export function useTextPaste(): TextPasteProps {
  const services = useServices();
  const { storage, settings } = useAppState();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const { lang, pair } = services.packs;
    const sentences = splitTextUnits(lang, text).length;
    if (sentences === 0) return null;
    return { sentences, slang: slangNotes(text, lang, pair, { regions: settings.regions, showExplicit: settings.showExplicit }).length };
  }, [text, services.packs, settings.regions, settings.showExplicit]);

  const canSave = !saving && preview !== null;

  return {
    title,
    text,
    preview,
    modelReady: services.model.status === 'ready',
    canSave,
    saving,
    errorKey,
    onChangeTitle: setTitle,
    onChangeText: setText,
    onSave: () => {
      if (!canSave) return;
      setSaving(true);
      setErrorKey(null);
      void storage.texts
        .add({ title, rawText: text })
        .then((saved) => router.replace({ pathname: '/text/[textId]', params: { textId: saved.id } }))
        .catch((e: unknown) => {
          console.warn('[text] not saved', e);
          if (alive.current) setErrorKey(tKey('paste.error.notSaved'));
        })
        .finally(() => {
          if (alive.current) setSaving(false);
        });
    },
    onCancel: () => (router.canGoBack() ? router.back() : router.replace('/music')),
  };
}
