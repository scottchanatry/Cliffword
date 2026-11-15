/**
 * Test helper for screens and hooks that need the started app (useAppState, useSettings,
 * useLearner, useStorage): runs the real bootstrap on test services (fresh in-memory storage),
 * then renders inside AppProviders and AppStateProvider, without the loading state. rerender()
 * keeps the providers.
 *
 *   const { services, boot } = await renderWithAppState(<MyScreen />, { settings: { onboarded: true } });
 */
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';
import { AppStateProvider } from '../appState/AppStateProvider';
import { bootstrap } from '../bootstrap/bootstrap';
import { AppProviders } from '../providers/AppProviders';
import type { Services } from '../services';
import { createTestServices, type TestServices } from '../services/testServices';
import type { AppSettings } from '../storage/repos/settings';

export interface RenderWithAppStateOptions<S extends Services> extends RenderOptions {
  /** Defaults to createTestServices(). */
  services?: S;
  /** Stored before startup, as a returning learner would have them. */
  settings?: Partial<AppSettings>;
}

export async function renderWithAppState<S extends Services = TestServices>(
  ui: ReactElement,
  { services, settings, ...options }: RenderWithAppStateOptions<S> = {},
) {
  const used = (services ?? createTestServices()) as S;
  if (settings) await (await used.storage.open()).settings.update(settings);
  const boot = await bootstrap(used);
  // A wrapper (not a parent element), so rerender(ui) keeps the providers.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders services={used}>
      <AppStateProvider boot={boot} packs={used.packs}>
        {children}
      </AppStateProvider>
    </AppProviders>
  );
  const result = await render(ui, { ...options, wrapper });
  return { ...result, services: used, boot };
}
