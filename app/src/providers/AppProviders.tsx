/**
 * Every app-wide provider that needs no startup work, in one place, so screens and tests share
 * the same tree. The service container (src/services) carries the device adapters, the storage
 * handle, the packs and the clock; each native capability comes in through an interface with a
 * fake for tests and a web fallback. What needs startup (opened storage, settings, the restored
 * learner) comes below this, from AppBootstrap (src/bootstrap), in the root layout.
 */
import type { ReactNode } from 'react';
import type { PairPack } from '@cliffword/engine';
import { PacksProvider } from '../engine/PacksProvider';
import { I18nProvider } from '../i18n';
import { getAppServices, ServicesProvider, type Services } from '../services';

export interface AppProvidersProps {
  /** Defaults to the app's container for this platform (getAppServices()). Tests pass createTestServices(). */
  services?: Services;
  /** Defaults to services.packs.pair (the en-es pair pack). */
  pair?: PairPack;
  children: ReactNode;
}

export function AppProviders({ services = getAppServices(), pair = services.packs.pair, children }: AppProvidersProps) {
  return (
    <ServicesProvider services={services}>
      <PacksProvider pair={pair}>
        <I18nProvider ui={pair.ui} native={pair.native}>
          {children}
        </I18nProvider>
      </PacksProvider>
    </ServicesProvider>
  );
}
