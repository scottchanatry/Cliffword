import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, type Translator } from './translator';

const I18nContext = createContext<Translator | null>(null);

export interface I18nProviderProps {
  /** PairPack.ui of the active pair. */
  ui?: Readonly<Record<string, string>>;
  /** PairPack.native, the learner's native language. */
  native?: string;
  children: ReactNode;
}

export function I18nProvider({ ui, native, children }: I18nProviderProps) {
  const translator = useMemo(() => createTranslator({ ui, native }), [ui, native]);
  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

/** The translator for the current pair and native language. Must be inside I18nProvider. */
export function useI18n(): Translator {
  const translator = useContext(I18nContext);
  if (!translator) throw new Error('useI18n must be used inside <I18nProvider>');
  return translator;
}
