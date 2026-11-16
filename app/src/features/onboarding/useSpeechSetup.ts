/**
 * Onboarding's voice step: what listening would do (SpeechIn.availability for the pack's
 * recognition locales in the learner's regions, on the device unless the learner allowed the
 * network), asking for the microphone and speech permission, and fetching the offline language
 * model where the platform can (Android 13+). Read again when the app comes back to the
 * foreground, since the learner may have changed the permission in Settings.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState as NativeAppState, Linking } from 'react-native';
import { languageDownloadKey } from '../../adapters/speechIn/messages';
import { recognitionLocales } from '../../adapters/speechIn/locales';
import type { SpeechAvailability } from '../../adapters/speechIn/types';
import { useAppState } from '../../appState/AppStateProvider';
import type { CatalogKey } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';

export interface SpeechSetup {
  /** null while the first check runs. */
  availability: SpeechAvailability | null;
  /** Ask for the microphone and speech permission (the system dialog). */
  allow: () => void;
  /** Open the system Settings (after a refusal). */
  openSettings: () => void;
  /** Fetch the offline recognition model (when availability.canDownload). */
  downloadLanguage: () => void;
  /** The text after a language download, or null. */
  downloadMessage: CatalogKey | null;
  /** A permission request or download is running. */
  busy: boolean;
}

export function useSpeechSetup(): SpeechSetup {
  const { speechIn, packs } = useServices();
  const { settings } = useAppState();
  const [availability, setAvailability] = useState<SpeechAvailability | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<CatalogKey | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  const locales = recognitionLocales(packs.lang.code, settings.regions);
  const localesKey = locales.join('|');
  const onDevice = !settings.allowNetworkRecognition;

  const check = useCallback(async () => {
    const [lang, ...langFallbacks] = localesKey.split('|');
    const result = await speechIn.availability({ lang: lang ?? packs.lang.code, langFallbacks, onDevice });
    if (live.current) setAvailability(result);
  }, [speechIn, packs, localesKey, onDevice]);

  useEffect(() => {
    live.current = true;
    void check();
    const sub = NativeAppState.addEventListener('change', (status) => {
      if (status === 'active') void check();
    });
    return () => {
      live.current = false;
      sub.remove();
    };
  }, [check]);

  const allow = useCallback(() => {
    setBusy(true);
    speechIn
      .requestPermission()
      .catch(() => undefined)
      .then(check)
      .finally(() => {
        if (live.current) setBusy(false);
      });
  }, [speechIn, check]);

  const downloadLanguage = useCallback(() => {
    const locale = availability?.locale ?? localesKey.split('|')[0] ?? packs.lang.code;
    setBusy(true);
    speechIn
      .downloadLanguage(locale)
      .then(
        (result) => {
          if (live.current) setDownloadMessage(languageDownloadKey(result));
        },
        () => {
          if (live.current) setDownloadMessage(languageDownloadKey('failed'));
        },
      )
      .then(check)
      .finally(() => {
        if (live.current) setBusy(false);
      });
  }, [speechIn, availability, localesKey, packs, check]);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);

  return { availability, allow, openSettings, downloadLanguage, downloadMessage, busy };
}
