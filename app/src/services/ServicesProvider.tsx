/**
 * React access to the service container. AppProviders puts the app's container (or a test's)
 * at the root; components call useServices().
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Services } from './types';

const ServicesContext = createContext<Services | null>(null);

export interface ServicesProviderProps {
  services: Services;
  children: ReactNode;
}

export function ServicesProvider({ services, children }: ServicesProviderProps) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** The service container. Must be inside ServicesProvider (AppProviders includes it). */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}
